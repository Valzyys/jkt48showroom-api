import asyncio, os, tempfile, unittest, json, shutil, subprocess
from pathlib import Path
from unittest.mock import patch
from recorder import YouTube, live_rows, match_code, video_args, FIXED_SLUG, Recorder, epoch
class Response:
 def __init__(self,status,data=None,headers=None):self.status_code=status;self.data=data or {};self.headers=headers or {}
 def json(self):return self.data
class UploadTests(unittest.IsolatedAsyncioTestCase):
 async def test_resume_after_unknown_chunk_result_does_not_insert_a_duplicate(self):
  class Client:
   def __init__(self):self.inserts=0;self.offset=0;self.fail=True
   async def post(self,*args,**kwargs):return Response(200,{'access_token':'synthetic-access','expires_in':3600})
   async def request(self,method,url,**options):
    if method=='POST':
     import json
     assert json.loads(options['data'])['status']['privacyStatus']=='unlisted'
     self.inserts+=1;return Response(200,headers={'Location':'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=synthetic'})
    if options['headers'].get('Content-Length')=='0':return Response(308,headers={'Range':f'bytes=0-{self.offset-1}'}if self.offset else {})
    content=options['headers']['Content-Range'];start=int(content.split(' ')[1].split('-')[0]);assert start==self.offset
    self.offset+=len(options['data'])
    if self.fail:self.fail=False;raise OSError('synthetic ambiguous network failure')
    return Response(200,{'id':'testVideo01','status':{}})
  with tempfile.TemporaryDirectory()as folder,patch.dict(os.environ,{'YOUTUBE_CLIENT_ID':'synthetic','YOUTUBE_CLIENT_SECRET':'synthetic','YOUTUBE_REFRESH_TOKEN':'synthetic'}):
   file=Path(folder)/'video.mp4';file.write_bytes(bytes(9*1024*1024));client=Client();saved=[];youtube=YouTube(client,lambda r:saved.append(dict(r)));row={'title':'Show','started_at':'2026-10-18T10:00:00.000Z','observed_at':'2026-10-18T10:00:00.000Z','partial':False}
   with self.assertRaises(OSError):await youtube.upload(row,file)
   self.assertIn('_upload_url',row);await youtube.upload(row,file)
   self.assertEqual(client.inserts,1);self.assertEqual(row['youtube_id'],'testVideo01');self.assertEqual(row['status'],'uploaded');self.assertNotIn('_upload_url',row)
 async def test_real_segments_finalize_into_seekable_playable_mp4(self):
  if not shutil.which('ffmpeg'):self.skipTest('ffmpeg unavailable')
  with tempfile.TemporaryDirectory()as temp:
   recorder=Recorder.__new__(Recorder);recorder.root=Path(temp);recorder.store=type('Store',(),{'save':lambda self,row:None})()
   row={'id':'a'*32,'started_at':'2026-10-18T10:00:00.000Z','ended_at':'2026-10-18T10:00:02.000Z','partial':False}
   folder=recorder.root/row['id'];folder.mkdir()
   for index in range(2):
    run=folder/('run-'+str(index));run.mkdir()
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=400:sample_rate=44100','-t','1','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-f','mpegts',str(run/'000000.ts')],check=True,capture_output=True)
   video=await recorder.finalize(row);content=video.read_bytes();self.assertLess(content.index(b'moov'),content.index(b'mdat'));self.assertGreater(row['duration_ms'],1900)
   streams=json.loads(subprocess.run(['ffprobe','-v','quiet','-show_streams','-of','json',str(video)],check=True,capture_output=True).stdout)['streams'];self.assertEqual({s['codec_name']for s in streams},{'h264','aac'})
 async def test_oauth_rejection_has_no_credential_content(self):
  class Client:
   async def post(self,*args,**kwargs):return Response(401,{'error':'unauthorized_client','error_description':'secret not to log'})
  with patch.dict(os.environ,{'YOUTUBE_CLIENT_ID':'synthetic','YOUTUBE_CLIENT_SECRET':'synthetic','YOUTUBE_REFRESH_TOKEN':'synthetic'}):
   yt=YouTube(Client(),lambda r:None)
   with self.assertRaisesRegex(Exception,'^oauth_unauthorized_client$'):await yt.token()
   self.assertEqual(yt.auth_status,'error')
 async def test_fixed_resolver_slug_is_preserved(self):
  class Stream:
   status_code=200;text='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nhttps://test.live-video.net/index.m3u8\n'
  class Client:
   async def get(self,url,**kwargs):self.url=url;return Stream()
  recorder=Recorder.__new__(Recorder);recorder.client=Client()
  with patch.dict(os.environ,{'THEATER_STREAM_RESOLVER':'https://streamtest.aslannarnia806.workers.dev/stream'}):
   self.assertEqual(await recorder.stream({'slug':'a-different-show'}),'https://test.live-video.net/index.m3u8');self.assertIn('slug='+FIXED_SLUG,recorder.client.url)
class SourceTests(unittest.TestCase):
 def test_numeric_seconds_and_milliseconds_from_the_real_feed(self):
  self.assertEqual(epoch(1792323867),1792323867)
  self.assertEqual(epoch(1792323867000),1792323867)
  self.assertEqual(epoch('1792323867'),1792323867)
  self.assertIsNone(epoch(0))

 def test_only_explicit_live_rows_can_start_capture(self):
  rows=[{'slug':'old','status':'ended','live_at':'2026-10-18T00:00:00Z'},{'slug':'future','status':'upcoming'},{'slug':'live','status':'live'}]
  self.assertEqual([r['slug']for r in live_rows(rows)],['live'])
 def test_matches_a_theater_code_by_title_and_nearby_start(self):
  plans=[{'code':'SH1','title':'ITADAKI LOVE','start_time':'2026-10-18T10:00:00Z'},{'code':'SH2','title':'ITADAKI LOVE','start_time':'2026-10-17T10:00:00Z'}]
  self.assertEqual(match_code({'title':'ITADAKI LOVE show','live_at':'2026-10-18T10:02:00Z'},plans),'SH1')
 def test_rejects_arbitrary_stream_hosts_without_shell_commands(self):
  with self.assertRaises(Exception):video_args('http://127.0.0.1/private',Path('/tmp/x.ts'))
  args=video_args('https://test.live-video.net/index.m3u8',Path('/tmp/%06d.ts'));self.assertIn('copy',args);self.assertNotIn('shell',args)
if __name__=='__main__':unittest.main()
