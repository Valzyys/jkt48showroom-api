import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJKT48Client,jakartaTime,normalizeSchedule,pagination,syncJKT48Dataset } from '../src/runtime/jkt48-source.js';
import { scrapeTarget } from '../src/runtime/scrape-target.js';

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
