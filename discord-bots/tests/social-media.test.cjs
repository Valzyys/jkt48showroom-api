const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Collection,PermissionFlagsBits:P}=require('discord.js');
const {MediaAssets,descriptors,presentation}=require('../social-media.cjs'),{SocialDelivery,sourcePost}=require('../social-delivery.cjs'),{Store}=require('../store.cjs');
const id='4013628452793545643',root='https://api.jkt48connect.app/media/instagram/fiony-alveria/'+id+'/',asset=(kind,status='ready')=>({status,url:root+kind});
const post={id,shortcode:'DezRdANKPOr',author:{username:'jkt48.fiony'},member:{name:'Fiony'},text:'Halo\n\nAda video!',media:{type:'video',thumbnail:asset('thumbnail'),video:asset('video')}};
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(40)]),jpg=Buffer.from([255,216,255,1,2,3]);
const response=url=>new Response(url.includes('video')?mp4:jpg,{headers:{'Content-Type':url.includes('video')?'video/mp4':'image/jpeg'}});
test('video preparation waits for the video rather than treating a ready thumbnail as complete',async()=>{
 let current={...post,media:{...post.media,video:asset('video','pending')}},now=1000,calls=0;
 const m=new MediaAssets({get:async()=>({post:current})},{now:()=>now,fetcher:async url=>{calls++;return response(url)}});
 const first=await m.get('instagram',current);assert.equal(first.pending,true);assert.ok(!first.files.some(f=>f.name.endsWith('.mp4')));
 current=post;now+=6000;const ready=await m.get('instagram',current);assert.equal(ready.pending,false);assert.ok(ready.files.some(f=>f.name.endsWith('.mp4')));assert.equal(presentation('instagram',ready).embeds[0].image,undefined);
});
test('mixed Instagram carousels include every video and only fetch owned safe R2 media',async()=>{
 const p={...post,media:{type:'carousel',items:[{video:asset('video-0')},{video:asset('video-1')}],images:[asset('image-2')]}};
 const urls=[],m=new MediaAssets({get:async()=>({post:p})},{fetcher:async url=>{urls.push(url);return response(url)}});
 const r=await m.get('instagram',p);assert.equal(r.files.filter(f=>f.name.endsWith('.mp4')).length,2);assert.equal(r.files.filter(f=>f.name.endsWith('.jpg')).length,1);assert.equal(urls.length,3);
 for(const url of ['https://127.0.0.1/video',root+'video?key=secret',root.replace(id,'9999999999999999999')+'video']){const d=descriptors('instagram',{...post,media:{video:{status:'ready',url}}});assert.equal(d.files.length,0)}
});
test('missing Instagram video descriptors never finish a thumbnail-only notification',async()=>{
 for(const video of [null,undefined]){
  const single={...post,media:{type:'video',thumbnail:asset('thumbnail'),video}};
  assert.equal(descriptors('instagram',single).pending,true);
  const mixed={...post,media:{type:'carousel',items:[{type:'video',video}],images:[asset('image-0')]}};
  assert.equal(descriptors('instagram',mixed).pending,true);
 }
 const incomplete={...post,media:{type:'image',detail_status:'pending',thumbnail:asset('thumbnail')}};
 assert.equal(descriptors('instagram',incomplete).pending,true);
 let current={...post,media:{type:'video',thumbnail:asset('thumbnail'),video:null}},now=1000;
 const assets=new MediaAssets({get:async()=>({post:current})},{now:()=>now,fetcher:async url=>response(url)});
 const waiting=await assets.get('instagram',current);assert.equal(waiting.pending,true);
 current=post;now+=6000;const ready=await assets.get('instagram',current);
 assert.equal(ready.pending,false);assert.equal(ready.files.filter(f=>f.name.endsWith('.mp4')).length,1);
});
test('TikTok sends a real video attachment and concurrent guilds share preparation',async()=>{
 const p={...post,author:{username:'fionyjkt48'},media:{type:'video',video:{status:'ready',url:root.replace('/instagram/','/tiktok/')+'video'}}};let hits=0,api=0;
 const m=new MediaAssets({get:async()=>{api++;return {post:p}}},{fetcher:async url=>{hits++;return response(url)}});
 const [a,b]=await Promise.all([m.get('tiktok',p),m.get('tiktok',p)]);assert.equal(hits,1);assert.equal(api,1);assert.equal(a,b);assert.ok(a.files[0].name.endsWith('.mp4'));
});
test('X attaches multiple MP4 videos and animated GIF media, with safe variants only',async()=>{
 const url='https://video.twimg.com/ext_tw_video/example/vid/avc1/a.mp4',p={id:'2114711964706652533',author:{username:'Giaa_JKT48'},text:'video',media:['video','animated_gif'].map((type,i)=>({type,variants:[{content_type:'video/mp4',bitrate:256000,url:url.replace('a.mp4',i+'.mp4')}]}))};
 const m=new MediaAssets(null,{fetcher:async()=>new Response(mp4,{headers:{'Content-Type':'video/mp4'}})});const r=await m.get('x',p);assert.equal(r.files.length,2);assert.equal(r.pending,false);
 assert.equal(descriptors('x',{...p,media:[{type:'video',variants:[{content_type:'video/mp4',url:'http://127.0.0.1/a.mp4'}]}]}).files.length,0);
});
test('large full videos use bounded compression; wrong types and corrupt downloads never become attachments',async()=>{
 const large=Buffer.concat([mp4,Buffer.alloc(10*1024*1024)]);let compressed=0;
 const m=new MediaAssets({get:async()=>({post})},{fetcher:async()=>new Response(large,{headers:{'Content-Type':'video/mp4'}}),transcode:async(bytes,target)=>{compressed++;assert.ok(target<bytes.length);return mp4}});
 const r=await m.get('instagram',post);assert.equal(compressed,1);assert.ok(r.files[0].attachment.equals(mp4));
 const bad=new MediaAssets({get:async()=>({post})},{fetcher:async()=>new Response('not video',{headers:{'Content-Type':'video/mp4'}})});const invalid=await bad.get('instagram',post);assert.equal(invalid.files.length,0);assert.ok(invalid.errors.includes('invalid_video_signature'));
});
function setup(prepared,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'discord-social-')),store=new Store(dir),edits=[];let now=1000;
 const original={id:'bot-message',author:{id:'bot'},attachments:new Collection(),embeds:[],components:[],edit:async value=>{edits.push(value);for(const f of value.files)original.attachments.set(f.name,{id:f.name,name:f.name})}};
 const channel={guildId:'guild',permissionsFor:()=>({has:()=>true}),messages:{fetch:async()=>original}};
 const client={user:{id:'bot'},isReady:()=>true,channels:{fetch:async()=>channel}};
 const service=new SocialDelivery({store,client,assets:{get:async()=>prepared.value},channels:()=>[{channel_id:'channel'}],preferences:()=>({}),settings:()=>({sources:{instagram:{enabled:true},x:{enabled:true}}}),now:()=>now,log:()=>{},...options});
 store.enqueue('instagram',id,'channel',{_instagram_post:post});const job=store.due()[0];store.update(job.key,{status:'sent',message_id:original.id});service.remember(job);
 return {service,store,job,original,channel,edits,advance:ms=>now+=ms,close(){store.db.close();fs.rmSync(dir,{recursive:true,force:true})}};
}
test('pending media edits the same notification after ready without reposting or mentioning roles',async()=>{
 const prepared={value:{post,files:[],pending:true,errors:[]}},f=setup(prepared);try{
  await f.service.tick();assert.equal(f.edits.length,0);assert.equal(f.store.db.prepare('SELECT state FROM social_media_deliveries').get().state,'pending');
  prepared.value={post,files:[{name:'instagram-'+id+'-video.mp4',attachment:mp4}],pending:false,errors:[]};f.advance(6000);await f.service.tick();assert.equal(f.edits.length,1);assert.deepEqual(f.edits[0].allowedMentions,{parse:[]});assert.equal(f.edits[0].content,undefined);assert.equal(f.store.history().length,1);await f.service.tick();assert.equal(f.edits.length,1);
 }finally{f.close()}
});
test('media edits are idempotent across restart/ambiguous edit and preserve existing attachments',async()=>{
 const file={name:'instagram-'+id+'-video.mp4',attachment:mp4},f=setup({value:{post,files:[file],pending:false,errors:[]}});try{
  f.original.attachments.set('same',{id:'existing',name:file.name});await f.service.tick();assert.equal(f.edits.length,0);assert.equal(f.store.db.prepare('SELECT state FROM social_media_deliveries').get().state,'done');
 }finally{f.close()}
});
test('disabled media, removed routes and another author never receive media edits',async()=>{
 for(const mode of ['disabled','removed','author']){
  const f=setup({value:{post,files:[{name:'video.mp4',attachment:mp4}],pending:false,errors:[]}});try{
   if(mode==='disabled')f.service.preferences=()=>({show_media:false});if(mode==='removed')f.service.channels=()=>[];if(mode==='author')f.original.author.id='someone-else';await f.service.tick();assert.equal(f.edits.length,0);assert.notEqual(f.store.db.prepare('SELECT state FROM social_media_deliveries').get().state,'pending');
  }finally{f.close()}
 }
});
test('old X media-only receipts recover their author without changing original notification text',()=>{
 const old={kind:'x',payload:JSON.stringify({_x_media:{id:'2114711964706652533',media:[]},embeds:[{url:'https://x.com/Giaa_JKT48/status/2114711964706652533'}]})};assert.equal(sourcePost(old).author.username,'Giaa_JKT48');
});
test('missing upload permissions wait without downloading; granting them completes the same message',async()=>{
 const f=setup({value:{post,files:[{name:'ready.mp4',attachment:mp4}],pending:false,errors:[]}});try{
  let downloads=0;f.service.assets.get=async()=>{downloads++;return {post,files:[{name:'ready.mp4',attachment:mp4}],pending:false,errors:[]}};
  f.channel.permissionsFor=()=>({has:()=>false});await f.service.tick();assert.equal(downloads,0);assert.equal(f.edits.length,0);
  f.channel.permissionsFor=()=>({has:()=>true});f.advance(300001);await f.service.tick();assert.equal(downloads,1);assert.equal(f.edits.length,1);
 }finally{f.close()}
});
test('a lost edit response is reconciled with Discord before retrying attachment upload',async()=>{
 const file={name:'instagram-'+id+'-video.mp4',attachment:mp4},f=setup({value:{post,files:[file],pending:false,errors:[]}});try{
  let edits=0;f.original.edit=async value=>{edits++;f.original.attachments.set(file.name,{id:'uploaded',name:file.name});throw Error('socket_disconnected')};
  await f.service.tick();assert.equal(edits,1);f.advance(6000);await f.service.tick();assert.equal(edits,1);assert.equal(f.store.db.prepare('SELECT state FROM social_media_deliveries').get().state,'done');
 }finally{f.close()}
});
test('unavailable media expires instead of retrying forever; original sent receipt stays sent',async()=>{
 const f=setup({value:{post,files:[],pending:true,errors:[]}});try{f.advance(24*3600000+1);await f.service.tick();assert.equal(f.store.db.prepare('SELECT state FROM social_media_deliveries').get().state,'expired');assert.equal(f.store.history().length,1)}finally{f.close()}
});
test('late gallery readiness retains the final selected images rather than cycling old thumbnails',async()=>{
 const files=Array.from({length:10},(_,i)=>({name:'instagram-'+id+'-image-'+i+'.jpg',attachment:jpg})),f=setup({value:{post,files,pending:false,errors:[]}});try{
  for(let i=4;i<14;i++)f.original.attachments.set('image-'+i,{id:'image-'+i,name:'instagram-'+id+'-image-'+i+'.jpg'});
  await f.service.tick();assert.equal(f.edits.length,1);assert.deepEqual(f.edits[0].attachments.map(a=>a.id),[4,5,6,7,8,9].map(i=>'image-'+i));assert.equal(f.edits[0].files.length,4);
 }finally{f.close()}
});
test('a late Instagram video replaces the extra thumbnail in the same full gallery message',async()=>{
 const video={name:'instagram-'+id+'-video-1.mp4',attachment:mp4},images=Array.from({length:9},(_,i)=>({name:'instagram-'+id+'-image-'+i+'.jpg',attachment:jpg}));
 const f=setup({value:{post,files:[video,...images],pending:false,errors:[]}});
 try{
  for(let i=0;i<10;i++)f.original.attachments.set('image-'+i,{id:'image-'+i,name:'instagram-'+id+'-image-'+i+'.jpg'});
  await f.service.tick();assert.equal(f.edits.length,1);assert.equal(f.edits[0].files[0].name,video.name);
  assert.equal(f.edits[0].attachments.length,9);assert.ok(!f.edits[0].attachments.some(a=>a.id==='image-9'));
  assert.deepEqual(f.edits[0].allowedMentions,{parse:[]});assert.equal(f.store.history().length,1);
 }finally{f.close()}
});
