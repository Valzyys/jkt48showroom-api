import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const maxInput = 6 * 1024 * 1024;
const maxImage = 2 * 1024 * 1024;
const hashPattern = /^[a-f0-9]{64}$/;
const noCache = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const fail = (status, message) => Object.assign(new Error(message), {status});

function digest(bytes) {
 return createHash('sha256').update(bytes).digest('hex');
}

function imageType(bytes) {
 if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'mjpeg';
 if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
 if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'webp';
 return null;
}

function parseManifest(text) {
 const data=JSON.parse(text);
 if (data?.hash===null && data.updatedAt===null) return null;
 if (data?.hash === null && typeof data.updatedAt==='string' && Number.isFinite(Date.parse(data.updatedAt))) return {hash:null,updatedAt:data.updatedAt};
 if (typeof data?.hash !== 'string' || !hashPattern.test(data.hash) ||
  typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error('Invalid manifest');
 return {hash:data.hash,updatedAt:data.updatedAt};
}

async function readUpload(request) {
 if (Number(request.headers.get('Content-Length')) > maxInput) throw fail(413,'Gambar maksimal 6 MB.');
 if (!['image/jpeg','image/png','image/webp'].includes(request.headers.get('Content-Type'))) throw fail(415,'Gunakan JPG, PNG, atau WebP.');
 if (!request.body) throw fail(400,'Pilih gambar.');
 const reader=request.body.getReader();
 let size=0;
 const chunks=[];
 try {
  while (true) {
   const {done,value}=await reader.read();
   if (done) break;
   size+=value.byteLength;
   if (size>maxInput) { await reader.cancel(); throw fail(413,'Gambar maksimal 6 MB.'); }
   chunks.push(value);
  }
 } finally {reader.releaseLock();}
 const bytes=Buffer.concat(chunks,size);
 if (!imageType(bytes)) throw fail(415,'Format gambar tidak valid.');
 return bytes;
}

// Register the returned handler as the private RECOVERY_HIKARI_BANNER Miniflare service binding.
// Keep the writable rclone config outside the repository in service-owned state with mode 0600.
export function createHikariBannerStorage({directory,rclone,config,remote,origin,ffmpeg='/usr/bin/ffmpeg'}) {
 let current;
 let initial;
 let mutation=Promise.resolve();
 const manifest=join(directory,'current.json');
 const picture=hash=>join(directory,hash+'.webp');

 function drive(args) {
  return execute(rclone,['--config',config,'--contimeout','8s','--timeout','20s','--retries','1','--low-level-retries','1',...args],
   {timeout:35000,maxBuffer:262144});
 }

 function serialized(action) {
  const pending=mutation.then(action);
  mutation=pending.catch(()=>{});
  return pending;
 }

 async function publishLocal(stage, data) {
  if (data?.hash) await rename(join(stage,data.hash+'.webp'),picture(data.hash));
  const path=join(stage,'current.json');
  await writeFile(path,JSON.stringify(data??{hash:null,updatedAt:null}),{mode:0o600});
  await rename(path,manifest);
  current=data;
  // A reader may still have an old file open. Removing it only limits the disposable local cache.
  for (const name of await readdir(directory)) {
   if (/^[a-f0-9]{64}\.webp$/.test(name) && name!==data?.hash+'.webp') await rm(join(directory,name),{force:true});
  }
 }

 async function restore() {
  await mkdir(directory,{recursive:true,mode:0o700});
  try {
   const data=parseManifest(await readFile(manifest,'utf8'));
   if (data?.hash && digest(await readFile(picture(data.hash)))!==data.hash) throw new Error('Invalid local image');
   current=data;
   return;
  } catch {}
  const stage=await mkdtemp(join(directory,'.restore-'));
  try {
   const {stdout}=await drive(['lsjson',remote,'--files-only','--include','/current.json']);
   if (!JSON.parse(stdout).some(entry=>entry.Name==='current.json')) {
    await publishLocal(stage,null);
    return;
   }
   const path=join(stage,'current.json');
   await drive(['copyto',remote+'/current.json',path]);
   const data=parseManifest(await readFile(path,'utf8'));
   if (data?.hash) {
    const image=join(stage,data.hash+'.webp');
    await drive(['copyto',remote+'/'+data.hash+'.webp',image]);
    const bytes=await readFile(image);
    if (bytes.length>maxImage || imageType(bytes)!=='webp' || digest(bytes)!==data.hash) throw new Error('Invalid Drive image');
   }
   await publishLocal(stage,data);
  } finally {await rm(stage,{recursive:true,force:true});}
 }

 async function banner() {
  if (current===undefined) {
   initial??=restore().finally(()=>{initial=undefined;});
   await initial;
  }
  return current;
 }

 async function publicBanner() {
  if (current!==undefined) return current;
  let timer;
  try {
   return await Promise.race([
    banner(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail(503,'Banner sedang dimuat.')),2000);}),
   ]);
  } finally {clearTimeout(timer);}
 }

 function metadata(data) {
  return {configured:Boolean(data),image:data?.hash?origin+'/hikari/profile-banner/media/'+data.hash+'.webp':null,updatedAt:data?.updatedAt??null};
 }

 async function writeDrive(stage, data) {
  if (data.hash) await drive(['copyto',join(stage,data.hash+'.webp'),remote+'/'+data.hash+'.webp']);
  const path=join(stage,'current.json');
  await writeFile(path,JSON.stringify(data),{mode:0o600});
  await drive(['copyto',path,remote+'/current.json','--ignore-times']);
  try {await publishLocal(stage,data);}
  catch {current=undefined;throw new Error('Local banner cache failed');}
 }

 async function save(bytes) {
  await banner();
  const stage=await mkdtemp(join(directory,'.upload-'));
  try {
   const source=join(stage,'source');
   const normalized=join(stage,'image.webp');
   await writeFile(source,bytes,{mode:0o600});
   try {
    await execute(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-max_alloc','67108864',
     '-protocol_whitelist','file,pipe','-f','image2','-c:v',imageType(bytes),'-threads','1','-i',source,
     '-frames:v','1','-vf',"scale=w='min(1280,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease",
     '-map_metadata','-1','-threads','1','-c:v','libwebp','-quality','85',normalized],{timeout:12000,maxBuffer:65536});
   } catch {throw fail(415,'Gambar tidak dapat dibaca. Pilih JPG, PNG, atau WebP.');}
   const result=await readFile(normalized);
   if (result.length>maxImage || imageType(result)!=='webp') throw fail(413,'Gambar hasil olahan terlalu besar.');
   const data={hash:digest(result),updatedAt:new Date().toISOString()};
   await rename(normalized,join(stage,data.hash+'.webp'));
   await writeDrive(stage,data);
   return metadata(data);
  } finally {await rm(stage,{recursive:true,force:true});}
 }

 async function clear() {
  await banner();
  const stage=await mkdtemp(join(directory,'.clear-'));
  const data={hash:null,updatedAt:new Date().toISOString()};
  try {await writeDrive(stage,data);return metadata(data);}
  finally {await rm(stage,{recursive:true,force:true});}
 }

 return async function respond(request) {
  const url=new URL(request.url);
  const media=/^\/media\/([a-f0-9]{64})\.webp$/.exec(url.pathname);
  if (url.origin!=='https://hikari-banner.internal' || url.search) return new Response(null,{status:404,headers:noCache});
  try {
   if (url.pathname==='/profile' && request.method==='GET') return Response.json(metadata(await publicBanner()),{headers:noCache});
   if (url.pathname==='/manage' && request.method==='GET') return Response.json(metadata(await banner()),{headers:noCache});
   if (url.pathname==='/manage' && request.method==='PUT') {
    const bytes=await readUpload(request);
    return Response.json(await serialized(()=>save(bytes)),{headers:noCache});
   }
   if (url.pathname==='/manage' && request.method==='DELETE') return Response.json(await serialized(clear),{headers:noCache});
   if (media && ['GET','HEAD'].includes(request.method)) {
    const data=await publicBanner();
    if (data?.hash!==media[1]) return new Response(null,{status:404,headers:noCache});
    const body=await readFile(picture(data.hash));
    const headers={'Content-Type':'image/webp','Content-Length':String(body.length),'Cache-Control':'public, max-age=86400, immutable',
     'X-Content-Type-Options':'nosniff','ETag':'"'+data.hash+'"'};
    if (request.headers.get('If-None-Match')===headers.ETag) return new Response(null,{status:304,headers});
    return new Response(request.method==='HEAD'?null:body,{headers});
   }
   return new Response(null,{status:404,headers:noCache});
  } catch (error) {
   if (!error.status) console.error('Hikari banner storage failed:',error.name);
   return Response.json({message:error.status?error.message:'Penyimpanan banner Google Drive sedang tidak tersedia.'},
    {status:error.status||503,headers:noCache});
  }
 };
}
