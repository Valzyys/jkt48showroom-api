import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedURL,showroomTarget,streamProxy,timedFetch } from '../src/runtime/proxy-core.js';
const request=(url='https://live.showroom-live.com/a/master.m3u8',init={})=>new Request('https://worker.test/api/stream?url='+encodeURIComponent(url),init);
test('host checks reject substring tricks, credentials, http, and nonstandard ports',()=>{
  for(const url of ['https://live.showroom-live.com.evil.test/a','https://evil.test/?live.showroom-live.com','https://user:pass@live.showroom-live.com/a','http://live.showroom-live.com/a','https://live.showroom-live.com:8443/a','file:///etc/passwd']) assert.throws(()=>checkedURL(url,['live.showroom-live.com']));
  assert.equal(checkedURL('https://edge.live.showroom-live.com/a',['live.showroom-live.com']).hostname,'edge.live.showroom-live.com');
});
test('Showroom target preserves paths/query and applies configured proxy once',()=>{
  assert.equal(showroomTarget('https://www.showroom-live.com/api/room/status?room_id=1',{SHOWROOM_API:'https://sr.example.test',PROXY_URL:'https://proxy.example.test/?url='}),'https://proxy.example.test/?url=https://sr.example.test/api/room/status?room_id=1');
  assert.equal(showroomTarget('https://api.idn.app/graphql',{PROXY_URL:'https://proxy.example.test/'}),'https://api.idn.app/graphql');
});
test('playlist rewrites variant, segment, encryption key, and init-map URLs',async()=>{
  const result=await streamProxy(request(),{},async()=>new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="../key"\n#EXT-X-MAP:URI="init.mp4"\nvariant.m3u8\nseg.ts?token=abc\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl','Content-Length':'100'}}));
  const text=await result.text();
  for(const url of ['https://live.showroom-live.com/key','https://live.showroom-live.com/a/init.mp4','https://live.showroom-live.com/a/variant.m3u8','https://live.showroom-live.com/a/seg.ts?token=abc']) assert.ok(text.includes(encodeURIComponent(url)));
  assert.equal(result.headers.get('Content-Length'),null);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
});
test('binary segment Range request and Content-Range are preserved',async()=>{
  const result=await streamProxy(request('https://live.showroom-live.com/seg.ts',{headers:{Range:'bytes=10-12',Cookie:'private-session'}}),{},async(url,init)=>{
    assert.equal(init.headers.get('Range'),'bytes=10-12');
    assert.equal(init.headers.get('Cookie'),null);
    return new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Range':'bytes 10-12/30','Content-Type':'video/mp2t','Content-Length':'3'}});
  });
  assert.equal(result.status,206);
  assert.equal(result.headers.get('Content-Range'),'bytes 10-12/30');
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()),new Uint8Array([1,2,3]));
});
test('upstream failure status and body are preserved',async()=>{
  const result=await streamProxy(request(),{},async()=>new Response('expired',{status:403}));
  assert.equal(result.status,403); assert.equal(await result.text(),'expired');
});
test('redirect targets are checked before follow-up fetch',async()=>{
  let calls=0;
  await assert.rejects(streamProxy(request(),{},async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://evil.test/private'}});}),/not allowed/);
  assert.equal(calls,1);
});
test('valid relative redirect resolves playlist against final upstream URL',async()=>{
  let calls=0;
  const result=await streamProxy(request(),{},async(url)=>++calls===1?new Response(null,{status:302,headers:{Location:'/final/master.m3u8'}}):new Response('#EXTM3U\nsegment.ts\n'));
  assert.ok((await result.text()).includes(encodeURIComponent('https://live.showroom-live.com/final/segment.ts')));
});
test('HEAD returns only headers and forwards HEAD to upstream',async()=>{
  const result=await streamProxy(request(undefined,{method:'HEAD'}),{},async(_,init)=>{assert.equal(init.method,'HEAD');return new Response(null,{headers:{'Content-Length':'123'}});});
  assert.equal(result.headers.get('Content-Length'),'123'); assert.equal(await result.text(),'');
});
test('missing URL and unsupported method are handled',async()=>{
  await assert.rejects(streamProxy(new Request('https://worker.test/api/stream')),error=>error.status===400);
  assert.equal((await streamProxy(request(undefined,{method:'POST'}))).status,405);
});
test('upstream timeout is reported as 504',async()=>{
  await assert.rejects(timedFetch('https://upstream.test',{},(_,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')))),5),error=>error.status===504);
});
