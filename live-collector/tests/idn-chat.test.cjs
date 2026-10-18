const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {IdnChatObserver,ircLine}=require('../idn-chat.cjs');
function fixture(){
 let clock=100000;const events=[],sockets=[],calls=[];
 class Socket extends EventEmitter{
  constructor(url,options){super();Object.assign(this,{url,options,readyState:1,sent:[]});sockets.push(this)}
  send(line){this.sent.push(line)}
  terminate(){this.readyState=3;this.emit('close')}
  close(){this.terminate()}
 }
 const observer=new IdnChatObserver({emit:e=>events.push(e),WebSocket:Socket,clientKey:'synthetic-web',now:()=>clock,fetcher:async(url,options)=>{calls.push({url,options});const slug=new URL(url).pathname.split('/').pop();return Response.json({data:{slug,chat_room_id:'room-'+slug,live_type:'regular'}})}});
 const add=(id='one',extra={})=>observer.message({action:'add',id,url:'https://www.idn.app/jkt48_test/live/'+id,...extra});
 const frame=(socket,line)=>socket.emit('message',Buffer.from(line));
 const register=socket=>{socket.emit('open');frame(socket,':server CAP * LS :message-tags server-time batch');frame(socket,':server CAP * ACK :message-tags server-time batch');frame(socket,':server 001 nick :Welcome')};
 const join=(socket,id='one')=>frame(socket,':server 366 nick #room-'+id+' :End of names');
 return {observer,events,sockets,calls,add,frame,register,join,advance:(ms=60000)=>clock+=ms};
}
test('direct IRC joins before reporting connected and preserves gift image, quantity, time and ID',async()=>{
 const f=fixture();await f.observer.message({action:'auth',value:{ready:true,idToken:'private-id',accessToken:'private-access'}});await f.add();
 const socket=f.sockets[0];f.register(socket);
 assert.equal(socket.url,'wss://chat.idn.app');assert.ok(socket.sent.includes('CAP END'));assert.ok(socket.sent.includes('JOIN #room-one'));
 assert.equal(f.events.some(e=>e.kind==='connected'),false);f.join(socket);assert.equal(f.events.filter(e=>e.kind==='connected').length,1);
 const gift={room_id:'room-one',user:{uuid:'fan',name:'Viewer'},gift:{slug:'rose',name:'Rose',gold:10,quantity:3,image_url:'https://cdn.idntimes.com/content-images/rose.png'}};
 f.frame(socket,'@msgid=stable;time=2026-10-18T06:00:00.000Z :fan PRIVMSG #room-one :'+JSON.stringify(gift));
 const event=f.events.find(e=>e.kind==='gift');assert.equal(event.event_id,'stable');assert.equal(event.gift.quantity,3);assert.equal(event.gift.gold,10);assert.ok(event.gift.image_url.endsWith('/rose.png'));assert.equal(event.event_time,'2026-10-18T06:00:00.000Z');
 assert.ok(socket.sent.every(line=>!line.includes('\n')));assert.ok(!JSON.stringify(f.events).includes('private-'));assert.equal(f.calls[0].options.headers.Authorization,'Bearer private-id');await f.observer.stop();
});
test('recovers one disconnected room independently and rejects events from other channels',async()=>{
 const f=fixture();await Promise.all([f.add(),f.add('two')]);f.register(f.sockets[0]);f.join(f.sockets[0]);f.register(f.sockets[1]);f.join(f.sockets[1],'two');
 const healthy=f.sockets[1];f.sockets[0].terminate();f.advance();await f.add();assert.equal(f.sockets.length,3);assert.equal(healthy.readyState,1);
 f.frame(f.sockets[2],':fan PRIVMSG #room-two :'+JSON.stringify({user:{uuid:'fan'},gift:{slug:'rose',gold:10}}));assert.equal(f.events.filter(e=>e.kind==='gift').length,0);
 await f.observer.message({action:'remove',id:'one'});assert.equal(f.observer.pages.size,1);assert.equal(healthy.readyState,1);await f.observer.stop();
});
test('silent registration times out, PING receives PONG, and a silent connected socket reconnects',async()=>{
 const f=fixture();await f.add();f.sockets[0].emit('open');f.advance(31000);await f.add();assert.ok(f.events.some(e=>e.code==='chat_stalled'));
 f.advance();await f.add();const socket=f.sockets[1];f.register(socket);f.join(socket);f.frame(socket,'PING :provider');assert.ok(socket.sent.includes('PONG :provider'));
 f.advance(91000);await f.add();assert.equal(socket.readyState,3);await f.observer.stop();
});
test('server-advertised history uses the durable cursor; unsolicited channels and JOIN rejection do not report success',async()=>{
 const f=fixture();await f.add('one',{cursor:{time:'2026-10-18T06:00:00.000Z'}});const socket=f.sockets[0];socket.emit('open');
 f.frame(socket,':server CAP * LS * :message-tags server-time');f.frame(socket,':server CAP * LS :draft/chathistory');assert.ok(socket.sent.some(v=>v.includes('CAP REQ :message-tags server-time draft/chathistory')));
 f.frame(socket,':server CAP * ACK :message-tags server-time draft/chathistory');f.join(socket);
 assert.ok(socket.sent.includes('CHATHISTORY AFTER #room-one timestamp=2026-10-18T06:00:00.000Z 100'));
 await f.add('two');f.frame(f.sockets[1],':server 473 nick #room-two :Invite only');assert.ok(f.events.some(e=>e.id==='two'&&e.code==='chat_join_rejected'));assert.equal(f.events.some(e=>e.id==='two'&&e.kind==='connected'),false);await f.observer.stop();
});
test('metadata errors are safe, retries continue, and restricted or injected channel names cannot join',async()=>{
 const f=fixture();f.observer.fetcher=async()=>{throw Error('private-token-in-an-error')};await f.add();assert.equal(f.events[0].code,'chat_metadata_unavailable');assert.equal(f.sockets.length,0);
 f.observer.fetcher=async()=>Response.json({data:{chat_room_id:'room\r\nPRIVMSG victim :bad'}});f.advance();await f.add();assert.equal(f.sockets.length,0);
 f.observer.fetcher=async()=>Response.json({data:{chat_room_id:'paid',live_type:'idnliveplus'}});f.advance();await f.add();assert.equal(f.events.at(-1).code,'chat_room_restricted');
 f.observer.fetcher=async()=>Response.json({data:{chat_room_id:'room-one'}});f.advance();await f.add();assert.equal(f.sockets.length,1);await f.observer.stop();
});
test('observer accepts only IDN live URLs and capacity never prevents existing rooms from recovering',async()=>{
 const f=fixture();await f.observer.message({action:'add',id:'bad',url:'https://evil.test/jkt/live/one'});assert.equal(f.calls.length,0);
 await f.observer.message({action:'limits',value:1});await f.add();await f.add('two');assert.equal(f.events.at(-1).code,'chat_capacity');assert.equal(f.sockets.length,1);await f.observer.stop();
 assert.equal(ircLine('@time=t :server PRIVMSG #room :hello there').params[1],'hello there');
});
test('404 metadata falls back to matching public page and accepts the real IVS ARN channel',async()=>{
 const f=fixture(),arn='arn:aws:ivschat:us-east-1:050891932989:room/ActualRoom';
 f.observer.fetcher=async(url,options)=>{
  f.calls.push({url,options});
  if(url.startsWith('https://api.idn.app/'))return Response.json({data:null},{status:404});
  assert.equal(options.headers,undefined,'credentials are never forwarded to the page');
  return new Response('<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{livestream:{slug:'one',creator:{username:'jkt48_test'},chat_room_id:arn}}}})+'</script>');
 };
 await f.add();const socket=f.sockets[0];f.register(socket);
 assert.equal(f.observer.pages.get('one').nick,'idn-'+f.observer.pages.get('one').viewerId+'-web');assert.ok(socket.sent.includes('JOIN #'+arn));assert.ok(socket.sent.some(s=>s.startsWith('PRIVMSG IDNHeimdall :JOINED ')));
 f.frame(socket,':server 366 nick #'+arn+' :End of names');assert.ok(f.events.some(e=>e.kind==='connected'));
 assert.equal(f.calls.length,3);await f.observer.stop();
});
test('IDNOdin private gift events require the intended nick, trusted sender and exact room',async()=>{
 const f=fixture();await f.add();const socket=f.sockets[0];f.register(socket);f.join(socket);
 const nick=f.observer.pages.get('one').nick,gift={room_id:'one',user:{uuid:'fan',name:'A'},gift:{slug:'rose',gold:10,quantity:4,image_url:'https://cdn.idntimes.com/content-images/rose.png'}};
 f.frame(socket,'@msgid=gift-id :IDNOdin!bot@server PRIVMSG '+nick+' :'+JSON.stringify(gift));
 assert.equal(f.events.filter(e=>e.kind==='gift').length,1);assert.equal(f.events.at(-1).gift.quantity,4);assert.ok(f.events.at(-1).gift.image_url);
 for(const [sender,target,room] of [['fan',nick,'one'],['IDNOdin','someone-else','one'],['IDNOdin',nick,'two'],['IDNOdin',nick,undefined]])f.frame(socket,':'+sender+' PRIVMSG '+target+' :'+JSON.stringify({...gift,room_id:room}));
 assert.equal(f.events.filter(e=>e.kind==='gift').length,1);await f.observer.stop();
});
test('public page cannot redirect collection into a different or restricted live room',async()=>{
 for(const patch of [{slug:'two'},{creator:{username:'another'}},{live_type:'idnliveplus'},{is_hidden:true},{chat_room_id:'room\r\nJOIN #evil'}]){
  const f=fixture();f.observer.fetcher=async url=>url.startsWith('https://api.')?Response.json({}, {status:404}):new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{livestream:{slug:'one',creator:{username:'jkt48_test'},chat_room_id:'room-one',...patch}}}})+'</script>');
  await f.add();assert.equal(f.sockets.length,0);await f.observer.stop();
 }
});
