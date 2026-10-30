import importlib.util,pathlib,unittest,tempfile,json,time
from unittest.mock import patch
import parser as public_parser
from store import Store
from service import member_directory

def node(ident='2112512811519951001',handle='Member_JKT48'):
 return {'__typename':'Tweet','rest_id':ident,'core':{'user_results':{'result':{'rest_id':'12','core':{'screen_name':handle,'name':'Member'},'privacy':{'protected':False}}}},'details':{'full_text':'Hello https://t.co/test','created_at_ms':1792440000000},'legacy':{'lang':'id'},'url_entities':[{'url':'https://t.co/test','expanded_url':'https://example.com/post'}],'counts':{'favorite_count':17}}
def page(nodes):
 payload={'data':{'entries':[{'social_context':{'context_type':'Pin'} if i==0 else {},'tweet_results':{'result':item}} for i,item in enumerate(nodes)]}}
 return '<html><script>send({data:'+json.dumps(json.dumps(payload))+'});</script></html>'
class Tests(unittest.TestCase):
 def test_public_html_data_is_parsed_without_executing_javascript(self):
  result=public_parser.parse_profile(page([node(),node('2112512811519951002','Other')]),'Member_JKT48')
  self.assertEqual(len(result),1);self.assertEqual(result[0]['author']['username'],'Member_JKT48');self.assertEqual(result[0]['metrics']['likes'],17);self.assertTrue(result[0]['is_pinned']);self.assertIn('https://example.com/post',result[0]['text'])
 def test_empty_or_login_pages_are_not_successful_empty_timelines(self):
  for html in ['<html>Login</html>',page([node(handle='Other')])]:
   with self.assertRaises(public_parser.PublicSourceError):public_parser.parse_profile(html,'Member_JKT48')
  private=node();private['core']['user_results']['result']['privacy']['protected']=True
  with self.assertRaises(public_parser.PublicSourceError):public_parser.parse_profile(page([private]),'Member_JKT48')
 def test_member_directory_uses_only_public_profile_handles(self):
  data=[{'url':'member','name':'Member','socials':[{'url':'https://x.com/Member_JKT48'}]},{'url':'bad','socials':[{'url':'https://evil.test/member'}]},{'url':'graduate','is_graduate':True,'socials':[{'url':'https://x.com/Graduate'}]}]
  self.assertEqual([m['username'] for m in member_directory(data)],['Member_JKT48'])
 def test_official_username_discovery_is_preserved_on_metadata_refresh(self):
  items=member_directory([{'url':'member','name':'Member','_official_id':42,'nicknames':['Nick']}])
  self.assertEqual(len(items),1);self.assertIsNone(items[0]['username'])
  with tempfile.TemporaryDirectory() as d:
   store=Store(pathlib.Path(d)/'feed.db');store.sync_members(items);row=store.set_handle('member','Member_JKT48');self.assertEqual(row['handle'],'Member_JKT48')
   store.sync_members(items);self.assertEqual(store.resolve('Member_JKT48')['username'],'Member_JKT48')
 def test_baseline_new_event_cursor_dedup_search_and_cached_failure(self):
  with tempfile.TemporaryDirectory() as d:
   store=Store(pathlib.Path(d)/'feed.db');store.sync_members([{'id':'member','name':'Member','nicknames':['Nick'],'username':'Member_JKT48'}]);member=store.due()
   first=public_parser.normalize(node(),member['handle']);self.assertEqual(store.save_tweets(member,[first],300),[]);self.assertEqual(store.updates(0)['updates'],[])
   with store.connect() as db:member=db.execute('SELECT * FROM members').fetchone()
   second=public_parser.normalize(node('2112512811519951002'),member['handle']);self.assertEqual(store.save_tweets(member,[second,first],300),[second['id']]);self.assertEqual(len(store.updates(0)['updates']),1)
   store.save_tweets(member,[second,first],300);self.assertEqual(len(store.updates(0)['updates']),1);self.assertEqual(len(store.tweets(query='Hello')['tweets']),2);self.assertEqual(store.resolve('Nick')['id'],'member')
   store.failure(member,'Public X rate limit (429)',900);self.assertEqual(len(store.tweets()['tweets']),2);self.assertEqual(store.status()['failed_members'],1)
   after=store.updates(0)['next_cursor'];self.assertEqual(store.updates(int(after))['updates'],[])
   with store.connect() as db:db.execute('DELETE FROM tweets')
   self.assertEqual(len(store.updates(0)['updates']),1)
   store.meta('error','test');store.meta('error',None);self.assertIsNone(store.meta('error'))
if __name__=='__main__':unittest.main()
