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
| `JKT48_PROXY_URL` | kosong | Relay HTTPS khusus request API JKT48 |
| `JKT48_SCRAPER_URL` | kosong | Layanan Python VPS privat, contohnya `https://scrape.jkt48connect.com/api/v1/` |
| `JKT48_SYNC_SECONDS` | `3600` | 300-86400 detik |
| `JKT48_NEWS_PAGES` | `3` | 1-10 halaman berita terbaru per sinkronisasi |
| `JKT48_SCHEDULE_MONTHS` | `3` | 1-6 bulan mulai bulan lalu |
| `JKT48_DETAIL_LIMIT` | `20` | 1-30 detail per dataset per sinkronisasi |

Detail theater/event/exclusive dan member diperkaya bertahap dengan cursor yang berputar; detail berita dimuat ketika `/api/news/:id` diminta. Waktu show dikonversi dari WIB ke UTC secara eksplisit. Archive berita lama, histori theater sebelum rentang sinkronisasi, metadata lagu/setlist kurasi, data grup selain JKT48 dan live/gift history tetap memerlukan import atau collector terkait. Tidak ada data atau kredensial pihak ketiga yang dibuat-buat.

`POST /api/admin/jkt48_sync` dengan JWT admin yang valid memaksa refresh ketiga dataset dan mengembalikan hasil per dataset, termasuk error. Endpoint ini tetap melewati validasi admin/CSRF. Kegagalan upstream tidak menghapus data lama; tanpa data yang dapat dipakai endpoint mengembalikan 503, bukan success kosong. Percobaan gagal ditunda lima menit. Cache API yang terkait dihapus setelah sync berhasil.

HTTP 403 upstream berarti request ditolak oleh sumber; deployment dan binding yang benar tidak menjamin akses. Jika relay yang Anda kelola bisa mengakses API resmi, isi `JKT48_PROXY_URL`: `https://relay.example/` mengirim target sebagai suffix URL mentah; `https://relay.example/?url={url}` mengirim target lengkap sebagai parameter URL-encoded, termasuk query `lang`/`page`. Relay digunakan untuk news, schedules, theater/event/exclusive dan members. Variable `PROXY_URL` tetap khusus Showroom. Jangan isi relay publik acak atau menaruh token relay di Git; gunakan secret Wrangler jika URL mengandung kredensial query.

Layanan Python VPS tersedia di [vps-scraper](../vps-scraper/README.md), dengan konfigurasi domain `scrape.jkt48connect.com`, systemd, Caddy HTTPS dan `curl_cffi`. Aktifkan `JKT48_SCRAPER_URL` hanya setelah VPS/DNS siap dan pasang secret `JKT48_SCRAPER_TOKEN` yang cocok dengan token service. Mode ini mengirim autentikasi hanya ke VPS dan tidak memindahkan data/secret pengguna ke sana. Tidak perlu menulis ulang seluruh API menjadi Python.

Saat dataset kosong dan sync gagal, respons menyertakan `code`, `upstream_status` jika diketahui, serta `Retry-After`; respons error memakai `no-store`. Contoh `JKT48_UPSTREAM_HTTP_ERROR` dengan `upstream_status: 403` memerlukan jalur upstream yang diizinkan, sedangkan `JKT48_SYNC_STORAGE_ERROR` memerlukan pemeriksaan migration/binding/limit D1. Log `jkt48-sync-failed` mencatat phase dan kode tanpa body respons, token, cookie, atau URL relay. Setelah konfigurasi diperbaiki, tunggu maksimal lima menit atau pakai POST admin untuk retry langsung.

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

## Dokumentasi publik

UI dokumentasi API tersedia pada `/docs` di domain Worker, contohnya
[api.jkt48connect.app/docs](https://api.jkt48connect.app/docs).
Katalog 53 kombinasi method/route berisi API untuk pengguna. Perubahan route
publik memperbarui `docs/routes.json` serta panduan di `docs/public/`.
`docs/response-samples.json` menyimpan snapshot output publik dengan tanggal
pengambilan. Panduan operasional dan endpoint internal tidak dipublikasikan.

Halaman memuat pencarian, filter method, contoh cURL/JavaScript/Python, parameter path
serta query, contoh respons, panduan autentikasi, dan unduhan Markdown/JSON.
Tombol uji hanya menjalankan GET publik pada origin yang sama. UI tidak menyimpan
atau meminta secret pengguna. Source aset berada di `docs/`; build hook
`node scripts/build-docs.js` menghasilkan bundle yang diabaikan Git.

```sh
node scripts/build-docs.js
node --test test/docs.test.js
npm run build
```

## Control admin dan gambar JKT48

Panel `/control/admin` memakai login admin khusus dan cookie sesi delapan jam,
HttpOnly/Secure/SameSite=Strict. Kredensial login disimpan sebagai secret Worker
`CONTROL_ADMIN_EMAIL`, `CONTROL_ADMIN_PASSWORD_HASH` (PBKDF2-SHA256), dan
`CONTROL_SESSION_SECRET`. Password plaintext tidak disimpan dalam repository.

Panel mengelola variable dan secret API, akses CORS, scraper, interval sinkronisasi,
Cloudinary/YouTube/Saweria, runtime, cache dan penyimpanan media. Secret tidak
termasuk dalam daftar konfigurasi; API key aktif hanya dibaca atas tindakan admin.
Override disimpan pada tabel `control_settings`; secret memakai AES-GCM dengan
kunci dari secret sesi control. Override berlaku pada Worker, Coordinator dan
LiveHub; cache konfigurasi maksimal sepuluh detik. Nilai deployment tetap menjadi
fallback ketika override dihapus. Perubahan pada key/auth secret membatalkan
integrasi/token lama yang memakai nilai sebelumnya.

URL storage gambar JKT48 dan path `media/...` dinormalisasi pada respons JSON
menjadi `/media/jkt48/...` pada origin API. Cache miss mengambil raster melalui
endpoint scraper privat `/images/{path}`, menolak redirect dan HTML, membatasi
ukuran delapan MB, lalu menyimpan ke R2 dengan prefix `jkt48-origin/`. Respons
gambar selalu dibaca dari R2, mendukung HEAD/ETag, dan dapat dipakai lintas origin.
Tombol pemanasan media mengunduh maksimal dua puluh gambar member per batch.


### Automatic live archive and R2 recording

The separate VPS service `jkt48-live-collector` discovers JKT48 Showroom/IDN lives,
observes gifts, captures JPEG frames and pipes fragmented MP4 through memory into
Worker-managed R2 multipart uploads. No video files are written on VPS disk.
Completed sessions populate `/api/recent`; details expose capture completeness,
point units, screenshots and replay URLs. Private ingestion uses a dedicated
collector token. Configure recording/intervals and inspect sessions/replays in
`/control/admin`. See [collector runtime documentation](../live-collector/README.md).

### Public developer portal

The API origin serves the React developer landing page for HTML requests and `/docs`
for documentation. The JSON API at `/` remains available for API clients; use
`?format=json` explicitly if needed. GSAP handles navigation, scroll reveals and
scrambled labels. The 3D figures are drawn by a small ASCII engine
(`docs/ui/ascii.js`): signed-distance shapes, flat Lambert light, no shadows or
reflections, rendered to canvas only while visible. One motion toggle controls CSS,
GSAP and the ASCII scenes, and follows `prefers-reduced-motion` until changed.

#### Developer accounts, API keys and billing

Every `/api` data route is metered per developer key. People sign up at `/register`,
create keys at `/dashboard/keys` (`jkc_…`, shown once, stored as a SHA-256 hash) and send
them in the `X-API-Key` header (or `api_key` query). One D1 upsert counts and enforces the
monthly quota (WIB months) and returns `X-RateLimit-*` headers; over quota answers `429`
with `Retry-After`. The app's own session routes (`/api/stream`, `/api/auth`, `/api/user`,
`/api/showroom`, `/api/admin`, `/api/beta`, `/api/profile`), the server `API_KEY`, valid app
JWTs, signed first-party requests and `API_KEY_EXEMPT_ORIGINS` are not metered. A developer
key also unlocks routes that used to need the server key.

The dashboard (`/dashboard`) has an overview, keys, analytics (daily volume, errors,
latency, status codes, busiest hours, endpoints), a 7-day request log, billing and account
settings (profile, password, sessions, delete). Plans: Free 1.000/month, Fanbase 50.000
(free after review), Starter 25.000 and Pro 150.000 per 30 days. Top-ups add requests to the
current month. Payments run through MYPG (yobasepay.net): the dashboard creates a bill and
the checkout page `/pay/<id>` polls `checkstatus` through the Worker until it is paid, then
applies the purchase exactly once and only for the full amount.

Fan communities apply for the Fanbase plan at `/dashboard/fanbase` with a detailed form,
a required follow of the project's X account (`FANBASE_X_HANDLE`, default `JKT48Connect`)
and their choice about being listed. Admins review applications, mint top-up vouchers,
change plans and credit keys under **Developer API** in `/control/admin`. Approved fanbases
that agreed to it appear on the landing page.

```bash
npx wrangler d1 migrations apply DB --remote   # adds the account tables (0008)
npx wrangler secret put MYPG_API_KEY           # MYPG project key, never committed
```

Vars (also editable in the control panel): `API_KEY_REQUIRED` (`true` in `wrangler.jsonc`),
`API_FREE_MONTHLY_LIMIT`, `API_FANBASE_MONTHLY_LIMIT`, `API_MAX_KEYS`,
`API_KEY_EXEMPT_ORIGINS` (your own frontends; an `Origin` header is easy to forge, so prefer
signed requests), `API_PRICES` (JSON, rupiah) and `FANBASE_X_HANDLE`.

#### Pip, the docs assistant

`POST /docs/assistant` streams answers from Mistral for the floating **Pip** chat on
every docs page. Before each answer Pip reads the docs: `src/docs/knowledge.js` splits
the public guides per section and turns every endpoint into a card (parameters, response
shape, trimmed production sample), then ranks them against the question and the page the
reader has open. The sections it read stream to the chat first as sources. Pip writes
integration code and can open endpoints/guides or spotlight UI elements marked with
`data-pip` (actions are validated in `docs/ui/assistant-actions.js`; only known pages,
endpoints and targets run).

Configure one of these as Worker secrets (never commit them):

```bash
npx wrangler secret put MISTRAL_COOKIE    # console.mistral.ai session cookie
npx wrangler secret put MISTRAL_API_KEY   # optional, official API; preferred when set
```

Optional vars: `MISTRAL_MODEL` (default `mistral-medium-latest`), `ASSISTANT_ENABLED`
(`false` disables the endpoint), `ASSISTANT_TIMEOUT_MS`. The endpoint accepts same-origin
JSON only and applies a per-isolate limit of 20 questions per 10 minutes per IP; add a
Cloudflare rate limiting rule on `/docs/assistant` for a global limit. A console session
cookie expires and is tied to your Mistral account; the official API key is the stable
option.

Edit public guides in `docs/public/` and their order in `docs/public/navigation.json`.
`docs/pages/markdown.md` is the Markdown feature lab. `docs/routes.json` and
`docs/response-samples.json` contain consumer API documentation only.
`scripts/public-docs.js` enforces publication boundaries for the UI, search index,
JSON downloads, and combined Markdown. Do not add operational endpoints or
maintenance instructions to these public documents.

`npm run build` and `npm run deploy` generate `public-docs/` automatically. Worker
Static Assets serves the frontend through the `DOCS_ASSETS` binding; existing API,
media, and protected application routes continue through the Worker handler.
