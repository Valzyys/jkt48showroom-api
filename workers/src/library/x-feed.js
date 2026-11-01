import {env} from '../runtime/env.js';
export async function publicXFeed(path,query={}){
 if(!env.X_FEED_URL||!env.X_FEED_TOKEN)throw Object.assign(Error('Public X collector is not configured'),{status:503});
 const target=new URL(env.X_FEED_URL.replace(/\/$/,'')+path);
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('Invalid X feed relay'),{status:503});
 for(const key of ['member','limit','before','after','q','include_replies'])if(query[key]!==undefined){if(String(query[key]).length>200)throw Object.assign(Error('Parameter X terlalu panjang'),{status:400});target.searchParams.set(key,query[key])}
 let response;try{response=await fetch(target,{headers:{Authorization:'Bearer '+env.X_FEED_TOKEN,Accept:'application/json','User-Agent':'JKT48Connect-X-Feed/1.0'},redirect:'manual',signal:AbortSignal.timeout(10000)})}catch{throw Object.assign(Error('Public X collector is temporarily unreachable'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Unexpected X feed relay redirect'),{status:502});
 const data=await response.json();if(!response.ok)throw Object.assign(Error(data.message||'Public X data unavailable'),{status:response.status});return data;
}
