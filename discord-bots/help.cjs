const path = require('node:path');
const {PermissionFlagsBits: P} = require('discord.js');
const community = require('./community-plan.cjs');
const PREFIX = 'jkc-help:';
const MEDIA_NAME = 'pip-guide.png';
const MEDIA_PATH = path.join(__dirname, 'assets/help', MEDIA_NAME);
const field = (name, value, inline = false) => ({name, value, inline});

function pages(i) {
  const admin = i.user.id === process.env.BOT_OWNER_ID || i.memberPermissions?.has(P.ManageGuild);
  const list = [
    {id:'home', label:'Mulai di sini', emoji:'👋', hint:'Peta fitur dan langkah pertama', title:'Hai, aku Pip. Mau mulai dari mana?', description:'Pilih topik lewat menu di bawah. Kamu bisa pindah halaman tanpa mengetik ulang `/help`.\n\nBaru mengajak bot ke server? Buka **Setup server**. Mau melihat bentuk pesannya? Coba `/preview`.', fields:[
      field('01 / Ikuti kabar oshi', 'Live & rekap, berita, theater, ulang tahun, X, TikTok, dan Instagram. Lihat **Notifikasi & media**.'),
      field('02 / Main sebentar', '`/games` untuk empat permainan solo atau bareng teman. `/news` untuk membaca pengumuman.'),
      field('03 / Punya server sendiri?', 'Gunakan `/undang` atau buka dashboard Discord. Pengaturan setiap server terpisah.'),
    ]},
    {id:'notifications',label:'Notifikasi & media',emoji:'📡',hint:'Delapan jenis kabar dalam satu tempat',title:'Kabar yang bisa masuk ke servermu.',description:'Admin memilih channel tujuan. Anggota tinggal mengikuti channel dan role yang sesuai.',fields:[
      field('Live → rekap', '**Live** · member mulai siaran, tautan menonton, dan gambar notifikasi jika tersedia.\n**Recent** · sesi selesai, ringkasan, dan banner rekap jika tersedia.'),
      field('Dari panggung & pengumuman', '**Berita** · pengumuman resmi.\n**Theater** · jadwal, pengingat, dan media jadwal jika tersedia.\n**Ulang tahun** · kabar H−7, H−1, dan hari ulang tahun.'),
      field('Dari media sosial', '**X** · tweet beserta media.\n**TikTok** · video atau posting foto.\n**Instagram** · posting, reel, atau carousel.\nMedia mengikuti yang tersedia dari sumber; video besar bisa ditampilkan lewat tautan.'),
      field('Intip formatnya', '`/preview jenis:live` · `/preview jenis:recent`\n`/preview jenis:x` · `/preview jenis:tiktok`\n`/preview jenis:instagram`\nPilihan lain: `news`, `theater`, `birthday`. Preview hanya terlihat oleh kamu dan tidak menyebut role.'),
    ]},
    {id:'setup',label:'Setup server',emoji:'🛠️',hint:'Channel tujuan, izin bot, dan dashboard',title:'Beri setiap kabar tempatnya.',description:admin?'Kamu bisa mengatur server ini dengan izin **Kelola Server**. Semua langkah di bawah juga tersedia di dashboard Discord.':'Panduan ini untuk pengelola server. Minta admin dengan izin **Kelola Server** menjalankan pengaturannya.',fields:[
      field('1 / Siapkan channel', 'Bot memerlukan **Lihat Channel**, **Kirim Pesan**, dan **Sematkan Tautan**. Tambahkan **Lampirkan File** dan **Baca Riwayat Pesan** agar bot bisa melengkapi gambar/video pada notifikasi.'),
      field('2 / Pilih jenis kabar → channel', '`/setlivechannel channel:#live`\n`/setrecentchannel channel:#rekap`\n`/setnewschannel channel:#berita`\n`/setshowchannel channel:#theater`\n`/setbirthdaychannel channel:#ulang-tahun`\n`/setxchannel channel:#tweet`\n`/settiktokchannel channel:#tiktok`\n`/setinstagramchannel channel:#instagram`'),
      field('3 / Cek, lalu coba', '`/notifikasi status` untuk memeriksa tujuan.\n`/preview jenis:live` untuk melihat contoh secara privat.\nUntuk menghentikan satu jenis: `/notifikasi matikan jenis:live`. Aktifkan lagi dengan mengatur channel tujuannya.'),
      field('Beberapa channel, pilihan member berbeda', 'Buka `/notifikasi atur`: pilih jenis kabar, channel, member, lalu role mention. Sampai **10 channel per jenis**. Pilihan tersimpan langsung di panel. Di **jkt48connect.app/discord**, kamu juga bisa mencari member, menyimpan, dan menguji setiap channel. Channel lama tetap menerima semua member sampai kamu membatasinya.'),
    ]},
    {id:'roles',label:'Mention role & oshi',emoji:'🌸',hint:'Ping umum dan role per member',title:'Panggil orang yang memang ingin tahu.',description:'Pengaturan role memerlukan **Kelola Server**. Pilih member dari autocomplete agar pemetaannya tepat.',fields:[
      field('Role untuk satu channel', 'Gunakan opsi `role` pada perintah pengaturan channel yang mendukungnya.\nContoh: `/setlivechannel channel:#live role:@KabarLive`.\nRole umum akan disebut pada notifikasi ke channel itu.'),
      field('Role oshi per member', '`/setxrole member:<pilih member> role:@Oshi`\n`/settiktokrole member:<pilih member> role:@Oshi`\n`/setinstagramrole member:<pilih member> role:@Oshi`\nPemetaan X, TikTok, dan Instagram diatur masing-masing; tetap siapkan channel tujuannya.'),
      field('Hapus satu pemetaan', '`/removexrole member:<pilih member>`\n`/removetiktokrole member:<pilih member>`\n`/removeinstagramrole member:<pilih member>`'),
      field('Kalau role tidak terpanggil', 'Aktifkan pengaturan agar role bisa disebut, atau berikan izin mention yang sesuai kepada bot di channel tujuan. Hindari memakai role umum jika hanya ingin ping oshi tertentu.'),
    ]},
    {id:'games',label:'Games & Activity',emoji:'🎮',hint:'Empat permainan, solo atau multiplayer',title:'Oshi boleh sama. Skor boleh beda.',description:'Jalankan `/games` atau buka halaman Games. Bisa dimainkan sendiri atau bareng teman.',fields:[
      field('Pilih permainanmu', '**Tebak Member** · kenali potongan foto.\n**Quiz JKT48** · jawab pertanyaan seputar JKT48.\n**Memory Card** · temukan pasangan kartu.\n**Tebak Lagu** · dengarkan cuplikan dan tebak judulnya.'),
      field('Main lewat Discord', 'Jika Activity sudah tersedia, buka **Apps → JKT48Connect → Launch**. Untuk pilihan lewat browser, gunakan tombol **Games** di bawah.'),
      field('Ajak teman', 'Ikuti pilihan solo atau multiplayer di dalam game. Halaman `/games` mendukung permainan bersama hingga 16 pemain.'),
    ]},
    {id:'commands',label:'Perintah sehari-hari',emoji:'⌨️',hint:'Baca berita, preview, undang, dan dukungan',title:'Perintah kecil, langsung kepakai.',description:'Ketik `/` lalu pilih JKT48Connect untuk melihat opsi yang tersedia pada akunmu.',fields:[
      field('Baca & jelajahi', '`/news` · pilih dan baca pengumuman.\n`/preview jenis:<pilihan>` · lihat contoh notifikasi secara privat.\n`/help` · buka panduan ini lagi.'),
      field('Main & ajak server lain', '`/games` · buka Arcade JKT48Connect.\n`/undang` · dapatkan tautan untuk menambahkan bot ke server lain.'),
      field('Untuk developer & dukungan', '`/buyapikey` · informasi akses API.\n`/donasi` · informasi dukungan pengembangan.\nMemakai bot Discord tidak mengharuskan anggota membeli API key.'),
    ]},
    {id:'faq',label:'Bantuan & troubleshooting',emoji:'💬',hint:'Notifikasi sepi, media kosong, atau izin kurang',title:'Ada yang belum jalan? Cek dari sini.',description:'Panduan ini tidak mengubah konfigurasi dan tidak mengirim notifikasi ke channel lain.',fields:[
      field('Notifikasi belum masuk', 'Minta admin memeriksa `/notifikasi status`, channel tujuan, dan izin bot. Tidak semua jenis kabar muncul setiap saat. Catat jenis notifikasi, nama member, waktu kejadian, dan tautan pesan saat melapor.'),
      field('Gambar atau video tidak muncul', 'Periksa **Sematkan Tautan** dan **Lampirkan File**, serta pengaturan media di dashboard. Sumber yang belum memiliki media atau media yang melebihi batas Discord bisa ditampilkan sebagai tautan.'),
      field('Perintah pengaturan tidak terlihat', 'Gunakan dari server, bukan DM. Pastikan kamu memiliki **Kelola Server**. Fitur komunitas tertentu hanya tersedia di server JKT48Connect.'),
      field('Perlu bantuan pengelola?', 'Buka website JKT48Connect dan gunakan jalur bantuan komunitas. Sertakan tangkapan layar seperlunya; jangan bagikan password, token, cookie, atau API key.'),
    ]},
  ];
  if (i.guildId === community.guildId) list.splice(6,0,{
    id:'community',label:'Musik & level komunitas',emoji:'🎵',hint:'Khusus server komunitas JKT48Connect',title:'Satu voice, banyak lagu favorit.',description:'Fitur di halaman ini khusus **server JKT48Connect**. Selesaikan verifikasi server sebelum menggunakan fitur yang memerlukannya.',fields:[
      field('Mulai musik', 'Masuk ke voice channel, lalu `/play lagu:River` atau pilih judul dari autocomplete.\n`/jkt48` mengaktifkan mode acak lagu JKT48.'),
      field('Kontrol pemutar', '`/queue` · daftar lagu\n`/nowplaying` · lagu saat ini\n`/pause` · `/resume` · `/skip`\n`/shuffle` · acak antrean\n`/stop` · hentikan dan keluar dari voice\nKamu harus berada di voice yang sama dengan bot.'),
      field('Level komunitas', '`/rank member:<opsional>` atau `/level` untuk melihat XP.\n`/leaderboard halaman:1` untuk melihat peringkat.\nObrolan yang memenuhi syarat mendapat 15–25 XP, maksimal sekali per menit, di channel leveling yang sudah diatur.'),
      field('Pilih oshi & bantuan', 'Gunakan menu role dan verifikasi di channel yang sudah disediakan server. Untuk masalah pribadi, gunakan tiket bantuan server.'),
    ],
  });
  if (process.env.BOT_OWNER_ID && i.user.id === process.env.BOT_OWNER_ID) list.push({
    id:'owner',label:'Meja pemilik bot',emoji:'🔑',hint:'Khusus pemilik, berlaku lintas server',title:'Pengaturan global milikmu.',description:'Halaman ini hanya muncul untuk pemilik bot. Pengaturan global berbeda dari konfigurasi tiap server.',fields:[
      field('Sumber notifikasi', '`/pengaturanbot` untuk melihat status.\nOpsi `sumber`, `aktif`, dan `interval` mengatur sumber secara global. Perubahan memengaruhi semua server.'),
      field('Pemantauan', 'Gunakan control admin untuk memeriksa kesehatan bot, log, server terpasang, dan riwayat pengiriman. Halaman bantuan ini sendiri tidak mengubah apa pun.'),
    ],
  });
  return list;
}

function payload(i, id='home', {initial=false}={}) {
  const list=pages(i), page=list.find(p=>p.id===id)||list[0], index=list.indexOf(page);
  const attachment= i.message?.attachments?.find(a=>a.name===MEDIA_NAME);
  const media=attachment?.url || 'attachment://'+MEDIA_NAME;
  const links=[{type:2,style:5,label:'Dashboard Discord',url:'https://jkt48connect.app/discord'}, {type:2,style:5,label:'Games',url:'https://jkt48connect.app/games'}, {type:2,style:5,label:'Website',url:'https://jkt48connect.app'}];
  if(page.id==='owner')links.push({type:2,style:5,label:'Control pemilik',url:'https://api.jkt48connect.app/control/admin?tab=discord-bot'});
  return {
    ...(initial?{flags:64}:{}),
    embeds:[
      {color:0xec0034,image:{url:media}},
      {color:0xec0034,author:{name:'PIP / BUKU SAKU JKT48CONNECT'},title:page.title,description:page.description,fields:page.fields,footer:{text:`${String(index+1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}  ·  ${page.label}  ·  Hanya kamu yang melihat panduan ini`}},
    ],
    ...(!attachment?{files:[{attachment:MEDIA_PATH,name:MEDIA_NAME}]}:{}),
    components:[
      {type:1,components:[{type:3,custom_id:PREFIX+'topic',placeholder:'Pilih topik panduan',min_values:1,max_values:1,options:list.map(p=>({label:p.label,value:p.id,description:p.hint,emoji:{name:p.emoji},default:p.id===page.id}))}]},
      {type:1,components:[
        {type:2,style:2,label:'Sebelumnya',custom_id:PREFIX+'prev:'+(list[index-1]?.id||'start'),disabled:index===0},
        {type:2,style:page.id==='home'?2:1,label:'Beranda',custom_id:PREFIX+'home',disabled:page.id==='home'},
        {type:2,style:2,label:'Berikutnya',custom_id:PREFIX+'next:'+(list[index+1]?.id||'end'),disabled:index===list.length-1},
      ]},
      {type:1,components:links},
    ],
    allowedMentions:{parse:[]},
  };
}

async function handle(i) {
  if ((!i.isStringSelectMenu()&&!i.isButton()) || !i.customId?.startsWith(PREFIX)) return false;
  // Ephemeral replies are private; also reject copied/stale components owned by someone else.
  const owner=i.message?.interactionMetadata?.user?.id || i.message?.interaction?.user?.id;
  if(owner && owner!==i.user.id){await i.reply({content:'Buka `/help` untuk mendapat panduanmu sendiri.',flags:64});return true;}
  const id=i.isStringSelectMenu()?i.values?.[0]:i.customId.slice(PREFIX.length).replace(/^(?:prev|next):/,'');
  await i.update(payload(i,id));
  return true;
}
module.exports={pages,payload,handle,MEDIA_PATH,MEDIA_NAME};
