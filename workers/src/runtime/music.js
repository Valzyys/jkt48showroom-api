import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';

const ID=/^[A-Za-z0-9_-]{11}$/;
const PREFIX='/api/music';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'X-API-Key,Range','Access-Control-Expose-Headers':'Content-Range,Accept-Ranges,Content-Length','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const json=(message,status,path)=>Response.json({status,message,path},{status,headers:CORS});
function relay(bindings,resource){
 const value=String(bindings.JKT48_SCRAPER_URL||'');
 if(!value||!bindings.JKT48_SCRAPER_TOKEN)throw Object.assign(Error('Relay musik belum dikonfigurasi.'),{status:503});
 const base=new URL(value.endsWith('/')?value:value+'/');
 if(base.protocol!=='https:'||base.username||base.password)throw Object.assign(Error('Konfigurasi relay musik tidak valid.'),{status:503});
 return new URL('music/'+resource,base);
}
export function musicSignature(id,ext,expires,secret){
 return `${expires}.`+createHmac('sha256',secret).update(`music-audio-v1:${id}:${ext}:${expires}`).digest('base64url');
}
export async function musicAPI(request,bindings){
 const url=new URL(request.url),path=url.pathname;
 if(path!==PREFIX&&!path.startsWith(PREFIX+'/'))return null;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(request.method!=='GET')return json('Method not allowed',405,path);
 let resource,allowed;
 if(path===PREFIX||path===PREFIX+'/search'){resource='search';allowed=['q','mode'];}
 else {
  const m=/^\/api\/music\/([A-Za-z0-9_-]{11})(\/lyrics)?$/.exec(path);
  if(!m)return json('Endpoint musik tidak ditemukan.',404,path);
  resource=m[1]+(m[2]||'');allowed=m[2]?['track','artist']:[];
 }
 const seen=new Set();
 for(const [key] of url.searchParams){if(!allowed.includes(key)||seen.has(key))return json('Parameter musik tidak didukung atau berulang.',400,path);seen.add(key);}
 if(resource==='search'&&(!(url.searchParams.get('q')||'').trim()||(url.searchParams.get('q')||'').length>240))return json('Isi q dengan judul, artis, potongan lirik, atau tautan Spotify.',400,path);
 try{
  const target=relay(bindings,resource);target.search=url.search;
  const response=await fetch(target,{headers:{Authorization:'Bearer '+bindings.JKT48_SCRAPER_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(55000)});
  let data;try{data=await response.json();}catch{return json('Respons relay musik tidak valid.',502,path);}
  if(!response.ok){const status=[400,403,404,410,416,429,503,504].includes(response.status)?response.status:response.status===422?400:502;return json(typeof data.detail==='string'?data.detail:typeof data.message==='string'?data.message:'Sumber musik sementara tidak tersedia.',status,path);}
  return Response.json(data,{headers:CORS});
 }catch(error){return json(error.status===503?error.message:'Relay musik sementara tidak tersedia.',error.status===503?503:502,path);}
}
export async function musicMedia(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/music/'))return null;
 const m=/^\/media\/music\/([A-Za-z0-9_-]{11})\/(\d{10}\.[A-Za-z0-9_-]{43})\/audio\.(m4a|webm)$/.exec(url.pathname);
 if(!m||url.search)return json('URL audio tidak valid.',400,url.pathname);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
 if(!['GET','HEAD'].includes(request.method))return json('Method not allowed',405,url.pathname);
 const expires=Number(m[2].split('.')[0]),now=Date.now()/1000;
 if(expires<=now)return json('URL audio kedaluwarsa. Ambil detail lagu kembali.',410,url.pathname);
 if(!bindings.JKT48_SCRAPER_TOKEN||expires>now+1860)return json('Tanda tangan audio tidak valid.',403,url.pathname);
 const expected=musicSignature(m[1],m[3],expires,bindings.JKT48_SCRAPER_TOKEN);
 if(!timingSafeEqual(Buffer.from(expected),Buffer.from(m[2])))return json('Tanda tangan audio tidak valid.',403,url.pathname);
 const range=request.headers.get('Range');if(range&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return json('Hanya satu HTTP byte range yang didukung.',416,url.pathname);
 try{
  const headers={Authorization:'Bearer '+bindings.JKT48_SCRAPER_TOKEN};if(range)headers.Range=range;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
  let response;
  try{response=await fetch(relay(bindings,`media/${m[1]}/${m[2]}/audio.${m[3]}`),{method:request.method,headers,redirect:'manual',signal:controller.signal});}finally{clearTimeout(timeout);}
  if(response.status===416){const h=new Headers(CORS);if(response.headers.has('Content-Range'))h.set('Content-Range',response.headers.get('Content-Range'));await response.body?.cancel();return new Response(null,{status:416,headers:h});}
  if(![200,206].includes(response.status)){await response.body?.cancel();return json('Audio sementara tidak tersedia. Ambil detail lagu kembali.',[400,403,404,410,429,503,504].includes(response.status)?response.status:502,url.pathname);}
  const expectedMime=m[3]==='m4a'?'audio/mp4':'audio/webm';
  if(!response.headers.get('Content-Type')?.startsWith(expectedMime)){await response.body?.cancel();return json('Relay tidak memberikan audio-only yang valid.',502,url.pathname);}
  const h=new Headers(CORS);for(const key of ['Content-Type','Content-Length','Content-Range','Accept-Ranges','X-Media-Storage'])if(response.headers.has(key))h.set(key,response.headers.get(key));
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers:h});
 }catch{return json('Relay audio sementara tidak tersedia.',502,url.pathname);}
}

export const musicRoutes=[
 {method:'GET',path:'/api/music/search',description:'Cari audio lintas artis dari judul, artis, potongan lirik, atau URL track Spotify. Audio berasal dari sumber publik YouTube.',group:'Publik',auth:'API key JKT48Connect',query:{q:'Kueri pencarian (2–240 karakter)',mode:'auto, title, atau lyrics'},examplePath:'/api/music/search?q=Adele%20Hello',tryEnabled:true},
 {method:'GET',path:'/api/music/:id',description:'Resolve lagu penuh ke audio M4A/AAC atau WebM/Opus tanpa track video. URL siap hanya diberikan sesudah byte audio diverifikasi.',group:'Publik',auth:'API key JKT48Connect',query:{},examplePath:'/api/music/hLQl3WQQoQ0',tryEnabled:true},
 {method:'GET',path:'/api/music/:id/lyrics',description:'Lirik LRC terstruktur dengan timestamp detik dan peringatan perbedaan versi audio.',group:'Publik',auth:'API key JKT48Connect',query:{track:'Opsional: koreksi judul',artist:'Opsional: koreksi artis'},examplePath:'/api/music/hLQl3WQQoQ0/lyrics',tryEnabled:true}
];
export function musicDocumentation(request){
 const path=new URL(request.url).pathname;if(path!=='/docs/music.md')return null;
 return new Response(`# Music API — audio-only\n\nSemua artis/genre didukung sebagai kueri pencarian, sesuai ketersediaan sumber. Kirim X-API-Key seperti endpoint JKT48Connect lain. Pengguna tidak perlu akun Spotify/YouTube.\n\n1. GET /api/music/search?q=judul&mode=auto\n2. GET /api/music/ID untuk mendapatkan audio.url bertanda tangan (berlaku 30 menit).\n3. GET /api/music/ID/lyrics untuk baris {time,text}.\n\nGunakan elemen HTML <audio controls src="AUDIO_URL">. M4A memakai MIME audio/mp4, tanpa video. Range/seek didukung; URL media tidak memerlukan header API key karena sudah ditandatangani. API pencarian/detail/lirik tetap memerlukan API key.\n\nSinkronisasi: pada event timeupdate, pilih baris terakhir dengan time <= audio.currentTime + offsetSeconds. Saat seek/pause, gunakan posisi elemen audio yang sama. Timestamp per baris, bukan per kata. Versi MV/live bisa memiliki intro berbeda; periksa alignment/duration_difference_seconds dan sediakan offset manual. Lirik tidak selalu tersedia.\n\nmode=lyrics mencari potongan lirik; auto menggabungkan judul/artis/lirik. Hasil pengenalan adalah dugaan, jadi pilih versi sumber yang sesuai. Pencarian memakai metadata publik YouTube/Genius, Spotify oEmbed opsional. Lirik dari LRCLIB; fallback lirik Spotify menggunakan sesi server privat bila tersedia. Sesi itu tidak dipakai untuk audio dan tidak diberikan kepada pengguna. Audio bukan hasil decrypt Spotify dan bukan preview 30 detik. Sumber yang memerlukan login, pembatasan akses, atau DRM tidak dilayani; status 503/403 dikembalikan tanpa cookies/login fallback.\n\nAudio dialirkan melalui VPS dan Cloudflare, tanpa menyimpan lagu penuh di VPS/R2. Cache hanya metadata/URL sementara; URL Google tidak dipublikasikan.\n`,{headers:{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'public, max-age=60'}});
}
