# Media & screenshot

Gambar member, gift, screenshot live, dan poster dapat ditampilkan menggunakan URL yang disediakan respons API.

## Gambar responsif

```jsx
<img
  src={imageUrl}
  alt="Cuplikan sesi live"
  loading="lazy"
  style={{ width: '100%', height: 'auto' }}
/>
```

Tampilkan placeholder ketika URL kosong atau gambar tidak dapat dimuat. Jangan menambahkan domain sumber lain ke URL yang sudah lengkap.

## Screenshot satu sesi

```sh
curl 'https://api.jkt48connect.app/api/screenshots/DATA_ID' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Daftar timestamp dapat dikombinasikan dengan `base_url` serta `format` yang diberikan respons.

```js
const screenshot = recent.live_info?.screenshot;
const urls = screenshot?.base_url
  ? (screenshot.list || []).map(time =>
      `${screenshot.base_url}/${time}.${screenshot.format || 'jpg'}`)
  : [];
```

## Pilih beberapa momen

Ambil momen awal, tengah, serta akhir dari daftar yang tersedia. Jangan mengasumsikan interval screenshot selalu sama atau setiap menit pasti mempunyai gambar.

## Media dan cache

Simpan URL media yang dikembalikan API dan ikuti header cache HTTP. Untuk poster atau rekaman, gunakan versi URL terbaru dari detail recent. Hindari memodifikasi query atau nama file yang tidak didokumentasikan.
