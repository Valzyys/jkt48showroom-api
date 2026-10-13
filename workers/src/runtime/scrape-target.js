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
