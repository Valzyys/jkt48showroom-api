# Upload replay recent member

Service terpisah dari recorder theater. Mengambil manifest arsip completed setiap 5 menit; tidak memanggil platform IDN/Showroom. Setiap MP4 R2 dikirim dengan Range ke buffer RAM 2 MiB lalu ke resumable upload YouTube, dengan prefetch maksimal satu chunk berikutnya untuk menumpangtindihkan download dan upload. Tidak ada MP4, TS, atau cache video yang ditulis ke disk VPS. Hanya SQLite berisi status, offset, identitas sumber, dan URL resumable privat (mode 600).

Satu video per bagian rekaman; judul mencantumkan nama member, judul live, platform, waktu WIB, serta nomor bagian bila terpecah. R2 asli tetap disimpan. Tidak mengklaim memulihkan durasi yang memang tidak tertangkap collector.

- Showroom: public.
- IDN: unlisted sampai `live_info.date.end + 72 jam`, lalu public. Pemeriksaan setiap 30 detik di task independen dari upload panjang. Ini memakai videos.update, sebab publishAt hanya berlaku untuk private.
- Kanal dibatasi `UCTyCC-_QhsV01cN2CAzN3Fg`; identitas berbeda menghentikan upload.
- SQLite unique `data_id:run`, flock proses, offset Google, penanda description dan pemeriksaan upload playlist mencegah duplikasi. ID video pada playlist saja tidak membuktikan transfer selesai; sesi yang masih terbuka selalu dilanjutkan lewat URL resumable. Pemulihan video yang sudah ada di YouTube memerlukan processing sukses. Job tanpa URL resumable dan tanpa byte terkirim dapat dicoba lagi setelah pemindaian marker selesai. Sesi kedaluwarsa atau hasil transfer yang masih ambigu tetap needs_review.
- Dua transfer berjalan bersamaan, masing-masing maksimal satu prefetch chunk. Pembuatan sesi baru diserialkan dan diberi jarak minimal 60 detik, dengan jadwal tersimpan setelah restart. Kegagalan transfer memakai retry bertahap. Kuota proyek harian menunggu tengah malam Pacific + 60 detik (mengikuti DST); `uploadLimitExceeded` kanal menunggu 24 jam + 60 detik; rate limit sesaat menunggu minimal 120 detik dan menghormati Retry-After numerik. Penyebab asli yang aman dan waktu retry WIB dicatat di log, tanpa respons mentah Google. Tidak menjamin bebas batas YouTube; batas kanal berbeda dari kuota proyek.
- Maksimal 90 percobaan insert per hari waktu Pacific sebagai anggaran lokal, bukan klaim kuota kanal. Saat ditolak, worker lain ikut berhenti membuat sesi baru. Jadwal backoff tersimpan independen dari status per video. Transfer yang sudah terbuka, pengelompokan playlist, dan publikasi 72 jam tetap berjalan secara independen. OAuth rusak membatasi percobaan berikutnya. Upload subscriber notifications dimatikan untuk backlog. Upgrade dari kode lama hanya memeriksa ulang sekali error generik `youtube_quota` yang pasti belum membuat sesi; upload selesai/URL resumable tetap dipertahankan.
- Link dan status tersedia sebagai `youtube_replay.videos[]` pada daftar/detail recent; API key tetap wajib. Endpoint kontrol hanya Bearer collector.
- YouTube masih perlu memproses video setelah transfer selesai. Status pemrosesan diperiksa tanpa upload ulang. Pengaturan privasi diverifikasi dengan API, bukan hanya menganggap request diterima.
- Status pemrosesan diterbitkan sebagai `processing_status`. Task playback terpisah memeriksa playlist dan segmen YouTube, maksimal satu video setiap 20 detik dan satu pemeriksaan ulang per video setiap 30 menit. Pemeriksaan ini tidak menahan transfer upload atau perubahan privasi 72 jam.
- Recent menyertakan ID/link dan M3U8 YouTube bertanda tangan. Detail replay beralih dari R2 hanya setelah transfer, processing, dan pemeriksaan HLS sukses. Sesi multipart tetap mencakup semua bagian; arsip R2 tidak dihapus otomatis dan masih menjadi sumber transfer serta fallback untuk bagian yang belum siap.

## Playlist otomatis

`playlist_manager.py` berjalan sebagai task independen. Replay public yang sudah selesai diunggah masuk ke tiga kategori playlist:

- Member: nama panggilan dari katalog (`Erine JKT48`).
- Platform: `IDN Live JKT48` / `Showroom Live JKT48`.
- Bulan: `Oktober 2026 • JKT48 Live Chapter`. Bulan mengikuti **tanggal mulai live dalam WIB**, bukan waktu upload. Live yang melewati tengah malam/batas bulan tetap berada pada bulan mulainya; tahun dibedakan. Playlist bulan berikutnya dibuat saat video public pertama dari bulan tersebut tersedia.

Video IDN unlisted belum ditambahkan ke playlist publik; pengelompokan menyusul otomatis setelah public pada batas 72 jam. Status upload dan privasi video tidak diubah oleh pengelompokan. Video yang sudah berstatus grouped pada versi lama diperiksa kembali sekali untuk menambahkan kategori bulan. Keanggotaan lama tetap digunakan tanpa insert ganda. Kemajuan tiap kategori disimpan segera, sehingga kegagalan kategori member tidak menghilangkan keberhasilan kategori bulan/platform.

Playlist dan keanggotaan dicatat di SQLite, dengan pemeriksaan remote untuk menghindari duplikat. Respons mutasi yang tidak diketahui hasilnya tidak langsung diulang. Backfill replay yang sudah diunggah memakai data job yang tersimpan; tidak memindai atau menebak identitas video lama yang tidak mempunyai data sumber. Batas 3.000 unit per hari waktu Pacific untuk mutasi playlist menyisakan kuota bagi upload, recorder theater dan perubahan privasi; sisa pekerjaan dilanjutkan otomatis. HTTP 429/rate limit menghentikan sementara seluruh task playlist, mengikuti Retry-After (minimal 5 menit), dengan jadwal tersimpan setelah restart; bukan mencoba ulang setiap video secara berturut-turut. Upload dan publikasi 72 jam tetap berjalan independen. Pemasangan kategori ini tidak mengubah logo, banner, atau cover playlist.

## Pemasangan

1. Terapkan migration Worker `0018_recent_youtube.sql` dan deploy Worker.
2. Salin `uploader.py` dan `playlist_manager.py` ke `/opt/jkt48-recent-youtube` dan unit ke `/etc/systemd/system`.
3. Unit memakai virtualenv dan env privat recorder yang sudah ada. Tidak perlu menyalin secret ke source.
   Penggantian token khusus recent memakai `/etc/jkt48-recent-youtube-oauth.env` (root, mode 600), dibaca setelah env recorder. Ini tidak mengubah kredensial recorder theater atau menghapus jadwal backoff kanal.
4. `systemctl daemon-reload && systemctl enable --now jkt48-recent-youtube`.
5. Pantau `journalctl -u jkt48-recent-youtube -f`. Jangan menampilkan kolom `_upload_url` dari SQLite ke publik.

Tes lokal: `THEATER_CODE_DIR=/opt/jkt48-scraper-src/theater-recorder /opt/jkt48-live-collector/.venv/bin/python -m unittest discover -s recent-youtube/tests -v`.

## OAuth bersama auto-live

Uploader mengambil token dari alur admin `/control/youtube-oauth` yang sama dengan auto-live. Secret handoff root-only berada di `/etc/jkt48-youtube-oauth-worker-token`; systemd meneruskannya melalui `LoadCredential`. Token tersimpan mode 600 dalam state uploader, bukan source atau log. Channel wajib sesuai `RECENT_YOUTUBE_CHANNEL_ID` sebelum token dipasang. Token baru menghapus penundaan karena OAuth, tetapi mempertahankan batas kuota Google.

Setelah pemindaian playlist upload selesai, job sesi yang tidak pernah memperoleh URL resumable dan belum mengirim byte dapat dicoba lagi. Video selesai dikenali lewat marker; job yang sudah punya URL, ID video, atau byte terkirim tetap dipertahankan untuk mencegah duplikat. Preflight autentikasi dilakukan sebelum menandai pembuatan sesi. Batas tanggal 1 November, IDN unlisted 72 jam dan Showroom public tetap berlaku. Transfer tetap memakai potongan RAM; tidak mengunduh file replay ke disk VPS.

Transfer Range R2 memakai pool HTTP/1.1 terpisah dari polling, OAuth dan playlist. Ini membatasi unduhan media hingga empat request serta mencegah antrean body besar pada satu koneksi HTTP/2 menahan request kontrol.

Potongan upload kini 2 MiB (kelipatan 256 KiB) agar checkpoint dan retry lebih cepat pada koneksi tidak stabil. PUT resumable YouTube juga memakai HTTP/1.1, sehingga body video tidak berbagi koneksi HTTP/2 metadata.
