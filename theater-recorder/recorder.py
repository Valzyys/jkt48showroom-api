"""Independent theater capture; videos spool locally and upload to YouTube, never R2."""
import asyncio, contextlib, hashlib, hmac, json, logging, os, re, shutil, signal, sqlite3, time
from pathlib import Path
from urllib.parse import urlparse, urlencode, urljoin, parse_qs
from datetime import datetime, timezone
from curl_cffi.requests import AsyncSession
from media_storage import cleanup_video
log=logging.getLogger('theater')
FIXED_SLUG='itadakilove-2026-05-14-260510220015'
def iso(t=None):return datetime.fromtimestamp(time.time() if t is None else t,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def epoch(v):
 if isinstance(v,(int,float))or(isinstance(v,str)and re.fullmatch(r'\d{10,16}',v)):
  number=float(v);return (number/1000 if number>100000000000 else number)if number>0 else None
 try:return datetime.fromisoformat(str(v).replace('Z','+00:00')).timestamp()
 except (ValueError,TypeError):return None
class Failure(Exception):pass
def normal(v):return re.sub(r'[^a-z0-9]','',str(v).lower())
def allowed_stream(url):
 try:
  u=urlparse(url);h=u.hostname or ''
  return u.scheme=='https' and not u.username and not u.password and any(h==d or h.endswith('.'+d)for d in ['live-video.net','idn.app','idntimes.com','jkt48connect.com','jkt48connect.app','aslannarnia806.workers.dev'])
 except ValueError:return False

def live_rows(payload):
 rows=payload if isinstance(payload,list)else payload.get('data',[])
 if not isinstance(rows,list):raise Failure('discovery_invalid')
 # A start timestamp also exists on ended shows. Never treat that as proof of live.
 return [r for r in rows if str(r.get('status','')).lower()in ('live','onlive','on_live') and (r.get('slug')or r.get('room_identifier'))]

def match_code(item,plans):
 title=normal(item.get('title'));start=epoch(item.get('live_at')or item.get('scheduled_at'))
 if not start or len(title)<4:return None
 candidates=[p for p in plans if p.get('code') and normal(p.get('title')) and (normal(p['title'])in title or title in normal(p['title'])) and epoch(p.get('start_time')) and abs(epoch(p['start_time'])-start)<14400]
 return min(candidates,key=lambda p:abs(epoch(p['start_time'])-start))['code'] if candidates else None

def video_args(url,pattern):
 if not allowed_stream(url):raise Failure('stream_host_rejected')
 return ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-rw_timeout','15000000','-reconnect','1','-reconnect_streamed','1','-reconnect_delay_max','5','-live_start_index','0','-protocol_whitelist','https,http,tls,tcp,crypto','-headers','Origin: https://www.idn.app\r\nReferer: https://www.idn.app/\r\n','-i',url,'-map','0:v:0','-map','0:a:0?','-c','copy','-f','segment','-segment_time','300','-reset_timestamps','1',str(pattern)]

class Store:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,value TEXT NOT NULL)');self.db.commit()
 def save(self,row):self.db.execute('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id)DO UPDATE SET value=excluded.value',(row['id'],json.dumps(row)));self.db.commit()
 def rows(self):return [json.loads(r[0])for r in self.db.execute('SELECT value FROM sessions')]

class YouTube:
 def __init__(self,client,save):self.client=client;self.save=save;self.access=None;self.until=0;self.auth_status='checking';self.auth_error=None
 async def token(self):
  if self.access and self.until>time.time():return self.access
  try:
   r=await self.client.post('https://oauth2.googleapis.com/token',data={'client_id':os.environ['YOUTUBE_CLIENT_ID'],'client_secret':os.environ['YOUTUBE_CLIENT_SECRET'],'refresh_token':os.environ['YOUTUBE_REFRESH_TOKEN'],'grant_type':'refresh_token'},timeout=25,allow_redirects=False)
   j=r.json()
   if r.status_code!=200 or not j.get('access_token'):
    code=j.get('error');raise Failure('oauth_'+code if code in ('invalid_grant','unauthorized_client','invalid_client')else 'oauth_error')
   self.access=j['access_token'];self.until=time.time()+int(j.get('expires_in',3600))-120;self.auth_status='ready';self.auth_error=None;return self.access
  except Exception as e:
   self.auth_status='error';self.auth_error=str(e)if isinstance(e,Failure)else 'oauth_network';raise Failure(self.auth_error)from None
 def session_url(self,url):
  u=urlparse(url)
  if u.scheme!='https' or u.hostname not in ('www.googleapis.com','youtube.googleapis.com','upload.googleapis.com')or not u.path.startswith('/upload/'):raise Failure('youtube_session_invalid')
  return url
 async def request(self,method,url,**kwargs):
  token=await self.token();headers={**kwargs.pop('headers',{}),'Authorization':'Bearer '+token}
  r=await self.client.request(method,url,headers=headers,allow_redirects=False,timeout=90,**kwargs)
  if r.status_code==401:
   self.until=0;headers['Authorization']='Bearer '+await self.token();r=await self.client.request(method,url,headers=headers,allow_redirects=False,timeout=90,**kwargs)
  return r
 def reject(self,r):
  try:reason=r.json().get('error',{}).get('errors',[{}])[0].get('reason','')
  except Exception:reason=''
  if reason in ('quotaExceeded','uploadLimitExceeded','dailyLimitExceeded'):raise Failure('youtube_quota')
  raise Failure('youtube_http_'+str(r.status_code))
 def result(self,row,r):
  if r.status_code in (200,201):
   vid=r.json().get('id','')
   if not re.fullmatch(r'[A-Za-z0-9_-]{11}',vid):raise Failure('youtube_video_invalid')
   row['youtube_id']=vid;row['youtube_privacy']=r.json().get('status',{}).get('privacyStatus');row['status']='uploaded';row['error']=None;row.pop('_upload_url',None);self.save(row);return True
  return False
 async def upload(self,row,path):
  size=path.stat().st_size
  if not row.get('_upload_url'):
   metadata={'snippet':{'title':(row['title']+' | '+row['started_at'][:10])[:100],'description':'Rekaman theater JKT48. Mulai teramati: '+row['observed_at']+'\n'+('Rekaman parsial / terdapat jeda.' if row['partial']else 'Sesi direkam dari waktu teramati sampai akhir.'),'categoryId':'24','tags':['JKT48','Theater']},'status':{'privacyStatus':'unlisted','selfDeclaredMadeForKids':False}}
   r=await self.request('POST','https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',headers={'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Length':str(size),'X-Upload-Content-Type':'video/mp4'},data=json.dumps(metadata))
   if r.status_code not in (200,201):self.reject(r)
   row['_upload_url']=self.session_url(r.headers.get('Location',''));row['_upload_offset']=0;self.save(row)
  url=self.session_url(row['_upload_url'])
  # Always ask Google's acknowledged offset, including after an ambiguous PUT.
  r=await self.request('PUT',url,headers={'Content-Length':'0','Content-Range':'bytes */'+str(size)},data=b'')
  if self.result(row,r):return
  if r.status_code in (404,410):row.pop('_upload_url',None);self.save(row);raise Failure('youtube_session_expired')
  if r.status_code!=308:self.reject(r)
  offset=int(r.headers.get('Range','bytes=0--1').split('-')[-1])+1 if r.headers.get('Range')else 0
  with path.open('rb')as source:
   while offset<size:
    source.seek(offset);chunk=source.read(8*1024*1024)
    r=await self.request('PUT',url,headers={'Content-Type':'video/mp4','Content-Length':str(len(chunk)),'Content-Range':f'bytes {offset}-{offset+len(chunk)-1}/{size}'},data=chunk)
    if self.result(row,r):return
    if r.status_code!=308:self.reject(r)
    acknowledged=int(r.headers.get('Range','bytes=0--1').split('-')[-1])+1 if r.headers.get('Range')else 0
    if acknowledged<=offset:raise Failure('youtube_no_progress')
    offset=acknowledged;row['_upload_offset']=offset;self.save(row)
  raise Failure('youtube_completion_unknown')
 async def unlisted(self,row):
  if row.get('youtube_privacy')=='unlisted':return
  r=await self.request('PUT','https://www.googleapis.com/youtube/v3/videos?part=status',headers={'Content-Type':'application/json'},data=json.dumps({'id':row['youtube_id'],'status':{'privacyStatus':'unlisted','selfDeclaredMadeForKids':False}}))
  if r.status_code!=200 or r.json().get('status',{}).get('privacyStatus')!='unlisted':raise Failure('youtube_unlisted_restricted')
  row['youtube_privacy']='unlisted';self.save(row)
 async def thumbnail(self,row,path):
  if not path.exists():row['thumbnail_status']='unavailable';self.save(row);return
  r=await self.request('POST','https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+row['youtube_id'],headers={'Content-Type':'image/jpeg'},data=path.read_bytes())
  row['thumbnail_status']='uploaded'if r.status_code==200 else 'failed';self.save(row)

class Recorder:
 def __init__(self):
  self.root=Path(os.environ.get('THEATER_STATE_DIR','/var/lib/jkt48-theater-recorder'));self.root.mkdir(parents=True,exist_ok=True)
  self.store=Store(self.root/'state.sqlite');self.rows={r['id']:r for r in self.store.rows()};self.active={};self.upload_task=None;self.stop=asyncio.Event();self.discovery_ok=False;self.last_error=None;self.plans=[];self.current={};self.last_config=0
  self.base=os.environ.get('THEATER_API_TRANSPORT_URL','https://api.jkt48connect.app:8443').rstrip('/');self.token=os.environ['COLLECTOR_TOKEN'];self.client=None;self.youtube=None
  for row in self.rows.values():
   if row['status']=='recording':row['status']='waiting';row['partial']=True;self.store.save(row)
 def folder(self,row):return self.root/row['id']
 def public(self,row):
  keys=('id','theater_code','slug','title','started_at','observed_at','ended_at','status','youtube_id','screenshots','bytes','duration_ms','partial','disconnects','error','thumbnail_status','youtube_privacy')
  return {k:row.get(k)for k in keys}
 async def api(self,path,method='GET',value=None):
  r=await self.client.request(method,self.base+'/internal/collector/theater/'+path,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'},json=value,timeout=30,allow_redirects=False)
  if r.status_code!=200:raise Failure('worker_http_'+str(r.status_code))
  return r.json()
 async def stream(self,item):
  # The fixed resolver slug is intentional and required by the configured source.
  resolver=os.environ['THEATER_STREAM_RESOLVER'];u=urlparse(resolver)
  if u.scheme!='https' or u.hostname!='streamtest.aslannarnia806.workers.dev':raise Failure('resolver_invalid')
  url=resolver+'?'+urlencode({'slug':FIXED_SLUG})
  r=await self.client.get(url,headers={'User-Agent':'JKT48Connect-Theater/1.0'},timeout=25,allow_redirects=False)
  if r.status_code!=200 or '#EXTM3U'not in r.text:raise Failure('stream_unavailable')
  choices=[];lines=r.text.splitlines()
  for index,line in enumerate(lines[:-1]):
   if line.startswith('#EXT-X-STREAM-INF:'):
    band=re.search(r'(?:^|,)BANDWIDTH=(\d+)',line.split(':',1)[1]);target=urljoin(url,lines[index+1].strip());wrapped=parse_qs(urlparse(target).query).get('u')
    if wrapped:target=wrapped[0]
    if allowed_stream(target):choices.append((int(band.group(1))if band else 0,target))
  return max(choices)[1] if choices else url
 async def capture(self,row):
  folder=self.folder(row);folder.mkdir(exist_ok=True);last_shot=0
  while not self.stop.is_set()and not row.get('_ended'):
   if shutil.disk_usage(self.root).free<int(os.environ.get('THEATER_MIN_FREE_BYTES',10*1024**3)):
    row['error']='disk_low';row['partial']=True;self.store.save(row);await asyncio.sleep(15);continue
   try:
    url=await self.stream(self.current.get(row['slug'],{}));run=folder/('run-'+str(int(time.time()*1000)));run.mkdir();row['status']='recording';row['error']=None;self.store.save(row)
    proc=await asyncio.create_subprocess_exec(*video_args(url,run/'%06d.ts'),stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
    try:
     while proc.returncode is None and not self.stop.is_set()and not row.get('_ended'):
      if shutil.disk_usage(self.root).free<int(os.environ.get('THEATER_MIN_FREE_BYTES',10*1024**3)):
       row['error']='disk_low';row['partial']=True;break
      if time.time()-last_shot>=int(os.environ.get('THEATER_SCREENSHOT_SECONDS',60))and len(row['screenshots'])<3000:
       frame=int(time.time()*1000);shot=folder/(str(frame)+'.jpg');last_shot=time.time()
       cmd=['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','1','-rw_timeout','10000000','-protocol_whitelist','https,http,tls,tcp,crypto','-headers','Origin: https://www.idn.app\r\nReferer: https://www.idn.app/\r\n','-i',url,'-frames:v','1','-vf','scale=640:-2','-q:v','5',str(shot)]
       shot_proc=await asyncio.create_subprocess_exec(*cmd,stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
       try:await asyncio.wait_for(shot_proc.wait(),20)
       except asyncio.TimeoutError:shot_proc.kill();await shot_proc.wait()
       if shot.exists()and shot.stat().st_size>4:row['screenshots'].append(frame)
      row['bytes']=sum(p.stat().st_size for p in folder.glob('run-*/*.ts'));self.store.save(row)
      try:await asyncio.wait_for(proc.wait(),5)
      except asyncio.TimeoutError:pass
    finally:
     if proc.returncode is None:
      proc.send_signal(signal.SIGINT)
      try:await asyncio.wait_for(proc.wait(),20)
      except asyncio.TimeoutError:proc.kill();await proc.wait()
    if not row.get('_ended')and not self.stop.is_set():row['status']='waiting';row['disconnects']+=1;row['partial']=True;self.store.save(row);await asyncio.sleep(5)
   except asyncio.CancelledError:raise
   except Exception as e:
    row['status']='waiting';row['error']=str(e)if isinstance(e,Failure)else 'capture_error';row['partial']=True;row['disconnects']+=1;self.store.save(row);await asyncio.sleep(10)
  if self.stop.is_set():row['status']='waiting';row['partial']=True
  else:row['status']='queued';row['ended_at']=row.get('_last_seen')or iso();row['error']=None
  self.store.save(row)
 async def finalize(self,row):
  folder=self.folder(row);parts=sorted(p for p in folder.glob('run-*/*.ts')if p.stat().st_size>0)
  if not parts:raise Failure('recording_empty')
  target=folder/'recording.mp4'
  if not target.exists():
   if shutil.disk_usage(self.root).free<sum(p.stat().st_size for p in parts)+1024**3:raise Failure('disk_low')
   listing=folder/'concat.txt';listing.write_text('\n'.join("file '"+str(p)+"'"for p in parts))
   proc=await asyncio.create_subprocess_exec('ffmpeg','-hide_banner','-loglevel','error','-nostdin','-y','-f','concat','-safe','0','-i',str(listing),'-map','0:v:0','-map','0:a:0?','-c','copy','-bsf:a','aac_adtstoasc','-movflags','+faststart',str(folder/'finalizing.mp4'),stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
   try:code=await asyncio.wait_for(proc.wait(),600)
   except asyncio.TimeoutError:proc.kill();await proc.wait();raise Failure('finalize_timeout')
   if code!=0:raise Failure('finalize_failed')
   (folder/'finalizing.mp4').replace(target)
  probe=await asyncio.create_subprocess_exec('ffprobe','-v','quiet','-show_entries','format=duration','-of','json',str(target),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
  output,_=await asyncio.wait_for(probe.communicate(),30);row['duration_ms']=int(float(json.loads(output)['format']['duration'])*1000);row['bytes']=target.stat().st_size
  if row['duration_ms']<=0:raise Failure('recording_empty')
  if epoch(row['ended_at']) and row['duration_ms']<(epoch(row['ended_at'])-epoch(row['started_at']))*1000*.97:row['partial']=True
  self.store.save(row);return target
 async def upload_one(self,row):
  try:
   if not row.get('youtube_id'):
    row['status']='finalizing';self.store.save(row);path=await self.finalize(row);row['status']='uploading';self.store.save(row)
    await self.youtube.upload(row,path)
   await self.youtube.unlisted(row);row['status']='uploaded';row['error']=None;self.store.save(row)
   if row.get('youtube_id'):
    try:cleanup_video(self.folder(row),row)
    except OSError:pass  # Independent storage service retries without re-uploading video.
    try:await self.youtube.thumbnail(row,self.folder(row)/(str(row['screenshots'][0])+'.jpg')if row['screenshots']else self.folder(row)/'missing.jpg')
    except Exception:row['thumbnail_status']='failed';self.store.save(row)

  except Exception as e:
   row['status']='upload_failed';row['error']=str(e)if isinstance(e,Failure)else 'upload_network';row['_retry_at']=time.time()+(3600 if row['error']=='youtube_quota'else 300);self.store.save(row)
 async def heartbeat(self):
  recent=sorted(self.rows.values(),key=lambda r:r['started_at'],reverse=True)[:200]
  await self.api('heartbeat','POST',{'pid':os.getpid(),'active':len(self.active),'queued':sum(r['status']in ('queued','upload_failed','uploading','finalizing')for r in self.rows.values()),'auth_status':self.youtube.auth_status,'auth_error':self.youtube.auth_error,'discovery_ok':self.discovery_ok,'disk_free_bytes':shutil.disk_usage(self.root).free,'last_error':self.last_error,'sessions':[self.public(r)for r in recent]})
 async def screenshots(self,reader,writer):
  try:
   data=await asyncio.wait_for(reader.readuntil(b'\r\n\r\n'),5)
   if len(data)>16000:return
   lines=data.decode('latin1').split('\r\n');method,path,_=lines[0].split(' ',2);headers={k.lower():v.strip()for line in lines[1:]if ':'in line for k,v in [line.split(':',1)]};match=re.fullmatch(r'/theater-captures/([a-f0-9]{32})/(\d{13})\.jpg',path)
   status=404;body=b'Not found';mime='text/plain'
   if not hmac.compare_digest(headers.get('authorization',''),'Bearer '+self.token):status=401;body=b'Unauthorized'
   elif method not in ('GET','HEAD'):status=405;body=b'Method not allowed'
   elif match:
    file=self.root/match[1]/(match[2]+'.jpg')
    if file.is_file()and file.stat().st_size<=2000000:body=file.read_bytes();mime='image/jpeg';status=200
   writer.write((f'HTTP/1.1 {status} Response\r\nContent-Type: {mime}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n').encode()+(b''if method=='HEAD'else body));await writer.drain()
  except Exception:pass
  finally:writer.close();await writer.wait_closed()
 async def run(self):
  async with AsyncSession(impersonate='chrome',max_clients=8)as self.client:
   self.youtube=YouTube(self.client,self.store.save);server=await asyncio.start_server(self.screenshots,'127.0.0.1',8790)
   try:
    with contextlib.suppress(Failure):await self.youtube.token()
    while not self.stop.is_set():
     try:
      if time.time()-self.last_config>300:self.plans=(await self.api('config'))['shows'];self.last_config=time.time()
      r=await self.client.get(os.environ['THEATER_DISCOVERY_URL'],timeout=25,allow_redirects=False)
      if r.status_code!=200:raise Failure('discovery_http_'+str(r.status_code))
      rows=live_rows(r.json());self.discovery_ok=True;self.current={str(r.get('slug')or r['room_identifier']):r for r in rows};self.last_error=None
      for item in rows:
       slug=str(item.get('slug')or item['room_identifier']);identifier=hashlib.sha256(('theater:'+slug).encode()).hexdigest()[:32]
       if identifier not in self.rows:
        start=epoch(item.get('live_at')or item.get('scheduled_at'))or time.time();self.rows[identifier]={'id':identifier,'theater_code':match_code(item,self.plans),'slug':slug,'title':str(item.get('title')or 'JKT48 Theater')[:300],'started_at':iso(start),'observed_at':iso(),'ended_at':None,'status':'waiting','youtube_id':None,'screenshots':[],'bytes':0,'duration_ms':0,'partial':not epoch(item.get('live_at')or item.get('scheduled_at'))or time.time()-start>30,'disconnects':0,'error':None,'thumbnail_status':'pending','youtube_privacy':None,'_misses':0};self.store.save(self.rows[identifier])
       row=self.rows[identifier];actual_start=epoch(item.get('live_at')or item.get('scheduled_at'));row['_misses']=0;row['_last_seen']=iso()
       if actual_start:
        row['started_at']=iso(actual_start)
        if (epoch(row['observed_at'])or time.time())-actual_start>30:row['partial']=True
       else:row['partial']=True
       if not row['theater_code']:row['theater_code']=match_code(item,self.plans)
       self.store.save(row)
       if row['status']=='waiting'and identifier not in self.active and len(self.active)<int(os.environ.get('THEATER_MAX_CONCURRENT',2)):self.active[identifier]=asyncio.create_task(self.capture(row))
      # Only successful discovery polls can confirm an end. API failures cannot terminate capture.
      for identifier,row in self.rows.items():
       if row['status']in ('recording','waiting')and row['slug']not in self.current:
        row['_misses']=row.get('_misses',0)+1
        if row['_misses']>=4:
         row['_ended']=True
         if identifier not in self.active:row['status']='queued';row['ended_at']=iso();self.store.save(row)
     except Exception as e:self.discovery_ok=False;self.last_error=str(e)if isinstance(e,Failure)else 'discovery_network'
     for identifier,task in list(self.active.items()):
      if task.done():
       with contextlib.suppress(Exception):await task
       self.active.pop(identifier,None)
     if self.upload_task is None or self.upload_task.done():
      if self.upload_task:
       with contextlib.suppress(Exception):await self.upload_task
      pending=next((r for r in self.rows.values()if r['status']in ('queued','upload_failed','uploading','finalizing')and r.get('_retry_at',0)<time.time()),None)
      if pending:self.upload_task=asyncio.create_task(self.upload_one(pending))
     try:await self.heartbeat()
     except Exception:self.last_error='heartbeat_failed'
     try:await asyncio.wait_for(self.stop.wait(),int(os.environ.get('THEATER_POLL_SECONDS',20)))
     except asyncio.TimeoutError:pass
   finally:
    self.stop.set();await asyncio.gather(*self.active.values(),return_exceptions=True)
    if self.upload_task:self.upload_task.cancel();await asyncio.gather(self.upload_task,return_exceptions=True)
    with contextlib.suppress(Exception):await self.heartbeat()
    server.close();await server.wait_closed()

async def main():
 recorder=Recorder();loop=asyncio.get_running_loop()
 for sig in (signal.SIGINT,signal.SIGTERM):loop.add_signal_handler(sig,recorder.stop.set)
 await recorder.run()
if __name__=='__main__':
 logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
 try:asyncio.run(main())
 except Exception as error:log.error('theater-service-failed reason=%s',type(error).__name__);raise SystemExit(1)
