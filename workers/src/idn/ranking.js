import {getIdnSession} from './auth.js';
// Source totals are cumulative snapshots. Never turn a total delta into invented gift events.
export async function fetchIdnRanking(env,slug,{fetcher=fetch,now=Date.now(),authProvider=getIdnSession}={}){
 if(!/^[a-zA-Z0-9_-]{1,200}$/.test(slug))throw new Error('invalid_slug');
 if(!env.IDN_WEB_CLIENT_KEY)throw new Error('idn_web_key_missing');
 let response;
 for(let attempt=0;attempt<2;attempt++){
  const auth=await authProvider(env,{force:attempt===1});
  response=await fetcher('https://api.idn.app/api/v1/gift/livestream/'+slug+'/top-gifter',{headers:{'x-api-key':env.IDN_WEB_CLIENT_KEY,'access-token':auth.accessToken,Authorization:'Bearer '+auth.idToken,Origin:'https://www.idn.app',Referer:'https://www.idn.app/'},signal:AbortSignal.timeout(10000)});
  if(response.status!==401)break;
 }
 if(!response.ok)throw new Error('idn_ranking_http_'+response.status);
 const body=await response.json();if(!Array.isArray(body?.data))throw new Error('idn_ranking_invalid');
 const ranking=new Map();
 for(const r of body.data){const gold=Number(r.total_gold),id=String(r.uuid||r.username||'');if(!id||id.length>200||!Number.isFinite(gold)||gold<0)continue;ranking.set(id,{user_id:id,username:String(r.username||'').slice(0,200),name:String(r.name||'Viewer').slice(0,300),avatar_url:typeof r.image_url==='string'&&r.image_url.startsWith('https://')?r.image_url.slice(0,2000):'',gold});}
 return {source:'idn_top_gifter',updated_at:new Date(now).toISOString(),users:[...ranking.values()].sort((a,b)=>b.gold-a.gold)};
}
export function idnGoldSummary(log=[],ranking=null,users=[]){
 const aliases=new Map(),people=new Map();
 for(const r of ranking?.users||[]){aliases.set(String(r.user_id),String(r.user_id));if(r.username)aliases.set(String(r.username),String(r.user_id));people.set(String(r.user_id),{id:String(r.user_id),name:r.name,avatar_url:r.avatar_url||'',observed_gold:0,reported_gold:Number(r.gold)||0});}
 for(const g of log){const id=aliases.get(String(g.user_id))||String(g.user_id),user=users.find(u=>String(u.user_id)===String(g.user_id)),r=people.get(id)||{id,name:user?.name||'Viewer',avatar_url:user?.avatar_url||'',observed_gold:0,reported_gold:null};r.observed_gold+=Number(g.total)||0;people.set(id,r)}
 const fans=[...people.values()].map(r=>({...r,gold:r.reported_gold===null?r.observed_gold:r.reported_gold,source:r.reported_gold===null?'observed_chat':'idn_top_gifter'})).filter(r=>r.gold>0||r.observed_gold>0).sort((a,b)=>b.gold-a.gold).map((r,i)=>({...r,rank:i+1}));
 const observed_gold=fans.reduce((n,r)=>n+r.observed_gold,0),reported_gold=ranking?fans.reduce((n,r)=>n+(r.reported_gold||0),0):null,total_gold=fans.reduce((n,r)=>n+r.gold,0);
 return {fans,observed_gold,reported_gold,total_gold,observed_excess_gold:fans.reduce((n,r)=>n+(r.reported_gold===null?0:Math.max(0,r.observed_gold-r.reported_gold)),0),unattributed_gold:fans.reduce((n,r)=>n+Math.max(0,r.gold-r.observed_gold),0),source:ranking?'idn_top_gifter_and_observed_chat':'observed_chat',updated_at:ranking?.updated_at||null};
}
