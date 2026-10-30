const {test}=require('node:test'),assert=require('node:assert/strict');
const {ActionRowBuilder}=require('discord.js'),panel=require('../notification-panel.cjs'),groups=require('../guild-settings.cjs');
const guild={id:'111111111111111111',channels:{cache:new Map([['222222222222222222',{}]])}},members=Array.from({length:65},(_,i)=>({id:'member-'+i,name:'Member '+i,nicknames:[]}));
test('interactive panel paginates the complete roster within Discord limits and preserves other-page selections',()=>{
 const read=groups.read;groups.read=()=>[{guild_id:guild.id,channel_id:'222222222222222222',member_ids:['member-0','member-25','member-64']}];
 try{
  const s={id:'session',kind:'live',channel:'222222222222222222',members,page:0,query:''};
  const all=[];for(let page=0;page<4;page++){s.page=page;const result=panel.render(s,guild);assert.ok(result.components.length<=5);for(const r of result.components)ActionRowBuilder.from(r).toJSON();const menu=result.components.find(r=>r.components[0].custom_id.endsWith('members-'+page)).components[0];assert.ok(menu.options.length<=20);all.push(...menu.options.map(m=>m.value))}
  assert.equal(new Set(all).size,65);assert.deepEqual(panel.destination(guild,'live',s.channel).member_ids,['member-0','member-25','member-64']);
  s.query='Member 64';s.page=0;assert.equal(panel.pageMembers(s).length,1);
 }finally{groups.read=read}
});
test('panel rejects another user or expired session before any settings write',async()=>{
 let replies=0;const i={customId:'notifycfg:unknown:all',user:{id:'someone'},guildId:guild.id,reply:async p=>{replies++;assert.equal(p.flags,64)}};
 assert.equal(await panel.handle(i),true);assert.equal(replies,1);
 assert.equal(await panel.handle({...i,customId:'other-panel'}),false);
});
test('panel edits two destinations independently and page changes retain earlier member selections',async()=>{
 const routing=require('../member-routing.cjs'),read=groups.read,update=groups.update,catalog=routing.getCatalog;
 let records=[],view;const ids=['222222222222222222','333333333333333333'];
 const g={...guild,members:{me:{}},roles:{cache:new Map()},channels:{cache:new Map(ids.map(id=>[id,{}])),fetch:async id=>({id,guildId:guild.id,type:0,permissionsFor:()=>({has:()=>true})})}};
 const i={guild:g,guildId:g.id,user:{id:'admin'},memberPermissions:{has:()=>true},deferReply:async()=>{},editReply:async p=>{view=p},deferUpdate:async()=>{},followUp:async p=>assert.fail(p.content)};
 groups.read=()=>records;groups.update=(kind,g,operation)=>{records=operation(records)};routing.getCatalog=async()=>members;
 try{
  await panel.open(i);const prefix=view.components[0].components[0].custom_id.replace(/kind$/,'');
  const action=(name,values=[])=>panel.handle({...i,customId:prefix+name,values});
  await action('channel',[ids[0]]);await action('members-0',['member-1']);await action('next');await action('members-1',['member-25']);
  assert.deepEqual(records[0].member_ids,['member-1','member-25']);
  await action('channel',[ids[1]]);await action('members-0',['member-2']);
  assert.equal(records.length,2);assert.deepEqual(records.find(r=>r.channel_id===ids[0]).member_ids,['member-1','member-25']);assert.deepEqual(records.find(r=>r.channel_id===ids[1]).member_ids,['member-2']);
  await action('all');assert.equal(records.find(r=>r.channel_id===ids[1]).member_ids,null);assert.deepEqual(records.find(r=>r.channel_id===ids[0]).member_ids,['member-1','member-25']);
  await action('remove');assert.equal(records.length,1);assert.equal(records[0].channel_id,ids[0]);
 }finally{groups.read=read;groups.update=update;routing.getCatalog=catalog}
});
