const {test}=require('node:test'),assert=require('node:assert/strict');
const {Api,ORIGIN,retryAfter}=require('../api.cjs');
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
function setup(fetcher){const sleeps=[],recovered=[];let clock=1000;const api=new Api({fetcher,sleep:async ms=>{sleeps.push(ms);clock+=ms},now:()=>clock,random:()=>0,onRecovery:e=>recovered.push(e)});return {api,sleeps,recovered,advance:ms=>clock+=ms}}
test('transient 502 recovers once, preserving the authenticated cursor URL',async()=>{
 const calls=[];const {api,sleeps,recovered}=setup(async(u,o)=>{calls.push({u,o});return calls.length===1?json({},502):json({next_cursor:'125',updates:[]})});
 const result=await api.get('/api/instagram/updates?after=123&limit=100',0);
 assert.equal(result.next_cursor,'125');assert.equal(calls.length,2);assert.equal(calls[0].u,calls[1].u);assert.equal(calls[0].u,ORIGIN+'/api/instagram/updates?after=123&limit=100');assert.equal(calls[0].o.headers['X-API-Key'],process.env.JKT48CONNECT_API_KEY);assert.equal(calls[0].o.redirect,'error');assert.deepEqual(sleeps,[250]);assert.equal(recovered[0].reason,'api_http_502');assert.equal(api.metrics.recovered,1);
});
test('socket reset or timeout is retried once with a clear sanitized cause',async()=>{
 for(const error of [Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}}),new DOMException('expired','TimeoutError')]){
  let n=0;const {api}=setup(async()=>{if(++n===1)throw error;return json({ok:true})});assert.equal((await api.get('/api/x/updates',0)).ok,true);assert.equal(n,2);
 }
 let n=0;const {api}=setup(async()=>{n++;throw Object.assign(new TypeError('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}})});await assert.rejects(api.get('/api/news',0),/api_network_UND_ERR_SOCKET/);assert.equal(n,2);assert.equal(api.metrics.failures,1);assert.equal(api.inflight.size,0);
});
test('authorization, rate limiting, redirects and missing routes never receive an immediate retry',async()=>{
 for(const status of [301,401,403,404,429]){
  let n=0;const {api,sleeps}=setup(async()=>{n++;return json({},status,{'Retry-After':'120'})});await assert.rejects(api.get('/api/news',0),e=>e.status===status&&e.retryAfterMs===120000);assert.equal(n,1);assert.equal(sleeps.length,0);
 }
});
test('shared deadline allows one short retry but prevents an exhausted retry',async()=>{
 let n=0;let fixture;fixture=setup(async(u,o)=>{n++;if(n===1){fixture.advance(14900);throw new DOMException('expired','TimeoutError')}return json({})});await assert.rejects(fixture.api.get('/api/x/updates',0),/api_timeout/);assert.equal(n,1);
 fixture=setup(async()=>{if(++n===3){fixture.advance(10000);throw new DOMException('expired','TimeoutError')}return json({ok:true})});n=2;assert.equal((await fixture.api.get('/api/x/updates',0)).ok,true);assert.equal(n,4);assert.equal(fixture.sleeps.length,1);
});
test('concurrent callers share the request and retry, and fresh cache avoids more hits',async()=>{
 let n=0;const {api}=setup(async()=>{n++;return n===1?json({},503):json({items:['one']})});const values=await Promise.all([api.get('/api/news',1000),api.get('/api/news',1000)]);assert.deepEqual(values[0],values[1]);assert.equal(n,2);await api.get('/api/news',1000);assert.equal(n,2);
});
test('malformed JSON and persistent failures never return fabricated empty or stale data',async()=>{
 let n=0;const {api,advance}=setup(async()=>{if(++n===1)return json({updates:[1]});return json({},502)});await api.get('/api/x/updates',1000);advance(1100);await assert.rejects(api.get('/api/x/updates',0),/api_http_502/);assert.equal(n,3);
 const bad=setup(async()=>new Response('<html>not json</html>'));await assert.rejects(bad.api.get('/api/news',0),/api_invalid_json/);assert.equal(bad.api.metrics.requests,1);
});
test('invalid paths cannot escape the API origin and Retry-After dates are bounded',async()=>{
 const {api}=setup(()=>{throw Error('unexpected fetch')});for(const path of ['https://other/api/','//other/api/','/api/news\nsecret','/api/news#fragment'])await assert.rejects(api.get(path),/invalid_api_path/);
 assert.equal(retryAfter('Tue, 27 Oct 2026 05:00:00 GMT',Date.parse('2026-10-27T04:59:00Z')),60000);assert.equal(retryAfter('99999999',0),3600000);assert.equal(retryAfter('invalid',0),undefined);
});

test('fetch redirect errors are not misclassified as transient transport failures',async()=>{let calls=0;const {api}=setup(async()=>{calls++;throw Object.assign(new TypeError('fetch failed'),{cause:Error('unexpected redirect')})});await assert.rejects(api.get('/api/news',0),/api_redirect_not_allowed/);assert.equal(calls,1)});

test('recent reads have a bounded fast deadline and one safe retry',async()=>{let calls=0,fixture;fixture=setup(async()=>{if(++calls===1){fixture.advance(9500);throw new DOMException('expired','TimeoutError')}return json({recents:[]})});assert.deepEqual(await fixture.api.get('/api/recent?page=1',0),{recents:[]});assert.equal(calls,2)});
