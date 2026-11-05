import test from 'node:test';
import assert from 'node:assert/strict';
import {musicMedia,musicSignature,musicAPI} from '../src/runtime/music.js';
const bindings={JKT48_SCRAPER_URL:'https://scrape.example/api/v1/',JKT48_SCRAPER_TOKEN:'test-'+ 'x'.repeat(40)};
test('signed audio binds the track and rejects altered URLs without touching the source',async()=>{
 const expires=Math.floor(Date.now()/1000)+600,ticket=musicSignature('abcdefghijk','m4a',expires,bindings.JKT48_SCRAPER_TOKEN);
 const req=new Request(`https://api.example/media/music/abcdefghijl/${ticket}/audio.m4a`);
 assert.equal((await musicMedia(req,bindings)).status,403);
});
test('audio URL supports byte range and relays only audio MIME',async t=>{
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 const expires=Math.floor(Date.now()/1000)+600,ticket=musicSignature('abcdefghijk','m4a',expires,bindings.JKT48_SCRAPER_TOKEN);
 globalThis.fetch=async(url,init)=>{assert.equal(init.headers.Range,'bytes=0-3');assert.match(String(url),/\/api\/v1\/music\/media\//);return new Response('test',{status:206,headers:{'Content-Type':'audio/mp4','Content-Range':'bytes 0-3/100'}});};
 const response=await musicMedia(new Request(`https://api.example/media/music/abcdefghijk/${ticket}/audio.m4a`,{headers:{Range:'bytes=0-3'}}),bindings);
 assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes 0-3/100');assert.equal(await response.text(),'test');
 globalThis.fetch=async()=>new Response('video',{headers:{'Content-Type':'video/mp4'}});
 assert.equal((await musicMedia(new Request(`https://api.example/media/music/abcdefghijk/${ticket}/audio.m4a`),bindings)).status,502);
});
test('music rejects duplicate query parameters instead of forwarding ambiguity',async()=>{
 const result=await musicAPI(new Request('https://api.example/api/music/search?q=one&q=two'),bindings);assert.equal(result.status,400);
});
