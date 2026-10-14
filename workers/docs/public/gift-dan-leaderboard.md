# Gift & leaderboard

Rekap gift membantu menampilkan dukungan penggemar selama satu sesi. Gunakan unit platform dan status cakupan yang ada pada respons.

## Satuan nilai

- IDN menggunakan `idn_gold`.
- Showroom menggunakan `showroom_points`.
- Jangan menjumlahkan kedua unit sebagai satu mata uang atau nilai rupiah.

## Jumlah gift dan gambar

Rincian gift yang tersedia dapat menyertakan nama, gambar, jumlah unit, frekuensi pengiriman, serta jumlah pengirim. Gunakan nama field dari output endpoint yang dipakai; `num` dan jumlah event pengiriman dapat memiliki arti berbeda.

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

> [!NOTE]
> Label data parsial perlu tetap terlihat. Total gold tidak cukup untuk menebak jenis gift, jumlah kiriman, atau siapa saja yang menonton sepanjang live.

## Daftar tambahan

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/gifts'
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/stagelist'
```

Lihat referensi untuk bentuk respons dan kebutuhan parameter tiap endpoint. Daftar yang tersedia bukan jaminan seluruh penonton sepanjang sesi.
