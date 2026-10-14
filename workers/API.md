# Referensi API

UI publik: [JKT48 Connect API Docs](https://api.jkt48connect.app/docs).
Panduan lengkap dan contoh: [docs/guide.md](docs/guide.md).

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
