// Runs independently of capture; only PNG screenshots are uploaded, directly from RAM.
const puppeteer=require('puppeteer-core');
const {request:fetch}=require('./live-notification-http.cjs');
const {renderNotification}=require('./live-notification-template.cjs');
const {notificationPhotoURL}=require('./live-notification-media.cjs');
const origin=new URL(process.env.COLLECTOR_API_URL||'https://api.jkt48connect.app').origin;
const transport=new URL(process.env.COLLECTOR_API_TRANSPORT_URL||origin).origin;
const mediaOrigin=new URL(process.env.COLLECTOR_MEDIA_TRANSPORT_URL||origin).origin;
const token=process.env.COLLECTOR_TOKEN;
async function api(path,options={}){
 let failure;
 for(const base of [...new Set([transport,origin])]){
  try{const r=await fetch(base+'/internal/collector/live-notifications/'+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(20000)});
   if(!r.ok)throw Error('API status '+r.status);return await r.json();
  }catch(error){failure=error;if(/^API status/.test(error.message))throw error}
 }
 throw failure;
}
async function photoData(source){
 const u=notificationPhotoURL(source,origin);
 // Only our own media origin is rewritten. Never send collector credentials to image hosts.
 if([origin,'https://apitest.jkt48connect.com'].includes(u.origin)&&u.pathname.startsWith('/media/')){u.host=new URL(mediaOrigin).host;}
 const allowed=new Set([new URL(origin).host,new URL(mediaOrigin).host,'jkt48.com','www.jkt48.com','cdn.idn.app','cdn.idn.media','cdn.idntimes.com','image.showroom-live.com','image2.showroom-live.com','image.showroom-cdn.com']);
 if(!allowed.has(u.host))throw Error('Unsupported image host');
 let r;try{r=await fetch(u,{signal:AbortSignal.timeout(15000)})}catch(error){if(u.origin!==mediaOrigin)throw error;u.host=new URL(origin).host;r=await fetch(u,{signal:AbortSignal.timeout(15000)})}const type=(r.headers.get('content-type')||'').split(';')[0];
 if(!r.ok||!['image/jpeg','image/png','image/webp'].includes(type)||Number(r.headers.get('content-length'))>8000000)throw Error('Image unavailable');
 const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>8000000)throw Error('Image too large');chunks.push(chunk)}
 return 'data:'+type+';base64,'+Buffer.concat(chunks).toString('base64');
}
async function render(browser,job){
 const banner=job.layout==='banner',playful=job.theme==='avonera48',width=playful?(banner?2400:1800):(banner?1600:1080),height=playful?(banner?1350:2400):(banner?900:1350);
 const photo=await photoData(job.snapshot.img),page=await browser.newPage();
 try{
  await page.setViewport({width,height,deviceScaleFactor:1});await page.setRequestInterception(true);
  page.on('request',request=>{const u=new URL(request.url());if(u.protocol==='data:'||(u.protocol==='file:'&&(u.pathname===__dirname+'/live-notification-shell.html'||u.pathname.startsWith(__dirname+'/fonts/')||u.pathname.startsWith('/usr/share/fonts/'))))request.continue();else request.abort()});
  await page.goto('file://'+__dirname+'/live-notification-shell.html');
  await page.setContent(renderNotification(job.snapshot,{...job,photo}),{waitUntil:'domcontentloaded',timeout:30000});
  await page.evaluate(async()=>{await document.fonts.ready;if(!document.fonts.check('500 16px Geist')||!document.fonts.check('400 16px Mono'))throw Error('Font unavailable');await Promise.all([...document.images].map(i=>i.decode()));
   for(const el of document.querySelectorAll('.red-stage h1,.book-copy h1,.live-copy h1,.live-identity h2')){let size=parseFloat(getComputedStyle(el).fontSize);while(el.scrollWidth>el.clientWidth+1&&size>48){size-=2;el.style.fontSize=size+'px'}}
  });
  const image=await page.screenshot({type:'png',clip:{x:0,y:0,width,height}});
  await api(job.data_id+'/'+job.source_version+'?theme='+job.theme+'&layout='+job.layout,{method:'PUT',headers:{'Content-Type':'image/png','X-Render-Token':job.render_token},body:image});
  console.log('notification-ready id='+job.data_id+' theme='+job.theme+' layout='+job.layout+' bytes='+image.length);
 }finally{await page.close()}
}
async function main(){
 if(!token)throw Error('Missing collector credential');
 console.log('notification-check transport='+transport);
 // Check for work before allocating a Chrome process.
 const formats=[['jkt48connect','portrait'],['jkt48connect','banner'],['photobook','portrait'],['photobook','banner'],['avonera48','portrait'],['avonera48','banner']];let browser;
 try{for(let round=0;round<3;round++)for(const [theme,layout]of formats){const {job}=await api('jobs?theme='+theme+'&layout='+layout);if(!job)continue;
  try{browser||=await puppeteer.launch({executablePath:process.env.COLLECTOR_CHROME_PATH||'/opt/jkt48-live-collector/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--allow-file-access-from-files','--disk-cache-size=0','--media-cache-size=0']});await render(browser,job)}catch(error){if(browser){await browser.close().catch(()=>{});browser=null}console.error('notification-retry id='+job.data_id+' reason='+(String(error.message||error.name).split('\n')[0].replace(/https?:\/\/\S+/g,'[url]').slice(0,180)));await api('error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data_id:job.data_id,render_token:job.render_token})})}
 }}finally{if(browser)await browser.close()}
}
if(require.main===module)main().catch(error=>{console.error('notification-worker-unavailable reason='+(/^API status [0-9]{3}$/.test(error.message)?error.message:String(error.cause?.code||error.name))); process.exitCode=1});
module.exports={photoData,render};
