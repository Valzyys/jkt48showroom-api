const {parseFrames} = require('./idn-events.cjs');

// Keep browser failures isolated from recordings and from other live rooms.
class IdnObserver {
 constructor({puppeteer,emit,now=Date.now,launchOptions={}}) {
  Object.assign(this,{puppeteer,emit,now,launchOptions});
  this.pages=new Map();this.auth={};this.maxPages=16;this.opening=0;this.waiting=[];
 }
 async browserInstance() {
  if(this.browser?.isConnected())return this.browser;
  if(!this.browserPromise)this.browserPromise=this.puppeteer.launch({
   executablePath:process.env.COLLECTOR_CHROME_PATH||'/opt/jkt48-live-collector/chrome/chrome',
   headless:true,timeout:20000,protocolTimeout:20000,
   args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--mute-audio','--disk-cache-size=0','--media-cache-size=0','--renderer-process-limit=8'],
   ...this.launchOptions
  }).then(browser=>{
   this.browser=browser;
   browser.on('disconnected',()=>{
    if(this.browser!==browser)return;
    this.browser=null;this.browserPromise=null;
    for(const entry of this.pages.values()){
     entry.generation++;entry.page=null;entry.connected=false;entry.creating=false;entry.reloading=false;
     this.error(entry,'browser_disconnected');
    }
   });
   return browser;
  }).catch(error=>{this.browserPromise=null;throw error});
  return this.browserPromise;
 }
 error(entry,code) {if(!entry.closing)this.emit({id:entry.id,kind:'error',code});}
 async slot(fn) {
  if(this.opening>=2)await new Promise(resolve=>this.waiting.push(resolve));else this.opening++;
  try{return await fn()}finally{if(this.waiting.length)this.waiting.shift()();else this.opening--;}
 }
 async closePage(page) {
  if(!page||page.isClosed())return;
  let timer;
  try{await Promise.race([page.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('close_timeout')),5000)})]);}
  catch{
   // Only recycle a stalled browser when it has no healthy room to interrupt.
   if(this.browser&&![...this.pages.values()].some(e=>e.connected)){
    const browser=this.browser;this.browser=null;this.browserPromise=null;
    browser.process()?.kill('SIGKILL');
   }
  }finally{clearTimeout(timer)}
 }
 async open(entry) {
  if(entry.creating||entry.closing)return;
  entry.creating=true;entry.reloading=false;entry.connected=false;
  const generation=++entry.generation;
  const current=()=>!entry.closing&&this.pages.get(entry.id)===entry&&entry.generation===generation;
  try{await this.slot(async()=>{
   if(!current())return;
   const browser=await this.browserInstance();if(!current())return;
   const page=await browser.newPage();if(!current()){await this.closePage(page);return}
   entry.page=page;entry.sockets=new Set();entry.lastActivity=this.now();
   const cdp=await page.createCDPSession();await cdp.send('Network.enable');
   cdp.on('Network.webSocketFrameReceived',event=>{
    if(!current())return;
    let raw=event.response.payloadData;if(event.response.opcode===2)raw=Buffer.from(raw,'base64').toString('utf8');
    if(entry.sockets.has(event.requestId))entry.lastActivity=this.now();
    const slug=new URL(entry.url).pathname.split('/').pop();
    const events=parseFrames(raw).filter(event=>!event.room_id||event.room_id===slug);if(!events.length)return;
    entry.sockets.add(event.requestId);entry.lastActivity=this.now();entry.failures=0;
    if(!entry.connected){entry.connected=true;this.emit({id:entry.id,kind:'connected'})}
    events.forEach((parsed,index)=>{
     if(parsed.kind!=='connected')this.emit({id:entry.id,...parsed,event_id:parsed.event_id||event.requestId+':'+event.timestamp+':'+index});
    });
   });
   cdp.on('Network.webSocketClosed',event=>{
    if(!current()||!entry.sockets.delete(event.requestId)||entry.sockets.size)return;
    entry.connected=false;entry.lastAttempt=this.now();this.error(entry,'chat_disconnected');
   });
   page.on('error',()=>{if(current()){entry.connected=false;entry.broken=true;this.error(entry,'browser_page_failed')}});
   page.on('close',()=>{if(current()){entry.page=null;entry.connected=false;entry.broken=true;this.error(entry,'browser_page_closed')}});
   page.on('response',response=>{
    if(!current())return;
    const target=new URL(response.url());
    if(target.hostname==='api.idn.app'&&/\/chat\/(token|join)/.test(target.pathname)&&response.status()>=400)this.error(entry,'chat_http_'+response.status());
   });
   await page.setViewport({width:360,height:640});await page.setCacheEnabled(true);await page.setRequestInterception(true);
   page.on('request',request=>{
    const target=new URL(request.url());let action;
    if(['doubleclick.net','googlesyndication.com','google-analytics.com','googletagmanager.com','scorecardresearch.com'].some(host=>target.hostname===host||target.hostname.endsWith('.'+host))||
      ['image','font','media'].includes(request.resourceType())||/\.(m3u8|ts|m4s|mp4)$/i.test(target.pathname)||target.hostname.endsWith('playback.live-video.net')||
      (['fetch','xhr'].includes(request.resourceType())&&target.hostname.startsWith('cdn.')&&/\.(json|lottie|gif|webp|png|jpg)$/i.test(target.pathname)))action=request.abort();
    else if(this.auth.ready&&target.hostname==='api.idn.app'&&/\/chat\//.test(target.pathname))action=request.continue({headers:{...request.headers(),'access-token':this.auth.accessToken,authorization:'Bearer '+this.auth.idToken}});
    else action=request.continue();
    Promise.resolve(action).catch(()=>{});
   });
   try{await page.goto(entry.url,{waitUntil:'domcontentloaded',timeout:25000})}
   catch{if(current()){entry.failures++;entry.broken=true;this.error(entry,'page_load_failed')}}
  });}catch{if(current()){entry.failures++;entry.broken=true;this.error(entry,'page_load_failed')}}
  finally{if(current()){entry.creating=false;entry.lastAttempt=this.now()}}
 }
 async recover(entry) {
  if(entry.connected&&this.now()-entry.lastActivity>120000){entry.connected=false;entry.broken=true;this.error(entry,'chat_stalled')}
  if(entry.creating||entry.reloading||entry.closing||entry.connected)return;
  if(this.now()-entry.lastAttempt<Math.min(30000,2000*2**Math.min(entry.failures,4)))return;
  if(!entry.page||entry.page.isClosed()||entry.broken||entry.failures>=2){
   entry.generation++;const old=entry.page;entry.page=null;entry.broken=false;entry.reloading=true;
   await this.closePage(old);entry.reloading=false;
   if(!entry.closing)await this.open(entry);
   return;
  }
  entry.reloading=true;entry.lastAttempt=this.now();entry.sockets.clear();
  try{await entry.page.reload({waitUntil:'domcontentloaded',timeout:15000});}
  catch{entry.failures++;entry.broken=true;this.error(entry,'page_reload_failed')}
  finally{entry.reloading=false;entry.lastAttempt=this.now()}
 }
 async message(value) {
  if(value.action==='auth'){this.auth=value.value||{};return}
  if(value.action==='limits'){this.maxPages=Math.max(1,Math.min(16,Number(value.value)||16));return}
  if(value.action==='remove'){
   const entry=this.pages.get(value.id);if(entry){entry.closing=true;entry.generation++;this.pages.delete(value.id);await this.closePage(entry.page)}return;
  }
  if(value.action!=='add')return;
  let target;try{target=new URL(value.url)}catch{return}
  if(target.protocol!=='https:'||target.hostname!=='www.idn.app'||!/^\/[a-zA-Z0-9_-]+\/live\/[a-zA-Z0-9_-]+$/.test(target.pathname)||target.search||target.hash)return;
  const old=this.pages.get(value.id);if(old){await this.recover(old);return}
  if(this.pages.size>=this.maxPages){this.emit({id:value.id,kind:'error',code:'chat_capacity'});return}
  const entry={id:value.id,url:value.url,generation:0,failures:0,lastAttempt:0};this.pages.set(entry.id,entry);await this.open(entry);
 }
 tick(){for(const entry of this.pages.values())this.recover(entry).catch(()=>{});}
 async stop(){for(const entry of this.pages.values())entry.closing=true;this.pages.clear();if(this.browser)await this.browser.close();}
}
module.exports={IdnObserver};
if(require.main===module){
 const {IdnChatObserver}=require('./idn-chat.cjs');
 const observer=new IdnChatObserver({emit:value=>process.stdout.write(JSON.stringify(value)+'\n')});
 // Start rooms independently; slow metadata must not block remove/auth or other rooms.
 require('readline').createInterface({input:process.stdin}).on('line',line=>{try{observer.message(JSON.parse(line)).catch(()=>{})}catch{}});
 setInterval(()=>observer.tick(),2000).unref();
 process.on('SIGTERM',()=>observer.stop().finally(()=>process.exit(0)));
}
