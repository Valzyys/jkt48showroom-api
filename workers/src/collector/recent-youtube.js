import {z} from 'zod';
import {playback,youtubeMedia} from '../runtime/youtube-public.js';
const identifier=z.string().regex(/^(?:sr|idn)-[a-zA-Z0-9_-]{1,150}$/);
const run=z.string().regex(/^\d{1,13}$/);
// 1 November 2026 00:00 WIB. Historical recording URLs stay on R2.
export const YOUTUBE_REPLAY_CUTOFF=Date.parse('2026-10-31T17:00:00.000Z');
export function youtubeReplayEligible(data){
 const start=data?.live_info?.date?.start??data?.started_at;
 return start!=null&&Number.isFinite(new Date(start).getTime())&&new Date(start).getTime()>=YOUTUBE_REPLAY_CUTOFF;
}
const state=z.object({data_id:identifier,run,title:z.string().min(1).max(100),status:z.enum(['pending','uploading','uploaded','failed','needs_review']),youtube_id:z.string().regex(/^[A-Za-z0-9_-]{11}$/).nullable(),privacy:z.enum(['public','unlisted','private']).nullable(),bytes_uploaded:z.number().int().nonnegative(),error:z.string().regex(/^[a-z0-9_:-]{1,100}$/).nullable(),processing_status:z.enum(['processing','succeeded','failed','terminated']).nullable().optional().default(null)});
export async function recentYouTubeMap(db,ids,{origin='https://api.jkt48connect.app',secret,now=Date.now()}={}){
 if(!ids.length)return new Map();
 const {results}=await db.prepare('SELECT data_id,document FROM collector_recent_youtube WHERE data_id IN (SELECT value FROM json_each(?)) ORDER BY run').bind(JSON.stringify(ids)).all();
 const map=new Map();
 for(const row of results){
  const value=JSON.parse(row.document);delete value.data_id;
  value.url=value.youtube_id?'https://www.youtube.com/watch?v='+value.youtube_id:null;
  value.youtube_url=value.url;
  value.playback=value.status==='uploaded'&&value.processing_status==='succeeded'?playback(value.youtube_id,secret,origin,now):null;
  if(value.playback)value.playback.status=value.hls_status||'on_demand';
  value.stream_url=value.playback?.url||null;
  value.playback_status=value.playback?value.hls_status||'on_demand':value.status==='uploaded'?'processing':'pending';
  if(!map.has(row.data_id))map.set(row.data_id,{storage:'youtube',videos:[]});
  map.get(row.data_id).videos.push(value);
 }
 return map;
}
export function youtubeReady(video,now=Date.now()){
 return Boolean(video?.status==='uploaded'&&video.processing_status==='succeeded'&&video.hls_status==='ready'&&video.hls_checked_at>now-86400000&&video.stream_url);
}
export function recentRecordings(recordings,replay,now=Date.now(),data){
 const videos=new Map((replay?.videos||[]).map(v=>[v.run,v]));
 const eligible=youtubeReplayEligible(data);
 return recordings.map(r=>{
  const v=videos.get(r.run);
  if(eligible&&youtubeReady(v,now)&&v.bytes_uploaded===r.bytes)return {...r,storage:'youtube',format:'m3u8',mime_type:'application/vnd.apple.mpegurl',youtube_id:v.youtube_id,youtube_url:v.url,url:v.stream_url,stream_url:v.stream_url,player_url:v.url,playback_status:'ready'};
  if(eligible&&r.storage==='youtube')return {...r,url:null,stream_url:null,storage:'youtube',format:'m3u8',mime_type:'application/vnd.apple.mpegurl',youtube_id:r.youtube_id,youtube_url:'https://www.youtube.com/watch?v='+r.youtube_id,player_url:'https://www.youtube.com/watch?v='+r.youtube_id,playback_status:v?.playback_status||'processing'};
  return {...r,storage:'r2',stream_url:r.index_available===false?null:r.stream_url||r.url?.replace(/\.mp4(?:\?.*)?$/,'.m3u8'),player_url:r.player_url||r.url?.replace(/\/media\/live\/([^/]+)\/video-(\d+)\.mp4(?:\?.*)?$/,'/replay/$1/$2')};
 });
}
export function recentPlayback(data,session,replay){
 if(!youtubeReplayEligible(data))return {};
 const videos=replay?.videos||[],single=videos.length===1?videos[0]:null;
 return {playback:{storage:session.storage,status:session.stream_url?'ready':videos.some(v=>v.status==='uploaded')?'processing':'pending',format:'m3u8',stream_url:session.stream_url,youtube_id:single?.youtube_id||null,youtube_url:single?.youtube_url||null,parts:session.parts}};
}
export async function probeYouTubePlayback(video,b,origin){
 const p=playback(video,b.JKT48_SCRAPER_TOKEN,origin);
 if(!p)return {hls_status:'unavailable',hls_error:'playback_not_configured',hls_qualities:[]};
 try{
  const get=async(url,method='GET')=>{
   const response=await youtubeMedia(new Request(url,{method}),b);
   if(!response?.ok){await response?.body?.cancel();throw Error('playback_http_'+(response?.status||502));}
   return response;
  };
  const master=await(await get(p.url)).text();
  if(!master.startsWith('#EXTM3U'))throw Error('playback_invalid_manifest');
  const qualities=[...master.matchAll(/^q(144|240|360|480|720|1080)\/index\.m3u8$/gm)].map(m=>Number(m[1]));
  if(!qualities.length)throw Error('playback_no_variants');
  const quality=Math.min(...qualities),variantURL=new URL('q'+quality+'/index.m3u8',p.url);
  const variant=await(await get(variantURL)).text();
  const segment=variant.split(/\r?\n/).find(l=>/^segment-\d{1,13}\.ts$/.test(l));
  if(!segment||!variant.includes('#EXT-X-ENDLIST'))throw Error('playback_not_complete');
  await(await get(new URL(segment,variantURL),'HEAD')).body?.cancel();
  return {hls_status:'ready',hls_error:null,hls_qualities:qualities};
 }catch(error){return {hls_status:'unavailable',hls_error:/^playback_[a-z0-9_]+$/.test(error.message)?error.message:'playback_source_unavailable',hls_qualities:[]};}
}
export async function recentYouTubeOperation(request,b){
 const u=new URL(request.url);if(!u.pathname.startsWith('/internal/collector/recent-youtube/'))return null;
 if(u.pathname.endsWith('/manifest')&&request.method==='GET'){
  const offset=Math.max(0,Math.floor(Number(u.searchParams.get('offset'))||0));
  const {results}=await b.DB.prepare(`SELECT json_extract(l.document,'$.data_id') data_id,json_extract(l.document,'$.type') type,
   COALESCE(json_extract(m.document,'$.name'),json_extract(s.document,'$.name')) name,
   json_extract(l.document,'$.idn.title') title,json_extract(l.document,'$.live_info.date.start') started_at,
   json_extract(l.document,'$.live_info.date.end') ended_at,json_extract(l.document,'$.recordings') recordings
   FROM documents l LEFT JOIN documents s ON s.database_name='dcDB' AND s.collection_name='showrooms' AND json_extract(s.document,'$.room_id')=json_extract(l.document,'$.room_id')
   LEFT JOIN documents m ON m.database_name='dcDB' AND m.collection_name='idolmembers' AND m.id=json_extract(s.document,'$.member_data')
   WHERE l.database_name='liveDB' AND l.collection_name='livelogs' AND COALESCE(json_extract(l.document,'$.is_dev'),0)=0
   AND json_extract(l.document,'$.type') IN ('idn','showroom') AND COALESCE(json_extract(s.document,'$.is_group'),0)=0
   AND COALESCE(json_extract(m.document,'$.group'),json_extract(s.document,'$.group'))='jkt48'
   AND json_extract(l.document,'$.capture.status')='completed' AND COALESCE(json_extract(l.document,'$.capture.pending_recordings'),0)=0
   AND json_array_length(l.document,'$.recordings')>0
   ORDER BY json_extract(l.document,'$.live_info.date.end') DESC,l.id LIMIT 50 OFFSET ?`).bind(offset).all();
  const youtube=await recentYouTubeMap(b.DB,results.map(r=>r.data_id));
  return Response.json({items:results.map(r=>({...r,recordings:JSON.parse(r.recordings),youtube_replay:youtube.get(r.data_id)||null})),next_offset:results.length===50?offset+50:null},{headers:{'Cache-Control':'no-store'}});
 }
 if(u.pathname.endsWith('/playback')&&request.method==='POST'){
  const body=await request.text();if(body.length>500)return Response.json({message:'Too large'},{status:413});
  const key=z.object({data_id:identifier,run}).parse(JSON.parse(body));
  const stored=await b.DB.prepare('SELECT document FROM collector_recent_youtube WHERE data_id=? AND run=?').bind(key.data_id,key.run).first();
  if(!stored)return Response.json({message:'Replay not published'},{status:404});
  const video=JSON.parse(stored.document);
  if(video.status!=='uploaded'||video.processing_status!=='succeeded'||!video.youtube_id)return Response.json({available:false,status:'processing'});
  const check=await probeYouTubePlayback(video.youtube_id,b,u.origin),checked=Date.now();
  // Update only playback fields: concurrent transfer/privacy updates must survive.
  await b.DB.prepare("UPDATE collector_recent_youtube SET document=json_set(document,'$.hls_status',?,'$.hls_error',json(?),'$.hls_qualities',json(?),'$.hls_checked_at',?) WHERE data_id=? AND run=? AND json_extract(document,'$.youtube_id')=?").bind(check.hls_status,JSON.stringify(check.hls_error),JSON.stringify(check.hls_qualities),checked,key.data_id,key.run,video.youtube_id).run();
  if(video.hls_status!==check.hls_status)await b.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/recent%'").run();
  return Response.json({available:check.hls_status==='ready',status:check.hls_status,error:check.hls_error,checked_at:checked},{headers:{'Cache-Control':'no-store'}});
 }
 if(u.pathname.endsWith('/state')&&request.method==='POST'){
  const text=await request.text();if(text.length>5000)return Response.json({message:'Too large'},{status:413});
  const value=state.parse(JSON.parse(text));
  const source=await b.DB.prepare("SELECT json_extract(document,'$.type') type,json_extract(document,'$.live_info.date.end') ended_at FROM documents WHERE database_name='liveDB' AND collection_name='livelogs' AND json_extract(document,'$.data_id')=? AND EXISTS(SELECT 1 FROM json_each(document,'$.recordings') WHERE json_extract(value,'$.run')=?)").bind(value.data_id,value.run).first();
  if(!source)return Response.json({message:'Recording not found'},{status:404});
  const due=Date.parse(source.ended_at)+(source.type==='idn'?72*3600*1000:0);
  if(!Number.isFinite(due))return Response.json({message:'End timestamp unavailable'},{status:409});
  if(source.type==='idn'&&Date.now()<due&&value.privacy==='public')return Response.json({message:'IDN embargo active'},{status:409});
  const prior=await b.DB.prepare('SELECT document FROM collector_recent_youtube WHERE data_id=? AND run=?').bind(value.data_id,value.run).first();
  const old=prior?JSON.parse(prior.document):null;
  if(old?.youtube_id&&old.youtube_id!==value.youtube_id)return Response.json({message:'Video identity conflict'},{status:409});
  for(const key of ['hls_status','hls_error','hls_qualities','hls_checked_at'])if(old&&Object.hasOwn(old,key))value[key]=old[key];
  value.public_at=new Date(due).toISOString();
  await b.DB.prepare('INSERT INTO collector_recent_youtube(data_id,run,document,updated_at) VALUES(?,?,?,?) ON CONFLICT(data_id,run) DO UPDATE SET document=excluded.document,updated_at=excluded.updated_at').bind(value.data_id,value.run,JSON.stringify(value),Date.now()).run();
  // Clear response caches, never modify the collector's source document/version.
  if(!old||['status','youtube_id','privacy','processing_status'].some(k=>old[k]!==value[k]))await b.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/recent%'").run();
  return Response.json({ok:true});
 }
 return Response.json({message:'Endpoint not found'},{status:404});
}
