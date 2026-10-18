import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile,readdir} from 'node:fs/promises';import {Miniflare} from 'miniflare';import {sessionCookie} from '../src/control/auth.js';import {generationInput} from '../src/licenses/index.js';
test('license input maps yearly durations to months and rejects invalid options',()=>{
 assert.deepEqual(generationInput({plan:'Pro',durationValue:2,durationUnit:'year'}),{plan:'Pro',durationValue:24,durationUnit:'month',maxActivations:5});
 assert.deepEqual(generationInput({plan:'Trial'}),{plan:'Trial',maxActivations:5});
 for(const value of [{plan:'Free'},{plan:'Pro',durationValue:0},{plan:'Pro',durationValue:11,durationUnit:'year'},{plan:'Trial',maxActivations:0},{plan:'Trial',email:'invalid'}])assert.throws(()=>generationInput(value));
});
test('admin creation is authenticated, encrypted, idempotent and validates through provider',async t=>{
 let generations=0,validations=0,providerReject=false,lastBody;
 const bindings={CONTROL_ADMIN_EMAIL:'admin@test.invalid',CONTROL_ADMIN_PASSWORD_HASH:'synthetic',CONTROL_SESSION_SECRET:'test-session-secret',SECRET:'12345678901234567890123456789012',AUTH_SECRET:'auth',JWT_SECRET:'jwt',API_KEY:'server',LOVABLE_LICENSE_API_KEY:'synthetic-generation-key',LOVABLE_LICENSE_PREFIX:'TEST',NODE_ENV:'production',JKT48_AUTO_SYNC:'false'};
 const mf=new Miniflare({modules:[{type:'ESModule',path:new URL('../dist/worker.js',import.meta.url).pathname}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'license-tests'},r2Buckets:{IMAGES_BUCKET:'license-images'},durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},bindings,outboundService:async request=>{
  assert.equal(new URL(request.url).origin,'https://io.eklas.dev');if(new URL(request.url).pathname==='/api/v1/extension/v5')return Response.json({ok:true,enabled:true,extensionV6:{enabled:true},notifications:[{id:'provider-only',title:'Provider message'}]});lastBody=await request.json();
  if(request.url.endsWith('/generate')){generations++;assert.equal(request.headers.get('Authorization'),'Bearer synthetic-generation-key');return Response.json({ok:true,license_key:'EKLAS-SYNTHETIC-LICENSE',plan:lastBody.plan,expires_at:'2099-01-01T00:00:00.000Z',duration_minutes:525600})}
  validations++;assert.equal(lastBody.key,'EKLAS-SYNTHETIC-LICENSE');assert.equal(lastBody.licenseKey,lastBody.key);assert.equal(request.headers.get('Authorization'),null);return Response.json(providerReject?{ok:false}:{ok:true,license:{plan:'Pro',expires_at:'2099-01-01T00:00:00.000Z'},attestation:{payload:'unchanged',signature:'unchanged'},config:{extensionV5:{features:{chat:true}}}},{status:providerReject?403:200});
 }});t.after(()=>mf.dispose());const db=await mf.getD1Database('DB');for(const name of(await readdir(new URL('../migrations',import.meta.url))).filter(n=>n.endsWith('.sql')).sort())for(const sql of(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 const runtime=await mf.dispatchFetch('https://worker.test/license/v1/runtime?version=6.0.1',{headers:{Origin:'chrome-extension://'+'a'.repeat(32)}});assert.equal(runtime.status,200);assert.equal(runtime.headers.get('Access-Control-Allow-Origin'),'*');const initialRuntime=await runtime.json();assert.equal(initialRuntime.extensionV6.enabled,true);assert.deepEqual(initialRuntime.notifications,[]);
 assert.equal((await mf.dispatchFetch('https://worker.test/license/v1/runtime?version=bad')).status,400);
 assert.equal((await mf.dispatchFetch('https://worker.test/license/v1/runtime',{method:'POST'})).status,405);
 const cookie=(await sessionCookie(bindings)).split(';')[0];const session=await mf.dispatchFetch('https://worker.test/control/api/session',{headers:{Cookie:cookie}});assert.equal(session.status,200);const {csrf}=await session.json();
 const call=(path,value,auth=true)=>mf.dispatchFetch('https://worker.test'+path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Cookie:cookie,'X-CSRF-Token':csrf,'X-Requested-With':'jkt48connect',Origin:'https://worker.test'}:{})},body:JSON.stringify(value)});
 const noticePath='/control/api/extension-notifications';
 const draft={title:'Informasi uji',message:'Baris pertama\nBaris kedua',link:'https://example.test/info',published:false};
 assert.ok([401,403].includes((await call(noticePath,draft,false)).status));
 assert.equal((await mf.dispatchFetch('https://worker.test'+noticePath)).status,401);
 assert.equal((await call(noticePath,{...draft,link:'javascript:alert(1)'})).status,400);
 let nr=await call(noticePath,draft);assert.equal(nr.status,200);const notice=await nr.json();
 const runtimeGet=async()=>{const r=await mf.dispatchFetch('https://worker.test/license/v1/runtime?version=6.0.1');assert.equal(r.status,200);return r.json()};
 assert.deepEqual((await runtimeGet()).notifications,[]);
 const editNotice=(method,value)=>mf.dispatchFetch('https://worker.test'+noticePath,{method,headers:{'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':csrf,'X-Requested-With':'jkt48connect',Origin:'https://worker.test'},body:JSON.stringify(value)});
 assert.equal((await editNotice('PUT',{...draft,id:notice.id,published:true})).status,200);
 let liveNotices=(await runtimeGet()).notifications;assert.equal(liveNotices.length,1);assert.equal(liveNotices[0].id,notice.id);assert.equal(liveNotices[0].message,draft.message);assert.equal(liveNotices[0].link,draft.link);assert.equal(liveNotices[0].published,undefined);
 nr=await mf.dispatchFetch('https://worker.test'+noticePath,{headers:{Cookie:cookie}});assert.equal((await nr.json()).notifications[0].published,true);
 assert.equal((await editNotice('PUT',{...draft,id:notice.id,published:true,message:'Updated information'})).status,200);assert.equal((await runtimeGet()).notifications[0].message,'Updated information');
 assert.equal((await editNotice('DELETE',{id:notice.id})).status,200);assert.deepEqual((await runtimeGet()).notifications,[]);
 assert.equal((await editNotice('DELETE',{id:notice.id})).status,404);
 const input={requestId:'11111111-1111-4111-8111-111111111111',plan:'Pro',durationValue:1,durationUnit:'year',maxActivations:3,email:'a@example.test'};
 assert.ok([401,403].includes((await call('/control/api/licenses/generate',input,false)).status));
 let r=await call('/control/api/licenses/generate',input);assert.equal(r.status,200,await r.clone().text());const generated=await r.json();assert.match(generated.license_key,/^TEST(?:-[A-F0-9]{8}){6}$/);assert.equal(generations,1);assert.equal(lastBody.durationValue,12);assert.equal(lastBody.durationUnit,'month');
 r=await call('/control/api/licenses/generate',input);assert.equal((await r.json()).license_key,generated.license_key);assert.equal(generations,1);
 assert.equal((await call('/control/api/licenses/generate',{...input,maxActivations:4})).status,409);
 const stored=await db.prepare('SELECT * FROM extension_licenses').first();assert.ok(!JSON.stringify(stored).includes(generated.license_key));assert.ok(!JSON.stringify(stored).includes('EKLAS-SYNTHETIC-LICENSE'));
 r=await mf.dispatchFetch('https://worker.test/control/api/licenses',{headers:{Cookie:cookie}});const history=await r.json();assert.equal(history.configured,true);assert.ok(!JSON.stringify(history).includes('synthetic-generation-key'));assert.ok(!JSON.stringify(history).includes('provider_cipher'));
 const validate=(key=generated.license_key,email='a@example.test')=>call('/license/v1/validate',{key,licenseKey:key,email,deviceId:'device'},false);
 r=await validate();assert.equal(r.status,200,await r.clone().text());const validated=await r.json();assert.equal(validated.upstream_license,'EKLAS-SYNTHETIC-LICENSE');assert.equal(validated.attestation.signature,'unchanged');assert.equal(validated.config.extensionV5.features.chat,true);assert.equal(validations,1);
 assert.equal((await validate(undefined,'wrong@example.test')).status,403);assert.equal(validations,1);
 providerReject=true;assert.equal((await validate()).status,403);
 await db.prepare("UPDATE extension_licenses SET expires_at='2000-01-01T00:00:00.000Z'").run();assert.equal((await validate()).status,403);assert.equal(validations,2);
});
