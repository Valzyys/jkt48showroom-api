import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

test('deployed worker retains music routes, public docs and authentication across builds',async t=>{
 let calls=0;const token='synthetic-private-music-relay';
 const mf=new Miniflare({modules:[{type:'ESModule',path:new URL('../../dist/worker.js',import.meta.url).pathname}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'music-tests'},r2Buckets:{IMAGES_BUCKET:'music-tests'},durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},bindings:{API_KEY_REQUIRED:'true',API_KEY:'synthetic-server-key',JKT48_AUTO_SYNC:'false',JKT48_SCRAPER_URL:'https://relay.test/api/v1/',JKT48_SCRAPER_TOKEN:token},outboundService:async request=>{
  calls++;assert.equal(request.headers.get('Authorization'),'Bearer '+token);assert.ok(request.url.startsWith('https://relay.test/api/v1/music/'));
  return Response.json({ok:true,tracks:[{id:'abcdefghijk'}]});
 }});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 for(const f of(await readdir(new URL('../../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 for(const path of ['/api/music/search?q=Hello','/api/music/abcdefghijk','/api/music/abcdefghijk/lyrics']){
  assert.equal((await mf.dispatchFetch('https://api.test'+path)).status,401);
  const r=await mf.dispatchFetch('https://api.test'+path,{headers:{'X-API-Key':'synthetic-server-key'}});
  assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).ok,true);
 }
 assert.equal(calls,3,'only authenticated requests reach the relay');
 const catalog=await (await mf.dispatchFetch('https://api.test/docs/routes.json')).json();
 assert.equal(catalog.routes.filter(r=>r.path.startsWith('/api/music/')).length,3);
 assert.ok(catalog.routes.some(r=>r.path.startsWith('/api/idn-comments/')));
 const guide=await mf.dispatchFetch('https://api.test/docs/music.md');assert.equal(guide.status,200);assert.match(await guide.text(),/audio-only/);
 const combined=await(await mf.dispatchFetch('https://api.test/docs/guide.md')).text();assert.match(combined,/Musik & lirik sinkron/);
});
