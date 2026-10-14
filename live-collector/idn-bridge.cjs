const puppeteer=require('puppeteer-core'),readline=require('readline'),{parseFrames}=require('./idn-events.cjs');
const pages=new Map();let browser,browserPromise,auth={},maxPages=16,opening=0;const waiting=[];
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function create(value,reserved){
 if(opening>=3)await new Promise(resolve=>waiting.push(resolve));opening++;try{
 if(reserved?.closing)return;
 const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='www.idn.app'||!/^\/[a-zA-Z0-9_-]+\/live\/[a-zA-Z0-9_-]+$/.test(url.pathname))return;
 browser=await(browserPromise ||= puppeteer.launch({executablePath:process.env.COLLECTOR_CHROME_PATH||'/opt/jkt48-live-collector/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--mute-audio','--disk-cache-size=0','--media-cache-size=0','--renderer-process-limit=8']}));
 const entry=reserved||pages.get(value.id)||{url:value.url,id:value.id,lastEvent:Date.now(),connected:false,reloads:0};pages.set(value.id,entry);const page=await browser.newPage();entry.page=page;entry.sockets=new Set();if(entry.closing){await page.close();pages.delete(value.id);return}page.on('close',()=>{if(pages.get(value.id)===entry)pages.delete(value.id)});
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');
 cdp.on('Network.webSocketFrameReceived',event=>{
  let raw=event.response.payloadData;if(event.response.opcode===2)raw=Buffer.from(raw,'base64').toString('utf8');
  const events=parseFrames(raw);if(!events.length)return;
  entry.sockets.add(event.requestId);entry.lastEvent=Date.now();entry.reloads=0;if(!entry.connected){entry.connected=true;page.evaluate(()=>{document.body.style.display='none'}).catch(()=>{});emit({id:value.id,kind:'connected'})}
  events.forEach((parsed,index)=>{if(parsed.kind!=='connected')emit({id:value.id,...parsed,event_id:parsed.event_id||event.requestId+':'+event.timestamp+':'+index})});
 });
 cdp.on('Network.webSocketClosed',event=>{if(entry.closing||!entry.sockets.delete(event.requestId)||entry.sockets.size)return;entry.connected=false;emit({id:value.id,kind:'error',code:'chat_disconnected'})});
 page.on('response',response=>{const path=new URL(response.url()).pathname;if(/\/chat\/(token|join)/.test(path)&&response.status()>=400)emit({id:value.id,kind:'error',code:'chat_http_'+response.status()})});
 page.on('error',()=>{entry.connected=false;emit({id:value.id,kind:'error',code:'browser_page_failed'})});
 await page.setViewport({width:360,height:640});await page.setCacheEnabled(true);await page.setRequestInterception(true);
 page.on('request',request=>{const target=new URL(request.url());if(['doubleclick.net','googlesyndication.com','google-analytics.com','googletagmanager.com','scorecardresearch.com'].some(host=>target.hostname===host||target.hostname.endsWith('.'+host))){request.abort();return}if((['fetch','xhr'].includes(request.resourceType())&&target.hostname.startsWith('cdn.')&&/\.(json|lottie|gif|webp|png|jpg)$/i.test(target.pathname))||['image','font','media'].includes(request.resourceType())||/\.(m3u8|ts|m4s|mp4)$/i.test(target.pathname)||target.hostname.endsWith('playback.live-video.net'))request.abort();else if(auth.ready&&target.hostname==='api.idn.app'&&/\/chat\//.test(target.pathname))request.continue({headers:{...request.headers(),'access-token':auth.accessToken,authorization:'Bearer '+auth.idToken}});else request.continue()});
 try{await page.goto(value.url,{waitUntil:'domcontentloaded',timeout:45000})}catch{emit({id:value.id,kind:'error',code:'page_load_failed'})}finally{entry.creating=false;entry.lastEvent=Date.now()}
 }finally{opening--;waiting.shift()?.()}
}
async function message(value){
 if(value.action==='limits'){maxPages=Math.max(1,Math.min(16,Number(value.value)||16));return}
 if(value.action==='auth'){auth=value.value||{};return}
 if(value.action==='remove'){const entry=pages.get(value.id);pages.delete(value.id);if(entry){entry.closing=true;if(entry.page)await entry.page.close()}return}
 if(value.action!=='add')return;
 const entry=pages.get(value.id);
 if(entry){if(!entry.creating&&!entry.reloading&&!entry.connected&&Date.now()-entry.lastEvent>Math.min(30000,2000*2**Math.min(entry.reloads,4))){entry.lastEvent=Date.now();entry.reloads++;entry.reloading=true;entry.sockets.clear();entry.page.reload({waitUntil:'domcontentloaded',timeout:30000}).catch(()=>emit({id:value.id,kind:'error',code:'page_reload_failed'})).finally(()=>{entry.reloading=false})}return}

 if(pages.size<maxPages){const reserved={url:value.url,id:value.id,lastEvent:Date.now(),connected:false,reloads:0,creating:true};pages.set(value.id,reserved);create(value,reserved).catch(()=>{const entry=pages.get(value.id);entry?.page?.close().catch(()=>{});pages.delete(value.id);if(!browser?.isConnected())browserPromise=null;emit({id:value.id,kind:'error',code:'page_load_failed'})})}else emit({id:value.id,kind:'error',code:'chat_capacity'});
}
setInterval(()=>{for(const entry of pages.values())if(!entry.creating)message({action:'add',id:entry.id,url:entry.url}).catch(()=>{})},2000).unref();
let queue=Promise.resolve();readline.createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(()=>message(JSON.parse(line))).catch(()=>{})});
process.on('SIGTERM',async()=>{if(browser)await browser.close();process.exit(0)});
