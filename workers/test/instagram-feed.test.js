import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicInstagramFeed} from '../src/library/instagram-feed.js';
import {runWithEnv} from '../src/runtime/env.js';
import {instagramMedia} from '../src/runtime/instagram-media.js';
test('Instagram relay uses fixed archive paths and allowlisted filters without user credentials',async t=>{
 let seen;t.mock.method(globalThis,'fetch',async(url,init)=>{seen={url:new URL(url),init};return Response.json({posts:[]})});
 const b={INSTAGRAM_FEED_URL:'https://private.test/internal/instagram-feed',INSTAGRAM_FEED_TOKEN:'synthetic-token'};
 assert.deepEqual(await runWithEnv(b,null,()=>publicInstagramFeed('/posts',{member:'fiony-alveria',url:'https://evil.test',cookie:'private'})),{posts:[]});assert.equal(seen.url.pathname,'/internal/instagram-feed/posts');assert.equal(seen.url.searchParams.get('member'),'fiony-alveria');assert.ok(!seen.url.searchParams.has('url'));assert.ok(!seen.init.headers.Cookie);assert.equal(seen.init.redirect,'manual');
 await assert.rejects(runWithEnv(b,null,()=>publicInstagramFeed('/../secrets')),e=>e.status===400);
 await assert.rejects(runWithEnv({},null,()=>publicInstagramFeed('/status')),e=>e.status===503);
 t.mock.method(globalThis,'fetch',async()=>new Response(null,{status:302}));await assert.rejects(runWithEnv(b,null,()=>publicInstagramFeed('/status')),e=>e.status===502);
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Not archived'},{status:404}));await assert.rejects(runWithEnv(b,null,()=>publicInstagramFeed('/post/4015528258922619317')),e=>e.status===404);
});
const id='4015528258922619317',prefix='/internal/instagram-media/fiony-alveria/'+id+'/thumbnail';
test('Instagram R2 upload rejects missing auth, oversize, MIME mismatch and invalid bytes',async()=>{
 const b={INSTAGRAM_FEED_TOKEN:'synthetic-token',IMAGES_BUCKET:{head:async()=>null,put:async()=>assert.fail('invalid upload reached R2')}};
 assert.equal((await instagramMedia(new Request('https://api.test'+prefix,{method:'PUT'}),b)).status,401);
 for(const [headers,body,status]of [[{'Content-Length':'9000000','Content-Type':'image/jpeg'},'x',413],[{'Content-Length':'3','Content-Type':'text/html'},'xxx',415],[{'Content-Length':'3','Content-Type':'image/jpeg'},'xxx',415]]){
  const req=new Request('https://api.test'+prefix,{method:'PUT',headers:{Authorization:'Bearer synthetic-token',...headers},body});assert.equal((await instagramMedia(req,b)).status,status);
 }
});
test('Instagram media archive uploads idempotently and supports actual browser byte ranges',async()=>{
 let object=null,puts=0;
 const bytes=Uint8Array.from([255,216,255,1,2,3,4,5]);
 const bucket={head:async()=>object,get:async(key,options)=>({body:options?bytes.slice(options.range.offset,options.range.offset+options.range.length):bytes}),put:async(key,raw,options)=>{puts++;assert.equal(key,'instagram/fiony-alveria/'+id+'/thumbnail');object={size:raw.byteLength,httpEtag:'"test"',httpMetadata:options.httpMetadata}}};
 const b={INSTAGRAM_FEED_TOKEN:'synthetic-token',IMAGES_BUCKET:bucket};
 const upload=()=>instagramMedia(new Request('https://api.test'+prefix,{method:'PUT',headers:{Authorization:'Bearer synthetic-token','Content-Length':'8','Content-Type':'image/jpeg'},body:bytes}),b);
 const result=await(await upload()).json();assert.equal(result.url,'https://api.test/media/instagram/fiony-alveria/'+id+'/thumbnail');await upload();assert.equal(puts,1);
 const path='https://api.test/media/instagram/fiony-alveria/'+id+'/thumbnail';
 const r=await instagramMedia(new Request(path,{headers:{Range:'bytes=1-3'}}),b);assert.equal(r.status,206);assert.equal(r.headers.get('Content-Range'),'bytes 1-3/8');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes.slice(1,4));assert.equal(r.headers.get('X-Media-Storage'),'r2');
 assert.equal((await instagramMedia(new Request(path,{headers:{Range:'bytes=20-'}}),b)).status,416);
 assert.equal((await instagramMedia(new Request(path,{headers:{'If-None-Match':'"test"'}}),b)).status,304);
 assert.equal((await instagramMedia(new Request(path,{method:'HEAD'}),b)).body,null);
});
