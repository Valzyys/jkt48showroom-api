# Jadwal & theater

Gabungkan daftar jadwal dengan detail show untuk menampilkan setlist, member yang tampil, serta informasi sesi yang tersedia.

## Endpoint utama

| Tujuan | Request |
| --- | --- |
| Jadwal berikutnya | `GET /api/next_schedule` |
| Daftar theater | `GET /api/theater` |
| Detail theater | `GET /api/theater/:id` |
| Event | `GET /api/event` |
| Event JKT48 | `GET /api/jkt48event` |
| Detail event JKT48 | `GET /api/jkt48event/:id` |
| Setlist | `GET /api/setlist` |

## Ambil detail dari ID daftar

```js
const base = 'https://api.jkt48connect.app';
const id = 'SHOW_ID'; // Gunakan ID dari daftar theater.
const response = await fetch(`${base}/api/theater/${encodeURIComponent(id)}`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const detail = await response.json();
```

## Waktu dan perubahan jadwal

Timestamp ISO dengan akhiran `Z` menggunakan UTC. Konversikan ke zona waktu yang ingin ditampilkan.

```js
const label = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  dateStyle: 'long',
  timeStyle: 'short',
}).format(new Date(show.date));
```

> [!NOTE]
> Daftar member dan informasi show dapat berubah mengikuti pembaruan sumber. Gunakan link resmi yang ada pada respons untuk informasi pembelian atau pengumuman terbaru.

## Gambar jadwal theater

Show di daftar `/api/theater`, detail `/api/theater/:id`, dan `/api/next_schedule` memiliki `schedule_designs`. Tersedia tema `photobook` dan `jkt48connect`, masing-masing `portrait` (1800 × 2400) dan `banner` (2400 × 1350).

```js
const image = detail.shows[0].schedule_designs.jkt48connect.banner;
if (image.status === 'ready') {
  document.querySelector('#schedule-image').src = image.url;
}
```

Gambar PNG disimpan di R2. Status `pending` berarti gambar sedang disiapkan; `failed` akan dicoba ulang otomatis. URL bernilai `null` sampai gambar siap. Perubahan tanggal, jam, lineup atau informasi birthday show menghasilkan versi gambar baru. Periksa `status` sebelum menggunakan URL.


Style `avonera48` tersedia sebagai pilihan ketiga, dengan desain playful tanpa tulisan brand Avonera48. Pilih `avonera48.portrait` atau `avonera48.banner` pada field desain yang sama. Gambar playful berukuran 1800 × 2400 (portrait) atau 2400 × 1350 (banner). Style `jkt48connect` menampilkan brand JKT48Connect dan latar pola sinyal.
