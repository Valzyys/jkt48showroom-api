# Gambar leaderboard

Daftar dan detail recent menyediakan URL gambar rekap melalui satu field `leaderboard_designs`, dengan tiga tema: `photobook`, `jkt48connect`, dan `avonera48`. Setiap tema mempunyai layout `portrait` dan `banner`. Gunakan URL dari respons agar versi desain serta identitas sesi sesuai dengan datanya.

Untuk integrasi yang sebelumnya memakai `leaderboard_image` atau `leaderboard_images`, pindahkan pembacaan gambar ke `leaderboard_designs.photobook.portrait` atau `.banner`. Kedua field lama sudah dihapus dari respons.

## Tema dan layout

| Tema | Portrait | Banner |
| --- | --- | --- |
| Photobook | `leaderboard_designs.photobook.portrait` | `leaderboard_designs.photobook.banner` |
| Fan Signal | `leaderboard_designs.jkt48connect.portrait` | `leaderboard_designs.jkt48connect.banner` |
| Avonera48 (playful) | `leaderboard_designs.avonera48.portrait` | `leaderboard_designs.avonera48.banner` |

Objek gambar menyertakan status, URL, dan dimensi ketika tersedia. Periksa `status === 'ready'` sebelum menampilkan gambar. Respons nyata (dipotong):

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
    "jkt48connect": { "portrait": { "...": "..." }, "banner": { "...": "..." } }
  }
}
```

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

Gambar PNG bisa dibuka **tanpa API key**. Style `avonera48` adalah desain playful tanpa tulisan brand Avonera48; style `jkt48connect` menampilkan brand JKT48Connect dan latar pola sinyal.

## Versi dan cakupan

Gunakan URL terbaru dari detail recent. Jangan merakit path gambar sendiri atau mengasumsikan semua sesi mempunyai gambar siap pakai. Catatan parsial pada gambar menjelaskan keterbatasan data sesi tersebut.
