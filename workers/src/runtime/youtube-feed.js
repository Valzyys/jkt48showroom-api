export const YOUTUBE_CHANNELS = [
  {id:'UCaIbbu5Xg3DpHsn_3Zw2m9w',name:'JKT48',handle:'@JKT48'},
  {id:'UCadv-UfEyjjwOPcZHc2QvIQ',name:'JKT48 TV',handle:'@jkt48tv'},
];
function decode(value='') {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(entity,key)=>{
    if(key[0]==='#'){const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):entity;}
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[key.toLowerCase()]||entity;
  }).trim();
}
function text(xml,tag){return decode(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i').exec(xml)?.[1]||'');}
function attribute(xml,tag,name){const element=new RegExp('<'+tag+'\\b([^>]*)>','i').exec(xml)?.[1]||'';return decode(new RegExp('\\b'+name+'=["\']([^"\']*)["\']','i').exec(element)?.[1]||'');}
export function parseYoutubeFeed(xml,channel){
  if(typeof xml!=='string'||!/<feed\b/i.test(xml)||!/<\/feed>/i.test(xml)||/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error('Invalid YouTube feed');
  const rows=[];
  for(const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)){
    const entry=match[1],id=text(entry,'yt:videoId'),channelId=text(entry,'yt:channelId'),date=text(entry,'published');
    if(!/^[a-zA-Z0-9_-]{11}$/.test(id)||channelId!==channel.id||!Number.isFinite(Date.parse(date)))continue;
    const image=attribute(entry,'media:thumbnail','url'),views=attribute(entry,'media:statistics','views');
    const thumbnail=/^https:\/\/i(?:\d)?\.ytimg\.com\//.test(image)?image:'https://i.ytimg.com/vi/'+id+'/hqdefault.jpg';
    rows.push({id,title:text(entry,'title'),description:text(entry,'media:description'),channelId,channelTitle:text(entry,'name')||channel.name,channelUrl:channel.handle,url:'https://www.youtube.com/watch?v='+id,date:new Date(date).toISOString(),thumbnails:{high:{url:thumbnail,width:480,height:360}},statistics:/^\d+$/.test(views)?{viewCount:views}:{},source:text(entry,'jkc:source')==='youtube-public-channel'?'youtube-public-channel':'youtube-public-feed',...(text(entry,'jkc:dateApproximate')==='true'?{date_is_approximate:true,published_text:text(entry,'jkc:publishedText')}:{})});
    if(rows.length>=20)break;
  }
  return rows;
}
export function createYoutubeFeedClient({fetcher=(...args)=>fetch(...args),now=()=>Date.now(),ttl=180000,store,retryMs=30000,maxStale=86400000}={}){
  const cache=new Map(),retryAt=new Map();let inflight,loaded=false;
  return async function videos(){
    if(loaded&&YOUTUBE_CHANNELS.every(channel=>cache.has(channel.id)&&now()-cache.get(channel.id).time<ttl))return merged();
    if(inflight)return inflight;
    inflight=(async()=>{
      if(!loaded){
        await Promise.all(YOUTUBE_CHANNELS.map(async channel=>{try{const saved=await store?.load(channel.id);if(saved&&saved.time<=now()&&now()-saved.time<maxStale)cache.set(channel.id,saved)}catch{console.warn('youtube-feed-store-unavailable')}}));loaded=true;
      }
      const results=await Promise.allSettled(YOUTUBE_CHANNELS.map(async channel=>{
        const previous=cache.get(channel.id);if(previous&&now()-previous.time<ttl||retryAt.get(channel.id)>now())return;
        retryAt.set(channel.id,now()+retryMs);
        const response=await fetcher('https://www.youtube.com/feeds/videos.xml?channel_id='+channel.id,{headers:{Accept:'application/atom+xml, application/xml;q=0.9','User-Agent':'JKT48Connect/1.0'},redirect:'manual',signal:AbortSignal.timeout(20000)});
        if(!response.ok){await response.body?.cancel();throw Error('YouTube feed HTTP '+response.status);}
        if(Number(response.headers.get('content-length'))>512*1024){await response.body?.cancel();throw Error('YouTube feed too large');}
        const body=await response.text();if(body.length>512*1024)throw Error('YouTube feed too large');
        const rows=parseYoutubeFeed(body,channel);if(!rows.length)throw Error('YouTube feed has no valid videos');
        const entry={rows,time:now()};cache.set(channel.id,entry);retryAt.delete(channel.id);
        try{await store?.save(channel.id,entry)}catch{console.warn('youtube-feed-store-unavailable')}
      }));
      results.forEach((result,index)=>{if(result.status==='rejected')console.warn('youtube-feed-failed',{channel:YOUTUBE_CHANNELS[index].id,error:result.reason?.name||'Error',message:String(result.reason?.message||'Feed unavailable').slice(0,160)})});
      const rows=merged();if(!rows.length)throw Object.assign(Error('YouTube feeds temporarily unavailable; please retry shortly'),{status:502,code:'YOUTUBE_FEED_UNAVAILABLE'});
      return rows;
    })().finally(()=>{inflight=null});return inflight;
  };
  function merged(){return [...new Map([...cache.values()].filter(entry=>now()-entry.time<maxStale).flatMap(entry=>entry.rows.map(row=>({...row,feed_status:now()-entry.time<ttl?'fresh':'stale',feed_updated_at:new Date(entry.time).toISOString()}))).map(row=>[row.id,row])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,20);}
}
