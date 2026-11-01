# Instagram member dan posting baru

Collector membaca halaman publik Instagram **tanpa login akun, cookie akun, atau Instagram Graph API**. Username berasal dari profil resmi JKT48. API key JKT48Connect tetap digunakan untuk mengakses route API, seperti endpoint lainnya.

## Endpoint

| Route | Fungsi |
| --- | --- |
| `GET /api/instagram/status` | Status proses, keberhasilan sumber, jeda/backoff, jumlah posting dan media R2 |
| `GET /api/instagram/members` | Username resmi, ringkasan profil yang sudah terbaca dan status per member |
| `GET /api/instagram/posts` | Posting yang sudah tersimpan, ID terbaru dahulu |
| `GET /api/instagram/posts/:id` | Detail berdasarkan ID numerik **atau shortcode** Instagram |
| `GET /api/instagram/members/:member/posts` | Posting satu member berdasarkan slug, username atau nama lengkap yang tidak ambigu |
| `GET /api/instagram/members/:member/profile` | Profil publik terakhir yang tersimpan |
| `GET /api/instagram/updates?after=0` | Event posting baru dengan cursor persisten |
| `GET /api/instagram/search?q=...` | Pencarian teks di arsip |

```bash
curl 'https://api.jkt48connect.app/api/instagram/posts?member=fiony-alveria&limit=5' \
  -H 'X-API-Key: YOUR_JKT48CONNECT_API_KEY'

curl 'https://api.jkt48connect.app/api/instagram/posts/De6Ba0ioCG1' \
  -H 'X-API-Key: YOUR_JKT48CONNECT_API_KEY'
```

Daftar menerima `member` opsional, `limit` 1–100 (default 25), dan `before` dari `next_cursor`. Search memakai parameter yang sama ditambah `q` 1–200 karakter. Update menerima `after`, `limit`, dan `member` opsional. Permintaan API **hanya membaca database**, tidak memicu scraping Instagram.

## Posting, Reel dan carousel

Posting memuat `id` numerik sebagai string, `shortcode`, `url`, `text`, `created_at`, `author`, `member`, `metrics`, `media`, `first_seen_at` dan `last_observed_at`. Profil dapat memuat bio, nama Instagram, status verified, serta angka follower/following jika diberikan sumber. Field yang tidak tersedia bernilai `null`.

Halaman profil biasanya memberi caption dan cover terlebih dahulu. Detail diambil bertahap untuk memperoleh waktu unggah, angka interaksi, video, serta seluruh item carousel. `created_at` tetap null sebelum sumber memberikan timestamp; tanggal tidak ditebak dari ID. Metrik tersembunyi atau tidak tersedia tidak diganti angka nol. `detail_observed_at` dan `metrics_observed_at` menunjukkan waktu detail/angka terakhir terbaca; ini terpisah dari `last_observed_at` pada daftar profil. Detail lama diperiksa kembali bertahap setelah minimal enam jam, sesuai antrean dan pembatasan sumber.

`media.type` berupa `image`, `video`, `carousel`, atau `post` jika belum diketahui. `media.detail_status` menunjukkan apakah detail sudah terbaca. `media.expected_items` adalah jumlah item yang disebut sumber; `media.items` berisi urutan carousel yang benar-benar ditemukan. Carousel dapat berisi foto dan video.

## Media R2

Thumbnail, foto dan video diarsipkan secara bertahap ke Cloudflare R2. Respons publik memakai URL domain API yang membaca R2, tanpa menampilkan URL CDN Instagram yang bisa kedaluwarsa.

`media.thumbnail`, `media.video`, `media.images[]`, serta thumbnail/video setiap `media.items[]` berisi `status`, `url`, `bytes`, dan `reason`. Status `pending` berarti belum selesai diarsipkan; `ready` berarti URL tersedia; `unsupported` disertai alasannya. Gambar dibatasi 8 MiB dan video 64 MiB per berkas. Berkas lebih besar tidak diunggah oleh collector ini, tetapi tautan posting asli tetap tersedia.

Video R2 mendukung `Range`, sehingga dapat diputar dan di-seek:

```html
<video controls playsinline src="URL_DARI_MEDIA_VIDEO"></video>
```

Route media tidak memerlukan API key. `images: null` pada carousel berarti detail belum tersedia, bukan bahwa posting hanya memiliki satu foto. Ketika detail sudah terbaca tetapi sebagian media masih pending, jumlah item bisa sudah lengkap sementara unggahan R2 masih berjalan.

## Mengikuti posting baru

```js
let cursor = localStorage.getItem('instagram_cursor') || '0';
async function checkInstagram() {
  const response = await fetch(
    `https://api.jkt48connect.app/api/instagram/updates?after=${cursor}&limit=25`,
    { headers: { 'X-API-Key': 'YOUR_JKT48CONNECT_API_KEY' } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  for (const item of data.updates) {
    console.log(item.cursor, item.post.member.name, item.post.text, item.post.url);
    // Deduplikasi menggunakan cursor; selesaikan pemrosesan sebelum menyimpannya.
  }
  cursor = data.next_cursor;
  localStorage.setItem('instagram_cursor', cursor);
  return data.has_more;
}
```

Event memiliki `type: "new_instagram_post"`, `cursor`, `detected_at`, dan `post`. Simpan cursor sesudah semua item berhasil diproses. Lanjutkan halaman ketika `has_more=true`, lalu beri jeda misalnya 30 detik. Jika ingin mulai mengikuti dari sekarang, gunakan `latest_cursor` dari respons awal.

Pembacaan profil pertama menjadi baseline, sehingga posting lama tidak dikirim sebagai event baru. Pin lama, perubahan urutan, pembacaan ulang dan restart tidak menghasilkan event duplikat. Perubahan like/caption pada posting yang sama memperbarui arsip tanpa dianggap posting baru.

## Cakupan dan batasan sumber anonim

Collector memakai satu request sumber pada satu waktu, dengan jeda acak **20–35 detik**. Akun dijadwalkan kembali paling cepat sekitar 15–20 menit setelah berhasil; putaran aktual dapat lebih lama karena jumlah akun, pengambilan detail, dan pembatasan Instagram. API yang cepat dibaca bukan jaminan deteksi seketika sejak unggahan dibuat.

Halaman publik hanya memberikan jendela posting terbatas, sehingga `history_complete` tetap false. Metadata dan event yang telah tertangkap disimpan permanen, tetapi riwayat lama tidak diambil otomatis. Post dari pemilik lain yang muncul di timeline, termasuk kolaborasi yang kepemilikannya belum dapat dipastikan, tidak diakui sebagai posting asli member.

Akun privat, DM, dan Stories yang membutuhkan login tidak diambil. Halaman login, pembatasan HTTP, atau data posting yang tidak ditampilkan dicatat sebagai kendala. Tidak ada login otomatis atau pemecah challenge. Data terakhir tetap dapat dibaca saat sumber bermasalah. Periksa `last_success_at`, `last_error`, `next_check_at`, serta `coverage_gap_possible` per member; `collector_online` hanya menandakan proses masih hidup.

Fitur ini menyediakan data API; tidak otomatis mengirim pesan ke Discord atau X.
