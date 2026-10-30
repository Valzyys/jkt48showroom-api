/** Owner-managed community badge; does not grant verification or staff access. */
const fs=require('node:fs'),path=require('node:path');
const {REST,Routes,PermissionFlagsBits:P}=require('discord.js');
const {guildId}=require('./community-plan.cjs');
const commands=[{name:'teman',description:'Kelola role teman Valzyy (khusus pemilik bot)',default_member_permissions:'0',options:[{type:1,name:'tambah',description:'Berikan role teman',options:[{type:6,name:'member',description:'Teman yang akan diberi role',required:true}]},{type:1,name:'hapus',description:'Cabut role teman',options:[{type:6,name:'member',description:'Member yang akan dicabut rolenya',required:true}]},{type:1,name:'info',description:'Lihat role teman dan panduan'}]}];
function authorized(i,owner){return Boolean(owner)&&i.guildId===guildId&&i.user.id===owner}
function safeRole(role){return Boolean(role)&&!role.managed&&role.permissions.bitfield===0n&&role.editable}
function install(client,dir){
 client.once('clientReady',async()=>{try{const rest=new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);for(const command of commands)await rest.post(Routes.applicationGuildCommands(client.user.id,guildId),{body:command});console.log('community-friends-ready guild='+guildId)}catch(e){console.warn('friend-command-sync-failed code='+String(e.code||e.name))}});
 return{async handle(i){if(!i.isChatInputCommand()||i.commandName!=='teman'||i.guildId!==guildId)return false;
  if(!authorized(i,process.env.BOT_OWNER_ID)){await i.reply({content:'Perintah ini hanya untuk Valzyy sebagai pemilik bot.',flags:64});return true}
  await i.deferReply({flags:64});
  const c=JSON.parse(fs.readFileSync(path.join(dir,'community-friends.json'),'utf8'));
  const role=await i.guild.roles.fetch(c.role_id);if(!safeRole(role))throw Error('Unsafe or unmanageable friend role');
  const sub=i.options.getSubcommand();
  if(sub==='info'){await i.editReply({content:'Role khusus: <@&'+role.id+'>\n`/teman tambah member:` untuk memberi role.\n`/teman hapus member:` untuk mencabutnya.\nRole ini tampil terpisah di daftar anggota dan tidak memberikan izin admin atau melewati verifikasi.',allowedMentions:{parse:[]}});return true}
  const user=i.options.getUser('member',true);if(user.bot){await i.editReply('Pilih akun teman, bukan bot.');return true}
  const member=await i.guild.members.fetch(user.id);
  if(!i.guild.members.me.permissions.has(P.ManageRoles)){await i.editReply('Bot belum memiliki izin Kelola Role.');return true}
  const has=member.roles.cache.has(role.id),adding=sub==='tambah';
  if(has!==adding){if(adding)await member.roles.add(role,'Role teman diberikan oleh pemilik bot '+i.user.id);else await member.roles.remove(role,'Role teman dicabut oleh pemilik bot '+i.user.id)}
  await i.editReply({content:(has===adding?'Sudah sesuai: ':adding?'Role teman diberikan ke ':'Role teman dicabut dari ')+'<@'+user.id+'>.',allowedMentions:{parse:[]}});
  console.log('community-friend-role action='+sub+' target='+user.id+' actor='+i.user.id);return true;
 }};
}
module.exports={install,commands,authorized,safeRole};
