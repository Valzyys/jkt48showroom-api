# Private JKT48 Scraper for VPS

Domain tujuan: `scrape.jkt48connect.com`. FastAPI menerima request privat dari Worker, mengambil JSON resmi JKT48 memakai `curl_cffi` dengan profil Chrome, dan mengembalikan envelope yang sama. Worker tetap memvalidasi serta menulis data ke D1. VPS tidak memerlukan kredensial Cloudflare/D1 dan bukan open proxy.

## Uji Dari VPS Sebelum Install

Target installer: Ubuntu 22.04/24.04 atau Debian 12/13 dengan systemd, akses sudo, dan Python 3.10+. Pastikan arsitektur CPU didukung wheel `curl_cffi`. Jangan menganggap IP VPS diterima upstream hanya karena probe dari komputer lain berhasil.

```sh
cd vps-scraper
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python probe.py
```

Probe memeriksa news, member dan jadwal bulan berjalan dalam WIB tanpa cookie atau token. HTTP 403 berarti akses dari VPS masih ditolak; jangan mengaktifkan scraper di Worker sebelum akses sumber berhasil. Tidak ada pemecahan CAPTCHA atau akses akun privat.

## DNS dan HTTPS

Pada zone `jkt48connect.com`, buat record A `scrape` menuju IPv4 VPS. Isi AAAA hanya jika IPv6 benar-benar aktif dan dapat menerima koneksi. Untuk penerbitan sertifikat awal, gunakan DNS-only dan pastikan TCP 80/443 terbuka pada firewall/provider. DNS, SSH key dan firewall tidak diubah oleh installer. Jangan menutup port SSH yang sedang dipakai.

Pastikan domain itu belum melayani aplikasi lain. Jika port 80/443 sudah dipakai Nginx/Apache atau reverse proxy lain, integrasikan konfigurasi HTTPS ke server tersebut; jangan menjalankan installer Caddy tanpa meninjau konflik. Cloudflare proxy opsional dapat diaktifkan setelah HTTPS origin valid dengan mode SSL Full (strict), bukan Flexible.

## Installation

```sh
sudo bash install.sh
sudo systemctl status jkt48-scraper --no-pager
curl --fail https://scrape.jkt48connect.com/health
```

Installer memasang dependensi, user non-root `jkt48-scraper`, app di `/opt/jkt48-scraper`, systemd restart-on-failure, dan konfigurasi Caddy tambahan tanpa mengganti konfigurasi utama yang sudah ada. Caddy mengelola sertifikat HTTPS. Uvicorn hanya mendengarkan `127.0.0.1:8788`; jangan membuka port ini ke Internet.

Token 64 karakter hex dibuat sekali di `/etc/jkt48-scraper.env` dengan mode `0600` dan tidak ditampilkan installer. Install ulang mempertahankan token. Jangan commit, kirim ke chat, atau masukkan token ke URL. `/health` publik hanya menunjukkan service hidup, bukan menjamin sumber JKT48 dapat diakses.

## Hubungkan Workers

Setelah service, DNS, HTTPS dan probe dari VPS berhasil, isi variable `JKT48_SCRAPER_URL` di `workers/wrangler.jsonc`:

```json
"JKT48_SCRAPER_URL": "https://scrape.jkt48connect.com/api/v1/"
```

Pasang secret `JKT48_SCRAPER_TOKEN` pada Worker dengan nilai yang sama dengan `SCRAPER_TOKEN` di VPS melalui fasilitas secrets yang aman. Jangan menyimpannya di `vars`. Script deploy tidak membuat atau merotasi token lintas VPS/Worker secara otomatis; keduanya harus cocok.

```sh
cd ../workers
npx wrangler secret put JKT48_SCRAPER_TOKEN
npm run deploy
```

Worker mengirim bearer token hanya ke origin/path scraper yang dikonfigurasi, menolak redirect, dan tidak meneruskan cookie atau User-Agent upstream. `JKT48_SCRAPER_URL` memiliki prioritas atas sumber langsung dan relay lama. Jika kosong, perilaku lama tetap digunakan. Setelah konfigurasi berubah, tunggu cooldown maksimal lima menit atau jalankan `POST /api/admin/jkt48_sync` dengan JWT admin valid. Query dan response endpoint publik tetap sama.

## Batas dan Operasional

- GET saja: news list/detail, member list/detail, schedules, theater-show/event/exclusive detail. Host upstream ditetapkan dalam kode; parameter URL arbitrary, draft news, query duplikat dan path asing ditolak.
- Bearer token wajib sebelum lookup cache. Cache maksimal 32 response selama 60 detik, deduplikasi request in-flight, dan empat koneksi upstream bersamaan.
- Maksimal 120 request upstream baru per menit per proses; cache hit tidak mengonsumsi limit. Service dijalankan dengan satu worker agar limit dan cache konsisten.
- Timeout koneksi 20 detik, deadline task 25 detik, dan payload maksimal 2 MB. Redirect upstream tidak diikuti. HTTP 403/429 tidak disamarkan sebagai success dan tidak dicache.
- JSON upstream gagal tidak menghapus D1. Worker menggunakan data terakhir jika tersedia. Profil Chrome bukan jaminan akses permanen; endpoint, IP policy dan quota upstream dapat berubah.
- Log systemd: `sudo journalctl -u jkt48-scraper --since '10 minutes ago'`. Access logging Uvicorn dimatikan agar query/headers tidak masuk log aplikasi.

## Tests

```sh
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
bash -n install.sh
```

Tes service memakai fake upstream; `probe.py` adalah pemeriksaan jaringan nyata yang harus dijalankan lagi dari VPS tujuan. DNS, sertifikat Caddy dan service systemd baru bisa diverifikasi setelah VPS tersedia.
