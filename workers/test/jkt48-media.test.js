import {test} from 'node:test';
import assert from 'node:assert/strict';
import {storagePath,rewriteMedia,serveMedia} from '../src/runtime/jkt48-media.js';
import {jakartaDateParts,upcomingBirthdays} from '../src/runtime/birthdays.js';

test('JKT48 image rewriting covers nested theater and birthday values and rejects arbitrary targets',()=>{
 const value={shows:[{members:[{img:'media/jkt48-member/member.jpg'},{img:'https://jkt48.com/api/v1/storages/media/jkt48-member/another.jpg'},{img:'https://cdn.example/photo.png'}]}]};
 const result=rewriteMedia(value,'https://api.test');
 assert.equal(result.shows[0].members[0].img,'https://api.test/media/jkt48/media/jkt48-member/member.jpg');
 assert.match(result.shows[0].members[1].img,/api\.test\/media\/jkt48/);
 assert.equal(result.shows[0].members[2].img,'https://cdn.example/photo.png');
 for(const target of ['media/../secret.jpg','media/%2e%2e/secret.jpg','media/test.svg','https://jkt48.com.evil/api/v1/storages/media/a.jpg','https://user:pass@jkt48.com/api/v1/storages/media/a.jpg','https://jkt48.com/api/v1/storages/media/a.jpg?secret=x'])assert.equal(storagePath(target),null);
});

test('media is served from R2 after one authenticated scrape and honors HEAD and ETag',async t=>{
 const objects=new Map();let downloads=0;
 const bucket={async get(key){const value=objects.get(key);if(!value)return null;return {size:value.bytes.length,httpEtag:'"stored"',body:new ReadableStream({start(c){c.enqueue(value.bytes);c.close();}}),writeHttpMetadata(headers){headers.set('Content-Type',value.type);}};},async put(key,bytes,options){objects.set(key,{bytes,type:options.httpMetadata.contentType});}};
 const previous=globalThis.fetch;t.after(()=>globalThis.fetch=previous);
 globalThis.fetch=async(url,init)=>{downloads++;assert.equal(url.href,'https://scraper.test/images/media/member.jpg');assert.equal(init.headers.Authorization,'Bearer '+ 'synthetic-token-'.repeat(3));assert.equal(init.redirect,'manual');return new Response(new Uint8Array([255,216,255,1]),{headers:{'Content-Type':'image/jpeg'}});};
 const bindings={IMAGES_BUCKET:bucket,JKT48_SCRAPER_URL:'https://scraper.test/api/v1/',JKT48_SCRAPER_TOKEN:'synthetic-token-'.repeat(3)};
 const url='https://api.test/media/jkt48/media/member.jpg';
 let response=await serveMedia(new Request(url),bindings);assert.equal(response.status,200);assert.equal(response.headers.get('X-Media-Storage'),'r2');assert.equal((await response.arrayBuffer()).byteLength,4);
 response=await serveMedia(new Request(url,{method:'HEAD'}),bindings);assert.equal(response.status,200);assert.equal(response.body,null);assert.equal(downloads,1);
 response=await serveMedia(new Request(url,{headers:{'If-None-Match':'"stored"'}}),bindings);assert.equal(response.status,304);
 assert.equal((await serveMedia(new Request('https://api.test/media/jkt48/media/test.svg'),bindings)).status,400);
});

test('missing birthday dates are skipped and WIB birthdays sort across year rollover',()=>{
 assert.equal(jakartaDateParts(null),null);assert.equal(jakartaDateParts('invalid'),null);
 assert.deepEqual(jakartaDateParts('2000-10-17T17:00:00Z'),{year:2000,month:10,day:18});
 const list=[{name:'Unknown',info:{}},{name:'January',info:{birthdate:'2000-01-01T00:00:00+07:00'}},{name:'December',info:{birthdate:'2000-12-31T00:00:00+07:00'}}];
 assert.deepEqual(upcomingBirthdays(list,new Date('2026-12-30T17:00:00Z')).map(v=>v.name),['December','January']);
});

test("persisted media and replay links use the current API host",()=>{
 const origin="https://api.jkt48connect.app",data={recordings:[{url:"https://apitest.jkt48connect.com/media/live/idn-1/video-123.mp4",stream_url:"https://apitest.jkt48connect.com/media/live/idn-1/video-123.m3u8"}],screenshot:{base_url:"https://apitest.jkt48connect.com/media/live/idn-1"}};const result=rewriteMedia(data,origin);assert.equal(result.recordings[0].url,origin+"/media/live/idn-1/video-123.mp4");assert.equal(result.recordings[0].stream_url,origin+"/media/live/idn-1/video-123.m3u8");assert.equal(result.screenshot.base_url,origin+"/media/live/idn-1");
});
