import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicXFeed} from '../src/library/x-feed.js';
import {runWithEnv} from '../src/runtime/env.js';
test('public X reads use the private relay, bounded query fields and no user credentials',async t=>{
 const seen=[];t.mock.method(globalThis,'fetch',async(url,init)=>{seen.push({url:new URL(url),init});return Response.json({tweets:[]})});
 const result=await runWithEnv({X_FEED_URL:'https://vps.test/internal/x-feed',X_FEED_TOKEN:'synthetic-private-token'},null,()=>publicXFeed('/tweets',{member:'Gracie_JKT48',limit:'10',url:'https://evil.test',cookie:'not-forwarded'}));
 assert.deepEqual(result,{tweets:[]});assert.equal(seen[0].url.origin,'https://vps.test');assert.equal(seen[0].url.pathname,'/internal/x-feed/tweets');assert.equal(seen[0].url.searchParams.get('member'),'Gracie_JKT48');assert.ok(!seen[0].url.searchParams.has('url'));assert.equal(seen[0].init.redirect,'manual');assert.equal(seen[0].init.headers.Authorization,'Bearer synthetic-private-token');assert.ok(!seen[0].init.headers.Cookie);
});
test('missing feeds, redirects and upstream errors are not successful empty tweet lists',async t=>{
 await assert.rejects(runWithEnv({},null,()=>publicXFeed('/status')),error=>error.status===503);
 const bindings={X_FEED_URL:'https://vps.test',X_FEED_TOKEN:'synthetic'};
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:302}));await assert.rejects(runWithEnv(bindings,null,()=>publicXFeed('/tweets')),error=>error.status===502);
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Tweet belum terarsip'},{status:404}));await assert.rejects(runWithEnv(bindings,null,()=>publicXFeed('/tweet/1')),error=>error.status===404);
});
