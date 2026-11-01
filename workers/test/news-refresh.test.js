import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {newsRefreshSeconds,syncDelayMs,armNewsRefresh} from '../src/runtime/news-refresh.js';
import {syncJKT48Dataset} from '../src/runtime/jkt48-source.js';
test('news refresh has a separate short interval and bounded failure backoff',()=>{
 assert.equal(newsRefreshSeconds(),15);assert.equal(newsRefreshSeconds({JKT48_NEWS_SYNC_SECONDS:0}),5);assert.equal(newsRefreshSeconds({JKT48_NEWS_SYNC_SECONDS:'invalid'}),15);
 assert.equal(syncDelayMs('news',{},{}),15000);assert.equal(syncDelayMs('news',{error:'source',failures:1},{}),30000);assert.equal(syncDelayMs('news',{error:'source',failures:20},{}),300000);assert.equal(syncDelayMs('members',{},{}),3600000);
});
test('frequent readers cannot postpone the existing alarm; alarm execution rearms it',async()=>{
 let alarm=null,writes=0;const storage={put:async()=>{},getAlarm:async()=>alarm,setAlarm:async value=>{alarm=value;writes++}},state={attemptedAt:Date.now()};
 await armNewsRefresh(storage,state);const original=alarm;await armNewsRefresh(storage,{attemptedAt:Date.now()+1000});assert.equal(alarm,original);assert.equal(writes,1);
 await armNewsRefresh(storage,{attemptedAt:Date.now()+2000},{},true);assert.ok(alarm>original);assert.equal(writes,2);
 await armNewsRefresh(storage,{}, {JKT48_AUTO_SYNC:'false'},true);assert.equal(writes,2);
});
test('unchanged headline checks do not rewrite records, while title edits and new news persist',async()=>{
 let rows=[{news_id:1,title:'First',link:'first'}],writes=0,calls=0;const options={newsHeadOnly:true},client=async()=>{calls++;return {data:rows,_meta:{total_page:100}}},repository={news:async()=>writes++};
 const first=await syncJKT48Dataset('news',{client,repository,options});assert.equal(writes,1);assert.equal(first.unchanged,false);
 const second=await syncJKT48Dataset('news',{client,repository,options,state:first});assert.equal(second.unchanged,true);assert.equal(writes,1);assert.equal(calls,2);
 rows=[{...rows[0],title:'Edited'}];const edited=await syncJKT48Dataset('news',{client,repository,options,state:second});assert.equal(edited.unchanged,false);assert.equal(writes,2);
});
test('news alarm imports a new source headline without another public request and clears cached pages',async t=>{
 let ident=1,sourceCalls=0;
 const mf=new Miniflare({modules:[{type:'ESModule',path:new URL('../dist/worker.js',import.meta.url).pathname}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'news-refresh'},r2Buckets:{IMAGES_BUCKET:'news-images'},durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},bindings:{SECRET:'12345678901234567890123456789012',AUTH_SECRET:'synthetic-auth',JWT_SECRET:'synthetic-jwt',API_KEY:'synthetic-api',API_KEY_REQUIRED:'false',JKT48_AUTO_SYNC:'true',JKT48_NEWS_SYNC_SECONDS:'5',JKT48_NEWS_PAGES:'1',JKT48_SCRAPER_URL:'https://scrape.test/api/v1/',JKT48_SCRAPER_TOKEN:'synthetic-private-scraper-token-over-32-chars',NODE_ENV:'production'},outboundService:async request=>{
  const u=new URL(request.url);if(u.hostname==='scrape.test'&&u.pathname==='/api/v1/news'){sourceCalls++;return Response.json({status:true,data:[{news_id:ident,title:'Headline '+ident,link:'headline-'+ident,valid_date_from:'2026-10-26T12:00:00Z',category:'Event'}],_meta:{total_page:1}})}return new Response(null,{status:502});
 }});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const file of(await readdir(new URL('../migrations',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())for(const sql of(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 const call=()=>mf.dispatchFetch('https://api.test/api/news?page=1&perpage=10',{headers:{'X-API-Key':'synthetic-api'}});
 let response=await call();assert.equal(response.status,200,await response.clone().text());assert.equal((await response.json()).news[0].id,'1');assert.match(response.headers.get('Cache-Control'),/max-age=3/);
 await call();await call();assert.equal(sourceCalls,1);ident=2;
 const deadline=Date.now()+12000;let found=false;
 while(Date.now()<deadline){const row=await db.prepare("SELECT count(*) n FROM documents WHERE collection_name='jkt48newnews' AND json_extract(document,'$.news_id')=2").first();if(row.n){found=true;break}await new Promise(r=>setTimeout(r,250))}
 assert.ok(found,'background alarm must persist news before another API request');assert.equal(sourceCalls,2);
 response=await call();assert.equal(response.status,200);assert.ok((await response.json()).news.some(n=>n.id==='2'));assert.equal(sourceCalls,2);
});
