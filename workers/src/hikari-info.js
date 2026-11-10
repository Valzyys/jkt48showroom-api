const initialized=new WeakMap();
async function ready(db){
 if(!initialized.has(db))initialized.set(db,db.prepare(`CREATE TABLE IF NOT EXISTS hikari_info(id TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,image TEXT NOT NULL DEFAULT '',url TEXT NOT NULL DEFAULT '',published INTEGER NOT NULL DEFAULT 0,pinned INTEGER NOT NULL DEFAULT 0,published_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run().catch(e=>{initialized.delete(db);throw e}));
 await initialized.get(db);
}
const fail=message=>Object.assign(new Error(message),{status:400});
const present=r=>({...r,published:!!r.published,pinned:!!r.pinned});
export async function hikariInfo(db,admin=false){
 await ready(db);
 const {results}=await db.prepare(admin?'SELECT * FROM hikari_info ORDER BY pinned DESC,published_at DESC LIMIT 200':'SELECT id,title,body,image,url,pinned,published_at FROM hikari_info WHERE published=1 ORDER BY pinned DESC,published_at DESC LIMIT 100').all();
 return {items:results.map(present)};
}
export async function hikariInfoAdmin(request,bindings,body){
 if(request.method==='GET')return hikariInfo(bindings.DB,true);
 await ready(bindings.DB);const data=await body(request);
 const id=String(data.id||'');
 if(['PUT','DELETE'].includes(request.method)&&! /^[a-f0-9-]{36}$/.test(id))throw fail('ID tidak valid');
 if(request.method==='DELETE'){await bindings.DB.prepare('DELETE FROM hikari_info WHERE id=?').bind(id).run();return {ok:true}}
 if(!['POST','PUT'].includes(request.method))throw Object.assign(Error('Method tidak diizinkan'),{status:405});
 const title=String(data.title||'').trim(),text=String(data.body||'').trim();
 if(!title||title.length>160||!text||text.length>10000)throw fail('Judul maksimal 160 dan isi 10.000 karakter');
 if(typeof data.published!=='boolean'||typeof data.pinned!=='boolean')throw fail('Status tidak valid');
 const links=['image','url'].map(key=>{const value=String(data[key]||'').trim();if(value){let u;try{u=new URL(value)}catch{}if(!u||u.protocol!=='https:'||u.username||u.password||value.length>2000)throw fail('Gambar dan tautan harus HTTPS tanpa kredensial')}return value});
 const now=new Date().toISOString();
 if(request.method==='POST'){
  const count=await bindings.DB.prepare('SELECT COUNT(*) AS n FROM hikari_info').first();if(count.n>=200)throw fail('Maksimal 200 pengumuman');
  await bindings.DB.prepare('INSERT INTO hikari_info VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),title,text,...links,data.published?1:0,data.pinned?1:0,now,now).run();
 }else await bindings.DB.prepare('UPDATE hikari_info SET title=?,body=?,image=?,url=?,published=?,pinned=?,updated_at=? WHERE id=?').bind(title,text,...links,data.published?1:0,data.pinned?1:0,now,id).run();
 return {ok:true};
}
