# Mulai menggunakan

Request pertama tidak membutuhkan instalasi SDK atau login. Contoh berikut mengambil berita terbaru.

## Coba dengan cURL

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10'
```

## Gunakan di JavaScript

```js
const base = 'https://api.jkt48connect.app';
const response = await fetch(`${base}/api/news?page=1&perpage=10`);
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
curl 'https://api.jkt48connect.app/api/member'
curl 'https://api.jkt48connect.app/api/theater?page=1&perpage=10'
```

Ambil ID dari hasil daftar untuk membuka detail. Gunakan ID yang diberikan API; slug dan ID antarplatform tidak selalu sama.

## Python

```python
import requests

response = requests.get(
    'https://api.jkt48connect.app/api/news',
    params={'page': 1, 'perpage': 10},
    timeout=30,
)
response.raise_for_status()
print(response.json())
```
