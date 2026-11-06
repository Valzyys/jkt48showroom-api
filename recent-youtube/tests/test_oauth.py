import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, AsyncMock
from test_uploader import m, row, Reply
from oauth_credentials import read_credentials, save_credentials, sync_credentials, EXPECTED_CHANNEL


def credential():
 return {'version':'new-version','channel':{'id':EXPECTED_CHANNEL,'title':'Test'},'credentials':{'client_id':'new-client','client_secret':'new-secret','refresh_token':'new-refresh'}}

class OAuthTests(unittest.IsolatedAsyncioTestCase):
 async def test_uses_saved_auto_live_credentials_instead_of_stale_environment(self):
  with tempfile.TemporaryDirectory() as root:
   save_credentials(root,credential());sent=[]
   class Client:
    async def post(self,*a,**kw):sent.append(kw['data']);return Reply(200,body={'access_token':'access','expires_in':3600})
   with patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root,'YOUTUBE_CLIENT_ID':'old','YOUTUBE_CLIENT_SECRET':'old','YOUTUBE_REFRESH_TOKEN':'old'}):
    yt=m.RecentYouTube(Client(),lambda r:None);self.assertEqual(await yt.token(),'access');self.assertEqual(await yt.token(),'access')
   self.assertEqual(len(sent),1);self.assertEqual(sent[0]['refresh_token'],'new-refresh');self.assertEqual(sent[0]['client_id'],'new-client')

 async def test_private_sync_validates_channel_and_saves_mode_600(self):
  with tempfile.TemporaryDirectory() as root,tempfile.TemporaryDirectory() as cred:
   (Path(cred)/'youtube-oauth-worker-token').write_text('private-'+'x'*40)
   class Client:
    async def get(self,url,**kw):
     self.url=url;return Reply(200,body={'connected':True,**credential()})
   client=Client()
   with patch.dict(os.environ,{'CREDENTIALS_DIRECTORY':cred}):self.assertEqual(await sync_credentials(client,root,'https://api.jkt48connect.app:8443'),'new-version')
   self.assertEqual((Path(root)/'oauth-token.json').stat().st_mode&0o777,0o600);self.assertEqual(read_credentials(root)['credentials']['refresh_token'],'new-refresh')
   data=credential();data['channel']['id']='different-channel'
   class Wrong:
    async def get(self,*a,**kw):return Reply(200,body={'connected':True,**data})
   with patch.dict(os.environ,{'CREDENTIALS_DIRECTORY':cred}):
    with self.assertRaisesRegex(ValueError,'channel_or_credentials_invalid'):await sync_credentials(Wrong(),root,'https://api.jkt48connect.app:8443')
   self.assertEqual(read_credentials(root)['channel']['id'],EXPECTED_CHANNEL)

 async def test_oauth_failure_cannot_create_unknown_session_or_spend_insert_budget(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root}):
   u=m.Uploader();r=row();u.rows[r['id']]=r
   class YT:
    async def token(self):raise m.Failure('oauth_invalid_grant')
   u.youtube=YT()
   with self.assertRaisesRegex(m.Failure,'oauth_invalid_grant'):await u.create_session(r)
   self.assertFalse(r.get('_insert_pending'));self.assertFalse(r.get('_insert_count'));self.assertEqual(r['status'],'pending');u.store.db.close();u.store.lock.close()

 async def test_complete_channel_scan_recovers_only_session_jobs_with_zero_bytes(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root}):
   u=m.Uploader();a=row();a.update(status='needs_review',error='youtube_session_creation_unknown',_insert_pending=True)
   b={**a,'id':'idn-open:1','_upload_url':'https://www.googleapis.com/upload/private'};c={**a,'id':'idn-progress:2','_upload_offset':1};d={**a,'id':'idn-old:3','started_at':'2026-10-25T00:00:00Z'}
   u.rows={r['id']:r for r in [a,b,c,d]}
   class YT:
    async def request(self,method,url,**kw):
     if '/channels?' in url:return Reply(200,body={'items':[{'id':EXPECTED_CHANNEL,'contentDetails':{'relatedPlaylists':{'uploads':'uploads'}}}]})
     return Reply(200,body={'items':[]})
   u.youtube=YT();await u.reconcile();self.assertTrue(u.scanned);self.assertEqual(a['status'],'pending');self.assertFalse(a['_insert_pending'])
   for r in [b,c,d]:self.assertEqual(r['status'],'needs_review')
   u.store.db.close();u.store.lock.close()

 async def test_new_token_retries_oauth_failures_without_clearing_real_quota(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root}):
   u=m.Uploader();r=row();r.update(status='failed',error='oauth_invalid_grant',_retry_at=9999999999);u.rows[r['id']]=r
   u.store.control('backoff',{'until':9999999999,'code':'youtube_project_daily_quota'});u.youtube=m.RecentYouTube(None,lambda r:None)
   with patch.object(m,'sync_credentials',new=AsyncMock(return_value='new-version')):await u.sync_oauth()
   self.assertEqual(r['status'],'pending');self.assertEqual(r['_retry_at'],0);self.assertEqual(u.global_retry,9999999999)
   u.store.db.close();u.store.lock.close()

 async def test_media_uses_dedicated_pool_and_retains_range_identity(self):
  from contextlib import asynccontextmanager
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root}):
   u=m.Uploader();r=row()
   class Body:
    status_code=206
    headers={'Content-Range':'bytes 0-3/11','ETag':'stable'}
    async def aiter_content(self,**kw):yield b'data'
   class Media:
    @asynccontextmanager
    async def stream(self,*a,**kw):
     self.range=kw['headers']['Range'];yield Body()
   class Control:
    def stream(self,*a,**kw):raise AssertionError('Control pool must not carry media bytes')
   u.client=Control();u.media_client=Media()
   self.assertEqual(await u.source(r,0,4),b'data');self.assertEqual(u.media_client.range,'bytes=0-3')
   u.store.db.close();u.store.lock.close()

 async def test_new_completed_replay_is_published_ahead_of_old_backlog(self):
  with tempfile.TemporaryDirectory() as root,patch.dict(os.environ,{'RECENT_YOUTUBE_STATE_DIR':root}):
   u=m.Uploader();old=row();old.update(id='idn-old:1',data_id='idn-old',started_at='2026-10-25T12:00:00Z',ended_at='2026-10-25T13:00:00Z',status='uploaded',youtube_id='abcdefghijk')
   new=row();new.update(id='idn-new:1',data_id='idn-new',status='uploaded',youtube_id='123456789ab');u.rows={r['id']:r for r in [old,new]}
   for r in [old,new]:u.store.save(r)
   sent=[]
   async def api(path,data):sent.append(data['data_id']);u.stop.set();return {}
   u.api=api;await u.state_updates()
   self.assertEqual(sent[0],'idn-new');self.assertEqual(u.rows[new['id']]['_dirty'],False)
   self.assertEqual(json.loads(u.store.db.execute('SELECT value FROM jobs WHERE id=?',(new['id'],)).fetchone()[0])['_dirty'],False)
   u.store.db.close();u.store.lock.close()
