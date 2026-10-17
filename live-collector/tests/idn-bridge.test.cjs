const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {IdnObserver}=require('../idn-bridge.cjs');
function fixture(){
 let clock=100000;const events=[],created=[];
 class Page extends EventEmitter {
  constructor(){super();this.cdp=new EventEmitter();this.cdp.send=async()=>{};created.push(this)}
  async createCDPSession(){return this.cdp}
  async setViewport(){} async setCacheEnabled(){} async setRequestInterception(){} async goto(){}
  async reload(){this.reloads=(this.reloads||0)+1;if(this.failReload)throw Error('timeout')}
  isClosed(){return !!this.closed}
  async close(){this.closed=true;this.emit('close')}
 }
 const browser=new EventEmitter();browser.isConnected=()=>true;browser.newPage=async()=>new Page();browser.close=async()=>{};
 const observer=new IdnObserver({puppeteer:{launch:async()=>browser},emit:e=>events.push(e),now:()=>clock});
 const add=(id='one')=>observer.message({action:'add',id,url:'https://www.idn.app/jkt48_test/live/live-'+id});
 return {observer,events,created,add,advance:()=>clock+=60000,browser};
}
test('failed reload replaces the tab, discards stale events, and resumes all gift frames',async()=>{
 const f=fixture();await f.add();const old=f.created[0];old.failReload=true;
 f.advance();await f.add();assert.ok(f.events.some(e=>e.code==='page_reload_failed'));
 f.advance();await f.add();assert.equal(f.created.length,2);assert.equal(old.closed,true);
 const gift={room_id:'live-one',user:{uuid:'u',name:'Fan'},gift:{slug:'rose',quantity:3,gold:10,image_url:'https://cdn.idntimes.com/content-images/rose.png'}};
 old.cdp.emit('Network.webSocketFrameReceived',{requestId:'old',timestamp:1,response:{payloadData:JSON.stringify(gift)}});
 assert.equal(f.events.filter(e=>e.kind==='gift').length,0);
 const raw='@id=a :server PRIVMSG #room :'+JSON.stringify(gift)+'\r\n@id=b :server PRIVMSG #room :'+JSON.stringify(gift);
 f.created[1].cdp.emit('Network.webSocketFrameReceived',{requestId:'new',timestamp:2,response:{payloadData:raw}});
 assert.equal(f.events.filter(e=>e.kind==='gift').length,2);assert.equal(f.observer.pages.get('one').connected,true);
 assert.equal(f.events.find(e=>e.kind==='gift').gift.quantity,3);
 assert.ok(!JSON.stringify(f.events).includes('accessToken'));
 await f.observer.stop();
});
test('a crashed room is recreated without stopping healthy concurrent rooms; foreign-room events are ignored',async()=>{
 const f=fixture();await f.add();await f.add('two');
 f.created[1].cdp.emit('Network.webSocketFrameReceived',{requestId:'two',timestamp:1,response:{payloadData:':server 001 guest :Welcome'}});
 f.created[0].emit('error');f.advance();await f.add();assert.equal(f.created.length,3);assert.equal(f.created[1].closed,undefined);
 f.created[2].cdp.emit('Network.webSocketFrameReceived',{requestId:'one',timestamp:2,response:{payloadData:JSON.stringify({room_id:'different',user:{uuid:'u'},gift:{slug:'rose',gold:10}})}});
 assert.equal(f.events.filter(e=>e.kind==='gift').length,0);
 await f.observer.message({action:'remove',id:'one'});assert.equal(f.observer.pages.has('one'),false);assert.equal(f.observer.pages.has('two'),true);
 await f.observer.stop();
});
test('closed tabs rejoin and browser disconnect permits a fresh launch',async()=>{
 const f=fixture();await f.add();await f.created[0].close();f.advance();await f.add();assert.equal(f.created.length,2);
 f.browser.emit('disconnected');assert.equal(f.observer.browserPromise,null);f.advance();await f.add();assert.equal(f.created.length,3);
 await f.observer.stop();
});
test('a connected tab with a stalled event stream is replaced instead of staying silently connected',async()=>{
 const f=fixture();await f.add();const old=f.created[0];
 old.cdp.emit('Network.webSocketFrameReceived',{requestId:'chat',timestamp:1,response:{payloadData:':server 001 guest :Welcome'}});
 f.advance();f.advance();f.advance();await f.add();
 assert.equal(old.closed,true);assert.equal(f.created.length,2);assert.ok(f.events.some(e=>e.code==='chat_stalled'));
 await f.observer.stop();
});
