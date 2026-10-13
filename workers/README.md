# JKT48 Showroom API for Cloudflare Workers

Port dari `Valzyys/jkt48showroom-api` commit `d832eb5cee3323ed37ab34b90d892f833e071870`, aplikasi asal versi `0.14.2`, author `crstlnz`. Proyek Workers berada di folder `workers/`; sumber Bun di root repository tetap tersedia sebagai referensi. Semua deployment dilakukan dari folder ini.

## Arsitektur

- Hono mempertahankan route dan handler API asal. Runtime menggunakan module Worker, bukan `Bun.serve`.
- D1 menyimpan dokumen JSON dalam empat namespace database lama: `dcDB`, `jkt48DB`, `liveDB`, `userDB`. ID dan struktur dokumen dipertahankan. Adapter menerapkan subset query/schema/populate yang digunakan aplikasi ini; adapter bukan pengganti Mongoose umum.
- Query scalar yang aman, pagination dan count diteruskan ke SQL. Query array/regex serta aggregation dievaluasi oleh Mingo setelah filtering SQL. Batas dataset default 10.000 dokumen per operasi; kelebihan menghasilkan 503, bukan hasil terpotong. Perlu pengukuran dan optimasi SQL tambahan untuk dataset riwayat besar sebelum deployment produksi.
- Durable Object `LiveHub` menyimpan daftar live, mengelola WebSocket CBOR dan broadcast, serta memulihkan state setelah restart. Webhook memperbarui state langsung; cron/alarm memperbarui setiap lima menit.
- Durable Object `Coordinator` menserialisasi operasi beta dan menyimpan rate counter serta nonce secara konsisten lintas instance.
- Cache respons API bersama disimpan di D1. Respons pengguna, admin, Showroom session, dan request mutasi memakai `no-store`. Cache lokal di handler lama hanya untuk data publik/optimasi; state live dan izin beta tidak bergantung pada cache lokal.
- Upload gambar ditransformasi melalui Cloudinary HTTP menjadi WebP, lalu disimpan ke binding R2 native. Tidak ada `sharp` atau kredensial S3 R2 pada runtime.

## Persiapan

```sh
cd workers
npm install
npx wrangler login
npm run deploy
```

Atur `ORIGINS`, `SECONDARY_ORIGINS`, `DEFAULT_ORIGIN`, dan `ADMIN_IDS` di `wrangler.jsonc` untuk frontend serta user Showroom admin yang sebenarnya sebelum deployment. Tidak perlu menjalankan perintah create D1/R2 atau mengisi ID placeholder. Akun harus memiliki Workers, D1, dan R2 aktif serta izin membuat resource tersebut.

Untuk pengembangan lokal, `.dev.vars.example` menjelaskan nama variable. `.dev.vars` yang berisi nilai sebenarnya tidak boleh masuk Git. `SECRET` juga digunakan AES pada fungsi lama, sehingga gunakan tepat 32 byte ASCII; `AUTH_SECRET`, `JWT_SECRET`, dan `API_KEY` harus berupa secret acak yang berbeda.

```sh
npm run db:migrate
npm run dev
```

Wrangler menampilkan URL pengembangan. `/health` memeriksa tabel D1; HTTP 503 berarti database belum siap. Respons kosong pada endpoint berbasis data tidak berarti data MongoDB sudah diimpor.

## Deployment

```sh
npm run deploy
```

Perintah ini menjalankan Wrangler 4.149.0 dengan konfigurasi `wrangler.jsonc`:

1. Build hook `node scripts/prepare-env.js` menyiapkan environment lokal. Empat secret wajib dideklarasikan pada `secrets.required`: `SECRET` (32 karakter ASCII), `AUTH_SECRET`, `JWT_SECRET`, dan `API_KEY` (masing-masing 64 karakter hex acak). Nilainya independen, tidak ditampilkan di log, dan disimpan di `.setup/secrets.json` dengan izin file `0600`. Folder `.setup/` dan `.dev.vars` diabaikan Git.
2. Script deploy memeriksa nama secret remote. Secret yang sudah ada dipertahankan; hanya yang belum ada dikirim lewat `--secrets-file`. Deployment pertama memasang keempat secret. Kegagalan autentikasi menghentikan proses, bukan dianggap Worker baru.
3. Wrangler memakai database D1 untuk `DB` dan bucket R2 untuk `IMAGES_BUCKET` dari konfigurasi. Branch `main` kini menyimpan ID D1 dan nama R2 yang sudah dibuat pada deployment akun pemilik repository, agar checkout CI berikutnya menggunakan resource yang sama. Durable Objects `LIVE_HUB` dan `COORDINATOR` dibuat melalui migration Wrangler `v1`.
4. Setelah deployment berhasil, script menjalankan migration D1 remote secara noninteraktif. Deployment dianggap selesai hanya jika migration juga berhasil. `/health` dapat sementara mengembalikan 503 sebelum migration selesai. Jika migration gagal, perbaiki penyebabnya lalu jalankan kembali perintah deploy.

Simpan ID/nama resource yang ditulis Wrangler pada `wrangler.jsonc` untuk deployment berikutnya. Jangan menghapus ID resource yang sudah dipakai. Detail fitur native: [Automatic resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-resource-provisioning).

Nama Worker di konfigurasi dan proyek Cloudflare harus sama: `jkt48showroom-api`. Override nama oleh Workers Builds berlaku pada deploy, tetapi command D1 dapat tetap memakai nama dari konfigurasi. Untuk clone di akun lain, ubah nama Worker sesuai proyek baru, hapus `database_id`, `database_name`, dan `bucket_name` milik akun ini, kemudian jalankan deploy agar Wrangler membuat resource baru. Jangan lakukan penghapusan tersebut pada deployment akun yang sudah berjalan.

Login OAuth dilakukan sekali dengan `npx wrangler login`. Untuk CI, sediakan `CLOUDFLARE_API_TOKEN` dan `CLOUDFLARE_ACCOUNT_ID` dari akun sendiri; token memerlukan Workers Scripts Edit, D1 Edit, dan Workers R2 Storage Write serta akses ke akun tujuan. Kredensial akun tidak dapat dihasilkan oleh proyek.

`npm run setup:env` hanya membuat secret lokal tanpa mengakses Cloudflare. `.dev.vars` yang sudah ada tidak ditimpa. Pada checkout baru dengan Worker yang sudah memiliki secret, nilai lokal yang dibuat bukan salinan secret remote. Untuk memasang ulang semua empat secret secara sengaja, gunakan `npm run deploy -- --rotate-secrets`; ini dapat membatalkan JWT, signature, dan API key lama. Perbarui `.dev.vars` sendiri jika ingin memakai nilai hasil rotasi untuk pengembangan lokal.

Jika memanggil Wrangler langsung, build hook hanya menyiapkan file lokal; gunakan `npm run setup:env` lalu `npx wrangler deploy --secrets-file .setup/secrets.json` untuk memasang secret. Jalur langsung ini tidak memeriksa secret lama dan tidak menjalankan migration D1 otomatis. `npm run deploy` adalah jalur yang disarankan untuk keseluruhan proses.

Tambahkan `SAWERIA_KEY`, `YOUTUBE_KEY`, `YOUTUBE_JKT48`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SIGNATURE_SECRETS`, dan `SR_ID` sebagai secret jika fitur terkait digunakan. `CLOUDINARY_CLOUD_NAME`, `IMAGE_PUBLIC_URL`, `JKT48V_YT_IDS` dan konfigurasi scraping bisa diisi sebagai vars. R2 harus punya domain publik dengan path objek sesuai `IMAGE_PUBLIC_URL`.

Secret layanan pihak ketiga harus berasal dari penyedianya, misalnya `npx wrangler secret put CLOUDINARY_API_SECRET`; script tidak mengarang kredensial Cloudinary, YouTube, atau Saweria dan tidak mengganti secret tambahan tersebut. Domain publik R2 dan data MongoDB juga tidak dibuat/import otomatis.

Cloudflare account/token, kredensial upstream dan data produksi tidak disertakan. ID D1 dan nama R2 dalam konfigurasi adalah identifier resource, bukan secret; akses tetap memerlukan autentikasi Cloudflare. Workflow GitHub hanya memeriksa kode; tidak melakukan deployment atau memindahkan data produksi.

## Proxy

`SHOWROOM_API` adalah base URL HTTPS upstream Showroom, default `https://www.showroom-live.com`. `PROXY_URL` adalah prefix relay opsional; format kompatibel repo asal: `https://relay.example/` menghasilkan request ke `https://relay.example/https://www.showroom-live.com/...`. Relay juga boleh menggunakan prefix query seperti `https://relay.example/?url=` jika mendukung target URL mentah tersebut. Prefix dan base harus HTTPS. Proxy berlaku pada seluruh request Showroom, termasuk login, CSRF, profil, komentar dan follow; request layanan lain tidak ikut diproxy.

`GET /api/stream?url=<encoded-https-url>` memproxy playlist HLS, varian, segmen, encryption key, dan init-map. Referensi relatif di playlist ditulis ulang menuju Worker. `Range`, `If-Range`, ETag, `Content-Range`, HEAD, status kegagalan upstream, serta body segmen diteruskan. Cookie client tidak diteruskan ke CDN.

Host awal dan redirect divalidasi sebagai hostname, bukan substring. Host default: `playback.live-video.net`, `live.showroom-live.com`, beserta subdomainnya. Tambahkan domain CDN yang benar-benar digunakan melalui `STREAM_ALLOWED_HOSTS`, dipisahkan koma. URL media dengan host baru akan ditolak sampai diizinkan. Proxy bukan layanan open proxy untuk URL arbitrary. Timeout default 15 detik, maksimal empat redirect. URL streaming premium tetap mengikuti pembatasan handler asal.

## Sinkronisasi JKT48

Worker mengisi koleksi berita, jadwal/theater, event, setlist dasar, member dan profil ulang tahun dari API JSON publik `https://jkt48.com/api/v1/`. Scraper HTML situs lama tidak lagi menjadi sumber news/jadwal aktif. GET pertama pada endpoint terkait menunggu sinkronisasi; cron lima menit memeriksa freshness dan memperbarui dataset yang kedaluwarsa. Coordinator terpisah per dataset menserialisasi sinkronisasi lintas instance. Penulisan D1 memakai batch JSON maksimal 100 record per statement, mempertahankan ID dokumen impor dan field yang tidak diperbarui. Data existing tidak dihapus dan room mapping member yang sudah ada dipertahankan.

Konfigurasi pada Wrangler:

| Variable | Default | Batas |
| --- | --- | --- |
| `JKT48_AUTO_SYNC` | `true` | `false` menonaktifkan sinkronisasi |
| `JKT48_API_BASE` | `https://jkt48.com/api/v1/` | HTTPS, termasuk trailing slash |
| `JKT48_SYNC_SECONDS` | `3600` | 300-86400 detik |
| `JKT48_NEWS_PAGES` | `3` | 1-10 halaman berita terbaru per sinkronisasi |
| `JKT48_SCHEDULE_MONTHS` | `3` | 1-6 bulan mulai bulan lalu |
| `JKT48_DETAIL_LIMIT` | `20` | 1-30 detail per dataset per sinkronisasi |

Detail theater/event/exclusive dan member diperkaya bertahap dengan cursor yang berputar; detail berita dimuat ketika `/api/news/:id` diminta. Waktu show dikonversi dari WIB ke UTC secara eksplisit. Archive berita lama, histori theater sebelum rentang sinkronisasi, metadata lagu/setlist kurasi, data grup selain JKT48 dan live/gift history tetap memerlukan import atau collector terkait. Tidak ada data atau kredensial pihak ketiga yang dibuat-buat.

`POST /api/admin/jkt48_sync` dengan JWT admin yang valid memaksa refresh ketiga dataset dan mengembalikan hasil per dataset, termasuk error. Endpoint ini tetap melewati validasi admin/CSRF. Kegagalan upstream tidak menghapus data lama; tanpa data yang dapat dipakai endpoint mengembalikan 503, bukan success kosong. Percobaan gagal ditunda lima menit. Cache API yang terkait dihapus setelah sync berhasil.

Jika situs upstream menolak akses Cloudflare (403/429/challenge), gunakan sumber HTTPS yang Anda kelola melalui `JKT48_API_BASE` atau relay prefix `JKT48_SCRAPE_URL`. Cookie/User-Agent yang sah dapat disimpan pada konfigurasi `cookies_jkt48`/`useragent_jkt48` yang sudah didukung. Relay `SSK_SCRAPE_URL` memakai pool terpisah; tanpa relay scraper kembali ke host resmi, bukan URL `undefined`. Route Sousenkyo 2024 tetap tidak aktif mengikuti sumber. Sync tidak menjamin upstream menerima IP Cloudflare. Dataset besar dapat memerlukan paket Workers/D1 dengan limit query lebih tinggi; periksa hasil sync dan limit akun sebelum produksi.

## Import MongoDB

Ekspor masing-masing collection sebagai JSON array atau JSON Lines melalui `mongoexport`. Kredensial hanya digunakan pada mesin export, tidak diperlukan oleh Worker. Konversi satu collection:

```sh
node scripts/import-mongo.js --input livelogs.json --database liveDB --collection livelogs --output exports/livelogs
npx wrangler d1 execute DB --local --file exports/livelogs/00000.sql
```

Importer mempertahankan ObjectId sebagai string hex, tanggal sebagai ISO, nested arrays dan namespace. Nama collection harus identik dengan MongoDB lama; lihat `src/database/` untuk model dan nama collection eksplisit. Import seluruh collection yang dibutuhkan, termasuk `showrooms`, `idolmembers`, gifts, stage lists, `livelogs`, user logs, berita/jadwal, konfigurasi, dan likes.

Default importer menolak duplicate key. `--upsert` secara eksplisit menghasilkan overwrite untuk ID yang sama. Tinjau output, lakukan import lokal dan periksa jumlah/relasi sebelum menggunakan `--remote`. Dokumen di atas 1,8 MB dan Extended JSON Decimal/binary yang belum dikonversi ditolak dengan pesan jelas. Tidak ada migrasi data otomatis ketika Worker dijalankan.

## Pengujian

```sh
npm test
npm run build
npm run test:integration
```

Tes unit mencakup proxy HLS/Range/redirect/timeout, SQL migration/filter, adapter D1, konflik penulisan, aggregation/populate, dan importer. Tes Miniflare menjalankan Worker dengan D1, Durable Objects, fixture data, dan upstream mock untuk login/refresh/logout, session proxy, likes, beta concurrent enrollment, update live, dan protokol WebSocket CBOR.

Mock membuktikan integrasi kode dan penerusan request, bukan menjamin upstream produksi menerima request Cloudflare. Login captcha, API IDN, YouTube quota, Saweria nyata dan CDN produksi perlu smoke test dengan konfigurasi account yang sebenarnya.

Lihat [API.md](API.md) untuk endpoint, autentikasi dan contoh; [COMPATIBILITY.md](COMPATIBILITY.md) untuk perubahan serta status fitur.
