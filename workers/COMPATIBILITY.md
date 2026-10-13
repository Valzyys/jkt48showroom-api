# Kompatibilitas

Baseline: `Valzyys/jkt48showroom-api@d832eb5cee3323ed37ab34b90d892f833e071870`.

## Dipertahankan

Semua route aktif dari `src/routes/index.ts`, `admin.ts`, `auth.ts`, `user.ts`, `showroom.ts`, `sitemap.ts`, serta webhook Saweria dipetakan pada versi Workers. Handler response, model dokumen, sorting dan parameter menggunakan sumber asal sebagai dasar. File JavaScript ditransformasikan dari TypeScript asal, kemudian bagian runtime dan integrasi disesuaikan.

WebSocket tetap menggunakan CBOR yang berisi string. `PING`, `listen <group>`, `view <path>`, `admin <jwt>`, JSON string broadcast `{type,data}`, dan `ok-listen` dipertahankan. Grup aktif: `jkt48` dan `hinatazaka46`.

Session client tetap memakai `Authorization: Bearer <access_token>`, `X-Refresh-Token`, dan `X-SR-Token`. Respons login tetap mengandung `access_token`, `refresh_token`, `user`; header pembaruan token tetap tersedia.

## Perbaikan Perilaku

Dependensi runtime Hono, defu dan lodash memakai versi patch/minor yang telah diperbaiki untuk advisory pada versi sumber. CI memeriksa audit dependensi produksi dan kontrak API setelah update tersebut.

- Competition endpoint dengan `checkApiKey` sekarang menolak key invalid (401). Kode asal hanya menunda 15 detik lalu meneruskan request. JWT API key dan server `API_KEY` diterima.
- Rate limit menghasilkan 429 dan `Retry-After`, bukan 409. Counter dan nonce lintas Worker dikoordinasi Durable Object.
- JWT tidak memakai fallback `supersecret`; validasi dibatasi HS256. Respons 401 tidak memuat token client. Session yang belum diverifikasi tidak dipakai untuk request Showroom.
- Likes selalu menggunakan identitas user terautentikasi; parameter `user_id` tidak dapat menggantinya. Kegagalan database tidak dilaporkan sebagai success.
- Default daftar member menjadi `jkt48`, termasuk room official; kode asal membentuk filter grup kosong jika query tidak diisi. Jumlah `/recent` dihitung dari `LiveLog`, sesuai data yang ditampilkan.
- Proxy Showroom personal menggunakan `no-store`. Query, token session, dan cookie diteruskan tanpa berbagi cache antaruser.
- Proxy stream menerima HEAD, segmen dan Range; playlist rewrite menjaga player tetap menggunakan proxy. Host dan redirect wajib allowlist.
- Upload JSON log memakai `File.text()` pada multipart Workers. Tidak ada pembacaan temporary file filesystem.
- Upload gambar memerlukan Cloudinary HTTP dan R2. Kegagalan penyimpanan tidak disamarkan.
- Webhook Saweria invalid/malformed signature ditolak; penyimpanan gagal menghasilkan error, bukan success palsu. Callback berulang dengan ID sama bersifat idempotent.
- Cron statistik/kompetisi yang dinonaktifkan pada sumber tidak diaktifkan otomatis. `ENABLE_COMPETITION_CRON=true` dapat mengaktifkan snapshot kompetisi setelah konfigurasi upstream siap.
- Data publik JKT48 kini disinkronkan dari API JSON resmi ke koleksi yang dipakai handler, bukan scraper HTML lama yang menulis ke koleksi legacy. Refresh diserialisasi Coordinator, dijalankan lazy/cron, mempertahankan data lama saat upstream gagal, serta memiliki batas halaman/rentang bulan/detail. News dan event pagination tidak lagi menghasilkan page 0 atau limit negatif.

## Status Sumber

`/api/stats`, `/api/stats/months`, serta route `/api/sousenkyo/*` dikomentari pada sumber. Status tetap tidak aktif; kode fungsi terkait masih tersedia. `/api/admin/stats/rebuild` tetap tersedia untuk admin. `/api/admin/edit/announcement` pada sumber memakai handler edit member; port mempertahankan route tersebut dan belum menambahkan sistem announcement baru.

Live history, gift dan user log memerlukan data yang diimpor atau collector eksternal. Webhook update live tidak mengumpulkan histori lengkap. Tidak ada fitur recorder video baru.

## Batas Operasional

Adapter D1 mendukung pola schema/query/aggregation yang digunakan repo ini, bukan seluruh API Mongoose. Transaksi beta diganti serialisasi Coordinator; optimistic version check mencegah overwrite dokumen lain. Unique constraint penting diterapkan melalui migration SQL.

Aggregation dijalankan oleh Mingo dan dibatasi ukuran dataset. D1 membatasi ukuran row, jumlah query dan execution time. Penggunaan produksi dengan histori besar perlu penyesuaian SQL untuk query yang paling mahal, precomputation atau arsip payload besar di R2. Endpoint akan mengembalikan error eksplisit saat melebihi budget, tanpa memotong data diam-diam.

Jadwal menggunakan UTC di Cloudflare. Worker baru tidak mempunyai database atau secret dari VPS secara otomatis. Deployment dan pengujian upstream produksi belum dapat dilakukan tanpa akun Cloudflare, kredensial serta data sebenarnya.
