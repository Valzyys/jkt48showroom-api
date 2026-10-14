# Deployment Nginx di VPS

Pemasangan 13 Oktober 2026 memakai Nginx yang sudah berjalan, tanpa menjalankan
`install.sh` (installer tersebut memakai Caddy).

- App: `/opt/jkt48-scraper`, systemd `jkt48-scraper`, enabled.
- Listener: `127.0.0.1:8788`.
- Environment privat: `/etc/jkt48-scraper.env`, mode 0600.
- Virtual host: `/etc/nginx/sites-available/scrape.jkt48connect.com`.
- HTTPS: Let's Encrypt webroot `/var/www/jkt48-acme`; renewal hook
  `/etc/letsencrypt/renewal-hooks/deploy/jkt48-nginx-reload`.
- Konfigurasi situs lain tidak diubah.

Uji HTTPS: health 200; news 200 (10), members 200 (58), schedules Oktober 2026
200 (25), theater-shows/SH2D31 200. Request news tanpa token: 401.

Worker berhasil dideploy pada 13 Oktober 2026 setelah autentikasi OAuth.
`JKT48_SCRAPER_URL` memakai HTTPS scraper dan `JKT48_SCRAPER_TOKEN` dipasang
melalui stdin tanpa menampilkan nilainya. Secret lainnya dipertahankan.
Version deployment: `4d9b527d-7143-4bb0-8e55-abd71e83b5ae`.
D1 remote tidak memerlukan migration tambahan.

Uji melalui `https://jkt48showroom-api.aslannarnia806.workers.dev`:
- `/health`: 200.
- `/api/news`: 200, total 30 berita; detail berita: 200.
- `/api/member`: 200, 58 member.
- `/api/theater`: 200, total 33 show.
- `/api/next_schedule`: 200.
- `/api/theater/SH2D31`: 200, satu show.
- Custom domain `https://api.jkt48connect.app`: health dan news 200.

D1 diverifikasi memiliki 30 berita dan 54 jadwal (semua tipe), serta profil
member. Error upstream dari deployment sebelumnya hilang setelah cooldown
lima menit dan sinkronisasi baru berhasil. Tes unit JKT48: 15 lulus.

Untuk deployment berikutnya, dengan autentikasi Cloudflare yang tersedia:

```sh
python3 vps-scraper/deploy/connect-worker.py
```

Script memeriksa akses Worker, membaca token VPS tanpa menampilkannya,
mengunggah `JKT48_SCRAPER_TOKEN` melalui stdin, lalu menjalankan deployment
beserta migration D1. Secret Worker lainnya dipertahankan oleh script deploy.
