# Tweet dan update X member

Fitur ini mengarsipkan tweet publik member JKT48 dari halaman publik X. **Tidak memakai akun X, cookie login, atau API key X.** API key JKT48Connect tetap digunakan seperti route API lainnya.

## Endpoint

| Route | Fungsi |
| --- | --- |
| `GET /api/x/status` | Status kolektor anonim, jumlah member, jumlah tweet, jeda dan kendala sumber |
| `GET /api/x/members` | Member dan username X yang terdaftar, waktu pengecekan, kendala per member |
| `GET /api/x/tweets` | Tweet yang tersimpan, terbaru dahulu |
| `GET /api/x/members/:member/tweets` | Tweet untuk satu slug, username, atau nama panggilan yang tidak ambigu |
| `GET /api/x/tweets/:id` | Detail tweet yang sudah terarsip |
| `GET /api/x/search?q=...` | Cari teks di arsip yang telah terkumpul |
| `GET /api/x/updates?after=0` | Feed informasi tweet baru menggunakan cursor |

Parameter daftar tweet: `member` opsional, `limit` 1–100 (default 25), `before` ID tweet dari `next_cursor`, dan `include_replies=true/false`. Parameter search sama, ditambah `q` maksimal 200 karakter. Feed update menerima `after`, `limit`, dan `member`. Setiap request API hanya membaca arsip; tidak memicu scraping X baru.

```bash
curl 'https://api.jkt48connect.app/api/x/tweets?member=Gracie_JKT48&limit=10' \
  -H 'X-API-Key: YOUR_JKT48CONNECT_API_KEY'
```

Tweet memuat `id`, `url`, `text`, `created_at`, `author`, `member`, `metrics`, `media`, `urls`, `hashtags`, flag reply/quote/repost, sumber, `first_seen_at`, serta `last_observed_at`. Metrik yang tidak diberikan X bernilai null. Gambar dan varian video hanya disertakan jika tersedia pada respons publik.

## Mendapatkan informasi tweet baru

```js
let cursor = '0'; // Simpan secara persisten setelah pemrosesan berhasil.
async function checkNewTweets() {
  const response = await fetch(
    `https://api.jkt48connect.app/api/x/updates?after=${cursor}&limit=25`,
    { headers: { 'X-API-Key': 'YOUR_JKT48CONNECT_API_KEY' } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
  for (const item of data.updates) {
    console.log(item.tweet.member.name, item.tweet.text, item.tweet.url);
    // Kirim notifikasi aplikasimu; deduplikasi menggunakan item.cursor.
  }
  cursor = data.next_cursor;
  return data.has_more;
}
```

Panggil lagi segera jika `has_more=true`, kemudian beri jeda misalnya 30 detik. Cursor adalah string. Simpan cursor hanya setelah notifikasi berhasil diproses; penanganan minimal sekali ini bisa menghasilkan item berulang jika aplikasi berhenti sebelum menyimpan cursor. Gunakan cursor sebagai kunci deduplikasi. `retention_gap=true` menandakan cursor terlalu lama untuk feed yang masih disimpan. Jika baru berlangganan dan ingin mulai dari sekarang, ambil `latest_cursor` pada respons awal sebagai posisi awal.

Saat profil member pertama kali dibaca, tweet yang sudah ada disimpan sebagai baseline dan **tidak** dianggap tweet baru. Feed berikutnya memiliki `type: "new_tweet"`, `detected_at`, `cursor`, dan objek `tweet`. Ini hanya menyediakan data untuk aplikasi; tidak otomatis membuat posting X atau mengirim WhatsApp.

## Ketepatan waktu dan cakupan

Halaman publik X memberikan jendela terbatas, sering beberapa tweet terbaru dan pinned post. Fitur ini **bukan riwayat lengkap semua tweet sejak akun dibuat**. `initial_history_complete` bernilai false. Pin lama tidak dianggap tweet baru. Tweet dari akun lain yang dikutip atau direpost tidak ditandai sebagai tweet asli member.

Pengecekan dijadwalkan sekitar lima menit per profil, dengan jeda lima detik antar permintaan. Putaran bisa lebih lama apabila jumlah profil, waktu respons, atau pembatasan X meningkat. Periksa `last_success_at`, `next_check_at`, `last_error`, dan `coverage_gap_possible` setiap member. Jika banyak tweet terbit di antara dua pengecekan dan sudah keluar dari jendela publik, sebagian data dapat tidak tertangkap. Tidak ada jaminan notifikasi seketika atau cakupan 100% tanpa sumber yang memberikannya.

Status `collector_online` berarti proses masih mengirim heartbeat, bukan jaminan semua profil sedang dapat dibaca. Halaman login/kosong, 403 dan 429 ditampilkan sebagai kendala, bukan keberhasilan dengan daftar kosong. Saat rate limit, scraper berhenti sementara; data terakhir tetap dapat dibaca. `last_observed_at` menunjukkan kapan angka statistik terakhir terlihat. Post yang hilang dari jendela publik tidak otomatis ditandai dihapus.

Arsip menyimpan maksimal 1.000 tweet per member dan 50.000 event update. Akun protected dan pesan privat tidak diambil. Bot pengirim notifikasi X yang sudah berjalan menggunakan service terpisah; kolektor publik ini tidak memakai kredensial akun bot tersebut.
