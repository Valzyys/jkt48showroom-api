# Musik dan lirik sinkron

API musik menyediakan pencarian judul/artis/potongan lirik lintas genre, audio-only penuh dari sumber publik, dan lirik bertimestamp jika tersedia. Bukan ekstraksi audio Spotify. Tidak memerlukan login Spotify/YouTube; akses API memakai API key JKT48Connect biasa.

1. `GET /api/music/search?q=judul&mode=auto` — pilih `tracks[].id`.
2. `GET /api/music/{id}` — ambil `audio.url` bertanda tangan, berlaku 30 menit.
3. `GET /api/music/{id}/lyrics` — ambil `lines` dengan `time` dalam detik dan `text`.

Kirim header `X-API-Key` untuk ketiga endpoint. URL media bertanda tangan dapat dipasang langsung pada `<audio controls src="URL_AUDIO">` tanpa header khusus. Mendukung HTTP Range untuk seek. M4A memakai MIME `audio/mp4` dengan `has_video:false`; hanya stream AAC audio yang dikirim.

Untuk sinkronisasi, pilih baris terakhir yang `time <= audio.currentTime + offsetSeconds` setiap `timeupdate`. Saat seek atau pause, gunakan posisi elemen audio yang sama. Sinkronisasi per baris. `alignment: needs_check` atau selisih durasi menandakan kemungkinan versi/intro berbeda, sehingga perlu offset manual. Lirik yang tidak tersedia atau tanpa timestamp tidak disebut sinkron.

`mode=lyrics` untuk potongan lirik, `mode=title` untuk pencarian judul langsung, `mode=auto` untuk gabungan. URL track Spotify dapat dipakai untuk metadata pencarian. Hasil pengenalan bersifat dugaan; pilih sumber yang sesuai.

Sumber yang memerlukan login, dibatasi akses, atau memakai DRM tidak dilayani. Lirik tidak tersedia untuk semua lagu. Audio tidak disimpan penuh di VPS atau R2, melainkan dialirkan melalui relay. URL Google dan token relay tidak dimasukkan ke respons publik.

Lirik dicari dari LRCLIB terlebih dahulu. Bila belum sinkron, server dapat memakai fallback Spotify dengan cookie privat yang sudah dikonfigurasi. Cookie hanya dipakai untuk lirik, tidak dikirim ke pengguna, dan tidak dipakai untuk mengambil audio.
