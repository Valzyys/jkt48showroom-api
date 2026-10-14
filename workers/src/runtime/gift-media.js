import {runWithEnv,env} from './env.js';
import {IDNGift} from '../database/live/schema/idn/Gift.js';
import ShowroomGift from '../database/schema/showroom/ShowroomGift.js';
export function giftImageUrl(provider,id){return (env.REQUEST_ORIGIN||'https://api.jkt48connect.app')+'/media/gifts/'+provider+'/'+encodeURIComponent(String(id));}
export async function serveGiftImage(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/gifts/'))return null;
 const match=/^\/media\/gifts\/(idn|showroom)\/([a-zA-Z0-9_-]{1,160})$/.exec(url.pathname);if(!match||url.search)return new Response('Invalid gift path',{status:400});
 if(match[1]==='showroom'&&!/^\d+$/.test(match[2]))return new Response('Invalid gift ID',{status:400});
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 try{
  const [_,provider,id]=match,key='gifts/'+provider+'/'+id;let object=await bindings.IMAGES_BUCKET.get(key);
  if(!object){
   const source=await runWithEnv(bindings,null,async()=>provider==='idn'?(await IDNGift.findOne({slug:id}).lean())?.image_url:(await ShowroomGift.findOne({gift_id:Number(id)}).lean())?.image||'https://static.showroom-live.com/image/gift/'+id+'_s.png');
   if(!source)return new Response('Gift image unavailable',{status:404});const target=new URL(source);if(target.protocol!=='https:'||target.username||target.password||target.port||!(provider==='idn'?target.hostname==='cdn.idntimes.com'&&target.pathname.startsWith('/content-images/'):target.hostname==='static.showroom-live.com'&&target.pathname.startsWith('/image/gift/')))return new Response('Gift image unavailable',{status:404});
   const response=await fetch(target,{redirect:'manual',signal:AbortSignal.timeout(15000)});if(!response.ok)return new Response('Gift image unavailable',{status:response.status===404?404:502});
   const type=response.headers.get('Content-Type')?.split(';')[0];if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(type))return new Response('Invalid gift image',{status:502});
   const reader=response.body.getReader(),chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>5*1024*1024){await reader.cancel();return new Response('Image too large',{status:413})}chunks.push(r.value)}
   const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length}await bindings.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=86400'}});object=await bindings.IMAGES_BUCKET.get(key);
  }
  const headers=new Headers({'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=86400','X-Media-Storage':'r2','Content-Length':String(object.size),'X-Content-Type-Options':'nosniff',ETag:object.httpEtag});object.writeHttpMetadata(headers);return new Response(request.method==='HEAD'?null:object.body,{headers});
 }catch{return new Response('Gift image unavailable',{status:502});}
}
