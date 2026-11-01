import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Miniflare} from 'miniflare';

test('IDN comments require auth and fan out real WebSockets with isolated rooms and stable cursors', async t => {
  const worker = (await readdir(new URL('../../dist/', import.meta.url))).find(name => name.endsWith('.js'));
  const secret = 'test-secret-with-at-least-32-characters';
  const mf = new Miniflare({
    modules: [{type:'ESModule',path:new URL('../../dist/' + worker,import.meta.url).pathname}],
    compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'idn-comment-db'},r2Buckets:{IMAGES_BUCKET:'idn-comment-images'},
    durableObjects:{IDN_COMMENTS:{className:'IdnComments',useSQLite:true},SHOWROOM_COMMENTS:{className:'ShowroomComments',useSQLite:true},LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},
    bindings:{SECRET:secret,AUTH_SECRET:secret,JWT_SECRET:secret,API_KEY:'test-server',COLLECTOR_TOKEN:'test-collector',API_KEY_REQUIRED:'true',JKT48_AUTO_SYNC:'false'},
    outboundService:async()=>{throw new Error('API readers must not fetch IDN');},
  });
  t.after(()=>mf.dispose());
  const DB = await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())
    for(const sql of (await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8')).split(';').filter(s=>s.trim())) await DB.prepare(sql).run();
  const key='jkc_'+'2'.repeat(40), id='idn-'+'a'.repeat(24), other='idn-'+'b'.repeat(24);
  await DB.prepare('INSERT INTO api_keys(id,account_id,name,prefix,last4,key_hash,monthly_limit,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind('idn-key','test-account','Test','jkc_222','2222',createHash('sha256').update(key).digest('hex'),100,Date.now()).run();
  const base='/api/idn-comments/'+id;
  const call=(path=base,headers={'X-API-Key':key})=>mf.dispatchFetch('https://api.test'+path,{headers});
  for(const path of [base,base+'/stream'])assert.equal((await call(path,{})).status,401);
  assert.equal((await call(base+'?after=bad')).status,400);
  assert.equal((await call(base+'/stream')).status,426);
  const initial=await (await call()).json();assert.equal(initial.source,'idn-irc-websocket');assert.equal(initial.status,'unavailable');
  const payload={room_id:123,data_id:id,live_id:'public-live-slug',started_at:'2026-10-29T00:00:00Z',status:'connected',comments:[]};
  const publish=(value,token='test-collector')=>mf.dispatchFetch('https://api.test/internal/collector/idn-comments/'+id,{
    method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(value),
  });
  assert.equal((await publish(payload,'wrong')).status,401);
  assert.equal((await publish({...payload,data_id:other})).status,400);
  const upgrade=await call(base+'/stream',{'X-API-Key':key,Upgrade:'websocket'});assert.equal(upgrade.status,101);
  const ws=upgrade.webSocket,messages=[],waiters=[];
  ws.addEventListener('message',e=>{messages.push(JSON.parse(e.data));while(waiters.length)waiters.shift()()});ws.accept();
  t.after(()=>{try{ws.close()}catch{}});
  const next=async()=>{if(!messages.length)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Missing IDN event')),5000);waiters.push(()=>{clearTimeout(timer);resolve()})});return messages.shift()};
  assert.equal((await next()).type,'snapshot');
  const comment={id:'stable-idn-message',user:{id:'fan',name:'Penonton',avatar_url:'https://cdn.idn.app/avatar.jpg',private:'strip'},comment:'Halo <3',observed_at:'2026-10-29T00:00:01Z',source_time:'2026-10-29T00:00:00Z',token:'strip'};
  assert.equal((await publish({...payload,comments:[comment]})).status,200);
  const pushed=await next();assert.equal(pushed.type,'comments');assert.equal(pushed.cursor,1);
  assert.equal(pushed.source,'idn-irc-websocket');assert.equal(pushed.live_id,'public-live-slug');
  assert.equal(pushed.comments[0].user.avatar_url,comment.user.avatar_url);assert.equal(pushed.comments[0].comment,'Halo <3');
  assert.equal(pushed.comments[0].source_time,comment.source_time);assert.ok(!JSON.stringify(pushed).includes('strip'));
  assert.equal((await (await publish({...payload,comments:[comment]})).json()).accepted,0);await next();
  assert.equal((await (await call(base+'?after=1')).json()).comments.length,0);
  assert.equal((await (await call('/api/idn-comments/'+other)).json()).comments.length,0);
  const unsafe={...comment,id:'unsafe-avatar',user:{...comment.user,avatar_url:'javascript:alert(1)'}};
  await publish({...payload,comments:[unsafe]});assert.equal((await next()).comments[0].user.avatar_url,null);
  await publish({...payload,status:'reconnecting'});assert.equal((await next()).status,'reconnecting');
  await publish({...payload,status:'ended'});assert.equal((await next()).status,'ended');
  await publish(payload);assert.equal((await (await call()).json()).status,'ended');
});
