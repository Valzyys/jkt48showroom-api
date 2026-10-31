# Gift & leaderboard

Rekap gift membantu menampilkan dukungan penggemar selama satu sesi. Gunakan unit platform dan status cakupan yang ada pada respons.

## Satuan nilai

- IDN menggunakan `idn_gold`.
- Showroom menggunakan `showroom_points`.
- Jangan menjumlahkan kedua unit sebagai satu mata uang atau nilai rupiah.

## Jumlah gift dan gambar

Rincian gift yang tersedia dapat menyertakan nama, gambar, jumlah unit, frekuensi pengiriman, serta jumlah pengirim. Gunakan nama field dari output endpoint yang dipakai; `num` dan jumlah event pengiriman dapat memiliki arti berbeda.

`live_info.gift.list` memuat ringkasan per jenis gift. Item di `live_info.gift.log[].gifts[]` juga menyertakan `name`, `img`, `image_available`, dan `point`, sehingga gambar bisa langsung ditampilkan tanpa mencari ID di katalog lain. URL `img` berasal dari media API yang menyimpan gambar di R2.

| Field | Arti |
| --- | --- |
| `num` | Jumlah unit gift yang teramati |
| `send_count` | Jumlah kiriman; `null` jika riwayat lama tidak menyimpan frekuensinya |
| `user_count` | Jumlah pengirim unik pada ringkasan jenis gift |
| `img` | URL gambar yang bisa dipasang pada elemen `<img>` |
| `image_available` | Apakah metadata gambar tersedia |

```jsx
<div>
  {gift.img && <img src={gift.img} alt={gift.name} loading="lazy" />}
  <span>{gift.name}</span>
</div>
```

## Leaderboard per pengguna

Urutkan berdasarkan unit platform dan gunakan ID pengguna sebagai identitas. Nama pengguna dapat berubah atau sama dengan pengguna lain. Jangan menggabungkan pengguna hanya berdasarkan nama tampilannya.

## Gold dan rincian event

Total gold yang dilaporkan sumber dapat tersedia meskipun rincian jenis gift atau waktu pengirimannya belum lengkap. Tampilkan total tersebut sesuai labelnya, dan pisahkan rincian gift yang diketahui.

Jika `live_info.gift.reason` bernilai `gift_events_not_captured`, daftar jenis gift dapat kosong walaupun `fans` dan `gold_summary.reported_gold` tersedia. `unattributed_gold` menjelaskan gold yang belum memiliki rincian event. API tidak menebak jenis atau jumlah gift dari selisih gold.

> [!NOTE]
> Label data parsial perlu tetap terlihat. Total gold tidak cukup untuk menebak jenis gift, jumlah kiriman, atau siapa saja yang menonton sepanjang live.

## Daftar tambahan

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/gifts' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/stagelist' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Lihat referensi untuk bentuk respons dan kebutuhan parameter tiap endpoint. Daftar yang tersedia bukan jaminan seluruh penonton sepanjang sesi.

Respons `/api/recent/DATA_ID/gifts` memuat `gifts` untuk log yang dipaginasi, `list` untuk ringkasan jenis gift beserta gambar, dan `gift_summary` untuk status ketersediaan rincian. Untuk IDN, `fans` dan `gold_summary` juga tersedia, termasuk ketika log gift kosong.
