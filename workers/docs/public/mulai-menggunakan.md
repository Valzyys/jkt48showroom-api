# Mulai menggunakan

Request pertama tidak membutuhkan instalasi SDK. Siapkan API key gratis di [dashboard](/dashboard/keys), simpan sebagai `JKT48CONNECT_API_KEY`, lalu ambil berita terbaru.

## Coba dengan cURL

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Key berbentuk `jkc_` + 40 karakter heksadesimal, misalnya `jkc_8f3a1c0b7e2d4a9f6c5b1e0d3a7f9c2b4e6d9d2e`. Bila klienmu tidak bisa menambah header, kirim lewat query:

```sh
curl "https://api.jkt48connect.app/api/news?page=1&perpage=10&apikey=${JKT48CONNECT_API_KEY}"
```

Detail format, cara kirim, dan error ada di [Akses & integrasi](/docs/guide/autentikasi-dan-integrasi). Client lengkap dengan retry dan cache ada di [Contoh integrasi](/docs/guide/contoh-integrasi).

## Gunakan di JavaScript

```js
const base = 'https://api.jkt48connect.app';
const response = await fetch(`${base}/api/news?page=1&perpage=10`, {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY },
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const data = await response.json();
console.log(data.news);
```

Bentuk respons ringkas:

```json
{
  "news": [],
  "page": 1,
  "perpage": 10,
  "total_count": 0
}
```

Contoh di atas memperlihatkan struktur, bukan hasil request live. Buka [referensi news](/docs/reference?route=GET%20%2Fapi%2Fnews) dan tekan **Coba GET** untuk melihat data saat ini.

## Lanjut ke member dan theater

```sh
curl 'https://api.jkt48connect.app/api/member' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/theater?page=1&perpage=10' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Ambil ID dari hasil daftar untuk membuka detail. Gunakan ID yang diberikan API; slug dan ID antarplatform tidak selalu sama.

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
print(response.json())
```
