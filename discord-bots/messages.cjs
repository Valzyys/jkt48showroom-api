const SITE='https://jkt48connect.app',COLOR=0xec0034;
const text=(s,max=1024)=>String(s??'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').slice(0,max);
function https(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
const timestamp=(v)=>{const n=typeof v==='number'?(v<1e12?v*1000:v):Date.parse(v);return Number.isFinite(n)?Math.floor(n/1000):null};
const number=v=>Number.isFinite(Number(v))?Number(v).toLocaleString('id-ID'):'—';
const duration=ms=>{const m=Math.floor(Number(ms||0)/60000);return `${Math.floor(m/60)}j ${m%60}m`};
function banner(row,kind,style="jkt48connect"){if(kind==='news')return row.news_image?.status==='ready'?https(row.news_image.url):null;const field=kind==='live'?'notification_designs':kind==='recent'?'leaderboard_designs':'schedule_designs';const b=row?.[field]?.[style]?.banner;return b?.status==='ready'?https(b.url):null}
function message(kind,row,{reminder=false,birthdayDays=0,banner_style="jkt48connect",footer="JKT48Connect · Satu oshi, banyak cerita."}={}){
 const member=row.member||row.room_info||{},name=text(row.name||member.name||row.nickname||'JKT48',180);
 const platform=row.type==='idn'?'IDN':row.type==='showroom'?'SHOWROOM':'JKT48';
 const embed={color:COLOR,author:{name:'JKT48Connect · '+({live:'ON AIR',recent:'LIVE RECAP',news:'NEWSROOM',theater:'THEATER NOTES',birthday:'BIRTHDAY'}[kind]||'UPDATE')},footer:{text:footer}};
 let url=SITE,image=banner(row,kind,banner_style);const fields=[];
 if(kind==='live'){
  embed.title=`${name} sedang live`;embed.description=`${text(row.title||'Ada cerita baru untuk dibagikan.',1500)}\n\nAmbil tempatmu. Sampai ketemu di live!`;
  const start=timestamp(row.started_at);fields.push({name:'Platform',value:platform,inline:true});if(start)fields.push({name:'Mulai',value:`<t:${start}:t> · <t:${start}:R>`,inline:true});url=https(row.live_url)||SITE;
 }else if(kind==='recent'){
  embed.title=`Sampai jumpa di live berikutnya, ${name}`;embed.description=text(row.idn?.title||row.title||'Live selesai. Ini catatan kecil dari sesi tadi.',1400);
  const info=row.live_info||{};fields.push({name:'Durasi',value:duration(info.duration),inline:true},{name:'Penonton',value:number(info.viewers?.num),inline:true},{name:row.point_unit==='idn_gold'?'Gold tercatat':'Poin tercatat',value:number(row.points??row.total_gifts),inline:true});const end=timestamp(info.date?.end||row.created_at);if(end)fields.push({name:'Selesai',value:`<t:${end}:f>`,inline:true});url=SITE+'/recent/'+encodeURIComponent(row.data_id||row.id||row._id||'');
 }else if(kind==='news'){
  embed.title=text(row.title||'Kabar terbaru dari JKT48',250);embed.description=text(row.content||row.description||'Ada kabar baru. Buka berita untuk membaca pengumuman selengkapnya.',2500);url=https(row.url)||`https://jkt48.com/news/detail/id/${encodeURIComponent(row.id)}?lang=id`;image=banner(row,kind,banner_style)||https(row.image||row.img);const stamp=timestamp(row.date);if(stamp)fields.push({name:'Diterbitkan',value:`<t:${stamp}:D>`,inline:true});
 }else if(kind==='theater'){
  embed.title=reminder?'Sebentar lagi, lampu panggung menyala':'Catat jadwal panggungnya';embed.description=`**${text(row.title||'Theater JKT48',230)}**\n${reminder?'Show dimulai sekitar 30 menit lagi. Siapkan tiket dan jangan sampai terlewat.':'Simpan waktunya, lihat lineup, dan siapkan harimu.'}`;
  const start=timestamp(row.start_date||row.date||row.start_time);if(start)fields.push({name:'Waktu show',value:`<t:${start}:F>`,inline:false});const members=(row.members||[]).map(m=>text(m.name,60));if(members.length)fields.push({name:'Di panggung',value:text(members.join(' · '),1000),inline:false});const birthdays=(row.seitansai||[]).map(m=>text(m.name,60));if(birthdays.length)fields.push({name:'Birthday show',value:birthdays.join(' · ').slice(0,1000),inline:false});url=https(row.url)||SITE+'/theater';
 }else if(kind==='birthday'){
  embed.title=birthdayDays?`${birthdayDays} hari menuju hari spesial ${name}`:`Selamat ulang tahun, ${name}!`;embed.description=birthdayDays?'Satu tanggal untuk disimpan. Yuk, siapkan ucapan terbaikmu.':'Semoga langkah berikutnya dipenuhi hal baik, panggung yang berkesan, dan orang-orang yang selalu mendukungmu. ♡';image=https(row.img||row.img_alt);if(row.age_after_birthday)fields.push({name:'Usia baru',value:String(row.age_after_birthday),inline:true});url=SITE+'/members';
 }
 embed.url=url;if(fields.length)embed.fields=fields;if(image)embed.image={url:image};const thumb=https(row.img||member.img);if(thumb&&kind!=='birthday')embed.thumbnail={url:thumb};
 return {embeds:[embed],components:[{type:1,components:[{type:2,style:5,label:{live:'Tonton live',recent:'Buka rekap',news:'Baca pengumuman',theater:'Lihat jadwal & tiket',birthday:'Kenali member'}[kind]||'Buka',url},{type:2,style:5,label:'JKT48Connect',url:SITE}]}],allowedMentions:{parse:[]}};
}
module.exports={message,banner,rowsText:text,timestamp,https};
