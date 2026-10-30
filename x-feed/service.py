import asyncio,json,logging,os,re,secrets,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlparse,parse_qs
from curl_cffi.requests import AsyncSession
from curl_cffi.const import CurlOpt
from parser import parse_profile,PublicSourceError
from store import Store
from member_overrides import USERNAMES

LOG=logging.getLogger('x-public-feed')
API='https://api.jkt48connect.app'
CHANNEL=re.compile(r'[A-Za-z0-9_]{1,15}\Z')

def member_directory(rows):
 result=[];seen=set()
 for item in rows:
  supplied=USERNAMES.get(item.get('url'))
  if supplied:item={**item,'socials':[{'url':'https://x.com/'+supplied},*(item.get('socials')or[])]}
  if item.get('is_graduate') is True:continue
  for social in item.get('socials') or []:
   try:
    url=urlparse(social.get('url') or '')
    if url.hostname not in ('twitter.com','www.twitter.com','x.com','www.x.com'):continue
    handle=url.path.strip('/').split('/')[0]
    if not CHANNEL.fullmatch(handle) or handle.casefold() in ('home','intent','i','share','search') or handle.casefold() in seen:continue
    ident=str(item.get('url') or item.get('_id') or handle)
    result.append({'id':ident,'name':item.get('name') or handle,'nicknames':item.get('nicknames') or [],'username':handle,'url':'https://x.com/'+handle,'img':item.get('img'),'group':item.get('group'),'is_official':item.get('group')=='official'})
    seen.add(handle.casefold());break
   except (ValueError,AttributeError):continue
  if not any(row['id']==str(item.get('url') or item.get('_id') or '') for row in result) and item.get('_official_id'):
   result.append({'id':str(item.get('url') or item.get('_id')),'name':item.get('name'),'nicknames':item.get('nicknames') or [],'username':None,'url':None,'img':item.get('img'),'group':item.get('group'),'official_member_id':item['_official_id'],'is_official':False})
 return result

class Collector:
 def __init__(self,store):self.store=store;self.interval=max(180,int(os.environ.get('X_FEED_INTERVAL','300')));self.metadata_checked=0
 async def sync(self,session):
  response=await session.get(API+'/api/member?group=jkt48',headers={'X-API-Key':os.environ['JKT48CONNECT_API_KEY'],'User-Agent':'JKT48Connect-X-Feed/1.0','Accept':'application/json'},timeout=15,allow_redirects=False)
  if response.status_code!=200:raise RuntimeError('Member directory HTTP '+str(response.status_code))
  rows=response.json()
  if not isinstance(rows,list):raise RuntimeError('Invalid member directory')
  if os.environ.get('SCRAPER_TOKEN'):
   official=await session.get('http://127.0.0.1:8788/api/v1/members',headers={'Authorization':'Bearer '+os.environ['SCRAPER_TOKEN']},timeout=15,allow_redirects=False)
   if official.status_code==200:
    by_name={}
    def walk(value):
     if isinstance(value,dict):
      if value.get('name') and value.get('jkt48_member_id'):by_name[value['name'].casefold()]=value['jkt48_member_id']
      for item in value.values():walk(item)
     elif isinstance(value,list):
      for item in value:walk(item)
    walk(official.json())
    for item in rows:item['_official_id']=by_name.get(str(item.get('name') or '').casefold())
  members=member_directory(rows)
  if not members:raise RuntimeError('No public X handles in member directory')
  self.store.sync_members(members);self.metadata_checked=time.time();LOG.info('member directory synced: %d profiles',len(members))
 async def run(self):
  self.store.meta('interval',self.interval)
  async with AsyncSession(impersonate='chrome',max_clients=2,curl_options={CurlOpt.IPRESOLVE:1}) as metadata,AsyncSession(impersonate='chrome',max_clients=1,curl_options={CurlOpt.IPRESOLVE:1}) as public:
   while True:
    self.store.meta('heartbeat',time.time())
    try:
     if time.time()-self.metadata_checked>3600:
      try:await self.sync(metadata)
      except Exception as e:
       self.metadata_checked=time.time()-3300
       self.store.meta('error',str(e) if isinstance(e,RuntimeError) else type(e).__name__);LOG.warning('member directory unavailable: %s',type(e).__name__)
     cooldown=self.store.meta('cooldown') or 0
     if cooldown>time.time():await asyncio.sleep(5);continue
     member=self.store.due()
     if not member:await asyncio.sleep(5);continue
     if not member['handle']:
      profile=json.loads(member['profile']);official_id=profile.get('official_member_id')
      if not official_id or not str(official_id).isdigit() or not os.environ.get('SCRAPER_TOKEN'):
       self.store.failure(member,'Official X username is not yet available',3600);await asyncio.sleep(5);continue
      detail=await metadata.get('http://127.0.0.1:8788/api/v1/members/'+str(official_id),headers={'Authorization':'Bearer '+os.environ['SCRAPER_TOKEN']},timeout=15,allow_redirects=False)
      if detail.status_code!=200:
       self.store.failure(member,'Official member lookup HTTP '+str(detail.status_code),900);await asyncio.sleep(5);continue
      raw=detail.json().get('data') or {};raw=raw.get('result',raw) if isinstance(raw,dict) else {}
      handle=str(raw.get('twitter_account') or '').strip().lstrip('@')
      if not CHANNEL.fullmatch(handle):
       self.store.failure(member,'No public X username in official member profile',86400);await asyncio.sleep(5);continue
      member=self.store.set_handle(member['id'],handle)
     response=await public.get('https://x.com/'+member['handle'],headers={'Accept':'text/html'},timeout=12,allow_redirects=False)
     if response.status_code==429:
      wait=900
      try:wait=max(300,min(3600,int(response.headers.get('Retry-After') or 900)))
      except ValueError:pass
      self.store.meta('cooldown',time.time()+wait);self.store.failure(member,'Public X rate limit (429)',wait);LOG.warning('public source rate limit; pause %ds',wait)
     elif response.status_code!=200:
      self.store.failure(member,'Public profile HTTP '+str(response.status_code),900);LOG.warning('profile %s HTTP %d',member['id'],response.status_code)
     else:
      try:
       items=parse_profile(response.text,member['handle']);created=self.store.save_tweets(member,items,self.interval);self.store.meta('error',None)
       LOG.info('profile=%s stored=%d new=%d',member['id'],len(items),len(created))
      except PublicSourceError as error:self.store.failure(member,str(error),900);LOG.warning('profile %s public timeline unavailable',member['id'])
     await asyncio.sleep(5)
    except asyncio.CancelledError:raise
    except Exception as error:
     if 'member' in locals() and member:self.store.failure(member,type(error).__name__,300)
     LOG.warning('collector request failed: %s',type(error).__name__);await asyncio.sleep(5)

class Handler(BaseHTTPRequestHandler):
 store=None;token=''
 def log_message(self,*args):pass
 def reply(self,value,status=200):
  try:
   payload=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
  except (BrokenPipeError,ConnectionResetError):pass
 def do_GET(self):
  if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+self.token):return self.reply({'message':'Unauthorized'},401)
  try:
   url=urlparse(self.path);query=parse_qs(url.query);get=lambda name,default='':query.get(name,[default])[0]
   if url.path=='/status':return self.reply(self.store.status())
   if url.path=='/members':return self.reply({'members':self.store.members(),'status':self.store.status()})
   member=None
   if get('member'):
    member=self.store.resolve(get('member'))
    if member is None:return self.reply({'message':'Member atau username tidak ditemukan'},404)
   limit=max(1,min(100,int(get('limit','25'))))
   if url.path in ('/tweets','/search'):
    before=get('before')
    if before and (not before.isdigit() or len(before)>19 or int(before)>9223372036854775807):raise ValueError('Cursor tweet tidak valid')
    keyword=get('q')[:200]
    if url.path=='/search' and not keyword:raise ValueError('Parameter q diperlukan')
    value=self.store.tweets(member,limit,before or None,keyword or None,get('include_replies','true')=='true');value['status']=self.store.status();return self.reply(value)
   if url.path.startswith('/tweet/'):
    ident=url.path[len('/tweet/'):]
    if not re.fullmatch(r'\d{1,19}',ident):raise ValueError('Tweet ID tidak valid')
    value=self.store.detail(ident)
    if not value:return self.reply({'message':'Tweet belum terarsip dari sumber publik'},404)
    return self.reply({'tweet':value,'status':self.store.status()})
   if url.path=='/updates':
    after=get('after','0')
    if not after.isdigit() or len(after)>19 or int(after)>9223372036854775807:raise ValueError('Cursor update tidak valid')
    value=self.store.updates(int(after),member,limit);value['status']=self.store.status();return self.reply(value)
   return self.reply({'message':'Endpoint tidak ditemukan'},404)
  except ValueError as error:return self.reply({'message':str(error)},400)
  except Exception:return self.reply({'message':'Data X sementara tidak tersedia'},503)

if __name__=='__main__':
 logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
 store=Store(os.environ.get('X_FEED_DB','/var/lib/jkt48-x-feed/feed.sqlite3'));Handler.store=store;Handler.token=os.environ.get('X_FEED_TOKEN','')
 if len(Handler.token)<32:raise SystemExit('Private feed token is required')
 server=ThreadingHTTPServer(('127.0.0.1',8796),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 asyncio.run(Collector(store).run())
