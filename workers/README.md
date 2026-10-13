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
npx wrangler d1 create jkt48showroom
npx wrangler r2 bucket create jkt48showroom-images
```

Isi `database_id` hasil pembuatan D1 pada `wrangler.jsonc`. Nama bucket R2 harus sesuai binding `IMAGES_BUCKET`. Atur `ORIGINS`, `SECONDARY_ORIGINS`, `DEFAULT_ORIGIN`, dan `ADMIN_IDS` untuk frontend serta user Showroom admin yang sebenarnya.

Untuk pengembangan lokal, `.dev.vars.example` menjelaskan nama variable. `.dev.vars` yang berisi nilai sebenarnya tidak boleh masuk Git. `SECRET` juga digunakan AES pada fungsi lama, sehingga gunakan tepat 32 byte ASCII; `AUTH_SECRET`, `JWT_SECRET`, dan `API_KEY` harus berupa secret acak yang berbeda.

```sh
npm run db:migrate
npm run dev
```

Wrangler menampilkan URL pengembangan. `/health` memeriksa tabel D1; HTTP 503 berarti database belum siap. Respons kosong pada endpoint berbasis data tidak berarti data MongoDB sudah diimpor.

## Deployment

```sh
npx wrangler secret put SECRET
npx wrangler secret put AUTH_SECRET
npx wrangler secret put JWT_SECRET
npx wrangler secret put API_KEY
npm run db:migrate:remote
npm run build
npm run deploy
```

Tambahkan `SAWERIA_KEY`, `YOUTUBE_KEY`, `YOUTUBE_JKT48`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `SIGNATURE_SECRETS`, dan `SR_ID` sebagai secret jika fitur terkait digunakan. `CLOUDINARY_CLOUD_NAME`, `IMAGE_PUBLIC_URL`, `JKT48V_YT_IDS` dan konfigurasi scraping bisa diisi sebagai vars. R2 harus punya domain publik dengan path objek sesuai `IMAGE_PUBLIC_URL`.

Cloudflare account/token, ID database, kredensial upstream dan data produksi tidak disertakan. Workflow GitHub hanya memeriksa kode; tidak melakukan deployment atau memindahkan data produksi.

## Proxy

`SHOWROOM_API` adalah base URL HTTPS upstream Showroom, default `https://www.showroom-live.com`. `PROXY_URL` adalah prefix relay opsional; format kompatibel repo asal: `https://relay.example/` menghasilkan request ke `https://relay.example/https://www.showroom-live.com/...`. Relay juga boleh menggunakan prefix query seperti `https://relay.example/?url=` jika mendukung target URL mentah tersebut. Prefix dan base harus HTTPS. Proxy berlaku pada seluruh request Showroom, termasuk login, CSRF, profil, komentar dan follow; request layanan lain tidak ikut diproxy.

`GET /api/stream?url=<encoded-https-url>` memproxy playlist HLS, varian, segmen, encryption key, dan init-map. Referensi relatif di playlist ditulis ulang menuju Worker. `Range`, `If-Range`, ETag, `Content-Range`, HEAD, status kegagalan upstream, serta body segmen diteruskan. Cookie client tidak diteruskan ke CDN.

Host awal dan redirect divalidasi sebagai hostname, bukan substring. Host default: `playback.live-video.net`, `live.showroom-live.com`, beserta subdomainnya. Tambahkan domain CDN yang benar-benar digunakan melalui `STREAM_ALLOWED_HOSTS`, dipisahkan koma. URL media dengan host baru akan ditolak sampai diizinkan. Proxy bukan layanan open proxy untuk URL arbitrary. Timeout default 15 detik, maksimal empat redirect. URL streaming premium tetap mengikuti pembatasan handler asal.

## Migrasi MongoDB

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
