import asyncio,contextlib,io,json,logging,os,tempfile,time,unittest,urllib.request
from archive import Archive
from parser import SourceError,parse_session_profile
from session_auth import load_cookies,CookieFileError,SessionReader

SECRET='synthetic_test_session_value'
def cookie_file(folder,expired=False):
 p=os.path.join(folder,'cookies.txt');expiry=int(time.time())+3600 if not expired else 1
 with open(p,'w')as f:f.write('# Netscape HTTP Cookie File\n#HttpOnly_.instagram.com\tTRUE\t/\tTRUE\t'+str(expiry)+'\tsessionid\t'+SECRET+'\n.evil.test\tTRUE\t/\tTRUE\t'+str(expiry)+'\tother\t'+SECRET+'\n')
 os.chmod(p,0o600);return p
class CookieFileTests(unittest.TestCase):
 def test_cookie_scopes_are_filtered_and_http_only_is_preserved(self):
  with tempfile.TemporaryDirectory()as d:
   jar,_=load_cookies(cookie_file(d));self.assertEqual(len(list(jar)),1)
   for host,expected in [('www.instagram.com',True),('api.jkt48connect.app',False),('cdninstagram.com',False),('instagram.com.evil.test',False)]:
    req=urllib.request.Request('https://'+host+'/');jar.add_cookie_header(req);self.assertEqual(bool(req.get_header('Cookie')),expected)
 def test_world_readable_symlink_and_expired_files_are_rejected_without_echoing_values(self):
  with tempfile.TemporaryDirectory()as d:
   p=cookie_file(d);os.chmod(p,0o644)
   with self.assertRaises(CookieFileError)as e:load_cookies(p)
   self.assertNotIn(SECRET,str(e.exception));os.chmod(p,0o600);link=os.path.join(d,'link');os.symlink(p,link)
   with self.assertRaises(CookieFileError):load_cookies(link)
   cookie_file(d,True)
   with self.assertRaises(CookieFileError):load_cookies(p)
 def test_malformed_file_never_logs_its_contents(self):
  with tempfile.TemporaryDirectory()as d:
   p=cookie_file(d)
   with open(p,'a')as f:f.write(SECRET+' malformed\n')
   stderr=io.StringIO()
   with contextlib.redirect_stderr(stderr),self.assertRaises(CookieFileError)as e:load_cookies(p)
   self.assertNotIn(SECRET,str(e.exception)+stderr.getvalue())

class Response:
 def __init__(self,status=200,headers=None,body='{}'):self.status_code=status;self.headers=headers or{};self.body=body
 async def __aenter__(self):return self
 async def __aexit__(self,*args):pass
 async def aiter_content(self):yield self.body.encode()
class Session:
 def __init__(self,response,calls,**kw):self.response=response;self.calls=calls
 def stream(self,method,url,**kw):self.calls.append((method,url,kw));return self.response
 async def close(self):pass
class SessionTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.file=cookie_file(self.temp.name);self.store=Archive(':memory:');self.calls=[];self.response=Response();self.reader=SessionReader(self.store,self.file,factory=lambda **kw:Session(self.response,self.calls,**kw))
 async def asyncTearDown(self):await self.reader.close();self.store.close();self.temp.cleanup()
 async def test_redirects_never_follow_and_checkpoint_disables_session_until_replacement(self):
  self.response.status_code=302;self.response.headers={'location':'https://www.instagram.com/challenge/test/'}
  with self.assertRaisesRegex(SourceError,'session_verification_required'):await self.reader.document('https://www.instagram.com/jkt48.levi/',lambda s:{})
  self.assertFalse(await self.reader.refresh());self.assertEqual(len(self.calls),1);self.assertFalse(self.calls[0][2]['allow_redirects'])
  restored=SessionReader(self.store,self.file,factory=lambda **kw:Session(Response(),self.calls,**kw));self.assertFalse(await restored.refresh());await restored.close()
  old=os.stat(self.file);os.utime(self.file,ns=(old.st_atime_ns,old.st_mtime_ns+1000000));self.assertTrue(await self.reader.refresh())
 async def test_expired_login_does_not_repeat_requests_and_public_status_has_no_cookie(self):
  self.response.status_code=401
  with self.assertRaisesRegex(SourceError,'session_login_required'):await self.reader.document('https://www.instagram.com/jkt48.levi/',lambda s:{})
  with self.assertRaisesRegex(SourceError,'session_unavailable'):await self.reader.document('https://www.instagram.com/jkt48.levi/',lambda s:{})
  self.assertEqual(len(self.calls),1);self.assertNotIn(SECRET,json.dumps(self.store.status()))
 async def test_rate_limit_survives_restart_and_honors_retry_after(self):
  self.response.status_code=429;self.response.headers={'retry-after':'600'}
  with self.assertRaises(SourceError)as e:await self.reader.document('https://www.instagram.com/jkt48.levi/',lambda s:{})
  self.assertEqual(e.exception.session_retry_after,600);restored=SessionReader(self.store,self.file,factory=lambda **kw:Session(Response(),self.calls,**kw));self.assertFalse(await restored.refresh());await restored.close();self.assertEqual(len(self.calls),1)
 async def test_session_rejects_non_instagram_and_non_profile_paths_before_loading(self):
  for url in ['https://api.jkt48connect.app/api/member','http://www.instagram.com/jkt48.levi/','https://www.instagram.com/direct/inbox/','https://www.instagram.com/accounts/','https://www.instagram.com/api/v1/users/web_profile_info/?username=valid&secret=bad']:
   with self.assertRaisesRegex(SourceError,'invalid_session_target'):await self.reader.document(url,lambda s:{})
  self.assertEqual(len(self.calls),0)

class CollectorSessionTests(unittest.IsolatedAsyncioTestCase):
 async def test_public_success_never_uses_cookie_session(self):
  from service import Collector
  store=Archive(':memory:')
  class Auth:
   async def refresh(self):raise AssertionError('must stay anonymous')
  c=Collector(store,session_reader=Auth())
  async def document(*args,**kw):return {'username':'member_jkt48','posts':[]}
  c.document=document;result=await c.profile(None,'member_jkt48');self.assertEqual(result['username'],'member_jkt48');store.close()
 async def test_session_rate_limit_never_becomes_a_global_anonymous_pause(self):
  from service import source_backoff
  self.assertEqual(source_backoff('session_rate_limited',100),0)
  self.assertGreater(source_backoff('http_429',1),0)

class ParserTests(unittest.TestCase):
 def payload(self,private=False):
  return {'data':{'viewer':{'token':SECRET},'user':{'id':'123','username':'jkt48.levi','is_private':private,'edge_owner_to_timeline_media':{'count':1,'edges':[{'node':{'id':'4017007570539687588','shortcode':'ExampleCode','__typename':'GraphImage','owner':{'id':'123','username':'jkt48.levi','is_private':private},'display_url':'https://scontent.cdninstagram.com/photo.jpg','taken_at_timestamp':1793080000}}]}}}}
 def test_only_public_requested_member_fields_are_returned(self):
  result=parse_session_profile(json.dumps(self.payload()),'jkt48.levi');self.assertEqual(len(result['posts']),1);self.assertNotIn(SECRET,json.dumps(result));self.assertEqual(result['posts'][0]['source'],'instagram-session-web-profile')
  for data,name in [(self.payload(True),'jkt48.levi'),(self.payload(),'other_account')]:
   with self.assertRaises(SourceError):parse_session_profile(json.dumps(data),name)

if __name__=='__main__':unittest.main()
