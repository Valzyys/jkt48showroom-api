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
