const encoder=new TextEncoder();
export const COOKIE='__Secure-jkt48-control';
const hex=bytes=>Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
const b64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
function same(a,b){if(a.length!==b.length)return false;let difference=0;for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;}
async function signature(payload,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(payload))));}
export async function verifyPassword(password,stored){
  if(typeof password!=='string'||password.length>256)return false;
  const [algorithm,iterations,salt,digest]=String(stored||'').split('$');
  if(algorithm!=='pbkdf2-sha256'||iterations!=='100000'||!salt||!digest)return false;
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const value=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256);
  return same(hex(new Uint8Array(value)),digest);
}
export async function sessionCookie(bindings){
  const payload=b64url(encoder.encode(JSON.stringify({sub:bindings.CONTROL_ADMIN_EMAIL,exp:Math.floor(Date.now()/1000)+8*3600})));
  return COOKIE+'='+payload+'.'+await signature(payload,bindings.CONTROL_SESSION_SECRET)+'; HttpOnly; Secure; SameSite=Strict; Path=/control; Max-Age=28800';
}
export function logoutCookie(){return COOKIE+'=; HttpOnly; Secure; SameSite=Strict; Path=/control; Max-Age=0';}
export async function authenticated(request,bindings){
  if(!bindings.CONTROL_SESSION_SECRET||!bindings.CONTROL_ADMIN_EMAIL)return false;
  const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  if(!token||token.length>1024)return false;
  try{
    const [payload,mac,...other]=token.split('.');if(other.length||!same(await signature(payload,bindings.CONTROL_SESSION_SECRET),mac||''))return false;
    const json=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
    return json.sub===bindings.CONTROL_ADMIN_EMAIL&&Number.isSafeInteger(json.exp)&&json.exp>Math.floor(Date.now()/1000);
  }catch{return false;}
}
// CSRF token bound to the control session cookie, handed out by /session.
export async function controlCsrf(request,bindings){
  const token=request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);
  return token&&bindings.CONTROL_SESSION_SECRET?(await signature(token+':csrf',bindings.CONTROL_SESSION_SECRET)).slice(0,48):null;
}
