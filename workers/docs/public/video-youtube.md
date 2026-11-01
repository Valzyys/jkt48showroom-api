# Video YouTube JKT48

Daftar video, playback **HLS `.m3u8` dengan audio**, dan komentar publik kanal resmi **JKT48** serta **JKT48 TV**. Endpoint data ini **memerlukan API key JKT48Connect**. Pengguna API tidak perlu menyiapkan API key Google atau login akun YouTube sendiri.

## Daftar video

```bash
curl 'https://api.jkt48connect.app/api/jkt48_youtube' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Respons berupa array maksimal 20 video terbaru dari dua feed resmi. Field lama (`id`, `title`, `description`, `channelId`, `channelTitle`, `channelUrl`, `url`, `date`, `thumbnails`, `statistics`, `source`) tetap tersedia. Setiap video mendapat `playback` dan `comments_url`:

```json
{
  "id": "hAHv54gxD60",
  "channelTitle": "JKT48",
  "url": "https://www.youtube.com/watch?v=hAHv54gxD60",
  "playback": {
    "status": "on_demand",
    "format": "m3u8",
    "mime_type": "application/vnd.apple.mpegurl",
    "includes_audio": true,
    "url": "https://api.jkt48connect.app/media/youtube/hAHv54gxD60/<ticket>/index.m3u8",
    "expires_at": 1793100000,
    "details_url": "https://api.jkt48connect.app/api/jkt48_youtube/hAHv54gxD60"
  },
  "comments_url": "https://api.jkt48connect.app/api/jkt48_youtube/hAHv54gxD60/comments"
}
```

`<ticket>` dan timestamp hanya ilustrasi. Pakai URL lengkap dari respons API, jangan menyusun ticket sendiri. `url` di tingkat video tetap tautan halaman YouTube; URL pemutar ada di **`playback.url`**.

Daftar dicache tiga menit. Jika Atom YouTube bermasalah, scraper membaca halaman video kanal resmi yang sama. Fallback ini ditandai `source: "youtube-public-channel"`, `date_is_approximate: true`, dan `published_text` karena halaman kanal hanya memberikan tanggal relatif. Tanggal tersebut bukan timestamp publikasi tepat.

Salinan terakhir yang valid disimpan lintas instance Worker maksimal 24 jam: `feed_status: "stale"` menunjukkan sumber belum berhasil diperbarui, sedangkan `feed_updated_at` menunjukkan waktu pengambilan terakhir. Setelah batas ini habis, kegagalan sumber menghasilkan 502 dengan pesan yang jelas. Percobaan ulang diberi jeda agar tidak membanjiri sumber. `on_demand` berarti sumber HLS dicari ketika URL dibuka; ketersediaan sumber belum diverifikasi untuk setiap item daftar. Tidak ada pemindaian seluruh video saat daftar diminta.

## Detail dan URL HLS

```bash
curl 'https://api.jkt48connect.app/api/jkt48_youtube/hAHv54gxD60' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Detail memverifikasi kanal serta sumber publik dan mengembalikan `playback.status: "ready"`, `format: "m3u8"`, `qualities` (contoh `[360,480,720,1080]`), dan URL playlist bertanda tangan. Pilihan kualitas mengikuti sumber; 1080p tidak selalu tersedia. Audio dan video berada dalam segmen yang sama.

Playback juga mendukung video arsip kanal **JKT48 LiveChapter**, termasuk replay unlisted yang tertera pada data recent. ID video terdapat di `youtube_replay.videos[].youtube_id`; gunakan `stream_url` atau `playback.url` dari respons. Replay beresolusi rendah dapat menyediakan `[144]` atau `[240]`; kualitas asli tidak dinaikkan secara palsu. Dukungan komentar pada panduan ini tetap untuk dua kanal resmi di atas. Kredensial akses sumber dikelola server dan tidak dikirim kepada pengguna API.

Playlist utama, playlist kualitas, dan segmen MPEG-TS dilayani melalui domain API dengan CORS. Player mengambil segmen sesuai kebutuhan, dapat berpindah kualitas dan melakukan seek pada VOD. Video penuh tidak diunduh/disimpan terlebih dahulu. Pencarian pertama dapat memerlukan beberapa detik; metadata dicache 20 menit dan pencarian bersamaan digabung.

URL berlaku sekitar tiga jam. Jika mendapat **410**, ambil ulang detail untuk URL baru. URL ini bersifat sementara, bukan permalink untuk disimpan selamanya. Video privat, berbayar, dibatasi usia/akun, dan kanal lain tidak didukung. Bila YouTube tidak menyediakan HLS publik yang bisa diakses, API mengembalikan error; tidak mengganti ekstensi MP4 menjadi `.m3u8`.

## Putar di website atau aplikasi

Safari dapat memakai HLS native melalui `<video>`. Untuk browser dengan Media Source Extensions seperti Chrome/Firefox, gunakan **hls.js** dari bundel aplikasi Anda:

```js
import Hls from 'hls.js';

const response = await fetch(
  '/api/youtube/hAHv54gxD60' // Backend aplikasi Anda menambahkan X-API-Key.
);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { playback } = await response.json();
const video = document.querySelector('video');
video.controls = true;
video.playsInline = true;

if (video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = playback.url;
} else if (Hls.isSupported()) {
  const hls = new Hls();
  hls.loadSource(playback.url);
  hls.attachMedia(video);
  // Saat komponen dilepas: hls.destroy().
} else {
  throw new Error('Pemutar HLS tidak didukung browser ini');
}
```

Contoh di atas memakai route backend milik aplikasi Anda untuk mendapatkan detail. Backend mengirim header `X-API-Key` ke JKT48Connect; key tidak ditanam di JavaScript browser. URL playback yang dikembalikan memuat ticket terbatas waktu, sehingga player tidak perlu membawa API key pada setiap segmen. URL tanpa ticket valid ditolak.

Gunakan tombol play pengguna sesuai kebijakan autoplay browser. Pemutar native Android/iOS yang mendukung HLS juga dapat menerima `playback.url`. Membuka URL `.m3u8` langsung pada address bar Chrome biasanya mengunduh playlist, sehingga gunakan pemutar HLS.

## Komentar dan halaman berikutnya

```bash
curl 'https://api.jkt48connect.app/api/jkt48_youtube/hAHv54gxD60/comments' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

```json
{
  "video_id": "hAHv54gxD60",
  "status": "available",
  "sort": "top",
  "replies_included": false,
  "comments": [
    {
      "id": "COMMENT_ID",
      "text": "Isi komentar\n\nParagraf berikutnya",
      "author": {
        "name": "Nama penonton",
        "channel_id": "UC...",
        "url": "https://www.youtube.com/channel/UC...",
        "avatar": "https://yt3.ggpht.com/...",
        "is_uploader": false
      },
      "published_text": "2 days ago",
      "published_at": null,
      "likes": 12,
      "reply_count": 3,
      "url": "https://www.youtube.com/watch?v=hAHv54gxD60&lc=COMMENT_ID"
    }
  ],
  "total_count": 455,
  "next_cursor": "<cursor dari respons>",
  "has_more": true,
  "observed_at": 1793100000
}
```

Maksimal 20 komentar tingkat pertama per halaman, urutan teratas dari YouTube. Balasan tidak diambil otomatis. `published_text` berasal dari sumber; `published_at` tetap `null` bila timestamp tepat tidak tersedia. Total dan likes dapat `null` bila tidak diketahui. Contoh angka di atas bukan data yang dijamin tetap.

Ambil halaman berikutnya **hanya saat dibutuhkan**:

```js
const next = new URL(
  'https://api.jkt48connect.app/api/jkt48_youtube/hAHv54gxD60/comments'
);
next.searchParams.set('cursor', data.next_cursor);
// Contoh backend Node.js:
const page = await fetch(next, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
}).then(r => r.json());
```

Cursor terikat pada satu video, kedaluwarsa sekitar 30 menit, dan bisa hilang saat relay direstart. Jika 410, mulai dari halaman pertama. Respons komentar dicache dua menit. Komentar dinonaktifkan menghasilkan `status: "disabled"`; kegagalan sumber tidak disamarkan menjadi daftar kosong.

## Batas dan kegagalan sumber

Endpoint hanya untuk dua kanal resmi, bukan proxy URL bebas. Pemutaran memakai bandwidth relay sesuai jumlah penonton dan kualitas. Pencarian sumber, request komentar baru, ukuran playlist/segmen, serta koneksi segmen dibatasi agar tidak mengganggu layanan lain. **429** berarti tunggu sebelum mencoba lagi; **502** berarti sumber sementara tidak tersedia. Hindari polling rapat atau mengulang otomatis tanpa batas.

Jika feed salah satu kanal gagal, daftar dapat memakai kanal lain/salinan terakhir. Bila kedua sumber gagal tanpa data tersimpan, daftar memberikan 502. HLS dan komentar mengikuti perubahan layanan publik YouTube; ketersediaan tidak dijamin untuk semua video.
