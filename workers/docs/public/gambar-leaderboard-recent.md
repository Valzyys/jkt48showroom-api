# Gambar leaderboard

Daftar dan detail recent menyediakan URL gambar rekap melalui satu field `leaderboard_designs`, dengan dua tema: `photobook` dan `jkt48connect`. Setiap tema mempunyai layout `portrait` dan `banner`. Gunakan URL dari respons agar versi desain serta identitas sesi sesuai dengan datanya.

Untuk integrasi yang sebelumnya memakai `leaderboard_image` atau `leaderboard_images`, pindahkan pembacaan gambar ke `leaderboard_designs.photobook.portrait` atau `.banner`. Kedua field lama sudah dihapus dari respons.

## Tema dan layout

| Tema | Portrait | Banner |
| --- | --- | --- |
| Photobook | `leaderboard_designs.photobook.portrait` | `leaderboard_designs.photobook.banner` |
| Fan Signal | `leaderboard_designs.jkt48connect.portrait` | `leaderboard_designs.jkt48connect.banner` |

Objek gambar menyertakan status dan URL ketika tersedia. Periksa `status === 'ready'` sebelum menampilkan gambar.

```jsx
const image = recent.leaderboard_designs?.jkt48connect?.banner;

return image?.status === 'ready' && image.url ? (
  <img src={image.url} alt="Rekap dan leaderboard sesi live" loading="lazy" />
) : (
  <p>Gambar rekap belum tersedia.</p>
);
```

## Bentuk gambar

Portrait cocok untuk poster; banner cocok untuk tampilan landscape. Komposisi berbeda menurut layout. Data yang tampil dapat mencakup profil, durasi, penonton, supporter, gift, dan beberapa screenshot yang tersedia.

## Versi dan cakupan

Gunakan URL terbaru dari detail recent. Jangan merakit path gambar sendiri atau mengasumsikan semua sesi mempunyai gambar siap pakai. Catatan parsial pada gambar menjelaskan keterbatasan data sesi tersebut.


Style `avonera48` tersedia sebagai pilihan ketiga, dengan desain playful tanpa tulisan brand Avonera48. Pilih `avonera48.portrait` atau `avonera48.banner` pada field desain yang sama. Gambar playful berukuran 1800 × 2400 (portrait) atau 2400 × 1350 (banner). Style `jkt48connect` menampilkan brand JKT48Connect dan latar pola sinyal.

## Contoh nyata (terverifikasi 2026-10-31)

Struktur `leaderboard_designs` pada detail recent (dipotong):

```json
{
  "leaderboard_designs": {
    "photobook": {
      "portrait": {
        "status": "ready",
        "url": "https://api.jkt48connect.app/media/leaderboards/v3/idn-b255fd3394e21b7a7b39f3e7/412.png",
        "width": 1800,
        "height": 2400,
        "format": "png",
        "updated_at": "2026-10-31T07:57:42.017Z"
      },
      "banner": { "status": "ready", "url": "...", "width": 2400, "height": 1350 }
    },
    "jkt48connect": { "portrait": {...}, "banner": {...} }
  }
}
```
