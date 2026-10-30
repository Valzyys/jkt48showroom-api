const ORIGIN='https://api.jkt48connect.app';
const RETRY_STATUS=new Set([408,500,502,503,504]);
const NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','ENOTFOUND','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT']);
function transportError(error){
 const code=error?.cause?.code||error?.code;
 if(error?.cause?.message==='unexpected redirect')return Error('api_redirect_not_allowed');
 if(error?.name==='TimeoutError'||error?.name==='AbortError')return Object.assign(Error('api_timeout'),{retryable:true,code:'TIMEOUT'});
 if(NETWORK_CODES.has(code))return Object.assign(Error('api_network_'+code),{retryable:true,code});
 if(error instanceof TypeError&&error.message==='fetch failed')return Object.assign(Error('api_network_transport'),{retryable:true,code:'TRANSPORT'});
 return error;
}
function retryAfter(value,now){
 if(!value)return undefined;const seconds=Number(value),ms=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
 return Number.isFinite(ms)&&ms>=0?Math.min(ms,3600000):undefined;
}
class Api{
 constructor({fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,random=Math.random,onRecovery=event=>console.log('api-recovered source='+event.source+' attempts='+event.attempts+' reason='+event.reason)}={}){
  this.cache=new Map();this.inflight=new Map();this.fetcher=fetcher;this.sleep=sleep;this.now=now;this.random=random;this.onRecovery=onRecovery;
  this.metrics={requests:0,retries:0,recovered:0,failures:0};
 }
 async request(path){
  // One retry for idempotent reads. Social cursors get a short shared deadline;
  // larger data responses retain their original 30s first-attempt allowance.
  // Never retry 401/403/404/429, return stale feeds, or alter a notification cursor.
  const feed=/^\/api\/(?:x|tiktok|instagram)\/updates(?:\?|$)/.test(path)||/^\/api\/(?:recent(?:\?|$)|live-notifications(?:\?|$))/.test(path);
  const timeout=feed?10000:30000,deadline=this.now()+(feed?15000:35000);let firstError;
  for(let attempt=0;attempt<2;attempt++){
   try{
    this.metrics.requests++;
    const response=await this.fetcher(ORIGIN+path,{headers:{'X-API-Key':process.env.JKT48CONNECT_API_KEY,Accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(timeout,deadline-this.now()))),redirect:'error'});
    if(!response.ok){
     await response.body?.cancel().catch(()=>{});
     throw Object.assign(Error('api_http_'+response.status),{status:response.status,retryable:RETRY_STATUS.has(response.status),retryAfterMs:retryAfter(response.headers.get('retry-after'),this.now())});
    }
    let value;try{value=await response.json()}catch(error){if(error instanceof SyntaxError)throw Error('api_invalid_json');throw error}
    if(attempt){this.metrics.recovered++;this.onRecovery({source:path.split('/')[2].split('?')[0],attempts:attempt+1,reason:firstError.message});}
    return value;
   }catch(raw){
    const error=transportError(raw);const delay=250+Math.floor(this.random()*250);
    if(attempt===1||!error.retryable||deadline-this.now()<=delay+100){this.metrics.failures++;throw error}
    firstError=error;this.metrics.retries++;await this.sleep(delay);
   }
  }
 }
 async watch(after){
  const response=await this.fetcher(ORIGIN+'/internal/collector/watch?after='+encodeURIComponent(after),{headers:{Authorization:'Bearer '+process.env.COLLECTOR_EVENT_TOKEN},signal:AbortSignal.timeout(28000),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw Error('watch_http_'+response.status)}return Number((await response.json()).revision)||0;
 }
 async get(path,ttl=1000){
  if(typeof path!=='string'||!path.startsWith('/api/')||/[\r\n#]/.test(path))throw Error('invalid_api_path');
  const cached=this.cache.get(path);if(cached&&cached.until>this.now())return cached.value;
  if(this.inflight.has(path))return this.inflight.get(path);
  const task=this.request(path).then(value=>{
   if(ttl>0){for(const[k,v]of this.cache)if(v.until<=this.now())this.cache.delete(k);while(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value);this.cache.set(path,{value,until:this.now()+ttl});}return value;
  });
  this.inflight.set(path,task);try{return await task}finally{this.inflight.delete(path)}
 }
}
const api=new Api();
function rows(data,key){return Array.isArray(data)?data:Array.isArray(data?.[key])?data[key]:Array.isArray(data?.data)?data.data:[]}
module.exports={Api,api,rows,ORIGIN,retryAfter};
