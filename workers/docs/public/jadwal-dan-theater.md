# Jadwal & theater

Gabungkan daftar jadwal dengan detail show untuk menampilkan setlist, member yang tampil, serta informasi sesi yang tersedia.

## Endpoint utama

| Tujuan | Request | Bentuk respons |
| --- | --- | --- |
| Jadwal berikutnya | `GET /api/next_schedule` | Array show |
| Daftar theater | `GET /api/theater` | `{ theater: [...] }` |
| Detail theater | `GET /api/theater/:id` | `{ date, shows: [...] }` |
| Event | `GET /api/event` | Array |
| Event JKT48 | `GET /api/jkt48event` | Array |
| Detail event JKT48 | `GET /api/jkt48event/:id` | Objek |
| Setlist | `GET /api/setlist` | Array `{ id, title }` |

## Ambil detail dari ID daftar

```js
const base = 'https://api.jkt48connect.app';
const id = 'SH9F6C'; // Gunakan ID dari daftar theater.
const response = await fetch(`${base}/api/theater/${encodeURIComponent(id)}`, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const detail = await response.json();
// detail = { date: "2026-11-07T00:00:00.000Z", shows: [...] }
const show = detail.shows[0];
console.log(show.title); // "Cara Meminum Ramune"
console.log(show.members); // member yang tampil
console.log(show.setlist); // setlist show
```

Field pada tiap show (hasil testing): `id`, `date`, `title`, `team`, `members`, `setlist`, `schedule_designs`, `recordings`, `seitansai`, `graduation`, `url`.

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

Show di daftar `/api/theater`, detail `/api/theater/:id`, dan `/api/next_schedule` memiliki `schedule_designs`. Tersedia tiga tema — `photobook`, `jkt48connect`, dan `avonera48` — masing-masing `portrait` (1800 × 2400) dan `banner` (2400 × 1350).

Respons nyata (dipotong):

```json
{
  "schedule_designs": {
    "photobook": {
      "portrait": {
        "status": "ready",
        "url": "https://api.jkt48connect.app/media/theater-schedules/v1/photobook/SH9F6C/50422c95bffb5a7cd78d708b.png",
        "width": 1800,
        "height": 2400,
        "format": "png"
      },
      "banner": { "status": "ready", "url": "...", "width": 2400, "height": 1350 }
    },
    "jkt48connect": { "portrait": { "...": "..." }, "banner": { "...": "..." } },
    "avonera48": { "portrait": { "...": "..." }, "banner": { "...": "..." } }
  }
}
```

```js
const image = detail.shows[0].schedule_designs.jkt48connect.banner;
if (image.status === 'ready') {
  document.querySelector('#schedule-image').src = image.url;
}
```

Gambar PNG disimpan di R2 dan **bisa dibuka tanpa API key**. Status `pending` berarti gambar sedang disiapkan; `failed` akan dicoba ulang otomatis. URL bernilai `null` sampai gambar siap. Perubahan tanggal, jam, lineup atau informasi birthday show menghasilkan versi gambar baru. Periksa `status` sebelum menggunakan URL.

Style `avonera48` adalah desain playful tanpa tulisan brand Avonera48. Style `jkt48connect` menampilkan brand JKT48Connect dan latar pola sinyal.

## Setlist

```sh
curl 'https://api.jkt48connect.app/api/setlist' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

```json
[
  { "id": "carameminumramune", "title": "Cara Meminum Ramune" },
  { "id": "pajamadrive", "title": "Pajama Drive" },
  { "id": "itadaki♥love", "title": "ITADAKI♥LOVE" }
]
```
