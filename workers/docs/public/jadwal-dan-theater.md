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
