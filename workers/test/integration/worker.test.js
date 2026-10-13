import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import jwt from 'jsonwebtoken';
import { encode,decode } from 'cbor-x';

test('Workers runtime integrates routes, D1, proxy, authentication, beta and WebSockets',async t=>{
  const dist=await readdir(new URL('../../dist/',import.meta.url));
  const worker=dist.find(name=>name.endsWith('.js'));
  assert.ok(worker,'Run npm run build first');
  const secret='12345678901234567890123456789012';
  const upstreamRequests=[];
  const mf=new Miniflare({
    modules:[{type:'ESModule',path:new URL('../../dist/'+worker,import.meta.url).pathname}],
    compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'test-database'},r2Buckets:{IMAGES_BUCKET:'test-images'},
    durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},
    bindings:{NODE_ENV:'production',SECRET:secret,AUTH_SECRET:secret,JWT_SECRET:secret,API_KEY:'integration-key',ADMIN_IDS:'1',SHOWROOM_API:'https://sr.test',PROXY_URL:'https://relay.test/',ORIGINS:'https://frontend.test',LIVE_REFRESH_SECONDS:'300'},
    outboundService:async request=>{
      upstreamRequests.push({url:request.url,cookie:request.headers.get('Cookie'),method:request.method,body:['POST','PUT'].includes(request.method)?await request.text():''});
      const target=request.url.replace('https://relay.test/','');
      if(target.includes('/api/csrf_token')) return Response.json({csrf_token:'csrf'},{headers:{'Set-Cookie':'sr_id=mock-session; Path=/; HttpOnly'}});
      if(target.includes('/user/login')) return Response.json({ok:1,user_id:1},{headers:{'Set-Cookie':'sr_id=mock-session; Path=/; HttpOnly'}});
      if(target.includes('/api/user/profile')) return Response.json({name:'Test User',account_id:'test-user',avatar_id:1,image:'https://img.test/user.png'});
      if(target.includes('/api/room/status')) return Response.json({room_id:123,is_live:true});
      if(target.includes('/api/live/post_live_comment')) return Response.json({ok:1});
      if(target.includes('/user/logout_api')) return Response.json({ok:1});
      if(target.includes('/api/room/follow')) return Response.json({ok:1});
      return Response.json({message:'unexpected upstream',url:request.url},{status:502});
    }
  });
  t.after(()=>mf.dispose());
  const DB=await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort()) {
    const migration=await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8');
    for(const sql of migration.split(';').filter(sql=>sql.trim())) await DB.prepare(sql).run();
  }
  const insert=async(database,collection,id,doc)=>DB.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind(database,collection,id,JSON.stringify({_id:id,...doc})).run();
  const memberId='000000000000000000000001';
  await insert('dcDB','idolmembers',memberId,{name:'Test Member',slug:'test-member',group:'jkt48',showroom_id:123,jkt48id:['1'],info:{img:'https://img.test/member.png',is_graduate:false,nicknames:['Test'],birthdate:'2000-01-01T00:00:00.000Z'}});
  await insert('dcDB','showrooms','000000000000000000000002',{name:'Test Member',img:'https://img.test/member.png',url:'test-member',room_id:123,group:'jkt48',member_data:memberId});
  let accessToken,refreshToken,srToken;
  const call=(path,init={})=>mf.dispatchFetch('https://worker.test'+path,{...init,headers:{Origin:'https://frontend.test',...init.headers}});
  await t.test('health and member response preserve API contract',async()=>{
    assert.equal((await call('/health')).status,200);
    const response=await call('/api/member?group=jkt48');assert.equal(response.status,200);
    const data=await response.json();assert.equal(data[0].name,'Test Member');assert.equal(data[0].room_id,123);
    assert.equal((await call('/does-not-exist')).status,404);
  });
  await t.test('login and proxy preserve query, cookies, tokens and private cache policy',async()=>{
    const login=await call('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:'https://frontend.test'},body:'account_id=test-user&password=test-password'});
    assert.equal(login.status,200,await login.clone().text());
    const data=await login.json();accessToken=data.access_token;refreshToken=data.refresh_token;srToken=login.headers.get('X-SR-Token');
    assert.ok(accessToken);assert.ok(refreshToken);assert.ok(srToken);
    assert.equal(jwt.verify(accessToken,secret).id,'1');
    const profile=await call('/api/user',{headers:{Authorization:'Bearer '+accessToken}});assert.equal(profile.status,200);
    const status=await call('/api/showroom/status?room_id=123&x=hello',{headers:{Authorization:'Bearer '+accessToken,'X-SR-Token':srToken}});
    assert.equal(status.status,200);assert.equal(status.headers.get('Cache-Control'),'no-store');
    const forwarded=upstreamRequests.find(request=>request.url.includes('/api/room/status'));assert.ok(forwarded.url.includes('room_id=123'));assert.ok(forwarded.url.includes('x=hello'));assert.equal(forwarded.cookie,'sr_id=mock-session');
  });
  await t.test('refresh token and invalid token responses do not expose credentials',async()=>{
    const response=await call('/api/user',{headers:{'X-Refresh-Token':refreshToken}});assert.equal(response.status,200);assert.ok(response.headers.get('X-Access-Token'));
    const invalid=await call('/api/user',{headers:{Authorization:'Bearer deliberately-invalid'}});assert.equal(invalid.status,401);assert.ok(!(await invalid.text()).includes('deliberately-invalid'));
  });
  await t.test('likes belong to authenticated user even with forged user_id',async()=>{
    const headers={Authorization:'Bearer '+accessToken};
    const set=await call('/api/user/like?liked_id=live-one&type=2&user_id=999',{method:'PUT',headers});assert.equal(set.status,200,await set.clone().text());
    const get=await call('/api/user/like?data_id=live-one',{headers});assert.equal((await get.json()).is_liked,true);
    const doc=await DB.prepare("SELECT document FROM documents WHERE collection_name='likeds'").first();assert.equal(JSON.parse(doc.document).user_id,'1');
    const remove=await call('/api/user/like?liked_id=live-one&type=2',{method:'DELETE',headers});assert.equal(remove.status,200);
    assert.equal((await (await call('/api/user/like?data_id=live-one',{headers})).json()).is_liked,false);
  });
  await t.test('beta enrollment serializes concurrent requests at maxDevices',async()=>{
    const headers={Authorization:'Bearer '+accessToken,'Content-Type':'application/json'};
    const keyResponse=await call('/api/admin/beta',{method:'POST',headers,body:JSON.stringify({expiresAt:new Date(Date.now()+3600000).toISOString(),maxDevices:1,note:'Test'})});
    assert.equal(keyResponse.status,200,await keyResponse.clone().text());const {key}=await keyResponse.json();
    const responses=await Promise.all(['device-a','device-b'].map(fingerprint=>call('/api/beta',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint,key})})));
    const data=await Promise.all(responses.map(async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();}));assert.equal(data.filter(row=>row.enabled).length,1,JSON.stringify(data));
    const devices=await call('/api/admin/beta_device',{headers});assert.equal((await devices.json()).length,1);
  });
  await t.test('live webhook persists state and WebSocket speaks original CBOR protocol',async()=>{
    const live={name:'Test Member',img:'https://img.test/member.png',room_id:123,is_graduate:false,is_group:false,started_at:1,streaming_url_list:[{type:'hls',url:'https://live.showroom-live.com/live.m3u8'}],group:'jkt48',type:'showroom'};
    const update=await call('/api/admin/update_lives',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:'integration-key',group:'jkt48',lives:[live]})});assert.equal(update.status,200,await update.clone().text());
    const now=await call('/api/now_live?group=jkt48');assert.equal((await now.json())[0].room_id,123);
    const token=jwt.sign({exp:Math.floor(Date.now()/1000)+60},secret);
    const response=await call('/ws?token='+encodeURIComponent(token),{headers:{Upgrade:'websocket'}});assert.equal(response.status,101);
    const socket=response.webSocket;socket.accept();
    const messages=[];
    const next=()=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('WebSocket timeout')),5000);socket.addEventListener('message',event=>{clearTimeout(timeout);resolve(decode(new Uint8Array(event.data)));},{once:true});});
    let waiting=next();socket.send(encode('PING'));assert.equal(await waiting,'PONG');
    waiting=next();socket.send(encode('listen jkt48'));const event=JSON.parse(await waiting);assert.equal(event.type,'jkt48');assert.equal(event.data[0].room_id,123);
    socket.close(1000);
  });
  await t.test('admin requires authenticated admin and competition API-key rejects invalid keys',async()=>{
    assert.equal((await call('/api/admin/member')).status,404);
    assert.equal((await call('/api/showroom_competition_detail?room_id=123',{headers:{'x-api-key':'invalid'}})).status,401);
  });
  await t.test('CSRF rejects form requests from untrusted origins',async()=>{
    const response=await call('/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.test',Authorization:'Bearer '+accessToken,'X-SR-Token':srToken}});
    assert.equal(response.status,403);
  });
  await t.test('logout forwards Showroom session',async()=>{
    const response=await call('/api/auth/logout',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'X-SR-Token':srToken}});assert.equal(response.status,200);
    assert.ok(upstreamRequests.some(request=>request.url.includes('/user/logout_api')&&request.cookie?.includes('mock-session')));
  });
});
