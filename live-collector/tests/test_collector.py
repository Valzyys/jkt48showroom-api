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
if __name__=='__main__' :unittest.main()
