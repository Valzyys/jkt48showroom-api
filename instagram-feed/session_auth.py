"""Optional Instagram-only cookie session. Never persist or log session contents."""
import http.cookiejar,json,logging,os,re,stat,time
from urllib.parse import urlsplit,parse_qs
from parser import SourceError

LOG=logging.getLogger('instagram-feed')
class CookieFileError(Exception):pass

def load_cookies(file,now=None):
 now=time.time()if now is None else now
 try:
  fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
  with os.fdopen(fd,'r',encoding='utf-8')as stream:
   info=os.fstat(stream.fileno())
   if not stat.S_ISREG(info.st_mode)or info.st_mode&0o077 or info.st_uid not in(0,os.geteuid()):raise CookieFileError('cookie_file_permissions')
   raw=stream.read(262145)
   if len(raw)>262144:raise CookieFileError('cookie_file_invalid')
  if not raw.lstrip('\ufeff').startswith('# Netscape HTTP Cookie File'):raise CookieFileError('cookie_file_invalid')
  jar=http.cookiejar.CookieJar()
  for line in raw.splitlines():
   http_only=line.startswith('#HttpOnly_')
   if http_only:line=line[len('#HttpOnly_'):]
   elif not line or line.startswith('#'):continue
   fields=line.split('\t')
   if len(fields)!=7:raise CookieFileError('cookie_file_invalid')
   domain,flag,cookie_path,secure,expiry,name,value=fields
   if flag not in('TRUE','FALSE')or secure not in('TRUE','FALSE'):raise CookieFileError('cookie_file_invalid')
   if domain.lstrip('.').lower()not in('instagram.com','www.instagram.com')or cookie_path!='/':continue
   if not re.fullmatch(r'[A-Za-z0-9_]{1,100}',name)or len(value)>16384:raise CookieFileError('cookie_file_invalid')
   expires=int(expiry)if expiry and expiry!='0'else None
   if expires and expires<=now:continue
   if secure!='TRUE':continue
   jar.set_cookie(http.cookiejar.Cookie(0,name,value,None,False,domain,flag=='TRUE',domain.startswith('.'),cookie_path,True,True,expires,expires is None,None,None,{'HttpOnly':None}if http_only else{},False))
  if not any(c.name=='sessionid'and c.value for c in jar):raise CookieFileError('cookie_session_expired_or_missing')
  return jar,(info.st_ino,info.st_mtime_ns,info.st_size,stat.S_IMODE(info.st_mode),info.st_uid)
 except CookieFileError:raise
 except Exception:raise CookieFileError('cookie_file_invalid')from None

class SessionReader:
 def __init__(self,store,file=None,factory=None,now=time.time):
  self.store=store;self.file=file;self.factory=factory;self.now=now;self.session=None;self.fingerprint=None
  previous=store.meta('session_auth')or{};self.previous=previous;self.previous_version=store.meta('session_file_version')
  self.blocked=previous.get('state')in('login_required','verification_required');self.retry_at=previous.get('retry_at')or 0;self.state=(previous.get('state')or'configured')if file else'not_configured'
  self.record(self.state)
 def record(self,state):
  changed=state!=self.state;self.state=state
  with self.store.lock:self.store.meta('session_auth',{'configured':bool(self.file),'state':state,'checked_at':self.now(),'retry_at':self.retry_at or None})
  if changed:LOG.info('instagram-session state=%s',state)
 async def refresh(self):
  if not self.file:return False
  try:
   info=os.stat(self.file,follow_symlinks=False);fingerprint=(info.st_ino,info.st_mtime_ns,info.st_size,stat.S_IMODE(info.st_mode),info.st_uid)
   if fingerprint!=self.fingerprint:
    jar,fingerprint=load_cookies(self.file,now=self.now())
    if self.session:await self.session.close()
    if self.factory:factory=self.factory
    else:
     from curl_cffi.requests import AsyncSession
     from curl_cffi.const import CurlOpt
     factory=lambda **kwargs:AsyncSession(impersonate='chrome',max_clients=1,curl_options={CurlOpt.IPRESOLVE:1},**kwargs)
    self.session=factory(cookies=jar);self.fingerprint=fingerprint
    if list(fingerprint)!=self.previous_version:self.blocked=False;self.retry_at=0;self.record('configured')
    with self.store.lock:self.store.meta('session_file_version',list(fingerprint))
   if self.session and hasattr(self.session,'cookies')and not any(c.name=='sessionid'and c.value and(not c.expires or c.expires>self.now())for c in self.session.cookies.jar):
    self.blocked=True;self.record('login_required')
   if self.blocked:return False
   if self.retry_at>self.now():return False
   return True
  except CookieFileError as error:
   self.blocked=True;self.record(str(error));return False
  except Exception:
   self.blocked=True;self.record('cookie_file_unavailable');return False
 async def document(self,url,parser):
  u=urlsplit(url)
  if u.scheme!='https'or u.hostname!='www.instagram.com'or u.port or u.username or u.password or u.fragment:raise SourceError('invalid_session_target')
  if u.path=='/api/v1/users/web_profile_info/':
   query=parse_qs(u.query,keep_blank_values=True)
   if set(query)!= {'username'}or len(query['username'])!=1 or not re.fullmatch(r'[A-Za-z0-9._]{1,30}',query['username'][0]):raise SourceError('invalid_session_target')
  elif u.query or not re.fullmatch(r'/[A-Za-z0-9._]{1,30}/',u.path)or u.path.strip('/')in('accounts','direct','api','stories','explore'):raise SourceError('invalid_session_target')
  if not await self.refresh():raise SourceError('session_unavailable')
  try:
   headers={'Accept':'application/json'if u.path=='/api/v1/users/web_profile_info/'else'text/html','X-IG-App-ID':'936619743392459'}
   if u.path=='/api/v1/users/web_profile_info/':
    headers.update({'X-Requested-With':'XMLHttpRequest','Referer':'https://www.instagram.com/'+parse_qs(u.query)['username'][0]+'/','Sec-Fetch-Dest':'empty','Sec-Fetch-Mode':'cors','Sec-Fetch-Site':'same-origin'})
    csrf=next((c.value for c in self.session.cookies.jar if c.name=='csrftoken'),None)if hasattr(self.session,'cookies')else None
    if csrf:headers['X-CSRFToken']=csrf
   async with self.session.stream('GET',url,headers=headers,timeout=25,allow_redirects=False)as r:
    location=r.headers.get('location','')
    if any(p in location for p in('/challenge/','/checkpoint/')):
     self.blocked=True;self.record('verification_required');raise SourceError('session_verification_required')
    if '/accounts/login'in location or r.status_code==401:
     self.blocked=True;self.record('login_required');raise SourceError('session_login_required')
    if r.status_code==429:
     try:wait=max(300,min(3600,int(r.headers.get('retry-after')or 300)))
     except(ValueError,TypeError):wait=300
     self.retry_at=self.now()+wait;self.record('rate_limited');error=SourceError('session_rate_limited');error.session_retry_after=wait;raise error
    data=bytearray()
    async for part in r.aiter_content():
     data.extend(part)
     if len(data)>8*1024*1024:raise SourceError('oversized_document')
    text=data.decode('utf-8','replace')
    # Only actual challenge responses disable a session, not inactive HTML config keys.
    try:payload=json.loads(text)if text.lstrip().startswith('{')else{}
    except(ValueError,RecursionError):payload={}
    if isinstance(payload,dict):
     if payload.get('challenge')or payload.get('checkpoint_url')or payload.get('message')in('challenge_required','checkpoint_required'):
      self.blocked=True;self.record('verification_required');raise SourceError('session_verification_required')
     if payload.get('message')=='login_required':
      self.blocked=True;self.record('login_required');raise SourceError('session_login_required')
    if r.status_code!=200:
     self.retry_at=self.now()+(300 if r.status_code==403 else 60);self.record('access_denied'if r.status_code==403 else'temporarily_unavailable');raise SourceError('session_http_'+str(r.status_code))
    value=parser(text);self.retry_at=0;self.record('active')
    with self.store.lock:self.store.meta('session_last_success',self.now())
    return value
  except SourceError:raise
  except Exception:
   self.retry_at=self.now()+60;self.record('temporarily_unavailable');raise SourceError('session_request_failed')from None
 async def close(self):
  if self.session:await self.session.close();self.session=None
