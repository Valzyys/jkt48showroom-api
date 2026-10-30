/** Durable media edits of already-sent notifications. Never repost or ping roles. */
const {PermissionFlagsBits:P}=require('discord.js');
const {presentation}=require('./social-media.cjs');
function sourcePost(job){
 const payload=JSON.parse(job.payload),post=job.kind==='x'?payload._x_media:payload['_'+job.kind+'_post'];
 if(job.kind==='x'&&post&&!post.author){const match=/^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/.exec(payload.embeds?.[0]?.url||'');if(match&&match[2]===post.id)return {...post,author:{username:match[1]},text:''};}
 return post;
}
class SocialDelivery{
 constructor({store,client,assets,channels,preferences,settings,now=Date.now,log=console.log}){
  Object.assign(this,{store,client,assets,channels,preferences,settings,now,log});this.running=false;this.stats={pending:0,done:0,partial:0,blocked:0,cancelled:0,expired:0};
  store.db.exec(`CREATE TABLE IF NOT EXISTS social_media_deliveries(delivery_key TEXT PRIMARY KEY,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,created INTEGER NOT NULL,last_error TEXT);
   CREATE INDEX IF NOT EXISTS social_media_due ON social_media_deliveries(state,next_at);`);
 }
 remember(job){
  if(!['x','tiktok','instagram'].includes(job.kind))return;
  const post=sourcePost(job);if(!post)return;
  if(job.kind==='x'&&!post.media?.length)return;
  this.store.db.prepare("INSERT OR IGNORE INTO social_media_deliveries(delivery_key,next_at,created) VALUES(?,?,?)").run(job.key,this.now(),this.now());
 }
 restore(){
  // A bounded repair of recent video notifications; old image-only posts stay as they are.
  for(const job of this.store.db.prepare("SELECT * FROM deliveries WHERE status='sent' AND kind IN ('x','tiktok','instagram') AND created>? ORDER BY created DESC LIMIT 200").all(this.now()-6*3600000)){
   const post=sourcePost(job);
   if(post&&(job.kind!=='x'||post.media?.some(m=>['video','animated_gif'].includes(m.type))))this.remember(job);
  }
 }
 update(key,state,error=null){this.store.db.prepare('UPDATE social_media_deliveries SET state=?,last_error=? WHERE delivery_key=?').run(state,error,key)}
 async tick(){
  if(this.running||!this.client.isReady())return;this.running=true;
  try{
   const jobs=this.store.db.prepare("SELECT m.attempts AS media_attempts,m.created AS media_created,d.* FROM social_media_deliveries m JOIN deliveries d ON d.key=m.delivery_key WHERE m.state='pending' AND m.next_at<=? AND d.status='sent' ORDER BY m.created LIMIT 6").all(this.now());let index=0;
   await Promise.all(Array.from({length:Math.min(2,jobs.length)},async()=>{while(index<jobs.length)await this.process(jobs[index++])}));
  }finally{this.running=false;for(const k of Object.keys(this.stats))this.stats[k]=0;for(const r of this.store.db.prepare('SELECT state,count(*) n FROM social_media_deliveries GROUP BY state').all())this.stats[r.state]=r.n}
 }
 async process(job){
  const config=this.settings();
  if(!this.channels(job.kind).some(c=>c.channel_id===job.channel)||config.sources?.[job.kind]?.enabled===false){this.update(job.key,'cancelled','channel_disabled');return}
  if(this.now()-job.media_created>24*3600000){this.update(job.key,'expired','media_not_ready');return}
  let error='media_pending';
  try{
   const channel=await this.client.channels.fetch(job.channel),pref=this.preferences(channel?.guildId);
   if(pref.show_media===false||config.show_media===false){this.update(job.key,'cancelled','media_disabled');return}
   if(!channel?.messages?.fetch){this.update(job.key,'blocked','channel_unavailable');return}
   if(!channel.permissionsFor(this.client.user)?.has([P.AttachFiles,P.ViewChannel,P.ReadMessageHistory,P.SendMessages,P.EmbedLinks])){error='missing_media_permissions';throw Error(error)}
   const post=sourcePost(job);
   const prepared=await this.assets.get(job.kind,post),message=await channel.messages.fetch({message:job.message_id,force:true});
   if(message.author.id!==this.client.user.id){this.update(job.key,'blocked','message_owner_mismatch');return}
   const existing=[...message.attachments.values()],hasVideo=existing.some(a=>a.name?.endsWith('.mp4'));
   let files=prepared.files.filter(f=>!existing.some(a=>a.name===f.name)&&!(hasVideo&&f.name.endsWith('.mp4')&&prepared.files.filter(f=>f.name.endsWith('.mp4')).length===1));
   if(files.length){
    const view=job.kind==='x'?{embeds:message.embeds.map(e=>e.toJSON()),components:message.components.map(c=>c.toJSON())}:presentation(job.kind,prepared,{...config,...pref});
    // Keep video slots ahead of older thumbnails when a carousel fills all ten slots.
    const priority=a=>a.name?.endsWith('.mp4')?0:prepared.files.some(f=>f.name===a.name)?1:2;
    const retained=[...existing].sort((a,b)=>priority(a)-priority(b)).slice(0,Math.max(0,10-files.length));
    files=files.slice(0,10-retained.length);
    view.embeds=view.embeds.filter((e,i)=>i===0||!e.image);delete view.embeds[0]?.image;
    await message.edit({...view,attachments:retained.map(a=>({id:a.id})),files,allowedMentions:{parse:[]}});
    this.log('notification-media-attached kind='+job.kind+' channel='+job.channel+' files='+files.length+' videos='+files.filter(f=>f.name.endsWith('.mp4')).length);
   }
   if(!prepared.pending){this.update(job.key,prepared.errors.length?'partial':'done',prepared.errors.join(',')||null);return}
   error=prepared.errors[0]||'media_pending';
  }catch(e){
   if([10003,10008,50001].includes(Number(e.code))){this.update(job.key,'blocked','discord_'+e.code);return}
   if(e.status===429)error='rate_limited';else if(error!=='missing_media_permissions')error=/^api_[a-zA-Z0-9_]+$/.test(e.message)?e.message:'media_retry';
  }
  const attempts=job.media_attempts+1,delay=error==='missing_media_permissions'?300000:Math.min(300000,5000*2**Math.min(attempts-1,6));
  this.store.db.prepare('UPDATE social_media_deliveries SET attempts=?,next_at=?,last_error=? WHERE delivery_key=?').run(attempts,this.now()+delay,error,job.key);
  if(attempts===1||attempts%12===0)this.log('notification-media-wait kind='+job.kind+' channel='+job.channel+' reason='+error);
 }
}
module.exports={SocialDelivery,sourcePost};
