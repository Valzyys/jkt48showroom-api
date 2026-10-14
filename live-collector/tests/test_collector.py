import os,unittest,tempfile,subprocess,json,shutil
from unittest.mock import patch
from collector import Store,match_member,stream_allowed,frame_command,video_command,Collector
from mp4_repair import boxes,box,repair_moov,repair_mfra
class CollectorTests(unittest.TestCase):
 def test_stream_and_commands(self):
  self.assertTrue(stream_allowed('https://example.playback.live-video.net/a.m3u8'));self.assertFalse(stream_allowed('file:///etc/passwd'));self.assertFalse(stream_allowed('https://evil.test/a'))
  self.assertIn('pipe:1',video_command('https://live.showroom-live.com/a.m3u8'));self.assertIn('copy',video_command('https://live.showroom-live.com/a.m3u8'));self.assertIn('scale=640:-2',frame_command('https://live.showroom-live.com/a.m3u8',640))
 def test_member_and_restart(self):
  members=[{'id':'a','name':'Jessica Chandra','slug':'jessica-chandra','nicknames':['Jessi']}]
  self.assertEqual(match_member('Jessi JKT48','JKT48_Jessi',members)['id'],'a');self.assertIsNone(match_member('Unknown','JKT48_Unknown',members))
  with tempfile.TemporaryDirectory() as root:
   s=Store(root+'/state.sqlite');s.save({'data_id':'a','frames':[1]});self.assertEqual(Store(root+'/state.sqlite').rows()[0]['frames'],[1])
 def test_quantity_idempotency_and_unknown_value(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();row={'data_id':'x','users':{},'gifts':{},'seen_ids':[],'gifts_status':'collecting'}
   event={'user_id':'u','gift_id':1,'num':2,'point':10,'date':1000};c.gift(row,event,'event1');c.gift(row,event,'event1');self.assertEqual(sum(g['num'] for g in row['gifts'].values()),2);self.assertEqual(sum(g['send_count'] for g in row['gifts'].values()),1)
   c.gift(row,{**event,'point':None},'event2');self.assertEqual(row['gifts_status'],'partial')
 def test_telemetry_excludes_stream_and_credentials(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();c.rows={'s':{'data_id':'s','name':'Member','type':'showroom','completed':False,'last_seen':100,'frames':[100000],'screenshot_errors':0,'screenshots_allowed':True,'stream':'https://stream.test/private-token','bcsvr_key':'private-key'}}
   import json
   payload=json.dumps(c.telemetry());self.assertNotIn('private-token',payload);self.assertNotIn('private-key',payload);self.assertEqual(c.telemetry()['sessions'][0]['last_screenshot'],100000)
 @unittest.skipUnless(shutil.which('ffmpeg'),'Requires FFmpeg')
 def test_fragmented_mp4_has_complete_aac_configuration(self):
  source=subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=256x144:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','1','-c:v','libx264','-preset','ultrafast','-c:a','aac','-f','mpegts','pipe:1'],capture_output=True,check=True).stdout
  command=video_command('https://live.showroom-live.com/a.m3u8');position=command.index('-i');command[position+1]='pipe:0';command[command.index('-protocol_whitelist')+1]='pipe';start=command.index('-live_start_index');del command[start:start+2]
  fixed=subprocess.run(command,input=source,capture_output=True,check=True).stdout
  def profile(data):
   probe=subprocess.run(['ffprobe','-v','quiet','-show_streams','-of','json','pipe:0'],input=data,capture_output=True,check=True)
   return next(s['profile'] for s in json.loads(probe.stdout)['streams'] if s['codec_name']=='aac')
  self.assertEqual(profile(fixed),'LC')
  legacy=subprocess.run([v.replace('delay_moov','empty_moov') for v in command],input=source,capture_output=True,check=True).stdout
  self.assertNotEqual(profile(legacy),'LC');chunks=[];delta=0;original_media=[];fixed_media=[]
  for kind,payload in boxes(legacy):
   raw=box(kind,payload)
   if kind==b'moov':updated=repair_moov(raw);delta=len(updated)-len(raw);raw=updated
   elif kind==b'mfra':raw=repair_mfra(raw,delta)
   elif kind==b'mdat':original_media.append(payload)
   chunks.append(raw)
  repaired=b''.join(chunks);self.assertEqual(profile(repaired),'LC');self.assertEqual(repair_moov(next(box(k,v) for k,v in boxes(repaired) if k==b'moov')),next(box(k,v) for k,v in boxes(repaired) if k==b'moov'))
  self.assertEqual(original_media,[v for k,v in boxes(repaired) if k==b'mdat'])
  result=subprocess.run(['ffmpeg','-v','error','-i','pipe:0','-f','null','-'],input=repaired,capture_output=True);self.assertEqual(result.returncode,0,result.stderr.decode())

class ResilienceTests(unittest.IsolatedAsyncioTestCase):
 async def test_upload_survives_more_than_four_failures_without_replacing_data(self):
  from unittest.mock import AsyncMock
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();c.api=AsyncMock(side_effect=[RuntimeError('HTTP 401')]*5+[{'part':{'partNumber':1,'etag':'a'}}]);monitor={'errors':0};data=b'one original buffered part'
   with patch('collector.asyncio.sleep',new=AsyncMock()):result=await c.reliable_video_api('video/part/test/1','PUT',data=data,monitor=monitor)
   self.assertEqual(c.api.await_count,6);self.assertEqual(result['part']['etag'],'a');self.assertFalse(monitor['retrying']);self.assertTrue(all(call.args[3] is data for call in c.api.await_args_list))
 async def test_recovery_uses_authoritative_parts_and_marks_interrupted_media(self):
  from unittest.mock import AsyncMock
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();parts=[{'partNumber':1,'etag':'a'},{'partNumber':2,'etag':'b'}];c.api=AsyncMock(side_effect=[{'parts':parts},{'bytes':100,'url':'https://api.test/media/video.mp4'}]);row={'data_id':'idn-test','recordings':[],'pending_uploads':{'123':{'id':'test','active':False,'complete':False,'recording':{'run':'123','bytes':50,'partial':True}}}}
   await c.recover_uploads(row);self.assertEqual(c.api.await_args_list[1].args[2]['parts'],parts);self.assertFalse(row['pending_uploads']);self.assertFalse(row['recordings'][0]['index_available']);self.assertIsNone(row['recordings'][0]['duration_ms']);self.assertEqual(row['recordings'][0]['bytes'],100)
 async def test_missing_listing_does_not_stop_an_advancing_recording(self):
  import time
  from unittest.mock import AsyncMock
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();c.api=AsyncMock(return_value={'status':'ended'});row={'type':'idn','data_id':'idn-x','live_id':'slug','missing':20,'video_monitor':{'last_progress':int(time.time()*1000)}}
   self.assertFalse(await c.confirm_ended(row));c.api.assert_not_awaited();row['video_monitor']['last_progress']=int((time.time()-90)*1000);self.assertTrue(await c.confirm_ended(row));self.assertEqual(row['end_reason'],'provider_confirmed')
 async def test_all_detected_lives_start_even_when_legacy_limit_is_one(self):
  import time
  from unittest.mock import AsyncMock
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();lives={f'idn-{i}':{'data_id':f'idn-{i}','live_id':f'live-{i}','room_id':i+1,'name':f'Member {i}','img':'','url_key':f'jkt48_{i}','type':'idn','started_at':time.time()-10,'stream':None,'viewers':1} for i in range(12)}
   c.showroom=AsyncMock(return_value={});c.idn=AsyncMock(return_value=lives)
   async def api(path,*args,**kwargs):
    if path=='config':return {'enabled':True,'maxSessions':1,'pollSeconds':30}
    if path=='heartbeat':c.stop.set()
    return {'ok':True}
   async def attach(row):c.tasks[row['data_id']]=[]
   c.api=api;c.attach=AsyncMock(side_effect=attach);await c.run();self.assertEqual(c.attach.await_count,12);self.assertEqual(len(c.rows),12)
 async def test_parallel_chat_adds_launch_exactly_one_bridge(self):
  from unittest.mock import AsyncMock,Mock
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'COLLECTOR_API_URL':'https://api.test','COLLECTOR_TOKEN':'synthetic','COLLECTOR_STATE_DIR':root}):
   c=Collector();process=Mock();process.returncode=None;process.stdin.write=Mock();process.stdin.drain=AsyncMock();process.stdout.readline=AsyncMock(return_value=b'')
   async def launch(*args,**kwargs):
    import asyncio
    await asyncio.sleep(0);return process
   import asyncio
   with patch('collector.asyncio.create_subprocess_exec',new=AsyncMock(side_effect=launch)) as spawn:
    await asyncio.gather(*(c.bridge_send({'action':'add','id':str(i)}) for i in range(20)));await c.bridge_task;self.assertEqual(spawn.await_count,1);self.assertEqual(process.stdin.write.call_count,21)

if __name__=='__main__':unittest.main()
