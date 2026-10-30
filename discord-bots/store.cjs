const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
class Store{
 constructor(dir){fs.mkdirSync(dir,{recursive:true,mode:0o700});this.db=new DatabaseSync(path.join(dir,'notifications.sqlite'));this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS deliveries(key TEXT PRIMARY KEY,kind TEXT,channel TEXT,event TEXT,status TEXT,payload TEXT,message_id TEXT,url TEXT,error TEXT,attempts INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0,created INTEGER,updated INTEGER);
 CREATE INDEX IF NOT EXISTS delivery_status ON deliveries(status,next_at);`);this.db.prepare("UPDATE deliveries SET status='uncertain',error='interrupted_send' WHERE status='sending'").run();}
 get(k,otherwise=null){const r=this.db.prepare('SELECT value FROM kv WHERE key=?').get(k);return r?JSON.parse(r.value):otherwise}
 set(k,v){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key)DO UPDATE SET value=excluded.value').run(k,JSON.stringify(v))}
 enqueue(kind,event,channel,payload){const now=Date.now();this.db.prepare("INSERT OR IGNORE INTO deliveries(key,kind,channel,event,status,payload,created,updated)VALUES(?,?,?,?,'pending',?,?,?)").run(`${kind}:${event}:${channel}`,kind,channel,event,JSON.stringify(payload),now,now)}
 due(){return this.db.prepare("SELECT * FROM deliveries WHERE status='pending' AND next_at<=? ORDER BY CASE kind WHEN 'live' THEN 0 WHEN 'recent' THEN 1 ELSE 2 END,created LIMIT 30").all(Date.now())}
 claimDue(enabledKinds){
  if(!enabledKinds.length)return null;
  // Claim before the first await so parallel senders cannot select the same row.
  const now=Date.now(),placeholders=enabledKinds.map(()=>'?').join(',');
  const job=this.db.prepare(`SELECT * FROM deliveries WHERE status='pending' AND next_at<=? AND kind IN (${placeholders}) ORDER BY CASE kind WHEN 'live' THEN 0 WHEN 'recent' THEN 1 ELSE 2 END,created,key LIMIT 1`).get(now,...enabledKinds);
  if(!job)return null;
  const claimed=this.db.prepare("UPDATE deliveries SET status='sending',updated=? WHERE key=? AND status='pending'").run(now,job.key);
  return claimed.changes?job:null;
 }
 update(key,values){const allowed=['payload','status','message_id','url','error','attempts','next_at'];const entries=Object.entries(values).filter(([k])=>allowed.includes(k));this.db.prepare('UPDATE deliveries SET '+entries.map(([k])=>k+'=?').join(',')+',updated=? WHERE key=?').run(...entries.map(([,v])=>v),Date.now(),key)}
 history(limit=100){return this.db.prepare("SELECT key,kind,channel,event,status,message_id,url,error,attempts,created,updated FROM deliveries WHERE status='sent' ORDER BY updated DESC LIMIT ?").all(limit)}
 queue(){return this.db.prepare("SELECT key,kind,channel,event,status,error,attempts,next_at,created FROM deliveries WHERE status!='sent' ORDER BY created DESC LIMIT 100").all()}
 counts(){return this.db.prepare('SELECT status,count(*) count FROM deliveries GROUP BY status').all()}
}
module.exports={Store};
