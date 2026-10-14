const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors http: https:"};
export function playerResponse(request){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/replay/'))return null;
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 let body,type;
 if(url.pathname==='/replay/player.js'){
  type='text/javascript; charset=utf-8';
  body=`const video=document.querySelector('video'),status=document.querySelector('#status');
const source=video.dataset.src,show=text=>status.textContent=text;let abort,objectUrl;
video.addEventListener('loadedmetadata',()=>show('Video siap. Tekan Play untuk memutar rekaman.'));
video.addEventListener('playing',()=>show('Rekaman sedang diputar.'));
video.addEventListener('waiting',()=>show('Menunggu data video dari R2…'));
video.addEventListener('ended',()=>show('Rekaman selesai.'));
video.addEventListener('error',()=>show('Video gagal dimuat (kode '+(video.error?.code||'?')+'). Tekan Coba lagi atau unduh MP4.'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
 abort?.abort();abort=new AbortController();const signal=abort.signal;
 if(objectUrl)URL.revokeObjectURL(objectUrl);
 if(!window.MediaSource){video.src=source;return}
 const media=new MediaSource();objectUrl=URL.createObjectURL(media);video.src=objectUrl;
 try{
  await new Promise(resolve=>media.addEventListener('sourceopen',resolve,{once:true}));
  const response=await fetch(source,{signal});if(!response.ok)throw Error('media_http_'+response.status);
  const reader=response.body.getReader();let chunk=new Uint8Array(),position=0;
  async function read(n){const out=new Uint8Array(n);let at=0;while(at<n){if(position===chunk.length){const item=await reader.read();if(item.done){if(!at)return null;throw Error('media_truncated')}chunk=item.value;position=0}const take=Math.min(n-at,chunk.length-position);out.set(chunk.subarray(position,position+take),at);at+=take;position+=take}return out}
  const join=(a,b)=>{const out=new Uint8Array(a.length+b.length);out.set(a);out.set(b,a.length);return out};
  let init=new Uint8Array(),buffer,pending;
  const append=bytes=>new Promise((resolve,reject)=>{const clean=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',failed)};const done=()=>{clean();resolve()},failed=()=>{clean();reject(Error('media_append_failed'))};buffer.addEventListener('updateend',done);buffer.addEventListener('error',failed);buffer.appendBuffer(bytes)});
  while(!signal.aborted){
   const head=await read(8);if(!head)break;const size=new DataView(head.buffer).getUint32(0),kind=String.fromCharCode(...head.subarray(4));if(size<8||size>33554432)throw Error('media_box_invalid');const body=await read(size-8);if(!body)throw Error('media_truncated');const box=join(head,body);
   if(kind==='ftyp')init=box;
   else if(kind==='moov'){
    let codec;for(let i=0;i<box.length-8;i++)if(String.fromCharCode(...box.subarray(i,i+4))==='avcC'){codec='avc1.'+Array.from(box.subarray(i+5,i+8),b=>b.toString(16).padStart(2,'0')).join('');break}
    if(!codec)throw Error('media_codec_missing');const audio=String.fromCharCode(...box).includes('mp4a');const mime='video/mp4; codecs="'+codec+(audio?',mp4a.40.2':'')+'"';
    if(!MediaSource.isTypeSupported(mime)){await reader.cancel();video.src=source;return}
    buffer=media.addSourceBuffer(mime);await append(join(init,box));for(let i=0;i<box.length-32;i++)if(String.fromCharCode(...box.subarray(i,i+4))==='mvhd'){const v=new DataView(box.buffer),version=box[i+4],scale=v.getUint32(i+(version===1?24:16)),duration=version===1?Number(v.getBigUint64(i+28)):v.getUint32(i+20);if(scale&&duration)media.duration=duration/scale;break}
   }else if(kind==='moof')pending=box;
   else if(kind==='mdat'&&pending&&buffer){
    while(buffer.buffered.length&&buffer.buffered.end(buffer.buffered.length-1)-video.currentTime>45&&!signal.aborted)await sleep(250);
    if(signal.aborted)break;
    if(video.currentTime>120&&buffer.buffered.length&&buffer.buffered.start(0)<video.currentTime-90){await new Promise(resolve=>{buffer.addEventListener('updateend',resolve,{once:true});buffer.remove(0,video.currentTime-60)})}
    await append(join(pending,box));pending=null;
   }
  }if(!signal.aborted&&media.readyState==='open')media.endOfStream();
 }catch(error){if(!signal.aborted)show('Pemutaran terputus. Tekan Coba lagi untuk menghubungkan ulang.');}
}
document.querySelector('#retry').onclick=()=>{show('Memuat ulang rekaman…');start();video.play().catch(()=>show('Tekan Play untuk memutar rekaman.'));};
start();
setTimeout(()=>{if(!video.readyState&&!video.error)show('Video masih dimuat. Jika terlalu lama, tekan Coba lagi atau unduh MP4.');},15000);`;
 }else if(url.pathname==='/replay/player.css'){
  type='text/css; charset=utf-8';body='body{margin:0;background:#10161c;color:#eef3f7;font:15px/1.6 system-ui}main{max-width:1000px;margin:40px auto;padding:24px}h1{font-size:24px}video{display:block;width:100%;max-height:70vh;background:#000}a{color:#9dd4ff}button{padding:10px 18px;border:0;border-radius:6px;cursor:pointer}nav{display:flex;gap:18px;align-items:center;flex-wrap:wrap}#status{min-height:24px;color:#bbcbd7}small{overflow-wrap:anywhere;color:#bbcbd7}';
 }else{
  const match=/^\/replay\/([a-zA-Z0-9_-]{1,160})\/(\d{1,13})$/.exec(url.pathname);
  if(!match||url.search)return new Response('Replay tidak ditemukan',{status:404,headers});
  type='text/html; charset=utf-8';const source='/media/live/'+match[1]+'/video-'+match[2]+'.mp4?v=2';
  body=`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Replay · JKT48 Connect</title><link rel="stylesheet" href="/replay/player.css"><script defer src="/replay/player.js"></script><main><h1>Replay JKT48 Connect</h1><video controls playsinline preload="metadata" data-src="${source}"></video><p id="status" role="status">Memuat rekaman dari R2…</p><nav><button id="retry">Coba lagi</button><a href="${source}" download>Unduh MP4</a><a href="/control/admin">Kembali ke admin</a></nav><p><small>${match[1]}</small></p></main></html>`;
 }
 return new Response(request.method==='HEAD'?null:body,{headers:{...headers,'Content-Type':type}});
}
