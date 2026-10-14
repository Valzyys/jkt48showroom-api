# JKT48 Connect API — panduan lengkap

Maintainer: **valzy** · Website: https://jkt48connect.com

Base URL produksi: `https://api.jkt48connect.app`.
UI dokumentasi: `https://api.jkt48connect.app/docs`.
Repository: https://github.com/Valzyys/jkt48showroom-api

Dokumentasi ini sesuai checkout deployment Workers versi `0.14.2-workers.1`, diperiksa
13 Oktober 2026 (WIB). Path `/api/...` adalah API publik aplikasi. Domain scraper VPS
adalah transport privat Worker dan bukan base URL untuk client.

## Mulai menggunakan

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10'
curl 'https://api.jkt48connect.app/api/member'
curl 'https://api.jkt48connect.app/api/theater/SH2D31'
```

```js
const base = 'https://api.jkt48connect.app';
const response = await fetch(`${base}/api/news?page=1&perpage=10`);
const data = await response.json();
if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`);
console.log(data.news);
```

```python
import requests
r = requests.get('https://api.jkt48connect.app/api/news',
                 params={'page': 1, 'perpage': 10}, timeout=30)
r.raise_for_status()
print(r.json()['news'])
```

Tidak semua endpoint mengembalikan envelope yang sama. Contohnya member adalah
array, news adalah object berisi `news`, sedangkan theater detail berisi `shows`.
Nilai tanggal ISO dengan `Z` berarti UTC; konversi UI menggunakan `Asia/Jakarta`.
News/theater/jkt48event: `page=1`, `perpage=10`, maksimum perpage 30.

## Status deployment dan contoh

Respons produksi lengkap tersimpan di `response-samples.json`; katalog per-route
di `routes.json`. Contoh array di panduan ini dipersingkat ke satu item agar mudah
dibaca. Contoh penolakan autentikasi bukan contoh sukses.

Member dan birthday telah diperbaiki: profil tanpa tanggal lahir dilewati dan
perhitungan ulang tahun memakai WIB. Next birthday default adalah grup JKT48.
Gambar relative `media/...` dan URL storage JKT48 dipetakan ke `/media/jkt48/...`.
Gambar diunduh melalui scraper VPS saat belum ada di R2, lalu disimpan dan
selalu dilayani dari R2. Endpoint media mendukung GET/HEAD/ETag.

Panel admin: `https://api.jkt48connect.app/control/admin`.
Admin dapat melihat server API key aktif atau menyiapkan key baru dan menyimpannya.
Login admin memakai email/password yang diberikan pemilik; kredensial tidak
tercantum pada dokumentasi publik. Secret konfigurasi disimpan terenkripsi.

## Autentikasi dan integrasi

Browser production harus memakai Origin yang terdaftar pada konfigurasi CORS.
Deployment saat dokumentasi dibuat memakai `ORIGINS=http://localhost:3000`.
Form mutation juga diperiksa CSRF. Pemanggilan backend tidak terikat CORS browser.
Tidak ada secret nyata dalam contoh; semua nilai autentikasi adalah placeholder.

Login Showroom menghasilkan `access_token`, `refresh_token` dan `user`.
Gunakan `Authorization: Bearer ACCESS_TOKEN`; middleware dapat memperbarui token
jika dikirim `X-Refresh-Token: REFRESH_TOKEN`. Ambil pembaruan dari header respons
`X-Access-Token`, `X-Refresh-Token`, `X-SR-Token`. Tidak ada route refresh terpisah.
Route admin mensyaratkan ID user Showroom yang tercantum pada `ADMIN_IDS`;
konfigurasi saat ini kosong sehingga akses admin belum diaktifkan.

```js
const response = await fetch('https://api.jkt48connect.app/api/user', {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'X-Refresh-Token': refreshToken
  }
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const user = await response.json();
```

Untuk recent, server dapat memakai `x-api-key` atau HMAC. Default secret HMAC
adalah string hex hasil `HMAC-SHA256(key=JWT_SECRET,message=SECRET)`; alternatif
per-source dikonfigurasi oleh pengelola. Jangan distribusikan server key di frontend.

```js
// Jalankan di backend. SIGNATURE_SECRET berasal dari konfigurasi aman.
import { createHmac, randomUUID } from 'node:crypto';
const nonce = randomUUID();
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = createHmac('sha256', process.env.SIGNATURE_SECRET)
  .update(`${nonce}.${timestamp}`).digest('hex');
const response = await fetch('https://api.jkt48connect.app/api/recent', {
  headers: {'x-nonce': nonce, 'x-timestamp': timestamp, 'x-signature': signature}
});
```

Jika memakai secret per-source, tambahkan `x-source` dengan nama yang dikonfigurasi.
Toleransi timestamp 240 detik; nonce sekali pakai. API key bukan scraper token.

## Daftar route dan kontrak

Path relatif terhadap domain Worker. Respons sukses mempertahankan bentuk handler asal: ada endpoint array, object, text dan playlist. Error umumnya `{ "status": 401, "message": "Unauthorized!", "path": "/api/..." }`; stream juga meneruskan body/status error upstream. Semua response pribadi `Cache-Control: no-store`.

## Autentikasi

User: `Authorization: Bearer <access_token>`. Refresh: `X-Refresh-Token: <refresh_token>`. Session Showroom: `X-SR-Token: <token>`. Header pembaruan token bisa muncul pada response dan diekspos melalui CORS. Login menggunakan form-urlencoded/multipart: `account_id`, `password`, optional `captcha_word`. Session/CSRF upstream diinisialisasi oleh API; captcha tidak dilewati.

Admin adalah user Showroom terautentikasi yang ID-nya tercantum di `ADMIN_IDS`. Route admin tanpa akses mengembalikan 404 sesuai sumber. `/api/admin/update_lives` adalah pengecualian: memakai `api_key` pada JSON body, bukan token user.

Endpoint recent memerlukan signature atau server `API_KEY` melalui `x-api-key`/query `api_key`. Signature menggunakan `x-nonce`, `x-timestamp` (Unix seconds), `x-signature` (HMAC-SHA256 hex), optional `x-source`. Pesan ditandatangani adalah `<nonce>.<timestamp>`. Secret default adalah hex `HMAC-SHA256(key=JWT_SECRET, message=SECRET)`; secret per source dikonfigurasi `SIGNATURE_SECRETS=source:secret,...`. Toleransi waktu 240 detik; nonce hanya sekali pakai. Origin yang secara eksplisit ada di `SECONDARY_ORIGINS` mempertahankan bypass signature dari sumber untuk data publik.

Competition detail/top fans memerlukan server API_KEY atau JWT HS256 yang ditandatangani `JWT_SECRET` melalui `x-api-key`/query `api_key`. Jangan menaruh server secret pada frontend publik.

Request mutasi form harus menggunakan `Origin` frontend yang ada di `ORIGINS`, atau konteks `Sec-Fetch-Site` yang lolos CSRF. Origin tidak dikenal mendapat 403. Server collector sebaiknya mengirim JSON untuk webhook live.

## Route Publik

| Method | Path | Parameter/fungsi |
|---|---|---|
| GET | `/` | Author, website, version |
| GET | `/health` | Pemeriksaan tabel D1; 200 siap, 503 belum initialized |
| GET | `/api/now_live` | `group=jkt48|hinatazaka46|all`, default jkt48; `debug` untuk upstream fallback/debug |
| GET | `/api/next_live` | Jadwal live Showroom berikutnya |
| GET | `/api/idn_lives` | Daftar live IDN yang sesuai member |
| GET | `/api/idn_user` | `user_id`; profil upstream IDN |
| GET | `/api/watch/:id` | `id` adalah room URL key; status, stream, komentar, gifts dan broadcast connection |
| GET | `/api/watch/:id/idn` | `id` adalah username IDN; live detail |
| GET, HEAD | `/api/stream` | `url` URL HTTPS CDN dalam allowlist; HLS dan binary segment |
| GET | `/api/turn` | Request kredensial TURN upstream Cloudflare; status ketersediaan mengikuti upstream |
| GET | `/api/member` | `group`, default jkt48; array profil ringkas |
| GET | `/api/member/:id` | `id` slug member atau room URL key; profil lengkap dan ringkasan live |
| GET | `/api/member_profile_videos` | Video profil member sesuai filter sumber |
| GET | `/api/48/member` | `group`; daftar member database 48 group |
| GET | `/api/birthday` | `group`; daftar ulang tahun |
| GET | `/api/next_birthday` | `group`; ulang tahun berikutnya |
| GET | `/api/banner` | Banner per grup |
| GET | `/api/jkt48_youtube` | Video terbaru kanal JKT48/JKT48TV; perlu API YouTube |
| GET | `/api/jkt48v_live` | YouTube live kanal `JKT48V_YT_IDS`; perlu API YouTube |
| GET | `/api/leaderboard` | Leaderboard Saweria upstream; perlu SAWERIA_KEY |
| GET | `/api/weekly` | `type`, `platform`, `format`, `api_key`; weekly gift/viewers/duration/follower/total-live/no-live/theater sesuai handler |
| GET | `/api/showroom_competition` | Ranking kompetisi snapshot dari database |
| GET | `/api/showroom_competition_detail` | `room_id`; ranking/statistik member; API-key required |
| GET | `/api/showroom_competition_top_fans` | `room_id`; kontribusi fans; API-key required |
| GET | `/api/first_data` | Timestamp data live pertama |
| GET | `/api/records` | Rekor viewers, durasi, gifts Showroom/IDN |
| GET | `/api/screenshots/:id` | Screenshot dari log; `DISABLE_SCREENSHOTS`/`HALF_SCREENSHOTS` mempengaruhi hasil |
| GET | `/api/recent` | Signature/API-key; pagination/filter di bawah |
| GET | `/api/recent/:id` | Signature/API-key; lookup `data_id` atau `live_id` |
| GET | `/api/recent/:data_id/gifts` | `page`, `perpage`, `s` pencarian fans/gifts |
| GET | `/api/recent/:data_id/stagelist` | Riwayat stage users |
| GET | `/api/sitemap/recent` | `year` 2020..tahun berjalan, `image_limit` 1..5; array sitemap entries |
| GET | `/api/next_schedule` | Jadwal berikutnya |
| GET | `/api/event` | Ringkasan upcoming event/theater |
| GET | `/api/theater` | `page`, `perpage`, `type`; theater/event schedule |
| GET | `/api/theater/:id` | ID/code schedule; detail dan member |
| GET | `/api/jkt48event` | `page`, `perpage`; daftar event |
| GET | `/api/jkt48event/:id` | Detail event dan member |
| GET | `/api/setlist` | Daftar setlist |
| GET | `/api/news` | `page`, `perpage`; daftar berita |
| GET | `/api/news/:id` | News ID/link key; detail berita |
| GET | `/api/profile` | `room_id`, optional user auth/session; profil Showroom |
| GET | `/api/client` | User-agent dan status embedded; no-store |
| GET | `/api/my_ip` | IP dari `CF-Connecting-IP` |
| POST | `/api/beta` | JSON `fingerprint`, optional `key`; `{enabled:boolean}` |

Recent: `page` default 1, `perpage` default 10 maksimal 30, `group`, `room_id`, `type=all|showroom|idn`, `search`, `filter=active|graduated`, `sort=date|gift|views|duration`, `order=-1|1`, `date` berupa JSON string `{start:<milliseconds>,end:<milliseconds>}`. Daftar menyertakan pagination dan total count; detail/gifts memerlukan log dan data pendukung yang sesuai.

## Proxy Showroom

Semua menggunakan GET di `/api/showroom`. Query upstream diteruskan. User auth optional; `X-SR-Token` dapat dipakai untuk session yang sudah dibuat. Endpoint akan menginisialisasi session jika belum tersedia. API tidak membagi cache pribadi antaruser.

| Path | Upstream |
|---|---|
| `/user/profile` | `/api/user/profile` |
| `/status` | `/api/room/status` |
| `/onlives` | `/api/live/onlives` |
| `/polling` | `/api/live/polling` |
| `/summary_ranking` | `/api/live/summary_ranking` |
| `/stage_user_list` | `/api/live/stage_user_list` |
| `/live_info` | `/api/live/live_info` |
| `/telop` | `/api/live/telop` |
| `/greeting` | `/api/room/greeting` |
| `/streaming_url` | `/api/live/streaming_url` |
| `/current_user` | `/api/live/current_user` |
| `/csrf_token` | `/api/csrf_token` |
| `/follow` | `/api/follow/rooms` |

## User

| Method | Path | Input |
|---|---|---|
| POST | `/api/auth/login` | Form `account_id`, `password`, optional captcha |
| POST | `/api/auth/logout` | Auth/session headers; logout upstream |
| GET | `/api/user` | User dari access/refresh token |
| GET | `/api/user/history` | Pagination/search/date/filter seperti recent, dibatasi user |
| GET | `/api/user/likes` | `page`, `perpage` maksimal 20; bookmarks user |
| GET | `/api/user/like` | `data_id`; `{is_liked:boolean}` |
| PUT | `/api/user/like` | Query `liked_id`, `type` (2 untuk bookmark live); user_id selalu dari token |
| DELETE | `/api/user/like` | Query `liked_id`, `type` |
| POST | `/api/user/comment` | Form `comment`, `live_id`, optional `is_delay`; auth/session required |
| POST | `/api/user/follow` | Form `room_id`, `flag`; auth/session required |
| POST | `/api/user/follow/reorder` | Form `room_id` berupa daftar room yang diurutkan sesuai upstream; auth/session required |

## Admin

Semua path diawali `/api/admin`. Selain `update_lives`, diperlukan access/refresh token user admin. Body gambar/setlist/member menggunakan multipart `File`; perubahan yang disebut query tetap memakai query string seperti sumber.

| Method | Path | Fungsi/input |
|---|---|---|
| POST | `/update_lives` | JSON `{api_key,group?,lives}`; Zod validasi, HLS URLs Showroom, publish state |
| GET | `/get_token` | JWT admin singkat untuk channel WebSocket admin |
| GET, POST | `/beta` | Daftar key tanpa keyHash; create JSON `{expiresAt,note?,maxDevices?}` mengembalikan key sekali |
| DELETE | `/beta/:id` | Hapus key |
| GET, POST | `/beta_device` | Daftar perangkat; allow JSON `{fingerprint,note?}` |
| DELETE | `/beta_device/:fingerprint` | Hapus akses perangkat |
| GET | `/banner` | Banner konfigurasi |
| POST | `/update_banner` | JSON daftar group banners sesuai Zod |
| GET | `/missing_jikosokai`, `/missing_jkt48id` | Member dengan data belum lengkap |
| GET | `/setlist`, `/event`, `/stage48`, `/jkt48member`, `/member`, `/fans_list` | Data admin; fans pagination, stage/member optional group |
| GET | `/member/data` | Query `room_id`; data untuk editor |
| GET | `/theater/:id`, `/event/:id` | Data schedule/event untuk editor |
| POST | `/jkt48_sync` | JWT admin; refresh news, schedules/theater/event dan members; hasil per dataset, status 503 jika ada kegagalan |
| POST | `/set_memberdata` | Query `room_id`, `memberDataId`; relasi Showroom/member |
| POST | `/set_graduate` | Query `id`, `value=true|false` |
| POST | `/edit_showroom` | Query `_id`, name, room_id, img, description, generation, group, url |
| POST | `/edit_memberdata`, `/edit/announcement` | Multipart member editor; announcement memakai handler member sesuai sumber |
| POST | `/edit_theater` | JSON `_id` (schedule code), optional `seitansaiIds`, `graduationIds`, `memberIds` arrays |
| POST | `/edit_jkt48event` | JSON `_id` (event ID lama), `id` (ID baru), optional `eventId`, `url`, `memberIds` arrays |
| POST | `/setlist`, `/event` | Multipart `_id?`, id, title, description, poster/banner optional |
| DELETE | `/setlist/:id`, `/event/:id` | Hapus item |
| POST | `/member/jikosokai` | Query `_id`, `jiko` |
| POST | `/member/jkt48id` | Multipart `_id`, `jkt48id[]` berulang |
| POST | `/member/banner`, `/member/image` | Multipart `id`, `banner`/`image` |
| POST | `/input/showroom_log` | Multipart JSON gifts + roomId/liveId/comments/commentsBy/excitement/penontonAktif/dateStart/dateEnd |
| POST | `/stats/rebuild` | Query `group`, `month`, `months` 1..24; rebuild data statistik |
| GET | `/watch/sr_cache` | Cache watch lokal untuk diagnosis |
| POST | `/clear_cache` | Hapus cache respons D1 |

Rebuild statistik besar dapat melewati budget Worker; kerjakan per bulan/grup. Date input log menggunakan format handler asal `D MMMM YYYY hh:mm:ss WIB`. Detail bentuk payload editor dapat dilihat di `src/library/admin/input/` dan schema terkait; API tidak menerima arbitrary Mongo query dari client.

Member editor: multipart `_id`, `name`, optional `slug`, `group`, `stage48`, `idn_username`, `img`/`banner` (URL atau File), `profile_video`, `jikosokai`, `generation`, `birthdate`, repeated `nicknames[]`, repeated `jkt48id[]`, dan repeated `socials[]` (JSON `{title,url}`). Field jumlah histori yang belum tercatat: `live_data.missing.showroom`, `live_data.missing.idn`. File image editor disimpan sebagai URL hasil upload, bukan string object.

Banner update: JSON array `[{group:"jkt48",banners:[{title:"Judul",img:"https://...",url:"https://..."}]}]`. Setlist/event editor juga menerima `title_alt`, `setlist_id`; poster/banner adalah File multipart.

## WebSocket dan Webhook

`/ws?token=<JWT_SECRET-signed-token>` membutuhkan Upgrade WebSocket dan JWT HS256 yang belum expired. Semua pesan aplikasi adalah binary CBOR berisi string. Contoh dengan library `cbor-x`:

```js
socket.send(encode('PING'));
socket.send(encode('listen jkt48 hinatazaka46'));
socket.send(encode('view /member/test-member'));
socket.send(encode('admin ' + adminToken));
const text = decode(new Uint8Array(event.data));
```

Broadcast adalah string JSON `{type:"jkt48",data:[...]}` atau `{type:"admin",data:{type:"user-count",data:{paths,user_count,admin_count}}}`. Client harus reconnect dan mengirim ulang subscriptions setelah putus. State lives tersimpan; attachment subscriptions bertahan selama hibernation.

`POST /webhook/saweria` menerima JSON callback dan header `Saweria-Callback-Signature`. HMAC memakai concatenation `version`, `id`, `amount_raw`, `donator_name`, `donator_email`, dengan `SAWERIA_KEY`. Callback berhasil mengembalikan text `success`; invalid signature 401; duplicate ID idempotent.

## Contoh Request

```sh
curl 'https://worker.example/api/member?group=jkt48'
curl 'https://worker.example/api/now_live?group=all'
curl -H 'x-api-key: <server-key>' 'https://worker.example/api/recent?group=jkt48&page=1'
curl -H 'Origin: https://frontend.example' -H 'Content-Type: application/x-www-form-urlencoded' --data 'account_id=...&password=...' 'https://worker.example/api/auth/login'
curl --get --data-urlencode 'url=https://live.showroom-live.com/path/master.m3u8' 'https://worker.example/api/stream'
```

Error utama: 400 input/URL invalid, 401 token/signature/key invalid, 403 CSRF, 404 data/endpoint/admin hidden/premium live, 409 konflik dokumen, 413 payload besar, 429 rate limit, 502 upstream gagal, 503 binding/config/database/budget belum tersedia, 504 upstream timeout.

## Field tambahan editor dan dependensi

`/api/admin/update_lives` membutuhkan item `lives` sesuai `CombinedLivesListZod`
di `src/library/combinedNowLive.js`. `lives: []` adalah bentuk kosong contoh,
bukan payload live lengkap. Live IDN harus memiliki streaming URL; live Showroom
harus memiliki HLS atau upstream yang dapat mengisinya.

`/api/admin/input/showroom_log` menerima file JSON gifts nonkosong. Format collector
yang didukung memiliki `isFree`, `giftId`, `giftPoints`, `totalQty`, `senders`;
setiap sender memiliki `userId`, `qty`, `timestamp`, `name`, `avatarId`.
Jangan mengunggah file kosong atau data demo ke production. Tanggal memakai
format handler `D MMMM YYYY hh:mm:ss WIB`.

Upload image menggunakan konfigurasi Cloudinary dan R2. YouTube memerlukan
API YouTube; leaderboard/webhook Saweria memerlukan secret Saweria. Profil dan
live Showroom/IDN mengikuti ketersediaan upstream dan data mapping yang ada.
TURN menghasilkan kredensial sementara upstream; docs tidak mengambil atau
menampilkan respons kredensial itu. Sousenkyo tidak memiliki route aktif.

## Referensi request dan output per-route

Contoh mutasi hanya untuk referensi, tidak dijalankan ketika dokumentasi dibuat.
Ganti placeholder dan pilih resource yang benar sebelum menggunakan contoh.
`Origin` contoh mengikuti frontend lokal yang saat ini diizinkan.

### GET /

Author, website, version

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "author": "valzy",
  "website": "https://jkt48connect.com",
  "version": "0.14.2-workers.1"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/worker.js).

### GET /health

Pemeriksaan tabel D1; 200 siap, 503 belum initialized

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/health'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "ok": true,
  "runtime": "cloudflare-workers"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/worker.js).

### GET /api/now_live

`group=jkt48|hinatazaka46|all`, default jkt48; `debug` untuk upstream fallback/debug

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/now_live?group=jkt48'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/next_live

Jadwal live Showroom berikutnya

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/next_live'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/idn_lives

Daftar live IDN yang sesuai member

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/idn_lives'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/idn_user

`user_id`; profil upstream IDN

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/idn_user?user_id=USER_ID'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/watch/:id

`id` adalah room URL key; status, stream, komentar, gifts dan broadcast connection

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/watch/ID'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/watch/:id/idn

`id` adalah username IDN; live detail

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/watch/ID/idn'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/stream

`url` URL HTTPS CDN dalam allowlist; HLS dan binary segment

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/stream?url=https%3A%2F%2Flive.showroom-live.com%2FPATH%2Fmaster.m3u8'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### HEAD /api/stream

`url` URL HTTPS CDN dalam allowlist; HLS dan binary segment

Akses: **Publik**.

```sh
curl -I 'https://api.jkt48connect.app/api/stream?url=https%3A%2F%2Flive.showroom-live.com%2FPATH%2Fmaster.m3u8'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/turn

Request kredensial TURN upstream Cloudflare; status ketersediaan mengikuti upstream

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/turn'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/member

`group`, default jkt48; array profil ringkas

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/member?group=jkt48'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "_id": "b8146b538e3431a3bcd5cb15",
    "jkt48_id": "1",
    "name": "Abigail Rachel",
    "nicknames": [
      "Aralie"
    ],
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
    "img_alt": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
    "url": "abigail-rachel",
    "group": "jkt48",
    "sr_exists": false,
    "is_graduate": false
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/member/:id

`id` slug member atau room URL key; profil lengkap dan ringkasan live

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/member/nama-member'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/member_profile_videos

Video profil member sesuai filter sumber

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/member_profile_videos'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/48/member

`group`; daftar member database 48 group

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/48/member?group=jkt48?group=jkt48'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "id": "b8146b538e3431a3bcd5cb15",
    "name": "Abigail Rachel",
    "is_graduate": false,
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg"
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/birthday

`group`; daftar ulang tahun

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/birthday?group=jkt48'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "name": "Ralyne",
    "birthdate": "2011-10-14T17:00:00.000Z",
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/ralyne_van_irwan.jpg"
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/next_birthday

`group`; ulang tahun berikutnya

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/next_birthday?group=jkt48'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "name": "Ralyne",
    "birthdate": "2011-10-14T17:00:00.000Z",
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/ralyne_van_irwan.jpg",
    "url_key": "ralyne-van-irwan"
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/banner

Banner per grup

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/banner'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/jkt48_youtube

Video terbaru kanal JKT48/JKT48TV; perlu API YouTube

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/jkt48_youtube'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/jkt48v_live

YouTube live kanal `JKT48V_YT_IDS`; perlu API YouTube

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/jkt48v_live'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/leaderboard

Leaderboard Saweria upstream; perlu SAWERIA_KEY

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/leaderboard'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/weekly

`type`, `platform`, `format`, `api_key`; weekly gift/viewers/duration/follower/total-live/no-live/theater sesuai handler

Akses: **API key dalam query**.

```sh
curl 'https://api.jkt48connect.app/api/weekly?type=live&platform=all&format=normal&api_key=SERVER_API_KEY'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/weekly"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/showroom_competition

Ranking kompetisi snapshot dari database

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/showroom_competition'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "event": {
    "event_name": "jkt48_japantvcompetition",
    "event_type": "ranking",
    "show_ranking": 1,
    "started_at": 1772334000,
    "ended_at": 1773500399,
    "image": "https://static.showroom-live.com/image/room/cover/c72dbd1e6eba3f9ed8ca103657bb874a7549ed496347b58f1b2d83b7d53f3b9b_s.png?v=1775099546",
    "event_url": "https://www.showroom-live.com/event/jkt48_japantvcompetition"
  },
  "date": "2026-10-13T11:28:12.048Z",
  "rankings": [
    {
      "rank": 1,
      "point": 11642958,
      "room": {
        "room_id": 461452,
        "image": "https://static.showroom-live.com/image/room/cover/ab71b7dec20fb6950c5afba136808e39486665d861f0592d1457a9682f78736b_m.jpeg?v=1791812669",
        "image_square": "https://static.showroom-live.com/image/room/cover/ab71b7dec20fb6950c5afba136808e39486665d861f0592d1457a9682f78736b_square_m.jpeg?v=1791812669",
        "name": "Anindya /アニンディア（JKT48）",
        "nickname": "Anindya /アニンディア（JKT48）"
      }
    }
  ]
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/showroom_competition_detail

`room_id`; ranking/statistik member; API-key required

Akses: **API key / JWT**.

```sh
curl 'https://api.jkt48connect.app/api/showroom_competition_detail?room_id=ROOM_ID' \
  -H 'x-api-key: SERVER_API_KEY'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/showroom_competition_detail"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/showroom_competition_top_fans

`room_id`; kontribusi fans; API-key required

Akses: **API key / JWT**.

```sh
curl 'https://api.jkt48connect.app/api/showroom_competition_top_fans?room_id=ROOM_ID' \
  -H 'x-api-key: SERVER_API_KEY'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/showroom_competition_top_fans"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/first_data

Timestamp data live pertama

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/first_data'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "date": ""
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/records

Rekor viewers, durasi, gifts Showroom/IDN

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/records'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/screenshots/:id

Screenshot dari log; `DISABLE_SCREENSHOTS`/`HALF_SCREENSHOTS` mempengaruhi hasil

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/screenshots/ID'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/recent

Signature/API-key; pagination/filter di bawah

Akses: **API key / HMAC**.

```sh
curl 'https://api.jkt48connect.app/api/recent?page=1&perpage=10&group=jkt48&type=all&sort=date&order=-1' \
  -H 'x-api-key: SERVER_API_KEY'
```

Respons produksi • 13 Oktober 2026; HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/recent"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/recent/:id

Signature/API-key; lookup `data_id` atau `live_id`

Akses: **API key / HMAC**.

```sh
curl 'https://api.jkt48connect.app/api/recent/ID' \
  -H 'x-api-key: SERVER_API_KEY'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/recent/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/recent/:data_id/gifts

`page`, `perpage`, `s` pencarian fans/gifts

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/gifts?page=1&perpage=10&s='
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/recent/:data_id/stagelist

Riwayat stage users

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/recent/DATA_ID/stagelist'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/sitemap/recent

`year` 2020..tahun berjalan, `image_limit` 1..5; array sitemap entries

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/sitemap/recent?year=2026&image_limit=1'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/next_schedule

Jadwal berikutnya

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/next_schedule'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "id": "7359",
    "date": "2026-10-14T09:30:00.000Z",
    "code": "EX2F12",
    "category": "exclusive",
    "title": "Smiles Come to You",
    "url": "ex2f12-14102026"
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/event

Ringkasan upcoming event/theater

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/event'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "theater": {
    "upcoming": [
      {
        "id": "SH6B09",
        "title": "Pajama Drive",
        "member_count": 0,
        "member": 0,
        "team": "TRAINEE",
        "start_date": "2026-10-16T12:00:00.000Z",
        "end_date": "2026-10-16T14:00:00.000Z",
        "url": "SH6B09",
        "date": "2026-10-16T00:00:00.000Z"
      }
    ],
    "recent": [
      {
        "id": "SH4A49",
        "title": "PASSION 200%",
        "member_count": 0,
        "member": 0,
        "team": "PASSION",
        "start_date": "2026-10-11T12:00:00.000Z",
        "end_date": "2026-10-11T14:00:00.000Z",
        "url": "SH4A49",
        "date": "2026-10-11T00:00:00.000Z"
      }
    ]
  },
  "other_schedule": [
    {
      "id": "7359",
      "date": "2026-10-14T09:30:00.000Z",
      "code": "EX2F12",
      "category": "exclusive",
      "title": "Smiles Come to You",
      "url": "ex2f12-14102026"
    }
  ]
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/theater

`page`, `perpage`, `type`; theater/event schedule

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/theater?page=1&perpage=10&type=show'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "theater": [
    {
      "id": "SHCD32",
      "title": "ITADAKI♥LOVE",
      "member_count": 0,
      "member": 0,
      "team": "LOVE",
      "start_date": "2026-10-18T12:00:00.000Z",
      "end_date": "2026-10-18T14:00:00.000Z",
      "seitansai": [
        {
          "id": "undefined",
          "url_key": ""
        }
      ],
      "url": "SHCD32",
      "date": "2026-10-18T00:00:00.000Z"
    }
  ],
  "page": 1,
  "perpage": 1,
  "total_count": 33
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/theater/:id

ID/code schedule; detail dan member

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/theater/SHCD32'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "shows": [
    {
      "id": "SHCD32",
      "title": "ITADAKI♥LOVE",
      "url": "https://jkt48.com/purchase/schedule/show?code=SHCD32",
      "setlist": {
        "__v": 0,
        "gallery": [],
        "songs": [],
        "_id": "b996e586e7ccb6ce06660436",
        "title": "ITADAKI♥LOVE",
        "id": "itadaki♥love"
      },
      "members": [
        {
          "id": 26,
          "name": "Anindya",
          "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/anindya_ramadhani.jpg",
          "jkt_key": "anindya-ramadhani-26",
          "url_key": "anindya-ramadhani"
        }
      ],
      "seitansai": [
        {
          "jkt_key": "undefined-undefined"
        }
      ],
      "graduation": [],
      "date": "2026-10-18T12:00:00.000Z",
      "team": "LOVE",
      "showroomTheater": {},
      "idnTheater": {}
    }
  ],
  "date": "2026-10-18T00:00:00.000Z"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/jkt48event

`page`, `perpage`; daftar event

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/jkt48event?page=1&perpage=10'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "events": [
    {
      "id": "7314",
      "title": "JKT48 Theater 14th Anniversary “TEAM ON!”",
      "member_count": 0,
      "url": "7314",
      "date": "2026-09-12T08:00:00.000Z"
    }
  ],
  "page": 1,
  "perpage": 1,
  "total_count": 1
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/jkt48event/:id

Detail event dan member

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/jkt48event/ID'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/setlist

Daftar setlist

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/setlist'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
[
  {
    "id": "carameminumramune",
    "title": "Cara Meminum Ramune"
  }
]
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/news

`page`, `perpage`; daftar berita

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "news": [
    {
      "date": "2026-10-09T17:00:00.000Z",
      "title": "Pengumuman Mengenai Pre-Order JKT48 Digital Photobook “Smiles Come to You” dengan bonus Video Call with JKT48",
      "category": "Theater",
      "id": "1876",
      "link": "pengumuman-mengenai-pre-order-jkt48-digital-photobook-smiles-come-to-you-dengan-bonus-video-call-wit",
      "url": "https://jkt48.com/news/pengumuman-mengenai-pre-order-jkt48-digital-photobook-smiles-come-to-you-dengan-bonus-video-call-wit"
    }
  ],
  "page": 1,
  "perpage": 1,
  "total_count": 30
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/news/:id

News ID/link key; detail berita

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/news/1876'
```

Respons produksi • 13 Oktober 2026; HTTP 200. Array dipersingkat ke satu item.

```json
{
  "date": "2026-10-09T17:00:00.000Z",
  "id": "1876",
  "title": "Pengumuman Mengenai Pre-Order JKT48 Digital Photobook “Smiles Come to You” dengan bonus Video Call with JKT48",
  "category": "Theater",
  "url": "https://jkt48.com/news/pengumuman-mengenai-pre-order-jkt48-digital-photobook-smiles-come-to-you-dengan-bonus-video-call-wit",
  "content": "<div>Terima kasih atas dukungannya untuk JKT48.</div><div><br></div><div>Pada tanggal 12 Oktober 2026, JKT48 akan membuka Pre-Order untuk pembelian Digital Photobook “Smiles Come to You” dengan bonus Video Call bersama JKT48.</div><div><br></div><div>Untuk menyambut perilisan single ke-28 JKT48, “Ayo Senyumlah”, JKT48 menghadirkan buku foto digital “Smiles Come to You” yang mengabadikan momen penuh tawa dan senyuman para member JKT48 dalam proses shooting Music Video&nbsp; di Jakarta Car Free Day pada 20 September 2026 lalu. Setiap foto menyimpan cerita tentang kebahagiaan, kehangatan, dan indahnya berbagi senyuman.</div><div><br></div><div>Melalui “Smiles Come to You”, JKT48 berharap senyuman yang dibagikan dapat menyentuh hati, membawa warna dalam keseharian, dan menjadi alasan bagi siapa pun untuk ikut tersenyum. Sebab, kami percaya bahwa dari sebuah senyuman sederhana, dapat tumbuh beribu-ribu kebahagiaan yang berarti.</div><div><br></div><div>Berikut adalah detailnya:</div><div><u… [dipersingkat]",
  "slug": "pengumuman-mengenai-pre-order-jkt48-digital-photobook-smiles-come-to-you-dengan-bonus-video-call-wit"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/profile

`room_id`, optional user auth/session; profil Showroom

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/profile?room_id=ROOM_ID'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/client

User-agent dan status embedded; no-store

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/client'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/my_ip

IP dari `CF-Connecting-IP`

Akses: **Publik**.

```sh
curl 'https://api.jkt48connect.app/api/my_ip'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### POST /api/beta

JSON `fingerprint`, optional `key`; `{enabled:boolean}`

Akses: **Publik**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/beta' \
  -H 'Content-Type: application/json' \
  --data '{"fingerprint": "DEVICE_FINGERPRINT"}'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/index.js).

### GET /api/showroom/user/profile

Query diteruskan ke Showroom `/api/user/profile`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/user/profile'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/status

Query diteruskan ke Showroom `/api/room/status`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/status'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/onlives

Query diteruskan ke Showroom `/api/live/onlives`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/onlives'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/polling

Query diteruskan ke Showroom `/api/live/polling`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/polling'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/summary_ranking

Query diteruskan ke Showroom `/api/live/summary_ranking`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/summary_ranking'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/stage_user_list

Query diteruskan ke Showroom `/api/live/stage_user_list`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/stage_user_list'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/live_info

Query diteruskan ke Showroom `/api/live/live_info`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/live_info'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/telop

Query diteruskan ke Showroom `/api/live/telop`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/telop'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/greeting

Query diteruskan ke Showroom `/api/room/greeting`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/greeting'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/streaming_url

Query diteruskan ke Showroom `/api/live/streaming_url`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/streaming_url'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/current_user

Query diteruskan ke Showroom `/api/live/current_user`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/current_user'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/csrf_token

Query diteruskan ke Showroom `/api/csrf_token`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/csrf_token'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### GET /api/showroom/follow

Query diteruskan ke Showroom `/api/follow/rooms`

Akses: **Session opsional**.

```sh
curl 'https://api.jkt48connect.app/api/showroom/follow'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/showroom.js).

### POST /api/auth/login

Form `account_id`, `password`, optional captcha

Akses: **Publik**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/auth/login' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://localhost:3000' \
  --data-urlencode 'account_id=ACCOUNT_ID' \
  --data-urlencode 'password=PASSWORD'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/auth.js).

### POST /api/auth/logout

Auth/session headers; logout upstream

Akses: **Publik**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/auth/logout'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/auth.js).

### GET /api/user

User dari access/refresh token

Akses: **User token**.

```sh
curl 'https://api.jkt48connect.app/api/user' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Respons produksi • 13 Oktober 2026; HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### GET /api/user/history

Pagination/search/date/filter seperti recent, dibatasi user

Akses: **User token**.

```sh
curl 'https://api.jkt48connect.app/api/user/history?page=1&perpage=10' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/history"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### GET /api/user/likes

`page`, `perpage` maksimal 20; bookmarks user

Akses: **User token**.

```sh
curl 'https://api.jkt48connect.app/api/user/likes?page=1&perpage=10' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/likes"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### GET /api/user/like

`data_id`; `{is_liked:boolean}`

Akses: **User token**.

```sh
curl 'https://api.jkt48connect.app/api/user/like?data_id=DATA_ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/like"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### PUT /api/user/like

Query `liked_id`, `type` (2 untuk bookmark live); user_id selalu dari token

Akses: **User token**.

```sh
curl -X PUT 'https://api.jkt48connect.app/api/user/like?liked_id=DATA_ID&type=2' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/like"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### DELETE /api/user/like

Query `liked_id`, `type`

Akses: **User token**.

```sh
curl -X DELETE 'https://api.jkt48connect.app/api/user/like?liked_id=DATA_ID&type=2' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/like"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### POST /api/user/comment

Form `comment`, `live_id`, optional `is_delay`; auth/session required

Akses: **User token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/user/comment' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://localhost:3000' \
  --data-urlencode 'comment=Komentar demo' \
  --data-urlencode 'live_id=LIVE_ID' \
  --data-urlencode 'is_delay=0'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/comment"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### POST /api/user/follow

Form `room_id`, `flag`; auth/session required

Akses: **User token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/user/follow' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://localhost:3000' \
  --data-urlencode 'room_id=ROOM_ID' \
  --data-urlencode 'flag=1'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/follow"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### POST /api/user/follow/reorder

Form `room_id` berupa daftar room yang diurutkan sesuai upstream; auth/session required

Akses: **User token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/user/follow/reorder' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -H 'Origin: http://localhost:3000' \
  --data-urlencode 'room_id=ROOM_ID_1,ROOM_ID_2'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/user/follow/reorder"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/user.js).

### POST /api/admin/update_lives

JSON `{api_key,group?,lives}`; Zod validasi, HLS URLs Showroom, publish state

Akses: **API key dalam JSON**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/update_lives' \
  -H 'Content-Type: application/json' \
  --data '{"api_key": "SERVER_API_KEY", "group": "jkt48", "lives": []}'
```

Contoh penolakan tanpa autentikasi (berdasarkan handler); HTTP 401. Array dipersingkat ke satu item.

```json
{
  "status": 401,
  "message": "Unauthorized!",
  "path": "/api/admin/update_lives"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/get_token

JWT admin singkat untuk channel WebSocket admin

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/get_token' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/get_token"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/beta

Daftar key tanpa keyHash; create JSON `{expiresAt,note?,maxDevices?}` mengembalikan key sekali

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/beta' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/beta

Daftar key tanpa keyHash; create JSON `{expiresAt,note?,maxDevices?}` mengembalikan key sekali

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/beta' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"expiresAt": "2027-01-01T00:00:00.000Z", "note": "Demo", "maxDevices": 1}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### DELETE /api/admin/beta/:id

Hapus key

Akses: **Admin token**.

```sh
curl -X DELETE 'https://api.jkt48connect.app/api/admin/beta/ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/beta_device

Daftar perangkat; allow JSON `{fingerprint,note?}`

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/beta_device' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta_device"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/beta_device

Daftar perangkat; allow JSON `{fingerprint,note?}`

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/beta_device' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"fingerprint": "DEVICE_FINGERPRINT", "note": "Perangkat demo"}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta_device"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### DELETE /api/admin/beta_device/:fingerprint

Hapus akses perangkat

Akses: **Admin token**.

```sh
curl -X DELETE 'https://api.jkt48connect.app/api/admin/beta_device/DEVICE_FINGERPRINT' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/beta_device/DEVICE_FINGERPRINT"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/banner

Banner konfigurasi

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/banner' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/banner"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/update_banner

JSON daftar group banners sesuai Zod

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/update_banner' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '[{"group": "jkt48", "banners": [{"title": "Judul", "img": "https://example.com/banner.webp", "url": "https://jkt48connect.com"}]}]'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/update_banner"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/missing_jikosokai

Member dengan data belum lengkap

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/missing_jikosokai' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/missing_jikosokai"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/missing_jkt48id

Member dengan data belum lengkap

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/missing_jkt48id' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/missing_jkt48id"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/setlist

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/setlist' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/setlist"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/event

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/event' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/event"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/stage48

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/stage48' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/stage48"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/jkt48member

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/jkt48member' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Respons produksi • 13 Oktober 2026; HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/jkt48member"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/member

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/member' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/fans_list

Data admin; fans pagination, stage/member optional group

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/fans_list' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/fans_list"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/member/data

Query `room_id`; data untuk editor

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/member/data?room_id=ROOM_ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member/data"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/theater/:id

Data schedule/event untuk editor

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/theater/ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/theater/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/event/:id

Data schedule/event untuk editor

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/event/ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/event/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/jkt48_sync

JWT admin; refresh news, schedules/theater/event dan members; hasil per dataset, status 503 jika ada kegagalan

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/jkt48_sync' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/jkt48_sync"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/set_memberdata

Query `room_id`, `memberDataId`; relasi Showroom/member

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/set_memberdata?room_id=ROOM_ID&memberDataId=MEMBER_DOCUMENT_ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/set_memberdata"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/set_graduate

Query `id`, `value=true|false`

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/set_graduate?id=MEMBER_DOCUMENT_ID&value=true' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/set_graduate"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/edit_showroom

Query `_id`, name, room_id, img, description, generation, group, url

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/edit_showroom?_id=SHOWROOM_DOCUMENT_ID&name=Nama+room&room_id=ROOM_ID&group=jkt48&url=ROOM_URL_KEY' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/edit_showroom"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/edit_memberdata

Multipart member editor; announcement memakai handler member sesuai sumber

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/edit_memberdata' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F '_id=MEMBER_DOCUMENT_ID' \
  -F 'name=Nama Member' \
  -F 'slug=nama-member' \
  -F 'group=jkt48' \
  -F 'nicknames[]=Nama' \
  -F 'jkt48id[]=MEMBER_ID' \
  -F 'socials[]={"title":"Instagram","url":"https://instagram.com/example"}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/edit_memberdata"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/edit/announcement

Multipart member editor; announcement memakai handler member sesuai sumber

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/edit/announcement' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F '_id=MEMBER_DOCUMENT_ID' \
  -F 'name=Nama Member' \
  -F 'slug=nama-member' \
  -F 'group=jkt48' \
  -F 'nicknames[]=Nama' \
  -F 'jkt48id[]=MEMBER_ID' \
  -F 'socials[]={"title":"Instagram","url":"https://instagram.com/example"}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/edit/announcement"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/edit_theater

JSON `_id` (schedule code), optional `seitansaiIds`, `graduationIds`, `memberIds` arrays

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/edit_theater' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"_id": "SH2D31", "memberIds": ["MEMBER_ID"], "seitansaiIds": [], "graduationIds": []}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/edit_theater"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/edit_jkt48event

JSON `_id` (event ID lama), `id` (ID baru), optional `eventId`, `url`, `memberIds` arrays

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/edit_jkt48event' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"_id": "OLD_EVENT_ID", "id": "NEW_EVENT_ID", "memberIds": []}'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/edit_jkt48event"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/setlist

Multipart `_id?`, id, title, description, poster/banner optional

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/setlist' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F 'id=setlist-id' \
  -F 'title=Judul' \
  -F 'title_alt=Judul alternatif' \
  -F 'description=Deskripsi' \
  -F 'poster=@poster.png'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/setlist"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/event

Multipart `_id?`, id, title, description, poster/banner optional

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/event' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F 'id=event-id' \
  -F 'title=Judul' \
  -F 'title_alt=Judul alternatif' \
  -F 'description=Deskripsi' \
  -F 'poster=@poster.png'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/event"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### DELETE /api/admin/setlist/:id

Hapus item

Akses: **Admin token**.

```sh
curl -X DELETE 'https://api.jkt48connect.app/api/admin/setlist/ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/setlist/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### DELETE /api/admin/event/:id

Hapus item

Akses: **Admin token**.

```sh
curl -X DELETE 'https://api.jkt48connect.app/api/admin/event/ID' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/event/ID"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/member/jikosokai

Query `_id`, `jiko`

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/member/jikosokai?_id=MEMBER_DOCUMENT_ID&jiko=Teks+jikosokai' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member/jikosokai"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/member/jkt48id

Multipart `_id`, `jkt48id[]` berulang

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/member/jkt48id' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F '_id=MEMBER_DOCUMENT_ID' \
  -F 'jkt48id[]=MEMBER_ID'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member/jkt48id"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/member/banner

Multipart `id`, `banner`/`image`

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/member/banner' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F 'id=MEMBER_DOCUMENT_ID' \
  -F 'banner=@banner.png'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member/banner"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/member/image

Multipart `id`, `banner`/`image`

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/member/image' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F 'id=MEMBER_DOCUMENT_ID' \
  -F 'image=@image.png'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/member/image"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/input/showroom_log

Multipart JSON gifts + roomId/liveId/comments/commentsBy/excitement/penontonAktif/dateStart/dateEnd

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/input/showroom_log' \
  -H 'Authorization: Bearer ACCESS_TOKEN' \
  -H 'Origin: http://localhost:3000' \
  -F 'gifts=@gifts.json' \
  -F 'roomId=ROOM_ID' \
  -F 'liveId=LIVE_ID' \
  -F 'comments=0' \
  -F 'commentsBy=0' \
  -F 'excitement=0' \
  -F 'penontonAktif=0' \
  -F 'dateStart=13 October 2026 07:00:00 WIB' \
  -F 'dateEnd=13 October 2026 08:00:00 WIB'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/input/showroom_log"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/stats/rebuild

Query `group`, `month`, `months` 1..24; rebuild data statistik

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/stats/rebuild?group=jkt48&month=2026-10&months=1' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/stats/rebuild"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /api/admin/watch/sr_cache

Cache watch lokal untuk diagnosis

Akses: **Admin token**.

```sh
curl 'https://api.jkt48connect.app/api/admin/watch/sr_cache' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/watch/sr_cache"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### POST /api/admin/clear_cache

Hapus cache respons D1

Akses: **Admin token**.

```sh
curl -X POST 'https://api.jkt48connect.app/api/admin/clear_cache' \
  -H 'Authorization: Bearer ACCESS_TOKEN'
```

Contoh penolakan tanpa hak admin (berdasarkan handler); HTTP 404. Array dipersingkat ke satu item.

```json
{
  "status": 404,
  "message": "Endpoint not found!",
  "path": "/api/admin/clear_cache"
}
```

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/routes/admin.js).

### GET /ws

Upgrade WebSocket, token JWT HS256. Pesan binary CBOR.

Akses: **JWT WebSocket**.

```sh
curl 'https://api.jkt48connect.app/ws'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/live-hub.js).

### POST /webhook/saweria

Callback Saweria dengan header Saweria-Callback-Signature dan JSON callback resmi.

Akses: **HMAC Saweria**.

```sh
curl -X POST 'https://api.jkt48connect.app/webhook/saweria' \
  -H 'Content-Type: application/json' \
  -H 'Saweria-Callback-Signature: SIGNATURE_HEX' \
  --data '{"version": "VERSION", "id": "DONATION_ID", "amount_raw": 10000, "donator_name": "Nama demo", "donator_email": "demo@example.com"}'
```

Belum diuji: output mengikuti handler atau upstream; lihat source.

[Implementasi](https://github.com/Valzyys/jkt48showroom-api/blob/main/workers/src/webhooks/index.js).


## Contoh sukses endpoint privat dari source

Contoh berikut memakai placeholder dan tidak dieksekusi di produksi. Login dapat
menyertakan field tambahan pada object user; hanya field inti ditunjukkan.

### POST /api/auth/login

```json
{
  "access_token": "ACCESS_TOKEN",
  "refresh_token": "REFRESH_TOKEN",
  "user": {
    "id": "USER_ID",
    "name": "Nama demo",
    "account_id": "ACCOUNT_ID"
  }
}
```

### POST /api/auth/logout

```json
{
  "success": true
}
```

### POST /api/beta

```json
{
  "enabled": false
}
```

### PUT /api/user/like

```json
{
  "status": 200,
  "message": "Success!"
}
```

### DELETE /api/user/like

```json
{
  "status": 200,
  "message": "Success!"
}
```

### GET /api/user/like

```json
{
  "is_liked": false
}
```

### POST /api/user/follow

```json
{
  "ok": true
}
```

### POST /api/user/follow/reorder

```json
{
  "ok": true
}
```

### POST /api/admin/update_lives

```json
{
  "ok": true
}
```

### POST /api/admin/beta_device

```json
{
  "enabled": true,
  "fingerprint": "DEVICE_FINGERPRINT"
}
```

### DELETE /api/admin/beta_device/:fingerprint

```json
{
  "enabled": false
}
```

### DELETE /api/admin/beta/:id

```json
{
  "deleted": true
}
```

### POST /api/admin/clear_cache

```json
{
  "code": 200,
  "message": "Success!"
}
```

### DELETE /api/admin/event/:id

```json
{
  "success": true
}
```

### DELETE /api/admin/setlist/:id

```json
{
  "success": true
}
```

### POST /api/admin/setlist

```json
{
  "code": 200,
  "message": "Success!"
}
```

### POST /api/admin/event

```json
{
  "code": 200,
  "message": "Success!"
}
```

### POST /api/admin/input/showroom_log

```json
{
  "data_id": "DATA_ID",
  "status": 200
}
```

### POST /api/admin/member/image

```json
{
  "url": "https://example.com/image.webp",
  "status": 200
}
```

### POST /api/admin/member/banner

```json
{
  "url": "https://example.com/banner.webp",
  "status": 200
}
```

### POST /api/admin/edit_theater

```json
{
  "birthday_member": [],
  "graduation_member": [],
  "jkt48_member": [],
  "is_birthday": false
}
```

### POST /api/admin/set_memberdata

```json
{
  "code": 200,
  "message": "Request success!"
}
```

### POST /api/admin/set_graduate

```json
{
  "code": 200,
  "message": "Request success!"
}
```

### POST /api/admin/edit_showroom

```json
{
  "code": 200,
  "message": "Request success!"
}
```

### POST /api/admin/member/jikosokai

```json
{
  "code": 200,
  "message": "Request success!"
}
```

### POST /api/admin/member/jkt48id

```json
{
  "code": 200,
  "message": "Request success!"
}
```


## Control admin & media

- **GET /media/jkt48/:path**: Gambar JKT48 dilayani dari R2. Cache miss diunduh melalui scraper privat dan disimpan sebelum respons.
- **HEAD /media/jkt48/:path**: Metadata gambar R2; mendukung ETag dan If-None-Match.
- **GET /control/admin**: Halaman login control admin.
- **POST /control/api/login**: JSON email dan password admin. Session menggunakan cookie HttpOnly, Secure, SameSite=Strict.
- **POST /control/api/logout**: Keluar dan hapus cookie sesi.
- **GET /control/api/session**: Identitas admin pada sesi aktif.
- **GET /control/api/settings**: Daftar pengaturan; secret dimasker.
- **PUT /control/api/settings**: JSON changes berisi name:value; null mengembalikan nilai deployment. Secret terenkripsi dalam D1.
- **GET /control/api/key**: Tampilkan API key aktif hanya setelah admin login.
- **POST /control/api/key/new**: Buat key acak baru; belum aktif hingga disimpan.
- **GET /control/api/status**: Jumlah koleksi, cache dan gambar R2.
- **POST /control/api/sync**: JSON dataset: news, schedules, members atau all. Memaksa sinkronisasi.
- **POST /control/api/cache/clear**: Hapus cache API; data dan gambar dipertahankan.
- **POST /control/api/media/warm**: Unduh dan simpan maksimal 20 gambar member yang belum ada di R2 per batch.

Pengaturan control memerlukan cookie sesi admin dan Origin yang sama untuk mutasi.
Perubahan berlaku pada request berikutnya, paling lambat 10 detik di instance lain.
Secret kosong tidak menimpa nilai aktif. Perubahan API key/auth secret dapat membatalkan
key/token lama. Secret login control dikelola melalui Cloudflare, bukan form pengaturan.


## Collector otomatis, screenshot dan video replay

Collector VPS mendeteksi live Showroom dan IDN setiap 30 detik. Frame JPEG 640px
setiap 60 detik dikirim ke Worker lalu R2. Video dialirkan FFmpeg sebagai fragmented
MP4 melalui RAM; multipart sekitar 5 MiB langsung diunggah ke R2. Tidak ada file
video yang disimpan di disk VPS. Codec-copy menghindari encoding ulang video.

`/api/recent` hanya menampilkan sesi selesai. `/api/recent/:id` memuat:
- `capture.status`: live atau completed.
- `capture.observed_since`: awal collector memantau sesi; bagian sebelumnya tidak tersedia.
- `capture.gifts_status`: partial/unavailable; gift yang terlewat tidak diperkirakan.
- `point_unit`: showroom_points atau idn_gold, bukan rupiah.
- `recordings`: array URL MP4 R2, bytes, run dan partial.
- `live_info.screenshot`: base_url, format dan list ID frame.

`/api/screenshots/:id` mengembalikan metadata frame. URL gambar dibentuk dengan
`${base_url}/${frame}.${format}`. MP4 mendukung Range dan dapat diputar setelah
multipart selesai. Jika koneksi rekaman terputus, hasilnya beberapa file parsial.
Batas observer chat IDN, video on/off, interval dan ukuran ada pada grup Live collector
pada `/control/admin`. Status panel menampilkan sesi dan tautan replay.

Gift Showroom berasal dari event bcsvr WebSocket; gift_list memasok nama, gambar,
point dan status free. Gift IDN berasal dari event gift yang diterima chat pada situs
resmi; Gold yang terlihat dicatat, bukan bukti transaksi atau nilai IDN Points streamer.
Tidak ada proses pengiriman atau pembelian gift. Gift sejak sebelum collector aktif
atau ketika koneksi putus tidak dapat dijamin lengkap. Data digabung per user/gift/menit.

Endpoint `/internal/collector/*` khusus collector dengan `Authorization: Bearer
COLLECTOR_TOKEN`; token tidak ditampilkan di docs. Metadata/statistik di-checkpoint
ke SQLite VPS dan disimpan ke D1. Media permanen berada di R2. Upload multipart yang
terbengkalai selama 24 jam dibatalkan, tanpa menghapus replay selesai.

## Pemantauan VPS dari admin

Di `/control/admin`, panel **Pemantauan collector VPS** diperbarui setiap 15 detik saat tab aktif. Heartbeat menunjukkan proses collector masih melapor, PID, uptime, discovery Showroom/IDN dan waktu sinkron terakhir. Heartbeat terlambat ditandai; ini bukan pemeriksaan langsung seluruh layanan systemd VPS.

Setiap sesi menampilkan status rekaman, jumlah MiB dan part yang sudah dikirim ke R2, waktu upload terakhir, screenshot terakhir beserta tautannya, jumlah kegagalan, serta status sinkron arsip. Video berstatus menunggu sebelum part pertama terkirim; upload yang berhenti berkembang ditandai. Rekaman yang dilarang sumber atau tidak mempunyai stream ditampilkan sebagai tidak tersedia.

Recent hanya memuat live yang selesai. Panel menunjukkan jumlah recent selesai, live selesai terakhir, antrean publikasi dan kegagalan sinkron. Sesi aktif yang sudah tersinkron tetap menunggu live selesai; jumlah recent nol tidak berarti collector rusak.

## Memutar replay

Tautan video di admin membuka `/replay/:data_id/:run`, dengan kontrol Play, seek, loading, coba lagi dan unduh MP4. URL MP4 tetap dapat digunakan untuk video player atau HTTP Range. Navigasi browser langsung ke MP4 diarahkan ke halaman replay. Halaman player memakai versi URL media untuk menghindari cache header file lama.

Collector menunda penulisan header MP4 sampai konfigurasi AAC tersedia (`delay_moov`); audio dan video tetap disalin tanpa encode ulang. File lama yang kehilangan konfigurasi AAC diperbaiki oleh Worker langsung dari R2 ke R2 melalui buffer RAM, dengan isi paket media tetap dipertahankan. Endpoint perbaikan membutuhkan token collector privat.

## Jumlah pengiriman gift dan autentikasi IDN

Pada `/api/recent/:data_id`, setiap item `live_info.gift.list` memuat:

```json
{"id":"rose","name":"Rose","num":13,"send_count":3,"user_count":2,"count_source":"observed_events"}
```

`num` adalah jumlah unit gift, `send_count` adalah jumlah event kiriman, dan
`user_count` adalah jumlah pengirim unik untuk jenis gift tersebut. Nilai tersebut
dihitung dari seluruh log sesi, bukan hanya halaman pertama. Untuk data lama yang
sudah digabung tanpa jumlah event, `send_count` bernilai `null`. Data yang terlewat
sebelum observer aktif tidak ditambahkan. `fans` IDN berisi peringkat Gold dari
pengiriman yang teramati, dengan `source: observed_chat`.

Admin dapat menyimpan `IDN_REFRESH_TOKEN` dan `IDN_COGNITO_CLIENT_ID` pada grup
IDN authentication. Worker menggunakan Cognito REFRESH_TOKEN_AUTH, menyimpan JWT
di memori sampai mendekati kedaluwarsa, dan memberikan JWT hanya melalui konfigurasi
collector yang diautentikasi. Refresh token tidak dikirim ke browser collector
atau endpoint publik. JWT dipakai pada permintaan chat IDN, bukan untuk gift
pembelian. Observer membaca format chat IRC dan Amazon IVS.

Rekaman baru memuat `duration_ms`, durasi media yang benar-benar ditulis FFmpeg.
Durasi live dan durasi rekaman dapat berbeda jika collector mulai terlambat atau
koneksi terputus; `partial` tetap menandai hasil parsial.

## Memasang rekaman dan gambar gift

`recordings[].url` merupakan MP4 publik tanpa API key, dengan dukungan Range dan CORS.
`recordings[].stream_url` merupakan playlist HLS VOD dari rekaman yang sama di R2,
dapat dipasang pada player yang mendukung HLS (Safari, VLC, hls.js, ExoPlayer).
Playlist memakai byte range ke file R2, sehingga tidak membuat salinan video baru.
`recordings[].player_url` merupakan player yang dapat dipasang melalui iframe:

```html
<iframe src="https://api.jkt48connect.app/replay/DATA_ID/RUN"
        allow="autoplay; fullscreen" allowfullscreen width="800" height="600"></iframe>
```

Untuk player HLS, gunakan `stream_url` sebagai sumber dengan tipe
`application/vnd.apple.mpegurl`. Untuk player MP4 yang mendukung fragmented MP4:

```html
<video controls playsinline crossorigin="anonymous" src="URL_DARI_recordings.url"></video>
```

`live_info.gift.list[].img` adalah URL gambar gift publik dari R2.

```html
<img src="URL_DARI_gift.img" alt="NAMA_GIFT" width="64" height="64">
```

Gambar IDN diambil dari katalog resmi menggunakan JWT; katalog diperbarui setiap
jam. Media diunduh ke R2 ketika pertama kali dibuka, kemudian dilayani dari R2.
Jika gambar gift IDN sudah tidak tersedia di katalog, `image_available` bernilai
false dan `img` kosong; gambar jenis gift lain tidak dipakai sebagai pengganti.

## Gambar leaderboard recent

`/api/recent` dan `/api/recent/:data_id` menyertakan `leaderboard_image`:

```json
{
  "status": "ready",
  "url": "https://api.jkt48connect.app/media/leaderboards/v2/DATA_ID/123.png",
  "width": 1800,
  "height": 2400,
  "format": "png",
  "updated_at": "2026-10-14T00:00:00.000Z"
}
```

Status `pending` berarti gambar belum selesai dibuat; `failed` berarti render akan
mencoba ulang. URL bernilai null sampai gambar versi data terbaru tersedia.
PNG bersifat publik tanpa API key, mendukung CORS, dan disimpan di R2.

```html
<img src="URL_DARI_leaderboard_image.url" alt="Rekap live dan leaderboard gift">
```

Desain memuat foto member, waktu WIB, durasi, viewers, gift/points sesuai platform,
5 pengirim gift teratas, 3 jenis gift, serta maksimal 3 screenshot asli. Data parsial
diberi keterangan. Peringkat memakai total gift yang tercatat, bukan perkiraan
pendapatan. Gambar tidak mencantumkan URL situs atau nama jkt48connect.

Renderer VPS terpisah berjalan setiap sekitar 60 detik melalui
`jkt48-leaderboard.timer`, maksimal 10 gambar per putaran. PNG dikirim dari memori
ke Worker/R2. Tidak mengubah proses perekaman video. Data recent lama juga masuk
antrean otomatis. Lease render mencegah dua proses mengerjakan kartu yang sama;
perubahan versi data membatalkan hasil lama dan mengantrekan versi baru.

Frame gelap atau hampir kosong disaring sebelum dipilih untuk kartu; jumlah
screenshot pada statistik tetap mengikuti arsip asli.

## Rekaman satu sesi dan penanganan gangguan

Detail recent menyertakan `recording_session.stream_url`: satu playlist HLS yang
menggabungkan semua potongan rekaman yang memiliki indeks. Gunakan URL sesi ini
untuk memutar seluruh bagian yang tersimpan, bukan hanya `recordings[0]`.

`recording_session.status` adalah `recording`, `complete`, `partial`, atau
`unverified`. Durasi live, durasi playback seluruh potongan, serta estimasi cakupan
waktu dibedakan. Potongan yang bertumpang tindih setelah reconnect tidak dihitung
dua kali dalam cakupan waktu. Untuk arsip lama tanpa referensi waktu, API tidak
mengklaim cakupan penuh. `minimum_missing_duration_ms` adalah batas minimum durasi
yang belum tercakup ketika durasi media diketahui; bukan tebak lokasi kejadian.

Upload memakai ulang multipart yang sama ketika Worker sementara gagal. Metadata
upload di-checkpoint ke SQLite dan part tersimpan tetap di R2. Finalisasi dapat
diulang dengan aman setelah respons jaringan hilang. Setelah proses terhenti,
part yang sudah terkirim dipulihkan; bagian terputus diberi `interrupted: true`,
`duration_ms: null`, dan `index_available: false` jika indeks akhirnya tidak ada.
Bagian tersebut tersedia melalui MP4/player; API tidak memberikan playlist HLS
palsu. Tidak ada cara mengembalikan part yang dahulu sudah dibatalkan/dihapus.

Semua live yang terdeteksi langsung dijadwalkan untuk rekaman, tanpa dibuang karena
batas enam sesi. Pemeriksaan izin dan media berjalan per sesi. Observer chat IDN
memiliki batas sumber daya terpisah 1–16 halaman; jika kapasitas terpakai,
`capture.chat_status` menunjukkan antrean. Polling default 15 detik. Live yang
hilang dari listing diperiksa lagi; media yang masih bergerak tidak langsung
dihentikan. Penutupan chat saat sesi selesai ditandai `closed`, bukan error aktif.
