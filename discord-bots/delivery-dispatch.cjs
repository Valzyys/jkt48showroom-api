// Re-select priorities after every send; arrivals never wait for a stale batch.
async function drain({claim,deliver,concurrency=6}){
 const count=Math.max(1,Math.min(6,Math.floor(concurrency)||1));
 await Promise.all(Array.from({length:count},async()=>{
  while(true){const job=claim();if(!job)return;await deliver(job)}
 }));
}
module.exports={drain};
