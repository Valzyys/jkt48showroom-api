import {publishedNotifications} from './notifications.js';
import {createHash} from 'node:crypto';
import {encrypt,decrypt} from '../control/settings.js';
const origin='https://io.eklas.dev';
const hash=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>String(value||'').trim().toUpperCase().replace(/\s+/g,'');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const encryption=b=>b.CONTROL_SESSION_SECRET||b.SECRET;
const schema=`CREATE TABLE IF NOT EXISTS extension_licenses (id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,state TEXT NOT NULL,key_hash TEXT UNIQUE,key_hint TEXT,alias_cipher TEXT,provider_cipher TEXT,plan TEXT NOT NULL,email TEXT,duration_value INTEGER,duration_unit TEXT,max_activations INTEGER NOT NULL,expires_at TEXT,created_at INTEGER NOT NULL)`;
const initialized=new WeakMap();
async function ready(db){if(!initialized.has(db))initialized.set(db,db.prepare(schema).run().catch(e=>{initialized.delete(db);throw e}));await initialized.get(db)}
export function generationInput(data){
 const plan=data.plan;if(!['Trial','Pro'].includes(plan))throw fail('Plan harus Trial atau Pro');
 const email=String(data.email||'').trim().toLowerCase();if(email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))throw fail('Email tidak valid');
 const maxActivations=data.maxActivations??5;if(!Number.isInteger(maxActivations)||maxActivations<1||maxActivations>100)throw fail('Batas perangkat harus 1–100');
 const durationValue=data.durationValue??1,durationUnit=data.durationUnit||'month';
 if(plan==='Pro'&&(!Number.isInteger(durationValue)||durationValue<1||durationValue>10000||!['minute','hour','day','week','month','year'].includes(durationUnit)||(durationUnit==='year'&&durationValue>10)))throw fail('Durasi tidak valid; tahunan maksimal 10 tahun');
 return {plan,...(email?{email}:{}),maxActivations,...(plan==='Pro'?{durationValue:durationUnit==='year'?durationValue*12:durationValue,durationUnit:durationUnit==='year'?'month':durationUnit}:{})};
}
export async function licenseAdmin(url,request,b,body){
 await ready(b.DB);
 if(url.pathname.endsWith('/package')&&request.method==='PUT'){
  if(Number(request.headers.get('Content-Length'))>2097152)throw fail('Paket terlalu besar',413);
  const bytes=new Uint8Array(await request.arrayBuffer());if(bytes.length<4||bytes.length>2097152||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)throw fail('ZIP tidak valid');
  await b.IMAGES_BUCKET.put('extension-packages/VALZY-Studio.zip',bytes,{httpMetadata:{contentType:'application/zip'}});return {ok:true};
 }
 if(request.method==='GET'){
  const {results}=await b.DB.prepare('SELECT id,state,key_hint,plan,email,duration_value,duration_unit,max_activations,expires_at,created_at FROM extension_licenses ORDER BY created_at DESC LIMIT 50').all();
  return {licenses:results,configured:Boolean(b.LOVABLE_LICENSE_API_KEY),prefix:b.LOVABLE_LICENSE_PREFIX||'VALZY'};
 }
 if(!url.pathname.endsWith('/generate')||request.method!=='POST')throw fail('Endpoint tidak ditemukan',404);
 if(!b.LOVABLE_LICENSE_API_KEY)throw fail('Simpan API key lisensi di Pengaturan terlebih dahulu',503);
 const data=await body(request),input=generationInput(data),id=String(data.requestId||'');if(!/^[a-f0-9-]{36}$/.test(id))throw fail('requestId wajib UUID');
 const prefix=b.LOVABLE_LICENSE_PREFIX||'VALZY';if(!/^[A-Z][A-Z0-9]{1,15}$/.test(prefix))throw fail('Prefix server tidak valid');
 const fingerprint=hash(JSON.stringify({input,durationValue:data.durationValue,durationUnit:data.durationUnit,prefix}));
 const previous=await b.DB.prepare('SELECT * FROM extension_licenses WHERE id=?').bind(id).first();
 if(previous){if(previous.request_hash!==fingerprint)throw fail('ID permintaan sudah dipakai untuk konfigurasi lain',409);if(previous.state==='ready')return {ok:true,license_key:await decrypt(previous.alias_cipher,encryption(b)),plan:previous.plan,expires_at:previous.expires_at,replayed:true};throw fail('Permintaan sudah diproses atau menunggu pemeriksaan. Jangan mengirim ulang otomatis.',409)}
 const inserted=await b.DB.prepare("INSERT OR IGNORE INTO extension_licenses(id,request_hash,state,plan,email,duration_value,duration_unit,max_activations,created_at) VALUES(?,?,'pending',?,?,?,?,?,?)").bind(id,fingerprint,input.plan,input.email||null,input.plan==='Pro'?data.durationValue||1:null,input.plan==='Pro'?data.durationUnit||'month':null,input.maxActivations,Date.now()).run();if(!inserted.meta.changes)throw fail('Permintaan sedang diproses',409);
 let response,payload;
 try{response=await fetch(origin+'/api/v1/license/generate',{method:'POST',headers:{Authorization:'Bearer '+b.LOVABLE_LICENSE_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(input),redirect:'manual',signal:AbortSignal.timeout(20000)});payload=await response.json()}catch{await b.DB.prepare("UPDATE extension_licenses SET state='unknown' WHERE id=?").bind(id).run();throw fail('Respons penyedia belum dapat dipastikan. Periksa riwayat penyedia sebelum membuat ulang.',502)}
 if(!response.ok||payload.ok!==true||typeof payload.license_key!=='string'||payload.license_key.length>300||payload.plan!==input.plan||!Number.isFinite(Date.parse(payload.expires_at))){await b.DB.prepare("UPDATE extension_licenses SET state='failed' WHERE id=?").bind(id).run();throw fail('Penyedia menolak atau mengembalikan respons lisensi tidak valid',502)}
 const alias=prefix+'-'+Array.from(crypto.getRandomValues(new Uint8Array(24)),v=>v.toString(16).padStart(2,'0')).join('').toUpperCase().match(/.{8}/g).join('-');
 await b.DB.prepare("UPDATE extension_licenses SET state='ready',key_hash=?,key_hint=?,alias_cipher=?,provider_cipher=?,expires_at=? WHERE id=?").bind(hash(alias),prefix+'-…'+alias.slice(-8),await encrypt(alias,encryption(b)),await encrypt(payload.license_key,encryption(b)),payload.expires_at,id).run();
 return {ok:true,license_key:alias,plan:payload.plan,expires_at:payload.expires_at,duration_minutes:payload.duration_minutes};
}
export async function licenseResponse(request,b){
 const url=new URL(request.url);
 if(url.pathname==='/downloads/VALZY-Studio.zip'){
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405});
  const object=await b.IMAGES_BUCKET.get('extension-packages/VALZY-Studio.zip');if(!object)return new Response('Package unavailable',{status:404});
  return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="VALZY-Studio.zip"','Content-Length':String(object.size),'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','ETag':object.httpEtag}});
 }
 if(url.pathname==='/license/v1/runtime'){
  const headers={'Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','X-Content-Type-Options':'nosniff'};
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='GET')return Response.json({error:'GET required'},{status:405,headers});
  const version=url.searchParams.get('version')||'6.0';
  if(!/^\d{1,3}(?:\.\d{1,3}){0,3}$/.test(version))return Response.json({error:'Invalid version'},{status:400,headers});
  try{
   const response=await fetch(origin+'/api/v1/extension/v5?version='+encodeURIComponent(version),{headers:{Accept:'application/json','User-Agent':'VALZY-Studio/1.0'},redirect:'manual',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('upstream');
   const text=await response.text();if(text.length>1000000)throw new Error('size');
   const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('payload');
   return Response.json({...data,notifications:await publishedNotifications(b.DB)},{headers});
  }catch{return Response.json({error:'Runtime configuration temporarily unavailable'},{status:502,headers})}
 }
 if(url.pathname!=='/license/v1/validate')return null;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
 const caller=request.headers.get('Origin');if(caller&&/^chrome-extension:\/\/[a-p]{32}$/.test(caller)){headers['Access-Control-Allow-Origin']=caller;headers.Vary='Origin';headers['Access-Control-Allow-Headers']='Content-Type';headers['Access-Control-Allow-Methods']='POST, OPTIONS'}
 const json=(value,status=200)=>Response.json(value,{status,headers});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return json({ok:false,error:'POST required'},405);
 try{
  if(Number(request.headers.get('Content-Length'))>8192)throw fail('Payload terlalu besar',413);
  const text=await request.text();if(text.length>8192)throw fail('Payload terlalu besar',413);const data=JSON.parse(text),key=normalize(data.key||data.licenseKey);
  if(data.key&&data.licenseKey&&normalize(data.key)!==normalize(data.licenseKey))throw fail('License keys berbeda');
  if(!/^[A-Z][A-Z0-9]{1,15}(?:-[A-F0-9]{8}){6}$/.test(key))throw fail('Lisensi tidak valid',401);
  if(b.COORDINATOR){const limit=await b.COORDINATOR.get(b.COORDINATOR.idFromName('license-validation')).fetch('https://control.internal/security',{method:'POST',body:JSON.stringify({kind:'rate',key:'license:'+request.headers.get('CF-Connecting-IP'),windowMs:60000,limit:30})});if(!limit.ok||!(await limit.json()).allowed)throw fail('Terlalu banyak permintaan',429)}
  await ready(b.DB);const row=await b.DB.prepare("SELECT * FROM extension_licenses WHERE key_hash=? AND state='ready'").bind(hash(key)).first();if(!row)throw fail('Lisensi tidak valid',401);if(Date.parse(row.expires_at)<=Date.now())throw fail('Lisensi sudah kedaluwarsa',403);
  const email=String(data.email||'').trim().toLowerCase();if(row.email&&row.email!==email)throw fail('Email tidak sesuai dengan lisensi',403);
  const upstream=await decrypt(row.provider_cipher,encryption(b));
  const response=await fetch(origin+'/api/v1/licenses/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:upstream,licenseKey:upstream,email,deviceId:String(data.deviceId||'').slice(0,200),extensionVersion:String(data.extensionVersion||'').slice(0,40),heartbeat:data.heartbeat===true}),redirect:'manual',signal:AbortSignal.timeout(20000)});
  const payload=await response.json();if(!response.ok||payload.ok!==true)return json({ok:false,error:'Validasi lisensi ditolak penyedia',reason:'provider_rejected'},response.status>=400&&response.status<500?response.status:502);
  // Preserve the provider's signed attestation exactly. The client verifies it
  // against the real per-customer credential, never the global generation key.
  return json({...payload,config:{...payload.config,brandName:(b.LOVABLE_LICENSE_PREFIX||'VALZY')+' Studio',brandText:(b.LOVABLE_LICENSE_PREFIX||'VALZY')+' Studio'},upstream_license:upstream});
 }catch(error){return json({ok:false,error:error.status?error.message:'Layanan validasi belum tersedia'},error.status||502)}
}
