# Verifikasi

Pemeriksaan pada branch `cloudflare-workers` dilakukan melalui workflow `Cloudflare Workers Checks`:

- `npm ci` menggunakan lockfile.
- `npm audit --omit=dev` harus lulus.
- 54 unit tests: D1 schema casting, populate, pagination, aggregation, optimistic concurrency, document limits, SQL filter/migration, Mongo export importer, proxy HLS/Range/HEAD/redirect/timeout, setup/deploy otomatis, JSON source validation, WIB conversion, dataset sync, pagination, scrape relay, penulisan batch source, redaksi diagnostik sync dan transport VPS privat.
- Setup/deploy menggunakan mock Wrangler untuk menguji secret acak, izin file privat, idempotensi, preservasi secret remote, deployment pertama, dry-run tanpa perubahan resource, kegagalan autentikasi, rotasi eksplisit, dan urutan migration setelah deploy berhasil.
- `wrangler deploy --dry-run`: bundle module Worker, binding D1/R2 dan kedua Durable Objects.
- 19 hasil test runtime Miniflare (18 subtests dan parent): health/member, news bootstrap/detail/cache, birthday profiles, theater/event/schedule/setlist bootstrap, admin sync/stale data, cold-source HTTP 403/backoff/recovery, login/session proxy, refresh/invalid token, user likes, concurrent beta enrollment, live update/WebSocket CBOR, admin/API-key, CSRF, signature replay, Saweria, multipart image/R2, comment/follow/reorder, logout.

Unit tests juga dijalankan lokal. Tes integrasi menggunakan upstream mock dan fixture D1; tidak melakukan login account produksi, mengambil data MongoDB produksi, atau melakukan deployment Cloudflare.

Job `python-scraper` menjalankan sembilan tes service VPS untuk bearer authentication, cache/query, endpoint allowlist, penolakan 403/redirect/challenge/payload besar, rate limit, timeout dan redaksi error. Tes Miniflare memakai origin VPS mock dan memverifikasi token serta tidak adanya cookie upstream. Installer diperiksa sintaksnya; instalasi systemd/HTTPS/DNS harus diverifikasi pada VPS sebenarnya.

Jaminan pemeriksaan ini terbatas pada kontrak yang diuji. Smoke test dengan upstream sebenarnya dan pengukuran query untuk ukuran dataset produksi tetap diperlukan setelah binding, secret dan data disiapkan. File API.md dan COMPATIBILITY.md mencatat konfigurasi serta batas operasional.
