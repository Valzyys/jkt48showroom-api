// Collector changes replace only their own room/session; unrelated groups survive.
export function applyCollectorLive(previous, row, member) {
 const matches=live=>live.group==='jkt48'&&live.type===row.type&&Number(live.room_id)===Number(row.room_id);
 const old=previous.find(matches);
 if(row.capture.status==='completed')return previous.filter(live=>!matches(live)||Date.parse(live.started_at)>Date.parse(row.date.start));
 const live={...old,name:member?.name||row.name,img:member?.info?.img||row.img,url_key:row.url_key,room_id:row.room_id,is_graduate:member?.info?.is_graduate||false,is_group:false,started_at:row.date.start,streaming_url_list:old?.streaming_url_list||[],group:'jkt48',type:row.type,...(row.type==='idn'?{slug:row.idn?.slug||String(row.live_id)}:{})};
 return [...previous.filter(item=>!matches(item)),live];
}
export const liveRefreshMillis=value=>Math.max(5,Math.min(15,Number(value)||10))*1000;
