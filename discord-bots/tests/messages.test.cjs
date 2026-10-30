const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {message}=require('../messages.cjs'),{Store}=require('../store.cjs');
const {EmbedBuilder,ActionRowBuilder}=require('discord.js');
test('five notification types fit real Discord embed limits and disable unrequested mentions',()=>{
 for(const kind of ['live','recent','news','theater','birthday']){
  const payload=message(kind,{name:'Member @everyone',title:'Test',type:'idn',started_at:'2026-10-25T07:00:00Z',date:'2026-10-25T07:00:00Z',data_id:'idn-example',members:[{name:'Member'}],live_info:{duration:3600000,viewers:{num:1000}}});
  for(const e of payload.embeds)new EmbedBuilder(e).toJSON();for(const row of payload.components)ActionRowBuilder.from(row).toJSON();assert.deepEqual(payload.allowedMentions,{parse:[]});assert.ok(JSON.stringify(payload).length<6000);
 }
});
test('ready banner is selected, pending/unsafe URLs are omitted',()=>{
 const row={name:'Member',notification_designs:{jkt48connect:{banner:{status:'ready',url:'https://api.jkt48connect.app/media/live/banner.png'}}}};
 assert.equal(message('live',row).embeds[0].image.url,row.notification_designs.jkt48connect.banner.url);
 row.notification_designs.jkt48connect.banner.status='pending';assert.equal(message('live',row).embeds[0].image,undefined);
 row.notification_designs.jkt48connect.banner={status:'ready',url:'javascript:bad'};assert.equal(message('live',row).embeds[0].image,undefined);
});
test('delivery receipt is per channel, duplicate events are ignored, crash during send is uncertain',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'discord-test-'));try{
  const s=new Store(dir);s.enqueue('live','event','1',{});s.enqueue('live','event','1',{});s.enqueue('live','event','2',{});assert.equal(s.due().length,2);
  s.update('live:event:1',{status:'sending'});s.db.close();const next=new Store(dir);assert.equal(next.queue().find(r=>r.channel==='1').status,'uncertain');assert.equal(next.due().length,1);
  next.update('live:event:2',{status:'sent',message_id:'123',url:'https://discord.com/channels/1/2/123'});assert.equal(next.history().length,1);next.db.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('guild settings exclude channels belonging to other guilds, and preserve others during edits',()=>{
 const {belongs}=require('../guild-settings.cjs');const guild={id:'server1',channels:{cache:new Map([['local',{}]])}};
 assert.equal(belongs({guild_id:'server1',channel_id:'local'},guild),true);assert.equal(belongs('local',guild),true);assert.equal(belongs({guild_id:'server2',channel_id:'foreign'},guild),false);
});
test('global owner intervals are bounded and unknown configuration is dropped',()=>{
 const {normalize}=require('../settings.cjs');const v=normalize({sources:{live:{interval:0,enabled:false}},banner_style:'invalid',token:'private'});assert.equal(v.sources.live.interval,1);assert.equal(normalize({sources:{recent:{interval:120}}}).sources.recent.interval,3);assert.equal(v.sources.live.enabled,false);assert.equal(v.banner_style,'jkt48connect');assert.equal(v.token,undefined);
});
test('clearing one server never removes legacy or configured channels from another server',()=>{
 const {replaceGuildRows}=require('../guild-settings.cjs');const guild={id:'one',channels:{cache:new Map([['legacy-one',{}],['one-a',{}]])}};
 const foreign={guild_id:'two',channel_id:'two-a'},mine={guild_id:'one',channel_id:'one-a'};
 const result=replaceGuildRows(['legacy-one','legacy-two',mine,foreign],guild,()=>[]);assert.deepEqual(result,['legacy-two',foreign]);
});
test('a non-admin cannot change server settings',async()=>{
 const {guard}=require('../guild-settings.cjs');let reply;const permitted=await guard({guild:{id:'one'},user:{id:'synthetic-ordinary-user'},memberPermissions:{has:()=>false},reply:async value=>{reply=value}});assert.equal(permitted,false);assert.equal(reply.flags,64);assert.match(reply.embeds[0].title,/Kelola Server/);
});
