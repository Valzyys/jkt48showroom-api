import {getIdnSession} from './auth.js';
import {IDNGift} from '../database/live/schema/idn/Gift.js';
import {createSourceStore} from '../runtime/source-store.js';
export async function ensureIdnGifts(env){
 if(!env.DB||!env.IDN_WEB_CLIENT_KEY||!env.IDN_REFRESH_TOKEN)return;
 const old=await env.DB.prepare('SELECT expires_at FROM cache_entries WHERE key=?').bind('idn-gift-catalog-v1').first();if(old?.expires_at>Date.now())return;
 try{
  const auth=await getIdnSession(env),response=await fetch('https://api.idn.app/api/v3/gift',{headers:{'x-api-key':env.IDN_WEB_CLIENT_KEY,'access-token':auth.accessToken,Authorization:'Bearer '+auth.idToken,Origin:'https://www.idn.app',Referer:'https://www.idn.app/'},signal:AbortSignal.timeout(15000)});if(!response.ok)return;
  const data=await response.json(),gifts=data?.data?.gift;if(!Array.isArray(gifts)||!gifts.length)return;
  const store=createSourceStore(env.DB);
  for(const gift of gifts){if(typeof gift.slug!=='string'||!gift.image_url?.startsWith('https://cdn.idntimes.com/'))continue;store.upsert(IDNGift,{slug:gift.slug},{name:String(gift.name||'Gift'),gold:Number(gift.gold)||0,image_url:gift.image_url});}
  await store.flush();await env.DB.prepare('INSERT INTO cache_entries(key,value,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires_at=excluded.expires_at').bind('idn-gift-catalog-v1','{}',Date.now()+3600000).run();
 }catch{/* Keep the last known catalogue when the upstream is unavailable. */}
}
