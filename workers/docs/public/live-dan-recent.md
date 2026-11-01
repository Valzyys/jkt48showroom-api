# Live & recent

Live menampilkan sesi yang sedang berlangsung. Recent menampilkan rekap sesi yang sudah tersimpan, dengan detail sesuai data yang tersedia.

## Sesi aktif

```sh
curl 'https://api.jkt48connect.app/api/now_live?group=jkt48' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/idn_lives' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Daftar kosong merupakan keadaan valid ketika tidak ada sesi yang tersedia. Gunakan ID dan URL dari respons; IDN dan Showroom mempunyai identitas sesi berbeda.

## Daftar recent

```sh
curl 'https://api.jkt48connect.app/api/recent?page=1&perpage=10' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

```json
{
  "recents": [],
  "page": 1,
  "perpage": 10,
  "total_count": 0
}
```

Struktur ringkas di atas merupakan ilustrasi. Gunakan `data_id` dari daftar untuk membuka detail:

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

## Membaca rekap

| Field | Kegunaan |
| --- | --- |
| `data_id` | Identitas sesi untuk request detail |
| `type` | Platform, misalnya `idn` atau `showroom` |
| `live_info.date` | Waktu mulai dan selesai |
| `live_info.duration` | Durasi dalam milidetik |
| `live_info.gift` | Rincian gift yang tersedia |
| `users` | Pengguna yang tercatat, sesuai cakupan data |
| `recording_session`, `recordings` | Replay gabungan dan bagian rekaman pada detail |
| `playback` | Sumber dan URL pemutar utama pada daftar/detail untuk live mulai 29 Oktober 2026 WIB |
| `leaderboard_designs` | Gambar leaderboard per tema dan layout |
| `youtube_replay.videos` | Link replay YouTube, judul, nomor run, status upload dan privasi; `null` jika belum tersedia |

## Replay YouTube

Daftar dan detail recent menyertakan `youtube_replay` jika sudah masuk proses upload. Baca `videos[].url`, `status`, `privacy`, dan `public_at`. URL dapat tersedia saat YouTube masih memproses video. Bila rekaman terpecah, setiap bagian memiliki video dan nomor bagian tersendiri pada judul. Gunakan semua bagian yang tersedia, bukan hanya elemen pertama.

Replay Showroom dipublikasikan langsung. Replay IDN tetap unlisted sampai 72 jam sejak waktu live berakhir, kemudian otomatis public. Status mengikuti hasil verifikasi YouTube. Arsip dapat memiliki jeda atau bagian yang tidak tertangkap collector; pengunggahan tidak memulihkan bagian yang hilang.

### Playback replay dari YouTube

Setiap `youtube_replay.videos[]` menyertakan `youtube_id`, `url`/`youtube_url`, `processing_status`, `playback_status`, dan `stream_url`. Link YouTube sudah dapat ditampilkan setelah upload; M3U8 baru tersedia setelah pemrosesan video selesai. `playback_status: ready` berarti playlist VOD dan satu segmen telah berhasil diperiksa. `on_demand` belum membuktikan segmen tersedia; `unavailable` berarti sumber sedang menolak atau belum menyediakan HLS.

Peralihan sumber utama berlaku untuk live yang **mulai pada atau setelah 29 Oktober 2026 pukul 00.00 WIB** (`2026-10-28T17:00:00Z`). Live sebelum batas tersebut tetap memakai URL rekaman dan playlist R2, meskipun sudah mempunyai salinan YouTube. Identitas sesi, gift, screenshot, tanggal, dan struktur lama tetap dipertahankan.

Untuk live mulai batas tersebut, daftar dan detail recent mendapat field tambahan `playback`. Gunakan `playback.stream_url` sebagai URL pemutar utama dan periksa `playback.storage` serta `playback.status`. Pada detail, bagian rekaman yang sudah lolos pemeriksaan dan cocok jumlah byte-nya memakai `recordings[].storage: youtube`, ID/link YouTube, dan `url`/`stream_url` M3U8 dari relay YouTube. Bagian yang masih menunggu atau gagal tetap memakai arsip asal yang tersedia. Tidak ada ekstraksi video saat membaca daftar recent, sehingga respons daftar tetap ringan.

Contoh potongan struktur untuk satu bagian yang sudah memakai YouTube (ID dan ticket hanya ilustrasi):

```json
{
  "playback": {
    "storage": "youtube",
    "status": "ready",
    "format": "m3u8",
    "stream_url": "https://api.jkt48connect.app/media/youtube/VIDEO_ID/TICKET/index.m3u8",
    "youtube_id": "VIDEO_ID",
    "youtube_url": "https://www.youtube.com/watch?v=VIDEO_ID",
    "parts": 1
  }
}
```

Untuk beberapa bagian, `playback.stream_url` adalah playlist gabungan; `youtube_id` dan `youtube_url` ringkas bernilai `null`. ID dan link masing-masing bagian tetap tersedia dalam `youtube_replay.videos[]` dan `recordings[]` pada detail.

URL M3U8 bertanda tangan berlaku sekitar tiga jam; ambil respons recent terbaru ketika kedaluwarsa. URL sumber Google dan kredensial tidak dikirim ke aplikasi. Untuk sesi dengan beberapa bagian, gunakan `recording_session.stream_url` agar semua bagian diputar berurutan; jangan hanya mengambil video pertama. Peralihan sumber tidak mengubah cakupan/durasi rekaman yang memang tertangkap.

## Data yang belum lengkap

Periksa status pada respons sebelum memberi label lengkap. Angka nol atau array kosong tidak selalu berarti tidak ada aktivitas; beberapa rincian dapat tidak tersedia. Jangan mengubah data yang belum diketahui menjadi klaim transaksi nol.
