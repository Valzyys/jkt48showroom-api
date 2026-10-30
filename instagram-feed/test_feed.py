import concurrent.futures,json,os,tempfile,threading,unittest,urllib.request,urllib.error
from parser import parse_profile,parse_detail,media_url,SourceError
from archive import Archive,APIError
from service import http_server,Collector

HANDLE='member_jkt48';BASE=4015528258922619317
def code(ident):return 'CODE'+str(ident)[-8:]
def node(ident=BASE,**kw):return {'pk':str(ident),'code':code(ident),'user':{'username':HANDLE,'pk':'123'},'media_type':1,'display_uri':'https://scontent.cdninstagram.com/photo.jpg','caption':{'text':'Halo\n\nDunia & teman'},**kw}
def script(data):return '<script type="application/json" data-sjs>'+json.dumps(data)+'</script>'
def page(ids=(BASE,),**kw):
 user={'pk':'123','username':HANDLE,'full_name':'Member','is_private':False,'all_media_count':10,**kw};timeline={'pk':'123','polaris_ordered_timeline_connection':{'edges':[{'node':node(i)}for i in ids]}}
 return script({'data':{'xig_user_by_username':user}})+script({'require':[[{'data':{'xig_user_by_username':timeline}}]]})
def detail(ident=BASE,**kw):return script({'data':{'xig_polaris_media':{'code':code(ident),'pk':str(ident),'if_not_gated_logged_out':node(ident,taken_at=1792908292,**kw)}}})

class ParserTests(unittest.TestCase):
 def test_profile_scopes_timeline_sorts_deduplicates_and_excludes_other_authors(self):
  html=page((BASE,BASE+1,BASE,BASE-10));p=parse_profile(html,HANDLE);self.assertEqual([v['id']for v in p['posts']],[str(BASE+1),str(BASE),str(BASE-10)]);self.assertEqual(p['posts'][0]['text'],'Halo\n\nDunia & teman');self.assertIsNone(p['posts'][0]['created_at']);self.assertIsNone(p['posts'][0]['metrics']['likes']);self.assertFalse(p['history_complete'])
  other=node(BASE+2,user={'username':'another','pk':'456'});extra=script({'data':{'xig_user_by_username':{'pk':'123','polaris_ordered_timeline_connection':{'edges':[{'node':other}]}}}});p=parse_profile(html+extra,HANDLE);self.assertEqual(p['excluded_other_authors'],1);self.assertEqual(len(p['posts']),3)
 def test_private_login_wall_wrong_profile_and_missing_timeline_are_errors(self):
  for html in ['<html>Log in to continue</html>',page(is_private=True),page(username='other'),script({'data':{'xig_user_by_username':{'pk':'123','username':HANDLE}}})]:
   with self.assertRaises(SourceError):parse_profile(html,HANDLE)
 def test_post_detail_has_real_time_gallery_order_video_and_metrics(self):
  children=[node(BASE-1),node(BASE-2,media_type=2,video_versions=[{'url':'https://video.fbcdn.net/a.mp4','width':720,'height':1280}])];d=parse_detail(detail(media_type=8,carousel_media=children,like_count=54,comment_count=7),HANDLE,str(BASE),code(BASE));self.assertEqual(d['created_at'],'2026-10-25T06:04:52Z');self.assertEqual(d['media']['type'],'carousel');self.assertEqual(len(d['media']['items']),2);self.assertEqual(d['media']['items'][1]['play_url'],'https://video.fbcdn.net/a.mp4');self.assertEqual(d['metrics']['likes'],54);self.assertEqual(d['metrics']['comments'],7)
 def test_gated_detail_and_mismatched_owner_are_never_success(self):
  for html in [script({'xig_polaris_media':{'code':code(BASE),'if_not_gated_logged_out':None}}),detail(user={'username':'other','pk':'456'})]:
   with self.assertRaises(SourceError):parse_detail(html,HANDLE,str(BASE),code(BASE))
  with self.assertRaises(SourceError):parse_detail(detail(),HANDLE,str(BASE+1),code(BASE))
 def test_hidden_metrics_are_null_and_raw_urls_are_allowlisted(self):
  d=parse_detail(detail(like_count=-1,like_and_view_counts_disabled=True,play_count=900),HANDLE,str(BASE),code(BASE));self.assertIsNone(d['metrics']['likes']);self.assertIsNone(d['metrics']['views']);self.assertTrue(d['metrics']['counts_hidden'])
  for u in ['https://127.0.0.1/a.jpg','https://fbcdn.net.evil.test/a.jpg','http://scontent.cdninstagram.com/a.jpg','https://u@video.fbcdn.net/a.mp4','https://video.fbcdn.net:44/a.mp4']:self.assertIsNone(media_url(u))
  self.assertIsNotNone(media_url('https://scontent.cdninstagram.com/a.jpg'))

class ArchiveTests(unittest.TestCase):
 def setUp(self):
  self.s=Archive(':memory:');self.s.directory([{'member':'member-jkt48','name':'Member JKT48','username':HANDLE},{'member':'not-published','name':'Other','username':None}]);self.s.save(parse_profile(page((BASE,BASE-1)),HANDLE))
 def tearDown(self):self.s.close()
 def test_baseline_updates_duplicate_pins_and_cursor_restart(self):
  self.assertEqual(self.s.counts()['updates'],0);self.s.save(parse_profile(page((BASE+2,BASE-100,BASE+1)),HANDLE));events=self.s.read('/updates',{'limit':'1'});self.assertTrue(events['has_more']);self.assertEqual(events['latest_cursor'],'2');self.s.save(parse_profile(page((BASE,BASE+2)),HANDLE));self.assertEqual(self.s.counts()['updates'],2);self.assertEqual(self.s.read('/updates',{'after':'2'})['updates'],[])
  with tempfile.TemporaryDirectory()as folder:
   f=os.path.join(folder,'db.sqlite');s=Archive(f);s.save(parse_profile(page(),HANDLE));s.close();s=Archive(f);r=s.save(parse_profile(page((BASE+1,BASE)),HANDLE));self.assertFalse(r['baseline']);self.assertEqual(r['new_posts'],[str(BASE+1)]);s.close()
 def test_pagination_member_search_profile_and_shortcode_detail(self):
  first=self.s.read('/posts',{'limit':'1'});self.assertEqual(first['next_cursor'],str(BASE));second=self.s.read('/posts',{'before':first['next_cursor']});self.assertEqual(second['posts'][0]['id'],str(BASE-1));self.assertFalse(second['has_more']);self.assertEqual(self.s.read('/post/'+code(BASE),{})['post']['id'],str(BASE));self.assertEqual(self.s.read('/profile/member-jkt48',{})['profile']['username'],HANDLE);self.assertEqual(len(self.s.read('/search',{'q':'Dunia & teman','member':HANDLE})['posts']),2);self.assertEqual(self.s.read('/posts',{'member':'not-published'})['posts'],[])
 def test_enrichment_survives_profile_refresh_and_no_cdn_urls_escape(self):
  d=parse_detail(detail(media_type=8,carousel_media=[node(BASE-10),node(BASE-11,media_type=2,video_versions=[{'url':'https://video.fbcdn.net/a.mp4'}])],like_count=7),HANDLE,str(BASE),code(BASE));self.s.enrich(HANDLE,d);self.s.save(parse_profile(page(),HANDLE));p=self.s.read('/post/'+str(BASE),{})['post'];self.assertEqual(p['media']['type'],'carousel');self.assertEqual(len(p['media']['items']),2);self.assertEqual(p['metrics']['likes'],7);self.assertEqual(p['created_at'],d['created_at']);self.assertEqual(p['media']['detail_status'],'ready');self.assertNotIn('cdninstagram',json.dumps(p));self.assertNotIn('fbcdn',json.dumps(p));self.assertEqual(self.s.counts()['updates'],0)
  hidden=parse_profile(page(),HANDLE);hidden['posts'][0]['metrics']['counts_hidden']=True;self.s.save(hidden);p=self.s.read('/post/'+str(BASE),{})['post'];self.assertIsNone(p['metrics']['likes']);self.assertTrue(p['metrics']['counts_hidden'])
 def test_failures_preserve_last_data_and_validation_is_atomic(self):
  self.s.failure(HANDLE,'login_required');self.assertEqual(len(self.s.read('/posts',{})['posts']),2);self.assertEqual(self.s.members()['members'][0]['last_error'],'login_required');self.assertIsNotNone(self.s.members()['members'][0]['last_success_at'])
  with self.assertRaises(ValueError):self.s.directory([{'member':'../secret','username':HANDLE}])
  self.assertEqual(self.s.members()['total_count'],2)
 def test_shared_collaboration_does_not_block_other_posts_or_change_archived_owner(self):
  other='other_member';first=parse_profile(page(),HANDLE);first['username']=other
  first['profile']['username']=other;first['posts'][0]['author']['username']=other
  s=Archive(':memory:');s.save(first)
  current=parse_profile(page((BASE+1,BASE)),HANDLE);r=s.save(current)
  self.assertEqual(r['excluded_existing_owners'],1);self.assertEqual(len(current['posts']),2)
  self.assertEqual(s.db.execute('SELECT username FROM posts WHERE id=?',(str(BASE),)).fetchone()[0],other)
  self.assertEqual(s.db.execute('SELECT username FROM posts WHERE id=?',(str(BASE+1),)).fetchone()[0],HANDLE)
  later=parse_profile(page((BASE+2,BASE)),HANDLE);r=s.save(later)
  self.assertEqual(r['new_posts'],[str(BASE+2)]);self.assertEqual(s.counts()['updates'],1)
  row=s.db.execute('SELECT document FROM profile_data WHERE username=?',(HANDLE,)).fetchone()
  self.assertEqual(json.loads(row[0])['excluded_other_authors'],1)
  s.close()
 def test_invalid_pagination_member_and_read_route_are_errors(self):
  for q in [{'limit':'0'},{'limit':'101'},{'before':'NaN'},{'member':'unknown'}]:
   with self.assertRaises(APIError):self.s.read('/posts',q)
  with self.assertRaises(APIError):self.s.read('/updates',{'after':'9223372036854775808'})
  with self.assertRaises(APIError):self.s.read('/unknown',{})
 def test_r2_status_and_source_budgets_survive_refresh(self):
  self.s.db.execute("INSERT INTO assets(post_id,kind,state,url)VALUES(?,?,'ready',?)",(str(BASE),'thumbnail','https://api.jkt48connect.app/media/instagram/member-jkt48/'+str(BASE)+'/thumbnail'));self.s.db.commit();self.s.save(parse_profile(page(),HANDLE));self.assertEqual(self.s.read('/post/'+str(BASE),{})['post']['media']['thumbnail']['status'],'ready');self.s.meta('next_request',1234);self.assertEqual(Collector(self.s).next_request,1234)
 def test_carousel_video_sources_survive_incomplete_profile_and_detail_refresh(self):
  d=parse_detail(detail(media_type=8,carousel_media=[node(BASE-10),node(BASE-11,media_type=2,video_versions=[{'url':'https://video.fbcdn.net/clip.mp4'}])]),HANDLE,str(BASE),code(BASE))
  self.s.enrich(HANDLE,d);refresh=parse_profile(page(),HANDLE)
  refresh['posts'][0]['media']=json.loads(json.dumps(d['media']));refresh['posts'][0]['media']['items'][1]['play_url']=None
  self.s.save(refresh);self.s.enrich(HANDLE,{**d,'media':refresh['posts'][0]['media']})
  saved=json.loads(self.s.db.execute('SELECT document FROM posts WHERE id=?',(str(BASE),)).fetchone()[0])
  self.assertEqual(saved['media']['items'][1]['play_url'],'https://video.fbcdn.net/clip.mp4')
  refresh['posts'][0]['media']['items'][1]['id']=str(BASE-99);self.s.save(refresh)
  saved=json.loads(self.s.db.execute('SELECT document FROM posts WHERE id=?',(str(BASE),)).fetchone()[0])
  self.assertIsNone(saved['media']['items'][1]['play_url'])
 def test_already_uploaded_carousel_video_remains_public_without_original_source_url(self):
  d=parse_detail(detail(media_type=8,carousel_media=[node(BASE-11,media_type=2)]),HANDLE,str(BASE),code(BASE));self.s.enrich(HANDLE,d)
  url='https://api.jkt48connect.app/media/instagram/member-jkt48/'+str(BASE)+'/video-0'
  with self.s.db:self.s.db.execute("INSERT INTO assets(post_id,kind,state,url)VALUES(?,'video-0','ready',?)",(str(BASE),url))
  video=self.s.read('/post/'+str(BASE),{})['post']['media']['items'][0]['video']
  self.assertEqual(video['status'],'ready');self.assertEqual(video['url'],url)
  fresh=parse_profile(page((BASE+1,),all_media_count=1),HANDLE);fresh['posts'][0]['media']['type']='video';self.s.save(fresh)
  self.assertEqual(self.s.read('/post/'+str(BASE+1),{})['post']['media']['video']['status'],'pending')
 def test_http_auth_and_concurrent_read_only_requests(self):
  server=http_server(self.s,'x'*40,0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
  try:
   with self.assertRaises(urllib.error.HTTPError)as error:urllib.request.urlopen(base+'/posts')
   self.assertEqual(error.exception.code,401)
   def read(_):
    request=urllib.request.Request(base+'/posts?limit=1',headers={'Authorization':'Bearer '+'x'*40})
    with urllib.request.urlopen(request,timeout=5)as response:return json.load(response)
   with concurrent.futures.ThreadPoolExecutor(max_workers=8)as pool:responses=list(pool.map(read,range(20)))
   self.assertTrue(all(len(r['posts'])==1 for r in responses));self.assertEqual(self.s.counts()['updates'],0)
  finally:server.shutdown();server.server_close();thread.join()



class PublicEmbedTests(unittest.TestCase):
 def embed(self,username=HANDLE,owner='123',media_owner='123',private=False):
  n={'id':str(BASE+99),'shortcode':code(BASE+99),'__typename':'GraphSidecar','owner':{'id':media_owner,'username':username,'is_private':private},'taken_at_timestamp':1793080000,'display_url':'https://scontent.cdninstagram.com/cover.jpg','edge_media_to_caption':{'edges':[{'node':{'text':'New\n\nPublic post'}}]},'edge_sidecar_to_children':{'edges':[{'node':{'id':str(BASE+100),'is_video':True,'video_url':'https://video.fbcdn.net/a.mp4','display_url':'https://scontent.cdninstagram.com/a.jpg'}}]}}
  ctx={'context':{'username':username,'owner_id':owner,'posts_count':1,'graphql_media':[{'shortcode_media':n}]}}
  return '<script>require("PublicEmbed", {"contextJSON":'+json.dumps(json.dumps(ctx))+'});</script>'
 def test_official_embed_json_is_read_without_evaluating_scripts(self):
  from parser import parse_profile_embed
  p=parse_profile_embed(self.embed(),HANDLE);self.assertEqual(p['posts'][0]['id'],str(BASE+99));self.assertEqual(p['posts'][0]['text'],'New\n\nPublic post');self.assertEqual(p['posts'][0]['media']['type'],'carousel');self.assertEqual(p['posts'][0]['media']['items'][0]['type'],'video');self.assertEqual(p['posts'][0]['source'],'instagram-public-profile-embed')
 def test_missing_disabled_private_or_other_owner_is_not_an_empty_success(self):
  from parser import parse_profile_embed
  for doc in ['<script>{"contextJSON":null}</script>',self.embed(username='other'),self.embed(media_owner='other'),self.embed(private=True)]:
   with self.assertRaises(SourceError):parse_profile_embed(doc,HANDLE)
 def test_embed_posts_commit_as_real_updates_with_existing_baseline(self):
  from parser import parse_profile_embed
  s=Archive(':memory:');s.directory([{'member':'member','username':HANDLE}]);s.save(parse_profile(page(),HANDLE));r=s.save(parse_profile_embed(self.embed(),HANDLE));self.assertEqual(r['new_posts'],[str(BASE+99)]);self.assertEqual(s.counts()['updates'],1);s.save(parse_profile_embed(self.embed(),HANDLE));self.assertEqual(s.counts()['updates'],1);s.close()

class SchedulerTests(unittest.TestCase):
 def test_account_errors_do_not_pause_other_accounts_but_source_limits_do(self):
  from service import source_backoff
  for code in ['login_required','profile_embed_not_exposed','private_account','profile_identity_missing','post_detail_not_exposed']:
   self.assertEqual(source_backoff(code,20),0)
  self.assertGreater(source_backoff('http_429',1),0);self.assertLessEqual(source_backoff('http_429',20),1800);self.assertLessEqual(source_backoff('http_503',20),300)
 def test_legacy_login_pause_is_released_and_real_rate_limits_survive_restart(self):
  for code,expected in [('login_required',0),('http_429',9999999999)]:
   s=Archive(':memory:');s.meta('error',code);s.meta('cooldown',9999999999);Collector(s);self.assertEqual(s.meta('cooldown'),expected);s.close()

if __name__=='__main__':unittest.main()
