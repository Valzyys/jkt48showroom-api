const puppeteer=require('puppeteer-core'),readline=require('readline'),{parseFrame}=require('./idn-events.cjs');
const pages=new Map();let browser,auth={};
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
async function create(value){
 const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='www.idn.app'||!/^\/[a-zA-Z0-9_-]+\/live\/[a-zA-Z0-9_-]+$/.test(url.pathname))return;
 browser ||= await puppeteer.launch({executablePath:process.env.COLLECTOR_CHROME_PATH||'/opt/jkt48-live-collector/chrome/chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--mute-audio','--disk-cache-size=0','--media-cache-size=0']});
 const page=await browser.newPage(),entry={page,url:value.url,id:value.id,lastEvent:Date.now(),connected:false,reloads:0};pages.set(value.id,entry);page.on('close',()=>pages.delete(value.id));
 const cdp=await page.createCDPSession();await cdp.send('Network.enable');
 cdp.on('Network.webSocketFrameReceived',event=>{
  let raw=event.response.payloadData;if(event.response.opcode===2)raw=Buffer.from(raw,'base64').toString('utf8');
  const parsed=parseFrame(raw);if(!parsed)return;
  entry.lastEvent=Date.now();if(!entry.connected){entry.connected=true;emit({id:value.id,kind:'connected'})}
  if(parsed.kind!=='connected')emit({id:value.id,...parsed,event_id:parsed.event_id||event.requestId+':'+event.timestamp});
 });
 cdp.on('Network.webSocketClosed',()=>{entry.connected=false;emit({id:value.id,kind:'error',code:'chat_disconnected'})});
 page.on('response',response=>{const path=new URL(response.url()).pathname;if(/\/chat\/(token|join)/.test(path)&&response.status()>=400)emit({id:value.id,kind:'error',code:'chat_http_'+response.status()})});
 page.on('error',()=>{entry.connected=false;emit({id:value.id,kind:'error',code:'browser_page_failed'})});
 await page.setCacheEnabled(false);await page.setRequestInterception(true);
 page.on('request',request=>{const target=new URL(request.url());if(['image','font','media'].includes(request.resourceType())||/\.(m3u8|ts|m4s|mp4)$/i.test(target.pathname)||target.hostname.endsWith('playback.live-video.net'))request.abort();else if(auth.ready&&target.hostname==='api.idn.app'&&/\/chat\//.test(target.pathname))request.continue({headers:{...request.headers(),'access-token':auth.accessToken,authorization:'Bearer '+auth.idToken}});else request.continue()});
 try{await page.goto(value.url,{waitUntil:'domcontentloaded',timeout:45000})}catch{emit({id:value.id,kind:'error',code:'page_load_failed'})}
}
async function message(value){
 if(value.action==='auth'){auth=value.value||{};return}
 if(value.action==='remove'){const entry=pages.get(value.id);pages.delete(value.id);if(entry)await entry.page.close();return}
 if(value.action!=='add')return;
 const entry=pages.get(value.id);
 if(entry){if(!entry.connected&&Date.now()-entry.lastEvent>90000){entry.lastEvent=Date.now();entry.reloads++;try{await entry.page.reload({waitUntil:'domcontentloaded',timeout:30000})}catch{emit({id:value.id,kind:'error',code:'page_reload_failed'})}}return}
 if(pages.size<8)await create(value);
}
let queue=Promise.resolve();readline.createInterface({input:process.stdin}).on('line',line=>{queue=queue.then(()=>message(JSON.parse(line))).catch(()=>{})});
process.on('SIGTERM',async()=>{if(browser)await browser.close();process.exit(0)});
