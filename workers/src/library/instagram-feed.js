import {env} from '../runtime/env.js';
export async function publicInstagramFeed(path,query={}){
 if(!/^\/(?:status|members|posts|updates|search|post\/[A-Za-z0-9_-]{5,24}|profile\/[A-Za-z0-9._-]{1,100})$/.test(path))throw Object.assign(Error('Invalid Instagram archive path'),{status:400});
 if(!env.INSTAGRAM_FEED_URL||!env.INSTAGRAM_FEED_TOKEN)throw Object.assign(Error('Instagram collector is not configured'),{status:503});
 const target=new URL(env.INSTAGRAM_FEED_URL.replace(/\/$/,'')+path);
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('Invalid Instagram relay'),{status:503});
 for(const key of ['member','limit','before','after','q'])if(query[key]!==undefined){if(String(query[key]).length>200)throw Object.assign(Error('Parameter terlalu panjang'),{status:400});target.searchParams.set(key,query[key])}
 let response;try{response=await fetch(target,{headers:{Authorization:'Bearer '+env.INSTAGRAM_FEED_TOKEN,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000)})}catch{throw Object.assign(Error('Instagram archive is temporarily unreachable'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Unexpected Instagram relay redirect'),{status:502});
 let data;try{data=await response.json()}catch{throw Object.assign(Error('Invalid Instagram relay response'),{status:502})}
 if(!response.ok)throw Object.assign(Error(data.message||'Instagram archive unavailable'),{status:response.status});return data;
}
