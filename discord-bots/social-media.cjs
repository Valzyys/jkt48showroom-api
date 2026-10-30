/** Shared bounded media preparation. Downloads never use arbitrary URLs or source accounts. */
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const exec=promisify(execFile),MiB=1024*1024,BUDGET=20*MiB;
const feeds=()=>({x:require('./x-notifications.cjs'),tiktok:require('./tiktok-notifications.cjs'),instagram:require('./instagram-notifications.cjs')});
function valid(kind,post){const f=feeds()[kind];return Boolean(f&&(kind==='x'?f.validTweet(post):f.validPost(post)))}
function descriptors(kind,p){
 if(!valid(kind,p))throw Error('invalid_social_post');
 const files=[];let pending=false;
 const add=(url,type,key)=>{if(url&&!files.some(f=>f.url===url))files.push({url,type,key})};
 if(kind==='x'){
  for(const [i,m]of(p.media||[]).entries()){
   if(['video','animated_gif'].includes(m.type)){
    const v=(m.variants||[]).filter(v=>v.content_type==='video/mp4'&&feeds().x.videoUrl(v.url)).sort((a,b)=>(a.bitrate||0)-(b.bitrate||0));
    const best=v.find(v=>v.bitrate>=256000)||v[0];if(best)add(best.url,'video','video-'+i);
   }else if(m.type==='photo'){try{const u=new URL(m.url);if(u.protocol==='https:'&&u.hostname==='pbs.twimg.com'&&!u.port&&!u.username&&!u.password)add(u.href,'image','image-'+i)}catch{}}
  }
 }else{
  const f=feeds()[kind];
  const asset=(a,type,key)=>{
   if(!a)return;
   const url=f.mediaUrl(a.url);
   if(a.status==='ready'&&url&&new URL(url).pathname.split('/')[4]===p.id)add(url,type,key);
   else if(a.status!=='unsupported')pending=true;
  };
  asset(p.media?.video,'video','video');
  if(p.media?.type==='video'&&!p.media.video)pending=true;
  for(const[i,item]of(p.media?.items||[]).entries()){
   asset(item.video,'video','video-'+i);
   if(item.type==='video'&&!item.video)pending=true;
  }
  if(kind==='instagram'&&p.media?.detail_status==='pending')pending=true;
  const images=p.media?.images||[];
  images.forEach((a,i)=>asset(a,'image','image-'+i));
  if(!images.length&&!files.some(f=>f.type==='video'))asset(p.media?.thumbnail,'image','thumbnail');
  if(!files.length&&['post','video','carousel','photo'].includes(p.media?.type))pending=true;
 }
 // Video first; Discord supports up to ten attachments in one message.
 return {files:files.sort((a,b)=>(a.type==='video'?0:1)-(b.type==='video'?0:1)).slice(0,10),pending};
}
async function compressVideo(bytes,target){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jkc-discord-video-'));
 try{
  const input=path.join(folder,'source.mp4'),output=path.join(folder,'discord.mp4');await fs.writeFile(input,bytes,{mode:0o600});
  const {stdout}=await exec('/usr/bin/ffprobe',['-v','error','-show_entries','format=duration','-of','json',input],{timeout:10000,maxBuffer:65536});
  const duration=Number(JSON.parse(stdout).format?.duration);if(!(duration>0&&duration<=7200))throw Error('invalid_video_duration');
  const total=Math.floor(target*8/duration*.82),audio=48000,video=total-audio;if(video<40000)throw Error('video_exceeds_budget');
  await exec('/usr/bin/nice',['-n','10','/usr/bin/ffmpeg','-nostdin','-v','error','-threads','1','-filter_threads','1','-i',input,'-map','0:v:0','-map','0:a?','-vf','scale=trunc(min(960\\,iw)/2)*2:-2','-c:v','libx264','-threads','1','-preset','veryfast','-b:v',String(video),'-maxrate',String(video),'-bufsize',String(video*2),'-pix_fmt','yuv420p','-c:a','aac','-b:a',String(audio),'-movflags','+faststart',output],{timeout:180000,maxBuffer:65536});
  const result=await fs.readFile(output);if(result.length>target)throw Error('video_exceeds_budget');return result;
 }finally{await fs.rm(folder,{recursive:true,force:true})}
}
class MediaAssets{
 constructor(api,{fetcher=fetch,transcode=compressVideo,now=Date.now}={}){this.api=api;this.fetcher=fetcher;this.transcode=transcode;this.now=now;this.cache=new Map();this.downloads=new Map();this.inflight=new Map();this.tail=Promise.resolve()}
 async get(kind,post){
  if(!valid(kind,post))throw Error('invalid_social_post');const key=kind+':'+post.id,old=this.cache.get(key);
  if(old&&old.until>this.now())return old.value;if(this.inflight.has(key))return this.inflight.get(key);
  const task=this.tail.then(()=>this.prepare(kind,post)).then(value=>{
   for(const[k,v]of this.cache)if(v.until<=this.now())this.cache.delete(k);while(this.cache.size>=2)this.cache.delete(this.cache.keys().next().value);
   this.cache.set(key,{value,until:this.now()+(value.pending?5000:120000)});return value;
  });
  this.tail=task.catch(()=>{});this.inflight.set(key,task);try{return await task}finally{this.inflight.delete(key)}
 }
 async download(item,target){
  const cacheKey=item.url+'|'+target,cached=this.downloads.get(cacheKey);if(cached&&cached.until>this.now())return cached.value;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000),max=item.type==='video'?64*MiB:8*MiB;
  try{
   const r=await this.fetcher(item.url,{signal:controller.signal,redirect:'error'});
   if(!r.ok){await r.body?.cancel();throw Error('media_http_'+r.status)}
   const type=r.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
   if(item.type==='video'?!['video/mp4','application/octet-stream'].includes(type):!['image/jpeg','image/png','image/webp'].includes(type)){await r.body?.cancel();throw Error('invalid_media_type')}
   if(Number(r.headers.get('content-length'))>max){await r.body?.cancel();throw Error('media_too_large')}
   const chunks=[],reader=r.body.getReader();let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('media_too_large')}chunks.push(Buffer.from(value))}
   let bytes=Buffer.concat(chunks,size),extension;
   if(item.type==='video'){if(bytes.subarray(4,8).toString()!=='ftyp')throw Error('invalid_video_signature');extension='mp4';if(size>target)bytes=await this.transcode(bytes,target)}
   else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)extension='jpg';
   else if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))extension='png';
   else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')extension='webp';
   else throw Error('invalid_image_signature');
   if(bytes.length>target)throw Error('media_exceeds_budget');
   for(const[k,v]of this.downloads)if(v.until<=this.now())this.downloads.delete(k);
   let total=[...this.downloads.values()].reduce((n,v)=>n+v.value.bytes.length,0);
   while(this.downloads.size&&(this.downloads.size>=20||total+bytes.length>40*MiB)){const first=this.downloads.keys().next().value;total-=this.downloads.get(first).value.bytes.length;this.downloads.delete(first)}
   const value={bytes,extension};this.downloads.set(cacheKey,{value,until:this.now()+180000});return value;
  }finally{clearTimeout(timer)}
 }
 async prepare(kind,post){
  if(kind!=='x'){
   const result=await this.api.get('/api/'+kind+'/posts/'+post.id,5000);
   if(!valid(kind,result?.post)||result.post.id!==post.id||result.post.author.username.toLowerCase()!==post.author.username.toLowerCase())throw Error('media_post_mismatch');post=result.post;
  }
  const wanted=descriptors(kind,post),files=[],errors=[];let pending=wanted.pending,remaining=BUDGET;
  const allowance=Math.min(9*MiB,Math.floor(BUDGET/Math.max(1,wanted.files.length)));
  for(const item of wanted.files){
   try{const {bytes,extension}=await this.download(item,Math.min(allowance,remaining));files.push({attachment:bytes,name:kind+'-'+post.id+'-'+item.key+'.'+extension});remaining-=bytes.length}
   catch(error){const code=/^(?:media_http_\d+|media_too_large|invalid_\w+|media_exceeds_budget|video_exceeds_budget)$/.test(error.message)?error.message:'media_download_failed';errors.push(code);if(!['media_too_large','media_exceeds_budget','video_exceeds_budget','invalid_media_type','invalid_video_signature','invalid_image_signature'].includes(code))pending=true}
  }
  return {post,files,pending,errors};
 }
}
function presentation(kind,prepared,config={}){
 const f=feeds()[kind],payload=kind==='x'?f.tweetMessage(prepared.post,config):f.postMessage(prepared.post,config);
 if(prepared.files.length){delete payload.embeds[0].image;payload.embeds=payload.embeds.filter((e,i)=>i===0||!e.image)}
 return payload;
}
module.exports={MediaAssets,descriptors,compressVideo,presentation,valid,BUDGET};
