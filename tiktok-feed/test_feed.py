import json,os,tempfile,unittest
from parser import parse_embed,SourceError,media_url
from store import Store

HANDLE='member_jkt48';BASE=7700950967130492180

def page(ids=(BASE,),**kw):
 user={'uniqueId':HANDLE,'id':'123','nickname':'Member','privateAccount':False,**kw}
 data={'userInfo':user,'videoList':[{'id':str(i),'authorUniqueId':HANDLE,'desc':'Halo\n\nDunia &amp; teman','coverUrl':'https://p16-common-sign.tiktokcdn.com/image.jpg','playAddr':'https://v16m.tiktokcdn.com/video.mp4','playCount':'1.2M'}for i in ids]}
 return '<script type="application/json" id="__FRONTITY_CONNECT_STATE__">'+json.dumps({'source':{'data':{'/embed/@'+HANDLE:data}}})+'</script>'
class FeedTest(unittest.TestCase):
 def test_parse_sort_and_accuracy(self):
  r=parse_embed(page((BASE,BASE+2,BASE+1,BASE)),HANDLE);self.assertEqual([p['id']for p in r['posts']],[str(BASE+2),str(BASE+1),str(BASE)]);p=r['posts'][0];self.assertEqual(p['text'],'Halo\n\nDunia & teman');self.assertIsNone(p['created_at']);self.assertIsNone(p['metrics']['views']);self.assertEqual(p['metrics']['views_display'],'1.2M');self.assertIsNone(p['media']['images']);self.assertFalse(r['history_complete'])
 def test_blocked_empty_html_private_and_author_mismatch(self):
  for doc in ['overload-protect triggered','<html>captcha</html>',page(privateAccount=True),page(uniqueId='other')]:
   with self.assertRaises(SourceError):parse_embed(doc,HANDLE)
 def test_media_hosts(self):
  self.assertIsNotNone(media_url('https://v16m.tiktokcdn.com/x.mp4'))
  for value in ['http://v16m.tiktokcdn.com/x.mp4','https://127.0.0.1/x','https://v16m.tiktokcdn.com.evil.test/x','https://user@v16m.tiktokcdn.com/x','https://v16m.tiktokcdn.com:80/x']:self.assertIsNone(media_url(value))
 def test_persistent_baseline_duplicate_pin_and_restart(self):
  with tempfile.TemporaryDirectory()as d:
   f=os.path.join(d,'probe.sqlite');s=Store(f);self.assertTrue(s.save(parse_embed(page(),HANDLE))['baseline']);self.assertEqual(s.counts()['updates'],0);s.close();s=Store(f)
   self.assertEqual(s.save(parse_embed(page((BASE,BASE-100,BASE+1)),HANDLE))['new_posts'],[str(BASE+1)]);self.assertEqual(s.counts()['updates'],1);self.assertEqual(s.save(parse_embed(page((BASE+1,BASE)),HANDLE))['new_posts'],[]);s.close()
 def test_errors_preserve_success_and_do_not_become_baseline(self):
  s=Store(':memory:');s.failure(HANDLE,'http_503');self.assertTrue(s.save(parse_embed(page(),HANDLE))['baseline']);s.failure(HANDLE,'http_503');self.assertEqual(s.counts()['posts'],1);r=s.db.execute('SELECT * FROM profiles').fetchone();self.assertIsNotNone(r['success']);self.assertEqual(r['error'],'http_503');self.assertFalse(s.save(parse_embed(page(),HANDLE))['baseline']);s.close()

class MoreAccuracyTests(unittest.TestCase):
 def test_missing_route_and_malformed_json_are_errors(self):
  for doc in ['<script id="__FRONTITY_CONNECT_STATE__">oops</script>','<script id="__FRONTITY_CONNECT_STATE__">{}</script>']:
   with self.assertRaises(SourceError):parse_embed(doc,HANDLE)
 def test_old_snapshot_does_not_lower_watermark(self):
  s=Store(':memory:');s.save(parse_embed(page((BASE+10,)),HANDLE));s.save(parse_embed(page((BASE,)),HANDLE));self.assertEqual(s.db.execute('SELECT watermark FROM profiles').fetchone()[0],str(BASE+10));self.assertEqual(s.counts()['updates'],0);s.close()
 def test_separate_accounts_cannot_reassign_same_post_id(self):
  s=Store(':memory:');r=parse_embed(page(),HANDLE);s.save(r);r['username']='other'
  with self.assertRaises(ValueError):s.save(r)
  self.assertEqual(s.db.execute('SELECT username FROM posts').fetchone()[0],HANDLE);s.close()

class DetailTests(unittest.TestCase):
 def test_detail_has_exact_time_and_ordered_safe_gallery(self):
  from parser import parse_detail
  infos={'id':str(BASE),'createTime':1793016000,'covers':['https://p16.tiktokcdn.com/cover.jpg'],'video':{'urls':['https://v16.tiktokcdn.com/video.mp4'],'videoMeta':{'duration':5}}}
  node={'itemInfos':infos,'authorInfos':{'uniqueId':HANDLE},'imagePostInfo':{'displayImages':[{'urlList':['https://p16.tiktokcdn.com/1.webp']},{'urlList':['https://127.0.0.1/private']},{'urlList':['https://p16.tiktokcdn.com/2.webp']}]}}
  def make():return '<script id="__FRONTITY_CONNECT_STATE__">'+json.dumps({'source':{'data':{'/embed/v2/'+str(BASE):{'videoData':node}}}})+'</script>'
  d=parse_detail(make(),HANDLE,str(BASE));self.assertEqual(d['created_at'],'2026-10-26T12:00:00Z');self.assertEqual(d['media']['reported_duration_seconds'],5);self.assertEqual(d['media']['type'],'photo');self.assertEqual(len(d['media']['images']),2);self.assertTrue(d['media']['images'][1].endswith('2.webp'));node['authorInfos']['uniqueId']='other'
  with self.assertRaises(SourceError):parse_detail(make(),HANDLE,str(BASE))

class EnrichmentTests(unittest.TestCase):
 def test_real_detail_survives_profile_refresh_without_new_event(self):
  s=Store(':memory:');r=parse_embed(page(),HANDLE);s.save(r);detail={'id':str(BASE),'author_username':HANDLE,'created_at':'2026-10-26T12:00:00Z','created_at_source':'tiktok-public-post-embed','media':{'type':'photo','images':['https://p16.tiktokcdn.com/1.jpg'],'images_status':'ready'}};s.enrich(HANDLE,detail);s.save(r);doc=json.loads(s.db.execute('SELECT document FROM posts').fetchone()[0]);self.assertEqual(doc['created_at'],detail['created_at']);self.assertEqual(doc['media']['type'],'photo');self.assertEqual(len(doc['media']['images']),1);self.assertEqual(s.counts()['updates'],0)
  with self.assertRaises(ValueError):s.enrich('other',detail)
  s.close()



class SchedulerTests(unittest.TestCase):
 def test_account_parser_errors_do_not_globally_pause_healthy_creators(self):
  from service import source_backoff
  for code in ['embed_state_missing','post_detail_missing','private_account','browser_source_unavailable']:
   self.assertEqual(source_backoff(code,20),0)
  self.assertGreater(source_backoff('http_429',1),0);self.assertLessEqual(source_backoff('http_429',20),1800);self.assertLessEqual(source_backoff('http_503',20),300)
 def test_legacy_parser_pause_is_released_without_discarding_a_real_rate_limit(self):
  from archive import Archive
  from service import Collector
  for code,expected in [('embed_state_missing',0),('http_429',9999999999)]:
   s=Archive(':memory:');s.meta('error',code);s.meta('cooldown',9999999999);Collector(s);self.assertEqual(s.meta('cooldown'),expected);s.close()

if __name__=='__main__':unittest.main()
