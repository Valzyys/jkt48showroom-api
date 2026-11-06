import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest

sys.path.insert(0,str(Path(__file__).parents[1]));from playlist_manager import PlaylistManager,plan,eligible,Failure,month_category,needs_grouping,GROUP_VERSION

def row(platform='showroom'):
 return {'id':'sr-test:1','name':'Cathleen Nixie','type':platform,'started_at':'2026-09-30T17:10:00Z','ended_at':'2026-10-01T00:00:00Z','youtube_id':'abcdefghijk','youtube_privacy':'public','_transfer_complete':True}

class Store:
 def __init__(self,path):self.db=sqlite3.connect(path);self.saved=[]
 def save(self,r):self.saved.append(dict(r))

class PolicyTests(unittest.TestCase):
 def test_nickname_from_catalog_and_platform_are_independent_categories(self):
  members={'cathleen nixie':{'id':'m1','nicknames':['Erine'],'name':'Cathleen Nixie'}}
  self.assertEqual(plan(row('idn'),members),[('member:m1','Erine JKT48'),('platform:idn','IDN Live JKT48'),('month:2026-10','Oktober 2026 • JKT48 Live Chapter')])
  self.assertEqual(plan(row(),members)[1],('platform:showroom','Showroom Live JKT48'))
 def test_unlisted_embargo_never_exposed_via_public_playlist(self):
  r=row('idn');end=datetime.fromisoformat(r['ended_at'].replace('Z','+00:00')).timestamp()
  self.assertFalse(eligible(r,end+72*3600-1));self.assertTrue(eligible(r,end+72*3600))
  r['youtube_privacy']='unlisted';self.assertFalse(eligible(r,end+72*3600+1))
  r['youtube_privacy']='public';r['_transfer_complete']=False;self.assertFalse(eligible(r,end+1000000))
 def test_month_uses_start_wib_at_month_and_year_boundaries(self):
  r=row();self.assertEqual(month_category(r)[0],'month:2026-10')
  r['started_at']='2026-12-31T17:00:00Z';self.assertEqual(month_category(r),('month:2027-01','Januari 2027 • JKT48 Live Chapter'))
  r['started_at']='2026-10-31T16:59:59Z';r['ended_at']='2026-11-01T02:00:00Z'
  self.assertEqual(month_category(r)[0],'month:2026-10')
 def test_invalid_start_does_not_fall_back_to_upload_month(self):
  for start in ('bad','2026-10-01T00:00:00',None):
   with self.subTest(start=start):
    r=row();r['started_at']=start
    with self.assertRaisesRegex(Failure,'start_date_invalid'):month_category(r)
 def test_existing_grouped_videos_need_month_backfill_once(self):
  r=row();r['playlist_status']='grouped';self.assertTrue(needs_grouping(r))
  r['_playlist_group_version']=GROUP_VERSION;self.assertFalse(needs_grouping(r))

class PlaylistTests(unittest.IsolatedAsyncioTestCase):
 def setup_manager(self,tmp):
  store=Store(str(Path(tmp)/'test.sqlite'));u=types.SimpleNamespace(store=store)
  return PlaylistManager(u)
 async def test_member_and_platform_added_once_even_after_restart(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.members={'cathleen nixie':{'id':'m1','nicknames':['Erine']}};m.remote=[];calls=[]
   async def request(method,resource,params,value=None):
    calls.append((method,resource,value))
    if method=='GET':return {'items':[]}
    if resource=='playlists':return {'id':'p'+str(len(calls)),**value}
    return {'id':'item'+str(len(calls))}
   m.request=request;r=row();await m.group(r);self.assertEqual(r['playlist_status'],'grouped');self.assertEqual([p['title']for p in r['playlists']],['Erine JKT48','Showroom Live JKT48','Oktober 2026 • JKT48 Live Chapter'])
   self.assertFalse(needs_grouping(r))
   self.assertEqual(sum(x[:2]==('POST','playlists')for x in calls),3);self.assertEqual(sum(x[:2]==('POST','playlistItems')for x in calls),3)
   again=PlaylistManager(m.u);again.members=m.members;again.request=request;await again.group(r)
   self.assertEqual(sum(x[:2]==('POST','playlistItems')for x in calls),3);self.assertEqual(sum(x[:2]==('POST','playlists')for x in calls),3);m.db.close()
 async def test_legacy_memberships_backfill_month_without_duplicate_inserts(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.remote=[];m.members={'cathleen nixie':{'id':'m1','nicknames':['Erine']}}
   for key,title,pid in [('member:m1','Erine JKT48','member-p'),('platform:showroom','Showroom Live JKT48','platform-p')]:
    m.db.execute('INSERT INTO yt_playlists VALUES(?,?,?,?)',(key,title,pid,'ready'))
    m.db.execute('INSERT INTO yt_playlist_items VALUES(?,?,?,?)',(pid,'abcdefghijk','old-item','added'))
   m.db.commit();calls=[]
   async def request(method,resource,params,value=None):
    calls.append((method,resource,value))
    if method=='GET':return {'items':[]}
    return {'id':'month-p'if resource=='playlists'else'new-item',**value}
   m.request=request;r=row();r['playlist_status']='grouped';await m.group(r)
   self.assertEqual([x[1]for x in calls if x[0]=='POST'],['playlists','playlistItems'])
   self.assertEqual(len(r['playlists']),3);self.assertFalse(needs_grouping(r));m.db.close()
 async def test_month_and_platform_progress_survives_member_error(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp)
   async def ensure(key,title):
    if key.startswith('member:'):raise Failure('playlist_http_429')
    return key
   async def include(*args):pass
   m.ensure=ensure;m.include=include;r=row()
   with self.assertRaisesRegex(Failure,'429'):await m.group(r)
   self.assertEqual({p['key']for p in r['playlists']},{'month:2026-10','platform:showroom'})
   self.assertTrue(needs_grouping(r));self.assertEqual(len(m.u.store.saved),2);m.db.close()
 async def test_next_month_created_only_once_when_new_public_videos_arrive(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.remote=[];created=[]
   async def request(method,resource,params,value=None):
    if method=='GET':return {'items':[]}
    if resource=='playlists':
     created.append(value['snippet']['title']);return {'id':'p'+str(len(created)),**value}
    return {'id':'item-'+value['snippet']['resourceId']['videoId']}
   m.request=request
   for index,start in enumerate(('2026-10-01T00:00:00Z','2026-11-01T00:00:00Z','2026-11-15T00:00:00Z')):
    r=row();r.update(id=str(index),youtube_id='video'+str(index),started_at=start);await m.group(r)
   self.assertEqual(len(created),4)
   self.assertEqual(sum('November 2026' in title for title in created),1)
   self.assertEqual(m.db.execute("SELECT count(*) FROM yt_playlists WHERE key LIKE 'month:%'").fetchone()[0],2)
   self.assertEqual(m.db.execute('SELECT count(*) FROM yt_playlist_items').fetchone()[0],9);m.db.close()
 async def test_unlisted_video_cannot_create_or_join_a_public_playlist(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp)
   async def unexpected(*args,**kwargs):self.fail('unlisted video must not call YouTube')
   m.request=unexpected;r=row('idn');r['youtube_privacy']='unlisted';await m.group(r)
   self.assertEqual(m.db.execute('SELECT count(*) FROM yt_playlists').fetchone()[0],0)
   self.assertNotIn('playlists',r);m.db.close()
 async def test_429_backoff_shared_and_persisted_across_restart(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp)
   async def request(*args,**kwargs):
    return types.SimpleNamespace(status_code=429,headers={'Retry-After':'600'},json=lambda:{'error':{'errors':[{'reason':'rateLimitExceeded'}]}})
   m.u.youtube=types.SimpleNamespace(request=request)
   before=datetime.now(timezone.utc).timestamp()
   with self.assertRaisesRegex(Failure,'429'):await m.request('POST','playlists',{}, {})
   self.assertGreaterEqual(m.retry_at,before+600)
   again=PlaylistManager(m.u);self.assertEqual(again.retry_at,m.retry_at);m.db.close()
 async def test_existing_remote_membership_recovered_without_second_insert(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.db.execute("INSERT INTO yt_playlist_items VALUES('p','v',NULL,'uncertain')");m.db.commit()
   async def request(method,*args,**kwargs):self.assertEqual(method,'GET');return {'items':[{'id':'existing'}]}
   m.request=request;await m.include('p','v');self.assertEqual(m.db.execute('SELECT item_id,state FROM yt_playlist_items').fetchone(),('existing','added'));m.db.close()
 async def test_lost_create_response_does_not_create_another_playlist(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.remote=[];posts=[]
   async def request(method,resource,params,value=None):
    if method=='GET':return {'items':[]}
    posts.append(resource);raise ConnectionError('lost response')
   m.request=request
   with self.assertRaises(ConnectionError):await m.ensure('member:m','Erine JKT48')
   with self.assertRaisesRegex(Failure,'creation_uncertain'):await m.ensure('member:m','Erine JKT48')
   self.assertEqual(posts,['playlists']);m.db.close()
 async def test_definite_quota_rejection_can_retry_without_false_uncertainty(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);m.remote=[]
   async def request(*args,**kwargs):raise Failure('playlist_quota')
   m.request=request
   with self.assertRaises(Failure):await m.ensure('member:m','Erine JKT48')
   self.assertEqual(m.db.execute('SELECT state FROM yt_playlists').fetchone()[0],'retry');m.db.close()
 async def test_budget_deferred_without_affecting_video_privacy_or_upload_state(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);r=row();before=dict(r)
   for _ in range(60):m.spend()
   with self.assertRaisesRegex(Failure,'daily_budget'):m.spend()
   self.assertEqual(r,before);self.assertGreater(m.retry_at,datetime.now(timezone.utc).timestamp());m.db.close()
 async def test_new_playlist_propagation_retries_reads_not_mutations(self):
  with tempfile.TemporaryDirectory()as tmp:
   m=self.setup_manager(tmp);reads=[];posts=[];waits=[]
   async def wait(seconds):waits.append(seconds)
   m.u.wait=wait
   async def request(method,*args,**kw):
    if method=='GET':
     reads.append(1)
     if len(reads)<3:raise Failure('playlist_http_404')
     return {'items':[]}
    posts.append(1);return {'id':'item1'}
   m.request=request;await m.include('p','v');self.assertEqual(len(reads),3);self.assertEqual(len(posts),1);self.assertEqual(waits,[1,2]);m.db.close()
