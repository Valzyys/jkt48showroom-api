/** Per-destination filters. One shared catalogue, never a poll per channel. */
const fs=require('node:fs'),path=require('node:path');
const FILTER_KINDS=new Set(['live','recent','x','tiktok','instagram']);
const normal=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const slug=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
let catalogue=[],until=0,inflight;
const file=()=>path.join(__dirname,'Discord/channel/member-catalog.json');
try{const saved=JSON.parse(fs.readFileSync(file(),'utf8'));if(Array.isArray(saved.members))catalogue=saved.members}catch{}
function identityKeys(value={}){
 value??={};
 return [...new Set([value._id,value.id,value.member,value.url,value.url_key,value.slug,value.name,value.fullname,value.nickname,value.username,...(value.nicknames||[]),...(value.aliases||[])].filter(v=>typeof v==='string'||typeof v==='number').map(normal).filter(Boolean))];
}
function eventKeys(kind,row={}){
 const result=[...identityKeys(row.member),...identityKeys(row.room_info)];
 if(['live','recent'].includes(kind))result.push(...identityKeys({name:row.name,fullname:row.fullname,nickname:row.nickname,url_key:row.url_key}),normal(row.room_id),normal(row.idn?.username));
 if(['x','tiktok','instagram'].includes(kind))result.push(normal(row.author?.username));
 return [...new Set(result.filter(Boolean))];
}
function allowsKeys(destination,keys,members=catalogue){
 if(destination.member_ids==null)return true;
 if(!Array.isArray(destination.member_ids)||!keys?.length)return false;
 const observed=new Set(keys);
 return destination.member_ids.some(id=>{
  const member=members.find(m=>m.id===id);
  return [normal(id),...(member?.aliases||[])].some(k=>observed.has(k));
 });
}
function allows(destination,kind,row){return !FILTER_KINDS.has(kind)||allowsKeys(destination,eventKeys(kind,row))}
function mergeCatalogues(lists){
 const members=[],index=new Map();
 for(const list of lists)for(const m of list||[]){
  if(!m?.name)continue;const aliases=identityKeys(m);if(m.room_id!=null)aliases.push(normal(m.room_id));for(const id of m.archive_room_ids||[])aliases.push(normal(id));if(m.idn_username)aliases.push(normal(m.idn_username));
  const id=slug(m.url||m.member||m.slug||m.id||m.name);if(!id)continue;
  // Match complete names/identifiers, not substrings or caption text.
  let found=index.get(normal(id))||index.get(normal(m.name));
  if(!found){found={id,name:String(m.name),nicknames:m.nicknames||[],img:m.img||m.img_alt||null,aliases:[]};members.push(found)}
  found.aliases=[...new Set([...found.aliases,...aliases,normal(id)])];
  for(const key of [normal(id),normal(m.name),normal(m._id)])if(key)index.set(key,found);
 }
 return members.sort((a,b)=>a.name.localeCompare(b.name,'id'));
}
async function getCatalog(){
 if(until>Date.now()&&catalogue.length)return catalogue;if(inflight)return inflight;
 inflight=(async()=>{
  const {api,rows}=require('./api.cjs');
  const results=await Promise.allSettled(['/api/member?group=jkt48','/api/x/members','/api/tiktok/members','/api/instagram/members'].map(p=>api.get(p,600000)));
  const lists=results.map(r=>r.status==='fulfilled'?rows(r.value,'members'):[]);
  const merged=mergeCatalogues(lists);
  if(!merged.length){if(catalogue.length){until=Date.now()+60000;return catalogue}throw Error('member_catalog_unavailable')}
  // Retain aliases while one source is temporarily unavailable.
  for(const m of merged){const old=catalogue.find(x=>x.id===m.id);if(old)m.aliases=[...new Set([...m.aliases,...old.aliases])];}
  catalogue=merged;until=Date.now()+600000;
  const dest=file(),tmp=dest+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify({members:catalogue}),{mode:0o600});fs.renameSync(tmp,dest);
  return catalogue;
 })();try{return await inflight}finally{inflight=null}
}
function publicCatalog(members=catalogue){return members.map(({id,name,nicknames,img})=>({id,name,nicknames,img}))}
module.exports={FILTER_KINDS,normal,eventKeys,allowsKeys,allows,mergeCatalogues,getCatalog,publicCatalog};
