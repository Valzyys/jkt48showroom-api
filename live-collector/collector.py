"""Persistent live observer. Media bytes go through RAM to Worker/R2, not local video files."""
import asyncio, collections, contextlib, hashlib, json, logging, os, re, signal, sqlite3, time
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone
from curl_cffi.requests import AsyncSession
import websockets

log=logging.getLogger('collector')
def iso(seconds=None):return datetime.fromtimestamp(time.time() if seconds is None else seconds,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def epoch(value):
 if isinstance(value,(float,int)):return float(value)/1000 if value>100000000000 else float(value)
 try:return datetime.fromisoformat(str(value).replace('Z','+00:00')).timestamp()
 except (ValueError,TypeError):return time.time()
def normal(value):return re.sub('[^a-z0-9]','',str(value).lower())
def match_member(name,key,members):
 key=normal(re.sub(r'^jkt48[-_]?', '',key,flags=re.I));n=normal(name)
 candidates=[m for m in members if key in {normal(m.get('slug')),normal(m['name']),*[normal(v) for v in m.get('nicknames',[])]} or normal(m['name'])==n]
 return candidates[0] if len(candidates)==1 else None

def stream_allowed(url):
 try:
  x=urlparse(url);h=x.hostname or ''
  return x.scheme=='https' and not x.username and not x.password and any(h==s or h.endswith('.'+s) for s in ['showroom-live.com','showroom-txlive.com','live-video.net','idn.app','idntimes.com'])
 except ValueError:return False

def frame_command(url,width):
 if not stream_allowed(url):raise ValueError('Unsupported stream host')
 return ['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-threads','2','-filter_threads','1','-rw_timeout','15000000','-protocol_whitelist','https,http,tls,tcp,crypto','-i',url,'-frames:v','1','-vf',f'scale={width}:-2','-q:v','5','-f','image2pipe','-vcodec','mjpeg','-threads','1','pipe:1']
def video_command(url):
 if not stream_allowed(url):raise ValueError('Unsupported stream host')
 return ['ffmpeg','-hide_banner','-loglevel','error','-nostats','-progress','pipe:2','-rw_timeout','15000000','-protocol_whitelist','https,http,tls,tcp,crypto','-live_start_index','0','-i',url,'-map','0:v:0?','-map','0:a:0?','-c','copy','-bsf:a','aac_adtstoasc','-movflags','frag_keyframe+delay_moov+default_base_moof','-f','mp4','pipe:1']

class Store:
 def __init__(self,path):
  self.db=sqlite3.connect(path);self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL)');self.db.commit()
 def save(self,row):
  self.db.execute('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',(row['data_id'],json.dumps(row)));self.db.commit()
 def rows(self):return [json.loads(r[0]) for r in self.db.execute('SELECT value FROM sessions')]
 def delete(self,id):self.db.execute('DELETE FROM sessions WHERE id=?',(id,));self.db.commit()

class Collector:
 def __init__(self):
  self.base=os.environ['COLLECTOR_API_URL'].rstrip('/');self.token=os.environ['COLLECTOR_TOKEN'];self.stop=asyncio.Event();self.state=Path(os.environ.get('COLLECTOR_STATE_DIR','/var/lib/jkt48-live-collector'));self.state.mkdir(parents=True,exist_ok=True);os.chmod(self.state,0o700)
  self.store=Store(self.state/'state.sqlite');self.rows={r['data_id']:r for r in self.store.rows()};self.tasks={};self.bridge=None;self.bridge_task=None;self.config={};self.client=None;self.frame_lock=asyncio.Semaphore(2);self.started=time.time();self.last_archive=0;self.last_completed=0;self.archive_errors=0
 def telemetry(self):
  sessions=[]
  for row in self.rows.values():
   sessions.append({'data_id':row['data_id'],'name':row['name'],'type':row['type'],'completed':row['completed'],'last_seen':int(row['last_seen']*1000),'last_screenshot':row['frames'][-1] if row['frames'] else 0,'screenshot_errors':row['screenshot_errors'],'screenshots_allowed':row['screenshots_allowed'],'stream_available':bool(row.get('stream')),'video':row.get('video_monitor',{'status':'waiting','bytes':0,'parts':0,'last_part':0,'errors':0}),'last_archive':row.get('last_archive',0),'archive_error':row.get('archive_error',False)})
  return {'pid':os.getpid(),'uptime_seconds':int(time.time()-self.started),'last_archive':self.last_archive,'last_completed':self.last_completed,'archive_errors':self.archive_errors,'sessions':sessions}
 async def api(self,path,method='GET',value=None,data=None):
  response=await self.client.request(method,self.base+'/internal/collector/'+path,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json' if data is None else 'application/octet-stream'},json=value if data is None else None,data=data,timeout=50)
  if response.status_code!=200:raise RuntimeError('Worker rejected '+path.split('/')[0]+': HTTP '+str(response.status_code))
  return response.json()
 async def source(self,url,params=None,headers=None):
  response=await self.client.get(url,params=params,headers=headers,timeout=20)
  if response.status_code!=200:raise RuntimeError('Source HTTP '+str(response.status_code))
  return response.json()
 async def showroom(self):
  data=await self.source('https://www.showroom-live.com/api/live/onlives');result={}
  for group in data.get('onlives',[]):
   for live in group.get('lives',[]):
    if not (str(live.get('room_url_key','')).lower().startswith('jkt48_') or 'jkt48' in str(live.get('main_name','')).lower()):continue
    id='sr-'+str(live['room_id'])+'-'+str(live['live_id']);member=match_member(live.get('main_name',''),live.get('room_url_key',''),self.config['members'])
    result[id]={'data_id':id,'live_id':live['live_id'],'room_id':int(live['room_id']),'member_id':member['id'] if member else None,'name':live.get('main_name',''),'img':live.get('image',''),'url_key':live.get('room_url_key',''),'type':'showroom','started_at':epoch(live.get('started_at')),'stream':next((s['url'] for s in live.get('streaming_url_list',[]) if s.get('type')=='hls' and stream_allowed(s.get('url',''))),None),'viewers':live.get('view_num',0),'bcsvr_key':live.get('bcsvr_key','')}
  for row in result.values():
   if not row.get('stream'):
    urls=await self.source('https://www.showroom-live.com/api/live/streaming_url',{'room_id':row['room_id']})
    options=[s for s in urls.get('streaming_url_list',[]) if s.get('type')=='hls' and stream_allowed(s.get('url',''))]
    if options:row['stream']=max(options,key=lambda s:s.get('quality',0))['url']
  return result
 async def idn(self):
  result={}
  for page in range(1,11):
   data=await self.source('https://mobile-api.idntimes.com/v3/livestreams',{'category':'all','page':page},headers={'x-api-key':os.environ['IDN_PUBLIC_CLIENT_KEY'],'User-Agent':'IDN/6.41.1'})
   lives=data.get('data',[])
   for live in lives:
    creator=live.get('creator') or {};username=creator.get('username','')
    known=next((m for m in self.config['members'] if m.get('idn_username')==username),None)
    if not known and not username.lower().startswith('jkt48'):continue
    if str(live.get('status','')).lower() not in ['live','on_live','onlive']:continue
    member=known or match_member(creator.get('name',''),username,self.config['members'])
    slug=live['slug'];id='idn-'+hashlib.sha256(slug.encode()).hexdigest()[:24]
    room=(member.get('room_id') if member else None) or 1000000000+int(hashlib.sha256(username.encode()).hexdigest()[:7],16)
    result[id]={'data_id':id,'live_id':slug,'room_id':int(room),'member_id':member['id'] if member else None,'name':creator.get('name',username),'img':live.get('image_url',''),'url_key':username,'type':'idn','started_at':epoch(live.get('live_at')),'stream':live.get('playback_url') if stream_allowed(live.get('playback_url','')) else None,'viewers':live.get('view_count',0),'idn':{'id':str(creator.get('uuid','')),'username':username,'slug':slug,'title':live.get('title',''),'image':live.get('image_url','')}}
   if not lives:break
  return result
 def new(self,live):
  row={**live,'date':{'start':iso(live['started_at']),'end':iso()},'observed':iso(),'last_seen':time.time(),'missing':0,'users':{},'gifts':{},'catalog':{},'frames':[],'recordings':[],'disconnects':0,'screenshot_errors':0,'screenshots_allowed':True,'gifts_status':'unavailable','completed':False,'next_frame':0,'seen_ids':[]}
  self.rows[row['data_id']]=row;self.store.save(row);log.info('session-start type=%s room=%s id=%s',row['type'],row['room_id'],row['data_id']);return row
 def gift(self,row,event,id=None):
  if id and id in row['seen_ids']:return
  if id:row['seen_ids']=(row['seen_ids']+[id])[-10000:]
  uid=str(event['user_id']);user=row['users'].setdefault(uid,{'user_id':uid,'name':event.get('name','Viewer'),'comments':0})
  for field in ['avatar_id','avatar_url']:
   if event.get(field) is not None:user[field]=event[field]
  gid=str(event['gift_id']);num=int(event.get('num',1));amount=event.get('point');when=epoch(event.get('date'))
  if num<1 or num>100000:return
  # Aggregate by user, gift and minute. Exact observed quantity is retained.
  key=uid+'|'+gid+'|'+str(int(when//60));item=row['gifts'].setdefault(key,{'user_id':uid,'gift_id':event['gift_id'],'num':0,'date':iso(when),'point':amount})
  item['send_count']=item.get('send_count',0)+1 if not item['num'] or 'send_count' in item else None
  if item.get('send_count') is None:item.pop('send_count',None)
  item['num']+=num
  if amount is None:row['gifts_status']='partial'
  self.store.save(row)
 def payload(self,row):
  users={}
  for gift in row['gifts'].values():
   target=users.setdefault(gift['user_id'],{'user_id':gift['user_id'],'total':0,'gifts':[]});value={k:gift[k] for k in ['gift_id','num','date']}
   if 'send_count' in gift:value['send_count']=gift['send_count']
   if gift['point'] is not None:value['point']=gift['point'];target['total']+=gift['point']*gift['num']
   target['gifts'].append(value)
  value={k:row[k] for k in ['data_id','live_id','room_id','name','img','url_key','type','date','viewers','frames']}
  if row.get('member_id'):value['member_id']=row['member_id']
  if row.get('idn'):value['idn']=row['idn']
  value.update(users=list(row['users'].values()),gift_log=list(users.values()),catalog=list(row['catalog'].values()),comments=sum(u.get('comments',0) for u in row['users'].values()),recordings=row['recordings'],capture={'status':'completed' if row['completed'] else 'live','observed_since':row['observed'],'gifts_status':row['gifts_status'],'gifts_source':'showroom-websocket' if row['type']=='showroom' else 'idn-observed-chat','gifts_error':row.get('gifts_error'),'last_gift_event':row.get('last_gift_event'),'disconnects':row['disconnects'],'screenshot_errors':row['screenshot_errors'],'screenshots_allowed':row['screenshots_allowed']})
  return value
 async def sr_socket(self,row):
  while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
   try:
    info=await self.source('https://www.showroom-live.com/api/live/live_info',{'room_id':row['room_id']})
    row['screenshots_allowed']=not info.get('is_recording_prohibited',False);self.store.save(row)
    gifts=await self.source('https://www.showroom-live.com/api/live/gift_list',{'room_id':row['room_id']})
    for items in gifts.values():
     if not isinstance(items,list):continue
     for gift in items:
      if 'gift_id' not in gift:continue
      row['catalog'][str(gift['gift_id'])]={'id':gift['gift_id'],'name':gift.get('gift_name','Gift'),'point':gift.get('point'),'free':bool(gift.get('free')),'img':gift.get('image','')}
    key=info.get('bcsvr_key') or row.get('bcsvr_key');host=info.get('bcsvr_host') or 'online.showroom-live.com'
    if not host.endswith('.showroom-live.com'):raise RuntimeError('Unsupported event server')
    async with websockets.connect('wss://'+host,origin='https://www.showroom-live.com',ping_interval=30,ping_timeout=20,max_size=200000) as ws:
     await ws.send('SUB\t'+key);row['gifts_status']='partial';self.store.save(row)
     log.info('gift-connected type=showroom room=%s',row['room_id'])
     while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
      try:message=await asyncio.wait_for(ws.recv(),timeout=40)
      except asyncio.TimeoutError:await ws.send('PING');continue
      if isinstance(message,bytes):message=message.decode(errors='replace')
      begin=message.find('{')
      if begin<0:continue
      try:event=json.loads(message[begin:])
      except json.JSONDecodeError:continue
      if str(event.get('t'))=='2' and event.get('u') is not None and event.get('g') is not None:
       catalog=row['catalog'].get(str(event['g']),{});self.gift(row,{'user_id':event['u'],'name':event.get('ac','Viewer'),'avatar_id':int(event.get('av',1)),'gift_id':event['g'],'num':event.get('n',1),'point':catalog.get('point'),'date':time.time()},event.get('id'))
      elif str(event.get('t'))=='1' and event.get('u') is not None:
       user=row['users'].setdefault(str(event['u']),{'user_id':str(event['u']),'name':event.get('ac','Viewer'),'comments':0});user['comments']+=1
   except asyncio.CancelledError:raise
   except Exception as error:
    row['disconnects']+=1;row['gifts_status']='partial';self.store.save(row);log.warning('gift-disconnected type=showroom room=%s reason=%s',row['room_id'],type(error).__name__);await asyncio.sleep(10)
 async def frames(self,row):
  while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
   if self.config.get('screenshotsEnabled',True) and row['screenshots_allowed'] and row.get('stream') and time.time()>=row.get('next_frame',0):
    row['next_frame']=time.time()+self.config.get('screenshotSeconds',60)
    try:
     async with self.frame_lock:
      proc=await asyncio.create_subprocess_exec(*frame_command(row['stream'],self.config.get('screenshotWidth',640)),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
      try:body,_=await asyncio.wait_for(proc.communicate(),timeout=25)
      except (asyncio.TimeoutError,asyncio.CancelledError):proc.kill();await proc.wait();raise
      if proc.returncode or not body.startswith(b'\xff\xd8\xff'):raise RuntimeError('Frame unavailable')
      frame=int(time.time()*1000);await self.api(f'screenshot/{row["data_id"]}/{frame}','PUT',data=body);row['frames'].append(frame);self.store.save(row)
     log.info('frame-uploaded id=%s frames=%s',row['data_id'],len(row['frames']))
    except asyncio.CancelledError:raise
    except Exception as error:row['screenshot_errors']+=1;self.store.save(row);log.warning('frame-failed id=%s reason=%s',row['data_id'],type(error).__name__)
   try:await asyncio.wait_for(self.stop.wait(),timeout=5)
   except asyncio.TimeoutError:pass
 async def video(self,row):
  # One fragmented MP4 per connection, multipart chunks held only in memory.
  while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
   if not self.config.get('recordVideo',True) or not row.get('stream') or not row['screenshots_allowed']:await asyncio.sleep(5);continue
   proc=None;progress_task=None;upload=None;parts=[];bytes_sent=0;buffer=bytearray();run=str(int(time.time()*1000))
   monitor={'status':'starting','bytes':0,'parts':0,'last_part':0,'errors':row.get('video_monitor',{}).get('errors',0)};row['video_monitor']=monitor
   try:
    upload=await self.api('video/start','POST',{'data_id':row['data_id'],'run':run})
    proc=await asyncio.create_subprocess_exec(*video_command(row['stream']),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    monitor['status']='recording'
    async def read_progress():
     while line:=await proc.stderr.readline():
      if line.startswith(b'out_time_us='):
       with contextlib.suppress(ValueError):monitor['duration_ms']=max(0,int(line.split(b'=',1)[1])//1000)
    progress_task=asyncio.create_task(read_progress())
    async def end_process():
     while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True) and self.config.get('recordVideo',True) and row['screenshots_allowed'] and proc.returncode is None:await asyncio.sleep(1)
     if proc.returncode is None:
      try:proc.stdin.write(b'q\n');await proc.stdin.drain()
      except (BrokenPipeError,ConnectionResetError):pass
      try:await asyncio.wait_for(proc.wait(),20)
      except asyncio.TimeoutError:proc.kill();await proc.wait()
    waiter=asyncio.create_task(end_process())
    async def send_part(body):
     nonlocal bytes_sent
     for attempt in range(4):
      try:
       result=await self.api(f'video/part/{upload["id"]}/{len(parts)+1}','PUT',data=body);parts.append(result['part']);bytes_sent+=len(body);monitor.update(status='recording',bytes=bytes_sent,parts=len(parts),last_part=int(time.time()*1000));return
      except Exception:
       if attempt==3:raise
       await asyncio.sleep(2**attempt)
    try:
     while True:
      chunk=await proc.stdout.read(65536)
      if not chunk:break
      buffer.extend(chunk)
      while len(buffer)>=5*1024*1024:
       await send_part(bytes(buffer[:5*1024*1024]));del buffer[:5*1024*1024]
     if buffer:await send_part(bytes(buffer));buffer.clear()
     await waiter
     await progress_task
    finally:
     if not waiter.done():waiter.cancel()
     with contextlib.suppress(asyncio.CancelledError):await waiter
    if parts and (proc.returncode==0 or bytes_sent>1000000):
     monitor['status']='finalizing'
     result=await self.api('video/finish','POST',{'id':upload['id'],'parts':parts});row['recordings'].append({'run':run,'url':result['url'],'bytes':bytes_sent,'duration_ms':monitor.get('duration_ms',0),'partial':proc.returncode!=0 or not row['completed'] or epoch(row['observed'])>epoch(row['date']['start'])});self.store.save(row);log.info('video-uploaded id=%s bytes=%s',row['data_id'],bytes_sent)
    else:
     monitor['errors']+=1;monitor['status']='error';await self.api('video/abort','POST',{'id':upload['id']})
   except asyncio.CancelledError:raise
   except Exception as error:
    monitor['errors']+=1;monitor['status']='error'
    log.warning('video-failed id=%s reason=%s',row['data_id'],str(error) if isinstance(error,RuntimeError) else type(error).__name__)
    if upload:
     with contextlib.suppress(Exception):await self.api('video/abort','POST',{'id':upload['id']})
   finally:
    if proc and proc.returncode is None:proc.kill();await proc.wait()
    if progress_task and not progress_task.done():
     progress_task.cancel()
     with contextlib.suppress(asyncio.CancelledError):await progress_task
    if monitor['status']!='error':monitor['status']='completed' if row['completed'] else 'waiting'
   if not row['completed']:await asyncio.sleep(10)
 async def bridge_read(self):
  while line:=await self.bridge.stdout.readline():
   try:
    value=json.loads(line);row=self.rows.get(value.get('id'))
    if not row:continue
    if value.get('kind')=='gift':
     gift=value['gift'];gid=gift.get('slug');user=value['user'];uid=user.get('uuid') or user.get('username')
     if not gid or not uid:continue
     row['catalog'][gid]={'id':gid,'name':gift.get('name','Gift'),'point':gift.get('gold'),'gold':gift.get('gold',0),'free':False,'img':gift.get('image_url','')}
     row['gifts_status']='partial';self.gift(row,{'user_id':uid,'name':user.get('name','Viewer'),'avatar_url':user.get('avatar_url',''),'gift_id':gid,'num':gift.get('quantity') or gift.get('num') or 1,'point':gift.get('gold'),'date':time.time()},value.get('event_id'));row['last_gift_event']=iso();row['gifts_error']=None
    elif value.get('kind') in ['comment','user']:
     user=value['user'];uid=user.get('uuid') or user.get('username')
     if not uid:continue
     event_id=value.get('event_id')
     if event_id and event_id in row['seen_ids']:continue
     if event_id:row['seen_ids']=(row['seen_ids']+[event_id])[-10000:]
     person=row['users'].setdefault(str(uid),{'user_id':str(uid),'name':user.get('name','Viewer'),'avatar_url':user.get('avatar_url',''),'comments':0})
     if value['kind']=='comment':person['comments']+=1
     row['gifts_status']='partial';row['gifts_error']=None;self.store.save(row)
    elif value.get('kind')=='error':
     row['gifts_error']=value.get('code','chat_unavailable');self.store.save(row);log.warning('gift-observer-error type=idn room=%s code=%s',row['room_id'],row['gifts_error'])
    elif value.get('kind')=='connected':row['gifts_status']='partial';row['gifts_error']=None;self.store.save(row);log.info('gift-connected type=idn room=%s',row['room_id'])
   except (json.JSONDecodeError,KeyError,ValueError,TypeError):log.warning('idn-event-invalid')
 async def bridge_send(self,value):
  if not self.bridge or self.bridge.returncode is not None:
   self.bridge=await asyncio.create_subprocess_exec('node',str(Path(__file__).with_name('idn-bridge.cjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL);self.bridge_task=asyncio.create_task(self.bridge_read());self.bridge.stdin.write((json.dumps({'action':'auth','value':self.config.get('idnAuth',{})})+'\n').encode());await self.bridge.stdin.drain()
  self.bridge.stdin.write((json.dumps(value)+'\n').encode());await self.bridge.stdin.drain()
 async def attach(self,row):
  jobs=[]
  if row['type']=='showroom':
   # Fetch recording permission before media tasks begin.
   try:info=await self.source('https://www.showroom-live.com/api/live/live_info',{'room_id':row['room_id']});row['screenshots_allowed']=not info.get('is_recording_prohibited',False)
   except Exception:row['screenshots_allowed']=False
   jobs.append(asyncio.create_task(self.sr_socket(row)))
  else:
   await self.bridge_send({'action':'add','id':row['data_id'],'url':'https://www.idn.app/'+row['url_key']+'/live/'+row['live_id']})
  jobs.extend([asyncio.create_task(self.frames(row)),asyncio.create_task(self.video(row))]);self.tasks[row['data_id']]=jobs
 async def close(self,row):
  row['completed']=True;row['date']['end']=iso(row['last_seen']);self.store.save(row)
  for task in self.tasks.get(row['data_id'],[])[:1]:
   if row['type']=='showroom':task.cancel()
  jobs=self.tasks.pop(row['data_id'],[])
  try:await asyncio.wait_for(asyncio.gather(*jobs,return_exceptions=True),35)
  except asyncio.TimeoutError:pass
  if row['type']=='idn':await self.bridge_send({'action':'remove','id':row['data_id']})
  self.store.save(row);log.info('session-completed id=%s frames=%s',row['data_id'],len(row['frames']))
 async def run(self):
  async with AsyncSession(impersonate='chrome',max_clients=12) as self.client:
   while not self.stop.is_set():
    try:
     self.config=await self.api('config')
     if self.bridge and self.bridge.returncode is None:await self.bridge_send({'action':'auth','value':self.config.get('idnAuth',{})})
     if not self.config['enabled'] and self.tasks:
      for id,jobs in self.tasks.items():
       if self.rows[id]['type']=='showroom':jobs[0].cancel()
       else:await self.bridge_send({'action':'remove','id':id})
      await asyncio.wait_for(asyncio.gather(*(t for jobs in self.tasks.values() for t in jobs),return_exceptions=True),35)
      self.tasks.clear()
     outcomes=await asyncio.gather(self.showroom(),self.idn(),return_exceptions=True) if self.config['enabled'] else [RuntimeError('disabled'),RuntimeError('disabled')]
     found={};ok={}
     for kind,result in zip(['showroom','idn'],outcomes):
      ok[kind]=not isinstance(result,Exception)
      if ok[kind]:found.update(result)
      else:log.warning('discovery-failed type=%s reason=%s',kind,type(result).__name__)
     for id,live in found.items():
      if id not in self.rows:
       if len(self.tasks)>=self.config['maxSessions']:continue
       self.new(live)
      row=self.rows[id]
      if row['completed']:continue
      row.update(stream=live.get('stream'),last_seen=time.time(),missing=0,viewers=max(row['viewers'],live['viewers']));row['date']['end']=iso();self.store.save(row)
      if id not in self.tasks:await self.attach(row)
      elif row['type']=='idn':await self.bridge_send({'action':'add','id':row['data_id'],'url':'https://www.idn.app/'+row['url_key']+'/live/'+row['live_id']})
     for id,row in list(self.rows.items()):
      if not row['completed'] and id not in found and ok.get(row['type']):
       row['missing']+=1;self.store.save(row)
       if row['missing']>=3:await self.close(row)
      try:
       await self.api('archive','PUT',self.payload(row))
       row['last_archive']=int(time.time()*1000);row['archive_error']=False;self.last_archive=row['last_archive']
       if row['completed']:self.last_completed=row['last_archive'];self.store.delete(id);self.rows.pop(id)
      except Exception as error:
       row['archive_error']=True;self.archive_errors+=1;log.warning('archive-pending id=%s reason=%s',id,type(error).__name__)
     await self.api('heartbeat','POST',{'active':len(self.tasks),'pending':sum(r['completed'] for r in self.rows.values()),'showroom_ok':ok['showroom'],'idn_ok':ok['idn'],'version':'1.1.0','telemetry':self.telemetry()})
    except Exception as error:log.warning('cycle-failed reason=%s',type(error).__name__)
    try:await asyncio.wait_for(self.stop.wait(),timeout=self.config.get('pollSeconds',30))
    except asyncio.TimeoutError:pass
   # Close video pipes gracefully and retain sessions for restart.
   all_tasks=[task for tasks in self.tasks.values() for task in tasks]
   try:await asyncio.wait_for(asyncio.gather(*all_tasks,return_exceptions=True),30)
   except asyncio.TimeoutError:
    for task in all_tasks:task.cancel()
   for row in self.rows.values():self.store.save(row)
   if self.bridge and self.bridge.returncode is None:self.bridge.terminate();await self.bridge.wait()

async def main():
 logging.basicConfig(level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
 collector=Collector();loop=asyncio.get_running_loop()
 for signum in [signal.SIGINT,signal.SIGTERM]:loop.add_signal_handler(signum,collector.stop.set)
 await collector.run()
if __name__=='__main__':asyncio.run(main())
