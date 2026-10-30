const test=require('node:test'),assert=require('node:assert/strict');
process.env.DISCORD_GUILD_API_TOKEN='synthetic-private-dashboard-bridge-token';
const {permissions,validate}=require('../guild-api.cjs');
const {PermissionFlagsBits:P}=require('discord.js');
const id='111111111111111111',channel={id:'222222222222222222',name:'updates',type:0,permission_overwrites:[]},everyone={id,permissions:String(P.ViewChannel|P.SendMessages|P.EmbedLinks)},mention={id:'333333333333333333',name:'Fans',permissions:'0',mentionable:true};
const meta={id,guild:{id,owner_id:'444444444444444444'},roles:[everyone,mention],bot:{user:{id:'555555555555555555'},roles:[]},channels:[channel],allChannels:[channel]};
test('channel overwrites are applied after guild roles and administrator bypasses them',()=>{
 assert.equal(permissions(meta.guild,meta.roles,meta.bot,channel)&P.SendMessages,P.SendMessages);
 const denied={...channel,permission_overwrites:[{id,type:0,deny:String(P.SendMessages),allow:'0'}]};assert.equal(permissions(meta.guild,meta.roles,meta.bot,denied)&P.SendMessages,0n);
 assert.ok(permissions(meta.guild,[...meta.roles,{id:'admin',permissions:String(P.Administrator)}],{...meta.bot,roles:['admin']},denied)&P.SendMessages);
});
// Isolate config reads from the imported archive; tests never touch production state.
const groups=require('../guild-settings.cjs'),prefs=require('../guild-preferences.cjs');const oldRead=groups.read,oldGet=prefs.get;groups.read=()=>[];prefs.get=()=>({});
test('cross-server channels, role IDs and everyone mentions cannot be saved',()=>{
 const raw={routes:Object.fromEntries(['live','news','theater','birthday'].map(k=>[k,{enabled:false,channels:[]}])),banner_style:'jkt48connect',platforms:['idn','showroom'],show_media:true};
 raw.routes.live={enabled:true,channels:[{channel_id:channel.id,role_ids:[mention.id]}]};assert.equal(validate(meta,raw).routes.live.channels[0].role_ids[0],mention.id);
 assert.throws(()=>validate(meta,{...raw,routes:{...raw.routes,live:{enabled:true,channels:[{channel_id:'666666666666666666',role_ids:[]}]}}}),/server ini/);
 assert.throws(()=>validate(meta,{...raw,routes:{...raw.routes,live:{enabled:true,channels:[{channel_id:channel.id,role_ids:[id]}]}}}),/Role/);
 assert.throws(()=>validate(meta,{...raw,routes:{...raw.routes,live:{enabled:true,channels:[{channel_id:channel.id,role_ids:['777777777777777777']}]}}}),/Role/);
});
test.after(()=>{groups.read=oldRead;prefs.get=oldGet});
test('live and recent use separate files and independent enable switches',()=>{
 const {config}=require('../guild-api.cjs');assert.notEqual(groups.files.live,groups.files.recent);
 const read=groups.read,get=prefs.get,other={...channel,id:'888888888888888888',name:'recents'};
 try{groups.read=kind=>kind==='live'?[{guild_id:id,channel_id:channel.id}]:kind==='recent'?[{guild_id:id,channel_id:other.id}]:[];prefs.get=()=>({enabled:{live:false,recent:true}});const result=config({...meta,channels:[channel,other],allChannels:[channel,other]});assert.equal(result.routes.live.enabled,false);assert.equal(result.routes.recent.enabled,true);assert.equal(result.routes.live.channels[0].channel_id,channel.id);assert.equal(result.routes.recent.channels[0].channel_id,other.id)}finally{groups.read=read;prefs.get=get}
});

test('older dashboard saves preserve configured X routes when the X field is omitted',()=>{
 const read=groups.read,get=prefs.get;try{groups.read=kind=>kind==='x'?[{guild_id:id,channel_id:channel.id}]:[];prefs.get=()=>({enabled:{x:true}});const raw={routes:Object.fromEntries(['live','recent','news','theater','birthday'].map(k=>[k,{enabled:false,channels:[]}])),banner_style:'jkt48connect',platforms:['idn','showroom'],show_media:true};const value=validate(meta,raw);assert.equal(value.routes.x.enabled,true);assert.equal(value.routes.x.channels[0].channel_id,channel.id)}finally{groups.read=read;prefs.get=get}
});
test('older dashboard saves retain independent TikTok destinations and enabled state',()=>{
 const read=groups.read,get=prefs.get;try{groups.read=kind=>kind==='tiktok'?[{guild_id:id,channel_id:channel.id}]:[];prefs.get=()=>({enabled:{tiktok:true}});const raw={routes:Object.fromEntries(['live','recent','news','theater','birthday','x'].map(k=>[k,{enabled:false,channels:[]}])),banner_style:'jkt48connect',platforms:['idn','showroom'],show_media:true};const value=validate(meta,raw);assert.equal(value.routes.tiktok.enabled,true);assert.equal(value.routes.tiktok.channels[0].channel_id,channel.id);assert.equal(value.routes.x.enabled,false)}finally{groups.read=read;prefs.get=get}
});
test('older dashboards preserve Instagram while explicit changes remain guild-scoped',()=>{
 const read=groups.read,get=prefs.get;try{groups.read=kind=>kind==='instagram'?[{guild_id:id,channel_id:channel.id}]:[];prefs.get=()=>({enabled:{instagram:true},instagram_member_roles:{'fiony-alveria':[mention.id]}});const raw={routes:Object.fromEntries(['live','recent','news','theater','birthday','x','tiktok'].map(k=>[k,{enabled:false,channels:[]}])),banner_style:'jkt48connect',platforms:['idn','showroom'],show_media:true};const preserved=validate(meta,raw);assert.equal(preserved.routes.instagram.enabled,true);assert.equal(preserved.routes.instagram.channels[0].channel_id,channel.id);const off=validate(meta,{...raw,routes:{...raw.routes,instagram:{enabled:false,channels:[]}}});assert.equal(off.routes.instagram.enabled,false);assert.throws(()=>validate(meta,{...raw,routes:{...raw.routes,instagram:{enabled:true,channels:[{channel_id:'666666666666666666',role_ids:[]}]}}}),/server ini/)}finally{groups.read=read;prefs.get=get}
});
test('two channels keep independent member choices, and legacy saves retain the filters',()=>{
 const second={...channel,id:'888888888888888888',name:'fiony'},scope={...meta,channels:[channel,second],allChannels:[channel,second]},catalog=[{id:'fiony-alveria'},{id:'jessica-chandra'}];
 const raw={routes:Object.fromEntries(Object.keys(groups.files).map(k=>[k,{enabled:false,channels:[]}])),banner_style:'jkt48connect',platforms:['idn','showroom'],show_media:true};
 raw.routes.live={enabled:true,channels:[{channel_id:channel.id,role_ids:[],member_ids:['jessica-chandra']},{channel_id:second.id,role_ids:[mention.id],member_ids:['fiony-alveria']}]};
 let saved=validate(scope,raw,catalog);assert.equal(saved.routes.live.channels.length,2);assert.deepEqual(saved.routes.live.channels[0].member_ids,['jessica-chandra']);assert.deepEqual(saved.routes.live.channels[1].member_ids,['fiony-alveria']);
 assert.throws(()=>validate(scope,{...raw,routes:{...raw.routes,live:{enabled:true,channels:[{channel_id:channel.id,role_ids:[],member_ids:['unknown-member']}]}}},catalog),/Member tidak tersedia/);
 assert.throws(()=>validate(scope,{...raw,routes:{...raw.routes,live:{enabled:true,channels:[raw.routes.live.channels[0],raw.routes.live.channels[0]]}}},catalog),/unik/);
 const read=groups.read;try{groups.read=kind=>kind==='live'?[{guild_id:id,channel_id:channel.id,member_ids:['jessica-chandra']}]:[];const legacy={...raw,routes:{...raw.routes,live:{enabled:true,channels:[{channel_id:channel.id,role_ids:[]}]}}};assert.deepEqual(validate(scope,legacy).routes.live.channels[0].member_ids,['jessica-chandra']);legacy.routes.live.channels[0].member_ids=null;assert.equal(validate(scope,legacy).routes.live.channels[0].member_ids,null)}finally{groups.read=read}
});
