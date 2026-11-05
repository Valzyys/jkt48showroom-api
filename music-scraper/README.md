# JKT48Connect Music API — audio only

Live: https://api.jkt48connect.app/api/music. Panduan: https://api.jkt48connect.app/docs/music.md.

Pencarian lintas artis/genre, pengenalan potongan lirik, audio penuh M4A/AAC (fallback WebM/Opus), dan lirik LRC bertimestamp. Tidak memakai iframe atau video player. Metadata Spotify opsional lewat oEmbed; audio dari sumber publik YouTube, bukan decrypt Spotify. Tanpa akun/cookies Spotify atau YouTube. Developer memakai API key JKT48Connect biasa.

## Endpoint

```bash
curl -G 'https://api.jkt48connect.app/api/music/search' \
  -H 'X-API-Key: API_KEY_KAMU' \
  --data-urlencode 'q=Adele Someone Like You' --data 'mode=auto'
curl 'https://api.jkt48connect.app/api/music/hLQl3WQQoQ0' -H 'X-API-Key: API_KEY_KAMU'
curl 'https://api.jkt48connect.app/api/music/hLQl3WQQoQ0/lyrics' -H 'X-API-Key: API_KEY_KAMU'
```

`mode=auto` menggabungkan pengenalan judul/artis/lirik dari Genius publik; `mode=lyrics` untuk potongan lirik; `mode=title` untuk pencarian langsung. Hasil pengenalan adalah dugaan; pilih versi lagu dari `tracks`. URL track Spotify diterima untuk metadata pencarian. Audio baru `ready` setelah format audio-only dan byte sumber diperiksa.

Detail berisi `audio.url`, MIME, codec, ukuran, `has_video:false`, `seekable:true`, waktu kedaluwarsa dan `lyrics_url`. M4A memakai MIME `audio/mp4`, tetapi tidak memiliki track video. Pasang URL langsung pada elemen `<audio controls>`. URL Google dan header privat tidak dipublikasikan. Tidak menyimpan lagu penuh di VPS/R2.

URL audio bertanda tangan berlaku 30 menit, mendukung GET/HEAD dan satu HTTP Range. URL media tidak memerlukan API key agar dapat digunakan elemen audio; API pencarian/detail/lirik tetap memerlukannya. Signature mengikat ID, format dan masa berlaku.

## Lirik

LRCLIB mengembalikan `lines: [{time, text}]`. Pada `audio.timeupdate`, pilih baris terakhir dengan `time <= audio.currentTime + offsetSeconds`; seek/pause memakai posisi elemen audio yang sama. Sinkronisasi per baris, bukan per kata. Periksa `alignment` dan `duration_difference_seconds`: MV/live/remix bisa punya intro berbeda; sediakan offset manual. Satu timestamp untuk seluruh lagu tidak dianggap sinkron. Status not_found/unsynced/error tidak boleh diganti timestamp buatan.

## Server

Baremetal `/opt/jkt48-music-api`, service `jkt48-music-api`, loopback `127.0.0.1:8815`. Nginx menyalurkan `/api/v1/music/`; Worker mengautentikasi relay dengan token scraper yang sudah ada. Proses scraper/collector lama tidak direstart.

Python 3.10+, curl, yt-dlp dan Node diperlukan. Isi `SCRAPER_TOKEN` privat, pasang requirements.txt, jalankan `audio_server:app` satu worker. Jangan menaruh token relay di browser. Adapter Worker ada di workers/src/runtime/music.js. `musicAPI` harus dipasang sesudah metering/auth API; `musicMedia` sebelum itu karena media memakai signature sendiri.

Cache metadata/URL sementara maksimal 256 hasil, permintaan duplikat digabung, LRCLIB berurutan minimum 400 ms. Lookup audio maksimal 10/menit, satu proses ekstraksi sekaligus, maksimal delapan stream; ukuran maksimum 160 MiB dan durasi tiga jam. Service CPU 75%/RAM 512 MiB. Host fetch dibatasi kode; sumber audio hanya HTTPS *.googlevideo.com/videoplayback tanpa credential/port arbitrer.

Sumber yang memerlukan login, dibatasi akses/usia, memakai DRM, dihapus atau menolak request tidak dipaksakan: kembalikan error. Tidak menjanjikan seluruh katalog Spotify tersedia. Durasi cocok belum membuktikan sinkronisasi sempurna pada setiap versi.

Uji: `.venv/bin/python -m unittest discover -s tests`; dari root repo: `node --test workers/test/music.test.js`.

Spotify fallback: simpan cookie Netscape privat root:root mode 600 di `/etc/jkt48-spotify-cookies.txt`. Unit menggunakan `LoadCredential` agar user layanan dapat membacanya tanpa membuka akses file asli. Hanya `sp_dc` yang dipakai, khusus lirik. Bila LRCLIB tidak memiliki timestamp, cari Spotify dengan kecocokan judul/artis/durasi. Hanya `LINE_SYNCED` dengan beberapa timestamp berbeda yang dikembalikan sebagai `source:spotify,status:synced`. Kegagalan fallback mempertahankan lirik LRCLIB beserta status diagnostik aman. Hasil sinkron disimpan di cache 1 jam, hasil belum sinkron 2 menit; permintaan Spotify dibatasi 1/detik, satu lookup sekaligus, cooldown saat auth/rate-limit gagal. Restart layanan setelah mengganti file cookie. Cookie tidak diteruskan ke ekstraktor audio.
