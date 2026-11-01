const timestamp=value=>new Date(value).getTime();
export function recordingSession(data,origin){
 const recordings=data.recordings||[],live=data.live_info?.date||{},start=timestamp(live.start),end=timestamp(live.end),duration=Math.max(0,end-start)||0;
 const lengthsKnown=recordings.length>0&&recordings.every(r=>Number.isFinite(r.duration_ms));
 const sum=recordings.reduce((n,r)=>n+(r.duration_ms||0),0),known=recordings.length>0&&recordings.every(r=>r.timing_source==='playlist'&&Number.isFinite(r.duration_ms)&&Number.isFinite(timestamp(r.started_at)));
 let missing=null,covered=null;
 if(known){const spans=recordings.map(r=>[Math.max(start,timestamp(r.started_at)),Math.min(end,timestamp(r.started_at)+r.duration_ms)]).filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let at=start;missing=0;covered=0;for(const [a,b]of spans){if(a>at){missing+=a-at}if(b>at){covered+=b-Math.max(a,at);at=b}}missing+=Math.max(0,end-at)}
 const completed=data.capture?.status==='completed',available=recordings.length>0&&recordings.every(r=>r.storage==='youtube'?Boolean(r.stream_url):r.index_available!==false);
 const storage=recordings.length&&recordings.every(r=>r.storage==='youtube')?'youtube':recordings.some(r=>r.storage==='youtube')?'mixed':'r2';
 return {status:!completed?'recording':known?(missing<=1000?'complete':'partial'):lengthsKnown&&sum<duration-15000?'partial':'unverified',storage,stream_url:available?(recordings.length===1&&storage==='youtube'?recordings[0].stream_url:origin+'/media/live/'+data.data_id+'/recording.m3u8'):null,parts:recordings.length,live_duration_ms:duration,playback_duration_ms:lengthsKnown?sum:null,covered_duration_ms:covered,missing_duration_ms:missing,minimum_missing_duration_ms:known?missing:recordings.length&&recordings.every(r=>Number.isFinite(r.duration_ms))?Math.max(0,duration-sum):null,timing_verified:known,coverage_estimated:known};
}
export async function sessionPlaylist(request,bindings,indexFor){
 const url=new URL(request.url),match=/^\/media\/live\/([a-zA-Z0-9_-]{1,160})\/recording(?:-q(144|240|360|480|720|1080))?\.m3u8$/.exec(url.pathname);if(!match)return null;if(url.search)return new Response('Invalid playlist',{status:400});if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 const row=await bindings.DB.prepare("SELECT document FROM documents WHERE database_name='liveDB' AND collection_name='livelogs' AND json_extract(document,'$.data_id')=?").bind(match[1]).first();if(!row)return new Response('Recent not found',{status:404});
 const data=JSON.parse(row.document),clips=[...(data.recordings||[])].sort((a,b)=>(a.started_at||a.run).localeCompare(b.started_at||b.run));if(!clips.length)return new Response('Recording not ready',{status:404,headers:{'Cache-Control':'no-store'}});
 const replay=(await recentYouTubeMap(bindings.DB,[match[1]],{origin:url.origin,secret:bindings.JKT48_SCRAPER_TOKEN})).get(match[1]);
 const videos=clips.map(c=>replay?.videos.find(v=>v.run===c.run&&v.bytes_uploaded===c.bytes));
 if(youtubeReplayEligible(data)&&videos.length<=32&&videos.every(v=>youtubeReady(v)&&v.hls_qualities?.length))return youtubeSessionPlaylist(request,bindings,videos,match[2]);
 if(clips.some(c=>c.storage==='youtube'))return new Response('YouTube recording is still processing',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'30'}});
 if(match[2])return new Response('YouTube playback not ready for every part',{status:409,headers:{'Cache-Control':'no-store'}});
 const sources=[];for(const clip of clips){if(clip.index_available===false)return new Response('An interrupted part is available through its MP4/player URL',{status:409});const key='live-screenshots/'+match[1]+'/video-'+clip.run+'.mp4',metadata=await bindings.IMAGES_BUCKET.head(key);if(!metadata)return new Response('Recording part unavailable',{status:503});const index=await indexFor(bindings.IMAGES_BUCKET,key,metadata);if(!index?.segments?.length)return new Response('Recording index unavailable',{status:503});sources.push({index,url:url.origin+'/media/live/'+match[1]+'/video-'+clip.run+'.mp4'})}
 const completed=data.capture?.status==='completed',target=Math.ceil(Math.max(...sources.flatMap(s=>s.index.segments.map(g=>g.duration)))),lines=['#EXTM3U','#EXT-X-VERSION:7','#EXT-X-PLAYLIST-TYPE:'+(completed?'VOD':'EVENT'),'#EXT-X-TARGETDURATION:'+target,'#EXT-X-MEDIA-SEQUENCE:0'];
 sources.forEach((source,i)=>{if(i)lines.push('#EXT-X-DISCONTINUITY');lines.push('#EXT-X-MAP:URI="'+source.url+'",BYTERANGE="'+source.index.init_length+'@0"');for(const segment of source.index.segments)lines.push('#EXTINF:'+segment.duration.toFixed(6)+',','#EXT-X-BYTERANGE:'+segment.length+'@'+segment.offset,source.url)});if(completed)lines.push('#EXT-X-ENDLIST');return new Response(request.method==='HEAD'?null:lines.join('\n')+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':completed?'public, max-age=300':'no-store'}});
}
import {recentYouTubeMap,youtubeReady,youtubeReplayEligible} from './recent-youtube.js';
import {youtubeMedia} from '../runtime/youtube-public.js';

async function youtubeSessionPlaylist(request,bindings,videos,quality){
 const url=new URL(request.url),headers={'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':'private, max-age=60','X-Media-Storage':'youtube-hls-relay'};
 const common=videos[0].hls_qualities.filter(q=>videos.every(v=>v.hls_qualities.includes(q)));
 if(!common.length)return new Response('No common YouTube playback quality',{status:409});
 if(!quality){
  const lines=['#EXTM3U','#EXT-X-VERSION:3'];
  for(const q of common)lines.push('#EXT-X-STREAM-INF:BANDWIDTH='+q*6000,url.pathname.replace('recording.m3u8','recording-q'+q+'.m3u8'));
  return new Response(request.method==='HEAD'?null:lines.join('\n')+'\n',{headers});
 }
 if(!common.includes(Number(quality)))return new Response('YouTube quality unavailable',{status:404});
 const parts=[];let target=1,count=0;
 for(const video of videos){
  const variant=new URL('q'+quality+'/index.m3u8',video.stream_url),response=await youtubeMedia(new Request(variant),bindings);
  if(!response?.ok){await response?.body?.cancel();return new Response('YouTube recording part is temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'120'}});}
  const text=await response.text();
  if(text.length>2*1024*1024||!text.startsWith('#EXTM3U')||!text.includes('#EXT-X-ENDLIST'))return new Response('YouTube part is not a complete VOD',{status:503});
  target=Math.max(target,Number(/^#EXT-X-TARGETDURATION:(\d+)$/m.exec(text)?.[1]||0));
  const lines=[];let duration=null;
  for(const line of text.split(/\r?\n/)){
   if(/^#EXTINF:\d+(?:\.\d+)?,/.test(line)){duration=line;continue;}
   if(!line||line.startsWith('#'))continue;
   if(!duration||!/^segment-\d{1,13}\.ts$/.test(line)||++count>50000)return new Response('Invalid YouTube VOD segment',{status:503});
   lines.push(duration,new URL(line,variant).href);duration=null;
  }
  if(!lines.length||duration)return new Response('Incomplete YouTube VOD playlist',{status:503});
  parts.push(lines.join('\n'));
 }
 const playlist=['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-PLAYLIST-TYPE:VOD','#EXT-X-TARGETDURATION:'+target,'#EXT-X-MEDIA-SEQUENCE:0',parts.join('\n#EXT-X-DISCONTINUITY\n'),'#EXT-X-ENDLIST'].join('\n')+'\n';
 return new Response(request.method==='HEAD'?null:playlist,{headers});
}
