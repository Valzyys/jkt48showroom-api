import { JKT48SourceError } from './jkt48-source.js';

export function scrapeTarget(input,config={},index=0) {
  const url=new URL(input),ssk=url.hostname==='ssk.jkt48.com';
  if(url.protocol!=='https:'||!['jkt48.com','ssk.jkt48.com'].includes(url.hostname))throw new Error('Invalid JKT48 scrape target');
  const prefixes=String(ssk?config.SSK_SCRAPE_URL||'':config.JKT48_SCRAPE_URL||'').split(',').map(value=>value.trim()).filter(Boolean);
  if(!prefixes.length)return url.href;
  const prefix=prefixes[index%prefixes.length];
  const relay=new URL(prefix);
  if(relay.protocol!=='https:'||relay.username||relay.password)throw new Error('Scrape relay must use HTTPS');
  return prefix+url.href.slice(url.origin.length+1);
}
export function jkt48SourceTarget(input,config={},index=0) {
  const url=new URL(input);
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('JKT48 API target must use HTTPS');
  const prefix=String(config.JKT48_PROXY_URL||'').trim();
  if(!prefix)return url.hostname==='jkt48.com'?scrapeTarget(url.href,config,index):url.href;
  const target=prefix.includes('{url}')?prefix.replaceAll('{url}',encodeURIComponent(url.href)):prefix+url.href;
  const relay=new URL(target);
  if(relay.protocol!=='https:'||relay.username||relay.password)throw new Error('JKT48 proxy must use HTTPS without embedded credentials');
  return relay.href;
}
export function createJKT48Transport(config={},fetcher=(input,init)=>globalThis.fetch(input,init)) {
  const scraper=String(config.JKT48_SCRAPER_URL||'').trim();
  if(!scraper) {
    let index=0;
    return {base:config.JKT48_API_BASE||'https://jkt48.com/api/v1/',fetcher:(url,init)=>fetcher(jkt48SourceTarget(url,config,index++),init)};
  }
  const invalid=()=>new JKT48SourceError('Configure an HTTPS JKT48_SCRAPER_URL and a private JKT48_SCRAPER_TOKEN of at least 32 characters',{status:503,code:'JKT48_SOURCE_CONFIGURATION_ERROR'});
  let base;try{base=new URL(scraper.endsWith('/')?scraper:scraper+'/');}catch{throw invalid();}
  const token=String(config.JKT48_SCRAPER_TOKEN||'');
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||token.length<32||token.length>256||!/^[\x21-\x7e]+$/.test(token))throw invalid();
  return {base:base.href,fetcher:async(url,init={})=>{
    const target=new URL(url);
    if(target.origin!==base.origin||!target.pathname.startsWith(base.pathname))throw invalid();
    const headers=new Headers(init.headers);
    headers.delete('Cookie');headers.delete('User-Agent');headers.set('Authorization','Bearer '+token);
    const response=await fetcher(target.href,{...init,headers,redirect:'manual'});
    if(response.status>=300&&response.status<400) {
      await response.body?.cancel();
      throw new JKT48SourceError('The private VPS scraper redirected the request. Configure its final HTTPS API URL.',{status:502,code:'JKT48_SCRAPER_REDIRECT_ERROR'});
    }
    return response;
  }};
}
