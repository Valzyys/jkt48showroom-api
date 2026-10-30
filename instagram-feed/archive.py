from member_overrides import apply_member_overrides
"""Permanent local archive. The service serializes every connection access with lock."""
import datetime,json,re,threading,time
from store import Store
from parser import HANDLE

def iso(value):
 return datetime.datetime.fromtimestamp(value,datetime.timezone.utc).isoformat().replace('+00:00','Z') if value else None

class APIError(Exception):
 def __init__(self,message,status=400):self.status=status;super().__init__(message)

class Archive(Store):
 def __init__(self,file):
  super().__init__(file);self.lock=threading.RLock()
  self.db.executescript('''
CREATE TABLE IF NOT EXISTS members(member TEXT PRIMARY KEY,username TEXT,document TEXT NOT NULL,active INTEGER DEFAULT 1);
CREATE UNIQUE INDEX IF NOT EXISTS member_handle ON members(lower(username)) WHERE username IS NOT NULL AND active=1;
CREATE TABLE IF NOT EXISTS schedule(username TEXT PRIMARY KEY,next_check REAL DEFAULT 0,failures INTEGER DEFAULT 0,last_attempt REAL);
CREATE TABLE IF NOT EXISTS meta(name TEXT PRIMARY KEY,document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(post_id TEXT,kind TEXT,state TEXT NOT NULL DEFAULT 'pending',url TEXT,bytes INTEGER,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_try REAL NOT NULL DEFAULT 0,PRIMARY KEY(post_id,kind));
CREATE TABLE IF NOT EXISTS details(post_id TEXT PRIMARY KEY,next_try REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,success REAL);
CREATE INDEX IF NOT EXISTS posts_username ON posts(username);
CREATE TABLE IF NOT EXISTS profile_data(username TEXT PRIMARY KEY,document TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS post_shortcode ON posts(json_extract(document,'$.shortcode'));
INSERT OR IGNORE INTO details(post_id) SELECT id FROM posts;
''')
 def meta(self,name,value=None):
  if value is not None:
   with self.db:self.db.execute('INSERT INTO meta VALUES(?,?) ON CONFLICT(name)DO UPDATE SET document=excluded.document',(name,json.dumps(value)))
   return value
  r=self.db.execute('SELECT document FROM meta WHERE name=?',(name,)).fetchone();return json.loads(r[0])if r else None
 def directory(self,rows):
  rows=apply_member_overrides(rows)
  if not rows:raise ValueError('empty_directory')
  seen=set()
  for r in rows:
   if not re.fullmatch(r'[a-z0-9-]{1,100}',r['member']):raise ValueError('invalid_member')
   u=r.get('username')
   if u and (not HANDLE.fullmatch(u)or u.lower()in seen):raise ValueError('invalid_duplicate_handle')
   if u:seen.add(u.lower())
  with self.db:
   self.db.execute('UPDATE members SET active=0')
   for r in rows:
    self.db.execute('INSERT INTO members VALUES(?,?,?,1) ON CONFLICT(member)DO UPDATE SET username=excluded.username,document=excluded.document,active=1',(r['member'],r.get('username'),json.dumps(r,ensure_ascii=False)))
    if r.get('username'):self.db.execute('INSERT OR IGNORE INTO schedule(username)VALUES(?)',(r['username'],))
 def save(self,result):
  # Profile embeds may attribute the same collaboration to multiple profiles.
  # Keep its archived owner; one shared post must not reject the whole profile.
  posts=[];shared=0
  for p in result['posts']:
   owner=self.db.execute('SELECT username FROM posts WHERE id=?',(p['id'],)).fetchone()
   if owner and owner['username']!=result['username']:shared+=1;continue
   posts.append(p)
  result={**result,'posts':posts,'excluded_other_authors':result.get('excluded_other_authors',0)+shared}
  old={r['id']:json.loads(r['document']).get('media',{})for r in self.db.execute('SELECT id,document FROM posts WHERE username=?',(result['username'],))}
  receipt=super().save(result)
  receipt['excluded_existing_owners']=shared
  # Re-polling a source changes metadata, never resets completed media or its URLs.
  with self.db:
   self.db.execute('INSERT INTO profile_data VALUES(?,?) ON CONFLICT(username)DO UPDATE SET document=excluded.document',(result['username'],json.dumps({**result['profile'],'excluded_other_authors':result.get('excluded_other_authors',0)},ensure_ascii=False)))
   for p in result['posts']:
    self.db.execute('INSERT OR IGNORE INTO details(post_id)VALUES(?)',(p['id'],))
    for kind,key in [('thumbnail','thumbnail'),('video','play_url')]:
     source=p.get('media',{}).get(key)
     if source and source!=old.get(p['id'],{}).get(key):self.db.execute("UPDATE assets SET next_try=0,attempts=0,error=NULL WHERE post_id=? AND kind=? AND state='pending'",(p['id'],kind))
  return receipt
 def due(self):
  return self.db.execute('SELECT s.* FROM schedule s JOIN members m ON lower(m.username)=lower(s.username) AND m.active=1 WHERE s.next_check<=? ORDER BY s.next_check,s.username LIMIT 1',(time.time(),)).fetchone()
 def scheduled(self,name,delay,failed=False):
  with self.db:self.db.execute('UPDATE schedule SET next_check=?,last_attempt=?,failures=CASE WHEN ? THEN failures+1 ELSE 0 END WHERE username=?',(time.time()+delay,time.time(),int(failed),name))
 def resolve(self,query):
  if not query:return None
  value=query.lstrip('@').casefold();rows=self.db.execute('SELECT * FROM members').fetchall()
  exact=[r for r in rows if value in (r['member'].casefold(),str(r['username']or'').casefold())]
  if not exact:exact=[r for r in rows if value==str(json.loads(r['document']).get('name','')).casefold()]
  if len(exact)!=1:raise APIError('Member tidak ditemukan atau ambigu',404)
  return exact[0]
 def public_post(self,row):
  p=json.loads(row['document']);member=self.db.execute('SELECT document FROM members WHERE lower(username)=lower(?) LIMIT 1',(row['username'],)).fetchone()
  p['member']=json.loads(member[0])if member else {'username':row['username']};p['first_seen_at']=iso(row['first_seen']);p['last_observed_at']=iso(row['last_seen'])
  media=p.get('media',{});assets={r['kind']:dict(r)for r in self.db.execute('SELECT * FROM assets WHERE post_id=?',(p['id'],))}
  def asset(kind):
   a=assets.get(kind,{});return {'status':a.get('state','pending'),'url':a.get('url')if a.get('state')=='ready' else None,'bytes':a.get('bytes'),'reason':a.get('error')}
  media['thumbnail']=asset('thumbnail');media['video']=asset('video')if media.get('play_url')or media.get('type')=='video'or'video'in assets else None
  images=media.get('images');media['images']=[asset('image-'+str(i))for i in range(len(images))]if images else None
  if media.get('items'):
   media['items']=[{'id':v['id'],'type':v['type'],'width':v.get('width'),'height':v.get('height'),'thumbnail':asset('image-'+str(i)),'video':asset('video-'+str(i))if v.get('play_url')or v.get('type')=='video'else None}for i,v in enumerate(media['items'])]
  media.pop('play_url',None);p.get('author',{}).pop('avatar',None)
  media['storage']='cloudflare-r2';p['media']=media
  return p
 def status(self):
  now=time.time();heartbeat=self.meta('heartbeat');counts=self.counts();members=self.db.execute('SELECT count(*) FROM members WHERE active=1').fetchone()[0];handles=self.db.execute('SELECT count(*) FROM members WHERE active=1 AND username IS NOT NULL').fetchone()[0]
  return {'collector_online':bool(heartbeat and now-heartbeat<120),'heartbeat_at':iso(heartbeat),'members':members,'tracked_accounts':handles,'accounts_without_published_handle':members-handles,**counts,'last_success_at':iso(self.meta('last_success')),'next_source_request_at':iso(self.meta('next_request')),'source_backoff_until':iso(self.meta('cooldown')),'last_error':self.meta('error'),'directory_error':self.meta('directory_error'),'directory_updated_at':iso(self.meta('directory_success')),'coverage':'limited-public-profile-window','history_complete':False,'graph_api_used':False,'login_used':bool(self.meta('session_last_success')),'session_auth':self.meta('session_auth')or{'configured':False,'state':'not_configured'},'min_profile_interval_seconds':900,'source_gap_seconds':[20,35],'asset_counts':{r[0]:r[1]for r in self.db.execute('SELECT state,count(*) FROM assets GROUP BY state')}}
 def members(self):
  rows=self.db.execute('SELECT m.*,p.success,p.error,p.attempts,s.next_check,pd.document profile_meta FROM members m LEFT JOIN profiles p ON lower(p.username)=lower(m.username) LEFT JOIN schedule s ON lower(s.username)=lower(m.username) LEFT JOIN profile_data pd ON lower(pd.username)=lower(m.username) WHERE m.active=1 ORDER BY m.member').fetchall()
  return {'members':[{**json.loads(r['document']),'profile_url':'https://www.instagram.com/'+r['username']+'/'if r['username']else None,'profile':json.loads(r['profile_meta'])if r['profile_meta']else None,'last_success_at':iso(r['success']),'next_check_at':iso(r['next_check']),'last_error':r['error'],'attempts':r['attempts']or 0,'coverage_gap_possible':not r['success']or time.time()-r['success']>3600}for r in rows],'total_count':len(rows)}
 @staticmethod
 def number(query,name,default,minimum,maximum):
  value=str(query.get(name,default))
  if not re.fullmatch(r'\d{1,22}',value)or not minimum<=int(value)<=maximum:raise APIError('Parameter '+name+' tidak valid')
  return int(value)
 def read(self,path,query):
  if path=='/status':return self.status()
  if path=='/members':return self.members()
  if path.startswith('/profile/'):
   member=self.resolve(path[len('/profile/'):]);profile=self.db.execute('SELECT document FROM profile_data WHERE username=?',(member['username'],)).fetchone()
   return {'member':json.loads(member['document']),'profile':json.loads(profile[0])if profile else None}
  limit=self.number(query,'limit',25,1,100);member=self.resolve(query.get('member'));where=[];params=[]
  if member:
   where.append('lower(p.username)=lower(?)');params.append(member['username']or'')
  if path=='/updates':
   after=self.number(query,'after',0,0,9223372036854775807);condition=' AND '.join(['u.cursor>?',*where]);rows=self.db.execute('SELECT u.cursor,u.detected_at,p.* FROM updates u JOIN posts p ON p.id=u.post_id WHERE '+condition+' ORDER BY u.cursor LIMIT ?', [after,*params,limit+1]).fetchall();selected=rows[:limit];latest=self.db.execute('SELECT COALESCE(max(cursor),0) FROM updates').fetchone()[0]
   return {'updates':[{'cursor':str(r['cursor']),'type':'new_instagram_post','detected_at':iso(r['detected_at']),'post':self.public_post(r)}for r in selected],'next_cursor':str(selected[-1]['cursor']if selected else after),'latest_cursor':str(latest),'has_more':len(rows)>limit,'retention_gap':False}
  detail=re.fullmatch(r'/post/([A-Za-z0-9_-]{5,24})',path)
  if detail:
   row=self.db.execute("SELECT * FROM posts WHERE id=? OR json_extract(document,'$.shortcode')=?",(detail[1],detail[1])).fetchone()
   if not row:raise APIError('Posting belum terarsip',404)
   return {'post':self.public_post(row)}
  if path not in('/posts','/search'):raise APIError('Endpoint not found',404)
  before=query.get('before')
  if before:
   self.number(query,'before',0,10**14,10**22-1);where.append('(length(p.id)<? OR (length(p.id)=? AND p.id<?))');params.extend([len(before),len(before),before])
  if path=='/search':
   q=query.get('q','').strip()
   if not 1<=len(q)<=200:raise APIError('q harus 1–200 karakter')
   where.append("instr(lower(json_extract(p.document,'$.text')),lower(?))>0");params.append(q)
  condition=' WHERE '+' AND '.join(where)if where else''
  rows=self.db.execute('SELECT p.* FROM posts p'+condition+' ORDER BY length(p.id) DESC,p.id DESC LIMIT ?',[*params,limit+1]).fetchall();selected=rows[:limit]
  return {'posts':[self.public_post(r)for r in selected],'next_cursor':selected[-1]['id']if len(rows)>limit and selected else None,'has_more':len(rows)>limit,'coverage':'limited-public-profile-window','history_complete':False}
