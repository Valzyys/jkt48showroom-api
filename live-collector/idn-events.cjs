// Passive decoding only. One WebSocket frame can contain multiple IRC lines/events.
function parseFrames(raw){
 if(typeof raw!=='string'||raw.length>1000000)return [];
 const events=[];
 function parse(line,tags={}){
  let envelope,body;
  try{envelope=JSON.parse(line);body=envelope}catch{
   if(line.startsWith('@')){const end=line.indexOf(' ');for(const tag of line.slice(1,end).split(';')){const [key,...v]=tag.split('=');tags[key]=v.join('=')}line=line.slice(end+1)}
   const start=line.indexOf('{');if(start<0){if(/(?: 001 | JOIN #)/.test(line))events.push({kind:'connected'});return}
   try{envelope=JSON.parse(line.slice(start));body=envelope}catch{return}
  }
  if(Array.isArray(envelope)){for(const value of envelope.slice(0,1000))parse(JSON.stringify(value));return}
  if(!body||typeof body!=='object')return;
  const nested=envelope.Attributes?.message??envelope.Attributes?.Message??envelope.attributes?.message;
  if(typeof nested==='string'){try{body=JSON.parse(nested)}catch{return}}
  if(!body||typeof body!=='object'||Array.isArray(body))return;
  const event_id=envelope.Id??envelope.MessageId??tags.id??tags.msgid??body.event_id,
   event_time=envelope.SendTime??envelope.sendTime??tags['tmi-sent-ts']??body.created_at;
  const user=body.user;if(!user||!(user.uuid||user.username)){if(envelope.Type==='MESSAGE'||envelope.Type==='EVENT')events.push({kind:'connected'});return}
  const identity={uuid:user.uuid,username:user.username,name:user.name,avatar_url:user.avatar_url};
  const room=body.room_id?{room_id:String(body.room_id)}:{};
  if(body.gift){const g=body.gift,quantity=Number(g.quantity??g.num??1),gold=g.gold===undefined||g.gold===null?null:Number(g.gold);if(!g.slug||!Number.isSafeInteger(quantity)||quantity<1||quantity>100000||gold!==null&&(!Number.isFinite(gold)||gold<0))return;events.push({kind:'gift',event_id,event_time,...room,gift:{slug:g.slug,name:g.name,gold,quantity,image_url:g.image_url},user:identity});return}
  if(body.chat)events.push({kind:'comment',event_id:event_id??body.chat.id,event_time,...room,user:identity});
  else if(body.system)events.push({kind:'user',event_id,event_time,...room,user:identity});
 }
 // JSON attributes may contain escaped newlines. Split IRC, never a valid JSON envelope.
 try{JSON.parse(raw);parse(raw)}catch{for(const line of raw.split(/\r?\n/))if(line.trim())parse(line.trim())}
 return events;
}
module.exports={parseFrames,parseFrame:raw=>parseFrames(raw)[0]||null};
