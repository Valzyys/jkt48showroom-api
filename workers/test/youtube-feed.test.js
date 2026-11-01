import {test} from 'node:test';
import assert from 'node:assert/strict';
import {YOUTUBE_CHANNELS,parseYoutubeFeed,createYoutubeFeedClient} from '../src/runtime/youtube-feed.js';
function xml(channel,id='abcdefghijk'){return `<feed><entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channel.id}</yt:channelId><title>News &amp; &#x2665;</title><published>2026-10-20T00:00:00Z</published><author><name>${channel.name}</name></author><media:group><media:description><![CDATA[Hello <3]]></media:description><media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg"/><media:community><media:statistics views="123"/></media:community></media:group></entry></feed>`;}
test('public feeds preserve video response fields and decode XML without a Google key',()=>{
 const rows=parseYoutubeFeed(xml(YOUTUBE_CHANNELS[0]),YOUTUBE_CHANNELS[0]);assert.equal(rows.length,1);assert.equal(rows[0].title,'News & ♥');assert.equal(rows[0].description,'Hello <3');assert.equal(rows[0].statistics.viewCount,'123');assert.equal(rows[0].url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(rows[0].source,'youtube-public-feed');
 assert.deepEqual(parseYoutubeFeed(xml(YOUTUBE_CHANNELS[1]),YOUTUBE_CHANNELS[0]),[]);assert.throws(()=>parseYoutubeFeed('<html>blocked</html>',YOUTUBE_CHANNELS[0]));assert.throws(()=>parseYoutubeFeed('<!DOCTYPE x><feed></feed>',YOUTUBE_CHANNELS[0]));
});
test('concurrent readers share two bounded feed requests; cache and channel failures retain usable videos',async()=>{
 let calls=0,now=1000,fail=false;
 const client=createYoutubeFeedClient({now:()=>now,ttl:100,fetcher:async(url,init)=>{calls++;assert.equal(init.redirect,'manual');assert.ok(!url.includes('key='));if(fail)return new Response('unavailable',{status:503});const channel=YOUTUBE_CHANNELS.find(c=>url.endsWith(c.id));return new Response(xml(channel,channel===YOUTUBE_CHANNELS[0]?'abcdefghijk':'ABCDEFGHIJK'));}});
 const [a,b]=await Promise.all([client(),client()]);assert.equal(calls,2);assert.deepEqual(a,b);assert.equal(a.length,2);await client();assert.equal(calls,2);now+=101;fail=true;assert.equal((await client()).length,2);assert.equal(calls,4);
});
test('complete upstream failure is an error rather than an invented empty list',async()=>{
 const client=createYoutubeFeedClient({fetcher:async()=>new Response('no',{status:403})});await assert.rejects(client(),error=>error.status===502);
});

test('a cold Worker reuses durable last-good feeds and marks stale fallback without retry storms',async()=>{
 const saved=new Map();let now=1000,calls=0,fail=false;
 const store={load:async id=>saved.get(id),save:async(id,entry)=>saved.set(id,structuredClone(entry))};
 const fetcher=async url=>{calls++;if(fail)return new Response('unavailable',{status:502});const c=YOUTUBE_CHANNELS.find(c=>url.endsWith(c.id));return new Response(xml(c,c===YOUTUBE_CHANNELS[0]?'abcdefghijk':'ABCDEFGHIJK'))};
 const first=createYoutubeFeedClient({store,fetcher,now:()=>now,ttl:100,retryMs:30,maxStale:1000});await first();assert.equal(calls,2);assert.equal(saved.size,2);
 const cold=createYoutubeFeedClient({store,fetcher,now:()=>now,ttl:100,retryMs:30,maxStale:1000});assert.equal((await cold()).length,2);assert.equal(calls,2);
 now+=101;fail=true;let rows=await cold();assert.equal(rows.length,2);assert.ok(rows.every(r=>r.feed_status==='stale'));assert.equal(calls,4);
 await cold();assert.equal(calls,4);now+=31;await cold();assert.equal(calls,6);now+=1001;await assert.rejects(cold(),e=>e.status===502&&e.code==='YOUTUBE_FEED_UNAVAILABLE');
});
test('public channel fallback declares relative publication dates instead of claiming exact timestamps',()=>{
 const input=xml(YOUTUBE_CHANNELS[0]).replace('</entry>','<jkc:source>youtube-public-channel</jkc:source><jkc:dateApproximate>true</jkc:dateApproximate><jkc:publishedText>2 days ago</jkc:publishedText></entry>');
 const [row]=parseYoutubeFeed(input,YOUTUBE_CHANNELS[0]);assert.equal(row.source,'youtube-public-channel');assert.equal(row.date_is_approximate,true);assert.equal(row.published_text,'2 days ago');
});
