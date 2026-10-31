# Pagination, waktu & error

Bentuk respons mengikuti masing-masing endpoint. Ada endpoint JSON, gambar, teks, dan playlist; jangan memakai satu parser untuk semuanya.

## Pagination

Endpoint daftar yang mendukung pagination biasanya menggunakan `page` serta `perpage`. Baca parameter pada referensi karena tidak semua daftar memakai parameter yang sama.

```js
const url = new URL('https://api.jkt48connect.app/api/news');
url.searchParams.set('page', '1');
url.searchParams.set('perpage', '10');
const response = await fetch(url);
```

Respons dapat menyertakan `total_count`. Array kosong adalah hasil valid ketika data tidak tersedia atau halaman sudah melewati batas.

## Timestamp dan durasi

Gunakan timestamp ISO sebagai waktu absolut. Akhiran `Z` menunjukkan UTC. Tampilkan WIB memakai `Asia/Jakarta`. Durasi recent menggunakan milidetik; bagi dengan `1000` untuk detik.

## Tangani status HTTP

```js
const response = await fetch(url);
if (!response.ok) {
  const message = await response.text();
  throw new Error(`HTTP ${response.status}: ${message}`);
}
const contentType = response.headers.get('content-type') || '';
const result = contentType.includes('application/json')
  ? await response.json()
  : await response.text();
```

| Status | Langkah aplikasi |
| --- | --- |
| `400` | Periksa parameter, ID, serta format request |
| `401` / `403` | Periksa kebutuhan akses dan credential di backend |
| `404` | Periksa ID atau URL terbaru dari daftar |
| `429` | Perlambat request; ikuti `Retry-After` bila tersedia |
| `5xx` | Tampilkan keadaan gagal sementara dan gunakan retry terbatas |

## Contoh dan data langsung

Contoh yang bertanggal merupakan snapshot. Contoh dari source memperlihatkan kontrak, bukan jaminan data saat ini. Playground menampilkan status HTTP hasil request langsung dan membatasi ukuran preview.

## Contoh error nyata (terverifikasi 2026-10-31)

**404 karena salah identitas** (pakai `_id` untuk recent, seharusnya `data_id`):

```json
{
  "status": 404,
  "message": "Data not found!",
  "path": "/api/recent/e76630b397aae1f5a94bd587"
}
```

**401 tanpa key:**

```json
{
  "status": 401,
  "message": "API key diperlukan. Buat API key gratis di dashboard lalu kirim lewat header X-API-Key atau query ?apikey=...",
  "path": "/api/news"
}
```
