# Verifikasi

Pemeriksaan pada branch `cloudflare-workers` dilakukan melalui workflow `Cloudflare Workers Checks`:

- `npm ci` menggunakan lockfile.
- `npm audit --omit=dev` harus lulus.
- 25 unit tests: D1 schema casting, populate, pagination, aggregation, optimistic concurrency, document limits, SQL filter/migration, Mongo export importer, proxy HLS/Range/HEAD/redirect/timeout.
- `wrangler deploy --dry-run`: bundle module Worker, binding D1/R2 dan kedua Durable Objects.
- 14 hasil test runtime Miniflare (13 subtests dan parent): health/member, login/session proxy, refresh/invalid token, user likes, concurrent beta enrollment, live update/WebSocket CBOR, admin/API-key, CSRF, signature replay, Saweria, multipart image/R2, comment/follow/reorder, logout.

Unit tests juga dijalankan lokal. Tes integrasi menggunakan upstream mock dan fixture D1; tidak melakukan login account produksi, mengambil data MongoDB produksi, atau melakukan deployment Cloudflare.

Jaminan pemeriksaan ini terbatas pada kontrak yang diuji. Smoke test dengan upstream sebenarnya dan pengukuran query untuk ukuran dataset produksi tetap diperlukan setelah binding, secret dan data disiapkan. File API.md dan COMPATIBILITY.md mencatat konfigurasi serta batas operasional.
