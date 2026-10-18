import {createHash} from 'node:crypto';
import {rewriteMedia} from '../runtime/jkt48-media.js';
import Schedule from '../database/showroomDB/jkt48/JKT48NewSchedule.js';
import Member from '../database/schema/48group/IdolMember.js';
const themes=['photobook','jkt48connect','avonera48'],layouts=['portrait','banner'],codePattern=/^[a-zA-Z0-9_-]{1,80}$/;
const statements=[`CREATE TABLE IF NOT EXISTS collector_theater_schedules (code TEXT PRIMARY KEY,source_version TEXT NOT NULL,snapshot TEXT NOT NULL,start_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)`,`CREATE TABLE IF NOT EXISTS collector_theater_schedule_images (code TEXT NOT NULL,theme TEXT NOT NULL,layout TEXT NOT NULL,source_version TEXT NOT NULL,state TEXT NOT NULL,render_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,object_key TEXT,updated_at INTEGER NOT NULL,PRIMARY KEY(code,theme,layout))`];
const initialized=new WeakMap();async function ready(db){if(!initialized.has(db))initialized.set(db,db.batch(statements.map(sql=>db.prepare(sql))).catch(e=>{initialized.delete(db);throw e}));await initialized.get(db)}
const normal=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function scheduleSnapshot(data,people){
 const members=(data.jkt48_member||[]).map(raw=>{
  const id=String(raw.member_id??raw.id??''),person=people.find(p=>(p.jkt48id||[]).map(String).includes(id));
  return {id,name:person?.info?.nicknames?.[0]||raw.name||'Member',fullname:person?.name||raw.name||'Member',img:person?.info?.img||'',url_key:person?.slug||''};
 });
 const birthdayRefs=[...(data.birthday_member||[]),...(data.birthday_member_name||[])];
 const seitansai=members.filter(m=>birthdayRefs.some(r=>{
  const id=typeof r==='object'?r?.member_id??r?.id:r,name=typeof r==='object'?r?.name:r;
  return (id!==undefined&&String(id)===m.id)||Boolean(normal(name)&&[m.name,m.fullname,m.url_key].some(v=>normal(v)===normal(name)));
 }));
 return {id:data.code,title:String(data.title||'JKT48 Theater').trim(),date:new Date(data.start_time||data.date).toISOString(),team:String(data.jkt48_member_type||''),members,seitansai};
}
export async function theaterScheduleDesigns(b,codes,origin){
 await ready(b.DB);codes=[...new Set(codes.filter(c=>codePattern.test(c||'')))];if(!codes.length)return new Map();
 const schedules=await Schedule.find({type:'show',code:{$in:codes}}).lean();
 const memberIds=[...new Set(schedules.flatMap(s=>(s.jkt48_member||[]).map(m=>String(m.member_id??m.id??''))))];
 const people=memberIds.length?await Member.find({jkt48id:{$in:memberIds}}).select({name:1,info:1,slug:1,jkt48id:1}).lean():[];
 const output=new Map();
 for(const data of schedules){
  if(!Number.isFinite(new Date(data.start_time||data.date).getTime()))continue;
  const snapshot=scheduleSnapshot(data,people),version=createHash('sha256').update('theater-v3:'+JSON.stringify(snapshot)).digest('hex').slice(0,24),now=Date.now();
  await b.DB.prepare('INSERT INTO collector_theater_schedules(code,source_version,snapshot,start_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET source_version=excluded.source_version,snapshot=excluded.snapshot,start_at=excluded.start_at,updated_at=excluded.updated_at').bind(data.code,version,JSON.stringify(snapshot),Date.parse(snapshot.date),now).run();
  const {results}=await b.DB.prepare('SELECT * FROM collector_theater_schedule_images WHERE code=? AND source_version=?').bind(data.code,version).all();
  const designs={};for(const theme of themes){designs[theme]={};for(const layout of layouts){const row=results.find(r=>r.theme===theme&&r.layout===layout);designs[theme][layout]={status:row?.state==='ready'?'ready':row?.state==='error'?'failed':'pending',url:row?.state==='ready'?origin+'/media/'+row.object_key:null,width:layout==='banner'?2400:1800,height:layout==='banner'?1350:2400,format:'png'};}}
  output.set(data.code,designs);
 }
 return output;
}
export async function theaterScheduleOperation(request,b){
 const url=new URL(request.url);if(!url.pathname.startsWith('/internal/collector/theater-schedules/'))return null;await ready(b.DB);
 const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}}),theme=url.searchParams.get('theme')||'photobook',layout=url.searchParams.get('layout')||'portrait',now=Date.now();
 if(!themes.includes(theme)||!layouts.includes(layout))return json({message:'Invalid design'},400);
 if(url.pathname.endsWith('/refresh')&&request.method==='POST'){
  const rows=await Schedule.find({type:'show',start_time:{$gte:new Date(now-86400000)}}).sort('start_time').limit(24).select({code:1}).lean();await theaterScheduleDesigns(b,rows.map(r=>r.code),url.origin);return json({ok:true,schedules:rows.length});
 }
 if(url.pathname.endsWith('/jobs')&&request.method==='GET'){
  const row=await b.DB.prepare("SELECT s.* FROM collector_theater_schedules s LEFT JOIN collector_theater_schedule_images i ON s.code=i.code AND i.theme=? AND i.layout=? WHERE (i.code IS NULL OR i.source_version!=s.source_version OR i.state!='ready') AND (i.source_version!=s.source_version OR COALESCE(i.lease_until,0)<?) ORDER BY ABS(s.start_at-?) LIMIT 1").bind(theme,layout,now,now).first();if(!row)return json({job:null});
  const token=crypto.randomUUID(),claim=await b.DB.prepare("INSERT INTO collector_theater_schedule_images(code,theme,layout,source_version,state,render_token,lease_until,updated_at) VALUES(?,?,?,?,'processing',?,?,?) ON CONFLICT(code,theme,layout) DO UPDATE SET source_version=excluded.source_version,state='processing',render_token=excluded.render_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE collector_theater_schedule_images.source_version!=excluded.source_version OR collector_theater_schedule_images.lease_until<?").bind(row.code,theme,layout,row.source_version,token,now+300000,now,now).run();
  return json({job:claim.meta.changes?{code:row.code,source_version:row.source_version,render_token:token,theme,layout,snapshot:rewriteMedia(JSON.parse(row.snapshot),url.origin)}:null});
 }
 const match=/^\/internal\/collector\/theater-schedules\/([a-zA-Z0-9_-]{1,80})\/([a-f0-9]{24})$/.exec(url.pathname);
 if(match&&request.method==='PUT'){
  const token=request.headers.get('X-Render-Token')||'',row=await b.DB.prepare("SELECT i.code FROM collector_theater_schedule_images i JOIN collector_theater_schedules s ON s.code=i.code AND s.source_version=i.source_version WHERE i.code=? AND i.source_version=? AND i.theme=? AND i.layout=? AND i.render_token=? AND i.state='processing' AND i.lease_until>?").bind(match[1],match[2],theme,layout,token,now).first();if(!row)return json({message:'Render lease expired'},409);
  if(Number(request.headers.get('Content-Length'))>8388608)return json({message:'Image too large'},413);const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length<24||bytes.length>8388608||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return json({message:'PNG required'},400);
  const view=new DataView(bytes.buffer);if(view.getUint32(16)!==(layout==='banner'?2400:1800)||view.getUint32(20)!==(layout==='banner'?1350:2400))return json({message:'Invalid dimensions'},400);
  const key='theater-schedules/v1/'+theme+'/'+match[1]+'/'+match[2]+(layout==='banner'?'-banner':'')+'.png';await b.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000, immutable'}});
  await b.DB.prepare("UPDATE collector_theater_schedule_images SET state='ready',object_key=?,render_token=NULL,lease_until=0,updated_at=? WHERE code=? AND theme=? AND layout=? AND render_token=?").bind(key,now,match[1],theme,layout,token).run();
  await b.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/theater%' OR key LIKE '%/api/next_schedule%'").run();return json({ok:true,url:url.origin+'/media/'+key});
 }
 if(url.pathname.endsWith('/error')&&request.method==='POST'){const data=await request.json();await b.DB.prepare("UPDATE collector_theater_schedule_images SET state='error',lease_until=?,updated_at=? WHERE code=? AND render_token=? AND state='processing'").bind(now+60000,now,String(data.code||''),String(data.render_token||'')).run();return json({ok:true})}
 return json({message:'Endpoint not found'},404);
}
export async function serveTheaterSchedule(request,b){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/theater-schedules/'))return null;
 if(!/^\/media\/theater-schedules\/v1\/(photobook|jkt48connect|avonera48)\/[a-zA-Z0-9_-]{1,80}\/[a-f0-9]{24}(-banner)?\.png$/.test(url.pathname)||url.search)return new Response('Invalid path',{status:400});if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 const object=await b.IMAGES_BUCKET.get(url.pathname.slice(7));if(!object)return new Response('Image not ready',{status:404});const headers={'Content-Type':'image/png','Content-Length':String(object.size),'Cache-Control':'public, max-age=31536000, immutable',ETag:object.httpEtag,'X-Media-Storage':'r2','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
 if(request.headers.get('If-None-Match')===object.httpEtag)return new Response(null,{status:304,headers});return new Response(request.method==='HEAD'?null:object.body,{headers});
}
