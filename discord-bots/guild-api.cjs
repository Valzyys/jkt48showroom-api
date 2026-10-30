/** Private bridge for the public dashboard. No owner/systemd/global routes. */
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {REST,PermissionFlagsBits:P}=require('discord.js'),{DatabaseSync}=require('node:sqlite');
const {safeEqual}=require('./runtime.cjs'),groups=require('./guild-settings.cjs'),prefs=require('./guild-preferences.cjs');
const TOKEN=process.env.DISCORD_GUILD_API_TOKEN||'',ID=/^\d{15,22}$/;if(TOKEN.length<32)throw Error('Private guild API token missing');
const rest=new REST({version:'10',timeout:15000}).setToken(process.env.DISCORD_TOKEN);
const routing=require('./member-routing.cjs');
const cache=new Map();
function fail(status,message){throw Object.assign(Error(message),{status})}
function installed(){return JSON.parse(fs.readFileSync(path.join(process.env.BOT_DATA_DIR,'state.json'),'utf8'))}
function permissions(guild,roles,member,channel){
 if(guild.owner_id===member.user.id)return (1n<<53n)-1n;
 let bits=0n;for(const r of roles)if(r.id===guild.id||member.roles.includes(r.id))bits|=BigInt(r.permissions);
 if(bits&P.Administrator)return (1n<<53n)-1n;if(!channel)return bits;
 const overwrites=channel.permission_overwrites||[],everyone=overwrites.find(o=>o.id===guild.id);if(everyone)bits=(bits&~BigInt(everyone.deny))|BigInt(everyone.allow);
 let deny=0n,allow=0n;for(const o of overwrites)if(o.type===0&&member.roles.includes(o.id)){deny|=BigInt(o.deny);allow|=BigInt(o.allow)}bits=(bits&~deny)|allow;
 const personal=overwrites.find(o=>o.type===1&&o.id===member.user.id);if(personal)bits=(bits&~BigInt(personal.deny))|BigInt(personal.allow);return bits;
}
async function metadata(id,user,fresh=false){
 const snapshot=installed();if(!snapshot.servers.some(s=>s.id===id))fail(404,'Bot belum terpasang di server ini.');
 let entry=cache.get(id);if(!entry||entry.until<Date.now()||fresh){const value=await Promise.all([rest.get('/guilds/'+id),rest.get('/guilds/'+id+'/roles'),rest.get('/guilds/'+id+'/channels'),rest.get('/guilds/'+id+'/members/'+snapshot.user.id)]);entry={value,until:Date.now()+30000};cache.set(id,entry)}
 const [guild,roles,channels,bot]=entry.value,member=await rest.get('/guilds/'+id+'/members/'+user);const rights=permissions(guild,roles,member);
 if(!(rights&(P.ManageGuild|P.Administrator))&&guild.owner_id!==user)fail(403,'Kamu tidak lagi memiliki izin Kelola Server.');
 const visible=channels.filter(c=>[0,5].includes(c.type)&&(permissions(guild,roles,member,c)&P.ViewChannel));
 const me={id,guild,roles,bot,channels:visible,allChannels:channels};return me;
}
function config(meta){const guild={id:meta.id,channels:{cache:new Map(meta.allChannels.map(c=>[c.id,c]))}},preference=prefs.get(meta.id);const routes={};
 for(const kind of Object.keys(groups.files)){const found=new Map();for(const r of groups.read(kind).filter(r=>groups.belongs(r,guild))){const id=groups.idOf(r),old=found.get(id)||{channel_id:id,role_ids:[],member_ids:r.member_ids??null};if(r.role_id&&!old.role_ids.includes(r.role_id))old.role_ids.push(r.role_id);found.set(id,old)}routes[kind]={enabled:preference.enabled?.[kind]??(kind==='recent'?preference.enabled?.live:undefined)??found.size>0,channels:[...found.values()].filter(r=>meta.channels.some(c=>c.id===r.channel_id))}}
 return {routes,platforms:preference.platforms||['idn','showroom'],banner_style:preference.banner_style||'jkt48connect',show_media:preference.show_media!==false};
}
function validate(meta,raw,members=[]){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail(400,'Pengaturan tidak valid.');const current=config(meta),out={...current,routes:{}};
 for(const kind of Object.keys(groups.files)){const value=raw.routes?.[kind]??(['recent','x','tiktok','instagram'].includes(kind)?current.routes[kind]:undefined);if(!value||typeof value.enabled!=='boolean'||!Array.isArray(value.channels)||value.channels.length>10)fail(400,'Pengaturan channel tidak valid.');const seen=new Set();const channels=[];
  for(const row of value.channels){const c=meta.channels.find(c=>c.id===row.channel_id);if(!c||!ID.test(row.channel_id)||seen.has(c.id))fail(400,'Channel harus unik dan berada di server ini.');seen.add(c.id);const bits=permissions(meta.guild,meta.roles,meta.bot,c),required=P.ViewChannel|P.SendMessages|P.EmbedLinks;if(value.enabled&&(bits&required)!==required)fail(400,'Bot belum memiliki izin melihat, mengirim, dan embed di #'+c.name+'.');
   if(!Array.isArray(row.role_ids)||row.role_ids.length>5)fail(400,'Maksimal 5 role per channel.');const roleIds=[...new Set(row.role_ids)];for(const id of roleIds){const role=meta.roles.find(r=>r.id===id);if(!role||role.id===meta.id||role.managed||(!role.mentionable&&!(bits&P.MentionEveryone)))fail(400,'Role tidak tersedia atau belum boleh disebut.');}let memberIds=row.member_ids;
   if(memberIds===undefined)memberIds=current.routes[kind].channels.find(x=>x.channel_id===c.id)?.member_ids??null;
   if(!routing.FILTER_KINDS.has(kind))memberIds=null;
   if(memberIds!==null){
    if(!Array.isArray(memberIds)||memberIds.length>200||memberIds.some(x=>typeof x!=='string'))fail(400,'Pilihan member tidak valid.');
    const known=new Set([...members.map(m=>m.id),...(current.routes[kind].channels.find(x=>x.channel_id===c.id)?.member_ids||[])]);
    if(memberIds.some(x=>!known.has(x)))fail(400,'Member tidak tersedia. Muat ulang daftar member.');
    memberIds=[...new Set(memberIds)];
   }
   channels.push({channel_id:c.id,role_ids:roleIds,member_ids:memberIds});
  }
  if(value.enabled&&!channels.length)fail(400,'Pilih minimal satu channel untuk notifikasi yang aktif.');out.routes[kind]={enabled:value.enabled,channels};
 }
 if(!['jkt48connect','photobook','avonera48'].includes(raw.banner_style))fail(400,'Style banner tidak valid.');if(!Array.isArray(raw.platforms)||raw.platforms.some(p=>!['idn','showroom'].includes(p)))fail(400,'Platform tidak valid.');out.banner_style=raw.banner_style;out.platforms=[...new Set(raw.platforms)];out.show_media=raw.show_media!==false;return out;
}
function save(meta,value){prefs.lock(()=>{const guild={id:meta.id,channels:{cache:new Map(meta.allChannels.map(c=>[c.id,c]))}};
 for(const kind of Object.keys(groups.files)){const data=groups.replaceGuildRows(groups.read(kind),guild,()=>value.routes[kind].channels.flatMap(c=>c.role_ids.length?c.role_ids.map(role_id=>({guild_id:meta.id,channel_id:c.channel_id,role_id,member_ids:c.member_ids??null})):[{guild_id:meta.id,channel_id:c.channel_id,role_id:null,member_ids:c.member_ids??null}]));const dest=path.join(__dirname,'Discord/channel',groups.files[kind]);fs.writeFileSync(dest+'.tmp',JSON.stringify(data),{mode:0o600});fs.renameSync(dest+'.tmp',dest)}
 prefs.save(meta.id,{enabled:Object.fromEntries(Object.entries(value.routes).map(([k,v])=>[k,v.enabled])),banner_style:value.banner_style,platforms:value.platforms,show_media:value.show_media});
})}
function history(meta){const db=new DatabaseSync(path.join(process.env.BOT_DATA_DIR,'notifications.sqlite'),{readOnly:true});try{const ids=meta.channels.map(c=>c.id);if(!ids.length)return[];return db.prepare("SELECT kind,status,channel,message_id,url,error,updated,json_extract(payload,'$.embeds[0].title') title FROM deliveries WHERE channel IN (SELECT value FROM json_each(?)) ORDER BY updated DESC LIMIT 25").all(JSON.stringify(ids))}finally{db.close()}}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>262144)fail(413,'Permintaan terlalu besar.')}try{return JSON.parse(raw)}catch{fail(400,'JSON tidak valid.')}}
function reply(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value))}
async function handler(req,res){try{
 if(!safeEqual(req.headers.authorization||'','Bearer '+TOKEN))return reply(res,{message:'Unauthorized'},401);
 if(req.method==='GET'&&req.url.startsWith('/activity-instances/')){const instance=req.url.slice('/activity-instances/'.length),user=req.headers['x-discord-user-id'];if(!/^[A-Za-z0-9_-]{1,160}$/.test(instance)||!ID.test(user||''))fail(400,'Sesi Activity tidak valid.');const snapshot=installed();const value=await rest.get('/applications/'+snapshot.user.id+'/activity-instances/'+instance);if(!Array.isArray(value.users)||!value.users.some(u=>String(typeof u==='string'?u:u.id)===user))fail(403,'Kamu belum bergabung pada sesi Activity ini.');return reply(res,{ok:true,instance_id:instance})}
 if(req.method==='GET'&&req.url==='/status'){const s=installed();return reply(res,{connected:s.connected,bot_id:s.user.id,guild_ids:s.servers.map(g=>g.id)})}
 const match=/^\/guilds\/(\d{15,22})(\/test)?$/.exec(req.url);if(!match||!['GET','PUT','POST'].includes(req.method))fail(404,'Endpoint tidak ditemukan.');const user=req.headers['x-discord-user-id'];if(!ID.test(user||''))fail(403,'Identitas pengguna tidak valid.');
 const meta=await metadata(match[1],user,req.method!=='GET');
 if(req.method==='POST'){let blocked=[];try{const value=JSON.parse(fs.readFileSync(path.join(__dirname,'Discord/channel/blacklist.json'),'utf8'));blocked=Array.isArray(value)?value.map(x=>String(x?.guild_id||x?.server_id||x?.id||x)):Object.keys(value)}catch(error){if(error.code!=='ENOENT')throw error}if(blocked.includes(meta.id))fail(403,'Notifikasi server ini dinonaktifkan oleh pemilik bot.');}
 if(req.method==='GET'&&!match[2])return reply(res,{guild:{id:meta.id,name:meta.guild.name,icon:meta.guild.icon},channels:meta.channels.map(c=>({id:c.id,name:c.name,can_send:(permissions(meta.guild,meta.roles,meta.bot,c)&(P.ViewChannel|P.SendMessages|P.EmbedLinks))===(P.ViewChannel|P.SendMessages|P.EmbedLinks)})),roles:meta.roles.filter(r=>r.id!==meta.id&&!r.managed).map(r=>({id:r.id,name:r.name,mentionable:r.mentionable,color:r.color})),settings:config(meta),members:routing.publicCatalog(await routing.getCatalog().catch(()=>[])),history:history(meta)});
 if(req.method==='PUT'&&!match[2]){const value=validate(meta,await body(req),await routing.getCatalog().catch(()=>[]));save(meta,value);console.log('guild-settings-saved guild='+meta.id+' user='+user);return reply(res,{ok:true,settings:value})}
 if(req.method==='POST'&&match[2]){const data=await body(req),settings=config(meta),route=settings.routes[data.kind];if(!route?.enabled||!route.channels.length)fail(400,'Aktifkan dan simpan channel tujuan lebih dahulu.');const checked=validate(meta,settings,await routing.getCatalog().catch(()=>[])),channel=data.channel_id?checked.routes[data.kind].channels.find(c=>c.channel_id===data.channel_id):checked.routes[data.kind].channels[0];if(!channel)fail(400,'Channel belum tersimpan untuk jenis notifikasi ini.');const sent=await rest.post('/channels/'+channel.channel_id+'/messages',{body:{content:channel.role_ids.map(id=>'<@&'+id+'>').join(' ')||undefined,embeds:[{title:'Tes notifikasi JKT48Connect',description:'Channel ini berhasil terhubung. Jenis: '+groups.labels[data.kind]+'.\nIni pesan uji dari dashboard server. Filter member: '+(channel.member_ids===null?'semua member':channel.member_ids.length+' member pilihan')+'.',color:0xec0034}],allowed_mentions:{parse:[],roles:channel.role_ids}}});console.log('guild-test-sent guild='+meta.id+' user='+user);return reply(res,{ok:true,url:'https://discord.com/channels/'+meta.id+'/'+channel.channel_id+'/'+sent.id})}
 fail(405,'Metode tidak didukung.');
 }catch(error){const status=error.status||([10007,50001,50013].includes(Number(error.code))?403:502);reply(res,{message:status<500?error.message:'Discord belum merespons. Coba lagi sebentar.'},status)}}
if(require.main===module)http.createServer(handler).listen(8797,'127.0.0.1',()=>console.log('Private guild dashboard bridge ready'));
module.exports={permissions,validate,save,config,handler};
