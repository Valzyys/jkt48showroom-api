# VPS live collector

Collector khusus JKT48 Showroom dan IDN, terpisah dari scraper JSON JKT48.
Systemd `jkt48-live-collector` menjalankan user `jkt48collector`; konfigurasi privat
ada di `/etc/jkt48-live-collector.env`. Jangan menampilkan file tersebut.

- Deteksi live setiap 30 detik; arsip selesai setelah tiga respons discovery
  sukses berturut-turut tidak menemukan sesi. Kegagalan upstream tidak menutup sesi.
- Gift Showroom dibaca melalui WebSocket bcsvr dari `live_info`, dengan katalog
  `gift_list`. Kuantitas event digabung per user/gift/menit. Tidak mengirim gift.
- Gift IDN diamati melalui event `gift-received-in-room` pada situs resmi, menggunakan
  browser tanpa login. Gold yang terlihat di event dicatat; ini bukan bukti transaksi
  atau nilai rupiah. Chat yang membutuhkan login tidak diakali.
- Sesi yang mulai dipantau di tengah live diberi metadata `observed_since` dan
  gift berstatus `partial`. Reconnect dapat meninggalkan gap; tidak mengarang gift
  yang terlewat. Gift dan screenshot IDN sudah diamati pada live produksi; hasil tetap ditandai parsial.
- Screenshot JPEG 640px setiap 60 detik, langsung ke Worker lalu R2.
- Video: FFmpeg codec-copy, AAC bitstream filter dan fragmented MP4 dengan `delay_moov` ke stdout.
  Buffer multipart sekitar 5 MiB berada di RAM; tidak ada file video di disk VPS.
  Worker menyimpan multipart ke R2. Video bisa diputar setelah upload selesai;
  HTTP Range didukung. Koneksi yang putus menghasilkan file parsial terpisah.
- Media tidak diambil jika Showroom menandai recording prohibited, tidak ada
  stream yang dapat diakses, atau pengaturan media dinonaktifkan.
- SQLite lokal hanya menyimpan checkpoint metadata dan statistik. Data arsip,
  pengguna/gift dan relasi member dipublikasikan ke D1 melalui endpoint collector
  privat. Payload idempotent dengan `data_id` yang stabil.
- R2: `live-screenshots/{data_id}/{frame}.jpg` dan
  `live-screenshots/{data_id}/video-{run}.mp4`.
- Upload multipart tidak aktif selama 24 jam dibatalkan Worker, tanpa menghapus
  video yang sudah selesai.

Pengaturan pada `/control/admin`, kelompok **Live collector**: aktif/nonaktif,
rekam video, interval polling, interval/lebar screenshot dan batas sesi.
Status menampilkan heartbeat, sesi, jumlah media dan replay yang sudah tersedia.
Token collector berbeda dari server API key; rotasi token harus disamakan di VPS.

API hasil: `/api/recent` hanya arsip selesai; `/api/recent/:id` memuat `capture`,
`recordings`, `point_unit` dan metadata screenshot. `/api/screenshots/:id` memuat
`base_url`, `format` dan `list`; URL frame = `${base_url}/${id}.${format}`.
`point_unit`: `showroom_points` atau `idn_gold`. Video yang belum selesai belum
memiliki URL replay; collector tetap mengunggah part selama live.

Pengujian: `PYTHONPATH=live-collector /opt/jkt48-live-collector/.venv/bin/python -m unittest discover -s live-collector/tests`.
Worker integration: `node --test test/collector.test.js` setelah build.

Panel Pemantauan collector VPS di admin memperbarui status setiap 15 detik: heartbeat, PID/uptime proses, discovery, progress multipart video, screenshot terakhir dan kegagalan, serta antrean/publikasi recent. Telemetri hanya memuat field status yang diizinkan; URL stream, token dan kredensial socket tidak dikirim ke panel. Heartbeat memantau proses collector, bukan seluruh layanan systemd di VPS.

### Recent leaderboard cards

Install `fonts-lato`, `fonts-liberation`, and `fonts-noto-color-emoji` for matching
fonts. Copy `leaderboard-renderer.cjs`, `leaderboard-template.cjs`, `leaderboard-banner.cjs`, `leaderboard-artwork.cjs`, `leaderboard-connect.cjs`, `leaderboard-frames.cjs`, and
`leaderboard-shell.html` alongside the collector. Install the provided
`jkt48-leaderboard.service` and `.timer`, then enable the timer:

```
systemctl enable --now jkt48-leaderboard.timer
```

It shares the private collector environment file and existing Chromium executable,
but runs in a separate process with CPU and memory limits. No video recording
process needs restarting. Cards use completed recent data, provider-specific gift
units, the top five observed gifters, and up to three real screenshots. Images have
no visible site URL or site name. PNG bytes upload directly from RAM to R2. A
versioned render lease prevents duplicate jobs and rejects cards for stale data.

```
node --test tests/leaderboard.test.cjs
```


Recording resilience: all discovered sessions get media tasks independently of the
IDN chat page limit. Failed multipart requests retry the same buffer and upload;
checkpointed uploads survive process restarts. Finalization is idempotent and the
Worker's part ledger is authoritative during recovery. Interrupted prefixes are
preserved as partial MP4s without inventing duration or an HLS index. Use
`recording_session.stream_url` to play all indexed parts of one recent. Media
permissions remain enforced. Temporary absence from a listing does not stop an
advancing recording; provider checks and a grace period confirm the end. Chat
reconnects independently, and unrelated/expected socket closures do not count as
active chat failures.

Both portrait posters (1800 × 2400 PNG) and independently composed landscape banners (2400 × 1350 PNG, 16:9) are rendered automatically. Recent list/detail exposes the images only through `leaderboard_designs.photobook.{portrait,banner}` and `leaderboard_designs.jkt48connect.{portrait,banner}`. The duplicate `leaderboard_image` and `leaderboard_images` fields have been removed. Jobs alternate between layouts, each with its own lease and R2 object; one layout failing does not invalidate the other.

Fan Signal uses `leaderboard_designs.jkt48connect.{portrait,banner}`; Photobook uses `leaderboard_designs.photobook.{portrait,banner}`. Renderer alternates all four jobs, up to 12 per run. Apply migration 0007 before activating the new Worker/renderer.

### IDN collection accuracy

IDN top-gifter snapshots are fetched through the authenticated private Worker
endpoint every ~20 seconds and twice at completion. The Worker holds the web
client key and refresh-token flow; credentials are never included in public data.
Observed gift events remain separate from cumulative gold snapshots. No missing
gift type/count is invented from a total difference. Public `gold_summary` and
per-fan source fields expose the difference. Unavailable rankings preserve the
last successful snapshot and remain visible as warnings in admin monitoring.

Discovery runs independently per provider (5–15 second delay); archive uploads
run concurrently, bounded at two, every ~5 seconds. Neither blocks chat ingestion.
Full session snapshots no longer serialize on each IDN event: a compact SQLite
journal is committed first and checkpointed about every 750 ms. Restart replays
uncheckpointed events with provider IDs for deduplication. Video upload retries
and multipart recovery retain their existing behavior.

The IDN browser observer replaces crashed tabs and tabs that fail navigation or
reload. Each room has its own recovery state; slow page creation does not block
auth updates, removal, or other rooms. Events from old tab generations and other
room IDs are discarded. Browser disconnects allow a fresh launch. Recovery never
changes video recording tasks. Run `node --test tests/idn-*.test.cjs` to verify it.

Recent gift logs and their paginated endpoint include gift names and R2 image
URLs. Catalog IDs are merged with observed log IDs, so incomplete older ID lists
do not hide recorded gifts. Cumulative top-gifter gold cannot reconstruct missing
gift types or quantities: responses expose `gift_events_not_captured` when no
gift events were saved, while retaining the separately sourced fan leaderboard.
