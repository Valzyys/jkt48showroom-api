import {test} from 'node:test';
import assert from 'node:assert/strict';
import {database} from './helpers.js';
import {recentYouTubeMap,recentYouTubeOperation,recentRecordings,probeYouTubePlayback,youtubeReplayEligible,YOUTUBE_REPLAY_CUTOFF,recentPlayback} from '../src/collector/recent-youtube.js';
test('manifest selects ended member replays only; metadata is separate from source documents',async()=>{
 const db=database();
 async function put(database,collection,id,value){await db.prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind(database,collection,id,JSON.stringify(value)).run()}
 await put('dcDB','idolmembers','m',{name:'Real Member',group:'jkt48'});await put('dcDB','showrooms','s',{room_id:1,member_data:'m',group:'jkt48'});
 const ended=new Date(Date.now()-1000).toISOString(),doc={data_id:'idn-test',type:'idn',room_id:1,is_dev:false,capture:{status:'completed',pending_recordings:0},live_info:{date:{start:ended,end:ended}},recordings:[{run:'123',bytes:20}]};
 await put('liveDB','livelogs','a',doc);await put('liveDB','livelogs','b',{...doc,data_id:'sr-active',capture:{status:'live'}});await put('liveDB','livelogs','c',{...doc,data_id:'idn-pending',capture:{status:'completed',pending_recordings:1}});
 const call=(path,body)=>recentYouTubeOperation(new Request('https://test/internal/collector/recent-youtube/'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),{DB:db});
 const manifest=await(await call('manifest')).json();assert.equal(manifest.items.length,1);assert.equal(manifest.items[0].name,'Real Member');
 const value={data_id:'idn-test',run:'123',title:'Member | IDN | date',status:'uploaded',youtube_id:'abcdefghijk',privacy:'public',bytes_uploaded:20,error:null};
 assert.equal((await call('state',value)).status,409);value.privacy='unlisted';assert.equal((await call('state',value)).status,200);
 const map=await recentYouTubeMap(db,['idn-test']);assert.equal(map.get('idn-test').videos[0].url,'https://www.youtube.com/watch?v=abcdefghijk');assert.ok(Date.parse(map.get('idn-test').videos[0].public_at)>Date.now()+71*3600*1000);
 assert.equal((await call('state',{...value,youtube_id:'12345678901'})).status,409);assert.equal((await call('state',{...value,run:'999'})).status,404);
 assert.deepEqual(JSON.parse((await db.prepare("SELECT document FROM documents WHERE database_name='liveDB' AND id='a'").first()).document),doc);db.sqlite.close();
});
test('replay playback migrates only a processed, verified and byte-matched recording',async()=>{
 const db=database(),now=Date.now(),id='sr-playback';
 const raw={data_id:id,run:'123',status:'uploaded',youtube_id:'abcdefghijk',privacy:'public',bytes_uploaded:20,processing_status:'succeeded',hls_status:'ready',hls_checked_at:now,hls_qualities:[360]};
 await db.prepare('INSERT INTO collector_recent_youtube VALUES(?,?,?,?)').bind(id,'123',JSON.stringify(raw),now).run();
 const replay=(await recentYouTubeMap(db,[id],{secret:'private-synthetic-secret',origin:'https://api.test',now})).get(id);
 const original={run:'123',bytes:20,url:'https://api.test/media/live/sr-playback/video-123.mp4'};
 const data={live_info:{date:{start:'2026-11-01T00:00:00+07:00'}}};
 let clips=recentRecordings([original],replay,now,data);
 assert.equal(clips[0].storage,'youtube');assert.equal(clips[0].youtube_id,raw.youtube_id);assert.equal(clips[0].youtube_url,'https://www.youtube.com/watch?v=abcdefghijk');assert.equal(clips[0].url,clips[0].stream_url);assert.match(clips[0].stream_url,/\/media\/youtube\/abcdefghijk\//);assert.ok(!JSON.stringify(clips).includes('private-synthetic-secret'));
 assert.equal(recentRecordings([{...original,bytes:21}],replay,now,data)[0].storage,'r2');
 assert.equal(recentRecordings([original],replay,now+86400001,data)[0].storage,'r2');
 replay.videos[0].processing_status='processing';assert.equal(recentRecordings([original],replay,now,data)[0].storage,'r2');
 db.sqlite.close();
});
test('WIB cutoff preserves old recording URLs even when YouTube playback is ready',()=>{
 const now=Date.now(),old={live_info:{date:{start:new Date(YOUTUBE_REPLAY_CUTOFF-1)}}},fresh={started_at:new Date(YOUTUBE_REPLAY_CUTOFF).toISOString()};
 const original={run:'123',bytes:20,url:'https://api.test/media/live/sr-old/video-123.mp4'};
 const replay={videos:[{run:'123',bytes_uploaded:20,status:'uploaded',processing_status:'succeeded',hls_status:'ready',hls_checked_at:now,stream_url:'https://api.test/media/youtube/abcdefghijk/ticket/index.m3u8',youtube_id:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk'}]};
 assert.equal(youtubeReplayEligible(old),false);assert.equal(youtubeReplayEligible(fresh),true);assert.equal(youtubeReplayEligible({}),false);
 assert.equal(recentRecordings([original],replay,now,old)[0].url,original.url);
 assert.equal(recentRecordings([original],replay,now,old)[0].storage,'r2');
 assert.equal(recentRecordings([original],replay,now,fresh)[0].storage,'youtube');
 assert.deepEqual(recentPlayback(old,{},replay),{});
 const result=recentPlayback(fresh,{storage:'youtube',stream_url:replay.videos[0].stream_url,parts:1},replay);
 assert.equal(result.playback.status,'ready');assert.equal(result.playback.youtube_id,'abcdefghijk');assert.equal(result.playback.stream_url,replay.videos[0].stream_url);
});
test('playback readiness checks the real VOD and a media segment, never accepts a master alone',async t=>{
 const b={JKT48_SCRAPER_TOKEN:'synthetic-private-token',JKT48_SCRAPER_URL:'https://relay.test/api/v1/'},calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url:String(url),method:init.method});
  if(String(url).endsWith('/q360/index.m3u8'))return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nsegment-0.ts\n#EXT-X-ENDLIST\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
  if(String(url).endsWith('/segment-0.ts'))return new Response(null,{headers:{'Content-Type':'video/mp2t'}});
  return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nq360/index.m3u8\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 });
 let result=await probeYouTubePlayback('abcdefghijk',b,'https://api.test');assert.equal(result.hls_status,'ready');assert.deepEqual(result.hls_qualities,[360]);assert.equal(calls.at(-1).method,'HEAD');
 t.mock.method(globalThis,'fetch',async()=>Response.json({message:'Unavailable'},{status:503}));result=await probeYouTubePlayback('abcdefghijk',b,'https://api.test');assert.equal(result.hls_status,'unavailable');assert.equal(result.hls_error,'playback_http_503');
});
