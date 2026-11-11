const hikariBannerOrigin='https://hikari-banner.internal';
const hikariBannerPath='/hikari/profile-banner';
const hikariBannerPagePath='/control/hikari-banner';
const hikariBannerCache={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

async function hikariBannerProxy(request,bindings,path) {
 const backend=bindings.RECOVERY_HIKARI_BANNER;
 if(!backend) return Response.json({message:'Penyimpanan banner tidak tersedia.'},{status:503,headers:hikariBannerCache});
 const headers=new Headers();
 for(const name of ['If-None-Match','Content-Type','Content-Length']){
  const value=request.headers.get(name);
  if(value!==null) headers.set(name,value);
 }
 const options={method:request.method,headers};
 if(request.method==='PUT') options.body=request.body;
 return backend.fetch(new Request(hikariBannerOrigin+path,options));
}

export async function hikariBannerPublic(request,bindings){
 const path=new URL(request.url).pathname;
 if(path===hikariBannerPath && request.method==='GET')return hikariBannerProxy(request,bindings,'/profile');
 const media=/^\/hikari\/profile-banner\/media\/([a-f0-9]{64}\.webp)$/.exec(path);
 if(media && ['GET','HEAD'].includes(request.method))return hikariBannerProxy(request,bindings,'/media/'+media[1]);
 return null;
}

export async function hikariBannerAdmin(request,bindings){
 if(!['GET','PUT','DELETE'].includes(request.method)){
  return Response.json({message:'Method tidak diizinkan.'},{status:405,headers:{...hikariBannerCache,Allow:'GET, PUT, DELETE'}});
 }
 const response=await hikariBannerProxy(request,bindings,'/manage');
 return response;
}

const hikariBannerHtml=`<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Banner Hikari · JKT48Connect</title>
<style>
:root{color-scheme:light dark;font:16px system-ui,sans-serif;color:#272222;background:#f6f2ed}
main{max-width:640px;margin:clamp(16px,7vw,90px) auto;padding:24px}header{border-bottom:1px solid #d7cbc3;margin-bottom:24px}
a{color:inherit}h1{font-size:clamp(26px,6vw,44px);letter-spacing:-.035em;margin:.7em 0 .3em}
p{line-height:1.6}label,input{display:block}input{max-width:100%;margin:8px 0 16px}
img{width:100%;max-height:360px;object-fit:contain;border-radius:18px;background:#211d20;margin-bottom:20px}
button{padding:10px 16px;border-radius:100px;border:1px solid #8d6467;background:transparent;color:inherit;font:inherit;margin:0 8px 8px 0}
button[type=submit]{background:#a91c36;color:white;border-color:#a91c36}button:disabled{opacity:.45}
@media(prefers-color-scheme:dark){:root{color:#fff1ef;background:#1d1819}header{border-color:#5b4549}}
</style><script defer src="/control/hikari-banner/app.js"></script></head>
<body><main><header><a href="/control/admin">← Control admin</a><h1>Banner profil Hikari</h1></header>
<p>Banner ini muncul di profil developer Hikari. Pilih JPG, PNG, atau WebP dengan ukuran maksimal 6 MB.</p>
<img id="preview" alt="Banner profil developer Hikari saat ini" hidden>
<p id="status" role="status" aria-live="polite">Memeriksa sesi admin…</p>
<a id="login" href="/control/admin" hidden>Masuk ke control admin</a>
<form id="form" hidden><label for="image">File banner</label><input id="image" type="file" accept="image/jpeg,image/png,image/webp" required>
<button type="submit" id="save">Simpan banner</button><button type="button" id="remove">Hapus banner</button></form>
</main></body></html>`;

const hikariBannerScript=`
'use strict';
const form=document.getElementById('form');
const preview=document.getElementById('preview');
const status=document.getElementById('status');
const login=document.getElementById('login');
const file=document.getElementById('image');
const save=document.getElementById('save');
const remove=document.getElementById('remove');
const endpoint='/control/api/hikari-banner';
let csrf='';
let current=null;

async function loadJson(path,options){
 const response=await fetch(path,{...options,cache:'no-store',credentials:'same-origin'});
 const data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.message||'Permintaan gagal.'),{status:response.status});
 return data;
}
function show(data){
 current=data;
 const url=data.image?new URL(data.image,location.origin):null;
 if(url && url.origin===location.origin)preview.src=url.href;
 else preview.removeAttribute('src');
 preview.hidden=!preview.hasAttribute('src');
 remove.disabled=data.configured&&!data.image;
 status.textContent=data.image?'Banner tersimpan di Google Drive.':data.configured?'Banner dihapus.':'Belum ada banner di Google Drive.';
}
function showError(error){
 status.textContent=error.message;
 if(error.status===401){login.hidden=false;form.hidden=true;}
}
async function update(method,selected){
 save.disabled=true;
 remove.disabled=true;
 file.disabled=true;
 status.textContent='Menyimpan perubahan…';
 const headers={'X-Requested-With':'jkt48connect','X-CSRF-Token':csrf};
 if(selected)headers['Content-Type']=selected.type;
 try{show(await loadJson(endpoint,{method,headers,body:selected}));form.reset();}
 catch(error){showError(error);}
 finally{save.disabled=false;file.disabled=false;remove.disabled=Boolean(current?.configured&&!current?.image);}
}
form.addEventListener('submit',event=>{
 event.preventDefault();
 const selected=file.files[0];
 if(selected&&selected.size<=6291456)update('PUT',selected);
 else status.textContent='Pilih gambar dengan ukuran maksimal 6 MB.';
});
remove.addEventListener('click',()=>{
 if(confirm('Hapus banner dari profil developer Hikari?'))update('DELETE');
});
(async()=>{
 try{
  const session=await loadJson('/control/api/session');
  csrf=session.csrf;
  show(await loadJson(endpoint));
  form.hidden=false;
 }catch(error){showError(error);}
})();
`;

export function hikariBannerPage(path,method,securityHeaders){
 const page=path===hikariBannerPagePath||path===hikariBannerPagePath+'/';
 const script=path===hikariBannerPagePath+'/app.js';
 if(!page&&!script)return null;
 if(!['GET','HEAD'].includes(method))return new Response(null,{status:405,headers:{...securityHeaders,Allow:'GET, HEAD'}});
 return new Response(method==='HEAD'?null:(page?hikariBannerHtml:hikariBannerScript),{headers:{
  ...securityHeaders,
  'Content-Type':page?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
  'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
 }});
}
