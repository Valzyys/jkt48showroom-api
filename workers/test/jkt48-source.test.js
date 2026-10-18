import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJKT48Client,jakartaTime,normalizeSchedule,pagination,syncJKT48Dataset } from '../src/runtime/jkt48-source.js';
import { createJKT48Transport,jkt48SourceTarget,scrapeTarget } from '../src/runtime/scrape-target.js';

test('official JSON client preserves API paths, language and detail envelope',async()=>{
  const calls=[];
  const client=createJKT48Client({fetcher:async(url,init)=>{calls.push({url,init});return Response.json({status:true,data:{result:{title:'News'}}});}});
  assert.equal((await client('news/a slug',{preview:false})).data.result.title,'News');
  assert.equal(calls[0].url,'https://jkt48.com/api/v1/news/a%20slug?lang=id&preview=false');
  assert.equal(calls[0].init.headers.Accept,'application/json');
});
test('upstream HTTP, challenge HTML and unsuccessful payloads are not empty lists',async()=>{
  for(const response of [new Response('Blocked',{status:403}),new Response('<html>Challenge</html>'),Response.json({status:false,data:[]})]) {
    await assert.rejects(createJKT48Client({fetcher:async()=>response})('news'),error=>error.status===502);
  }
  assert.throws(()=>createJKT48Client({base:'http://unsafe.test/'}),/HTTPS/);
});
test('Jakarta schedule clocks are converted to UTC without shifting the day',()=>{
  assert.equal(jakartaTime('2026-10-12T17:00:00.000Z','19:00'),'2026-10-13T12:00:00.000Z');
  assert.equal(jakartaTime('2026-10-13','19:00'),'2026-10-13T12:00:00.000Z');
  assert.throws(()=>jakartaTime('2026-10-13','25:00'),/Invalid/);
});
test('schedule normalization keeps official identifiers, members and birthday matches',()=>{
  const row=normalizeSchedule({schedule_id:1,title:'Show',type:'SHOW',reference_code:'OSH1-1',date:'2026-10-12T17:00:00Z',start_time:'19:00',end_time:'21:00',jkt48_member:[{member_id:7,name:'Member'}],birthday_member_name:['Member']});
  assert.equal(row.type,'show');assert.equal(row.code,'OSH1-1');assert.equal(row.end_time,'2026-10-13T14:00:00.000Z');assert.equal(row.birthday_member[0].member_id,7);
  assert.ok(row.link.includes('code=OSH1-1'));
});
test('news synchronization fills the new collection, follows metadata and bounds pages',async()=>{
  const rows=[],calls=[];
  const result=await syncJKT48Dataset('news',{client:async(resource,query)=>{calls.push(query.page);return {status:true,data:[{news_id:query.page,title:'News',link:'news-'+query.page}],_meta:{total_page:20}};},repository:{news:async row=>rows.push(row)},options:{newsPages:2}});
  assert.deepEqual(calls,[1,2]);assert.equal(result.count,2);assert.equal(rows[1].news_id,2);
});
test('schedule synchronization crosses years, deduplicates and enriches show/event/exclusive records',async()=>{
  const rows=[],calls=[];
  const short=[{schedule_id:1,title:'Show',type:'SHOW',reference_code:'SHOW1',date:'2026-12-31T17:00:00Z',start_time:'19:00'},{schedule_id:2,title:'Event',type:'EVENT',reference_code:'EVENT1',date:'2026-12-31T17:00:00Z'},{schedule_id:3,title:'Exclusive',type:'EXCLUSIVE',reference_code:'EX1',date:'2026-12-31T17:00:00Z'}];
  await syncJKT48Dataset('schedules',{now:new Date('2027-01-01T00:00:00Z'),client:async(resource,query)=>{calls.push({resource,query});return {status:true,data:resource==='schedules'?short:{jkt48_member:[{member_id:7,name:'Member'}]}};},repository:{schedule:async row=>rows.push(row)}});
  assert.deepEqual(calls.slice(0,3).map(call=>[call.query.year,call.query.month]),[[2026,12],[2027,1],[2027,2]]);
  assert.deepEqual(calls.slice(3).map(call=>call.resource),['theater-shows/SHOW1','events/EVENT1','exclusives/EX1']);
  assert.equal(rows.length,6);assert.equal(rows[3].jkt48_member[0].member_id,7);
});
test('member detail enrichment rotates bounded batches and keeps list data on detail failures',async()=>{
  const calls=[],rows=[];
  const result=await syncJKT48Dataset('members',{state:{cursor:1},options:{detailLimit:1},client:async resource=>{calls.push(resource);if(resource==='members')return {status:true,data:[{jkt48_member_id:1,name:'A'},{jkt48_member_id:2,name:'B'}]};throw new Error('Unavailable');},repository:{member:async row=>rows.push(row)}});
  assert.deepEqual(calls,['members','members/2']);assert.equal(rows.length,2);assert.equal(result.detailFailures,1);assert.equal(result.cursor,0);
});
test('pagination remains positive and integral for empty data and invalid query values',()=>{
  assert.deepEqual(pagination('100','-5',0),{page:1,perpage:1});
  assert.deepEqual(pagination('Infinity','Infinity',0),{page:1,perpage:10});
  assert.deepEqual(pagination('1.7','50',100),{page:1,perpage:30});
});
test('scrape relay falls back to official host and rotates each configured pool independently',()=>{
  assert.equal(scrapeTarget('https://jkt48.com/news'), 'https://jkt48.com/news');
  assert.equal(scrapeTarget('https://ssk.jkt48.com/2024/id/kandidat',{JKT48_SCRAPE_URL:'https://jkt.test/',SSK_SCRAPE_URL:'https://a.test/,https://b.test/'},1),'https://b.test/2024/id/kandidat');
  assert.throws(()=>scrapeTarget('https://evil.test/'),/Invalid/);
});
test('JSON scrape proxy supports raw URL prefixes and encoded URL templates without losing query parameters',()=>{
  const url='https://jkt48.com/api/v1/news?lang=id&page=2';
  assert.equal(jkt48SourceTarget(url,{JKT48_PROXY_URL:'https://relay.test/'}),'https://relay.test/'+url);
  const result=new URL(jkt48SourceTarget(url,{JKT48_PROXY_URL:'https://relay.test/?url={url}'}));
  assert.equal(result.searchParams.get('url'),url);assert.equal(result.searchParams.has('page'),false);
});
test('JSON scrape proxy does not use Showroom proxy implicitly and rejects insecure relays',()=>{
  const url='https://jkt48.com/api/v1/members?lang=id';
  assert.equal(jkt48SourceTarget(url,{PROXY_URL:'https://showroom.test/'}),url);
  assert.throws(()=>jkt48SourceTarget(url,{JKT48_PROXY_URL:'http://relay.test/'}),/HTTPS/);
  assert.throws(()=>jkt48SourceTarget(url,{JKT48_PROXY_URL:'https://user:password@relay.test/'}),/credentials/);
});
test('private VPS transport adds bearer token only to its HTTPS origin and strips upstream cookies',async()=>{
  const calls=[],token='test-token-'.repeat(4);
  const transport=createJKT48Transport({JKT48_SCRAPER_URL:'https://scrape.jkt48connect.com/api/v1/',JKT48_SCRAPER_TOKEN:token},async(url,init)=>{calls.push({url,init});return Response.json({status:true,data:[]});});
  const client=createJKT48Client({...transport,headers:{Cookie:'private-upstream-cookie','User-Agent':'custom'}});
  await client('news',{page:1});
  assert.equal(calls[0].url,'https://scrape.jkt48connect.com/api/v1/news?lang=id&page=1');
  assert.equal(calls[0].init.headers.get('Authorization'),'Bearer '+token);assert.equal(calls[0].init.headers.has('Cookie'),false);assert.equal(calls[0].init.redirect,'manual');
  assert.equal(calls[0].init.headers.get('User-Agent'),'JKT48Connect-Sync/1.0 (+https://api.jkt48connect.app)');
  await assert.rejects(transport.fetcher('https://evil.test/api/v1/news'),/Configure/);
});
test('private VPS mode fails closed without a valid token and does not change direct mode',()=>{
  assert.throws(()=>createJKT48Transport({JKT48_SCRAPER_URL:'https://scrape.jkt48connect.com/api/v1/'}),/TOKEN/);
  assert.throws(()=>createJKT48Transport({JKT48_SCRAPER_URL:'http://scrape.test/',JKT48_SCRAPER_TOKEN:'x'.repeat(64)}),/HTTPS/);
  assert.equal(createJKT48Transport({}).base,'https://jkt48.com/api/v1/');
});
test('VPS transport preserves the receiver required by the Workers native fetch function',async t=>{
  t.mock.method(globalThis,'fetch',function(){assert.equal(this,globalThis);return Promise.resolve(Response.json({status:true,data:[]}));});
  const transport=createJKT48Transport({JKT48_SCRAPER_URL:'https://scrape.test/api/v1/',JKT48_SCRAPER_TOKEN:'x'.repeat(64)});
  assert.equal((await transport.fetcher('https://scrape.test/api/v1/news')).status,200);
});
test('private VPS redirects are rejected without forwarding authentication to their destination',async()=>{
  let calls=0;
  const transport=createJKT48Transport({JKT48_SCRAPER_URL:'https://scrape.test/api/v1/',JKT48_SCRAPER_TOKEN:'x'.repeat(64)},async(_url,init)=>{
    calls++;assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.test/'}});
  });
  await assert.rejects(transport.fetcher('https://scrape.test/api/v1/news'),error=>error.code==='JKT48_SCRAPER_REDIRECT_ERROR');
  assert.equal(calls,1);
});

test('private scraper retries an intermittent rejection once, without hiding persistent failures',async()=>{
 let calls=0;
 const config={JKT48_SCRAPER_URL:'https://scrape.test/api/v1/',JKT48_SCRAPER_TOKEN:'x'.repeat(64)};
 const recovering=createJKT48Transport(config,async()=>++calls===1?new Response('rejected',{status:403}):Response.json({status:true,data:[]}));
 assert.equal((await recovering.fetcher('https://scrape.test/api/v1/news')).status,200);assert.equal(calls,2);
 calls=0;const failing=createJKT48Transport(config,async()=>{calls++;return new Response('rejected',{status:403})});
 assert.equal((await failing.fetcher('https://scrape.test/api/v1/news')).status,403);assert.equal(calls,2);
});
