import asyncio
from contextlib import asynccontextmanager
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('recent_uploader',Path(__file__).parents[1]/'uploader.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def row(kind='idn'):
 return dict(id='idn-test:123',data_id='idn-test',run='123',name='Member Test',type=kind,
  started_at='2026-11-02T12:00:00Z',ended_at='2026-11-02T13:00:00Z',live_title='Ngobrol bareng',
  part=1,part_count=1,bytes=11,status='pending',error=None)

class Reply:
 def __init__(self,code,headers=None,body=None):self.status_code=code;self.headers=headers or {};self.body=body or {}
 def json(self):return self.body

class PolicyTests(unittest.TestCase):
 def test_limit_classifier_distinguishes_channel_daily_and_request_limits(self):
  yt=m.RecentYouTube(None,lambda r:None)
  cases=[('uploadLimitExceeded','channel cap','youtube_channel_upload_limit',86460),
   ('quotaExceeded','quota','youtube_project_daily_quota',None),
   ('rateLimitExceeded','Video Uploads per day','youtube_project_daily_quota',None),
   ('rateLimitExceeded','requests per minute','youtube_rate_limit',120)]
  now=m.epoch('2026-10-29T06:00:00Z')
  with patch.object(m.time,'time',return_value=now):
   for reason,message,code,delay in cases:
    with self.subTest(reason=reason,message=message):
     with self.assertRaises(m.UploadLimit)as ctx:
      yt.reject(Reply(403,body={'error':{'message':message,'errors':[{'reason':reason}]}}))
     self.assertEqual(str(ctx.exception),code);self.assertEqual(ctx.exception.reason,reason)
     self.assertEqual(ctx.exception.retry_at,now+delay if delay else m.pacific_reset(now))
 def test_daily_reset_tracks_pacific_daylight_saving(self):
  for now,expected in [('2026-10-29T06:00:00Z','2026-10-29T07:01:00Z'),('2026-12-01T06:00:00Z','2026-12-01T08:01:00Z')]:
   self.assertEqual(m.pacific_reset(m.epoch(now)),m.epoch(expected))
 def test_429_respects_retry_after_without_logging_response_text(self):
  yt=m.RecentYouTube(None,lambda r:None)
  with patch.object(m.time,'time',return_value=1000):
   with self.assertRaises(m.UploadLimit)as ctx:yt.reject(Reply(429,{'Retry-After':'600'}, {'error':{'message':'SECRET'}}))
  self.assertEqual(ctx.exception.retry_at,1600);self.assertNotIn('SECRET',str(ctx.exception))
 def test_exact_72_hour_boundary_uses_end_not_start(self):
  r=row();end=m.epoch(r['ended_at']);self.assertEqual(m.privacy(r,end+m.EMBARGO-0.001),'unlisted');self.assertEqual(m.privacy(r,end+m.EMBARGO),'public')
  r['type']='showroom';self.assertEqual(m.privacy(r,end),'public')
 def test_invalid_end_never_publishes_idn(self):
  r=row();r['ended_at']=None;self.assertEqual(m.privacy(r,10**12),'unlisted')
  with self.assertRaises(m.Failure):m.metadata(r)
 def test_title_preserves_member_platform_date_part_under_limit(self):
  r=row();r.update(live_title='A'*500,name='M'*80,part=12,part_count=15)
  v=m.metadata(r,m.epoch(r['ended_at']));title=v['snippet']['title']
  self.assertLessEqual(len(title),100);self.assertIn('02-11-2026 19.00 WIB',title);self.assertIn('Bagian 12/15',title)
  self.assertEqual(v['status']['privacyStatus'],'unlisted');self.assertIn(m.MARKER+r['id'],v['snippet']['description'])
  r.update(live_title='🫰🏻'*300,name='🩵'*40);v=m.metadata(r);self.assertLessEqual(len(v['snippet']['title'].encode('utf-16-le'))//2,100)
 def test_persistent_state_and_singleton_no_media_files(self):
  with tempfile.TemporaryDirectory()as tmp:
   s=m.Store(Path(tmp));r=row();r['_upload_url']='PRIVATE';s.save(r);self.assertEqual(s.rows()[r['id']]['_upload_url'],'PRIVATE')
   with self.assertRaises(BlockingIOError):m.Store(Path(tmp))
   self.assertFalse(any(p.suffix in ('.mp4','.ts')for p in Path(tmp).iterdir()));s.db.close();s.lock.close()

class TransferTests(unittest.IsolatedAsyncioTestCase):
 def uploader(self,tmp):
  with patch.dict(m.os.environ,{'RECENT_YOUTUBE_STATE_DIR':tmp}):return m.Uploader()
 async def test_rejection_blocks_second_worker_before_it_inserts(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);a=row();b=row();b['id']='idn-other:124';u.rows={a['id']:a,b['id']:b};calls=[]
   class YT(m.RecentYouTube):
    async def token(self):return "synthetic"
    async def request(self,*args,**kwargs):
     calls.append(1);await asyncio.sleep(0)
     return Reply(403,body={'error':{'errors':[{'reason':'uploadLimitExceeded'}]}})
   u.youtube=YT(None,lambda r:None)
   async def source(*args):return b'x'
   u.source=source
   async def attempt(r):
    try:await u.upload(r)
    except m.Failure as e:u.failed(r,e)
   await asyncio.gather(attempt(a),attempt(b));self.assertEqual(len(calls),1)
   self.assertEqual(a['error'],'youtube_channel_upload_limit');self.assertEqual(b['status'],'pending')
   deadline=u.global_retry;u.store.db.close();u.store.lock.close()
   restarted=self.uploader(tmp);self.assertEqual(restarted.global_retry,deadline);restarted.store.db.close();restarted.store.lock.close()
 async def test_successful_session_pacing_persists_without_losing_resumable_url(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);a=row();b=row();b['id']='idn-other:124';u.rows={a['id']:a,b['id']:b}
   class YT:
    async def token(self):return "synthetic"
    async def request(self,*args,**kwargs):return Reply(200,{'Location':'https://www.googleapis.com/upload/test'})
    def session_url(self,url):return url
   u.youtube=YT();await u.create_session(a)
   with self.assertRaisesRegex(m.Failure,'insert_wait'):await u.create_session(b)
   self.assertIn('_upload_url',a);self.assertFalse(a['_insert_pending'])
   until=u.next_insert;u.store.db.close();u.store.lock.close()
   restarted=self.uploader(tmp);self.assertEqual(restarted.next_insert,until);self.assertEqual(restarted.rows[a['id']]['_upload_url'],a['_upload_url']);restarted.store.db.close();restarted.store.lock.close()
 async def test_legacy_quota_recheck_does_not_touch_finished_or_open_uploads(self):
  with tempfile.TemporaryDirectory()as tmp:
   s=m.Store(Path(tmp));a=row();a.update(error='youtube_quota',_retry_at=9999999999)
   b=dict(a,id='idn-open:1',_upload_url='PRIVATE');c=dict(a,id='idn-done:1',_transfer_complete=True)
   for r in(a,b,c):s.save(r)
   s.db.close();s.lock.close();u=self.uploader(tmp)
   self.assertEqual(u.rows[a['id']]['_retry_at'],0);self.assertEqual(u.rows[b['id']]['_upload_url'],'PRIVATE');self.assertTrue(u.rows[c['id']]['_transfer_complete'])
   self.assertEqual(u.rows[b['id']]['_retry_at'],9999999999);u.store.db.close();u.store.lock.close()
 async def test_resume_reads_only_google_acknowledged_range(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r['_upload_url']='https://www.googleapis.com/upload/test';u.rows[r['id']]=r;calls=[]
   async def source(r,start,length):calls.append((start,length));return b'x'*length
   u.source=source
   class YT:
    async def token(self):return "synthetic"
    def session_url(self,x):return x
    async def request(self,method,url,**kwargs):
     cr=kwargs['headers']['Content-Range']
     if cr=='bytes */11':return Reply(308,{'Range':'bytes=0-4'})
     assert cr=='bytes 5-10/11';return Reply(201,body={'id':'abcdefghijk'})
    def result(self,r,response):
     if response.status_code==201:r['youtube_id']=response.body['id'];return True
     return False
   u.youtube=YT();await u.upload(r);self.assertEqual(calls,[(0,11),(5,6)]);self.assertEqual(r['youtube_id'],'abcdefghijk');u.store.db.close();u.store.lock.close()
 async def test_prefetch_keeps_exact_order_and_uploads_every_byte(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r['_upload_url']='https://www.googleapis.com/upload/test';chunks=[]
   async def source(r,start,length):return bytes(range(start,start+length))
   u.source=source
   class YT:
    async def token(self):return "synthetic"
    def session_url(self,x):return x
    async def request(self,method,url,**kw):
     if kw['headers']['Content-Range']=='bytes */11':return Reply(308)
     data=kw['data'];chunks.append(data);await asyncio.sleep(0)
     end=sum(map(len,chunks))-1
     return Reply(201,body={'id':'abcdefghijk'})if end==10 else Reply(308,{'Range':'bytes=0-'+str(end)})
    def result(self,r,response):
     if response.status_code==201:r['youtube_id']=response.body['id'];return True
     return False
   u.youtube=YT()
   with patch.object(m,'CHUNK',4):await u.upload(r)
   self.assertEqual([len(x)for x in chunks],[4,4,3]);self.assertEqual(b''.join(chunks),bytes(range(11)));u.store.db.close();u.store.lock.close()
 async def test_expired_session_does_not_start_duplicate(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r['_upload_url']='https://www.googleapis.com/upload/test'
   async def source(*a):return b'x'
   async def reconcile(**kwargs):pass
   u.source=source;u.reconcile=reconcile
   class YT:
    async def token(self):return "synthetic"
    def session_url(self,x):return x
    async def request(self,*a,**kw):return Reply(404)
    def result(self,*a):return False
   u.youtube=YT()
   with self.assertRaisesRegex(m.Failure,'expired_review'):await u.upload(r)
   self.assertEqual(r['status'],'needs_review');u.store.db.close();u.store.lock.close()
 async def test_playlist_id_before_upload_completion_never_skips_open_session(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r['_upload_url']='https://www.googleapis.com/upload/test';u.rows[r['id']]=r
   class YT:
    async def token(self):return "synthetic"
    async def request(self,method,url,**kw):
     if '/channels?'in url:return Reply(200,body={'items':[{'id':'UCTyCC-_QhsV01cN2CAzN3Fg','contentDetails':{'relatedPlaylists':{'uploads':'test'}}}]})
     if '/playlistItems?'in url:return Reply(200,body={'items':[{'snippet':{'description':m.MARKER+r['id'],'resourceId':{'videoId':'abcdefghijk'}}}]})
     raise AssertionError('An open session must be queried through its resumable URL, not adopted from the playlist')
   u.youtube=YT();await u.reconcile();self.assertNotIn('youtube_id',r);self.assertIn('_upload_url',r);self.assertFalse(r.get('_transfer_complete'));u.store.db.close();u.store.lock.close()
 async def test_orphan_preallocated_id_waits_for_verified_processing(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();u.rows[r['id']]=r
   class YT:
    async def token(self):return "synthetic"
    async def request(self,method,url,**kw):
     if '/channels?'in url:return Reply(200,body={'items':[{'id':'UCTyCC-_QhsV01cN2CAzN3Fg','contentDetails':{'relatedPlaylists':{'uploads':'test'}}}]})
     if '/playlistItems?'in url:return Reply(200,body={'items':[{'snippet':{'description':m.MARKER+r['id'],'resourceId':{'videoId':'abcdefghijk'}}}]})
     return Reply(200,body={'items':[{'processingDetails':{'processingStatus':'processing'},'contentDetails':{'duration':'P0D'},'status':{'privacyStatus':'unlisted'}}]})
   u.youtube=YT();await u.reconcile();self.assertEqual(r['status'],'needs_review');self.assertFalse(r.get('_transfer_complete'));self.assertEqual(r['youtube_id'],'abcdefghijk');u.store.db.close();u.store.lock.close()
 async def test_two_workers_never_upload_same_job_twice(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();u.rows[r['id']]=r;u.scanned=True;calls=[]
   async def upload(job):
    calls.append(job['id']);await asyncio.sleep(0.01);job.update(youtube_id='abcdefghijk',_transfer_complete=True);u.stop.set()
   async def visibility(job):job['youtube_privacy']='unlisted'
   u.upload=upload;u.visibility=visibility;await asyncio.gather(u.uploads(),u.uploads());self.assertEqual(calls,[r['id']]);u.store.db.close();u.store.lock.close()
 async def test_ambiguous_session_creation_cannot_create_second_insert(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();u.rows[r['id']]=r
   async def source(*args):return b'x'
   u.source=source
   class YT:
    async def token(self):return "synthetic"
    async def request(self,*args,**kwargs):raise ConnectionError('private transport error')
   u.youtube=YT()
   with self.assertRaisesRegex(m.Failure,'session_creation_unknown'):await u.upload(r)
   self.assertEqual(r['status'],'needs_review');self.assertTrue(r['_insert_pending']);u.store.db.close();u.store.lock.close()
 async def test_daily_budget_reserves_insert_slots_for_theater(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();day=m.datetime.now(m.ZoneInfo('America/Los_Angeles')).date().isoformat()
   u.rows={'budget':{'_insert_day':day,'_insert_count':90}}
   async def source(*args):return b'x'
   u.source=source
   with self.assertRaisesRegex(m.Failure,'youtube_daily_budget'):await u.upload(r)
   self.assertGreater(u.global_retry,m.time.time());self.assertNotIn('_insert_pending',r);u.store.db.close();u.store.lock.close()
 async def test_range_identity_check_before_body(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r['_source_etag']='old'
   class Client:
    @asynccontextmanager
    async def stream(self,*a,**k):yield Reply(206,{'Content-Range':'bytes 0-10/11','ETag':'new'})
   u.client=Client()
   with self.assertRaisesRegex(m.Failure,'source_identity_changed'):await u.source(r,0,11)
   u.store.db.close();u.store.lock.close()
 async def test_publication_preserves_other_mutable_status_fields(self):
  with tempfile.TemporaryDirectory()as tmp:
   u=self.uploader(tmp);r=row();r.update(youtube_id='abcdefghijk',youtube_privacy='unlisted',ended_at='2026-01-01T00:00:00Z');bodies=[]
   class YT:
    async def token(self):return "synthetic"
    async def request(self,method,url,**kw):
     if method=='GET':return Reply(200,body={'items':[{'status':{'privacyStatus':'unlisted','embeddable':False,'license':'creativeCommon','uploadStatus':'processed'},'processingDetails':{'processingStatus':'succeeded'}}]})
     bodies.append(json.loads(kw['data']));return Reply(200,body={'status':{'privacyStatus':'public'}})
   u.youtube=YT();await u.visibility(r);self.assertEqual(r['youtube_privacy'],'public');self.assertFalse(bodies[0]['status']['embeddable']);self.assertEqual(bodies[0]['status']['license'],'creativeCommon');self.assertNotIn('uploadStatus',bodies[0]['status']);u.store.db.close();u.store.lock.close()
