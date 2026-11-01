import {test} from 'node:test';import assert from 'node:assert/strict';import {recordingSession,sessionPlaylist} from '../src/collector/recording-session.js';
import {database} from './helpers.js';
const data={data_id:'idn-test',capture:{status:'completed'},live_info:{date:{start:'2026-10-14T10:00:00.000Z',end:'2026-10-14T10:10:00.000Z'}},recordings:[]};
test('coverage unions overlapping reconnect parts instead of adding duplicate minutes',()=>{const d=structuredClone(data);d.recordings=[{run:'1',started_at:d.live_info.date.start,duration_ms:360000,timing_source:'playlist'},{run:'2',started_at:'2026-10-14T10:05:00Z',duration_ms:300000,timing_source:'playlist'}];const s=recordingSession(d,'https://api.test');assert.equal(s.status,'complete');assert.equal(s.covered_duration_ms,600000);assert.equal(s.playback_duration_ms,660000);assert.equal(s.missing_duration_ms,0);assert.equal(s.stream_url,'https://api.test/media/live/idn-test/recording.m3u8')});
test('legacy missing start or interrupted parts never claim a verified full live',()=>{const d=structuredClone(data);d.recordings=[{run:'1',duration_ms:300000}];let s=recordingSession(d,'https://api.test');assert.equal(s.status,'partial');assert.equal(s.minimum_missing_duration_ms,300000);assert.equal(s.timing_verified,false);d.recordings[0].duration_ms=null;d.recordings[0].index_available=false;s=recordingSession(d,'https://api.test');assert.equal(s.status,'unverified');assert.equal(s.minimum_missing_duration_ms,null);assert.equal(s.stream_url,null)});
test('verified YouTube session includes every reconnect part and reads no R2 objects',async t=>{
 const db=database(),d=structuredClone(data);d.live_info.date={start:'2026-10-29T00:00:00+07:00',end:'2026-10-29T00:10:00+07:00'};d.recordings=[{run:'1',bytes:20},{run:'2',bytes:30}];
 await db.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind('liveDB','livelogs','log',JSON.stringify(d)).run();
 for(const [i,c]of d.recordings.entries())await db.prepare('INSERT INTO collector_recent_youtube VALUES(?,?,?,?)').bind(d.data_id,c.run,JSON.stringify({run:c.run,youtube_id:i?'12345678901':'abcdefghijk',bytes_uploaded:c.bytes,status:'uploaded',processing_status:'succeeded',hls_status:'ready',hls_checked_at:Date.now(),hls_qualities:[360,720]}),Date.now()).run();
 const b={DB:db,JKT48_SCRAPER_URL:'https://relay.test/api/v1/',JKT48_SCRAPER_TOKEN:'synthetic-secret'};
 t.mock.method(globalThis,'fetch',async()=>new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment-0.ts\n#EXT-X-ENDLIST\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}}));
 const index=()=>{throw Error('R2 must not be read')};
 let response=await sessionPlaylist(new Request('https://api.test/media/live/idn-test/recording.m3u8'),b,index);assert.equal(response.status,200);assert.match(await response.text(),/recording-q720\.m3u8/);
 response=await sessionPlaylist(new Request('https://api.test/media/live/idn-test/recording-q720.m3u8'),b,index);const manifest=await response.text();assert.equal(response.status,200);assert.match(manifest,/\/abcdefghijk\//);assert.match(manifest,/\/12345678901\//);assert.equal((manifest.match(/#EXT-X-DISCONTINUITY/g)||[]).length,1);assert.match(manifest,/#EXT-X-ENDLIST/);assert.ok(!manifest.includes('synthetic-secret'));
 db.sqlite.close();
});
test('legacy combined playlist keeps reading R2 despite a ready YouTube copy',async()=>{
 const db=database(),d=structuredClone(data);d.recordings=[{run:'1',bytes:20}];
 await db.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind('liveDB','livelogs','old',JSON.stringify(d)).run();
 await db.prepare('INSERT INTO collector_recent_youtube VALUES(?,?,?,?)').bind(d.data_id,'1',JSON.stringify({run:'1',youtube_id:'abcdefghijk',bytes_uploaded:20,status:'uploaded',processing_status:'succeeded',hls_status:'ready',hls_checked_at:Date.now(),hls_qualities:[360]}),Date.now()).run();
 let reads=0;const b={DB:db,JKT48_SCRAPER_TOKEN:'synthetic',IMAGES_BUCKET:{async head(){reads++;return {size:20}}}};
 const response=await sessionPlaylist(new Request('https://api.test/media/live/idn-test/recording.m3u8'),b,async()=>({init_length:8,segments:[{duration:6,length:12,offset:8}]}));
 assert.equal(response.status,200);assert.equal(reads,1);assert.match(await response.text(),/video-1\.mp4/);db.sqlite.close();
});
