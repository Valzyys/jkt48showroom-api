# Komentar Showroom realtime

Baca komentar live Showroom melalui koneksi WebSocket bersama, tanpa login Showroom. Berlaku untuk room JKT48 yang terdeteksi oleh collector. Ambil `room_id` dari `/api/now_live?group=jkt48` dengan `type=showroom`.

## Komentar terakhir

```sh
curl 'https://api.jkt48connect.app/api/showroom-comments/572591' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Endpoint GET ini membaca maksimal 100 komentar terbaru yang telah diamati. Tidak melakukan hit baru ke Showroom. Tambahkan `?after=42` untuk hanya mengambil komentar dengan `sequence > 42`.

## Koneksi realtime

Hubungkan ke `wss://api.jkt48connect.app/api/showroom-comments/572591/stream` dengan header `X-API-Key`. Respons upgrade adalah HTTP 101. Pesan menggunakan JSON teks biasa, bukan CBOR.

```json
{
  "type": "comments",
  "room_id": 572591,
  "data_id": "sr-572591-23571304",
  "status": "connected",
  "source": "showroom-websocket",
  "partial": true,
  "updated_at": "2026-10-29T01:00:00.250Z",
  "cursor": 43,
  "gap": false,
  "dropped": 0,
  "comments": [{
    "id": "sample-event-id",
    "sequence": 43,
    "user": {"id": "12345", "name": "Nama penonton", "avatar_id": 1, "avatar_url": "https://image.showroom-cdn.com/showroom-prod/image/avatar/1.png"},
    "comment": "Halo!",
    "observed_at": "2026-10-29T01:00:00.000Z"
  }]
}
```

Contoh di atas adalah ilustrasi. `observed_at` adalah waktu relay menerima komentar, bukan waktu resmi ketika penonton mengirimnya.

`user.avatar_url` adalah URL PNG avatar karakter Showroom yang bisa langsung digunakan pada `<img>`, bukan foto profil unggahan user. URL dihitung dari ID avatar yang teramati, tanpa mengambil profil user per komentar. Jika ID belum diketahui, `avatar_id` dan `avatar_url` bernilai `null`. Snapshot komentar lama yang memiliki ID juga mendapatkan URL ini.

## Contoh Python dengan reconnect

```sh
pip install websockets
export JKT48CONNECT_API_KEY='KEY_ANDA'
```

```python
import asyncio, json, os
import websockets

async def main():
    room_id = 572591
    cursor = None
    delay = 1
    while True:
        url = f"wss://api.jkt48connect.app/api/showroom-comments/{room_id}/stream"
        if cursor is not None:
            url += f"?after={cursor}"
        try:
            async with websockets.connect(url, additional_headers={
                "X-API-Key": os.environ["JKT48CONNECT_API_KEY"]
            }, ping_interval=20, ping_timeout=20) as ws:
                delay = 1
                async for text in ws:
                    event = json.loads(text)
                    if event.get("gap"):
                        print("Sebagian komentar sudah di luar buffer; jangan anggap lengkap.")
                    for comment in event.get("comments", []):
                        if cursor is None or comment["sequence"] > cursor:
                            print(comment["user"]["name"], ":", comment["comment"])
                    cursor = event["cursor"]
        except (OSError, websockets.WebSocketException):
            await asyncio.sleep(delay)
            delay = min(30, delay * 2)

asyncio.run(main())
```

## Status dan batasan

- `snapshot`: pesan pertama, berisi komentar yang masih tersedia setelah cursor.
- `comments`: komentar baru; satu pesan dapat berisi beberapa komentar.
- `status`: heartbeat atau perubahan koneksi. Daftar komentarnya kosong.
- `connecting`, `connected`, `reconnecting`: keadaan koneksi relay ke Showroom.
- `ended`: sesi selesai menurut collector. Koneksi dapat tetap dipakai untuk live berikutnya di room yang sama.
- `unavailable`: belum ada pengamatan atau relay tidak memperbarui status selama lebih dari 45 detik. Ini bukan bukti bahwa member sudah endlive.

Relay mengirim burst komentar dengan jeda batching sekitar 250 ms, ditambah perjalanan jaringan. Deteksi live baru tetap mengikuti collector. Tidak ada jaminan latensi nol maupun pemulihan komentar yang terlewat saat sumber terputus.

`partial: true` berarti ini data pengamatan, bukan arsip seluruh komentar sejak awal live. Buffer dibatasi 100 komentar per room dan dibersihkan setelah 24 jam tanpa pembaruan/klien. `gap: true` menunjukkan cursor di luar buffer; `dropped` menghitung komentar yang terlewat ketika antrean internal relay penuh. Render teks sebagai plain text, jangan sebagai HTML.

Koneksi dibatasi maksimal 4 per API key per room dan 64 total per room. Autentikasi diperbarui dengan reconnect setiap 15 menit. Satu koneksi/reconnect dihitung satu request API; setiap komentar tidak mengurangi kuota request. Jika reconnect gagal dengan 401/429, periksa key atau kuota dan hindari retry cepat.

Browser WebSocket tidak mendukung header kustom. Gunakan backend aplikasi sebagai perantara agar API key tetap tersimpan di server. Hindari menaruh key pribadi dalam bundle frontend atau URL publik. Koneksi bersifat baca saja; fitur ini tidak mengirim komentar ke Showroom.
