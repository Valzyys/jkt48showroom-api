// Notification source versions intentionally exclude frequently changing live statistics.
import {createHash} from 'node:crypto';
import {env} from '../runtime/env.js';
import LiveLog from '../database/live/schema/LiveLog.js';
import Showroom from '../database/schema/showroom/Showroom.js';
const ident=/^[a-zA-Z0-9_-]{1,160}$/;
const themes=['photobook','jkt48connect','avonera48'],layouts=['portrait','banner'];
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
// Idempotent initialization also supports deployment tokens scoped to Worker editing.
// SQL is fixed at build time; no request payload can supply schema statements.
const schemas=new WeakMap();
async function ensureSchema(db){
 if(!schemas.has(db))schemas.set(db,db.batch(schemaStatements.map(sql=>db.prepare(sql))).catch(error=>{schemas.delete(db);throw error}));
 await schemas.get(db);
}
const schemaStatements=["CREATE TABLE IF NOT EXISTS collector_live_notices (\n data_id TEXT PRIMARY KEY, source_version TEXT NOT NULL, snapshot TEXT NOT NULL,\n is_live INTEGER NOT NULL DEFAULT 0, is_preview INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL\n)", "CREATE TABLE IF NOT EXISTS collector_live_notice_images (\n data_id TEXT NOT NULL, theme TEXT NOT NULL, layout TEXT NOT NULL, source_version TEXT NOT NULL,\n state TEXT NOT NULL, render_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,\n object_key TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY(data_id,theme,layout)\n)", "CREATE INDEX IF NOT EXISTS live_notice_active ON collector_live_notices(is_live,updated_at)"];
export function notificationSnapshot(row,member,preview=false){
 const name=member?.name||row.name,nickname=member?.info?.nicknames?.[0]||name.split(' ')[0];
 return {data_id:row.data_id,room_id:row.room_id,type:row.type,name,nickname,img:member?.info?.img||row.img,title:row.idn?.title||'Live bersama '+nickname,started_at:row.date.start,live_url:row.type==='idn'?'https://www.idn.app/'+encodeURIComponent(row.idn?.username||'')+'/live/'+encodeURIComponent(row.idn?.slug||row.live_id):'https://www.showroom-live.com/r/'+encodeURIComponent(row.url_key),is_preview:preview};
}
export async function saveLiveNotification(bindings,row,member,preview=false){
 await ensureSchema(bindings.DB);
 const snapshot=notificationSnapshot(row,member,preview),version=createHash('sha256').update('branded-v3:'+JSON.stringify(snapshot)).digest('hex').slice(0,24);
 await bindings.DB.prepare('INSERT INTO collector_live_notices(data_id,source_version,snapshot,is_live,is_preview,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(data_id) DO UPDATE SET source_version=excluded.source_version,snapshot=excluded.snapshot,is_live=excluded.is_live,is_preview=excluded.is_preview,updated_at=excluded.updated_at').bind(row.data_id,version,JSON.stringify(snapshot),preview?0:Number(row.capture.status==='live'),Number(preview),Date.now()).run();
 return version;
}
export async function liveNotificationData(db,origin,id){
 if(id&&!ident.test(id))return null;
 await ensureSchema(db);
 const {results}=await db.prepare("SELECT n.*,COALESCE((SELECT json_group_array(json_object('theme',i.theme,'layout',i.layout,'state',i.state)) FROM collector_live_notice_images i WHERE i.data_id=n.data_id AND i.source_version=n.source_version),'[]') AS image_states FROM collector_live_notices n WHERE "+(id?'n.data_id=?':'n.is_live=1 AND n.updated_at>?')+' ORDER BY n.updated_at DESC LIMIT 100').bind(id||Date.now()-180000).all();
 const output=[];
 for(const row of results){
  const snapshot=JSON.parse(row.snapshot),images=JSON.parse(row.image_states);
  const notification_designs={};for(const theme of themes){notification_designs[theme]={};for(const layout of layouts){const image=images.find(i=>i.theme===theme&&i.layout===layout),ready=image?.state==='ready';notification_designs[theme][layout]={status:ready?'ready':image?.state==='error'?'failed':'pending',url:ready?origin+'/media/'+image.object_key:null,width:theme==='avonera48'?(layout==='banner'?2400:1800):(layout==='banner'?1600:1080),height:theme==='avonera48'?(layout==='banner'?1350:2400):(layout==='banner'?900:1350),format:'png'};}}
  const is_live=Boolean(row.is_live&&row.updated_at>Date.now()-180000);
  output.push({...snapshot,is_live,caption:(snapshot.is_preview?'[Preview sesi arsip] ':is_live?'🔴 ':'[Live selesai] ')+snapshot.name+' — '+snapshot.title+'\n'+snapshot.live_url,notification_designs});
 }
 return id?output[0]||null:output;
}
export async function getLiveNotifications(c){return {lives:await liveNotificationData(env.DB,new URL(c.req.url).origin)}}
export async function getLiveNotification(c){const item=await liveNotificationData(env.DB,new URL(c.req.url).origin,c.req.param('id'));if(!item)throw Object.assign(new Error('Live notification not found'),{status:404});return item}
export async function serveLiveNotification(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/live-notifications/'))return null;
 if(!/^\/media\/live-notifications\/v1\/(photobook|jkt48connect|avonera48)\/[a-zA-Z0-9_-]{1,160}\/[a-f0-9]{24}(-banner)?\.png$/.test(url.pathname)||url.search)return json({message:'Invalid image path'},400);
 if(!['GET','HEAD'].includes(request.method))return json({message:'Method not allowed'},405);
 const object=await bindings.IMAGES_BUCKET.get(url.pathname.slice(7));if(!object)return json({message:'Image not ready'},404);
 const headers={'Content-Type':'image/png','Content-Length':String(object.size),ETag:object.httpEtag,'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff','X-Media-Storage':'r2'};
 if(request.headers.get('If-None-Match')===object.httpEtag)return new Response(null,{status:304,headers});return new Response(request.method==='HEAD'?null:object.body,{headers});
}
export async function liveNotificationOperation(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/internal/collector/live-notifications/'))return null;
 await ensureSchema(bindings.DB);
 const theme=url.searchParams.get('theme')||'photobook',layout=url.searchParams.get('layout')||'portrait',now=Date.now();if(!themes.includes(theme)||!layouts.includes(layout))return json({message:'Invalid design'},400);
 if(url.pathname.endsWith('/prepare')&&request.method==='POST'){
  const {data_id}=await request.json();if(!ident.test(data_id||''))return json({message:'Invalid ID'},400);
  const log=await LiveLog.findOne({data_id}).lean();if(!log)return json({message:'Session not found'},404);const room=await Showroom.findOne({room_id:log.room_id}).lean();
  const source_version=await saveLiveNotification(bindings,{...log,name:room?.name||'Member',img:room?.img||'',url_key:room?.url||'',date:log.live_info.date,capture:log.capture||{status:'completed'}},null,log.capture?.status!=='live');return json({ok:true,data_id,source_version});
 }
 if(url.pathname.endsWith('/jobs')&&request.method==='GET'){
  const row=await bindings.DB.prepare("SELECT n.* FROM collector_live_notices n LEFT JOIN collector_live_notice_images i ON i.data_id=n.data_id AND i.theme=? AND i.layout=? WHERE ((n.is_live=1 AND n.updated_at>?) OR n.is_preview=1) AND (i.data_id IS NULL OR i.source_version!=n.source_version OR i.state!='ready') AND COALESCE(i.lease_until,0)<? ORDER BY n.is_live DESC,n.updated_at DESC LIMIT 1").bind(theme,layout,now-180000,now).first();if(!row)return json({job:null});
  const token=crypto.randomUUID(),claim=await bindings.DB.prepare("INSERT INTO collector_live_notice_images(data_id,theme,layout,source_version,state,render_token,lease_until,updated_at) VALUES(?,?,?,?,'processing',?,?,?) ON CONFLICT(data_id,theme,layout) DO UPDATE SET source_version=excluded.source_version,state='processing',render_token=excluded.render_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at WHERE collector_live_notice_images.lease_until<?").bind(row.data_id,theme,layout,row.source_version,token,now+300000,now,now).run();
  return json({job:claim.meta.changes?{data_id:row.data_id,source_version:row.source_version,render_token:token,theme,layout,snapshot:JSON.parse(row.snapshot)}:null});
 }
 const match=/^\/internal\/collector\/live-notifications\/([a-zA-Z0-9_-]{1,160})\/([a-f0-9]{24})$/.exec(url.pathname);
 if(match&&request.method==='PUT'){
  const token=request.headers.get('X-Render-Token')||'',row=await bindings.DB.prepare("SELECT i.* FROM collector_live_notice_images i JOIN collector_live_notices n ON n.data_id=i.data_id AND n.source_version=i.source_version WHERE i.data_id=? AND i.source_version=? AND i.theme=? AND i.layout=? AND i.render_token=? AND i.state='processing' AND i.lease_until>?").bind(match[1],match[2],theme,layout,token,now).first();if(!row)return json({message:'Render lease expired'},409);
  if(Number(request.headers.get('Content-Length'))>8388608)return json({message:'Image too large'},413);const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length<24||bytes.length>8388608||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return json({message:'PNG required'},400);
  const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);if(width!==(theme==='avonera48'?(layout==='banner'?2400:1800):(layout==='banner'?1600:1080))||height!==(theme==='avonera48'?(layout==='banner'?1350:2400):(layout==='banner'?900:1350)))return json({message:'Invalid image dimensions'},400);
  const key='live-notifications/v1/'+theme+'/'+match[1]+'/'+match[2]+(layout==='banner'?'-banner':'')+'.png';await bindings.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000, immutable'}});
  await bindings.DB.prepare("UPDATE collector_live_notice_images SET state='ready',object_key=?,render_token=NULL,lease_until=0,updated_at=? WHERE data_id=? AND theme=? AND layout=? AND render_token=?").bind(key,now,match[1],theme,layout,token).run();return json({ok:true,url:url.origin+'/media/'+key});
 }
 if(url.pathname.endsWith('/error')&&request.method==='POST'){const data=await request.json();await bindings.DB.prepare("UPDATE collector_live_notice_images SET state='error',lease_until=?,updated_at=? WHERE data_id=? AND render_token=? AND state='processing'").bind(now+60000,now,String(data.data_id||''),String(data.render_token||'')).run();return json({ok:true})}
 return json({message:'Endpoint not found'},404);
}
