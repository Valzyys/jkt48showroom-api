import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {createHmac} from 'node:crypto';
import {playback} from '../src/runtime/youtube-public.js';

test('all data routes authenticate before cached data, source requests or upgrades',async t=>{
 const root=new URL('../',import.meta.url);
 let calls=0;const token='synthetic-private-scraper-token-123456',secret='12345678901234567890123456789012',id='hAHv54gxD60';
 const mf=new Miniflare({modules:[{type:'ESModule',path:new URL('dist/worker.js',root).pathname}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'auth-audit'},r2Buckets:{IMAGES_BUCKET:'auth-images'},durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},bindings:{API_KEY_REQUIRED:'true',API_KEY:'synthetic-server-key',SECRET:secret,JWT_SECRET:secret,AUTH_SECRET:secret,API_KEY_EXEMPT_ORIGINS:'https://jkt48connect.app',SECONDARY_ORIGINS:'https://jkt48connect.app',JKT48_AUTO_SYNC:'false',JKT48_SCRAPER_URL:'https://scrape.test/api/v1/',JKT48_SCRAPER_TOKEN:token},outboundService:async request=>{
  calls++;if(new URL(request.url).hostname==='live.showroom-live.com'){assert.equal(request.headers.get('X-API-Key'),null);return new Response('#EXTM3U\nsegment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}})}assert.equal(request.headers.get('Authorization'),'Bearer '+token);
  if(request.url.includes('youtube-feed?')){const channel=new URL(request.url).searchParams.get('channel_id');return new Response('<feed><entry><yt:videoId>'+id+'</yt:videoId><yt:channelId>'+channel+'</yt:channelId><title>Video</title><published>2026-10-27T00:00:00Z</published></entry></feed>')}
  if(request.url.includes('youtube-media/'))return new Response('#EXTM3U\nq360/index.m3u8\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  return Response.json({message:'unexpected upstream'},{status:502});
 }});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const f of(await readdir(new URL('migrations/',root))).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile(new URL('migrations/'+f,root),'utf8')).split(';').filter(x=>x.trim()))await db.prepare(sql).run();
 const catalog=JSON.parse(await readFile(new URL('docs/routes.json',root),'utf8'));
 const paths=[...new Set(catalog.routes.filter(r=>r.path.startsWith('/api/')&&!/^\/api\/(stream|profile|showroom|auth|user|admin|beta)(\/|$)/.test(r.path)).map(r=>r.examplePath.split('?')[0]))];
 paths.push('/api/jkt48_youtube/hAHv54gxD60/comments','/api/jkt48_youtube/','/api//jkt48_youtube');
 for(const path of paths)for(const method of ['GET','HEAD']){const r=await mf.dispatchFetch('https://api.test'+path,{method});assert.equal(r.status,401,method+' '+path);assert.match(r.headers.get('Cache-Control'),/no-store/)}
 assert.equal(calls,0,'anonymous requests never fetch sources');
 for(const headers of [{Origin:'https://jkt48connect.app'},{Origin:'https://api.test',Referer:'https://api.test/docs'},{'X-API-Key':'invalid'},{'X-API-Key':'jkc_'+'0'.repeat(40)},{Authorization:'Bearer fake',Cookie:'session=fake'},{'X-Signature':'fake','X-Nonce':'fake','X-Timestamp':String(Math.floor(Date.now()/1000))}])assert.equal((await mf.dispatchFetch('https://api.test/api/jkt48_youtube',{headers})).status,401);
 const valid=await mf.dispatchFetch('https://api.test/api/jkt48_youtube',{headers:{'X-API-Key':'synthetic-server-key'}});assert.equal(valid.status,200,await valid.clone().text());assert.match(valid.headers.get('Cache-Control'),/private, no-store/);const [video]=await valid.json();assert.equal(video.playback.format,'m3u8');
 assert.equal((await mf.dispatchFetch('https://api.test/api/jkt48_youtube')).status,401,'warm data is not a bypass');
 const mediaURL=playback(id,token,'https://api.test').url;assert.equal((await mf.dispatchFetch(mediaURL)).status,200,'authenticated playback capability works');
 const before=calls,expires=Math.floor(Date.now()/1000)+300,old=expires+'.'+createHmac('sha256',token).update(id+':'+expires).digest('base64url');
 assert.equal((await mf.dispatchFetch(mediaURL.replace(/\d{10}\.[\w-]{43}/,old))).status,403,'old public tickets are revoked');
 assert.equal((await mf.dispatchFetch(mediaURL.replace(/\d{10}\.[\w-]{43}/,expires+'.'+'a'.repeat(43)))).status,403);assert.equal(calls,before,'invalid tickets do not reach the VPS');
 for(const path of ['/%61pi/jkt48_youtube','/api/%6eews','/%61pi/news','/api%2Fjkt48_youtube','//api/jkt48_youtube','/docs/../api/jkt48_youtube']){const r=await mf.dispatchFetch('https://api.test'+path);assert.ok([401,404].includes(r.status),path+' status '+r.status+' '+await r.text())}
 const preflight=await mf.dispatchFetch('https://api.test/api/jkt48_youtube',{method:'OPTIONS',headers:{Origin:'https://frontend.test','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-API-Key'}});assert.equal(preflight.status,204);
 assert.equal((await mf.dispatchFetch('https://api.test/health')).status,200);assert.equal((await mf.dispatchFetch('https://api.test/docs')).status,200);
 t.diagnostic('Audited '+paths.length+' data paths with both GET and HEAD, plus spoofed origins, bad keys, caches and media tickets.');
});
