import {z} from 'zod';
import {env} from '../runtime/env.js';
import Schedule from '../database/showroomDB/jkt48/JKT48NewSchedule.js';
const id='[a-f0-9]{32}',pathPattern=new RegExp('^/media/theater/('+id+')/(\\d{13})\\.jpg$');
const row=z.object({id:z.string().regex(/^[a-f0-9]{32}$/),theater_code:z.string().max(80).nullable(),slug:z.string().max(200),title:z.string().max(300),started_at:z.string().datetime(),observed_at:z.string().datetime(),ended_at:z.string().datetime().nullable(),status:z.enum(['recording','waiting','queued','finalizing','uploading','uploaded','upload_failed','recording_failed']),youtube_id:z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(),screenshots:z.array(z.number().int().min(1000000000000).max(9999999999999)).max(3000),bytes:z.number().int().nonnegative(),duration_ms:z.number().nonnegative(),partial:z.boolean(),disconnects:z.number().int().nonnegative(),error:z.string().regex(/^[a-z0-9_:-]{0,80}$/).nullable(),thumbnail_status:z.enum(['pending','uploaded','unavailable','failed']),youtube_privacy:z.enum(['private','public','unlisted']).nullable().optional().default(null)});
const schema='CREATE TABLE IF NOT EXISTS collector_theater_recordings (id TEXT PRIMARY KEY,theater_code TEXT,document TEXT NOT NULL,updated_at INTEGER NOT NULL)';
const initialized=new WeakMap();async function ready(db){if(!initialized.has(db))initialized.set(db,db.prepare(schema).run().catch(e=>{initialized.delete(db);throw e}));await initialized.get(db)}
function present(data,origin){const {screenshots,...value}=data;return {...value,youtube_url:data.youtube_id?'https://www.youtube.com/watch?v='+data.youtube_id:null,thumbnail_url:data.youtube_id?'https://i.ytimg.com/vi/'+data.youtube_id+'/hqdefault.jpg':null,screenshots:screenshots.map(frame=>({timestamp:frame,url:origin+'/media/theater/'+data.id+'/'+frame+'.jpg'})),storage:'youtube',screenshot_storage:'r2'}}
export async function theaterRecordings(db,origin,code){await ready(db);const {results}=await db.prepare('SELECT document FROM collector_theater_recordings'+(code?' WHERE theater_code=?':'')+' ORDER BY updated_at DESC LIMIT 100').bind(...(code?[code]:[])).all();return results.map(r=>present(JSON.parse(r.document),origin))}
export async function getTheaterRecordings(c){const recordings=await theaterRecordings(env.DB,new URL(c.req.url).origin);return {recordings,total_count:recordings.length}}
export async function theaterOperation(request,b){
 const url=new URL(request.url);if(!url.pathname.startsWith('/internal/collector/theater/'))return null;
 if(url.pathname.endsWith('/config')&&request.method==='GET'){
  const plans=await Schedule.find({type:'show'}).sort('-start_time').limit(100).select({code:1,title:1,start_time:1,end_time:1,date:1}).lean();return Response.json({shows:plans});
 }
 const shot=new RegExp('^/internal/collector/theater/screenshot/('+id+')/(\\d{13})\\.jpg$').exec(url.pathname);
 if(shot&&request.method==='PUT'){
  if(Number(request.headers.get('Content-Length'))>2000000)return new Response('Too large',{status:413});
  const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length>2000000||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return new Response('Invalid JPEG',{status:400});
  const key='theater-screenshots/'+shot[1]+'/'+shot[2]+'.jpg';
  await b.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'public, max-age=86400'}});
  return Response.json({ok:true,bytes:bytes.length,storage:'r2'});
 }
 if(url.pathname.endsWith('/heartbeat')&&request.method==='POST'){
  if(Number(request.headers.get('Content-Length'))>3000000)return Response.json({message:'Payload too large'},{status:413});
  const text=await request.text();if(text.length>3000000)return Response.json({message:'Payload too large'},{status:413});
  const data=z.object({pid:z.number().int().positive(),active:z.number().int().nonnegative(),queued:z.number().int().nonnegative(),auth_status:z.enum(['ready','error','checking']),auth_error:z.string().max(80).nullable(),discovery_ok:z.boolean(),disk_free_bytes:z.number().nonnegative(),last_error:z.string().max(80).nullable(),sessions:z.array(row).max(200)}).parse(JSON.parse(text));await ready(b.DB);const now=Date.now();
  const statements=data.sessions.map(r=>b.DB.prepare('INSERT INTO collector_theater_recordings(id,theater_code,document,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET theater_code=excluded.theater_code,document=excluded.document,updated_at=excluded.updated_at').bind(r.id,r.theater_code,JSON.stringify(r),now));
  for(let offset=0;offset<statements.length;offset+=50)await b.DB.batch(statements.slice(offset,offset+50));
  const {sessions,...health}=data;await b.DB.prepare('INSERT INTO collector_state(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('theater',JSON.stringify(health),now).run();
  await b.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/theater%'").run();return Response.json({ok:true});
 }
 return Response.json({message:'Endpoint not found'},{status:404});
}
export async function serveTheaterScreenshot(request,b){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/theater/'))return null;
 const match=pathPattern.exec(url.pathname);if(!match||url.search)return new Response('Invalid path',{status:400});if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 const key='theater-screenshots/'+match[1]+'/'+match[2]+'.jpg';
 try{
  const object=await b.IMAGES_BUCKET.get(key);
  if(object)return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':'image/jpeg','Content-Length':String(object.size),'Cache-Control':'public, max-age=86400','X-Media-Storage':'r2','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
  const target=new URL('/theater-captures/'+match[1]+'/'+match[2]+'.jpg',b.JKT48_SCRAPER_URL);if(target.protocol!=='https:')throw Error('Invalid origin');
  const r=await fetch(target,{headers:{Authorization:'Bearer '+b.COLLECTOR_TOKEN,'User-Agent':'JKT48Connect-Sync/1.0 (+https://api.jkt48connect.app)'},redirect:'manual',signal:AbortSignal.timeout(15000)});if(!r.ok)return new Response('Screenshot unavailable',{status:r.status===404?404:502});
  if(Number(r.headers.get('Content-Length'))>2000000)throw Error('Too large');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>2000000||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('Invalid JPEG');
  await b.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'public, max-age=86400'}});
  return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':'image/jpeg','Content-Length':String(bytes.length),'Cache-Control':'public, max-age=86400','X-Media-Storage':'r2','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'}});
 }catch{return new Response('Screenshot temporarily unavailable',{status:502})}
}
