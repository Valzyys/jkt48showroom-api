export class JKT48SourceError extends Error {
  constructor(message,{status=502,code='JKT48_UPSTREAM_ERROR',upstreamStatus,retryAfter}={}) {
    super(message);this.name='JKT48SourceError';this.status=status;this.code=code;
    this.upstreamStatus=upstreamStatus;this.retryAfter=retryAfter;
  }
}
const failure=(message,status=502,code,upstreamStatus)=>new JKT48SourceError(message,{status,code,upstreamStatus});
export function boundedInteger(value,fallback,min,max) {
  const number=Number(value);
  return Number.isFinite(number)?Math.max(min,Math.min(max,Math.floor(number))):fallback;
}
export function pagination(page,perpage,total,max=30) {
  const size=boundedInteger(perpage,10,1,max);
  return {page:boundedInteger(page,1,1,Math.max(1,Math.ceil(total/size))),perpage:size};
}
export function createJKT48Client({base='https://jkt48.com/api/v1/',fetcher=fetch,headers={},timeout=15000}={}) {
  const origin=new URL(base.endsWith('/')?base:base+'/');
  if(origin.protocol!=='https:'||origin.username||origin.password)throw failure('JKT48_API_BASE must be an HTTPS URL',503,'JKT48_SOURCE_CONFIGURATION_ERROR');
  return async(resource,query={})=>{
    const url=new URL(resource,origin);
    url.searchParams.set('lang','id');
    for(const [name,value]of Object.entries(query))url.searchParams.set(name,String(value));
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),boundedInteger(timeout,15000,1000,30000));
    try {
      const response=await fetcher(url.href,{headers:{Accept:'application/json',...headers},signal:controller.signal});
      if(!response.ok)throw failure(`JKT48 upstream returned HTTP ${response.status}${response.status===403||response.status===429?'. Configure an authorized HTTPS relay with JKT48_PROXY_URL or an accessible JKT48_API_BASE.':''}`,502,'JKT48_UPSTREAM_HTTP_ERROR',response.status);
      const reader=response.body.getReader();let size=0;const chunks=[];
      while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw failure('JKT48 response exceeds 2 MB');}chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      let payload;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw failure('JKT48 upstream did not return valid JSON',502,'JKT48_UPSTREAM_INVALID_JSON');}
      if(payload?.status!==true||payload.data==null)throw failure('JKT48 upstream reported an unsuccessful response');
      return payload;
    } catch(error) {
      if(error.status)throw error;
      throw failure(controller.signal.aborted?'JKT48 upstream timed out':'JKT48 upstream request failed',controller.signal.aborted?504:502,controller.signal.aborted?'JKT48_UPSTREAM_TIMEOUT':'JKT48_UPSTREAM_NETWORK_ERROR');
    } finally {clearTimeout(timer);}
  };
}
export function listData(payload) {
  if(!Array.isArray(payload.data))throw failure('Unexpected JKT48 list response');
  return payload.data;
}
export function detailData(payload) {
  const data=payload.data?.result??payload.data;
  if(!data||typeof data!=='object'||Array.isArray(data))throw failure('Unexpected JKT48 detail response');
  return data;
}
export function jakartaTime(date,clock) {
  if(!date)return undefined;
  const instant=new Date(date);
  if(!Number.isFinite(instant.getTime()))throw failure('Invalid JKT48 schedule date');
  if(!clock)return instant.toISOString();
  if(/^\d{4}-/.test(clock)){const value=new Date(clock);if(!Number.isFinite(value.getTime()))throw failure('Invalid JKT48 schedule time');return value.toISOString();}
  if(!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(clock))throw failure('Invalid JKT48 schedule time');
  const day=new Date(instant.getTime()+7*3600000).toISOString().slice(0,10);
  return new Date(`${day}T${clock.length===5?clock+':00':clock}+07:00`).toISOString();
}
export function normalizeSchedule(raw) {
  const id=Number(raw.schedule_id);
  if(!Number.isSafeInteger(id)||id<1||typeof raw.title!=='string')throw failure('Invalid JKT48 schedule record');
  const type=String(raw.type||'schedule').toLowerCase();
  const code=String(raw.code||raw.reference_code||'');
  const members=Array.isArray(raw.jkt48_member)?raw.jkt48_member:undefined;
  const result={...raw,schedule_id:id,type,code,title:raw.title,date:jakartaTime(raw.date),start_time:jakartaTime(raw.date,raw.start_time),end_time:jakartaTime(raw.date,raw.end_time)};
  if(!result.link)result.link=type==='show'?`https://jkt48.com/purchase/schedule/show?code=${encodeURIComponent(code)}`:type==='event'?`https://jkt48.com/purchase/schedule/event?code=${encodeURIComponent(code)}`:type==='exclusive'?`https://jkt48.com/purchase/exclusive?code=${encodeURIComponent(code)}`:`https://jkt48.com/schedule/${encodeURIComponent(raw.link||String(id))}`;
  if(members){result.jkt48_member=members;result.birthday_member=Array.isArray(raw.birthday_member)?raw.birthday_member:members.filter(member=>(raw.birthday_member_name||[]).includes(member.name));}
  return Object.fromEntries(Object.entries(result).filter(([,value])=>value!==undefined));
}
export async function syncJKT48Dataset(dataset,{client,repository,state={},now=new Date(),options={}}) {
  const detailLimit=boundedInteger(options.detailLimit,20,1,30);
  let count=0,detailFailures=0,cursor=state.cursor||0;
  const detail=async(resource,query)=>{try{return detailData(await client(resource,query));}catch{detailFailures++;return null;}};
  if(dataset==='news') {
    const pages=boundedInteger(options.newsPages,3,1,10);
    for(let page=1;page<=pages;page++) {
      const payload=await client('news',{page});
      const rows=listData(payload);
      for(const row of rows){if(!Number.isSafeInteger(Number(row.news_id))||Number(row.news_id)<1||!row.link||typeof row.title!=='string')throw failure('Invalid JKT48 news record');await repository.news({...row,news_id:Number(row.news_id)});count++;}
      if(!rows.length||page>=Number(payload._meta?.total_page||page))break;
    }
  } else if(dataset==='schedules') {
    const months=boundedInteger(options.scheduleMonths,3,1,6);
    const local=new Date(now.getTime()+7*3600000),rows=new Map();
    for(let offset=-1;offset<months-1;offset++) {
      const month=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()+offset,1));
      for(const row of listData(await client('schedules',{year:month.getUTCFullYear(),month:month.getUTCMonth()+1})))rows.set(row.schedule_id,row);
    }
    const schedules=[...rows.values()];
    for(const row of schedules){await repository.schedule(normalizeSchedule(row));count++;}
    for(let index=0;index<Math.min(detailLimit,schedules.length);index++) {
      const row=schedules[(cursor+index)%schedules.length],type=String(row.type).toLowerCase(),code=row.reference_code||row.code;
      const resource={show:'theater-shows',event:'events',exclusive:'exclusives'}[type];
      if(!resource||!code)continue;
      const data=await detail(`${resource}/${encodeURIComponent(code)}`);
      if(data)await repository.schedule(normalizeSchedule({...row,...data,schedule_id:row.schedule_id,type:row.type}));
    }
    cursor=schedules.length?(cursor+detailLimit)%schedules.length:0;
  } else if(dataset==='members') {
    const rows=listData(await client('members'));
    for(const row of rows){await repository.member(row);count++;}
    for(let index=0;index<Math.min(detailLimit,rows.length);index++) {
      const row=rows[(cursor+index)%rows.length],id=row.jkt48_member_id??row.member_id;
      const data=await detail(`members/${encodeURIComponent(id)}`);
      if(data)await repository.member({...row,...data});
    }
    cursor=rows.length?(cursor+detailLimit)%rows.length:0;
  } else throw failure('Unknown JKT48 dataset',400);
  return {count,detailFailures,cursor,syncedAt:now.toISOString()};
}
