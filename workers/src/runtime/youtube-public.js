import {createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {env} from './env.js';
const ID=/^[A-Za-z0-9_-]{11}$/;
function relay(bindings,resource){
 const base=String(bindings.JKT48_SCRAPER_URL||'');
 if(!base||!bindings.JKT48_SCRAPER_TOKEN)throw Object.assign(Error('YouTube relay is not configured'),{status:503});
 const target=new URL(resource,base.endsWith('/')?base:base+'/');
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('Invalid YouTube relay'),{status:503});
 return target;
}
export function playback(video,secret,origin='https://api.jkt48connect.app',now=Date.now()){
 if(!ID.test(video)||!secret)return null;
 const expires=Math.floor(now/1000)+10800,ticket=expires+'.'+createHmac('sha256',secret).update('youtube-hls-v2:'+video+':'+expires).digest('base64url');
 return {status:'on_demand',format:'m3u8',mime_type:'application/vnd.apple.mpegurl',includes_audio:true,url:origin+'/media/youtube/'+video+'/'+ticket+'/index.m3u8',expires_at:expires,details_url:origin+'/api/jkt48_youtube/'+video};
}
export async function youtubeVideo(video,{comments=false,cursor}={}){
 if(!ID.test(video))throw Object.assign(Error('Invalid YouTube video ID'),{status:400});
 const target=relay(env,(comments?'youtube-comments/':'youtube-video/')+video);
 if(cursor!==undefined){if(!/^[A-Za-z0-9_-]{43}$/.test(cursor))throw Object.assign(Error('Invalid comments cursor'),{status:400});target.searchParams.set('cursor',cursor)}
 let response;try{response=await fetch(target,{headers:{Authorization:'Bearer '+env.JKT48_SCRAPER_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(45000)})}catch{throw Object.assign(Error('YouTube relay is temporarily unavailable'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Unexpected YouTube relay redirect'),{status:502});
 let data;try{data=await response.json()}catch{throw Object.assign(Error('Invalid YouTube relay response'),{status:502})}
 if(!response.ok)throw Object.assign(Error(data.message||'YouTube source unavailable'),{status:response.status});
 if(!comments){if(data.id!==video||!data.playback?.path?.startsWith('/media/youtube/'+video+'/'))throw Object.assign(Error('Invalid playback response'),{status:502});data.playback.url='https://api.jkt48connect.app'+data.playback.path;delete data.playback.path;data.comments_url='https://api.jkt48connect.app/api/jkt48_youtube/'+video+'/comments'}
 return data;
}
export async function youtubeMedia(request,bindings){
 const url=new URL(request.url);if(!url.pathname.startsWith('/media/youtube/'))return null;
 const json=(message,status)=>Response.json({message},{status,headers:{'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}});
 const match=/^\/media\/youtube\/([A-Za-z0-9_-]{11})\/(\d{10}\.[A-Za-z0-9_-]{43})\/(index\.m3u8|q(?:144|240|360|480|720|1080)\/(?:index\.m3u8|segment-\d{1,13}\.ts))$/.exec(url.pathname);
 if(!match||url.search)return json('Invalid playback path',400);
 const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'Range','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const expires=Number(match[2].split('.')[0]);if(expires<=Date.now()/1000)return json('Playback URL expired; reload video details',410);
 if(!bindings.JKT48_SCRAPER_TOKEN||expires>Date.now()/1000+10860)return json('Invalid playback ticket',403);
 const ticketExpected=playback(match[1],bindings.JKT48_SCRAPER_TOKEN,'', (expires-10800)*1000).url.split('/')[4];
 if(!timingSafeEqual(Buffer.from(match[2]),Buffer.from(ticketExpected)))return json('Invalid playback ticket',403);
 if(!['GET','HEAD'].includes(request.method))return json('Method not allowed',405);
 let response;
 try{response=await fetch(relay(bindings,'youtube-media/'+match[1]+'/'+match[2]+'/'+match[3]),{method:request.method,headers:{Authorization:'Bearer '+bindings.JKT48_SCRAPER_TOKEN},redirect:'manual',signal:AbortSignal.timeout(45000)})}catch{return json('Playback relay is temporarily unavailable',502)}
 if(response.status!==200){await response.body?.cancel();return json(response.status===410?'Playback URL expired; reload video details':'Playback is temporarily unavailable',[400,403,404,410,429,503].includes(response.status)?response.status:502)}
 const expected=match[3].endsWith('.m3u8')?'application/vnd.apple.mpegurl':'video/mp2t';
 if(!response.headers.get('Content-Type')?.startsWith(expected)){await response.body?.cancel();return json('Invalid HLS response',502)}
 const headers=new Headers(cors);for(const name of ['Content-Type','Content-Length','X-Media-Storage'])if(response.headers.has(name))headers.set(name,response.headers.get(name));
 return new Response(request.method==='HEAD'?null:response.body,{status:200,headers});
}
