/** One bounded anonymous request. stdout is private HTML, stderr contains no URL/token. */
const puppeteer=require('/opt/jkt48-live-collector/node_modules/puppeteer-core');
const target=process.argv[2];
if(!/^https:\/\/www\.tiktok\.com\/embed\/(?:@[A-Za-z0-9._]{2,30}|v2\/\d{15,22})$/.test(target||''))process.exit(2);
(async()=>{let browser;try{
 browser=await puppeteer.launch({executablePath:'/opt/jkt48-live-collector/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 process.once('SIGTERM',()=>void browser.close());
 const page=await browser.newPage();await page.setRequestInterception(true);
 page.on('request',r=>{
  let allowed=false;try{const u=new URL(r.url());allowed=u.protocol==='https:'&&['tiktok.com','tiktokcdn.com','tiktokcdn-us.com','byteoversea.com','ibytedtos.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h))}catch{}
  return !allowed||['image','font','media'].includes(r.resourceType())?r.abort():r.continue();
 });
 await page.goto('https://www.tiktok.com/',{waitUntil:'domcontentloaded',timeout:20000}).catch(()=>{});
 await new Promise(r=>setTimeout(r,5000));
 await page.goto(target,{waitUntil:'domcontentloaded',timeout:25000});
 const document=await page.content();if(Buffer.byteLength(document)>3*1024*1024)throw Error('oversized');
 process.stdout.write(document);
 }finally{await browser?.close()}
})().catch(()=>{process.stderr.write('browser_source_unavailable\n');process.exitCode=1});
