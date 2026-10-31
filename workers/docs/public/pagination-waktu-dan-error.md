# Pagination, waktu & error

Bentuk respons mengikuti masing-masing endpoint. Ada endpoint JSON, gambar, teks, dan playlist; jangan memakai satu parser untuk semuanya.

## Pagination

Endpoint daftar yang mendukung pagination memakai `page` serta `perpage`:

```js
const url = new URL('https://api.jkt48connect.app/api/news');
url.searchParams.set('page', '1');
url.searchParams.set('perpage', '10');
const response = await fetch(url, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
});
const data = await response.json();
// { news: [...], page: 1, perpage: 10, total_count: 35 }
```

Respons daftar menyertakan `total_count`. Array kosong adalah hasil valid ketika data tidak tersedia atau halaman sudah melewati batas. Beberapa endpoint (mis. `/api/member`, `/api/birthday`, `/api/setlist`, `/api/next_schedule`) mengembalikan **array langsung** tanpa wrapper pagination.

## Timestamp dan durasi

Gunakan timestamp ISO sebagai waktu absolut. Akhiran `Z` menunjukkan UTC. Tampilkan WIB memakai `Asia/Jakarta`. Durasi recent menggunakan milidetik; bagi dengan `1000` untuk detik.

```js
// ISO UTC -> label WIB
const wib = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date('2026-10-28T17:00:00.000Z'));
// "28 Okt 2026, 00.00"

// Milidetik -> menit
const menit = Math.round(7103559 / 60000); // 118 menit
```

## Tangani status HTTP

```js
const response = await fetch(url, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
});
if (!response.ok) {
  const body = await response.json().catch(() => ({}));
  // body = { status, message, path, ... }
  throw new Error(`HTTP ${response.status}: ${body.message ?? response.statusText}`);
}
const contentType = response.headers.get('content-type') || '';
const result = contentType.includes('application/json')
  ? await response.json()
  : await response.text();
```

| Status | Arti | Langkah aplikasi |
| --- | --- | --- |
| `400` | Periksa parameter, ID, serta format request |
| `401` | Key tidak ada / salah / dicabut — baca `message`: `"API key diperlukan."` atau `"API key tidak dikenal."` |
| `403` | Periksa kebutuhan akses dan credential di backend |
| `404` | Periksa ID — untuk recent pakai `data_id` bukan `_id`; untuk member pakai slug `url` bukan `jkt48_id` |
| `429` | Kuota habis — perlambat request; ikuti `Retry-After` dan `X-RateLimit-Reset` |
| `5xx` | Tampilkan keadaan gagal sementara dan gunakan retry terbatas |

Contoh `404` nyata (salah pakai `_id` untuk recent):

```json
{
  "status": 404,
  "message": "Data not found!",
  "path": "/api/recent/e76630b397aae1f5a94bd587"
}
```

## Contoh dan data langsung

Contoh yang bertanggal merupakan snapshot. Contoh dari source memperlihatkan kontrak, bukan jaminan data saat ini. Playground menampilkan status HTTP hasil request langsung dan membatasi ukuran preview.
