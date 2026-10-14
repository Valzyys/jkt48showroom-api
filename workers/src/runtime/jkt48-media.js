const PREFIX = '/media/jkt48/';
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = new Set(['image/jpeg','image/png','image/webp','image/gif','image/avif']);
export function storagePath(value) {
  if (typeof value !== 'string') return null;
  let path = value;
  if (value.startsWith('https://')) {
    let url;try {url=new URL(value);}catch{return null;}
    if(url.hostname!=='jkt48.com' || url.username || url.password || url.port || url.search || url.hash || !url.pathname.startsWith('/api/v1/storages/')) return null;
    path=url.pathname.slice('/api/v1/storages/'.length);
  }
  try {path=decodeURIComponent(path);}catch{return null;}
  if(!/^media\/[A-Za-z0-9_./-]+\.(?:jpe?g|png|webp|gif|avif)$/i.test(path) || path.split('/').some(part=>!part || part==='.' || part==='..')) return null;
  return path;
}
export function rewriteMedia(value, origin) {
  if(typeof value==='string') {
    if(value.startsWith('https://apitest.jkt48connect.com/')){const old=new URL(value);return origin+old.pathname+old.search+old.hash;}
    const path=storagePath(value);
    return path ? origin+PREFIX+path.split('/').map(encodeURIComponent).join('/') : value;
  }
  if(Array.isArray(value))return value.map(item=>rewriteMedia(item,origin));
  if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewriteMedia(item,origin)]));
  return value;
}
export async function rewriteMediaResponse(response, request) {
  if(!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))return response;
  const value=await response.json();
  const headers=new Headers(response.headers);headers.delete('Content-Length');headers.delete('ETag');headers.delete('Content-Encoding');
  return new Response(JSON.stringify(rewriteMedia(value,new URL(request.url).origin)),{status:response.status,statusText:response.statusText,headers});
}
function failure(message,status=502) {return Object.assign(new Error(message),{status});}
async function download(path, bindings) {
  let base;
  try {base=new URL(bindings.JKT48_SCRAPER_URL);}catch{throw failure('Private image scraper is not configured',503);}
  const token=String(bindings.JKT48_SCRAPER_TOKEN||'');
  if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || !/^[\x21-\x7e]{32,256}$/.test(token))throw failure('Private image scraper is not configured',503);
  const url=new URL('/images/'+path.split('/').map(encodeURIComponent).join('/'),base);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();throw failure('Image source unavailable',response.status===404?404:response.status===429?429:502);}
  const type=response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if(!TYPES.has(type)){await response.body?.cancel();throw failure('Invalid image content type');}
  const reader=response.body.getReader(),chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>MAX_BYTES){await reader.cancel();throw failure('Image exceeds 8 MB',413);}chunks.push(value);}
  if(!length)throw failure('Empty image');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return {bytes,type};
}
export async function serveMedia(request,bindings) {
  const url=new URL(request.url);
  if(!url.pathname.startsWith(PREFIX))return null;
  if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{Allow:'GET, HEAD'}});
  const path=storagePath(url.pathname.slice(PREFIX.length));
  if(!path || url.search)return Response.json({status:400,message:'Invalid JKT48 image path'},{status:400,headers:{'Cache-Control':'no-store'}});
  try {
    if(!bindings.IMAGES_BUCKET)throw failure('Image storage is not configured',503);
    const key='jkt48-origin/'+path;
    let object=await bindings.IMAGES_BUCKET.get(key);
    if(!object){
      const {bytes,type}=await download(path,bindings);
      await bindings.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=86400'},customMetadata:{source:'jkt48.com',storagePath:path}});
      object=await bindings.IMAGES_BUCKET.get(key);
    }
    if(!object)throw failure('Image storage failed');
    const headers=new Headers({'Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*','ETag':object.httpEtag,'X-Media-Storage':'r2'});
    object.writeHttpMetadata(headers);
    if(!TYPES.has(headers.get('Content-Type')))throw failure('Invalid stored image content type');
    if(request.headers.get('If-None-Match')===object.httpEtag)return new Response(null,{status:304,headers});
    headers.set('Content-Length',String(object.size));
    return new Response(request.method==='HEAD'?null:object.body,{headers});
  }catch(error){const status=error.status||502;return Response.json({status,message:error.status?error.message:'Image download failed'},{status,headers:{'Cache-Control':'no-store',...(status===429?{'Retry-After':'60'}:{})}});}
}
