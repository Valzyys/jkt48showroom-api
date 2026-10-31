# Live & recent

Live menampilkan sesi yang sedang berlangsung. Recent menampilkan rekap sesi yang sudah tersimpan, dengan detail sesuai data yang tersedia.

## Sesi aktif

```sh
curl 'https://api.jkt48connect.app/api/now_live?group=jkt48' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/idn_lives' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Daftar kosong merupakan keadaan valid ketika tidak ada sesi yang tersedia. Gunakan ID dan URL dari respons; IDN dan Showroom mempunyai identitas sesi berbeda.

## Daftar recent

```sh
curl 'https://api.jkt48connect.app/api/recent?page=1&perpage=10' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

```json
{
  "recents": [],
  "page": 1,
  "perpage": 10,
  "total_count": 0
}
```

Struktur ringkas di atas merupakan ilustrasi. Gunakan `data_id` dari daftar untuk membuka detail:

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

## Membaca rekap

| Field | Kegunaan |
| --- | --- |
| `data_id` | Identitas sesi untuk request detail |
| `type` | Platform, misalnya `idn` atau `showroom` |
| `live_info.date` | Waktu mulai dan selesai |
| `live_info.duration` | Durasi dalam milidetik |
| `live_info.gift` | Rincian gift yang tersedia |
| `users` | Pengguna yang tercatat, sesuai cakupan data |
| `recording`, `recordings` | Replay gabungan dan bagian rekaman |
| `leaderboard_designs` | Gambar leaderboard per tema dan layout |

## Data yang belum lengkap

Periksa status pada respons sebelum memberi label lengkap. Angka nol atau array kosong tidak selalu berarti tidak ada aktivitas; beberapa rincian dapat tidak tersedia. Jangan mengubah data yang belum diketahui menjadi klaim transaksi nol.

## Contoh nyata & jebakan umum (terverifikasi 2026-10-31)

**Daftar recent** — setiap item punya `_id` (internal) dan `data_id` (identitas sesi):

```json
{
  "recents": [
    {
      "_id": "e76630b397aae1f5a94bd587",
      "data_id": "idn-b255fd3394e21b7a7b39f3e7",
      "type": "idn"
    }
  ],
  "page": 1, "perpage": 2, "total_count": 1234
}
```

**Detail hanya bisa dibuka dengan `data_id`:**

```sh
# BENAR -> 200
curl 'https://api.jkt48connect.app/api/recent/idn-b255fd3394e21b7a7b39f3e7' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"

# SALAH (pakai _id) -> 404 {"status":404,"message":"Data not found!"}
curl 'https://api.jkt48connect.app/api/recent/e76630b397aae1f5a94bd587' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

**`/api/now_live` saat tidak ada live** mengembalikan array kosong `[]` — ini valid, bukan error.
