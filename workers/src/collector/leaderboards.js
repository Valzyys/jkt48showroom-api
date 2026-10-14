import {rewriteMedia} from '../runtime/jkt48-media.js';
import UserLog from '../database/userDB/UserLog.js';
import {getRecentDetails} from '../library/recent/details.js';
const design=2,ident=/^[a-zA-Z0-9_-]{1,160}$/;
const scope="database_name='liveDB' AND collection_name='livelogs'";
export async function leaderboardImages(db,ids,origin){
 if(!ids.length)return new Map();
 const {results}=await db.prepare("SELECT wanted.value AS data_id,layouts.value AS layout,c.state,c.source_version,c.design_version,c.width,c.height,c.updated_at,d.version AS current_version FROM json_each(?) wanted CROSS JOIN json_each('[\"portrait\",\"banner\"]') layouts LEFT JOIN collector_leaderboards c ON c.data_id=wanted.value AND c.layout=layouts.value LEFT JOIN documents d ON d.database_name='liveDB' AND d.collection_name='livelogs' AND json_extract(d.document,'$.data_id')=wanted.value").bind(JSON.stringify(ids)).all();
 const cards=new Map();
 for(const r of results){const ready=r.state==='ready'&&r.source_version===r.current_version&&r.design_version===design;const formats=cards.get(r.data_id)||{};formats[r.layout]={status:ready?'ready':r.state==='error'?'failed':'pending',url:ready?origin+'/media/leaderboards/v'+design+'/'+r.data_id+'/'+r.source_version+(r.layout==='banner'?'-banner':'')+'.png':null,width:ready?r.width:null,height:ready?r.height:null,format:'png',updated_at:r.updated_at?new Date(r.updated_at).toISOString():null};cards.set(r.data_id,formats)}
 return cards;
}
export async function serveLeaderboard(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/leaderboards/'))return null;
 const match=/^\/media\/leaderboards\/(v[12])\/([a-zA-Z0-9_-]{1,160})\/(\d{1,16})(-banner)?\.png$/.exec(url.pathname);
 if(!match||url.search)return new Response('Invalid leaderboard path',{status:400});if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
 const object=await bindings.IMAGES_BUCKET.get('leaderboards/'+match[1]+'/'+match[2]+'/'+match[3]+(match[4]||'')+'.png');if(!object)return new Response('Leaderboard not ready',{status:404,headers:{'Cache-Control':'no-store'}});
 const headers={'Content-Type':'image/png','Content-Length':String(object.size),'Cache-Control':'public, max-age=31536000, immutable','Access-Control-Allow-Origin':'*','X-Media-Storage':'r2','X-Content-Type-Options':'nosniff',ETag:object.httpEtag};if(request.headers.get('If-None-Match')===object.httpEtag)return new Response(null,{status:304,headers});return new Response(request.method==='HEAD'?null:object.body,{headers});
}
export async function leaderboardOperation(request,bindings){
 const url=new URL(request.url),now=Date.now(),layout=url.searchParams.get('layout')||'portrait';
 if(!['portrait','banner'].includes(layout))return Response.json({message:'Invalid layout'},{status:400});
 if(url.pathname==='/internal/collector/leaderboards/jobs'&&request.method==='GET'){
  const candidate=await bindings.DB.prepare(`SELECT d.document,d.version FROM documents d LEFT JOIN collector_leaderboards c ON c.data_id=json_extract(d.document,'$.data_id') AND c.layout=? WHERE d.database_name='liveDB' AND d.collection_name='livelogs' AND json_extract(d.document,'$.data_id') IS NOT NULL AND COALESCE(json_extract(d.document,'$.capture.status'),'completed')='completed' AND COALESCE(json_extract(d.document,'$.is_dev'),0)=0 AND (c.data_id IS NULL OR c.source_version!=d.version OR c.design_version!=? OR c.state!='ready') AND COALESCE(c.lease_until,0)<? ORDER BY json_extract(d.document,'$.live_info.date.end') DESC LIMIT 1`).bind(layout,design,now).first();
  if(!candidate)return Response.json({job:null});const log=JSON.parse(candidate.document),id=log.data_id;if(!ident.test(id))return Response.json({job:null});
  const token=crypto.randomUUID(),claimed=await bindings.DB.prepare("INSERT INTO collector_leaderboards(data_id,layout,source_version,design_version,state,render_token,lease_until,updated_at) VALUES(?,?,?,?,'processing',?,?,?) ON CONFLICT(data_id,layout) DO UPDATE SET source_version=excluded.source_version,design_version=excluded.design_version,state='processing',render_token=excluded.render_token,lease_until=excluded.lease_until,updated_at=excluded.updated_at,last_error=NULL WHERE collector_leaderboards.lease_until<?").bind(id,layout,candidate.version,design,token,now+300000,now,now).run();
  if(!claimed.meta.changes)return Response.json({job:null});
  try{
   const detail=await getRecentDetails({req:{param:()=>id}}),users=(await UserLog.findOne({data_id:id}).lean())?.users||[];
   const supporters=[...(log.gift_data?.gift_log||[])].filter(g=>g.gifts?.length).sort((a,b)=>(b.total||0)-(a.total||0)).map((g,i)=>{const user=users.find(u=>String(u.user_id)===String(g.user_id));return {rank:i+1,name:user?.name||'Penggemar',total:g.total||0,avatar_url:log.type==='showroom'?'https://static.showroom-live.com/image/avatar/'+(user?.avatar_id||1)+'.png':user?.avatar_url||''}});
   detail.leaderboard_data={supporters:supporters.slice(0,5),supporter_count:supporters.length};return Response.json({job:{data_id:id,layout,source_version:candidate.version,render_token:token,detail:rewriteMedia(detail,url.origin)}});
  }catch{
   await bindings.DB.prepare("UPDATE collector_leaderboards SET state='error',last_error='source_unavailable',lease_until=? WHERE data_id=? AND render_token=?").bind(now+300000,id,token).run();return Response.json({message:'Leaderboard data unavailable'},{status:503});
  }
 }
 const upload=/^\/internal\/collector\/leaderboards\/([a-zA-Z0-9_-]{1,160})\/(\d{1,16})$/.exec(url.pathname);
 if(upload&&request.method==='PUT'){
  const id=upload[1],version=Number(upload[2]),token=request.headers.get('X-Render-Token');const row=await bindings.DB.prepare('SELECT * FROM collector_leaderboards WHERE data_id=? AND source_version=? AND render_token=? AND layout=?').bind(id,version,token||'',layout).first();if(!row||row.state!=='processing'||row.lease_until<now)return Response.json({message:'Render lease expired'},{status:409});
  const source=await bindings.DB.prepare(`SELECT version FROM documents WHERE ${scope} AND json_extract(document,'$.data_id')=?`).bind(id).first();if(source?.version!==version){await bindings.DB.prepare("UPDATE collector_leaderboards SET state='pending',lease_until=0 WHERE data_id=? AND render_token=?").bind(id,token).run();return Response.json({message:'Recent changed; render again'},{status:409});}
  if(Number(request.headers.get('Content-Length'))>8388608)return Response.json({message:'Image too large'},{status:413});const bytes=new Uint8Array(await request.arrayBuffer());
  if(bytes.length<24||bytes.length>8388608||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return Response.json({message:'PNG required'},{status:400});
  const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);if(layout==='banner'?(width!==2400||height!==1350):(width!==1800||height<2000||height>3600))return Response.json({message:'Invalid image dimensions'},{status:400});
  const key='leaderboards/v'+design+'/'+id+'/'+version+(layout==='banner'?'-banner':'')+'.png';await bindings.IMAGES_BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/png',cacheControl:'public, max-age=31536000, immutable'}});
  await bindings.DB.prepare("UPDATE collector_leaderboards SET state='ready',object_key=?,width=?,height=?,updated_at=?,lease_until=0,render_token=NULL,last_error=NULL WHERE data_id=? AND render_token=?").bind(key,width,height,now,id,token).run();
  await bindings.DB.prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/recent%'").run();return Response.json({ok:true,url:url.origin+'/media/leaderboards/v'+design+'/'+id+'/'+version+(layout==='banner'?'-banner':'')+'.png'});
 }
 if(url.pathname==='/internal/collector/leaderboards/error'&&request.method==='POST'){
  const data=await request.json();if(!ident.test(data.data_id||''))return Response.json({message:'Invalid ID'},{status:400});await bindings.DB.prepare("UPDATE collector_leaderboards SET state='error',last_error='render_failed',lease_until=?,updated_at=? WHERE data_id=? AND render_token=? AND state='processing'").bind(now+300000,now,data.data_id,String(data.render_token||'')).run();return Response.json({ok:true});
 }
 return null;
}
