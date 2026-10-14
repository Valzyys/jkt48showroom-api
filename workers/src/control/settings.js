const vars = {
  COLLECTOR_RECORD_VIDEO:['Live collector','Rekam video penuh langsung ke R2: true/false'],COLLECTOR_ENABLED:['Live collector','Collector live aktif: true/false'],COLLECTOR_POLL_SECONDS:['Live collector','Interval deteksi sesi, 15–300 detik'],COLLECTOR_SCREENSHOT_SECONDS:['Live collector','Interval screenshot, 30–600 detik'],COLLECTOR_SCREENSHOT_WIDTH:['Live collector','Lebar screenshot, 320–1280 piksel'],COLLECTOR_MAX_SESSIONS:['Live collector','Maksimal sesi bersamaan, 1–8'],
  ORIGINS:['Frontend & akses','Origin frontend, dipisahkan koma'],SECONDARY_ORIGINS:['Frontend & akses','Origin tambahan; bypass signature publik untuk recent'],DEFAULT_ORIGIN:['Frontend & akses','Origin frontend default'],ADMIN_IDS:['Frontend & akses','ID user Showroom admin, dipisahkan koma'],
  SHOWROOM_API:['Showroom & live','Base URL HTTPS Showroom'],PROXY_URL:['Showroom & live','Prefix relay HTTPS Showroom'],STREAM_ALLOWED_HOSTS:['Showroom & live','Host streaming yang diizinkan, dipisahkan koma'],LIVE_REFRESH_SECONDS:['Showroom & live','Interval refresh live dalam detik'],ENABLE_COMPETITION_CRON:['Showroom & live','Aktifkan cron competition: true/false'],ENABLE_MONTHLY_STATS_CRON:['Showroom & live','Aktifkan cron statistik: true/false'],
  JKT48_AUTO_SYNC:['JKT48 & scraper','Sinkronisasi otomatis: true/false'],JKT48_API_BASE:['JKT48 & scraper','Base URL JSON JKT48 HTTPS'],JKT48_PROXY_URL:['JKT48 & scraper','Relay JSON JKT48 HTTPS'],JKT48_SCRAPER_URL:['JKT48 & scraper','Base URL HTTPS scraper privat'],JKT48_SYNC_SECONDS:['JKT48 & scraper','Interval sinkronisasi, 300–86400 detik'],JKT48_NEWS_PAGES:['JKT48 & scraper','Jumlah halaman berita, 1–10'],JKT48_SCHEDULE_MONTHS:['JKT48 & scraper','Rentang bulan jadwal, 1–6'],JKT48_DETAIL_LIMIT:['JKT48 & scraper','Detail per dataset, 1–30'],
  MAX_QUERY_DOCUMENTS:['Runtime','Batas dokumen per query, 1–50000'],UPSTREAM_TIMEOUT_MS:['Runtime','Timeout request, 1000–30000 ms'],LOG:['Runtime','Log aplikasi: true/false'],SHOW_IP:['Runtime','Catat IP pada log: true/false'],DISABLE_SCREENSHOTS:['Runtime','Nonaktifkan screenshot'],HALF_SCREENSHOTS:['Runtime','Kurangi screenshot'],
  CLOUDINARY_CLOUD_NAME:['Media & layanan','Nama cloud Cloudinary'],IMAGE_PUBLIC_URL:['Media & layanan','Base URL publik upload R2'],JKT48V_YT_IDS:['Media & layanan','ID kanal YouTube JKT48V, dipisahkan koma'],
  COMMENT_COOLDOWN:['Showroom & live','Cooldown komentar dalam ms'],COMMENT_MAX_REQUEST:['Showroom & live','Batas request komentar bersamaan']
};
const secrets={
  IDN_WEB_CLIENT_KEY:['IDN authentication','Client key web IDN untuk membaca katalog gift resmi.'],IDN_REFRESH_TOKEN:['IDN authentication','Refresh token Cognito milik akun IDN; JWT diperbarui otomatis di server.'],IDN_COGNITO_CLIENT_ID:['IDN authentication','Client ID Cognito harus sama dengan aplikasi yang menerbitkan refresh token.'],
  COLLECTOR_TOKEN:['Live collector','Token privat VPS collector; harus sama dengan token pada VPS.'],
  API_KEY:['API key & token','Key server untuk recent, weekly dan collector. Mengubah key membatalkan key sebelumnya.'],
  AUTH_SECRET:['API key & token','Secret JWT user; perubahan membatalkan token user lama.'],JWT_SECRET:['API key & token','Secret JWT/signature; perubahan membatalkan token JWT lama.'],SECRET:['API key & token','Kunci aplikasi AES, tepat 32 karakter ASCII; perubahan berdampak pada data terenkripsi.'],
  JKT48_SCRAPER_TOKEN:['JKT48 & scraper','Harus sama dengan token pada VPS; panel tidak mengubah token VPS.'],
  CLOUDINARY_API_KEY:['Media & layanan','API key Cloudinary'],CLOUDINARY_API_SECRET:['Media & layanan','API secret Cloudinary'],YOUTUBE_KEY:['Media & layanan','API key YouTube'],YOUTUBE_JKT48:['Media & layanan','Konfigurasi kanal YouTube JKT48'],SAWERIA_KEY:['Media & layanan','Secret Saweria'],SIGNATURE_SECRETS:['API key & token','source:secret,... untuk HMAC per source'],SR_ID:['Showroom & live','Session Showroom opsional']
};
export const definitions = Object.entries({...vars,...secrets}).map(([name,[group,description]])=>({name,group,description,secret:name in secrets}));
const specification=new Map(definitions.map(item=>[item.name,item]));
const encoder=new TextEncoder();
const b64=bytes=>btoa(String.fromCharCode(...bytes));
const unb64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const caches=new WeakMap();
async function encryptionKey(secret){return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function encrypt(value,secret){const iv=crypto.getRandomValues(new Uint8Array(12));return b64(iv)+'.'+b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await encryptionKey(secret),encoder.encode(value))));}
async function decrypt(value,secret){const [iv,data]=value.split('.');return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await encryptionKey(secret),unb64(data)));}
export function clearSettingsCache(bindings){if(bindings.DB)caches.delete(bindings.DB);}
export async function effectiveBindings(bindings){
  if(!bindings.DB || !bindings.CONTROL_SESSION_SECRET)return bindings;
  let cached=caches.get(bindings.DB);
  if(!cached || cached.until<Date.now()){
    const {results}=await bindings.DB.prepare('SELECT name,value,is_secret FROM control_settings').all();
    const values={};for(const row of results){if(specification.has(row.name))values[row.name]=row.is_secret?await decrypt(row.value,bindings.CONTROL_SESSION_SECRET):row.value;}
    cached={values,until:Date.now()+10000};caches.set(bindings.DB,cached);
  }
  return {...bindings,...cached.values};
}
export async function settingsView(bindings){
  const effective=await effectiveBindings(bindings);
  const {results}=await bindings.DB.prepare('SELECT name,updated_at FROM control_settings').all();
  const saved=new Map(results.map(row=>[row.name,row.updated_at]));
  return definitions.map(item=>({...item,value:item.secret?'':String(effective[item.name]??''),configured:Boolean(effective[item.name]),source:saved.has(item.name)?'control':'deployment',updatedAt:saved.get(item.name)||null}));
}
function validate(name,value){
  const definition=specification.get(name);
  if(!definition || typeof value!=='string' || value.length>(name==='IDN_REFRESH_TOKEN'?8192:4096))throw Object.assign(new Error('Pengaturan tidak valid: '+name),{status:400});
  if(['SECRET','AUTH_SECRET','JWT_SECRET','API_KEY','JKT48_SCRAPER_TOKEN','COLLECTOR_TOKEN'].includes(name)){
    if(name==='SECRET'?!/^[\x20-\x7e]{32}$/.test(value):value.length<32||value.length>256||!/^[\x21-\x7e]+$/.test(value))throw Object.assign(new Error('Format secret tidak valid: '+name),{status:400});
  }
  const bounds={COLLECTOR_POLL_SECONDS:[15,300],COLLECTOR_SCREENSHOT_SECONDS:[30,600],COLLECTOR_SCREENSHOT_WIDTH:[320,1280],COLLECTOR_MAX_SESSIONS:[1,8],JKT48_SYNC_SECONDS:[300,86400],JKT48_NEWS_PAGES:[1,10],JKT48_SCHEDULE_MONTHS:[1,6],JKT48_DETAIL_LIMIT:[1,30],MAX_QUERY_DOCUMENTS:[1,50000],UPSTREAM_TIMEOUT_MS:[1000,30000],LIVE_REFRESH_SECONDS:[30,86400],COMMENT_COOLDOWN:[1000,3600000],COMMENT_MAX_REQUEST:[1,100]};
  if(bounds[name] && (!/^\d+$/.test(value)||Number(value)<bounds[name][0]||Number(value)>bounds[name][1]))throw Object.assign(new Error('Nilai di luar batas: '+name),{status:400});
  if(['COLLECTOR_RECORD_VIDEO','COLLECTOR_ENABLED','DISABLE_SCREENSHOTS','HALF_SCREENSHOTS','JKT48_AUTO_SYNC','LOG','SHOW_IP','ENABLE_COMPETITION_CRON','ENABLE_MONTHLY_STATS_CRON'].includes(name)&&!['true','false',''].includes(value))throw Object.assign(new Error('Gunakan true atau false: '+name),{status:400});
  if(['SHOWROOM_API','JKT48_API_BASE','JKT48_SCRAPER_URL','IMAGE_PUBLIC_URL'].includes(name)&&value){let url;try{url=new URL(value);}catch{}if(!url||url.protocol!=='https:'||url.username||url.password)throw Object.assign(new Error('URL HTTPS tidak valid: '+name),{status:400});}
  if(['ORIGINS','SECONDARY_ORIGINS','DEFAULT_ORIGIN'].includes(name))for(const origin of value.split(',').filter(Boolean)){let url;try{url=new URL(origin.trim());}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.origin!==origin.trim())throw Object.assign(new Error('Origin tidak valid: '+name),{status:400});}
  return definition;
}
export async function saveSettings(bindings,changes){
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||Object.keys(changes).length>definitions.length)throw Object.assign(new Error('Payload pengaturan tidak valid'),{status:400});
  const entries=Object.entries(changes).map(([name,value])=>({name,value,definition:value===null?specification.get(name):validate(name,value)}));
  if(entries.some(item=>!item.definition))throw Object.assign(new Error('Pengaturan tidak dikenal'),{status:400});
  const statements=[];
  for(const {name,value,definition}of entries){
    if(value===null)statements.push(bindings.DB.prepare('DELETE FROM control_settings WHERE name=?').bind(name));
    else statements.push(bindings.DB.prepare('INSERT INTO control_settings(name,value,is_secret,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value,is_secret=excluded.is_secret,updated_at=excluded.updated_at').bind(name,definition.secret?await encrypt(value,bindings.CONTROL_SESSION_SECRET):value,definition.secret?1:0,Date.now()));
  }
  if(statements.length)await bindings.DB.batch(statements);
  clearSettingsCache(bindings);
  if(entries.length)await bindings.DB.prepare('DELETE FROM cache_entries').run();
  return entries.map(item=>item.name);
}
