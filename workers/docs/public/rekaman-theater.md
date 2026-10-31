# Rekaman theater di YouTube

`GET /api/theater/recordings` mengembalikan daftar proses rekaman theater, screenshot, dan URL YouTube yang telah berhasil dibuat. Gunakan API key seperti endpoint publik lainnya.

```js
const response = await fetch('https://api.jkt48connect.app/api/theater/recordings', {
  headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY }
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { recordings } = await response.json();
const uploaded = recordings.filter(item => item.status === 'uploaded' && item.youtube_url);
```

Respons nyata (satu item, dipotong):

```json
{
  "recordings": [
    {
      "id": "028802e2f573f0b06f131f113ae6b7bc",
      "theater_code": "SHCD32",
      "slug": "itadakilove-2026-10-18-261010220519",
      "title": "ITADAKI🤍LOVE - 2026/10/18",
      "started_at": "2026-10-18T11:44:27.000Z",
      "observed_at": "2026-10-18T12:30:19.569Z",
      "ended_at": "2026-10-18T14:30:04.314Z",
      "status": "uploaded",
      "youtube_id": "0TlGGWV3bj0",
      "youtube_url": "https://www.youtube.com/watch?v=0TlGGWV3bj0",
      "youtube_privacy": "unlisted",
      "bytes": 6524353147,
      "duration_ms": 7103559,
      "partial": true,
      "disconnects": 18,
      "error": null,
      "thumbnail_status": "uploaded"
    }
  ]
}
```

## Status

| Status | Makna |
| --- | --- |
| `waiting` | Menunggu sumber atau mencoba menyambung kembali |
| `recording` | Merekam stream yang sedang live |
| `queued` / `finalizing` | Sesi selesai; menyiapkan video untuk unggahan |
| `uploading` | Mengirim video ke YouTube |
| `uploaded` | YouTube mengembalikan ID video dan privasi unlisted terkonfirmasi |
| `upload_failed` | Unggahan atau pengaturan privasi tertunda; akan dicoba ulang |

`youtube_url` bernilai `null` sampai YouTube mengembalikan ID video nyata. YouTube masih dapat memerlukan waktu untuk memproses video setelah upload. Periksa `youtube_privacy`, `status`, dan `error` sebelum membagikan tautannya.

## Durasi dan screenshot

`started_at` adalah waktu mulai dari sumber; `observed_at` adalah saat perekam mulai mengamati. `duration_ms` adalah durasi file video hasil rekaman. `partial: true` berarti perekaman terlambat dimulai atau mengalami jeda; itu tidak menjamin seluruh pertunjukan tercakup.

Video disimpan di YouTube dengan privasi **unlisted**, bukan R2. `screenshots` berisi `{ timestamp, url }`; JPEG disimpan di R2 dan satu gambar digunakan sebagai thumbnail. `storage` bernilai `youtube` dan `screenshot_storage` bernilai `r2`.

Untuk pertunjukan yang berhasil dicocokkan dengan kode jadwal, detail `/api/theater/:id` juga menyertakan array `recordings` di dalam objek pertunjukannya.

## Testing cepat

```sh
# Harus 200 dengan array recordings
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}" \
  'https://api.jkt48connect.app/api/theater/recordings'

# Hitung yang sudah terupload
curl -s -H "X-API-Key: ${JKT48CONNECT_API_KEY}" \
  'https://api.jkt48connect.app/api/theater/recordings' | \
  python3 -c "import json,sys; r=json.load(sys.stdin)['recordings']; print(f'{len([x for x in r if x[\"status\"]==\"uploaded\"])} dari {len(r)} sudah terupload')"
```
