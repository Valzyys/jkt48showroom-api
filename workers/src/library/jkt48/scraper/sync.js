import { createHash } from 'node:crypto';
import { kebabCase } from 'lodash';
import { binding,env } from '@/runtime/env';
import { boundedInteger,createJKT48Client,detailData,JKT48SourceError,normalizeSchedule,syncJKT48Dataset } from '@/runtime/jkt48-source';
import { syncIssue,unavailable } from '@/runtime/sync-errors';
import News from '@/database/showroomDB/jkt48/JKT48NewNews';
import Schedule from '@/database/showroomDB/jkt48/JKT48NewSchedule';
import Event from '@/database/showroomDB/jkt48/JKT48Event';
import Member from '@/database/showroomDB/jkt48/Member';
import IdolMember from '@/database/schema/48group/IdolMember';
import ProfileMember from '@/database/schema/48group/Member';
import Setlist from '@/database/showroomDB/jkt48/Setlist';
import EventDetail from '@/database/showroomDB/jkt48/EventDetail';
import { getJKT48Headers } from './headers';
import { createJKT48Transport } from '@/runtime/scrape-target';
import { createSourceStore } from '@/runtime/source-store';

const identity=(kind,id)=>createHash('sha256').update(`jkt48:${kind}:${id}`).digest('hex').slice(0,24);
const upsert=(model,key,data)=>model.updateOne(key,{$set:data,$setOnInsert:{_id:identity(model.modelName,Object.values(key)[0])}},{upsert:true});
export async function sourceClient() {
  return createJKT48Client({...createJKT48Transport(env),headers:env.JKT48_SCRAPER_URL?{}:await getJKT48Headers(),timeout:env.UPSTREAM_TIMEOUT_MS});
}
export async function createRepository(dataset) {
 const store=createSourceStore(binding('DB'));
 const idols=dataset==='members'?await IdolMember.find({group:{$in:['jkt48','official']}}).lean():[];
 const profiles=dataset==='members'?await ProfileMember.find({group:'jkt48'}).lean():[];
 const save=(model,key,data)=>store.upsert(model,key,data,model===Schedule?{jkt48_member:[],birthday_member:[],graduation_member:[]}:model===Event?{memberIds:[]}:model===Setlist?{gallery:[],songs:[]}:{});
 return {
  flush:store.flush,
  news:async raw=>{
    const data={...raw};if(!data.content_body)delete data.content_body;
    save(News,{news_id:raw.news_id},data);
  },
  async schedule(raw) {
    save(Schedule,{schedule_id:raw.schedule_id},raw);
    const id=raw.title.toLowerCase().replaceAll(' ','').trim();
    if(raw.type==='show')save(Setlist,{id},{title:raw.title,...(raw.set_list?{setlist_id:raw.set_list}:{}),...(raw.background_image?{poster:raw.background_image}:{}),...(raw.content_body?{description:raw.content_body}:{})});
    if(raw.type==='event') {
      save(EventDetail,{id},{title:raw.title,...(raw.background_image?{poster:raw.background_image}:{})});
      save(Event,{id:String(raw.schedule_id)},{title:raw.title,url:raw.link,eventId:id,date:raw.start_time||raw.date,...(raw.jkt48_member?{memberIds:raw.jkt48_member.map(member=>member.member_id)}:{})});
    }
    for(const member of raw.jkt48_member||[])save(Member,{id:String(member.member_id)},{name:member.name,url:`https://jkt48.com/member/detail?member=${kebabCase(member.name)}-${member.member_id}`});
  },
  async member(raw) {
    const id=raw.jkt48_member_id??raw.member_id;
    if(!Number.isSafeInteger(Number(id))||Number(id)<1||!raw.name)throw Object.assign(new Error('Invalid JKT48 member record'),{status:502});
    // Match names before official IDs: the new site renumbered legacy members.
    const old=idols.find(member=>member.name?.toLowerCase()===raw.name.toLowerCase());
    const key=old?{_id:old._id}:{_id:identity('member',id)};
    const data={name:raw.name,jkt48id:[...new Set([...(old?.jkt48id||[]),String(id)])]};
    if(!old){data.group='jkt48';data.slug=kebabCase(raw.name);data['info.is_graduate']=false;}
    const fields={'info.img':raw.photo||raw.photo_1,'info.birthdate':raw.birth_date,'info.height':raw.body_height?`${raw.body_height}cm`:undefined,'info.blood_type':raw.blood_type};
    for(const [field,value]of Object.entries(fields))if(value)data[field]=value;
    if(raw.nickname)data['info.nicknames']=[raw.nickname];
    save(IdolMember,key,data);
    save(Member,{id:String(id)},{name:raw.name,url:`https://jkt48.com/member/detail?member=${kebabCase(raw.name)}-${id}`});
    const profile=profiles.find(member=>member.name?.toLowerCase()===raw.name.toLowerCase());
    const profileData={name:raw.name,group:'jkt48',jkt48id:data.jkt48id};
    if(!profile)profileData.isGraduate=false;
    for(const [field,value]of Object.entries({img:raw.photo||raw.photo_1,birthdate:raw.birth_date,nicknames:raw.nickname?[raw.nickname]:undefined,showroom_id:old?.showroom_id}))if(value)profileData[field]=value;
    save(ProfileMember,{_id:profile?._id||identity('profile-member',id)},profileData);
  }
 };
}
const models={news:News,schedules:Schedule,members:IdolMember};
export async function synchronize(dataset,storage,{force=false}={}) {
  if(!models[dataset])throw Object.assign(new Error('Unknown JKT48 dataset'),{status:400});
  const state=await storage.get('jkt48-sync')||{};
  const ttl=boundedInteger(env.JKT48_SYNC_SECONDS,3600,300,86400)*1000;
  if(!force&&state.attemptedAt&&Date.now()-state.attemptedAt<(state.error?300000:ttl)) {
    if(state.error&&!await models[dataset].countDocuments({}))throw unavailable(state);
    return state;
  }
  let phase='database';
  try {
    const repository=await createRepository(dataset);
    const client=await sourceClient();phase='source';
    const result=await syncJKT48Dataset(dataset,{client,repository,state,options:{newsPages:env.JKT48_NEWS_PAGES,scheduleMonths:env.JKT48_SCHEDULE_MONTHS,detailLimit:env.JKT48_DETAIL_LIMIT}});
    phase='persist';
    await repository.flush();
    const next={...result,attemptedAt:Date.now(),error:null,issue:null};
    phase='cache';
    // Empty responses from the old deployment must not survive successful sync.
    await binding('DB').prepare("DELETE FROM cache_entries WHERE key LIKE '%/api/news%' OR key LIKE '%/api/theater%' OR key LIKE '%/api/event%' OR key LIKE '%/api/jkt48event%' OR key LIKE '%/api/next_schedule%' OR key LIKE '%/api/setlist%' OR key LIKE '%/api/member%' OR key LIKE '%/api/birthday%' OR key LIKE '%memberv8' OR key LIKE '%birthday'").run();
    await storage.put('jkt48-sync',next);
    return next;
  } catch(error) {
    const issue=syncIssue(error,phase);
    const next={...state,attemptedAt:Date.now(),error:issue.message,issue};await storage.put('jkt48-sync',next);
    console.error({event:'jkt48-sync-failed',dataset,...issue,errorName:error.name});
    if(!await models[dataset].countDocuments({}))throw unavailable(next);
    return next;
  }
}
export async function ensureJKT48(dataset,{force=false}={}) {
  if(env.JKT48_AUTO_SYNC==='false')return {disabled:true};
  const coordinator=binding('COORDINATOR');
  const response=await coordinator.get(coordinator.idFromName(`jkt48-${dataset}`)).fetch('https://jkt48.internal/jkt48-sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dataset,force})});
  const data=await response.json();
  if(!response.ok) {
    if(typeof data.code==='string'&&data.code.startsWith('JKT48_'))throw new JKT48SourceError(data.message,{status:response.status,code:data.code,upstreamStatus:data.upstream_status,retryAfter:Number(response.headers.get('Retry-After'))||undefined});
    throw new JKT48SourceError('JKT48 synchronization failed. Check Worker logs.',{status:response.status,code:'JKT48_SYNC_ERROR'});
  }
  return data;
}
export async function fetchNewsDetail(id) {
  const existing=await News.findOne({$or:[{link:id},{news_id:Number(id)||-1}]}).lean();
  if(existing?.content_body)return existing;
  const raw=detailData(await (await sourceClient())(`news/${encodeURIComponent(existing?.link||id)}`,{preview:false}));
  const news_id=existing?.news_id||Number(raw.news_id)||Number(id);
  if(!Number.isSafeInteger(news_id)||news_id<1)throw Object.assign(new Error('News ID is missing in upstream response'),{status:502});
  await upsert(News,{news_id},{...raw,news_id});
  return News.findOne({news_id}).lean();
}
export async function fetchScheduleDetail(code,type='show') {
  const row=await Schedule.findOne({code}).lean();
  if(row?.jkt48_member?.length)return row;
  const resource={show:'theater-shows',event:'events',exclusive:'exclusives'}[row?.type||type];
  if(!resource)return row;
  const data=detailData(await (await sourceClient())(`${resource}/${encodeURIComponent(code)}`));
  const schedule_id=row?.schedule_id||data.schedule_id;
  if(!schedule_id)return row;
  const repository=await createRepository('schedules');
  await repository.schedule(normalizeSchedule({...row,...data,schedule_id,type:row?.type||type}));
  await repository.flush();
  return Schedule.findOne({code}).lean();
}
