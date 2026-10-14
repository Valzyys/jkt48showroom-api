// IDN currently uses both IRC and Amazon IVS chat. Read only incoming public events.
function parseFrame(raw){
 if(typeof raw!=='string'||raw.length>200000)return null;
 let envelope,body;
 try{envelope=JSON.parse(raw);body=envelope}catch{
  const start=raw.indexOf('{');if(start<0)return /(?: 001 | JOIN #)/.test(raw)?{kind:'connected'}:null;
  try{envelope=JSON.parse(raw.slice(start));body=envelope}catch{return null}
 }
 const nested=envelope.Attributes?.message??envelope.Attributes?.Message??envelope.attributes?.message;
 if(typeof nested==='string'){try{body=JSON.parse(nested)}catch{return null}}
 const user=body.user;
 const eventId=envelope.Id??envelope.MessageId;
 if(body.gift&&user){const gift=body.gift;if(!gift.slug||!(user.uuid||user.username))return null;return {kind:'gift',event_id:eventId,gift:{slug:gift.slug,name:gift.name,gold:gift.gold,num:gift.num,quantity:gift.quantity,image_url:gift.image_url},user:{uuid:user.uuid,username:user.username,name:user.name,avatar_url:user.avatar_url}}}
 if(body.chat&&user)return {kind:'comment',event_id:eventId,user:{uuid:user.uuid,username:user.username,name:user.name,avatar_url:user.avatar_url}};
 if(body.system&&user)return {kind:'user',event_id:eventId,user:{uuid:user.uuid,username:user.username,name:user.name,avatar_url:user.avatar_url}};
 if(envelope.Type==='MESSAGE'||envelope.Type==='EVENT')return {kind:'connected'};
 return null;
}
module.exports={parseFrame};
