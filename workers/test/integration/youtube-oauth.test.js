import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {sessionCookie,controlCsrf} from '../../src/control/auth.js';

test('OAuth admin endpoints enforce existing session, origin and CSRF guards in the deployed worker',async t=>{
 const base='https://api.jkt48connect.app';
 const b={AUTH_SECRET:'synthetic-encryption-secret',CONTROL_ADMIN_EMAIL:'owner@test.invalid',CONTROL_ADMIN_PASSWORD_HASH:'configured',CONTROL_SESSION_SECRET:'synthetic-session-secret',YOUTUBE_OAUTH_CLIENT_ID:'test-client',YOUTUBE_OAUTH_CLIENT_SECRET:'test-client-secret',YOUTUBE_OAUTH_WORKER_TOKEN:'test-worker-secret'};
 const mf=new Miniflare({modules:[{type:'ESModule',path:new URL('../../dist/worker.js',import.meta.url).pathname}],compatibilityDate:'2026-07-01',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'oauth-tests'},durableObjects:{LIVE_HUB:{className:'LiveHub',useSQLite:true},COORDINATOR:{className:'Coordinator',useSQLite:true}},bindings:b});t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');for(const f of(await readdir(new URL('../../migrations/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort())for(const sql of(await readFile(new URL('../../migrations/'+f,import.meta.url),'utf8')).split(';').filter(s=>s.trim()))await db.prepare(sql).run();
 const path=base+'/control/api/youtube-oauth/start';const h={Origin:base,'X-Requested-With':'jkt48connect'};
 const call=headers=>mf.dispatchFetch(path,{method:'POST',headers});
 assert.equal((await call(h)).status,401);
 h.Cookie=(await sessionCookie(b)).split(';')[0];assert.equal((await call(h)).status,403);
 h['X-CSRF-Token']=await controlCsrf(new Request(path,{headers:h}),b);
 assert.equal((await call({...h,Origin:'https://evil.invalid'})).status,403);
 const r=await call(h);assert.equal(r.status,200,await r.clone().text());assert.ok((await r.json()).authorization_url);
 assert.equal((await mf.dispatchFetch(base+'/internal/youtube-oauth/credentials')).status,401);
 assert.equal((await mf.dispatchFetch(base+'/control/api/youtube-oauth/status')).status,401);
});
