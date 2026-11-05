// YouTube credentials are never exposed by the browser-facing API.
const enc=new TextEncoder(),dec=new TextDecoder();
const CALLBACK='https://api.jkt48connect.app/control/youtube-oauth/callback';
const COOKIE='__Secure-jkc-youtube-oauth';
const HEADERS={'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...HEADERS,...extra}});
const b64=b=>btoa(String.fromCharCode(...b)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const unb64=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const random=()=>b64(crypto.getRandomValues(new Uint8Array(32)));
const hash=async s=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))));
function same(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function configured(b){return Boolean(b.DB&&b.AUTH_SECRET&&b.YOUTUBE_OAUTH_CLIENT_ID&&b.YOUTUBE_OAUTH_CLIENT_SECRET&&b.YOUTUBE_OAUTH_WORKER_TOKEN);}
async function key(b){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',enc.encode('youtube-oauth-v1:'+b.AUTH_SECRET)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function seal(value,b,label){const iv=crypto.getRandomValues(new Uint8Array(12));const body=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(label)},await key(b),enc.encode(JSON.stringify(value)));return b64(iv)+'.'+b64(new Uint8Array(body));}
async function open(value,b,label){const [iv,body]=value.split('.');return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(label)},await key(b),unb64(body))));}
const cookie=(value,age=600)=>`${COOKIE}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/control/youtube-oauth; Max-Age=${age}`;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function html(title,content,status=200,extra={}){return new Response(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · YouTube</title><style>body{font:16px/1.65 system-ui;background:#f6f3ee;color:#201b1b;margin:0;padding:8vw}main{max-width:680px;margin:auto}h1{line-height:1.15;font-size:38px}button,a{color:#dc143c}button{background:#db1238;color:white;border:0;border-radius:12px;padding:14px 20px;font:inherit;cursor:pointer}code{overflow-wrap:anywhere}small{color:#666}#status{white-space:pre-wrap}</style><main>${content}</main></html>`,{status,headers:{...HEADERS,'Content-Type':'text/html; charset=utf-8',...extra}});}

export async function youtubeOauthAdmin(request,b){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/control/api/youtube-oauth/'))return null;
 // The caller is controlResponse, after its admin session and CSRF checks.
 if(!configured(b))return json({message:'OAuth YouTube belum dikonfigurasi.'},503);
 if(path.endsWith('/status')&&request.method==='GET'){
  const row=await b.DB.prepare("SELECT channel_id,channel_title,version,updated_at,received_at FROM youtube_oauth_credentials WHERE id='live'").first();
  return json({connected:Boolean(row),channel:row?{id:row.channel_id,title:row.channel_title}:null,updated_at:row?.updated_at||null,received_at:row?.received_at||null,redirect_uri:CALLBACK});
 }
 if(path.endsWith('/start')&&request.method==='POST'){
  const state=random(),nonce=random(),verifier=random(),now=Date.now();
  await b.DB.prepare('DELETE FROM youtube_oauth_states WHERE expires_at < ?').bind(now).run();
  await b.DB.prepare('INSERT INTO youtube_oauth_states(state_hash,cookie_hash,verifier,expires_at) VALUES(?,?,?,?)').bind(await hash(state),await hash(nonce),await seal(verifier,b,'pkce'),now+600000).run();
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:b.YOUTUBE_OAUTH_CLIENT_ID,redirect_uri:CALLBACK,response_type:'code',scope:'https://www.googleapis.com/auth/youtube',access_type:'offline',prompt:'consent select_account',state,code_challenge:await hash(verifier),code_challenge_method:'S256'}).toString();
  return json({authorization_url:url.href,expires_in:600,redirect_uri:CALLBACK},200,{'Set-Cookie':cookie(nonce)});
 }
 return json({message:'Method atau endpoint tidak diizinkan.'},405);
}

export async function youtubeOauthPublic(request,b){
 const url=new URL(request.url),path=url.pathname;
 if(path.startsWith('/internal/youtube-oauth/')){
  if(!b.YOUTUBE_OAUTH_WORKER_TOKEN||!same(request.headers.get('Authorization'), 'Bearer '+b.YOUTUBE_OAUTH_WORKER_TOKEN))return json({message:'Unauthorized'},401);
  if(!configured(b))return json({message:'OAuth belum dikonfigurasi.'},503);
  const row=await b.DB.prepare("SELECT * FROM youtube_oauth_credentials WHERE id='live'").first();
  if(path==='/internal/youtube-oauth/credentials'&&request.method==='GET'){
   if(!row)return json({connected:false});
   if(url.searchParams.get('version')===row.version)return json({connected:true,unchanged:true,version:row.version});
   return json({connected:true,version:row.version,channel:{id:row.channel_id,title:row.channel_title},credentials:await open(row.encrypted,b,'credential')});
  }
  if(path==='/internal/youtube-oauth/ack'&&request.method==='POST'){
   if(Number(request.headers.get('Content-Length'))>200)return json({message:'Payload terlalu besar.'},413);
   const raw=await request.text();if(raw.length>200)return json({message:'Payload terlalu besar.'},413);
   let data;try{data=JSON.parse(raw);}catch{return json({message:'JSON tidak valid.'},400);}
   if(!row||data.version!==row.version)return json({message:'Versi tidak sesuai.'},409);
   await b.DB.prepare("UPDATE youtube_oauth_credentials SET received_at=? WHERE id='live' AND version=?").bind(Date.now(),data.version).run();return json({ok:true});
  }
  return json({message:'Endpoint tidak ditemukan.'},404);
 }
 if(path==='/control/youtube-oauth'&&request.method==='GET')return html('Hubungkan YouTube',`<small>JKT48Connect · pengaturan privat</small><h1>Hubungkan kembali YouTube.</h1><p>Masuk sebagai admin terlebih dahulu, lalu pilih akun dan channel YouTube untuk auto-stream. Token disimpan terenkripsi dan diteruskan ke worker VPS lewat jalur privat.</p><p id="status">Memeriksa sesi admin…</p><button id="connect" disabled>Login Google &amp; hubungkan YouTube</button><p><a href="/login">Login admin</a> · <a href="/control/admin">Kembali ke control</a></p><p><small>Daftarkan callback di Google Cloud OAuth Web application:<br><code>${CALLBACK}</code></small></p><script src="/control/youtube-oauth/app.js" defer></script>`);
 if(path==='/control/youtube-oauth/app.js'&&request.method==='GET')return new Response(`let csrf;const status=document.querySelector('#status'),button=document.querySelector('#connect');async function init(){try{const s=await fetch('/control/api/session',{cache:'no-store'});if(!s.ok)throw Error('Login admin diperlukan.');csrf=(await s.json()).csrf;const r=await fetch('/control/api/youtube-oauth/status',{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.message||'Tidak dapat membaca status.');status.textContent=d.connected?'Tersambung ke '+d.channel.title+'. '+(d.received_at?'Kredensial sudah diterima VPS.':'Menunggu VPS mengambil kredensial.'):'Belum ada token baru. Klik tombol untuk memberi izin Google.';button.disabled=false;}catch(e){status.textContent=e.message;}}button.onclick=async()=>{button.disabled=true;try{const r=await fetch('/control/api/youtube-oauth/start',{method:'POST',headers:{'X-CSRF-Token':csrf,'X-Requested-With':'jkt48connect'}}),d=await r.json();if(!r.ok)throw Error(d.message||'Gagal memulai login.');location.assign(d.authorization_url);}catch(e){status.textContent=e.message;button.disabled=false;}};init();`,{headers:{...HEADERS,'Content-Type':'text/javascript; charset=utf-8'}});
 if(path!==new URL(CALLBACK).pathname)return null;
 if(request.method!=='GET')return json({message:'Method tidak diizinkan.'},405);
 const fail=(message,status=400)=>html('Gagal menghubungkan YouTube',`<h1>Belum terhubung.</h1><p>${escape(message)}</p><a href="/control/youtube-oauth">Coba login ulang</a>`,status,{'Set-Cookie':cookie('',0)});
 if(!configured(b))return fail('Konfigurasi OAuth belum lengkap.',503);
 const state=url.searchParams.get('state')||'',nonce=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1)||'';
 if(!/^[\w-]{43}$/.test(state)||!/^[\w-]{43}$/.test(nonce)||url.searchParams.getAll('state').length!==1)return fail('Sesi login tidak valid atau kedaluwarsa.');
 const id=await hash(state),row=await b.DB.prepare('SELECT * FROM youtube_oauth_states WHERE state_hash=?').bind(id).first();
 if(!row||row.expires_at<Date.now()||!same(row.cookie_hash,await hash(nonce)))return fail('Sesi login tidak valid atau kedaluwarsa.');
 const consumed=await b.DB.prepare('DELETE FROM youtube_oauth_states WHERE state_hash=? RETURNING state_hash').bind(id).first();
 if(!consumed)return fail('Sesi login sudah dipakai.');
 if(url.searchParams.has('error'))return fail('Izin Google dibatalkan atau tidak diberikan.');
 const code=url.searchParams.get('code');if(!code||code.length>4096||url.searchParams.getAll('code').length!==1)return fail('Kode Google tidak valid.');
 try{
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:b.YOUTUBE_OAUTH_CLIENT_ID,client_secret:b.YOUTUBE_OAUTH_CLIENT_SECRET,redirect_uri:CALLBACK,grant_type:'authorization_code',code,code_verifier:await open(row.verifier,b,'pkce')}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)return fail('Google menolak pertukaran kode. Periksa Client ID, Client Secret, dan callback.',502);
  const token=await r.json();if(!token.refresh_token||!token.access_token)return fail('Google tidak memberikan refresh token baru. Ulangi login dengan persetujuan akses.',502);
  const channelResponse=await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',{headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(20000)});
  if(!channelResponse.ok)return fail('Izin YouTube belum dapat digunakan. Pastikan YouTube Data API v3 aktif.',502);
  const channel=(await channelResponse.json()).items?.[0];if(!channel?.id)return fail('Akun ini belum memiliki channel YouTube.',400);
  const credentials={client_id:b.YOUTUBE_OAUTH_CLIENT_ID,client_secret:b.YOUTUBE_OAUTH_CLIENT_SECRET,refresh_token:token.refresh_token};
  await b.DB.prepare("INSERT INTO youtube_oauth_credentials(id,encrypted,channel_id,channel_title,version,updated_at,received_at) VALUES('live',?,?,?,?,?,NULL) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted,channel_id=excluded.channel_id,channel_title=excluded.channel_title,version=excluded.version,updated_at=excluded.updated_at,received_at=NULL").bind(await seal(credentials,b,'credential'),channel.id,String(channel.snippet?.title||channel.id),random(),Date.now()).run();
  return html('YouTube terhubung',`<h1>YouTube terhubung.</h1><p>Channel: <strong>${escape(channel.snippet?.title||channel.id)}</strong>.</p><p>Token baru tersimpan. Worker VPS akan mengambilnya otomatis dalam sekitar 30 detik. Token tidak ditampilkan di halaman ini.</p><a href="/control/youtube-oauth">Periksa status VPS</a>`,200,{'Set-Cookie':cookie('',0)});
 }catch{return fail('Koneksi ke Google sementara gagal. Silakan ulangi login.',502);}
}
