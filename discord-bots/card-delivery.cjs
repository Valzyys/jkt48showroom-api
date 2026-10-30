// Send the announcement immediately; attach a late banner by editing the same message.
const {banner}=require('./messages.cjs');
class CardDelivery {
 constructor({store,client,preferences,settings,now=Date.now}){Object.assign(this,{store,client,preferences,settings,now});this.tasks=new Map();this.busy=false;
  for(const entry of store.db.prepare("SELECT key,value FROM kv WHERE key LIKE 'card:%'").all())try{const task=JSON.parse(entry.value);if(task&&task.expires>now())this.tasks.set(entry.key,task)}catch{}
 }
 observe(kind,id,row){if(!['live','recent','theater','news'].includes(kind))return;const key=`card:${kind}:${id}`;const old=this.tasks.get(key);if(!old)return;old.row=row;this.store.set(key,old);}
 remember(kind,id,row){if(!['live','recent','theater','news'].includes(kind))return;const key=`card:${kind}:${id}`;if(this.tasks.has(key))return this.observe(kind,id,row);const task={kind,id,row,expires:this.now()+6*3600000,next:0};this.tasks.set(key,task);this.store.set(key,task);}
 async tick(){if(this.busy)return;this.busy=true;try{for(const [key,task]of this.tasks){if(task.next>this.now())continue;if(task.expires<this.now()){this.remove(key);continue}let waiting=false;
  const jobs=this.store.db.prepare("SELECT * FROM deliveries WHERE kind=? AND event=? AND status IN ('pending','sending','sent')").all(task.kind,task.id);
  for(const job of jobs){const cfg=this.preferences(job.channel,task.kind),url=banner(task.row,task.kind,cfg.banner_style||this.settings().banner_style);if(cfg.show_media===false)continue;if(!url){waiting=true;continue}
   const payload=JSON.parse(job.payload);if(payload.embeds?.[0]?.image?.url===url)continue;
   if(!payload.embeds?.[0])continue;payload.embeds[0].image={url};
   if(job.status==='sending'){waiting=true;continue}
   try{if(job.status==='sent'){const channel=await this.client.channels.fetch(job.channel);await channel.messages.edit(job.message_id,{embeds:payload.embeds,allowedMentions:{parse:[]}})}this.store.update(job.key,{payload:JSON.stringify(payload)});}
   catch(error){if(![10003,10008,50001,50013].includes(Number(error.code))){waiting=true;task.next=this.now()+5000}console.warn('card-attach-failed kind='+task.kind+' code='+String(error.code||error.name))}
  }
  if(!waiting)this.remove(key);
 }}finally{this.busy=false}}
 remove(key){this.tasks.delete(key);this.store.db.prepare('DELETE FROM kv WHERE key=?').run(key)}
}
module.exports={CardDelivery};
