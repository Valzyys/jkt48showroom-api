import React,{useEffect,useState} from 'react';
export function HikariInformation({call}){
 const empty=()=>({title:'',body:'',image:'',url:'',published:false,pinned:false});
 const [items,setItems]=useState([]),[form,setForm]=useState(empty),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=()=>call('hikari-info').then(x=>setItems(x.items));
 useEffect(()=>{load().catch(e=>setError(e.message))},[]);
 const change=(key,value)=>setForm({...form,[key]:value});
 async function save(event){event.preventDefault();setBusy(true);setError('');try{await call('hikari-info',{method:form.id?'PUT':'POST',body:form});setForm(empty());await load()}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function remove(item){if(!confirm('Hapus pengumuman '+item.title+'?'))return;try{await call('hikari-info',{method:'DELETE',body:{id:item.id}});await load()}catch(e){setError(e.message)}}
 return <><p className="dash-note">Kanal Info JKT48Connect dalam Hikari. Mendukung Markdown, gambar, tautan, draft dan sematan. Pesan ini tidak dikirim ke chat Telegram.</p>{error&&<p className="dash-error" role="alert">{error}</p>}<section className="dash-panel"><form className="dash-form" onSubmit={save}>
 {['title','body','image','url'].map(key=><label key={key}><span>{{title:'Judul',body:'Isi Markdown',image:'URL gambar HTTPS',url:'Tautan HTTPS'}[key]}</span>{key==='body'?<textarea required rows={8} maxLength={10000} value={form[key]} onChange={e=>change(key,e.target.value)}/>:<input type={['image','url'].includes(key)?'url':'text'} required={key==='title'} value={form[key]} maxLength={key==='title'?160:2000} onChange={e=>change(key,e.target.value)}/>}</label>)}
 <label><input type="checkbox" checked={form.published} onChange={e=>change('published',e.target.checked)}/>Terbitkan</label><label><input type="checkbox" checked={form.pinned} onChange={e=>change('pinned',e.target.checked)}/>Sematkan</label>
 <button className="dash-btn primary" disabled={busy}>{busy?'Menyimpan…':'Simpan'}</button><button type="button" className="dash-btn" onClick={()=>setForm(empty())}>Batal</button></form></section>
 {items.map(item=><article className="dash-panel" key={item.id}><h3>{item.title}</h3><p>{item.published?'Terbit':'Draft'}{item.pinned?' · Disematkan':''}</p><p>{item.body.slice(0,200)}</p><button className="dash-btn" onClick={()=>setForm(item)}>Edit</button><button className="dash-btn" onClick={()=>remove(item)}>Hapus</button></article>)}</>;
}
