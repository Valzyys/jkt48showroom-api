import { createJKT48Client,detailData } from '@/runtime/jkt48-source';
import { env } from '@/runtime/env';
export async function getTheaterDetail(code,_retry=0,headers) {
  const client=createJKT48Client({base:env.JKT48_API_BASE||'https://jkt48.com/api/v1/',headers,timeout:env.UPSTREAM_TIMEOUT_MS});
  const data=detailData(await client(`theater-shows/${encodeURIComponent(code)}`));
  const members=data.jkt48_member||[];
  return {show:[{...data,id:data.code||code,title:data.title,memberIds:members.map(member=>String(member.member_id)),seitansaiIds:members.filter(member=>(data.birthday_member_name||[]).includes(member.name)).map(member=>String(member.member_id))}],members:members.map(member=>({id:String(member.member_id),name:member.name,url:`https://jkt48.com/member/detail?member=${member.member_id}`}))};
}
