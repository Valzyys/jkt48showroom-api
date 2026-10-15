import { idnAuthStatus } from '../idn/auth.js';
import { assets } from '../docs/assets.js';
import { authenticated,verifyPassword,sessionCookie,logoutCookie } from './auth.js';
import { effectiveBindings,settingsView,saveSettings } from './settings.js';
import { runWithEnv } from '../runtime/env.js';
import { ensureJKT48 } from '../library/jkt48/scraper/sync.js';
import { serveMedia,storagePath } from '../runtime/jkt48-media.js';
import { collectorMonitor } from './monitor.js';
import { developerAdmin } from '../accounts/admin.js';
const securityHeaders={
 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{...securityHeaders,...headers}});
async function body(request){if(Number(request.headers.get('Content-Length'))>20000)throw Object.assign(new Error('Payload terlalu besar'),{status:413});const text=await request.text();if(text.length>20000)throw Object.assign(new Error('Payload terlalu besar'),{status:413});try{return JSON.parse(text);}catch{throw Object.assign(new Error('JSON tidak valid'),{status:400});}}
export async function controlResponse(request,bindings,execution){
 const url=new URL(request.url);
 if(url.pathname!=='/control/admin'&&!url.pathname.startsWith('/control/'))return null;
 const publicAssets={'/control/admin':[assets.controlHtml,'text/html; charset=utf-8'],'/control/admin/':[assets.controlHtml,'text/html; charset=utf-8'],'/control/app.js':[assets.controlScript,'text/javascript; charset=utf-8'],'/control/style.css':[assets.controlCss,'text/css; charset=utf-8']};
 if(publicAssets[url.pathname]){
  if(!['GET','HEAD'].includes(request.method))return json({message:'Method tidak diizinkan'},405,{Allow:'GET, HEAD'});
  const [value,type]=publicAssets[url.pathname];return new Response(request.method==='HEAD'?null:value,{headers:{...securityHeaders,'Content-Type':type}});
 }
 if(!url.pathname.startsWith('/control/api/'))return json({message:'Endpoint tidak ditemukan'},404);
 try{
  if(!bindings.CONTROL_SESSION_SECRET||!bindings.CONTROL_ADMIN_PASSWORD_HASH||!bindings.CONTROL_ADMIN_EMAIL)return json({message:'Login control belum dikonfigurasi'},503);
  if(!['GET','POST','PUT','DELETE'].includes(request.method))return json({message:'Method tidak diizinkan'},405);
  if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)return json({message:'Origin tidak diizinkan'},403);
  if(url.pathname==='/control/api/login'&&request.method==='POST'){
   const data=await body(request);
   const namespace=bindings.COORDINATOR;
   const limit=await namespace.get(namespace.idFromName('control-auth')).fetch('https://control.internal/security',{method:'POST',body:JSON.stringify({kind:'rate',key:'control-login:'+request.headers.get('CF-Connecting-IP'),windowMs:900000,limit:10})});
   if(!limit.ok)throw new Error('Authentication service unavailable');
   const state=await limit.json();if(!state.allowed)return json({message:'Terlalu banyak percobaan login'},429,{'Retry-After':String(state.retryAfter)});
   const valid=await verifyPassword(data.password,bindings.CONTROL_ADMIN_PASSWORD_HASH);
   if(!valid||data.email!==bindings.CONTROL_ADMIN_EMAIL)return json({message:'Email atau password salah'},401);
   return json({ok:true,email:bindings.CONTROL_ADMIN_EMAIL},200,{'Set-Cookie':await sessionCookie(bindings)});
  }
  if(!await authenticated(request,bindings))return json({message:'Login diperlukan'},401);
  if(url.pathname==='/control/api/developers'||url.pathname.startsWith('/control/api/developers/'))return json(await developerAdmin(url,request,bindings,body));
  if(url.pathname==='/control/api/session'&&request.method==='GET')return json({email:bindings.CONTROL_ADMIN_EMAIL});
  if(url.pathname==='/control/api/logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':logoutCookie()});
  if(url.pathname==='/control/api/settings'&&request.method==='GET')return json({settings:await settingsView(bindings)});
  if(url.pathname==='/control/api/settings'&&request.method==='PUT'){
   const data=await body(request);const changed=await saveSettings(bindings,data.changes);return json({ok:true,changed,message:'Pengaturan disimpan. Instance lain memperbarui konfigurasi dalam 10 detik.'});
  }
  const effective=await effectiveBindings(bindings);
  if(url.pathname==='/control/api/key'&&request.method==='GET')return json({key:effective.API_KEY||null});
  if(url.pathname==='/control/api/key/new'&&request.method==='POST')return json({key:Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('')});
  if(url.pathname==='/control/api/status'&&request.method==='GET'){
   const {results}=await bindings.DB.prepare('SELECT database_name,collection_name,count(*) AS records FROM documents GROUP BY database_name,collection_name').all();
   const cache=await bindings.DB.prepare('SELECT count(*) AS records FROM cache_entries').first();
   const media=await bindings.IMAGES_BUCKET.list({prefix:'jkt48-origin/',limit:1000});
   const sessions=await bindings.DB.prepare("SELECT json_extract(document,'$.data_id') AS data_id,json_extract(document,'$.type') AS type,json_extract(document,'$.capture.status') AS status,json_array_length(json_extract(document,'$.live_info.screenshots.list')) AS frames,json_extract(document,'$.total_gifts') AS gifts,json_extract(document,'$.recordings') AS recordings,json_extract(document,'$.room_id') AS room_id FROM documents WHERE database_name='liveDB' AND collection_name='livelogs' ORDER BY json_extract(document,'$.created_at') DESC LIMIT 30").all();
   const liveMedia=await bindings.IMAGES_BUCKET.list({prefix:'live-screenshots/',limit:1000});
   const uploads=await bindings.DB.prepare('SELECT count(*) AS records FROM collector_video_uploads').first();
   const collector=await bindings.DB.prepare("SELECT value,updated_at FROM collector_state WHERE name='vps'").first();
   const recent=await bindings.DB.prepare("SELECT count(*) AS completedCount,max(json_extract(document,'$.live_info.date.end')) AS lastCompleted FROM documents WHERE database_name='liveDB' AND collection_name='livelogs' AND json_extract(document,'$.capture.status')='completed'").first();
   const monitor=collectorMonitor(collector?{...JSON.parse(collector.value),lastSeen:collector.updated_at}:null,effective,{...recent,lastCompleted:recent.lastCompleted?Date.parse(recent.lastCompleted):0});
   return json({idnAuth:idnAuthStatus(effective),monitor,collectorSessions:sessions.results.map(s=>({...s,recordings:JSON.parse(s.recordings||'[]')})),liveImages:liveMedia.objects.filter(o=>o.key.endsWith('.jpg')).length,liveVideos:liveMedia.objects.filter(o=>o.key.endsWith('.mp4')).length,videoUploads:uploads.records,liveMediaTruncated:liveMedia.truncated,collector:collector?{...JSON.parse(collector.value),lastSeen:collector.updated_at}:null,collections:results,cacheEntries:cache.records,mediaObjects:media.objects.length,mediaTruncated:media.truncated,autoSync:effective.JKT48_AUTO_SYNC!=='false',scraperConfigured:Boolean(effective.JKT48_SCRAPER_URL&&effective.JKT48_SCRAPER_TOKEN)});
  }
  if(url.pathname==='/control/api/cache/clear'&&request.method==='POST'){
   await bindings.DB.prepare('DELETE FROM cache_entries').run();return json({ok:true,message:'Cache API dihapus. Data dan media R2 dipertahankan.'});
  }
  if(url.pathname==='/control/api/sync'&&request.method==='POST'){
   const data=await body(request);const datasets=data.dataset==='all'?['news','schedules','members']:[data.dataset];
   if(datasets.some(dataset=>!['news','schedules','members'].includes(dataset)))return json({message:'Dataset tidak valid'},400);
   const results={};await runWithEnv({...effective,JKT48_AUTO_SYNC:'true'},execution,async()=>{
    for(const dataset of datasets){try{results[dataset]=await ensureJKT48(dataset,{force:true});}catch(error){results[dataset]={error:error.message};}}
   });
   return json({results},Object.values(results).some(result=>result.error)?503:200);
  }
  if(url.pathname==='/control/api/media/warm'&&request.method==='POST'){
   const {results}=await bindings.DB.prepare("SELECT DISTINCT json_extract(document,'$.info.img') AS image FROM documents WHERE collection_name='idolmembers' AND json_extract(document,'$.info.img') IS NOT NULL").all();
   let stored=0,failed=0,skipped=0;
   for(const row of results.slice(0,60)){
    const path=storagePath(row.image);if(!path){skipped++;continue;}
    if(await bindings.IMAGES_BUCKET.head('jkt48-origin/'+path)){skipped++;continue;}
    if(stored+failed>=20)break;
    const response=await serveMedia(new Request(url.origin+'/media/jkt48/'+path,{method:'HEAD'}),effective);
    if(response.ok)stored++;else failed++;
   }
   return json({stored,failed,skipped,message:'Maksimal 20 gambar per batch; ulangi untuk melanjutkan.'});
  }
  return json({message:'Endpoint tidak ditemukan'},404);
 }catch(error){return json({message:error.status?error.message:'Operasi control gagal. Periksa konfigurasi layanan.'},error.status||500);}
}
