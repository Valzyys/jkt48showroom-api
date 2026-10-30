import concurrent.futures,json,tempfile,threading,unittest,urllib.request,urllib.error
from archive import Archive,APIError
from parser import parse_embed
from test_feed import page,HANDLE,BASE
from service import http_server,Collector

class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.s=Archive(':memory:');self.s.directory([{'member':'member-jkt48','name':'Member JKT48','username':HANDLE},{'member':'not-published','name':'Other','username':None}]);self.s.save(parse_embed(page((BASE,BASE-1)),HANDLE))
 def tearDown(self):self.s.close()
 def test_pagination_member_lookup_and_no_source_url_leak(self):
  first=self.s.read('/posts',{'limit':'1','member':HANDLE});self.assertTrue(first['has_more']);self.assertEqual(first['next_cursor'],str(BASE));self.assertEqual(first['posts'][0]['media']['thumbnail']['status'],'pending');self.assertNotIn('tiktokcdn',json.dumps(first));self.assertEqual(len(self.s.read('/posts',{'member':'not-published'})['posts']),0)
  second=self.s.read('/posts',{'before':first['next_cursor'],'limit':'1'});self.assertFalse(second['has_more']);self.assertEqual(second['posts'][0]['id'],str(BASE-1))
  self.assertEqual(len(self.s.read('/search',{'q':'Dunia & teman'})['posts']),2)
 def test_updates_join_current_enriched_post_and_restart(self):
  self.s.save(parse_embed(page((BASE+2,BASE+1,BASE)),HANDLE));first=self.s.read('/updates',{'after':'0','limit':'1'});self.assertTrue(first['has_more']);self.assertEqual(first['latest_cursor'],'2');p=first['updates'][0]['post'];self.s.enrich(HANDLE,{'id':p['id'],'author_username':HANDLE,'created_at':'2026-10-26T12:00:00Z','media':{}})
  updated=self.s.read('/updates',{'after':'0','limit':'1'});self.assertEqual(updated['updates'][0]['post']['created_at'],'2026-10-26T12:00:00Z');self.assertEqual(len(self.s.read('/updates',{'after':'2'})['updates']),0)
 def test_ready_r2_urls_survive_source_refresh(self):
  self.s.db.execute("INSERT INTO assets(post_id,kind,state,url,bytes)VALUES(?,?,'ready',?,3)",(str(BASE),'thumbnail','https://api.jkt48connect.app/media/tiktok/member-jkt48/'+str(BASE)+'/thumbnail'));self.s.db.commit();self.s.save(parse_embed(page(),HANDLE));self.assertEqual(self.s.read('/post/'+str(BASE),{})['post']['media']['thumbnail']['status'],'ready');self.assertNotIn('tiktokcdn',json.dumps(self.s.read('/post/'+str(BASE),{})))
 def test_incomplete_detail_does_not_downgrade_known_media(self):
  self.s.enrich(HANDLE,{'id':str(BASE),'author_username':HANDLE,'media':{'type':'post','play_url':None,'images':None}})
  self.assertEqual(self.s.read('/post/'+str(BASE),{})['post']['media']['type'],'video')
  self.s.enrich(HANDLE,{'id':str(BASE),'author_username':HANDLE,'media':{'type':'photo','images':['https://p16.tiktokcdn.com/1.jpg'],'images_status':'ready'}})
  self.s.enrich(HANDLE,{'id':str(BASE),'author_username':HANDLE,'media':{'type':'post','images':None,'images_status':'not_present'}})
  self.assertEqual(self.s.read('/post/'+str(BASE),{})['post']['media']['images_status'],'ready')
 def test_source_failure_keeps_data_and_directory_validation_is_atomic(self):
  self.s.failure(HANDLE,'http_503');self.assertEqual(len(self.s.read('/posts',{})['posts']),2);self.assertEqual(self.s.members()['members'][0]['last_error'],'http_503')
  with self.assertRaises(ValueError):self.s.directory([{'member':'../secret','username':HANDLE}])
  self.assertEqual(self.s.members()['total_count'],2)
 def test_invalid_filters_and_unknown_member_are_errors(self):
  for query in [{'limit':'0'},{'limit':'101'},{'before':'abc'},{'limit':'1e2'}]:
   with self.assertRaises(APIError):self.s.read('/posts',query)
  for query in [{'after':'-1'},{'after':'9223372036854775808'}]:
   with self.assertRaises(APIError):self.s.read('/updates',query)
  with self.assertRaises(APIError):self.s.read('/posts',{'member':'unknown'})
 def test_restart_keeps_source_and_browser_request_budgets(self):
  import time
  next_request=time.time()+25;browser_after=time.time()+300;self.s.meta('next_request',next_request);self.s.meta('browser_after',browser_after);collector=Collector(self.s);self.assertEqual(collector.next_request,next_request);self.assertEqual(collector.browser_after,browser_after)
 def test_http_auth_concurrency_and_reads_never_create_source_requests(self):
  server=http_server(self.s,'x'*40,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
  try:
   with self.assertRaises(urllib.error.HTTPError)as error:urllib.request.urlopen(base+'/status')
   self.assertEqual(error.exception.code,401)
   def read(i):
    request=urllib.request.Request(base+'/posts?limit=1',headers={'Authorization':'Bearer '+'x'*40})
    with urllib.request.urlopen(request,timeout=5)as response:return json.load(response)
   with concurrent.futures.ThreadPoolExecutor(max_workers=8)as pool:results=list(pool.map(read,range(24)))
   self.assertTrue(all(len(r['posts'])==1 for r in results));self.assertEqual(self.s.counts()['updates'],0);self.assertEqual(self.s.counts()['posts'],2)
  finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
