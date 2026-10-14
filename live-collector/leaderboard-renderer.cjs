// A separate, bounded process: recording and chat collectors are never restarted for cards.
const puppeteer=require('puppeteer-core'),template=require('./leaderboard-template.cjs'),banner=require('./leaderboard-banner.cjs');
const origin=new URL(process.env.COLLECTOR_API_URL||'https://api.jkt48connect.app').origin,token=process.env.COLLECTOR_TOKEN;
const allowed=new Set([new URL(origin).hostname,'cdn.idn.media','cdn.idntimes.com','static.showroom-live.com','image.showroom-live.com','image2.showroom-live.com','image.showroom-cdn.com']);
let browser;
async function api(path,options={}){return fetch(origin+'/internal/collector/leaderboards/'+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(60000)})}
async function render(job){
 const landscape=job.layout==='banner',width=landscape?1600:1200;
 const page=await browser.newPage();try{
  await page.setViewport({width,height:landscape?900:1600,deviceScaleFactor:1.5});await page.setRequestInterception(true);
  page.on('request',r=>{const u=new URL(r.url());if((u.protocol==='https:'&&allowed.has(u.hostname))||(u.protocol==='file:'&&(u.pathname.startsWith('/usr/share/fonts/')||u.pathname===__dirname+'/leaderboard-shell.html'))||u.protocol==='data:')r.continue();else r.abort()});
  await page.goto('file://'+__dirname+'/leaderboard-shell.html');
  const shots=job.detail.live_info?.screenshot;
  if(shots?.list?.length){
   const candidates=[...new Set(Array.from({length:Math.min(shots.list.length,12)},(_,i)=>shots.list[Math.round((shots.list.length-1)*(i+.5)/Math.min(shots.list.length,12))]))];
   const frames=await page.evaluate(async({candidates,base,format})=>{
    const found=await Promise.all(candidates.map(async id=>{try{const image=new Image();image.crossOrigin='anonymous';image.src=base+'/'+id+'.'+format;await Promise.race([image.decode(),new Promise((_,reject)=>setTimeout(reject,8000))]);const canvas=document.createElement('canvas');canvas.width=32;canvas.height=32;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,32,32);const data=ctx.getImageData(0,0,32,32).data;let total=0,squares=0,lit=0;for(let i=0;i<data.length;i+=4){const value=(data[i]+data[i+1]+data[i+2])/3;total+=value;squares+=value*value;if(value>16)lit++}const mean=total/1024,variance=squares/1024-mean*mean;return mean>12&&mean<245&&variance>40&&lit>180?id:null}catch{return null}}));return found.filter(v=>v!==null).sort((a,b)=>a-b);
   },{candidates,base:shots.base_url,format:shots.format});
   job.detail.leaderboard_data.selected_frames=[...new Set([.15,.5,.85].map(f=>frames[Math.floor((frames.length-1)*f)]))].filter(Number.isFinite);
  }
  await page.setContent((landscape?banner:template)(job.detail),{waitUntil:'networkidle0',timeout:45000});await page.evaluate(()=>document.fonts.ready);
  const missing=await page.evaluate(async()=>{await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));return Array.from(document.images).filter(i=>i.dataset.required==='true'&&!(i.complete&&i.naturalWidth)).length});if(missing)throw Error('Source image unavailable');await page.evaluate(()=>{for(const img of document.images)if(!img.naturalWidth)img.style.visibility='hidden'});
  const height=await page.evaluate(()=>Math.ceil(document.querySelector('main').getBoundingClientRect().height));if(height>(landscape?900:2400))throw Error('Layout overflow');
  const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('.content,.identity,.ranks,.spread')).some(el=>el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1));if(overflow)throw Error('Layout overflow');
  const image=await page.screenshot({type:'png',clip:{x:0,y:0,width,height}});const result=await api(job.data_id+'/'+job.source_version+'?layout='+(job.layout||'portrait'),{method:'PUT',headers:{'Content-Type':'image/png','X-Render-Token':job.render_token},body:image});if(!result.ok)throw Error('Upload failed');console.log('leaderboard-ready layout='+(job.layout||'portrait')+' id='+job.data_id+' bytes='+image.length);
 }finally{await page.close()}
}
(async()=>{
 if(!token)throw Error('Missing collector credential');
 browser=await puppeteer.launch({executablePath:process.env.COLLECTOR_CHROME_PATH||'/opt/jkt48-live-collector/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--allow-file-access-from-files','--disk-cache-size=0','--media-cache-size=0']});
 try{for(let i=0;i<10;i++){const response=await api('jobs?layout='+(i%2?'banner':'portrait'));if(!response.ok)throw Error('Job lookup failed');const {job}=await response.json();if(!job)continue;try{await render(job)}catch(error){console.log('leaderboard-retry id='+job.data_id+' reason='+(['Source image unavailable','Upload failed','Layout overflow'].includes(error.message)?error.message:error.name));await api('error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_id:job.data_id,render_token:job.render_token})})}}}finally{await browser.close()}
})().catch(()=>{console.error('leaderboard-worker-failed');process.exitCode=1});
