// Only called after control-panel authentication and write CSRF validation.
export async function xBotControl(request,url,bindings){
 const prefix='/control/api/x-bot',suffix=url.pathname.slice(prefix.length);
 const allowed=request.method==='GET'&&['/snapshot','/history'].includes(suffix)||request.method==='POST'&&suffix==='/action';
 if(!allowed)throw Object.assign(Error('Endpoint bot tidak ditemukan'),{status:404});
 const base=bindings.X_BOT_CONTROL_URL,token=bindings.X_BOT_CONTROL_TOKEN;
 if(!base||!token)throw Object.assign(Error('Kontrol bot VPS belum dikonfigurasi'),{status:503});
 const target=new URL(base.replace(/\/$/,'')+suffix);
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('URL kontrol bot tidak valid'),{status:503});
 if(suffix==='/history')target.searchParams.set('page',String(Math.max(1,Math.min(1000,Number(url.searchParams.get('page'))||1))));
 const headers={Authorization:'Bearer '+token,Accept:'application/json','User-Agent':'JKT48Connect-Control/1.0'};
 let body;
 if(request.method==='POST'){
  const text=await request.text();if(text.length>1024)throw Object.assign(Error('Payload terlalu besar'),{status:413});
  let value;try{value=JSON.parse(text)}catch{throw Object.assign(Error('JSON tidak valid'),{status:400})}
  if(!['on','off','restart'].includes(value.action))throw Object.assign(Error('Aksi bot tidak valid'),{status:400});
  body=JSON.stringify({action:value.action});headers['Content-Type']='application/json';
 }
 let response;try{response=await fetch(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)})}catch{throw Object.assign(Error('Kontrol VPS belum merespons'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Kontrol VPS memberikan redirect yang tidak diizinkan'),{status:502});
 let value;try{value=await response.json()}catch{throw Object.assign(Error('Respons kontrol VPS tidak valid'),{status:502})}
 if(!response.ok)throw Object.assign(Error(value.message||'Kontrol bot gagal'),{status:response.status>=400?response.status:502});
 return value;
}
