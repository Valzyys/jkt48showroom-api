const schema=`CREATE TABLE IF NOT EXISTS extension_notifications (id TEXT PRIMARY KEY,title TEXT NOT NULL,message TEXT NOT NULL,link TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`;
const initialized=new WeakMap();
async function ready(db){if(!initialized.has(db))initialized.set(db,db.prepare(schema).run().catch(e=>{initialized.delete(db);throw e}));await initialized.get(db)}
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const present=row=>({...row,published:Boolean(row.published)});
export async function publishedNotifications(db){
 await ready(db);const {results}=await db.prepare('SELECT id,title,message,link,created_at FROM extension_notifications WHERE published=1 ORDER BY created_at DESC,id DESC LIMIT 100').all();return results;
}
export async function notificationAdmin(url,request,b,body){
 await ready(b.DB);
 if(request.method==='GET'){
  const {results}=await b.DB.prepare('SELECT * FROM extension_notifications ORDER BY created_at DESC,id DESC LIMIT 200').all();return {notifications:results.map(present)};
 }
 const data=await body(request);
 if(request.method==='DELETE'){
  if(typeof data.id!=='string'||! /^[a-f0-9-]{36}$/.test(data.id))throw fail('ID notifikasi tidak valid');
  const r=await b.DB.prepare('DELETE FROM extension_notifications WHERE id=?').bind(data.id).run();if(!r.meta.changes)throw fail('Notifikasi tidak ditemukan',404);return {ok:true};
 }
 if(!['POST','PUT'].includes(request.method))throw fail('Method tidak diizinkan',405);
 const title=String(data.title||'').trim(),message=String(data.message||'').trim(),link=String(data.link||'').trim();
 if(!title||title.length>160)throw fail('Judul wajib diisi, maksimal 160 karakter');
 if(!message||message.length>5000)throw fail('Isi informasi wajib diisi, maksimal 5.000 karakter');
 if(typeof data.published!=='boolean')throw fail('Status terbit tidak valid');
 if(link){let target;try{target=new URL(link)}catch{}if(link.length>2000||!target||target.protocol!=='https:'||target.username||target.password)throw fail('Tautan harus HTTPS tanpa username/password');}
 const now=new Date().toISOString();let id;
 if(request.method==='PUT'){
  id=data.id;if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))throw fail('ID notifikasi tidak valid');
  const result=await b.DB.prepare('UPDATE extension_notifications SET title=?,message=?,link=?,published=?,updated_at=? WHERE id=?').bind(title,message,link,data.published?1:0,now,id).run();if(!result.meta.changes)throw fail('Notifikasi tidak ditemukan',404);
 }else{
  const count=await b.DB.prepare('SELECT COUNT(*) AS count FROM extension_notifications').first();if(count.count>=200)throw fail('Maksimal 200 notifikasi. Hapus informasi lama terlebih dahulu.');
  id=crypto.randomUUID();await b.DB.prepare('INSERT INTO extension_notifications(id,title,message,link,published,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(id,title,message,link,data.published?1:0,now,now).run();
 }
 return {ok:true,id};
}
