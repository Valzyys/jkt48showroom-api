const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {EmbedBuilder,ActionRowBuilder,Collection,PermissionFlagsBits:P}=require('discord.js');
const help=require('../help.cjs'),command=require('../Discord/commands/help');
const interaction=(extra={})=>({user:{id:'regular-user'},guildId:'another-server',memberPermissions:{has:()=>false},...extra});
test('every help page and component fits Discord limits, has media, and suppresses mentions',()=>{
 const i=interaction({guildId:require('../community-plan.cjs').guildId});
 assert.ok(fs.statSync(help.MEDIA_PATH).size<1000000);
 for(const page of help.pages(i)){
  const p=help.payload(i,page.id,{initial:true});assert.equal(p.flags,64);assert.deepEqual(p.allowedMentions,{parse:[]});
  assert.equal(p.embeds[0].image.url,'attachment://'+help.MEDIA_NAME);assert.equal(p.files.length,1);
  assert.ok(p.embeds.reduce((n,e)=>n+JSON.stringify(e).length,0)<6000);
  for(const e of p.embeds)new EmbedBuilder(e).toJSON();for(const row of p.components)ActionRowBuilder.from(row).toJSON();
  for(const row of p.components)for(const c of row.components)assert.ok(!c.custom_id||c.custom_id.length<=100);
  const ids=p.components.flatMap(row=>row.components.map(c=>c.custom_id)).filter(Boolean);
  assert.equal(new Set(ids).size,ids.length,'component IDs must be unique on '+page.id);
  const options=p.components[0].components[0].options;assert.equal(options.filter(o=>o.default).length,1);assert.ok(options.length<=25);
 }
});
test('community music and levels are only advertised inside the community server',()=>{
 assert.ok(!help.pages(interaction()).some(p=>p.id==='community'));
 assert.ok(help.pages(interaction({guildId:require('../community-plan.cjs').guildId})).some(p=>p.id==='community'));
});
test('owner-only controls never appear to regular users or server administrators',()=>{
 const owner=process.env.BOT_OWNER_ID;process.env.BOT_OWNER_ID='test-owner';try{
  for(const i of [interaction(),interaction({memberPermissions:{has:p=>p===P.ManageGuild}})]){
   assert.ok(!help.pages(i).some(p=>p.id==='owner'));assert.ok(!JSON.stringify(help.payload(i,'owner')).includes('/control/admin'));
  }
  const p=help.payload(interaction({user:{id:'test-owner'}}),'owner');assert.match(JSON.stringify(p),/control\/admin/);
 }finally{if(owner===undefined)delete process.env.BOT_OWNER_ID;else process.env.BOT_OWNER_ID=owner}
});
test('navigation preserves uploaded media rather than uploading on each interaction',async()=>{
 let updated;const i=interaction({customId:'jkc-help:topic',values:['roles'],isStringSelectMenu:()=>true,isButton:()=>false,message:{attachments:new Collection([['id',{name:help.MEDIA_NAME,url:'https://cdn.discordapp.com/attachments/example/pip-guide.png'}]])},update:async p=>updated=p});
 assert.equal(await help.handle(i),true);assert.equal(updated.files,undefined);assert.equal(updated.flags,undefined);assert.match(updated.embeds[1].title,/Panggil/);assert.equal(updated.embeds[0].image.url,'https://cdn.discordapp.com/attachments/example/pip-guide.png');
});
test('next, home, previous, and stale topics resolve to a usable page',async()=>{
 for(const [id,expected] of [['notifications','notifications'],['home','home'],['removed-page','home'],['prev:home','home'],['next:notifications','notifications'],['prev:notifications','notifications'],['next:roles','roles']]){
  let p;await help.handle(interaction({customId:'jkc-help:'+id,isButton:()=>true,isStringSelectMenu:()=>false,update:async value=>p=value}));
  assert.equal(p.components[0].components[0].options.find(o=>o.default).value,expected);
 }
 assert.equal(help.payload(interaction()).components[1].components[0].disabled,true);
 const list=help.pages(interaction());assert.equal(help.payload(interaction(),list.at(-1).id).components[1].components[2].disabled,true);
});
test('unrelated interactions are ignored and another user cannot take over a help message',async()=>{
 assert.equal(await help.handle({isStringSelectMenu:()=>false,isButton:()=>true,customId:'other:home'}),false);
 let reply;await help.handle(interaction({customId:'jkc-help:home',isButton:()=>true,isStringSelectMenu:()=>false,message:{interactionMetadata:{user:{id:'someone-else'}}},reply:async p=>reply=p,update:()=>{throw Error('must not edit')}}));assert.equal(reply.flags,64);
});
test('slash help opens a private guide without calling a data API or changing settings',async()=>{
 let p;await command.execute(interaction({reply:async value=>p=value}));assert.equal(p.flags,64);assert.match(p.embeds[1].title,/Pip/);
});
