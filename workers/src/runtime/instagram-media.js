// Fixed archive namespace only; no arbitrary origin fetch or object key parameter.
const pattern=/^\/(media\/instagram|internal\/instagram-media)\/([a-z0-9-]{1,100})\/(\d{15,22})\/(thumbnail|video|(?:image|video)-\d{1,2})$/;
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}})}
function equal(a,b){if(a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0}
export async function instagramMedia(request,bindings){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/media/instagram/')&&!url.pathname.startsWith('/internal/instagram-media/'))return null;
 const match=pattern.exec(url.pathname);if(!match||url.search)return json({message:'Invalid media path'},400);
 const [,scope,member,id,kind]=match,key='instagram/'+member+'/'+id+'/'+kind;
 if(scope==='internal/instagram-media'){
  if(!bindings.INSTAGRAM_FEED_TOKEN||!equal(request.headers.get('Authorization')||'','Bearer '+bindings.INSTAGRAM_FEED_TOKEN))return json({message:'Unauthorized'},401);
  if(request.method!=='PUT')return json({message:'Method not allowed'},405);
  const size=Number(request.headers.get('Content-Length')),limit=kind.startsWith('video')?64*1024*1024:8*1024*1024;
  if(!Number.isSafeInteger(size)||size<=0)return json({message:'Content-Length required'},411);
  if(size>limit)return json({message:'Media too large'},413);
  const type=request.headers.get('Content-Type')?.split(';')[0];
  if(!(kind.startsWith('video')?type==='video/mp4':['image/jpeg','image/png','image/webp'].includes(type)))return json({message:'Unsupported media'},415);
  const publicUrl=url.origin+'/media/instagram/'+member+'/'+id+'/'+kind;
  const existing=await bindings.IMAGES_BUCKET.head(key);
  if(existing){await request.body?.cancel();return json({ok:true,url:publicUrl,bytes:existing.size})}
  const bytes=await request.arrayBuffer();if(bytes.byteLength!==size||size>limit)return json({message:'Invalid media size'},413);
  const signature=new Uint8Array(bytes,0,Math.min(bytes.byteLength,32));
  const valid=type==='video/mp4'?new TextDecoder().decode(signature).includes('ftyp'):type==='image/jpeg'?signature[0]===255&&signature[1]===216&&signature[2]===255:type==='image/png'?signature.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':new TextDecoder().decode(signature.slice(0,4))==='RIFF'&&new TextDecoder().decode(signature.slice(8,12))==='WEBP';
  if(!valid)return json({message:'Invalid media signature'},415);
  await bindings.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:type,cacheControl:'public, max-age=31536000, immutable'},customMetadata:{source:'instagram-public',member,post_id:id}});
  return json({ok:true,url:publicUrl,bytes:size});
 }
 if(!['GET','HEAD','OPTIONS'].includes(request.method))return json({message:'Method not allowed'},405);
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'Range,If-Range,If-None-Match','Access-Control-Expose-Headers':'Content-Range,Accept-Ranges,Content-Length'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const meta=await bindings.IMAGES_BUCKET.head(key);if(!meta)return json({message:'Media not archived yet'},404);
 const headers=new Headers({...cors,'Content-Type':meta.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'public, max-age=31536000, immutable','X-Media-Storage':'r2','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','ETag':meta.httpEtag});
 if(request.headers.get('If-None-Match')===meta.httpEtag)return new Response(null,{status:304,headers});
 let offset=0,length=meta.size,status=200;const raw=request.headers.get('Range');
 if(raw&&(!request.headers.get('If-Range')||request.headers.get('If-Range')===meta.httpEtag)){
  const r=/^bytes=(\d*)-(\d*)$/.exec(raw);
  if(!r||(!r[1]&&!r[2]))return new Response(null,{status:416,headers:{...cors,'Content-Range':'bytes */'+meta.size}});
  if(r[1]){offset=Number(r[1]);length=(r[2]?Math.min(Number(r[2]),meta.size-1):meta.size-1)-offset+1}
  else{length=Math.min(Number(r[2]),meta.size);offset=meta.size-length}
  if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||offset>=meta.size||length<=0)return new Response(null,{status:416,headers:{...cors,'Content-Range':'bytes */'+meta.size}});
  status=206;headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${meta.size}`);
 }
 headers.set('Content-Length',String(length));
 if(request.method==='HEAD')return new Response(null,{status,headers});
 const object=await bindings.IMAGES_BUCKET.get(key,status===206?{range:{offset,length}}:undefined);
 if(!object)return json({message:'Media unavailable'},404);
 return new Response(object.body,{status,headers});
}
