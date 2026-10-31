# Memutar replay

Gunakan URL player atau stream yang disertakan detail recent. Ketersediaan dan cakupan rekaman dapat berbeda antarsesi.

## Pilih URL yang sesuai

| Field | Penggunaan |
| --- | --- |
| `recording.stream_url` | Playlist gabungan sesi bila tersedia |
| `recordings[].stream_url` | HLS satu bagian rekaman |
| `recordings[].player_url` | Player yang dapat dibuka di browser |
| `recordings[].url` | File MP4 satu bagian rekaman |

## Player browser

Buka `player_url` dari respons untuk memutar bagian yang tersedia. Untuk aplikasi sendiri, gunakan player yang mendukung HLS dan URL yang diberikan API.

```html
<video controls playsinline preload="metadata"></video>
```

```js
const video = document.querySelector('video');
const source = recent.recording?.stream_url;
if (source && video.canPlayType('application/vnd.apple.mpegurl')) {
  video.src = source;
}
// Browser lain dapat memakai library player HLS yang sesuai untuk aplikasi Anda.
```

## Beberapa bagian dalam satu sesi

Satu live dapat memiliki beberapa bagian rekaman. Playlist gabungan menyusun bagian yang tersedia, tetapi tidak dapat mengembalikan durasi yang tidak pernah tercatat. Periksa `partial`, durasi, dan informasi cakupan sebelum menyebut rekaman sebagai full live.

> [!NOTE]
> URL MP4 satu bagian tidak selalu mewakili seluruh live. Gunakan metadata sesi dan playlist gabungan bila tersedia.
