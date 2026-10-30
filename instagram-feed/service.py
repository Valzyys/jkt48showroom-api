"""Public Instagram collector with optional private session fallback."""
import asyncio,json,logging,os,random,re,secrets,signal,threading,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit,parse_qs
from archive import Archive,APIError
from parser import parse_profile,parse_profile_embed,parse_session_profile,parse_detail,SourceError,HANDLE,media_url

from session_auth import SessionReader

LOG=logging.getLogger('instagram-feed');API='https://api.jkt48connect.app'

def source_backoff(code,streak):
 # Login/private/missing-profile errors are account-specific, not global outages.
 if code=='http_429':return min(1800,60*2**min(streak-1,5))
 if code=='http_403':return min(600,30*2**min(streak-1,5))
 if code=='http_503':return min(300,20*2**min(streak-1,4))
 return 0


class Collector:
 def __init__(self,store,session_reader=None):
  self.store=store;self.gate=asyncio.Lock();self.next_request=store.meta('next_request')or 0;self.asset_turn=0;self.profile_checks=0;self.auth=session_reader or SessionReader(store,os.environ.get('INSTAGRAM_COOKIE_FILE'))
  # Remove only legacy global pauses caused by account-specific source limitations.
  if not store.meta('cooldown_reason')and store.meta('error')not in('http_429','http_403','http_503'):
   with store.lock:store.meta('cooldown',0)
 async def heartbeat(self):
  while True:
   with self.store.lock:self.store.meta('heartbeat',time.time())
   await asyncio.sleep(10)
 async def document(self,session,url,parser,authenticated=False):
  async with self.gate:
   await asyncio.sleep(max(0,self.next_request-time.time()))
   with self.store.lock:cooldown=self.store.meta('cooldown')or 0
   await asyncio.sleep(max(0,cooldown-time.time()))
   try:
    if authenticated:return await self.auth.document(url,parser)
    async with session.stream('GET',url,timeout=25,allow_redirects=False)as response:
     if response.status_code!=200:raise SourceError('login_required'if '/accounts/login' in response.headers.get('location','')else'http_'+str(response.status_code))
     data=bytearray()
     async for part in response.aiter_content():
      data.extend(part)
      if len(data)>8*1024*1024:raise SourceError('oversized_document')
     return parser(data.decode('utf-8','replace'))
   finally:
    self.next_request=time.time()+random.uniform(20,35)
    with self.store.lock:self.store.meta('next_request',self.next_request)
 async def profile(self,session,username):
  with self.store.lock:preferred=self.store.meta('profile_source:'+username)or'embed'
  routes=[preferred,'profile'if preferred=='embed'else'embed'];last=None
  for route in routes:
   url='https://www.instagram.com/'+username+('/embed/'if route=='embed'else'/')
   parser=parse_profile_embed if route=='embed'else parse_profile
   try:
    result=await self.document(session,url,lambda h:parser(h,username))
    with self.store.lock:self.store.meta('profile_source:'+username,route)
    return result
   except SourceError as error:
    last=error
    if str(error)in('http_429','http_403','http_503','private_account'):raise
  if await self.auth.refresh():
   # Session is restricted to Instagram and used only after the anonymous routes fail.
   try:return await self.document(None,'https://www.instagram.com/'+username+'/',lambda h:parse_profile(h,username,require_public=True),authenticated=True)
   except SourceError as error:
    if str(error)not in('public_page_data_missing','profile_identity_missing','profile_posts_not_exposed','profile_visibility_unknown'):raise
   return await self.document(None,'https://www.instagram.com/api/v1/users/web_profile_info/?username='+username,lambda h:parse_session_profile(h,username),authenticated=True)
  raise last
 async def profiles(self,session):
  while True:
   with self.store.lock:
    cooldown=self.store.meta('cooldown')or 0;member=self.store.due()
   if cooldown>time.time()or not member:await asyncio.sleep(5);continue
   username=member['username']
   try:
    result=await self.profile(session,username)
    with self.store.lock:
     receipt=self.store.save(result);self.store.scheduled(username,random.uniform(900,1200));self.store.meta('last_success',time.time());self.store.meta('error','');self.store.meta('consecutive_errors',0);self.store.meta('cooldown',0);self.store.meta('cooldown_reason','');self.store.meta('source_block_streak',0)
    LOG.info('profile=%s posts=%d baseline=%s new=%d excluded_existing=%d',username,len(result['posts']),receipt['baseline'],len(receipt['new_posts']),receipt.get('excluded_existing_owners',0))
   except Exception as error:
    code=str(error)if isinstance(error,SourceError)else type(error).__name__
    with self.store.lock:
     streak=(self.store.meta('consecutive_errors')or 0)+1;self.store.meta('consecutive_errors',streak);self.store.meta('error',code);self.store.failure(username,code)
     self.store.scheduled(username,(86400 if code=='private_account'else min(21600,300*2**min(member['failures'],6)))+random.uniform(0,60),True)
     blocked=(self.store.meta('source_block_streak')or 0)+1;pause=max(source_backoff(code,blocked),getattr(error,'retry_after',0))
     if pause:self.store.meta('source_block_streak',blocked);self.store.meta('cooldown',time.time()+pause+random.uniform(0,10));self.store.meta('cooldown_reason',code)
    LOG.warning('profile=%s error=%s',username,code)
   self.profile_checks+=1
   await asyncio.sleep(2)
 async def details(self,session):
  # Enrich one post per successful profile pass; new IDs are first. No history paging.
  while True:
   await asyncio.sleep(12)
   with self.store.lock:
    cooldown=self.store.meta('cooldown')or 0
    if self.store.due()and self.profile_checks<4:continue
    row=self.store.db.execute("SELECT d.*,p.username,json_extract(p.document,'$.shortcode') AS shortcode FROM details d JOIN posts p ON p.id=d.post_id WHERE (d.success IS NULL OR d.success<=?) AND d.next_try<=? ORDER BY d.success IS NOT NULL,length(p.id) DESC,p.id DESC,d.attempts LIMIT 1",(time.time()-21600,time.time())).fetchone()
   if not row or cooldown>time.time():continue
   self.profile_checks=0
   try:
    detail=await self.document(session,'https://www.instagram.com/p/'+row['shortcode']+'/',lambda h:parse_detail(h,row['username'],row['post_id'],row['shortcode']))
    with self.store.lock:
     self.store.enrich(row['username'],detail)
     with self.store.db:self.store.db.execute('UPDATE details SET success=?,attempts=attempts+1 WHERE post_id=?',(time.time(),row['post_id']))
    LOG.info('detail=%s ready',row['post_id'])
   except Exception as error:
    code=str(error)if isinstance(error,SourceError)else type(error).__name__
    with self.store.lock:
     with self.store.db:self.store.db.execute('UPDATE details SET attempts=attempts+1,next_try=? WHERE post_id=?',(time.time()+min(86400,1800*2**min(row['attempts'],5)),row['post_id']))
     pause=source_backoff(code,(self.store.meta('source_block_streak')or 0)+1)
     if pause:self.store.meta('cooldown',max(self.store.meta('cooldown')or 0,time.time()+pause));self.store.meta('cooldown_reason',code)
    LOG.warning('detail=%s error=%s',row['post_id'],code)
 async def sync_directory(self,session):
  clean=lambda s:re.sub('[^a-z0-9]','',str(s or'').lower())
  async def get(url):
   local=url.startswith('http://127.0.0.1:8788/')
   r=await session.get(url,headers={'Authorization':'Bearer '+os.environ['SCRAPER_TOKEN']}if local else {'X-API-Key':os.environ['JKT48CONNECT_API_KEY']},timeout=25,allow_redirects=False)
   if r.status_code!=200:raise SourceError('directory_http_'+str(r.status_code))
   return r.json()
  while True:
   with self.store.lock:last=self.store.meta('directory_success')or 0
   if time.time()-last<86400:await asyncio.sleep(60);continue
   try:
    active=await get(API+'/api/member?group=jkt48');raw=await get('http://127.0.0.1:8788/api/v1/members');official=[]
    def walk(x):
     if isinstance(x,list):
      for r in x:walk(r)
     elif isinstance(x,dict):
      if x.get('name')and x.get('jkt48_member_id'):official.append(x)
      for r in x.values():walk(r)
    walk(raw)
    if not isinstance(active,list)or not official:raise SourceError('invalid_directory')
    with self.store.lock:old={r['member']:json.loads(r['document'])for r in self.store.db.execute('SELECT * FROM members')}
    rows=[]
    for m in active:
     if m.get('is_graduate')or m.get('group')=='official':continue
     found=[r for r in official if clean(r['name'])==clean(m.get('name'))]
     if not found:found=[r for r in official if any(clean(v)==clean(r.get('nickname'))for v in [m.get('name'),*(m.get('nicknames')or[])])]
     if not found:found=[r for r in official if clean(m.get('name')).startswith(clean(r['name']))or clean(r['name']).startswith(clean(m.get('name')))]
     ident=m.get('url');previous=old.get(ident,{})
     row={'member':ident,'name':m.get('name'),'username':previous.get('username'),'status':'unmatched_official_member','source':'jkt48-official-member-detail'}
     if len(found)==1:
      row['official_id']=found[0]['jkt48_member_id']
      try:
       d=(await get('http://127.0.0.1:8788/api/v1/members/'+str(row['official_id']))).get('data')or{};u=str(d.get('instagram_account')or'').strip().lstrip('@')
       if u.startswith('https://'):
        parsed=urlsplit(u);u=parsed.path.strip('/')if parsed.hostname in('instagram.com','www.instagram.com')else''
       row['username']=u if HANDLE.fullmatch(u)else None;row['status']='official_handle'if row['username']else'not_published'
      except Exception:row['status']='lookup_failed_retained'
      await asyncio.sleep(random.uniform(2,3))
     rows.append(row)
    rows=[r for r in rows if r.get('member')!='jkt48-u16' and str(r.get('username')or'').lower()!='jkt48.u16']
    rows.append({'member':'jkt48-u16','name':'JKT48 U16','username':'jkt48.u16','status':'official_shared_account','source':'https://jkt48.com/news/pengumuman-mengenai-akun-media-sosial-member-jkt48','group':'jkt48','is_official':True})
    with self.store.lock:self.store.directory(rows);self.store.meta('directory_success',time.time());self.store.meta('directory_error','')
    LOG.info('directory members=%d handles=%d',len(rows),sum(bool(r.get('username'))for r in rows))
   except Exception as error:
    with self.store.lock:self.store.meta('directory_error',str(error)if isinstance(error,SourceError)else type(error).__name__)
    LOG.warning('directory unavailable: %s',type(error).__name__);await asyncio.sleep(900)
 async def assets(self,session):
  while True:
   await asyncio.sleep(3)
   with self.store.lock:
    rows=self.store.db.execute('SELECT p.*,m.member FROM posts p JOIN members m ON lower(m.username)=lower(p.username) AND m.active=1 ORDER BY length(p.id) DESC,p.id DESC').fetchall();job=None
    # Rotate gallery/video slots so a large cover backlog cannot starve full posts.
    self.asset_turn=(self.asset_turn+1)%5
    priority=('video','thumbnail','image')if self.asset_turn==0 else('image','thumbnail','video')if self.asset_turn in(2,4)else('thumbnail','image','video')
    for category in priority:
     if job:break
     for row in rows:
      media=json.loads(row['document']).get('media',{});sources={'thumbnail':media.get('thumbnail'),'video':media.get('play_url')}
      sources.update({'image-'+str(i):u for i,u in enumerate(media.get('images')or[])})
      sources.update({'video-'+str(i):u.get('play_url') for i,u in enumerate(media.get('items')or[]) if u.get('play_url')})
      for kind,url in sources.items():
       if not url or (kind!=category and not(category in('image','video')and kind.startswith(category+'-'))):continue
       with self.store.lock:
        a=self.store.db.execute('SELECT * FROM assets WHERE post_id=? AND kind=?',(row['id'],kind)).fetchone()
       if a and(a['state']in('ready','unsupported')or a['next_try']>time.time()):continue
       job=(dict(row),kind,url,dict(a)if a else {});break
      if job:break
    if not job:continue
    row,kind,url,a=job;size_limit=64*1024*1024 if kind.startswith('video')else 8*1024*1024;data=bytearray();code=None
    try:
     if not media_url(url):raise SourceError('unsafe_media_url')
     async with session.stream('GET',url,headers={'Referer':'https://www.instagram.com/'},timeout=90,allow_redirects=False)as r:
      if r.status_code!=200:raise SourceError('media_http_'+str(r.status_code))
      if int(r.headers.get('content-length')or 0)>size_limit:raise SourceError('media_too_large')
      mime=r.headers.get('content-type','').split(';')[0].strip()
      async for chunk in r.aiter_content():
       data.extend(chunk)
       if len(data)>size_limit:raise SourceError('media_too_large')
     video=kind.startswith('video')
     valid= b'ftyp'in data[:32]if video else data[:3]==b'\xff\xd8\xff'or data[:8]==b'\x89PNG\r\n\x1a\n'or(data[:4]==b'RIFF'and data[8:12]==b'WEBP')
     if not valid:raise SourceError('invalid_media_signature')
     if video:mime='video/mp4'
     elif data[:3]==b'\xff\xd8\xff':mime='image/jpeg'
     elif data[:8]==b'\x89PNG\r\n\x1a\n':mime='image/png'
     else:mime='image/webp'
     target=API+'/internal/instagram-media/'+row['member']+'/'+row['id']+'/'+kind
     r=await session.put(target,headers={'Authorization':'Bearer '+os.environ['INSTAGRAM_FEED_TOKEN'],'Content-Type':mime},data=bytes(data),timeout=120,allow_redirects=False)
     if r.status_code!=200:raise SourceError('r2_upload_http_'+str(r.status_code))
     result=r.json();public_url=result['url']
     with self.store.lock:
      with self.store.db:self.store.db.execute("INSERT INTO assets(post_id,kind,state,url,bytes,attempts)VALUES(?,?,'ready',?,?,1) ON CONFLICT(post_id,kind)DO UPDATE SET state='ready',url=excluded.url,bytes=excluded.bytes,error=NULL,attempts=assets.attempts+1",(row['id'],kind,public_url,len(data)))
     LOG.info('media=%s/%s archived bytes=%d',row['id'],kind,len(data))
    except Exception as error:
     code=str(error)if isinstance(error,SourceError)else type(error).__name__;attempts=a.get('attempts',0)+1;state='unsupported'if code=='media_too_large'else'pending'
     with self.store.lock:
      with self.store.db:self.store.db.execute('INSERT INTO assets(post_id,kind,state,error,attempts,next_try)VALUES(?,?,?,?,?,?) ON CONFLICT(post_id,kind)DO UPDATE SET state=excluded.state,error=excluded.error,attempts=excluded.attempts,next_try=excluded.next_try',(row['id'],kind,state,code,attempts,time.time()+min(21600,300*2**min(attempts-1,6))))
      if code in('media_http_403','media_http_404','media_http_410'):
       with self.store.db:self.store.db.execute('UPDATE details SET success=NULL,next_try=max(next_try,?) WHERE post_id=? AND success IS NOT NULL',(time.time()+600,row['id']))
     LOG.warning('media=%s/%s error=%s',row['id'],kind,code)
    finally:del data
 async def run(self):
  from curl_cffi.requests import AsyncSession
  from curl_cffi.const import CurlOpt
  async with AsyncSession(impersonate='chrome',max_clients=1,curl_options={CurlOpt.IPRESOLVE:1})as public,AsyncSession(impersonate='chrome',max_clients=1,curl_options={CurlOpt.IPRESOLVE:1})as media,AsyncSession(impersonate='chrome',max_clients=1)as metadata:
   try:await asyncio.gather(self.heartbeat(),self.profiles(public),self.details(public),self.assets(media),self.sync_directory(metadata))
   finally:await self.auth.close()

def http_server(store,token,port):
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def reply(self,data,status):
   raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(raw)));self.end_headers()
   try:self.wfile.write(raw)
   except(BrokenPipeError,ConnectionResetError):pass
  def do_GET(self):
   if not secrets.compare_digest(self.headers.get('Authorization',''),'Bearer '+token):return self.reply({'message':'Unauthorized'},401)
   try:
    if len(self.path)>2048:raise APIError('Request terlalu panjang',414)
    u=urlsplit(self.path);queries=parse_qs(u.query,keep_blank_values=True,max_num_fields=10)
    if any(len(v)!=1 for v in queries.values()):raise APIError('Parameter ganda tidak valid')
    query={k:v[0]for k,v in queries.items()}
    with store.lock:data=store.read(u.path,query)
    self.reply(data,200)
   except(APIError,ValueError)as error:self.reply({'message':str(error)},getattr(error,'status',400))
   except Exception:self.reply({'message':'Archive read failed'},500);LOG.exception('archive read failed')
 return ThreadingHTTPServer(('127.0.0.1',port),Handler)

def main():
 logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s');token=os.environ.get('INSTAGRAM_FEED_TOKEN','')
 if len(token)<32:raise RuntimeError('Missing private relay token')
 store=Archive(os.environ.get('INSTAGRAM_DATABASE','/var/lib/jkt48-instagram-feed/archive.sqlite'));server=http_server(store,token,int(os.environ.get('INSTAGRAM_PORT','8799')))
 threading.Thread(target=server.serve_forever,daemon=True).start();asyncio.run(Collector(store).run())

if __name__=='__main__':main()
