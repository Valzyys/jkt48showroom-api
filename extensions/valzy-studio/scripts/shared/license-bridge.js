// Translate only per-customer license credentials. All product operations and
// provider validation remain unchanged; no generation API key is present here.
(function(){
 const original=globalThis.fetch.bind(globalThis),provider='https://io.eklas.dev',gateway='https://api.jkt48connect.app/license/v1/validate';
 const normalize=k=>String(k||'').trim().toUpperCase().replace(/\s+/g,'');
 const aliases={};
 const cache=chrome.storage.local.get('valzy_license_credentials').then(v=>Object.assign(aliases,v.valzy_license_credentials||{}));
 chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.valzy_license_credentials){for(const key of Object.keys(aliases))delete aliases[key];Object.assign(aliases,changes.valzy_license_credentials.newValue||{})}});
 globalThis.fetch=async function(input,options){
  const address=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  if(address===gateway){
   const response=await original(input,options);
   if(response.ok){const result=await response.clone().json().catch(()=>null);if(result?.ok&&result.upstream_license){const body=JSON.parse(options?.body||'{}'),aliases=await cache;aliases[normalize(body.key||body.licenseKey)]=result.upstream_license;await chrome.storage.local.set({valzy_license_credentials:aliases})}}
   return response;
  }
  const url=new URL(address);if(url.origin!==provider||!url.pathname.startsWith('/api/v1/'))return original(input,options);
  const aliases=await cache,init={...options},headers=new Headers(options?.headers||(input instanceof Request?input.headers:undefined));
  const key=headers.get('X-License-Key');if(key&&aliases[normalize(key)])headers.set('X-License-Key',aliases[normalize(key)]);
  if(typeof init.body==='string'&&(headers.get('Content-Type')||'').includes('application/json')){
   try{const body=JSON.parse(init.body);for(const field of ['key','licenseKey'])if(body[field]&&aliases[normalize(body[field])])body[field]=aliases[normalize(body[field])];init.body=JSON.stringify(body)}catch{}
  }
  init.headers=headers;return original(input,init);
 };
})();
