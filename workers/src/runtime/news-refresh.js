export function newsRefreshSeconds(config={}){
 const n=Number(config.JKT48_NEWS_SYNC_SECONDS??15);return Number.isFinite(n)?Math.max(5,Math.min(300,Math.floor(n))):15;
}
export function syncDelayMs(dataset,state={},config={}){
 if(dataset==='news')return (state.error?Math.min(300,30*2**Math.min(Math.max(0,(state.failures||1)-1),4)):newsRefreshSeconds(config))*1000;
 const n=Number(config.JKT48_SYNC_SECONDS??3600),ttl=Number.isFinite(n)?Math.max(300,Math.min(86400,Math.floor(n))):3600;
 return state.error?300000:ttl*1000;
}
export async function armNewsRefresh(storage,state,config={},afterRun=false){
 if(config.JKT48_AUTO_SYNC==='false')return;
 await storage.put('news-watch',true);
 const due=Math.max(Date.now()+1000,(state.attemptedAt||Date.now())+syncDelayMs('news',state,config)),current=await storage.getAlarm();
 // Frequent API readers must not keep moving the next refresh into the future.
 if(afterRun||current===null||current>due)await storage.setAlarm(due);
}
