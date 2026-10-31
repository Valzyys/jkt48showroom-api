# Live & recent

Live menampilkan sesi yang sedang berlangsung. Recent menampilkan rekap sesi yang sudah tersimpan, dengan detail sesuai data yang tersedia.

> [!IMPORTANT]
> Kedua endpoint butuh API key seperti endpoint `/api` lainnya. Cukup kirim `X-API-Key` biasa — tidak perlu HMAC atau JWT tambahan (sudah diverifikasi langsung).

## Sesi aktif

```sh
curl 'https://api.jkt48connect.app/api/now_live?group=jkt48' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/idn_lives' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Ketika tidak ada live, responsnya adalah array kosong — ini keadaan valid, bukan error:

```json
[]
```

Gunakan ID dan URL dari respons; IDN dan Showroom mempunyai identitas sesi berbeda.

## Daftar recent

```sh
curl 'https://api.jkt48connect.app/api/recent?page=1&perpage=2' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Respons nyata (dipotong):

```json
{
  "recents": [
    {
      "_id": "e76630b397aae1f5a94bd587",
      "data_id": "idn-b255fd3394e21b7a7b39f3e7",
      "type": "idn",
      "member": { "...": "..." },
      "live_info": { "...": "..." },
      "leaderboard_designs": { "...": "..." }
    }
  ],
  "page": 1,
  "perpage": 2,
  "total_count": 1234
}
```

## Buka detail: pakai `data_id`, BUKAN `_id`

Setiap item punya dua identitas: `_id` (ID database internal) dan `data_id` (identitas sesi, mis. `idn-…`). **Detail hanya bisa dibuka dengan `data_id`.** Memakai `_id` mengembalikan `404`:

```sh
# BENAR — pakai data_id
curl 'https://api.jkt48connect.app/api/recent/idn-b255fd3394e21b7a7b39f3e7' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
# -> 200

# SALAH — pakai _id
curl 'https://api.jkt48connect.app/api/recent/e76630b397aae1f5a94bd587' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
# -> 404 {"status":404,"message":"Data not found!","path":"/api/recent/e76630b397aae1f5a94bd587"}
```

## Membaca rekap

Detail recent mengembalikan objek dengan field berikut (hasil testing langsung):

| Field | Kegunaan |
| --- | --- |
| `data_id` | Identitas sesi, mis. `idn-b255fd3394e21b7a7b39f3e7` |
| `type` | Platform: `idn` atau `showroom` |
| `member` | Info member yang live |
| `live_info.date` | Waktu mulai dan selesai |
| `live_info.duration` | Durasi dalam milidetik |
| `live_info.gift` | Rincian gift |
| `live_info.screenshot` | Info screenshot sesi |
| `live_info.viewers` | Data penonton |
| `live_info.comments` | Info komentar |
| `fans` | Penggemar teratas + gold |
| `gold_summary` | Ringkasan gold (IDN) |
| `point_unit` | Satuan: `idn_gold` / `showroom_points` |
| `recording_session`, `recordings` | Info replay |
| `leaderboard_designs` | Gambar rekap per tema & layout |

```js
const res = await fetch(
  `https://api.jkt48connect.app/api/recent/${dataId}`,
  { headers: { 'X-API-Key': process.env.JKT48CONNECT_API_KEY } },
);
if (res.status === 404) {
  // Pastikan yang dipakai adalah data_id, bukan _id
  throw new Error(`Sesi ${dataId} tidak ditemukan — cek kembali data_id dari daftar`);
}
const detail = await res.json();
console.log(detail.live_info.duration); // milidetik
console.log(detail.point_unit); // "idn_gold" atau "showroom_points"
```

## Data yang belum lengkap

Periksa status pada respons sebelum memberi label lengkap. Angka nol atau array kosong tidak selalu berarti tidak ada aktivitas; beberapa rincian dapat tidak tersedia. Jangan mengubah data yang belum diketahui menjadi klaim transaksi nol.
