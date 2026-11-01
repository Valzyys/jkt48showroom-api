# Gambar notifikasi live

Gunakan kartu PNG untuk membagikan live ke X, WhatsApp, atau platform lain. Gambar dibuat otomatis setelah collector mendeteksi sesi live dan disimpan di R2. Tersedia dua tema dengan komposisi tersendiri untuk setiap ukuran.

| Tema | Portrait | Banner |
| --- | --- | --- |
| `photobook` | 1080 × 1350 | 1600 × 900 |
| `jkt48connect` (Fan Signal) | 1080 × 1350 | 1600 × 900 |

## Mendapatkan gambar

`GET /api/live-notifications` mengembalikan `{ "lives": [...] }` untuk sesi yang masih dilaporkan aktif oleh collector. `GET /api/live-notifications/:id` mengambil satu sesi menggunakan `data_id`. Data live pada `/api/now_live` juga dapat menyertakan `notification_designs`, `notification_caption`, dan `notification_data_id` setelah sesi terdeteksi.

```js
const response = await fetch('https://api.jkt48connect.app/api/live-notifications', {
  headers: { 'X-API-Key': YOUR_API_KEY }
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { lives } = await response.json();
for (const live of lives) {
  const image = live.notification_designs.jkt48connect.banner;
  if (live.is_live && image.status === 'ready') {
    console.log(image.url, live.caption);
  }
}
```

Gambar memuat nama, foto member, judul, platform, dan waktu mulai dalam WIB. Gunakan `caption` untuk tautan live. Sistem menyediakan file untuk diunduh; publikasi ke akun sosial dilakukan oleh aplikasi Anda.

## Status dan masa berlaku

Periksa `status === 'ready'` dan `url` sebelum memakai gambar. `pending` berarti masih menunggu render, sedangkan `failed` berarti proses akan mencoba kembali. Waktu pembuatan bergantung pada antrean dan ketersediaan foto; tidak ada jaminan selesai pada detik tertentu.

`is_live` hanya benar ketika collector masih melaporkan sesi aktif dalam tiga menit terakhir. Detail sesi lama tetap dapat dibaca, tetapi jangan menganggap tautan gambar sebagai bukti bahwa live masih berlangsung. `is_preview: true` menandai contoh dari sesi arsip dan juga ditulis jelas pada gambar.

PNG dapat dibuka tanpa API key dan mendukung GET, HEAD, serta ETag. Gunakan URL dari respons, jangan merakit path sendiri. Perubahan identitas sesi menghasilkan versi URL baru; perubahan jumlah viewer atau gift tidak memicu render ulang.


Style `avonera48` tersedia sebagai pilihan ketiga, dengan desain playful tanpa tulisan brand Avonera48. Pilih `avonera48.portrait` atau `avonera48.banner` pada field desain yang sama. Gambar playful berukuran 1800 × 2400 (portrait) atau 2400 × 1350 (banner). Style `jkt48connect` menampilkan brand JKT48Connect dan latar pola sinyal.


## Kesiapan gambar

URL tujuan gambar sudah tersedia saat status `pending`. Simpan URL tersebut, tetapi tampilkan atau unduh gambar setelah status menjadi `ready`. URL yang belum selesai dibuat dapat mengembalikan HTTP 404 dengan `Cache-Control: no-store`; jangan menganggapnya sebagai gambar siap pakai. Periksa ulang metadata sekitar setiap 2–3 detik selama pending dan hentikan setelah ready.

File yang sudah siap disimpan di R2 dan menggunakan URL versi yang dapat di-cache. Membuka file PNG tidak merender ulang gambar. Gunakan URL terbaru dari respons apabila data sumber berubah.
