# Mulai menggunakan

Request pertama tidak membutuhkan instalasi SDK. Siapkan API key gratis di [dashboard](/dashboard/keys), simpan sebagai `JKT48CONNECT_API_KEY`, lalu ambil berita terbaru.

> [!IMPORTANT]
> Semua endpoint di bawah `/api/` **wajib** memakai API key. Tanpa key, server mengembalikan `401`. Endpoint di bawah `/media/` dan `/replay/` (gambar, screenshot, replay) bisa dibuka tanpa key.

## Coba dengan cURL

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=2' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Key berbentuk `jkc_` + 40 karakter heksadesimal, misalnya `jkc_8f3a1c0b7e2d4a9f6c5b1e0d3a7f9c2b4e6d9d2e`. Bila klienmu tidak bisa menambah header, kirim lewat query:

```sh
curl "https://api.jkt48connect.app/api/news?page=1&perpage=2&apikey=${JKT48CONNECT_API_KEY}"
```

Detail format, cara kirim, dan error ada di [Akses & integrasi](/docs/guide/autentikasi-dan-integrasi). Client lengkap dengan retry dan cache ada di [Contoh integrasi](/docs/guide/contoh-integrasi).

## Respons nyata (terverifikasi)

Request di atas mengembalikan JSON seperti ini (data asli, dipotong):

```json
{
  "news": [
    {
      "date": "2026-10-28T17:00:00.000Z",
      "title": "Pengumuman Mengenai JKT48 1st Generation Special Stage \"Homecoming: Where It All Began\"",
      "category": "Theater",
      "id": "1881",
      "link": "pengumuman-mengenai-jkt48-1st-generation-special-stage-homecoming-where-it-all-began",
      "url": "https://jkt48.com/news/pengumuman-mengenai-jkt48-1st-generation-special-stage-homecoming-where-it-all-began"
    }
  ],
  "page": 1,
  "perpage": 2,
  "total_count": 35
}
```

Setiap respons ber-key juga membawa header kuota:

```text
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 983
X-RateLimit-Reset: 1793466000
X-Quota-Period: 2026-10
```

## Gunakan di JavaScript

```js
const base = 'https://api.jkt48connect.app';
const response = await fetch(`${base}/api/news?page=1&perpage=10`, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
});
if (!response.ok) {
  const body = await response.json().catch(() => ({}));
  throw new Error(`HTTP ${response.status}: ${body.message ?? response.statusText}`);
}
const data = await response.json();
console.log(data.news); // array berita
console.log(data.total_count); // total berita
```

## Lanjut ke member dan theater

```sh
# Daftar member (mengembalikan array)
curl 'https://api.jkt48connect.app/api/member' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"

# Detail member — pakai url slug dari daftar, mis. "abigail-rachel"
curl 'https://api.jkt48connect.app/api/member/abigail-rachel' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"

# Daftar theater
curl 'https://api.jkt48connect.app/api/theater?page=1&perpage=5' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Ambil ID dari hasil daftar untuk membuka detail. Perhatikan:
- Detail member memakai `url` (slug), **bukan** `jkt48_id` — request dengan ID angka mengembalikan `404`.
- Detail recent memakai `data_id` (mis. `idn-…`), **bukan** `_id`.
- Detail theater mengembalikan `{ date, shows: [...] }` — datanya ada di dalam array `shows`.

## Python

```python
import os
import requests

response = requests.get(
    'https://api.jkt48connect.app/api/news',
    params={'page': 1, 'perpage': 10},
    headers={'X-API-Key': os.environ['JKT48CONNECT_API_KEY']},
    timeout=30,
)
response.raise_for_status()
data = response.json()
print(f"Total: {data['total_count']} berita")
for n in data['news']:
    print(f"- {n['date'][:10]} | {n['title']}")

# Baca sisa kuota dari header
print("Sisa kuota:", response.headers.get('X-RateLimit-Remaining'))
```

## Cara testing cepat

1. Ganti `${JKT48CONNECT_API_KEY}` dengan key aslimu (atau set environment variable).
2. Jalankan salah satu perintah cURL di atas — harus mengembalikan `200` dengan JSON.
3. Jika dapat `401`, baca `message` pada respons: `"API key diperlukan."` berarti key tidak terkirim; `"API key tidak dikenal."` berarti key salah atau sudah dicabut.
4. Jika dapat `429`, kuota bulanan habis — lihat header `X-RateLimit-Reset` untuk waktu reset.
