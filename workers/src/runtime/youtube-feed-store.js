import {YOUTUBE_CHANNELS} from './youtube-feed.js';
const allowed=new Set(YOUTUBE_CHANNELS.map(c=>c.id));
const key=channel=>'YOUTUBE_LAST_GOOD:v1:'+channel;
export function createYoutubeFeedStore(getDB){
 return {
  async load(channel){
   if(!allowed.has(channel))return null;
   const db=getDB();if(!db)return null;
   const row=await db.prepare('SELECT value FROM cache_entries WHERE key=? AND expires_at>?').bind(key(channel),Date.now()).first();
   if(!row?.value||row.value.length>512*1024)return null;
   const entry=JSON.parse(row.value);
   if(!Number.isFinite(entry.time)||!Array.isArray(entry.rows)||!entry.rows.length||entry.rows.length>20||!entry.rows.every(r=>r.channelId===channel&&/^[\w-]{11}$/.test(r.id)&&Number.isFinite(Date.parse(r.date))))return null;
   return entry;
  },
  async save(channel,entry){
   const db=getDB();if(!db||!allowed.has(channel))return;
   await db.prepare('INSERT INTO cache_entries(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').bind(key(channel),JSON.stringify(entry),entry.time+86400000).run();
  }
 };
}
