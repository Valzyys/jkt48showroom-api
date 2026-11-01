# TikTok member dan posting baru

Arsip posting publik TikTok member JKT48, diambil dari halaman embed publik tanpa login dan tanpa TikTok Display API. Tetap gunakan **API key JKT48Connect** untuk membaca route API.

## Endpoint

| Route | Fungsi |
| --- | --- |
| `GET /api/tiktok/status` | Heartbeat collector, jumlah akun/post, backoff sumber, dan status media |
| `GET /api/tiktok/members` | Member, username resmi TikTok, waktu pengecekan dan kendala per akun |
| `GET /api/tiktok/posts` | Posting yang sudah tersimpan, ID terbaru dahulu |
| `GET /api/tiktok/members/:member/posts` | Posting satu member berdasarkan slug, username atau nama lengkap yang tidak ambigu |
| `GET /api/tiktok/posts/:id` | Detail posting yang sudah tersimpan |
| `GET /api/tiktok/search?q=...` | Pencarian teks dalam arsip |
| `GET /api/tiktok/updates?after=0` | Event posting baru dengan cursor persisten |

Parameter daftar: `member` opsional, `limit` 1–100 (default 25), `before` dari `next_cursor`. Search memakai parameter yang sama ditambah `q` 1–200 karakter. Update menerima `after`, `limit`, dan `member` opsional. **Request API hanya membaca database**, tidak memicu request TikTok tambahan.

```bash
curl 'https://api.jkt48connect.app/api/tiktok/posts?member=fiony-alveria&limit=5' \
  -H 'X-API-Key: YOUR_JKT48CONNECT_API_KEY'
```

## Bentuk data dan media

Posting memuat `id` (string), `url` posting asli, `text`, `author`, `member`, `created_at`, `metrics`, `media`, `first_seen_at`, dan `last_observed_at`. Nilai yang tidak diberikan sumber tetap `null`. Misalnya tampilan `1.2M` disimpan di `metrics.views_display`; angka persis tidak ditebak. Waktu unggah hanya diisi jika detail publik memberikan waktunya, bukan dihitung dari ID.

`media.thumbnail`, `media.video`, dan setiap item `media.images` berbentuk objek dengan `status`, `url`, `bytes`, dan `reason`. Status `pending` berarti belum selesai diarsipkan, `ready` berarti URL R2 siap, dan `unsupported` disertai alasannya. Media diunduh dan diunggah satu per satu; gambar dibatasi 8 MiB dan video 64 MiB per file. Video yang lebih besar tidak diunggah oleh collector ini. URL posting asli tetap tersedia.

URL media siap memakai domain API, contoh `https://api.jkt48connect.app/media/tiktok/fiony-alveria/POST_ID/video`. Isinya berasal dari Cloudflare R2 dan mendukung `Range` agar video dapat diputar atau dipasang pada `<video controls src="...">`. Route media tidak memerlukan API key. Tautan CDN TikTok sementara tidak ditampilkan dalam respons publik.

`media.type` dapat berupa `video`, `photo`, atau `post` ketika jenis belum dipastikan. `images: null` berarti galeri belum tersedia, bukan bukti posting tidak memiliki gambar. Galeri hanya diisi jika detail sumber memberikannya. `reported_duration_seconds` adalah angka dari TikTok, bukan hasil pengukuran durasi berkas.

## Memantau posting baru

```js
let cursor = localStorage.getItem('tiktok_cursor') || '0';
async function checkTikTok() {
  const response = await fetch(
    `https://api.jkt48connect.app/api/tiktok/updates?after=${cursor}&limit=25`,
    { headers: { 'X-API-Key': 'YOUR_JKT48CONNECT_API_KEY' } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  for (const item of data.updates) {
    // Gunakan cursor sebagai kunci deduplikasi pada penyimpanan aplikasimu.
    console.log(item.cursor, item.post.member.name, item.post.text, item.post.url);
  }
  cursor = data.next_cursor;
  localStorage.setItem('tiktok_cursor', cursor); // Sesudah semua item berhasil diproses.
  return data.has_more;
}
```

Lanjutkan halaman jika `has_more=true`, kemudian beri jeda misalnya 30 detik. Respons update memuat `updates`, `next_cursor`, dan `latest_cursor`. Jika ingin mulai mengikuti dari sekarang, simpan `latest_cursor` dari respons awal. Pembacaan profil pertama disimpan sebagai **baseline**, sehingga posting lama tidak berubah menjadi notifikasi baru. Posting pinned lama, urutan berubah, atau restart collector tidak menghasilkan event duplikat. Event dan metadata disimpan permanen; ini tidak berarti semua riwayat TikTok sebelumnya sudah tersedia.

## Cakupan dan waktu pembaruan

Username berasal dari profil member resmi. Member yang belum menerbitkan username tetap tampil pada daftar member dengan `username: null`. Collector tidak menebak akun. Arsip awal diuji pada enam akun; akun lainnya dikumpulkan bertahap.

Collector menjalankan satu request sumber pada satu waktu dengan jeda acak 15–25 detik. Setiap akun dijadwalkan paling cepat 10–15 menit setelah berhasil, tetapi **putaran aktual bisa lebih lama**, terutama saat memproses banyak akun, mengambil detail atau menerima 403/429/503. Browser anonim cadangan dibatasi paling cepat satu kali per lima menit. Pembatasan sumber memicu backoff; tidak ada janji update seketika atau kelengkapan 100%.

`collector_online` hanya menandakan proses masih hidup. Periksa `last_success_at`, `next_check_at`, `last_error`, dan `coverage_gap_possible` per member. Jika TikTok menolak akses, arsip terakhir tetap bisa dibaca. Sumber hanya memberikan jendela posting terbatas; `history_complete` tetap false. Akun privat, DM, dan konten yang meminta login tidak diambil. Penghapusan dari jendela publik tidak otomatis dianggap penghapusan posting.

Fitur ini menyediakan data. Pengiriman notifikasi ke Discord, X, atau layanan lain dilakukan oleh aplikasi pemakainya.
