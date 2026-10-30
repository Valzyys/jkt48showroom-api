"""Durable Instagram archive; baseline and changes commit in one transaction."""
import datetime,json,sqlite3,time

def preserve_item_videos(previous,current):
 old={p['id']:p for p in previous or[] if p.get('id')}
 result=[]
 for item in current:
  item=dict(item);before=old.get(item.get('id'),{})
  if item.get('type')=='video'and before.get('type')=='video'and not item.get('play_url')and before.get('play_url'):item['play_url']=before['play_url']
  result.append(item)
 return result

class Store:
 def __init__(self,file):
  self.db=sqlite3.connect(file,check_same_thread=False,timeout=10);self.db.row_factory=sqlite3.Row
  self.db.executescript('''PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS profiles(username TEXT PRIMARY KEY,watermark TEXT NOT NULL,success REAL,error TEXT,attempts INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,username TEXT NOT NULL,document TEXT NOT NULL,first_seen REAL,last_seen REAL);
CREATE TABLE IF NOT EXISTS updates(cursor INTEGER PRIMARY KEY AUTOINCREMENT,post_id TEXT NOT NULL UNIQUE,username TEXT NOT NULL,document TEXT NOT NULL,detected_at REAL);
''')
 def save(self,result):
  name=result['username'];now=time.time()
  with self.db:
   previous=self.db.execute('SELECT * FROM profiles WHERE username=?',(name,)).fetchone();watermark=int(previous['watermark'])if previous else 0;new=[]
   for p in result['posts']:
    existing=self.db.execute('SELECT username,document FROM posts WHERE id=?',(p['id'],)).fetchone()
    if existing and existing['username']!=name:raise ValueError('post_owner_changed')
    merged=dict(p)
    if existing:
     old=json.loads(existing['document'])
     if not merged.get('created_at') and old.get('created_at'):
      merged['created_at']=old['created_at'];merged['created_at_source']=old.get('created_at_source')
     media={**old.get('media',{}),**merged.get('media',{})}
     if media.get('items'):media['items']=preserve_item_videos(old.get('media',{}).get('items'),media['items'])
     if old.get('media',{}).get('items') and not media.get('items'):media['items']=old['media']['items']
     if old.get('media',{}).get('detail_status')=='ready':media['detail_status']='ready'
     if not media.get('play_url') and old.get('media',{}).get('play_url'):
      media['play_url']=old['media']['play_url'];media['type']=old['media'].get('type','video')
     if old.get('media',{}).get('images') and not media.get('images'):
      media.update(images=old['media']['images'],images_status=old['media'].get('images_status'),type='carousel')
     merged['media']=media
     merged['metrics']={**old.get('metrics',{}),**{k:v for k,v in merged.get('metrics',{}).items()if v is not None}}
     if merged['metrics'].get('counts_hidden')is True:merged['metrics']['likes']=None;merged['metrics']['views']=None
     for field in ('metrics_observed_at','detail_observed_at','detail_source'):
      if old.get(field):merged[field]=old[field]
    doc=json.dumps(merged,ensure_ascii=False)
    self.db.execute('INSERT INTO posts VALUES(?,?,?,?,?) ON CONFLICT(id)DO UPDATE SET document=excluded.document,last_seen=excluded.last_seen',(p['id'],name,doc,now,now))
    if previous and previous['success'] and not existing and int(p['id'])>watermark:
     inserted=self.db.execute('INSERT OR IGNORE INTO updates(post_id,username,document,detected_at)VALUES(?,?,?,?)',(p['id'],name,doc,now))
     if inserted.rowcount:new.append(p['id'])
   maximum=str(max([watermark,*[int(p['id'])for p in result['posts']]]))
   self.db.execute('INSERT INTO profiles(username,watermark,success,error,attempts)VALUES(?,?,?,NULL,1) ON CONFLICT(username)DO UPDATE SET watermark=excluded.watermark,success=excluded.success,error=NULL,attempts=profiles.attempts+1',(name,maximum,now))
  return {'baseline':not(previous and previous['success']),'new_posts':new,'watermark':maximum}
 def enrich(self,name,detail):
  if str(detail.get('author_username','')).casefold()!=name.casefold():raise ValueError('post_owner_changed')
  with self.db:
   r=self.db.execute('SELECT document FROM posts WHERE id=? AND username=?',(detail['id'],name)).fetchone()
   if not r:raise ValueError('post_not_archived')
   doc=json.loads(r['document'])
   if detail.get('created_at'):
    doc['created_at']=detail['created_at'];doc['created_at_source']=detail.get('created_at_source')
   old=doc.get('media',{});media={**old,**{k:v for k,v in detail.get('media',{}).items() if v is not None}}
   if media.get('items'):media['items']=preserve_item_videos(old.get('items'),media['items'])
   if media.get('type')=='post' and old.get('type')in('video','carousel','image'):media['type']=old['type']
   if old.get('images') and not detail.get('media',{}).get('images'):media['images_status']=old.get('images_status','ready');media['type']='carousel'
   doc['media']=media
   doc['metrics']={**doc.get('metrics',{}),**{k:v for k,v in detail.get('metrics',{}).items()if v is not None}}
   if isinstance(detail.get('text'),str):doc['text']=detail['text']
   doc['detail_source']='instagram-public-post-page'
   doc['detail_observed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
   if any(detail.get('metrics',{}).get(k)is not None for k in ('likes','comments','views')):doc['metrics_observed_at']=doc['detail_observed_at']
   if doc['metrics'].get('counts_hidden')is True:doc['metrics']['likes']=None;doc['metrics']['views']=None
   self.db.execute('UPDATE posts SET document=? WHERE id=? AND username=?',(json.dumps(doc,ensure_ascii=False),detail['id'],name))
 def failure(self,name,error):
  with self.db:self.db.execute('INSERT INTO profiles(username,watermark,error,attempts)VALUES(?,\'0\',?,1) ON CONFLICT(username)DO UPDATE SET error=excluded.error,attempts=profiles.attempts+1',(name,error))
 def counts(self):return {name:self.db.execute('SELECT COUNT(*) FROM '+name).fetchone()[0]for name in ['profiles','posts','updates']}
 def close(self):self.db.close()
