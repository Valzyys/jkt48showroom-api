import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.js';
import {youtubeOauthAdmin,youtubeOauthPublic} from '../src/control/youtube-oauth.js';
const base='https://api.jkt48connect.app';
function setup(t){const DB=database();t.after(()=>DB.sqlite.close());return {DB,AUTH_SECRET:'synthetic-encryption-secret',YOUTUBE_OAUTH_CLIENT_ID:'test-client',YOUTUBE_OAUTH_CLIENT_SECRET:'test-client-secret',YOUTUBE_OAUTH_WORKER_TOKEN:'test-worker-secret'};}
async function start(b){const r=await youtubeOauthAdmin(new Request(base+'/control/api/youtube-oauth/start',{method:'POST'}),b);return {url:new URL((await r.json()).authorization_url),cookie:r.headers.get('Set-Cookie').split(';')[0]};}
const callback=s=>base+'/control/youtube-oauth/callback?state='+s.url.searchParams.get('state')+'&code=synthetic-code';
function google(t,{refresh=true}={}){let calls=0;const old=globalThis.fetch;t.after(()=>globalThis.fetch=old);globalThis.fetch=async(url,init)=>{
 calls++;if(String(url).includes('/token')){assert.equal(init.body.get('grant_type'),'authorization_code');assert.equal(init.body.get('code_verifier').length,43);return Response.json({access_token:'synthetic-access',...(refresh?{refresh_token:'synthetic-refresh'}:{})});}
 assert.match(String(url),/channels\?part=snippet&mine=true/);return Response.json({items:[{id:'channel1',snippet:{title:'My <Channel>'}}]});
};return ()=>calls;}
test('login URL requests consent, offline access, PKCE and a fixed callback',async t=>{
 const b=setup(t),s=await start(b),p=s.url.searchParams;
 assert.equal(p.get('access_type'),'offline');assert.equal(p.get('prompt'),'consent select_account');assert.equal(p.get('code_challenge_method'),'S256');assert.equal(p.get('redirect_uri'),base+'/control/youtube-oauth/callback');
 const row=await b.DB.prepare('SELECT * FROM youtube_oauth_states').first();assert.equal(row.state_hash.length,43);assert.ok(row.verifier.includes('.'));assert.ok(!JSON.stringify(row).includes(p.get('state')));
});
test('OAuth callback saves encrypted credentials, consumes state and exposes no browser token',async t=>{
 const b=setup(t),s=await start(b),calls=google(t);const r=await youtubeOauthPublic(new Request(callback(s),{headers:{Cookie:s.cookie}}),b);assert.equal(r.status,200);const text=await r.text();assert.match(text,/My &lt;Channel&gt;/);assert.ok(!text.includes('synthetic-refresh'));assert.match(r.headers.get('Cache-Control'),/no-store/);
 const row=await b.DB.prepare('SELECT * FROM youtube_oauth_credentials').first();assert.ok(!row.encrypted.includes('synthetic-refresh'));assert.ok(!row.encrypted.includes('test-client-secret'));
 assert.equal((await youtubeOauthPublic(new Request(callback(s),{headers:{Cookie:s.cookie}}),b)).status,400);assert.equal(calls(),2);
 const status=await(await youtubeOauthAdmin(new Request(base+'/control/api/youtube-oauth/status'),b)).json();assert.equal(status.channel.id,'channel1');assert.equal(status.credentials,undefined);assert.ok(!JSON.stringify(status).includes('synthetic-refresh'));
 for(const headers of [{},{Authorization:'Bearer wrong'}])assert.equal((await youtubeOauthPublic(new Request(base+'/internal/youtube-oauth/credentials',{headers}),b)).status,401);
 const headers={Authorization:'Bearer test-worker-secret'};const privateData=await(await youtubeOauthPublic(new Request(base+'/internal/youtube-oauth/credentials',{headers}),b)).json();assert.equal(privateData.credentials.refresh_token,'synthetic-refresh');
 const unchanged=await(await youtubeOauthPublic(new Request(base+'/internal/youtube-oauth/credentials?version='+privateData.version,{headers}),b)).json();assert.equal(unchanged.unchanged,true);assert.equal(unchanged.credentials,undefined);
 for(const [version,status] of [['wrong',409],[privateData.version,200]])assert.equal((await youtubeOauthPublic(new Request(base+'/internal/youtube-oauth/ack',{method:'POST',headers,body:JSON.stringify({version})}),b)).status,status);
 assert.ok((await(await youtubeOauthAdmin(new Request(base+'/control/api/youtube-oauth/status'),b)).json()).received_at);
});
test('missing or wrong browser nonce cannot consume an OAuth login session',async t=>{
 const b=setup(t),s=await start(b);
 assert.equal((await youtubeOauthPublic(new Request(callback(s)),b)).status,400);
 assert.equal((await youtubeOauthPublic(new Request(callback(s),{headers:{Cookie:'__Secure-jkc-youtube-oauth='+'x'.repeat(43)}}),b)).status,400);
 assert.equal((await b.DB.prepare('SELECT COUNT(*) AS n FROM youtube_oauth_states').first()).n,1);
});
test('expired states are rejected before Google is contacted',async t=>{
 const b=setup(t),s=await start(b);await b.DB.prepare('UPDATE youtube_oauth_states SET expires_at=0').run();const calls=google(t);
 assert.equal((await youtubeOauthPublic(new Request(callback(s),{headers:{Cookie:s.cookie}}),b)).status,400);assert.equal(calls(),0);
});
test('missing refresh token fails without installing credentials',async t=>{
 const b=setup(t),s=await start(b);google(t,{refresh:false});assert.equal((await youtubeOauthPublic(new Request(callback(s),{headers:{Cookie:s.cookie}}),b)).status,502);assert.equal(await b.DB.prepare('SELECT * FROM youtube_oauth_credentials').first(),null);
});
test('consent denial consumes the state without exchanging codes',async t=>{
 const b=setup(t),s=await start(b),calls=google(t);assert.equal((await youtubeOauthPublic(new Request(callback(s)+'&error=access_denied',{headers:{Cookie:s.cookie}}),b)).status,400);assert.equal(calls(),0);assert.equal(await b.DB.prepare('SELECT * FROM youtube_oauth_states').first(),null);
});
