const {randomBytes}=require('node:crypto');
const {PermissionFlagsBits:P,escapeMarkdown}=require('discord.js');
const groups=require('./guild-settings.cjs'),routing=require('./member-routing.cjs');
const sessions=new Map(),PAGE=20,TTL=15*60000;
const row=component=>({type:1,components:[component]});
const button=(custom_id,label,disabled=false,style=2)=>({type:2,custom_id,label,style,disabled});
function destination(guild,kind,id){
 const records=groups.read(kind).filter(r=>groups.belongs(r,guild)&&groups.idOf(r)===id);
 if(!records.length)return null;
 return {channel_id:id,role_ids:[...new Set(records.map(r=>r.role_id).filter(Boolean))],member_ids:records.find(r=>r.member_ids!==undefined)?.member_ids??null};
}
async function patchDestination(i,kind,id,patch){
 const channel=await i.guild.channels.fetch(id);
 if(!channel||channel.guildId!==i.guildId||![0,5].includes(channel.type))throw Error('Pilih channel teks di server ini.');
 const permissions=channel.permissionsFor(i.guild.members.me);
 if(!permissions?.has([P.ViewChannel,P.SendMessages,P.EmbedLinks]))throw Error('Bot perlu izin Melihat Channel, Mengirim Pesan, dan Embed pada channel tujuan.');
 const old=destination(i.guild,kind,id)||{channel_id:id,role_ids:[],member_ids:null},value={...old,...patch};
 for(const id of value.role_ids){const role=i.guild.roles.cache.get(id);if(!role||role.id===i.guildId||role.managed||(!role.mentionable&&!permissions.has(P.MentionEveryone)))throw Error('Pilih role yang dapat disebut oleh bot; @everyone tidak dipakai.');}
 groups.update(kind,i.guild,mine=>{
  const ids=new Set(mine.map(groups.idOf));if(!ids.has(id)&&ids.size>=10)throw Error('Maksimal 10 channel per jenis notifikasi. Hapus satu tujuan terlebih dahulu.');
  return [...mine.filter(r=>groups.idOf(r)!==id),...(value.role_ids.length?value.role_ids:[null]).map(role_id=>({guild_id:i.guildId,channel_id:id,role_id,member_ids:value.member_ids}))];
 });
}
function pageMembers(s){const search=s.query.toLowerCase();return s.members.filter(m=>[m.name,...(m.nicknames||[])].some(n=>n.toLowerCase().includes(search)))}
function render(s,guild){
 const current=s.channel&&destination(guild,s.kind,s.channel),filtered=pageMembers(s);s.page=Math.max(0,Math.min(s.page,Math.ceil(filtered.length/PAGE)-1));
 const members=filtered.slice(s.page*PAGE,(s.page+1)*PAGE),prefix='notifycfg:'+s.id+':';
 const configured=[...new Set(groups.read(s.kind).filter(r=>groups.belongs(r,guild)).map(groups.idOf))];
 const description=['Pilih jenis kabar, lalu tambahkan atau pilih channel. Setiap channel punya pilihan member dan role sendiri.',
  `**${groups.labels[s.kind]} · ${configured.length}/10 channel**`,configured.length?configured.map(id=>'<#'+id+'>').join(' · '):'Belum ada channel tujuan.',
  current?`\n**Sedang diatur: <#${s.channel}>**\n${current.member_ids===null?'Menerima semua member.':current.member_ids.length?'Hanya '+current.member_ids.length+' member pilihan.':'Belum ada member dipilih. Channel ini tidak menerima kabar member.'}`:'\nPilih channel melalui dropdown di bawah. Channel lain tetap tersimpan.'];
 if(current?.member_ids?.length)description.push(current.member_ids.slice(0,8).map(id=>escapeMarkdown(s.members.find(m=>m.id===id)?.name||id)).join(', ')+(current.member_ids.length>8?'…':''));
 const components=[row({type:3,custom_id:prefix+'kind',placeholder:'Jenis notifikasi',options:Object.entries(groups.labels).map(([value,label])=>({value,label,default:value===s.kind}))}),
  row({type:8,custom_id:prefix+'channel',placeholder:'Tambah atau pilih channel tujuan',channel_types:[0,5],min_values:1,max_values:1,...(current?{default_values:[{id:s.channel,type:'channel'}]}:{})})];
 if(current&&routing.FILTER_KINDS.has(s.kind)){
  components.push(row({type:3,custom_id:prefix+'members-'+s.page,placeholder:`${s.query?'Hasil pencarian':'Pilih member'} · halaman ${s.page+1}/${Math.max(1,Math.ceil(filtered.length/PAGE))}`,min_values:0,max_values:Math.max(1,members.length),disabled:!members.length,options:members.length?members.map(m=>({label:m.name.slice(0,100),value:m.id,default:current.member_ids?.includes(m.id)||false})):[{label:'Member tidak ditemukan',value:'unavailable'}]}));
  components.push({type:1,components:[button(prefix+'prev','Sebelumnya',s.page===0),button(prefix+'next','Berikutnya',(s.page+1)*PAGE>=filtered.length),button(prefix+'all','Semua member',false,current.member_ids===null?3:2),button(prefix+'search','Cari member'),button(prefix+'remove','Hapus channel',false,4)]});
 }else if(current)components.push({type:1,components:[button(prefix+'remove','Hapus channel',false,4),{type:2,style:5,label:'Buka dashboard',url:'https://jkt48connect.app/discord/'+guild.id}]});
 if(current)components.push(row({type:6,custom_id:prefix+'roles',placeholder:'Role mention untuk channel ini · opsional',min_values:0,max_values:5,default_values:current.role_ids.slice(0,5).map(id=>({id,type:'role'}))}));
 return {embeds:[groups.embed('Satu server, beberapa ruang kabar.',description.join('\n'),[{name:'Cara menyimpan',value:'Setiap pilihan langsung tersimpan. Pilihan member pada halaman lain tetap dipertahankan.'}])],components,allowedMentions:{parse:[]}};
}
async function open(i){
 if(!await groups.guard(i))return;await i.deferReply({flags:64});
 for(const [id,s]of sessions)if(s.until<Date.now())sessions.delete(id);
 while(sessions.size>=1000)sessions.delete(sessions.keys().next().value);
 const members=await routing.getCatalog().catch(()=>[]),s={id:randomBytes(9).toString('hex'),user:i.user.id,guild:i.guildId,kind:'live',channel:null,page:0,query:'',members,until:Date.now()+TTL};sessions.set(s.id,s);
 await i.editReply(render(s,i.guild));
}
async function handle(i){
 if(!i.customId?.startsWith('notifycfg:'))return false;
 const [,id,action]=i.customId.split(':'),s=sessions.get(id);
 if(!s||s.until<Date.now()||s.user!==i.user.id||s.guild!==i.guildId){await i.reply({content:'Panel ini sudah berakhir atau bukan milikmu. Jalankan `/notifikasi atur` kembali.',flags:64});return true}
 if(!await groups.guard(i))return true;
 if(action==='search'){
  await i.showModal({custom_id:'notifycfg:'+id+':query',title:'Cari member',components:[row({type:4,custom_id:'query',label:'Nama / nama panggilan (kosongkan untuk semua)',style:1,required:false,max_length:60,value:s.query})]});return true;
 }
 await i.deferUpdate();s.until=Date.now()+TTL;
 try{
  if(action==='kind'){if(!Object.hasOwn(groups.files,i.values[0]))throw Error('Jenis notifikasi tidak valid.');s.kind=i.values[0];s.channel=null;s.page=0;s.query='';}
  else if(action==='channel'){await patchDestination(i,s.kind,i.values[0],{});s.channel=i.values[0];s.page=0;}
  else if(action==='query'){s.query=i.fields.getTextInputValue('query').trim();s.page=0;}
  else if(action==='prev')s.page--;
  else if(action==='next')s.page++;
  else if(action==='remove'){const channel=s.channel;groups.update(s.kind,i.guild,mine=>mine.filter(r=>groups.idOf(r)!==channel));s.channel=null;}
  else if(action==='all'){await patchDestination(i,s.kind,s.channel,{member_ids:null});}
  else if(action==='roles'){await patchDestination(i,s.kind,s.channel,{role_ids:[...new Set(i.values)]});}
  else if(action.startsWith('members-')){
   if(Number(action.slice(8))!==s.page)throw Error('Halaman member berubah. Gunakan menu yang terbaru.');
   const visible=new Set(pageMembers(s).slice(s.page*PAGE,(s.page+1)*PAGE).map(m=>m.id));
   if(i.values.some(v=>!visible.has(v)))throw Error('Pilihan member tidak valid.');
   const old=destination(i.guild,s.kind,s.channel)?.member_ids||[];
   await patchDestination(i,s.kind,s.channel,{member_ids:[...new Set([...old.filter(id=>!visible.has(id)),...i.values])]});
  }
  await i.editReply(render(s,i.guild));
 }catch(error){await i.followUp({content:error.status===409?error.message:/^(Pilih|Bot |Maksimal|Halaman|Pilihan|Jenis)/.test(error.message)?error.message:'Pengaturan belum tersimpan. Coba lagi sebentar.',flags:64,allowedMentions:{parse:[]}});}
 return true;
}
module.exports={open,handle,render,destination,patchDestination,pageMembers};
