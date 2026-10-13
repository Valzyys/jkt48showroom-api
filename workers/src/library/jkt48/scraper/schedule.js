import { createJKT48Client,listData,normalizeSchedule } from '@/runtime/jkt48-source';
import { env } from '@/runtime/env';
export async function getCalendarEvents(date,headers) {
  const request=createJKT48Client({base:env.JKT48_API_BASE||'https://jkt48.com/api/v1/',headers,timeout:env.UPSTREAM_TIMEOUT_MS});
  return listData(await request('schedules',{year:date.getUTCFullYear(),month:date.getUTCMonth()+1})).map(row=>{
    const data=normalizeSchedule(row);
    return {...data,id:String(data.schedule_id),url:data.link,label:data.jkt48_member_type||data.type,date:new Date(data.start_time||data.date)};
  });
}
export async function getCalendarEventsByUrl(url,_retry=0,headers) {
  const match=url.match(/\/y\/(\d{4})\/m\/(\d{1,2})\//);
  if(!match)throw new Error('Calendar URL must contain a year and month');
  return getCalendarEvents(new Date(Date.UTC(Number(match[1]),Number(match[2])-1,1)),headers);
}
export async function getAllCalendar() {
  const now=new Date(Date.now()+7*3600000),months=Math.max(1,Math.min(6,Number(env.JKT48_SCHEDULE_MONTHS)||3));
  return Array.from({length:months},(_,index)=>{const date=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+index-1,1));return `/calendar/list/y/${date.getUTCFullYear()}/m/${date.getUTCMonth()+1}/d/1`;});
}
export async function getAllCalendarEvents(headers) {
  const events=[];
  for(const url of await getAllCalendar())events.push(...await getCalendarEventsByUrl(url,0,headers));
  return events;
}
