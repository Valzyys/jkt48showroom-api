import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

// The built Worker with enforcement on: sign up, create a key, spend the
// monthly quota through the real router, D1 and Durable Object rate limits.
test('Workers runtime requires developer keys and meters the monthly quota',async t=>{
  const dist=await readdir(new URL('../../dist/',import.meta.url));
  const worker=dist.find(name=>name.endsWith('.js'));
  assert.ok(worker,'Run npm run build first');
  const secret='12345678901234567890123456789012';
  const mf=new Miniflare({
    modules:[{type:'ESModule',path:new URL('../../dist/'+worker,import.meta.url).pathname}],
    compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],
    d1Databases:{DB:'accounts-database'},r2Buckets:{IMAGES_BUCKET:'accounts-images'},
    durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},
    bindings:{NODE_ENV:'production',SECRET:secret,AUTH_SECRET:secret,JWT_SECRET:secret,API_KEY:'integration-key',API_KEY_REQUIRED:'true',API_FREE_MONTHLY_LIMIT:'2',JKT48_AUTO_SYNC:'false',COLLECTOR_ENABLED:'false'},
    outboundService:async()=>Response.json({message:'unexpected upstream'},{status:502}),
  });
  t.after(()=>mf.dispose());
  const DB=await mf.getD1Database('DB');
  for(const file of (await readdir(new URL('../../migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort()) {
    const migration=await readFile(new URL('../../migrations/'+file,import.meta.url),'utf8');
    for(const sql of migration.split(';').filter(sql=>sql.trim())) await DB.prepare(sql).run();
  }
  const origin='https://api.test';
  let cookie='';
  const account=async(path,method='GET',body)=>{
    const response=await mf.dispatchFetch(origin+'/dashboard/api'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'?{Origin:origin}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    const set=response.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0];
    return {status:response.status,data:await response.json()};
  };
  assert.equal((await account('/register','POST',{name:'Dev',email:'dev@example.test',password:'rahasia123'})).status,201);
  const {key}=(await account('/keys','POST',{name:'Bot'})).data;
  assert.match(key,/^jkc_[a-f0-9]{40}$/);

  const missing=await mf.dispatchFetch(origin+'/api/my_ip');
  assert.equal(missing.status,401);
  assert.match((await missing.json()).dashboard,/\/dashboard\/keys$/);
  // The app's own routes and media stay outside metering.
  assert.notEqual((await mf.dispatchFetch(origin+'/api/stream')).status,401);
  assert.equal((await mf.dispatchFetch(origin+'/api/my_ip',{headers:{'x-api-key':'integration-key'}})).status,200);

  for(let i=1;i<=2;i++){
    const response=await mf.dispatchFetch(origin+'/api/my_ip',{headers:{'X-API-Key':key}});
    assert.equal(response.status,200,await response.clone().text());
    assert.equal(response.headers.get('X-RateLimit-Limit'),'2');
    assert.equal(response.headers.get('X-RateLimit-Remaining'),String(2-i));
  }
  const over=await mf.dispatchFetch(origin+'/api/my_ip?api_key='+key);
  assert.equal(over.status,429);
  assert.ok(Number(over.headers.get('Retry-After'))>0);
  // A user key also unlocks routes that used to need the server key.
  const recent=await mf.dispatchFetch(origin+'/api/recent',{headers:{'X-API-Key':key}});
  assert.equal(recent.status,429);

  const keys=(await account('/keys')).data.keys;
  assert.equal(keys[0].used,2);
  // Analytics land after the response through waitUntil.
  let usage;
  for(let i=0;i<20;i++){usage=(await account('/usage?days=7')).data;if(usage.totals.requests===2)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(usage.totals.requests,2);
  assert.ok(usage.routes.some(r=>r.route==='GET /api/my_ip'));
  const page=await mf.dispatchFetch(origin+'/dashboard/keys',{headers:{Accept:'text/html'}});
  assert.equal(page.status,200);
  assert.match(page.headers.get('Content-Type'),/text\/html/);
  assert.equal((await mf.dispatchFetch(origin+'/pay/JKC0123456789ABCDEF',{headers:{Accept:'text/html'}})).status,200);
});
