const $=selector=>document.querySelector(selector);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let settings=[],group='API key & token',refreshTimer=null,statusBusy=false;
const pending=new Map();
async function api(path,options={}){
 const response=await fetch('/control/api/'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
 const data=await response.json();if(!response.ok){if(response.status===401&&path!=='login')showLogin();throw new Error(data.message||'HTTP '+response.status);}return data;
}
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3500);}
function showLogin(){clearInterval(refreshTimer);refreshTimer=null;settings=[];pending.clear();$('#settings-form').replaceChildren();$('#active-key').value='';$('#dashboard').hidden=true;$('#login-view').hidden=false;$('#logout').hidden=true;}
async function load(){
 const session=await api('session');$('#account').textContent=session.email;$('#dashboard').hidden=false;$('#login-view').hidden=true;$('#logout').hidden=false;
 settings=(await api('settings')).settings;render();await status();clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(!document.hidden)status().catch(e=>{$('#monitor-error').textContent='Gagal memperbarui status: '+e.message;});},15000);
}
function render(){
 const groups=[...new Set(settings.map(s=>s.group))];
 $('#groups').innerHTML=groups.map(g=>`<button class="group-button ${group===g?'active':''}" data-group="${escape(g)}">${escape(g)}</button>`).join('');
 document.querySelectorAll('[data-group]').forEach(b=>b.onclick=()=>{group=b.dataset.group;render();});
 $('#group-heading').textContent=group;$('#key-card').hidden=group!=='API key & token';
 const search=$('#search').value.toLowerCase();
 const list=settings.filter(s=>(search||s.group===group)&&(!search||(s.name+' '+s.description).toLowerCase().includes(search)));
 $('#settings-form').innerHTML=list.map(s=>{
  const value=pending.has(s.name)?pending.get(s.name):s.value;
  return `<div class="field"><div class="field-head"><label for="setting-${s.name}">${escape(s.name)}</label><span class="badge">${s.secret?(s.configured?'SECRET · TERPASANG':'SECRET · BELUM DIISI'):'VARIABLE'}</span></div><p>${escape(s.description)}</p><input id="setting-${s.name}" data-setting="${s.name}" type="${s.secret?'password':'text'}" value="${escape(value??'')}" placeholder="${s.secret&&s.configured?'Kosong = pertahankan secret aktif':'Masukkan nilai'}" autocomplete="off"><div class="field-footer"><span>Sumber: ${s.source==='control'?'Control':'Deployment'}${pending.has(s.name)?' · perubahan belum disimpan':''}</span>${s.source==='control'?`<button type="button" data-reset="${s.name}">Kembali ke nilai deployment</button>`:''}</div></div>`;
 }).join('')||'<p>Tidak ada pengaturan yang cocok.</p>';
 document.querySelectorAll('[data-setting]').forEach(input=>input.oninput=()=>{const s=settings.find(s=>s.name===input.dataset.setting);if(s.secret&&!input.value)pending.delete(s.name);else pending.set(s.name,input.value);});
 document.querySelectorAll('[data-reset]').forEach(button=>button.onclick=()=>{if(confirm('Kembalikan '+button.dataset.reset+' ke nilai deployment saat menyimpan?')){pending.set(button.dataset.reset,null);render();}});
}
const when=value=>value?new Date(value).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+' WIB':'Belum ada';
const health=value=>`<span class="health ${escape(value.status)}">${escape(value.message)}</span>`;
function monitor(data){
 const m=data.monitor;if(!m)return;
 const active=m.sessions.filter(s=>!s.completed);
 const summary=(field,disabled)=>disabled?{status:'disabled',message:'Dinonaktifkan'}:!m.online?{status:'stale',message:'Heartbeat VPS terlambat'}:!active.length?{status:'waiting',message:'Menunggu live'}:active.some(s=>['error','warning','stale'].includes(s[field].status))?{status:'warning',message:'Perlu diperiksa per sesi'}:active.some(s=>s[field].status==='waiting')?{status:'waiting',message:'Menunggu part pertama terkirim'}:{status:'ok',message:'Berjalan'};
 const enabled=name=>settings.find(s=>s.name===name)?.value;
 $('#pipeline-health').innerHTML=[['VPS collector',{status:!m.enabled?'disabled':m.online?'ok':'stale',message:!m.enabled?'Dinonaktifkan':m.online?'Online':'Tidak ada heartbeat terbaru'}],['Record live',summary('record',!m.enabled||enabled('COLLECTOR_RECORD_VIDEO')==='false')],['Screenshot',summary('screenshot',!m.enabled||enabled('DISABLE_SCREENSHOTS')==='true')],['Recent',m.recent]].map(([title,value])=>`<div><h3>${title}</h3>${health(value)}</div>`).join('');
 $('#monitor-updated').textContent='Diperiksa '+when(Date.now());
 $('#vps-heartbeat').textContent='Heartbeat: '+when(m.lastSeen)+' · PID: '+(m.pid||'—')+' · Uptime proses: '+Math.floor(m.uptimeSeconds/60)+' menit · Showroom: '+(m.discovery.showroom?'OK':'gagal / nonaktif')+' · IDN: '+(m.discovery.idn?'OK':'gagal / nonaktif')+' · Recent selesai: '+m.completedCount+' · Antrean recent: '+m.pending+' · Sinkron terakhir: '+when(m.lastArchive)+' · Live selesai terakhir: '+when(m.lastCompleted)+' · Kegagalan arsip sejak proses mulai: '+m.archiveErrors;
 $('#live-monitor').innerHTML='<table><thead><tr><th>Member / sesi</th><th>Record live → R2</th><th>Screenshot → R2</th><th>Chat / gold</th><th>Recent / sinkron</th></tr></thead><tbody>'+m.sessions.map(s=>`<tr><td><strong>${escape(s.name)}</strong><small>${escape(s.type)} · ${escape(s.data_id)}</small></td><td>${health(s.record)}<small>${(s.video.bytes/1048576).toFixed(1)} MiB terkirim · ${s.video.parts} part · ${s.video.errors} kegagalan</small><small>Upload terakhir: ${when(s.video.last_part)}</small></td><td>${health(s.screenshot)}<small>Terakhir: ${when(s.last_screenshot)} · ${s.screenshot_errors} kegagalan</small>${s.last_screenshot?`<a target="_blank" rel="noopener" href="/media/live/${escape(s.data_id)}/${s.last_screenshot}.jpg">Buka screenshot ↗</a>`:''}</td><td>${s.type==='idn'?`${health(s.ranking)}<small>Chat: ${escape(s.chat_status||'—')} · ${s.observed_events||0} event</small><small>${s.reported_gold??'—'} gold IDN / ${s.observed_gold??0} gold dari event</small><small>${s.ranking_users||0} pengirim · ${when(s.last_ranking?Date.parse(s.last_ranking):0)}</small>`:'—'}</td><td>${health(s.archive)}<small>${s.completed?'Selesai; menunggu publikasi':'Live; belum masuk recent'} · ${when(s.last_archive)}</small></td></tr>`).join('')+'</tbody></table>'+(m.sessions.length?'':'<p>'+ (m.telemetryAvailable?'Tidak ada sesi yang sedang dipantau.':'Menunggu telemetri dari VPS.')+'</p>');
 $('#monitor-error').textContent=data.idnAuth?.configured?(data.idnAuth.error?'IDN authentication: '+data.idnAuth.error:'IDN refresh token terpasang · JWT '+(data.idnAuth.ready?'siap':'menunggu refresh')):'IDN refresh token belum diisi; collector menggunakan akses publik.';
}
async function status(){
 if(statusBusy)return;statusBusy=true;
 try{
 const data=await api('status');monitor(data);const count=name=>data.collections.filter(c=>c.collection_name===name).reduce((n,c)=>n+c.records,0);
 $('#metrics').innerHTML=[['Member',count('idolmembers')],['Berita',count('jkt48newnews')],['Jadwal',count('jkt48newschedules')],['Foto member R2',data.mediaObjects+(data.mediaTruncated?'+':'')],['Screenshot R2',data.liveImages||0],['Video R2',data.liveVideos||0]].map(([name,n])=>`<div class="metric"><strong>${escape(n)}</strong><span>${escape(name)}</span></div>`).join('');
 $('#collector-sessions').innerHTML='<table><thead><tr><th>Sesi</th><th>Status</th><th>Frame</th><th>Gift</th><th>Video R2</th></tr></thead><tbody>'+(data.collectorSessions||[]).map(s=>'<tr><td>'+escape(s.data_id)+'</td><td>'+escape(s.status)+'</td><td>'+s.frames+'</td><td>'+s.gifts+' '+(s.type==='idn'?'Gold':'points')+'</td><td>'+s.recordings.map((r,i)=>'<a href="'+escape('/replay/'+s.data_id+'/'+r.run)+'" target="_blank" rel="noopener">MP4 '+(i+1)+(r.partial?' (parsial)':'')+'</a>').join(' · ')+'</td></tr>').join('')+'</tbody></table>';
 $('#collections').innerHTML='<table><thead><tr><th>Database</th><th>Koleksi</th><th>Record</th></tr></thead><tbody>'+data.collections.map(c=>`<tr><td>${escape(c.database_name)}</td><td>${escape(c.collection_name)}</td><td>${c.records}</td></tr>`).join('')+'</tbody></table><p>Cache: '+data.cacheEntries+' · Auto sync: '+(data.autoSync?'aktif':'nonaktif')+' · Scraper: '+(data.scraperConfigured?'terkonfigurasi':'belum siap')+'</p>'+ (data.collector?'<p>Collector: '+(Date.now()-data.collector.lastSeen<180000?'online':'heartbeat terlambat')+' · Sesi aktif: '+data.collector.active+' · Upload video aktif: '+(data.videoUploads||0)+' · Menunggu upload: '+data.collector.pending+' · Showroom: '+(data.collector.showroom_ok?'OK':'gagal')+' · IDN: '+(data.collector.idn_ok?'OK':'gagal')+'</p>':'<p>Collector belum mengirim heartbeat.</p>');
 }finally{statusBusy=false;}
}
$('#login-form').onsubmit=async event=>{
 event.preventDefault();const button=$('#login-form button');button.disabled=true;$('#login-error').textContent='';
 const form=new FormData(event.target);
 try{await api('login',{method:'POST',body:JSON.stringify({email:form.get('email'),password:form.get('password')})});event.target.reset();await load();}catch(e){$('#login-error').textContent=e.message;}finally{button.disabled=false;}
};
$('#logout').onclick=async()=>{try{await api('logout',{method:'POST',body:'{}'});showLogin();}catch(e){toast(e.message);}};
$('#refresh').onclick=()=>status().catch(e=>toast(e.message));
$('#search').oninput=render;
$('#save').onclick=async()=>{
 if(!pending.size){toast('Belum ada perubahan.');return;}
 const sensitive=['SECRET','AUTH_SECRET','JWT_SECRET','API_KEY'].filter(name=>pending.has(name));
 if(sensitive.length&&!confirm('Perubahan '+sensitive.join(', ')+' dapat membatalkan key atau token lama. Simpan perubahan?'))return;
 const button=$('#save');button.disabled=true;
 try{const result=await api('settings',{method:'PUT',body:JSON.stringify({changes:Object.fromEntries(pending)})});pending.clear();$('#active-key').value='';$('#copy-key').disabled=true;settings=(await api('settings')).settings;render();toast(result.message);await status();}catch(e){toast(e.message);}finally{button.disabled=false;}
};
$('#show-key').onclick=async()=>{try{const data=await api('key');$('#active-key').value=data.key||'';$('#active-key').type='text';$('#copy-key').disabled=!data.key;toast(data.key?'Key aktif ditampilkan untuk sesi ini.':'API key belum terpasang.');}catch(e){toast(e.message);}};
$('#copy-key').onclick=()=>navigator.clipboard.writeText($('#active-key').value).then(()=>toast('API key disalin.')).catch(()=>toast('Salin key secara manual.'));
$('#new-key').onclick=async()=>{try{const data=await api('key/new',{method:'POST',body:'{}'});pending.set('API_KEY',data.key);render();$('#active-key').value=data.key;$('#active-key').type='text';$('#copy-key').disabled=false;toast('Key baru disiapkan. Klik Simpan perubahan untuk mengaktifkan.');}catch(e){toast(e.message);}};
async function operation(button,path,payload={}){
 button.disabled=true;$('#operation-result').textContent='Operasi berjalan…';
 try{const data=await api(path,{method:'POST',body:JSON.stringify(payload)});$('#operation-result').textContent=JSON.stringify(data,null,2);await status();}catch(e){$('#operation-result').textContent=e.message;}finally{button.disabled=false;}
}
$('#sync-all').onclick=()=>operation($('#sync-all'),'sync',{dataset:'all'});
$('#clear-cache').onclick=()=>{if(confirm('Hapus cache respons API? Data dan gambar R2 tetap tersimpan.'))operation($('#clear-cache'),'cache/clear');};
$('#warm-media').onclick=()=>operation($('#warm-media'),'media/warm');
$('#settings-form').onsubmit=e=>e.preventDefault();
// Fanbase applications: review details, then approve or reject with a note.
let fanbaseStatus='PENDING';
async function fanbases(){
 document.querySelectorAll('[data-fb-status]').forEach(b=>b.classList.toggle('primary',b.dataset.fbStatus===fanbaseStatus));
 const data=await api('developers/fanbase?status='+fanbaseStatus);
 const link=url=>`<a href="${escape(url)}" target="_blank" rel="noreferrer noopener">${escape(url)}</a>`;
 $('#fanbase-list').innerHTML=data.applications.length?data.applications.map(a=>{const d=a.details;return `<article class="field"><div class="field-head"><label>${escape(a.name)} · <a href="https://x.com/${escape(a.x)}" target="_blank" rel="noreferrer noopener">@${escape(a.x)}</a></label><span class="badge">${escape(a.status)}${a.listing?' · BOLEH DICANTUMKAN':' · TIDAK DICANTUMKAN'}</span></div><p>${escape(d.kindLabel)} · fokus ${escape(d.focus)} · berdiri ${escape(d.founded)} · ±${Number(d.followers).toLocaleString('id-ID')} pengikut${d.instagram?' · IG @'+escape(d.instagram):''}${d.tiktok?' · TikTok @'+escape(d.tiktok):''}</p><p><strong>Follow X:</strong> <a href="https://x.com/${escape(d.follower)}" target="_blank" rel="noreferrer noopener">@${escape(d.follower)}</a> · <strong>Pengelola:</strong> ${escape(d.admin)} (${escape(d.contact)}) · <strong>Akun:</strong> ${escape(a.account.name)} &lt;${escape(a.account.email)}&gt; · <strong>Key:</strong> ${escape(a.key.name)} <code>${escape(a.key.preview)}</code></p><p><strong>Bukti:</strong> ${d.links.map(link).join(' · ')}</p><p><strong>Rencana:</strong> ${escape(d.usage)}</p>${a.note?`<p><strong>Catatan:</strong> ${escape(a.note)}</p>`:''}<div class="field-footer"><span>Diajukan ${new Date(a.createdAt).toLocaleString('id-ID')}</span><span>${a.status!=='APPROVED'?`<button type="button" class="primary" data-fb-review="${a.id}" data-decision="APPROVED">Setujui</button> `:''}${a.status!=='REJECTED'?`<button type="button" data-fb-review="${a.id}" data-decision="REJECTED">${a.status==='APPROVED'?'Cabut persetujuan':'Tolak'}</button>`:''}</span></div></article>`;}).join(''):'<p>Tidak ada pengajuan dengan status ini.</p>';
 document.querySelectorAll('[data-fb-review]').forEach(button=>button.onclick=async()=>{const decision=button.dataset.decision;const note=prompt(decision==='APPROVED'?'Catatan untuk fanbase (opsional)':'Alasan penolakan (dibaca pemohon)','');if(note===null)return;try{await api('developers/fanbase/'+button.dataset.fbReview,{method:'PUT',body:JSON.stringify({status:decision,note})});toast(decision==='APPROVED'?'Fanbase disetujui.':'Pengajuan ditolak.');await fanbases();}catch(e){toast(e.message);}});
}
$('#fanbase-card').addEventListener('toggle',()=>{if($('#fanbase-card').open)fanbases().catch(e=>toast(e.message));});
document.querySelectorAll('[data-fb-status]').forEach(b=>b.onclick=()=>{fanbaseStatus=b.dataset.fbStatus;fanbases().catch(e=>toast(e.message));});
// Developer accounts: plans per key, admin top-ups, and voucher codes.
let developerTimer=null;
async function developers(){
 const q=$('#developer-search').value.trim();
 const data=await api('developers'+(q?'?q='+encodeURIComponent(q):''));
 $('#developer-totals').innerHTML=[['Akun',data.totals.accounts],['Key aktif',data.totals.keys],['Request '+data.period,data.totals.requests],['Voucher belum dipakai',data.totals.vouchers]].map(([k,v])=>`<div class="metric"><span>${escape(k)}</span><strong>${escape(Number(v).toLocaleString('id-ID'))}</strong></div>`).join('');
 const options=key=>data.plans.map(p=>`<option value="${escape(p.id)}" ${p.id===key.plan?'selected':''}>${escape(p.label)} · ${Number(p.monthly).toLocaleString('id-ID')}/bln</option>`).join('');
 $('#developer-list').innerHTML=data.accounts.length?`<table><thead><tr><th>Akun</th><th>Key</th><th>Pemakaian</th><th>Paket</th><th>Isi ulang</th></tr></thead><tbody>${data.accounts.flatMap(a=>(a.keys.length?a.keys:[null]).map((k,i)=>`<tr>${i===0?`<td rowspan="${Math.max(1,a.keys.length)}"><strong>${escape(a.name)}</strong><br><small>${escape(a.email)}</small></td>`:''}${k?`<td>${escape(k.name)}<br><code>${escape(k.preview)}</code>${k.revokedAt?' <small>(dicabut)</small>':''}</td><td>${Number(k.used).toLocaleString('id-ID')} / ${Number(k.limit).toLocaleString('id-ID')}</td><td><select data-plan="${k.id}" ${k.revokedAt?'disabled':''}>${options(k)}</select></td><td><button type="button" data-topup="${k.id}" ${k.revokedAt?'disabled':''}>+ request</button></td>`:'<td colspan="4"><small>Belum membuat key</small></td>'}</tr>`)).join('')}</tbody></table>`:'<p>Belum ada akun developer.</p>';
 document.querySelectorAll('[data-plan]').forEach(select=>select.onchange=async()=>{try{await api('developers/keys/'+select.dataset.plan,{method:'PUT',body:JSON.stringify({plan:select.value})});toast('Paket diperbarui.');await developers();}catch(e){toast(e.message);}});
 document.querySelectorAll('[data-topup]').forEach(button=>button.onclick=async()=>{const value=prompt('Tambah berapa request untuk bulan ini?','5000');if(!value)return;try{await api('developers/keys/'+button.dataset.topup+'/topup',{method:'POST',body:JSON.stringify({requests:Number(value)})});toast('Kuota ditambahkan.');await developers();}catch(e){toast(e.message);}});
}
$('#developers-card').addEventListener('toggle',()=>{if($('#developers-card').open)developers().catch(e=>toast(e.message));});
$('#developer-search').oninput=()=>{clearTimeout(developerTimer);developerTimer=setTimeout(()=>developers().catch(e=>toast(e.message)),300);};
$('#voucher-form').onsubmit=async e=>{
 e.preventDefault();const form=new FormData(e.target);
 try{const data=await api('developers/vouchers',{method:'POST',body:JSON.stringify({requests:Number(form.get('requests')),count:Number(form.get('count')),note:form.get('note')})});$('#voucher-codes').hidden=false;$('#voucher-codes').textContent=data.codes.join('\n')+'\n\n'+data.requests+' request per kode. Simpan sekarang: kode tidak bisa ditampilkan lagi.';await developers();}catch(error){toast(error.message);}
};
load().catch(()=>showLogin());
