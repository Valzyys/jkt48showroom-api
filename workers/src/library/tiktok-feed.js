import {env} from '../runtime/env.js';
export async function publicTikTokFeed(path,query={}){
 if(!/^\/(?:status|members|posts|updates|search|post\/\d{15,22})$/.test(path))throw Object.assign(Error('Invalid TikTok archive path'),{status:400});
 if(!env.TIKTOK_FEED_URL||!env.TIKTOK_FEED_TOKEN)throw Object.assign(Error('TikTok collector is not configured'),{status:503});
 const target=new URL(env.TIKTOK_FEED_URL.replace(/\/$/,'')+path);
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('Invalid TikTok relay'),{status:503});
 for(const key of ['member','limit','before','after','q'])if(query[key]!==undefined){if(String(query[key]).length>200)throw Object.assign(Error('Parameter terlalu panjang'),{status:400});target.searchParams.set(key,query[key])}
 let response;try{response=await fetch(target,{headers:{Authorization:'Bearer '+env.TIKTOK_FEED_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)})}catch{throw Object.assign(Error('TikTok archive is temporarily unreachable'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Unexpected TikTok relay redirect'),{status:502});
 let data;try{data=await response.json()}catch{throw Object.assign(Error('Invalid TikTok relay response'),{status:502})}
 if(!response.ok)throw Object.assign(Error(data.message||'TikTok archive unavailable'),{status:response.status});return data;
}
