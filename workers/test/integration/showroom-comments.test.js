import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';

test('authenticated Showroom comments flow through collector, room buffer and real WebSockets', async t => {
  const worker = (await readdir(new URL('../../dist/', import.meta.url))).find(name => name.endsWith('.js'));
  const secret = 'test-secret-with-at-least-32-characters';
  const mf = new Miniflare({
    modules: [{type:'ESModule',path:new URL('../../dist/' + worker,import.meta.url).pathname}],
    compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'comment-db'},r2Buckets:{IMAGES_BUCKET:'comment-images'},
    durableObjects:{SHOWROOM_COMMENTS:{className:'ShowroomComments',useSQLite:true},LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},
    bindings:{SECRET:secret,AUTH_SECRET:secret,JWT_SECRET:secret,API_KEY:'test-server',COLLECTOR_TOKEN:'test-collector',API_KEY_REQUIRED:'true',JKT48_AUTO_SYNC:'false'},
    outboundService:async()=>{throw new Error('Public requests must never hit Showroom');},
  });
  t.after(()=>mf.dispose());
  const DB = await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
    for(const sql of (await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8')).split(';').filter(s=>s.trim())) await DB.prepare(sql).run();
  const key='jkc_'+'1'.repeat(40);
  await DB.prepare('INSERT INTO api_keys(id,account_id,name,prefix,last4,key_hash,monthly_limit,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind('test-key','test-account','Test','jkc_111','1111',createHash('sha256').update(key).digest('hex'),100,Date.now()).run();
  const call=(path,headers={})=>mf.dispatchFetch('https://api.test'+path,{headers});
  for(const path of ['/api/showroom-comments/123','/api/showroom-comments/123/stream']) assert.equal((await call(path)).status,401);
  const read=async(path='/api/showroom-comments/123')=>call(path,{'X-API-Key':key});
  assert.equal((await (await read()).json()).status,'unavailable');
  assert.equal((await read('/api/showroom-comments/123?after=bad')).status,400);
  assert.equal((await read('/api/showroom-comments/123/stream')).status,426);
  const payload={room_id:123,data_id:'sr-123-456',started_at:'2026-10-29T00:00:00Z',status:'connected',comments:[]};
  const publish=async(value,token='test-collector')=>mf.dispatchFetch('https://api.test/internal/collector/showroom-comments/123',{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(value),
  });
  assert.equal((await publish(payload,'wrong')).status,401);
  assert.equal((await publish({...payload,room_id:124})).status,400);
  const streamed=await call('/api/showroom-comments/123/stream',{'X-API-Key':key,Upgrade:'websocket'});
  assert.equal(streamed.status,101);
  const ws=streamed.webSocket, messages=[], waiters=[];
  ws.addEventListener('message',e=>{messages.push(JSON.parse(e.data));while(waiters.length)waiters.shift()();});
  ws.accept();
  t.after(()=>{try{ws.close()}catch{}});
  const next=async()=>{if(!messages.length)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Missing websocket event')),5000);waiters.push(()=>{clearTimeout(timer);resolve()})});return messages.shift();};
  assert.equal((await next()).type,'snapshot');
  const comment={id:'event-1',user:{id:'viewer-1',name:'Penonton',avatar_id:1},comment:'Halo <3',observed_at:'2026-10-29T00:00:01Z',secret:'must strip'};
  assert.equal((await publish({...payload,comments:[comment]})).status,200);
  const live=await next();
  assert.equal(live.type,'comments');assert.equal(live.comments[0].comment,'Halo <3');assert.equal(live.cursor,1);
  assert.equal(live.comments[0].user.avatar_url,'https://image.showroom-cdn.com/showroom-prod/image/avatar/1.png');
  assert.ok(!JSON.stringify(live).includes('must strip'));
  assert.equal((await (await publish({...payload,comments:[comment]})).json()).accepted,0);
  assert.equal((await next()).type,'status');
  const snapshot=await (await read()).json();assert.equal(snapshot.comments.length,1);assert.equal(snapshot.comments[0].user.avatar_url,live.comments[0].user.avatar_url);
  assert.equal((await (await read('/api/showroom-comments/123?after=1')).json()).comments.length,0);
  assert.equal((await (await read('/api/showroom-comments/124')).json()).comments.length,0);
  const many=Array.from({length:100},(_,i)=>({...comment,id:'event-'+(i+2)}));
  await publish({...payload,comments:many});await next();
  const gap=await (await read('/api/showroom-comments/123?after=0')).json();assert.equal(gap.comments.length,100);assert.equal(gap.gap,true);
  await publish({...payload,status:'ended'});assert.equal((await next()).status,'ended');
  await publish(payload);assert.equal((await (await read()).json()).status,'ended');
  await publish({...payload,data_id:'sr-123-457',started_at:'2026-10-29T02:00:00Z',comments:[comment]});
  const newer=await next();assert.equal(newer.data_id,'sr-123-457');assert.equal(newer.comments.length,1);assert.equal(newer.cursor,102);
  await publish(payload);assert.equal((await (await read()).json()).data_id,'sr-123-457');
  assert.equal((await call('/api/showroom-comments/123?apikey='+key)).status,200);
  const sockets=[];
  for(let i=0;i<3;i++){const r=await call('/api/showroom-comments/123/stream',{'X-API-Key':key,Upgrade:'websocket'});assert.equal(r.status,101);r.webSocket.accept();sockets.push(r.webSocket)}
  assert.equal((await call('/api/showroom-comments/123/stream',{'X-API-Key':key,Upgrade:'websocket'})).status,429);
  for(const s of sockets)s.close();
  assert.equal((await mf.dispatchFetch('https://api.test/api/showroom-comments/123',{method:'OPTIONS'})).status,204);
});
