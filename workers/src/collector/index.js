import {serveLeaderboard,leaderboardOperation} from './leaderboards.js';
import { durationHeader,patchDurationStream } from './duration.js';
import { idnCollectorAuth } from '../idn/auth.js';
import { z } from 'zod';
import { effectiveBindings } from '../control/settings.js';
import { runWithEnv } from '../runtime/env.js';
import { createSourceStore } from '../runtime/source-store.js';
import IdolMember from '../database/schema/48group/IdolMember.js';
import Showroom from '../database/schema/showroom/Showroom.js';
import LiveLog from '../database/live/schema/LiveLog.js';
import UserLog from '../database/userDB/UserLog.js';
import ShowroomGift from '../database/schema/showroom/ShowroomGift.js';
import { IDNGift } from '../database/live/schema/idn/Gift.js';
import { repairVideo } from './repair.js';
import { playerResponse } from './player.js';
const ident=z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const date=z.string().datetime();
const user=z.object({user_id:z.union([z.string().max(160),z.number().int()]),name:z.string().max(300),avatar_id:z.number().int().optional(),avatar_url:z.string().max(2000).optional(),comments:z.number().int().nonnegative().default(0)});
const gift=z.object({gift_id:z.union([z.number().int(),z.string().max(160)]),num:z.number().int().positive(),send_count:z.number().int().nonnegative().optional(),date,point:z.number().nonnegative().optional(),gold:z.number().nonnegative().optional()});
const schema=z.object({data_id:ident,live_id:z.union([z.string().max(200),z.number().int()]),room_id:z.number().int().positive(),member_id:z.string().regex(/^[a-f0-9]{24}$/).optional(),name:z.string().min(1).max(300),img:z.string().max(2000),url_key:z.string().max(200),type:z.enum(['showroom','idn']),idn:z.object({id:z.string().optional(),username:z.string(),slug:z.string(),title:z.string().optional(),image:z.string().optional()}).optional(),date:z.object({start:date,end:date}),viewers:z.number().nonnegative(),comments:z.number().int().nonnegative(),users:z.array(user).max(10000),gift_log:z.array(z.object({user_id:z.union([z.string(),z.number()]),total:z.number().nonnegative(),gifts:z.array(gift).max(10000)})).max(10000),catalog:z.array(z.object({id:z.union([z.string(),z.number()]),name:z.string().max(300),point:z.number().nonnegative().nullable(),gold:z.number().nonnegative().optional(),free:z.boolean(),img:z.string().max(2000)})).max(2000),recordings:z.array(z.object({run:z.string().regex(/^\d{1,13}$/),url:z.string().max(2000),bytes:z.number().int().nonnegative(),partial:z.boolean(),duration_ms:z.number().int().nonnegative().optional()})).max(500).default([]),frames:z.array(z.number().int().nonnegative()).max(15000),capture:z.object({status:z.enum(['live','completed']),observed_since:date,gifts_status:z.enum(['collecting','partial','unavailable']),gifts_source:z.string().max(100),gifts_error:z.string().max(100).nullable().optional(),last_gift_event:date.nullable().optional(),disconnects:z.number().int().nonnegative(),screenshot_errors:z.number().int().nonnegative(),screenshots_allowed:z.boolean()})});
function equal(a,b){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store'}});}
export async function collectorResponse(request,bindings,execution){
 const leaderboard=await serveLeaderboard(request,bindings);if(leaderboard)return leaderboard;
 const player=playerResponse(request);if(player)return player;
 const url=new URL(request.url),publicMedia=url.pathname.startsWith('/media/live/');
 if(!publicMedia&&!url.pathname.startsWith('/internal/collector/'))return null;
 if(publicMedia){
  const match=/^\/media\/live\/([a-zA-Z0-9_-]{1,160})\/(\d{1,13}\.jpg|video-\d{1,13}\.(?:mp4|m3u8))$/.exec(url.pathname);
  if(!match||(url.search&&(url.searchParams.size!==1||url.searchParams.get('v')!=='2'||!match[2].endsWith('.mp4'))))return json({message:'Invalid screenshot path'},400);
  if(!['GET','HEAD'].includes(request.method))return json({message:'Method not allowed'},405);
  const key='live-screenshots/'+match[1]+'/'+match[2].replace(/\.m3u8$/,'.mp4');
  const metadata=await bindings.IMAGES_BUCKET.head(key);if(!metadata)return json({message:'Media not found'},404);
  if(match[2].endsWith('.m3u8')){
   const index=await durationHeader(bindings.IMAGES_BUCKET,key,metadata);if(!index?.segments?.length)return json({message:'Recording index unavailable'},422);
   const source=url.origin+url.pathname.replace(/\.m3u8$/,'.mp4');const lines=['#EXTM3U','#EXT-X-VERSION:7','#EXT-X-PLAYLIST-TYPE:VOD','#EXT-X-TARGETDURATION:'+Math.ceil(Math.max(...index.segments.map(s=>s.duration))),'#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-MAP:URI="'+source+'",BYTERANGE="'+index.init_length+'@0"'];
   for(const segment of index.segments){lines.push('#EXTINF:'+segment.duration.toFixed(6)+',','#EXT-X-BYTERANGE:'+segment.length+'@'+segment.offset,source)}lines.push('#EXT-X-ENDLIST');
   return new Response(request.method==='HEAD'?null:lines.join('\n')+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl','Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'}});
  }
  let offset=0,length=metadata.size,status=200;const range=request.headers.get('Range');if(range){const r=/^bytes=(\d*)-(\d*)$/.exec(range);if(!r||(!r[1]&&!r[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+metadata.size}});if(r[1]){offset=Number(r[1]);length=(r[2]?Math.min(Number(r[2]),metadata.size-1):metadata.size-1)-offset+1;}else{length=Math.min(Number(r[2]),metadata.size);offset=metadata.size-length;}if(offset>=metadata.size||length<=0)return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+metadata.size}});status=206;}
  const object=await bindings.IMAGES_BUCKET.get(key,status===206?{range:{offset,length}}:undefined);
  if(!object)return json({message:'Screenshot not found'},404);
  const patch=match[2].endsWith('.mp4')&&offset<262144?await durationHeader(bindings.IMAGES_BUCKET,key,metadata):null;
  const headers=new Headers({'Content-Type':match[2].endsWith('.mp4')?'video/mp4':'image/jpeg','Accept-Ranges':'bytes','X-Media-Storage':'r2','ETag':match[2].endsWith('.mp4')?'"'+object.etag+'-duration-v1"':object.httpEtag,'Cache-Control':match[2].endsWith('.mp4')?'public, max-age=0, must-revalidate':'public, max-age=86400','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
  if(!range&&request.headers.get('If-None-Match')===headers.get('ETag'))return new Response(null,{status:304,headers});
  headers.set('Content-Length',String(length));if(status===206)headers.set('Content-Range',`bytes ${offset}-${offset+length-1}/${metadata.size}`);return new Response(request.method==='HEAD'?null:patchDurationStream(object.body,offset,patch),{status,headers});
 }
 const env=await effectiveBindings(bindings),expected='Bearer '+String(env.COLLECTOR_TOKEN||'');
 if(!env.COLLECTOR_TOKEN||!equal(request.headers.get('Authorization')||'',expected))return json({message:'Unauthorized'},401);
 try{return await runWithEnv({...env,REQUEST_ORIGIN:url.origin},execution,async()=>{
  const leaderboard=await leaderboardOperation(request,bindings);if(leaderboard)return leaderboard;
  if(url.pathname==='/internal/collector/config'&&request.method==='GET'){
   const members=await IdolMember.find({group:'jkt48','info.is_graduate':{$ne:true}}).lean();
   return json({idnAuth:await idnCollectorAuth(env),enabled:env.COLLECTOR_ENABLED!=='false',pollSeconds:Number(env.COLLECTOR_POLL_SECONDS||30),screenshotSeconds:Number(env.COLLECTOR_SCREENSHOT_SECONDS||60),screenshotWidth:Number(env.COLLECTOR_SCREENSHOT_WIDTH||640),maxSessions:Number(env.COLLECTOR_MAX_SESSIONS||6),recordVideo:env.COLLECTOR_RECORD_VIDEO!=='false',screenshotsEnabled:env.DISABLE_SCREENSHOTS!=='true',members:members.map(m=>({id:m._id,name:m.name,nicknames:m.info?.nicknames||[],room_id:m.showroom_id,idn_username:m.idn?.username,img:m.info?.img,slug:m.slug}))});
  }
  if(url.pathname==='/internal/collector/heartbeat'&&request.method==='POST'){
   const value=z.object({active:z.number().int().nonnegative(),pending:z.number().int().nonnegative(),showroom_ok:z.boolean(),idn_ok:z.boolean(),version:z.string().max(40),telemetry:z.object({pid:z.number().int().positive(),uptime_seconds:z.number().nonnegative(),last_archive:z.number().nonnegative(),last_completed:z.number().nonnegative(),archive_errors:z.number().int().nonnegative(),sessions:z.array(z.object({data_id:ident,name:z.string().max(300),type:z.enum(['showroom','idn']),completed:z.boolean(),last_seen:z.number(),last_screenshot:z.number(),screenshot_errors:z.number().int().nonnegative(),screenshots_allowed:z.boolean(),stream_available:z.boolean(),video:z.object({status:z.enum(['waiting','starting','recording','finalizing','completed','error']),bytes:z.number().nonnegative(),parts:z.number().int().nonnegative(),last_part:z.number(),errors:z.number().int().nonnegative()}),last_archive:z.number(),archive_error:z.boolean()})).max(100)}).optional()}).parse(await request.json());
   await bindings.DB.prepare('INSERT INTO collector_state(name,value,updated_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind('vps',JSON.stringify(value),Date.now()).run();return json({ok:true});
  }
  if(url.pathname==='/internal/collector/video/repair'&&request.method==='POST'){const data=z.object({data_id:ident,run:z.string().regex(/^\d{1,13}$/)}).parse(await request.json());const result=await repairVideo(bindings,data.data_id,data.run);return json(result,result.missing?404:200);}
  if(url.pathname==='/internal/collector/video/start'&&request.method==='POST'){
   const data=z.object({data_id:ident,run:z.string().regex(/^\d{1,13}$/)}).parse(await request.json());const key='live-screenshots/'+data.data_id+'/video-'+data.run+'.mp4';const upload=await bindings.IMAGES_BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:'video/mp4',cacheControl:'public, max-age=86400'}});const id=crypto.randomUUID();await bindings.DB.prepare('INSERT INTO collector_video_uploads(id,data_id,run,object_key,upload_id,updated_at) VALUES(?,?,?,?,?,?)').bind(id,data.data_id,data.run,key,upload.uploadId,Date.now()).run();return json({id});
  }
  const videoPart=/^\/internal\/collector\/video\/part\/([a-f0-9-]{36})\/(\d{1,5})$/.exec(url.pathname);
  if(videoPart&&request.method==='PUT'){
   const partNumber=Number(videoPart[2]);if(partNumber<1||partNumber>10000||Number(request.headers.get('Content-Length'))>8*1024*1024)return json({message:'Invalid video part'},413);const row=await bindings.DB.prepare('SELECT * FROM collector_video_uploads WHERE id=?').bind(videoPart[1]).first();if(!row)return json({message:'Upload not found'},404);const bytes=await request.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>8*1024*1024)return json({message:'Invalid part size'},413);const part=await bindings.IMAGES_BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).uploadPart(partNumber,bytes);await bindings.DB.prepare('UPDATE collector_video_uploads SET parts=json_set(parts,?,json(?)),updated_at=? WHERE id=?').bind('$.p'+partNumber,JSON.stringify(part),Date.now(),row.id).run();return json({part});
  }
  if(['/internal/collector/video/finish','/internal/collector/video/abort'].includes(url.pathname)&&request.method==='POST'){
   const data=z.object({id:z.string().uuid(),parts:z.array(z.object({partNumber:z.number().int(),etag:z.string()})).max(10000).optional()}).parse(await request.json());const row=await bindings.DB.prepare('SELECT * FROM collector_video_uploads WHERE id=?').bind(data.id).first();if(!row)return json({message:'Upload not found'},404);const upload=bindings.IMAGES_BUCKET.resumeMultipartUpload(row.object_key,row.upload_id);if(url.pathname.endsWith('/abort'))await upload.abort();else{const parts=Object.values(JSON.parse(row.parts)).sort((a,b)=>a.partNumber-b.partNumber);if(!parts.length||parts.some((p,i)=>p.partNumber!==i+1)||JSON.stringify(parts)!==JSON.stringify(data.parts))return json({message:'Incomplete video parts'},400);await upload.complete(parts);}await bindings.DB.prepare('DELETE FROM collector_video_uploads WHERE id=?').bind(row.id).run();return json({ok:true,url:url.origin+'/media/live/'+row.data_id+'/video-'+row.run+'.mp4'});
  }
  const match=/^\/internal\/collector\/screenshot\/([a-zA-Z0-9_-]{1,160})\/(\d{1,13})$/.exec(url.pathname);
  if(match&&request.method==='PUT'){
   if(Number(request.headers.get('Content-Length'))>1500000)return json({message:'Image too large'},413);
   const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length>1500000||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)return json({message:'JPEG required'},400);
   await bindings.IMAGES_BUCKET.put('live-screenshots/'+match[1]+'/'+match[2]+'.jpg',bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'public, max-age=86400'}});return json({ok:true,url:url.origin+'/media/live/'+match[1]+'/'+match[2]+'.jpg'});
  }
  if(url.pathname==='/internal/collector/archive'&&request.method==='PUT'){
   if(Number(request.headers.get('Content-Length'))>2000000)return json({message:'Archive too large'},413);
   const text=await request.text();if(text.length>2000000)return json({message:'Archive too large'},413);
   const row=schema.parse(JSON.parse(text));const store=createSourceStore(bindings.DB);
   const end=new Date(row.date.end),start=new Date(row.date.start);if(end<start)return json({message:'Invalid session dates'},400);
   let member=row.member_id?await IdolMember.findById(row.member_id).lean():null;
   if(member&&member.group!=='jkt48')return json({message:'Invalid member'},400);
   const oldRoom=await Showroom.findOne({room_id:row.room_id}).lean();
   const roomPatch={name:member?.name||row.name,img:member?.info?.img||row.img,url:row.url_key,room_exists:true,group:'jkt48',...(member?{member_data:member._id}:{})};
   if(!oldRoom||member||row.type==='showroom')store.upsert(Showroom,{room_id:row.room_id},roomPatch);
   if(member){const patch={};if(row.type==='showroom')patch.showroom_id=row.room_id;else if(row.idn)patch['idn.username']=row.idn.username;patch.collector_room_ids=[...new Set([...(member.collector_room_ids||[]),row.room_id])];store.upsert(IdolMember,{_id:member._id},patch);}
   for(const item of row.catalog){if(row.type==='showroom')store.upsert(ShowroomGift,{gift_id:Number(item.id)},{gift_name:item.name,point:item.point||0,free:item.free,image:item.img});else store.upsert(IDNGift,{slug:String(item.id)},{name:item.name,gold:item.gold??item.point??0,...(item.img?{image_url:item.img}:{})});}
   const previous=await LiveLog.findOne({data_id:row.data_id}).select({capture:1,recordings:1}).lean();
   if(previous?.capture?.status==='completed'&&row.capture.status==='live')return json({message:'Session already completed'},409);
   const total=row.gift_log.reduce((n,user)=>n+user.total,0);
   const screenshot={folder:'live-screenshots/'+row.data_id,format:'jpg',list:row.frames,base_url:url.origin+'/media/live/'+row.data_id};
   store.upsert(LiveLog,{data_id:row.data_id},{live_id:row.live_id,room_id:row.room_id,type:row.type,is_dev:false,created_at:row.date.end,total_gifts:total,c_gift:total,gift_rate:row.type==='showroom'?1:0,...(row.idn?{idn:row.idn}:{}),capture:row.capture,recordings:row.recordings.map(r=>({...r,bytes:Math.max(r.bytes,previous?.recordings?.find(old=>old.run===r.run)?.bytes||0),url:url.origin+'/media/live/'+row.data_id+'/video-'+r.run+'.mp4',stream_url:url.origin+'/media/live/'+row.data_id+'/video-'+r.run+'.m3u8',player_url:url.origin+'/replay/'+row.data_id+'/'+r.run})),live_info:{date:row.date,duration:end-start,viewers:{peak:row.viewers,active:row.viewers},comments:{num:row.comments,users:row.users.filter(u=>u.comments>0).length},screenshots:screenshot},gift_data:{gift_log:row.gift_log,gift_id_list:row.catalog.map(g=>g.id),free_gifts:[]}});
   store.upsert(UserLog,{data_id:row.data_id},{users:row.users,created_at:row.date.end});await store.flush();
   await bindings.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/recent%' OR key LIKE '%/api/screenshots%' OR key LIKE '%/api/member%' OR key LIKE '%memberv8'").run();
   return json({ok:true,data_id:row.data_id,status:row.capture.status,frames:row.frames.length});
  }
  return json({message:'Endpoint not found'},404);
 });}catch(error){return json({message:error instanceof z.ZodError?'Invalid collector payload':'Collector operation failed'},error instanceof z.ZodError||error instanceof SyntaxError?400:500);}
}
export async function cleanupCollectorUploads(bindings){
 const {results}=await bindings.DB.prepare('SELECT id,object_key,upload_id FROM collector_video_uploads WHERE updated_at<? LIMIT 20').bind(Date.now()-86400000).all();
 for(const row of results){try{await bindings.IMAGES_BUCKET.resumeMultipartUpload(row.object_key,row.upload_id).abort();await bindings.DB.prepare('DELETE FROM collector_video_uploads WHERE id=?').bind(row.id).run();}catch{}}
}
