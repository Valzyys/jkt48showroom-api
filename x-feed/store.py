from member_overrides import apply_member_overrides
import contextlib,datetime as dt,json,sqlite3,time
from pathlib import Path

_UNSET=object()

class Store:
 def __init__(self,path):
  self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True)
  with self.connect() as db:
   db.executescript('''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS members(id TEXT PRIMARY KEY,name TEXT NOT NULL,handle TEXT NOT NULL,profile TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,checked REAL,success REAL,error TEXT,next_check REAL NOT NULL DEFAULT 0,watermark TEXT,initialized INTEGER NOT NULL DEFAULT 0,gap INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS tweets(id TEXT PRIMARY KEY,member_id TEXT NOT NULL,published TEXT NOT NULL,document TEXT NOT NULL,first_seen REAL NOT NULL,last_seen REAL NOT NULL);
CREATE INDEX IF NOT EXISTS tweets_member ON tweets(member_id,published DESC,id DESC);
CREATE TABLE IF NOT EXISTS updates(seq INTEGER PRIMARY KEY AUTOINCREMENT,tweet_id TEXT NOT NULL UNIQUE,member_id TEXT NOT NULL,detected REAL NOT NULL,document TEXT);
CREATE TABLE IF NOT EXISTS metadata(name TEXT PRIMARY KEY,value TEXT NOT NULL);
''')
   if 'document' not in {row['name'] for row in db.execute('PRAGMA table_info(updates)')}:db.execute('ALTER TABLE updates ADD COLUMN document TEXT')
 @contextlib.contextmanager
 def connect(self):
  db=sqlite3.connect(self.path,timeout=5);db.row_factory=sqlite3.Row
  try:
   yield db;db.commit()
  finally:db.close()
 def meta(self,key,value=_UNSET):
  with self.connect() as db:
   if value is not _UNSET:db.execute('INSERT INTO metadata VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value',(key,json.dumps(value)));return value
   row=db.execute('SELECT value FROM metadata WHERE name=?',(key,)).fetchone();return json.loads(row[0]) if row else None
 def sync_members(self,items):
  items=apply_member_overrides(items)
  with self.connect() as db:
   db.execute('UPDATE members SET enabled=0')
   for item in items:
    if not item.get('username'):
     previous=db.execute('SELECT handle,profile FROM members WHERE id=?',(item['id'],)).fetchone()
     if previous and previous['handle']:
      item={**item,'username':previous['handle'],'url':'https://x.com/'+previous['handle']}
    db.execute('INSERT INTO members(id,name,handle,profile,enabled) VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,handle=excluded.handle,profile=excluded.profile,enabled=1,next_check=CASE WHEN members.handle IS NOT excluded.handle THEN 0 ELSE members.next_check END,error=CASE WHEN members.handle IS NOT excluded.handle THEN NULL ELSE members.error END',(item['id'],item['name'],item.get('username') or '',json.dumps(item)))
 def set_handle(self,ident,handle):
  with self.connect() as db:
   row=db.execute('SELECT * FROM members WHERE id=?',(ident,)).fetchone();profile=json.loads(row['profile']);profile.update(username=handle,url='https://x.com/'+handle,username_source='jkt48-official-profile')
   db.execute('UPDATE members SET handle=?,profile=? WHERE id=?',(handle,json.dumps(profile),ident))
   return db.execute('SELECT * FROM members WHERE id=?',(ident,)).fetchone()
 def members(self):
  with self.connect() as db:
   rows=db.execute('SELECT * FROM members WHERE enabled=1 ORDER BY name').fetchall()
  return [{**json.loads(row['profile']),'last_checked_at':stamp(row['checked']),'last_success_at':stamp(row['success']),'last_error':row['error'],'next_check_at':stamp(row['next_check']),'baseline_complete':bool(row['initialized']),'coverage_gap_possible':bool(row['gap'])} for row in rows]
 def resolve(self,value):
  candidates=[]
  for member in self.members():
   if str(value).casefold() in {str(x).casefold() for x in [member['id'],member['name'],member['username'],*member.get('nicknames',[])] if x}:candidates.append(member)
  if len(candidates)>1:raise ValueError('Nama member ambigu; gunakan slug atau username')
  return candidates[0] if candidates else None
 def due(self):
  with self.connect() as db:return db.execute('SELECT * FROM members WHERE enabled=1 AND next_check<=? ORDER BY coalesce(checked,0),id LIMIT 1',(time.time(),)).fetchone()
 def save_tweets(self,member,items,interval):
  now=time.time();new=[];watermark=int(member['watermark'] or 0)
  with self.connect() as db:
   for item in items:
    old=db.execute('SELECT first_seen FROM tweets WHERE id=?',(item['id'],)).fetchone()
    document={**item,'member':json.loads(member['profile']),'first_seen_at':stamp(old['first_seen'] if old else now),'last_observed_at':stamp(now)}
    db.execute('INSERT INTO tweets VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document,last_seen=excluded.last_seen',(item['id'],member['id'],item['created_at'],json.dumps(document),old['first_seen'] if old else now,now))
    if not old and member['initialized'] and int(item['id'])>watermark:
     db.execute('INSERT OR IGNORE INTO updates(tweet_id,member_id,detected,document) VALUES(?,?,?,?)',(item['id'],member['id'],now,json.dumps(document)));new.append(item['id'])
   maximum=str(max([watermark,*[int(item['id']) for item in items]]))
   gap=member['initialized'] and len(new)>=4 and str(watermark) not in [item['id'] for item in items]
   db.execute('UPDATE members SET checked=?,success=?,error=NULL,next_check=?,watermark=?,initialized=1,gap=max(gap,?) WHERE id=?',(now,now,now+interval,maximum,int(gap),member['id']))
   db.execute('DELETE FROM tweets WHERE member_id=? AND id NOT IN (SELECT id FROM tweets WHERE member_id=? ORDER BY published DESC,id DESC LIMIT 1000)',(member['id'],member['id']))
   db.execute('DELETE FROM updates WHERE seq < (SELECT coalesce(max(seq),0)-50000 FROM updates)')
  return new
 def failure(self,member,error,delay):
  with self.connect() as db:db.execute('UPDATE members SET checked=?,error=?,next_check=? WHERE id=?',(time.time(),error,time.time()+delay,member['id']))
 def tweets(self,member=None,limit=25,before=None,query=None,include_replies=True):
  clauses=[];args=[]
  if member:clauses.append('member_id=?');args.append(member['id'])
  if before:clauses.append('CAST(id AS INTEGER)<?');args.append(int(before))
  if query:clauses.append("json_extract(document,'$.text') LIKE ? ESCAPE '\\'");args.append('%'+query.replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%')
  if not include_replies:clauses.append("json_extract(document,'$.is_reply')=0")
  where=' WHERE '+' AND '.join(clauses) if clauses else ''
  with self.connect() as db:items=db.execute('SELECT document FROM tweets'+where+' ORDER BY published DESC,id DESC LIMIT ?',(*args,limit+1)).fetchall()
  values=[json.loads(item[0]) for item in items[:limit]]
  return {'tweets':values,'has_more':len(items)>limit,'next_cursor':values[-1]['id'] if len(items)>limit else None,'member':member,'coverage':'public-profile-window','initial_history_complete':False}
 def detail(self,ident):
  with self.connect() as db:row=db.execute('SELECT document FROM tweets WHERE id=?',(ident,)).fetchone()
  return json.loads(row[0]) if row else None
 def updates(self,after,member=None,limit=25):
  with self.connect() as db:
   bounds=db.execute('SELECT min(seq),max(seq) FROM updates').fetchone()
   clause=' AND u.member_id=?' if member else ''
   rows=db.execute('SELECT u.seq,u.detected,coalesce(u.document,t.document) AS document FROM updates u LEFT JOIN tweets t ON t.id=u.tweet_id WHERE u.seq>?'+clause+' ORDER BY u.seq LIMIT ?',(*([after,member['id']] if member else [after]),limit+1)).fetchall()
  return {'updates':[{'cursor':str(row['seq']),'type':'new_tweet','detected_at':stamp(row['detected']),'tweet':json.loads(row['document'])} for row in rows[:limit] if row['document']],'next_cursor':str(rows[min(len(rows),limit)-1]['seq']) if rows else str(after),'has_more':len(rows)>limit,'latest_cursor':str(bounds[1] or 0),'oldest_cursor':str(bounds[0] or 0),'retention_gap':bool(after and bounds[0] and after<bounds[0]-1),'baseline_events_included':False}
 def status(self):
  with self.connect() as db:
   count=db.execute('SELECT count(*) FROM tweets').fetchone()[0]
  members=self.members();heartbeat=self.meta('heartbeat') or 0
  return {'mode':'anonymous-public-profile','uses_x_account':False,'uses_x_api_key':False,'collector_online':time.time()-heartbeat<60,'heartbeat_at':stamp(heartbeat),'tracked_members':sum(bool(m.get('username')) for m in members),'registered_members':len(members),'pending_username_discovery':sum(not m.get('username') for m in members),'checked_members':sum(bool(m['last_success_at']) for m in members),'failed_members':sum(bool(m['last_error']) for m in members),'stored_tweets':count,'interval_seconds':self.meta('interval') or 300,'request_gap_seconds':5,'global_error':self.meta('error'),'global_retry_at':stamp(self.meta('cooldown') or 0),'coverage':'Public profile posts only; initial full-history backfill is unavailable.'}

def stamp(value):return dt.datetime.fromtimestamp(value,dt.timezone.utc).isoformat().replace('+00:00','Z') if value else None
