// Called only after admin-session and CSRF checks in control/index.js.
export async function discordBotControl(request,url,bindings){
 const match=/^\/control\/api\/discord-bot\/(notify|cavallery)\/(snapshot|history|action|settings|server)$/.exec(url.pathname);
 if(!match||!(request.method==='GET'&&!['action','server'].includes(match[2])||request.method==='POST'&&['action','settings','server'].includes(match[2])))throw Object.assign(Error('Endpoint bot Discord tidak ditemukan'),{status:404});
 if(['settings','server'].includes(match[2])&&match[1]!=='notify')throw Object.assign(Error('Pengaturan hanya tersedia untuk bot JKT48Connect'),{status:404});
 const base=bindings.X_BOT_CONTROL_URL,token=bindings.X_BOT_CONTROL_TOKEN;
 if(!base||!token)throw Object.assign(Error('Kontrol VPS belum dikonfigurasi'),{status:503});
 const target=new URL(base.replace(/\/$/,'')+'/discord/'+match[1]+'/'+match[2]);
 if(target.protocol!=='https:'||target.username||target.password)throw Object.assign(Error('URL kontrol tidak valid'),{status:503});
 if(match[2]==='history')target.searchParams.set('page',String(Math.max(1,Math.min(1000,Number(url.searchParams.get('page'))||1))));
 const headers={Authorization:'Bearer '+token,Accept:'application/json'};let body;
 if(request.method==='POST'){const raw=await request.text();if(raw.length>8192)throw Object.assign(Error('Payload terlalu besar'),{status:413});let value;try{value=JSON.parse(raw)}catch{throw Object.assign(Error('JSON tidak valid'),{status:400})}if(!value||typeof value!=='object'||Array.isArray(value))throw Object.assign(Error('Payload tidak valid'),{status:400});if(match[2]==='action'&&!['on','off','restart'].includes(value.action))throw Object.assign(Error('Aksi tidak valid'),{status:400});body=JSON.stringify(match[2]==='action'?{action:value.action}:match[2]==='server'?{guild_id:value.guild_id,blocked:value.blocked}:value);headers['Content-Type']='application/json'}
 let response;try{response=await fetch(target,{method:request.method,headers,body,redirect:'manual',signal:AbortSignal.timeout(20000)})}catch{throw Object.assign(Error('Kontrol VPS belum merespons'),{status:502})}
 if(response.status>=300&&response.status<400)throw Object.assign(Error('Redirect kontrol tidak diizinkan'),{status:502});
 let value;try{value=await response.json()}catch{throw Object.assign(Error('Respons kontrol tidak valid'),{status:502})}
 if(!response.ok)throw Object.assign(Error(value.message||'Kontrol bot gagal'),{status:response.status});return value;
}
