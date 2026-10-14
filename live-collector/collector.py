"""Persistent live observer. Media bytes go through RAM to Worker/R2, not local video files."""
import asyncio, collections, contextlib, hashlib, json, logging, math, os, re, signal, sqlite3, time
from pathlib import Path
from urllib.parse import urlparse,urljoin
from datetime import datetime, timezone
from curl_cffi.requests import AsyncSession
import websockets

log=logging.getLogger('collector')
def iso(seconds=None):return datetime.fromtimestamp(time.time() if seconds is None else seconds,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def epoch(value):
 if isinstance(value,str) and re.fullmatch(r'\d{10,16}',value):value=float(value)
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
  self.db=sqlite3.connect(path);self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('CREATE TABLE IF NOT EXISTS completed_sessions (id TEXT PRIMARY KEY, ended_at REAL NOT NULL)');self.db.execute('DELETE FROM completed_sessions WHERE ended_at<?',(time.time()-7*86400,));self.db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL)');self.db.execute('CREATE TABLE IF NOT EXISTS observer_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, event TEXT NOT NULL)');self.db.execute('CREATE INDEX IF NOT EXISTS observer_events_session ON observer_events(session_id,sequence)');self.db.commit()
 def save(self,row):
  self.db.execute('INSERT INTO sessions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',(row['data_id'],json.dumps(row)));self.db.execute('DELETE FROM observer_events WHERE session_id=? AND sequence<=?',(row['data_id'],row.get('_event_seq',0)));self.db.commit()
 def record_event(self,id,event):
  cursor=self.db.execute('INSERT INTO observer_events(session_id,event) VALUES(?,?)',(id,json.dumps(event,separators=(',',':'))));self.db.commit();return cursor.lastrowid
 def events(self,id):return [(seq,json.loads(event)) for seq,event in self.db.execute('SELECT sequence,event FROM observer_events WHERE session_id=? ORDER BY sequence',(id,))]
 def rows(self):return [json.loads(r[0]) for r in self.db.execute('SELECT value FROM sessions')]
 def delete(self,id):self.db.execute('INSERT OR REPLACE INTO completed_sessions VALUES(?,?)',(id,time.time()));self.db.execute('DELETE FROM sessions WHERE id=?',(id,));self.db.execute('DELETE FROM observer_events WHERE session_id=?',(id,));self.db.commit()
 def completed(self):return {r[0] for r in self.db.execute('SELECT id FROM completed_sessions')}

class Collector:
 def __init__(self):
  self.base=os.environ['COLLECTOR_API_URL'].rstrip('/');self.token=os.environ['COLLECTOR_TOKEN'];
  if urlparse(self.base).hostname=='apitest.jkt48connect.com':self.base='https://api.jkt48connect.app'
  self.stop=asyncio.Event();self.state=Path(os.environ.get('COLLECTOR_STATE_DIR','/var/lib/jkt48-live-collector'));self.state.mkdir(parents=True,exist_ok=True);os.chmod(self.state,0o700)
  self.store=Store(self.state/'state.sqlite');self.rows={r['data_id']:r for r in self.store.rows()};self.finished=self.store.completed();
  for saved in self.rows.values():
   for pending in saved.get('pending_uploads',{}).values():pending['active']=False
  self.tasks={};self.attach_jobs={};self.recover_tasks={};self.bridge=None;self.bridge_task=None;self.bridge_lock=asyncio.Lock();self.config={};self.client=None;self.frame_lock=asyncio.Semaphore(2);self.started=time.time();self.last_archive=0;self.last_completed=0;self.archive_errors=0;self._seen_indexes={};self.dirty=set();self.closing_jobs={};self.discovery_ok={'showroom':False,'idn':False}
  for row in self.rows.values():
   for sequence,event in self.store.events(row['data_id']):
    if sequence>row.get('_event_seq',0):
     try:self.handle_idn_event(row,event)
     except (KeyError,ValueError,TypeError):log.warning('idn-journal-event-invalid')
     row['_event_seq']=sequence
   self.store.save(row)
 def telemetry(self):
  sessions=[]
  for row in self.rows.values():
   sessions.append({'data_id':row['data_id'],'name':row['name'],'type':row['type'],'completed':row['completed'],'last_seen':int(row['last_seen']*1000),'last_screenshot':row['frames'][-1] if row['frames'] else 0,'screenshot_errors':row['screenshot_errors'],'screenshots_allowed':row['screenshots_allowed'],'stream_available':bool(row.get('stream')),'video':row.get('video_monitor',{'status':'waiting','bytes':0,'parts':0,'last_part':0,'errors':0}),'last_archive':row.get('last_archive',0),'archive_error':row.get('archive_error',False),'chat_status':row.get('chat_status','connecting'),'last_gift_event':row.get('last_gift_event'),'last_ranking':row.get('provider_ranking',{}).get('updated_at'),'ranking_error':row.get('ranking_error'),'observed_events':row.get('observed_events',0),'event_lag_ms':row.get('event_lag_ms'),'ranking_users':len(row.get('provider_ranking',{}).get('users',[])),'reported_gold':sum(u['gold'] for u in row.get('provider_ranking',{}).get('users',[])) if row.get('provider_ranking') else None,'observed_gold':sum((g['point'] or 0)*g['num'] for g in row.get('gifts',{}).values())})
  return {'pid':os.getpid(),'uptime_seconds':int(time.time()-self.started),'last_archive':self.last_archive,'last_completed':self.last_completed,'archive_errors':self.archive_errors,'sessions':sessions}
 async def api(self,path,method='GET',value=None,data=None):
  response=await self.client.request(method,self.base+'/internal/collector/'+path,headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json' if data is None else 'application/octet-stream'},json=value if data is None else None,data=data,timeout=50)
  if response.status_code!=200:raise RuntimeError('Worker rejected '+path.split('/')[0]+': HTTP '+str(response.status_code))
  return response.json()
 async def reliable_video_api(self,path,method='POST',value=None,data=None,monitor=None):
  attempt=0
  while True:
   try:
    result=await self.api(path,method,value,data)
    if monitor is not None:monitor['retrying']=False;monitor.pop('last_error',None)
    return result
   except asyncio.CancelledError:raise
   except Exception as error:
    attempt+=1
    if monitor is not None:monitor['retrying']=True;monitor['errors']=monitor.get('errors',0)+1;monitor['last_error']='worker_unavailable'
    if attempt==1 or attempt%10==0:log.warning('video-upload-retrying operation=%s attempt=%s',path.split('/')[1],attempt)
    if self.stop.is_set() and attempt>=2:raise
    await asyncio.sleep(min(2**min(attempt-1,4),15))
 async def recover_uploads(self,row):
  for run,upload in list(row.get('pending_uploads',{}).items()):
   if upload.get('active'):continue
   try:
    state=await self.api('video/state','POST',{'id':upload['id'],'data_id':row['data_id'],'run':run})
    if state.get('missing'):
     if upload.get('parts'):row['recording_loss']=row.get('recording_loss',0)+1
     row['pending_uploads'].pop(run,None);self.store.save(row);continue
    if not state.get('completed') and not state.get('parts'):
     await self.api('video/abort','POST',{'id':upload['id']});row['pending_uploads'].pop(run,None);self.store.save(row);continue
    result=state if state.get('completed') else await self.api('video/finish','POST',{'id':upload['id'],'data_id':row['data_id'],'run':run,'parts':state['parts']})
    recording={**upload['recording'],'url':result['url'],'bytes':result['bytes']}
    if not upload.get('complete'):recording.update(partial=True,index_available=False,duration_ms=None,interrupted=True)
    if not any(r['run']==run for r in row['recordings']):row['recordings'].append(recording)
    row['pending_uploads'].pop(run,None);self.store.save(row);log.info('video-recovered id=%s run=%s',row['data_id'],run)
   except asyncio.CancelledError:raise
   except Exception:log.warning('video-recovery-pending id=%s run=%s',row['data_id'],run)
 async def confirm_ended(self,row):
  progress=row.get('video_monitor',{}).get('last_progress',0)/1000
  if progress and time.time()-progress<75:return False
  try:
   if row['type']=='showroom':
    info=await self.source('https://www.showroom-live.com/api/live/live_info',{'room_id':row['room_id']})
    if info.get('is_live') is True:return False
    if info.get('is_live') is False:row['end_reason']='provider_confirmed';return True
   else:
    info=await self.api('live-status','POST',{'data_id':row['data_id'],'slug':row['live_id']})
    if info.get('status')=='live':return False
    if info.get('status')=='ended':row['end_reason']='provider_confirmed';return True
    if info.get('status')=='missing' and row['missing']>=6:row['end_reason']='provider_missing';return True
  except Exception:pass
  if row['missing']>=20 and (not progress or time.time()-progress>300):row['end_reason']='source_unavailable';return True
  return False
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
  async def resolve_stream(row):
   if not row.get('stream'):
    urls=await self.source('https://www.showroom-live.com/api/live/streaming_url',{'room_id':row['room_id']})
    options=[s for s in urls.get('streaming_url_list',[]) if s.get('type')=='hls' and stream_allowed(s.get('url',''))]
    if options:row['stream']=max(options,key=lambda s:s.get('quality',0))['url']
  await asyncio.gather(*(resolve_stream(row) for row in result.values()))
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
 def mark_seen(self,row,id):
  if not id:return True
  ids=self._seen_indexes.setdefault(row['data_id'],set(row.get('seen_ids',[])))
  if id in ids:return False
  ids.add(id);row.setdefault('seen_ids',[]).append(id)
  if len(row['seen_ids'])>10000:ids.discard(row['seen_ids'].pop(0))
  return True
 def gift(self,row,event,id=None,persist=True):
  uid=str(event['user_id']);gid=str(event['gift_id']);num=int(event.get('num',1));amount=event.get('point');when=epoch(event.get('date'))
  if amount is not None:
   amount=float(amount)
   if not math.isfinite(amount) or amount<0:return False
  if num<1 or num>100000 or not self.mark_seen(row,id):return False
  user=row['users'].setdefault(uid,{'user_id':uid,'name':event.get('name','Viewer'),'comments':0})
  for field in ['avatar_id','avatar_url']:
   if event.get(field) is not None:user[field]=event[field]
  key=uid+'|'+gid+'|'+str(int(when//60))
  if key in row['gifts'] and row['gifts'][key]['point']!=amount:key+='|'+str(amount)
  item=row['gifts'].setdefault(key,{'user_id':uid,'gift_id':event['gift_id'],'num':0,'date':iso(when),'point':amount})
  item['send_count']=item.get('send_count',0)+1 if not item['num'] or 'send_count' in item else None
  if item.get('send_count') is None:item.pop('send_count',None)
  item['num']+=num
  if amount is None:row['gifts_status']='partial'
  if persist:self.store.save(row)
  return True

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
  if row.get('provider_ranking'):value['provider_ranking']=row['provider_ranking']
  value.update(users=list(row['users'].values()),gift_log=list(users.values()),catalog=list(row['catalog'].values()),comments=sum(u.get('comments',0) for u in row['users'].values()),recordings=row['recordings'],capture={'status':'completed' if row['completed'] else 'live','observed_since':row['observed'],'gifts_status':row['gifts_status'],'gifts_source':'showroom-websocket' if row['type']=='showroom' else 'idn-observed-chat','gifts_error':row.get('gifts_error'),'last_gift_event':row.get('last_gift_event'),'ranking_updated_at':row.get('provider_ranking',{}).get('updated_at'),'ranking_error':row.get('ranking_error'),'observed_events':row.get('observed_events',0),'event_lag_ms':row.get('event_lag_ms'),'chat_status':row.get('chat_status','connecting'),'end_reason':row.get('end_reason'),'pending_recordings':len(row.get('pending_uploads',{})),'recording_loss':row.get('recording_loss',0),'disconnects':row['disconnects'],'screenshot_errors':row['screenshot_errors'],'screenshots_allowed':row['screenshots_allowed']})
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
 async def stream_window_start(self,url):
  try:
   for _ in range(2):
    if not stream_allowed(url):return None
    response=await self.client.get(url,timeout=5,allow_redirects=False)
    if response.status_code!=200:return None
    lines=response.content[:65536].decode(errors='replace').splitlines()
    for line in lines:
     if line.startswith('#EXT-X-PROGRAM-DATE-TIME:'):return datetime.fromisoformat(line.split(':',1)[1].replace('Z','+00:00')).timestamp()
    variant=next((lines[i+1].strip() for i,line in enumerate(lines[:-1]) if line.startswith('#EXT-X-STREAM-INF:')),None)
    if not variant:return None
    url=urljoin(url,variant)
  except Exception:return None
  return None
 async def video(self,row):
  # One fragmented MP4 per connection, multipart chunks held only in memory.
  while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
   if not self.config.get('recordVideo',True) or not row.get('stream') or not row['screenshots_allowed']:await asyncio.sleep(5);continue
   proc=None;progress_task=None;upload=None;parts=[];bytes_sent=0;buffer=bytearray();run=str(int(time.time()*1000))
   monitor={'status':'starting','bytes':0,'parts':0,'last_part':0,'errors':row.get('video_monitor',{}).get('errors',0)};row['video_monitor']=monitor
   try:
    upload=await self.reliable_video_api('video/start',value={'data_id':row['data_id'],'run':run},monitor=monitor)
    window_start=await self.stream_window_start(row['stream']);media_start=window_start if window_start is not None else time.time()
    pending={'id':upload['id'],'parts':[],'active':True,'complete':False,'recording':{'run':run,'started_at':iso(media_start),'timing_source':'playlist' if window_start is not None else 'wall_clock','partial':True,'bytes':0}};row.setdefault('pending_uploads',{})[run]=pending;self.store.save(row)
    proc=await asyncio.create_subprocess_exec(*video_command(row['stream']),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
    monitor['status']='recording'
    async def read_progress():
     while line:=await proc.stderr.readline():
      if line.startswith(b'out_time_us='):
       with contextlib.suppress(ValueError):monitor['duration_ms']=max(0,int(line.split(b'=',1)[1])//1000);monitor['last_progress']=int(time.time()*1000)
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
     result=await self.reliable_video_api(f'video/part/{upload["id"]}/{len(parts)+1}','PUT',data=body,monitor=monitor);parts.append(result['part']);bytes_sent+=len(body);monitor.update(status='recording',bytes=bytes_sent,parts=len(parts),last_part=int(time.time()*1000));pending.update(parts=parts.copy());pending['recording'].update(bytes=bytes_sent);self.store.save(row)
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
    if parts and bytes_sent>4096:
     monitor['status']='finalizing'
     pending.update(complete=True);pending['recording'].update(bytes=bytes_sent,duration_ms=monitor.get('duration_ms',0),partial=proc.returncode!=0 or not row['completed'] or media_start>epoch(row['date']['start'])+10);self.store.save(row)
     result=await self.reliable_video_api('video/finish',value={'id':upload['id'],'data_id':row['data_id'],'run':run,'parts':parts},monitor=monitor);row['recordings'].append({**pending['recording'],'url':result['url'],'bytes':result.get('bytes',bytes_sent)});row['pending_uploads'].pop(run,None);self.store.save(row);log.info('video-uploaded id=%s bytes=%s',row['data_id'],bytes_sent)
    else:
     monitor['errors']+=1;monitor['status']='error';await self.api('video/abort','POST',{'id':upload['id']});row['pending_uploads'].pop(run,None)
   except asyncio.CancelledError:raise
   except Exception as error:
    monitor['errors']+=1;monitor['status']='error'
    log.warning('video-failed id=%s reason=%s',row['data_id'],str(error) if isinstance(error,RuntimeError) else type(error).__name__)
    if upload and run in row.get('pending_uploads',{}):row['pending_uploads'][run]['active']=False;self.store.save(row)
   finally:
    if proc and proc.returncode is None:proc.kill();await proc.wait()
    if progress_task and not progress_task.done():
     progress_task.cancel()
     with contextlib.suppress(asyncio.CancelledError):await progress_task
    if run in row.get('pending_uploads',{}):row['pending_uploads'][run]['active']=False;self.store.save(row)
    if monitor['status']!='error':monitor['status']='completed' if row['completed'] else 'waiting'
   if not row['completed']:await asyncio.sleep(2)
 def handle_idn_event(self,row,value):
  kind=value.get('kind')
  if kind in ['gift','comment','user']:
   user=value.get('user') or {};uid=user.get('uuid') or user.get('username')
   if not uid:return
   if kind=='gift':
    gift=value['gift'];gid=gift.get('slug')
    if not gid:return
    amount=gift.get('gold');old=row['catalog'].get(gid,{})
    if amount is None:amount=old.get('point')
    row['catalog'][gid]={'id':gid,'name':gift.get('name') or old.get('name','Gift'),'point':amount,'free':False,'img':gift.get('image_url') or old.get('img',''),**({'gold':amount} if amount is not None else {})}
    if not self.gift(row,{'user_id':uid,'name':user.get('name','Viewer'),'avatar_url':user.get('avatar_url',''),'gift_id':gid,'num':gift.get('quantity') or gift.get('num') or 1,'point':amount,'date':value.get('event_time') or time.time()},value.get('event_id'),persist=False):return
    row['last_gift_event']=iso();row['gifts_error']=None
   else:
    if not self.mark_seen(row,value.get('event_id')):return
    person=row['users'].setdefault(str(uid),{'user_id':str(uid),'name':user.get('name','Viewer'),'avatar_url':user.get('avatar_url',''),'comments':0})
    if kind=='comment':person['comments']+=1
   row['observed_events']=row.get('observed_events',0)+1;row['gifts_status']='partial';row['gifts_error']=None
   if value.get('event_time'):row['event_lag_ms']=max(0,int((time.time()-epoch(value['event_time']))*1000))
  elif kind=='error':
   if row['completed']:return
   if row.get('chat_status')=='connected':row['disconnects']+=1
   row['chat_status']='queued' if value.get('code')=='chat_capacity' else 'reconnecting';row['gifts_error']=value.get('code','chat_unavailable');log.warning('gift-observer-error type=idn room=%s code=%s',row['room_id'],row['gifts_error'])
  elif kind=='connected':
   row['chat_status']='closed' if row['completed'] else 'connected';row['gifts_status']='partial';row['gifts_error']=None;log.info('gift-connected type=idn room=%s',row['room_id'])
 async def bridge_read(self,bridge=None):
  stream=(bridge or self.bridge).stdout
  while line:=await stream.readline():
   try:
    value=json.loads(line);row=self.rows.get(value.get('id'))
    if not row:continue
    # Journal a compact event before updating counters, then checkpoint full state in batches.
    sequence=self.store.record_event(row['data_id'],value);self.handle_idn_event(row,value);row['_event_seq']=sequence;self.dirty.add(row['data_id'])
   except (json.JSONDecodeError,KeyError,ValueError,TypeError):log.warning('idn-event-invalid')
 async def checkpoint_loop(self):
  while not self.stop.is_set():
   for id in list(self.dirty):
    row=self.rows.get(id)
    if row:self.store.save(row)
    self.dirty.discard(id)
   await self.pause(.75)
 async def pause(self,seconds):
  try:await asyncio.wait_for(self.stop.wait(),timeout=seconds)
  except asyncio.TimeoutError:pass
 async def update_idn_ranking(self,row):
  try:
   ranking=await self.api('idn/supporters','POST',{'slug':row['live_id']})
   if not ranking.get('users') and row.get('provider_ranking',{}).get('users'):row['ranking_error']='ranking_empty_snapshot';return False
   row['provider_ranking']=ranking;row['ranking_error']=None;self.store.save(row);log.info('ranking-updated id=%s users=%s gold=%s',row['data_id'],len(ranking['users']),sum(u['gold'] for u in ranking['users']));return True
  except asyncio.CancelledError:raise
  except Exception:row['ranking_error']='ranking_unavailable';self.store.save(row);return False
 async def idn_rankings(self,row):
  while not row['completed'] and not self.stop.is_set() and self.config.get('enabled',True):
   await self.update_idn_ranking(row)
   for _ in range(20):
    if row['completed'] or self.stop.is_set():break
    await self.pause(1)
 async def bridge_send(self,value):
  async with self.bridge_lock:
   if not self.bridge or self.bridge.returncode is not None:
    self.bridge=await asyncio.create_subprocess_exec('node',str(Path(__file__).with_name('idn-bridge.cjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL);self.bridge_task=asyncio.create_task(self.bridge_read(self.bridge));self.bridge.stdin.write((json.dumps({'action':'auth','value':self.config.get('idnAuth',{})})+'\n').encode());await self.bridge.stdin.drain()
   self.bridge.stdin.write((json.dumps(value)+'\n').encode());await self.bridge.stdin.drain()
 async def attach(self,row):
  jobs=[]
  if row['type']=='showroom':
   # Fetch recording permission before media tasks begin.
   try:info=await self.source('https://www.showroom-live.com/api/live/live_info',{'room_id':row['room_id']});row['screenshots_allowed']=not info.get('is_recording_prohibited',False)
   except Exception:row['screenshots_allowed']=False;log.warning('permission-check-retry room=%s',row['room_id']);return
   jobs.append(asyncio.create_task(self.sr_socket(row)))
  else:
   await self.bridge_send({'action':'add','id':row['data_id'],'url':'https://www.idn.app/'+row['url_key']+'/live/'+row['live_id']})
   jobs.append(asyncio.create_task(self.idn_rankings(row)))
  if row['completed'] or self.stop.is_set():return
  jobs.extend([asyncio.create_task(self.frames(row)),asyncio.create_task(self.video(row))]);self.tasks[row['data_id']]=jobs
 async def close(self,row):
  row['completed']=True;row['chat_status']='closed';row['gifts_error']=None if row.get('gifts_error')=='chat_disconnected' else row.get('gifts_error');row['date']['end']=iso(min(time.time(),max(row['last_seen'],row.get('video_monitor',{}).get('last_progress',0)/1000)));self.store.save(row)
  for task in self.tasks.get(row['data_id'],[])[:1]:
   if row['type']=='showroom':task.cancel()
  jobs=self.tasks.pop(row['data_id'],[])
  try:await asyncio.wait_for(asyncio.gather(*jobs,return_exceptions=True),35)
  except asyncio.TimeoutError:pass
  if row['type']=='idn':
   await self.bridge_send({'action':'remove','id':row['data_id']})
   await self.update_idn_ranking(row)
   await self.pause(2)
   await self.update_idn_ranking(row)
  self.store.save(row);log.info('session-completed id=%s frames=%s',row['data_id'],len(row['frames']))
 async def discover_once(self,kind):
  try:
   found=await (self.showroom() if kind=='showroom' else self.idn());self.discovery_ok[kind]=True
  except asyncio.CancelledError:raise
  except Exception as error:self.discovery_ok[kind]=False;log.warning('discovery-failed type=%s reason=%s',kind,type(error).__name__);return
  for id,live in found.items():
   if id in self.finished:continue
   row=self.rows.get(id) or self.new(live)
   if row['completed']:continue
   row.update(stream=live.get('stream'),last_seen=time.time(),missing=0,viewers=max(row['viewers'],live['viewers']));row['date']['end']=iso();self.store.save(row)
   if id not in self.tasks and (id not in self.attach_jobs or self.attach_jobs[id].done()):self.attach_jobs[id]=asyncio.create_task(self.attach(row))
   elif row['type']=='idn':await self.bridge_send({'action':'add','id':row['data_id'],'url':'https://www.idn.app/'+row['url_key']+'/live/'+row['live_id']})
  for id,row in list(self.rows.items()):
   if row['type']!=kind or row['completed'] or id in found:continue
   row['missing']+=1;self.store.save(row)
   if row['missing']>=3 and (id not in self.closing_jobs or self.closing_jobs[id].done()) and await self.confirm_ended(row):self.closing_jobs[id]=asyncio.create_task(self.close(row))
 async def discovery_loop(self,kind):
  while not self.stop.is_set():
   if self.config.get('enabled',True):await self.discover_once(kind)
   await self.pause(max(5,min(15,self.config.get('pollSeconds',15))))
 async def archive_once(self):
  limit=asyncio.Semaphore(2)
  async def archive(id,row):
   if id in self.closing_jobs and not self.closing_jobs[id].done():return
   if row.get('pending_uploads') and (id not in self.recover_tasks or self.recover_tasks[id].done()):self.recover_tasks[id]=asyncio.create_task(self.recover_uploads(row))
   async with limit:
    try:
     payload=self.payload(row);event_seq=row.get('_event_seq',0);runs=[(r['run'],r['bytes']) for r in row['recordings']]
     await self.api('archive','PUT',payload);row['last_archive']=int(time.time()*1000);row['archive_error']=False;self.last_archive=row['last_archive']
     if payload['capture']['status']=='completed' and not payload['capture']['pending_recordings'] and row['completed'] and not row.get('pending_uploads') and event_seq==row.get('_event_seq',0) and runs==[(r['run'],r['bytes']) for r in row['recordings']] and not (id in self.closing_jobs and not self.closing_jobs[id].done()):
      self.last_completed=row['last_archive'];self.store.delete(id);self.finished.add(id);self.rows.pop(id,None);self._seen_indexes.pop(id,None);self.dirty.discard(id)
    except asyncio.CancelledError:raise
    except Exception as error:row['archive_error']=True;self.archive_errors+=1;log.warning('archive-pending id=%s reason=%s',id,type(error).__name__)
  await asyncio.gather(*(archive(id,row) for id,row in list(self.rows.items())))
 async def archive_loop(self):
  while not self.stop.is_set():
   await self.archive_once();await self.pause(5)
 async def heartbeat_loop(self):
  while not self.stop.is_set():
   try:await self.api('heartbeat','POST',{'active':len(self.tasks),'pending':sum(r['completed'] for r in self.rows.values()),'showroom_ok':self.discovery_ok['showroom'],'idn_ok':self.discovery_ok['idn'],'version':'1.2.0','telemetry':self.telemetry()})
   except Exception:log.warning('heartbeat-pending')
   await self.pause(15)
 async def config_loop(self):
  while not self.stop.is_set():
   await self.pause(60)
   if self.stop.is_set():break
   try:
    self.config=await self.api('config')
    if self.bridge and self.bridge.returncode is None:await self.bridge_send({'action':'auth','value':self.config.get('idnAuth',{})});await self.bridge_send({'action':'limits','value':self.config.get('maxSessions',16)})
    if not self.config['enabled'] and self.tasks:
     for id,jobs in list(self.tasks.items()):
      if self.rows[id]['type']=='showroom':jobs[0].cancel()
      else:await self.bridge_send({'action':'remove','id':id})
     try:await asyncio.wait_for(asyncio.gather(*(t for jobs in self.tasks.values() for t in jobs),return_exceptions=True),35)
     finally:self.tasks.clear()
   except Exception:log.warning('configuration-refresh-pending')
 async def run(self):
  async with AsyncSession(impersonate='chrome',max_clients=48) as self.client:
   while not self.stop.is_set():
    try:self.config=await self.api('config');break
    except Exception:log.warning('configuration-start-pending');await self.pause(5)
   if self.stop.is_set():return
   workers=[asyncio.create_task(self.discovery_loop(kind)) for kind in ['showroom','idn']]+[asyncio.create_task(self.archive_loop()),asyncio.create_task(self.heartbeat_loop()),asyncio.create_task(self.config_loop()),asyncio.create_task(self.checkpoint_loop())]
   await self.stop.wait()
   for worker in workers:worker.cancel()
   await asyncio.gather(*workers,return_exceptions=True)
   all_tasks=[task for tasks in self.tasks.values() for task in tasks]+[task for group in [self.recover_tasks,self.attach_jobs,self.closing_jobs] for task in group.values() if not task.done()]
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
