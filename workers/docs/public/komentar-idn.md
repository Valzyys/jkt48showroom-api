# Komentar IDN realtime

Baca komentar live IDN melalui relay bersama. Ambil `data_id` dari item bertipe `idn` di `/api/live-notifications`. Gunakan identifier lengkap `idn-…`, bukan `room_id` Showroom atau username member. Setiap siaran IDN mempunyai identifier tersendiri.

## Snapshot komentar

```sh
curl 'https://api.jkt48connect.app/api/idn-comments/idn-9366d38038bb64ea459f9ce1' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

GET mengembalikan maksimal 100 komentar terbaru yang diamati. Tambahkan `?after=42` untuk mengambil `sequence > 42`. Membaca snapshot tidak membuat hit baru ke IDN.

## WebSocket realtime

Hubungkan ke `wss://api.jkt48connect.app/api/idn-comments/{data_id}/stream` menggunakan header `X-API-Key`. Upgrade yang berhasil mengembalikan HTTP 101.

```json
{
  "type": "comments",
  "room_id": 1029144272,
  "data_id": "idn-9366d38038bb64ea459f9ce1",
  "live_id": "hai-261029165448",
  "source": "idn-irc-websocket",
  "status": "connected",
  "partial": true,
  "cursor": 43,
  "gap": false,
  "dropped": 0,
  "updated_at": "2026-10-29T10:00:00.250Z",
  "comments": [{
    "id": "example-provider-message-id",
    "sequence": 43,
    "user": {"id": "example-user-id", "name": "Penonton", "avatar_url": null},
    "comment": "Halo!",
    "observed_at": "2026-10-29T10:00:00.000Z",
    "source_time": "2026-10-29T09:59:59.900Z"
  }]
}
```

Contoh di atas menunjukkan format, bukan klaim isi komentar nyata. `avatar_url` berasal dari profil pada event IDN dan bisa `null`. `source_time` hanya disertakan bila timestamp sumber tersedia dan valid; `observed_at` adalah saat relay menerima event. Render komentar sebagai teks biasa.

## Contoh Python

```python
import asyncio, json, os
import websockets

async def main():
    data_id = "idn-9366d38038bb64ea459f9ce1"
    cursor = None
    backoff = 1
    while True:
        url = f"wss://api.jkt48connect.app/api/idn-comments/{data_id}/stream"
        if cursor is not None:
            url += f"?after={cursor}"
        try:
            async with websockets.connect(url, additional_headers={
                "X-API-Key": os.environ["JKT48CONNECT_API_KEY"]
            }, ping_interval=20, ping_timeout=20) as ws:
                backoff = 1
                async for raw in ws:
                    if raw == "PONG":
                        continue
                    event = json.loads(raw)
                    if event.get("gap"):
                        print("Cursor sudah di luar buffer; ada komentar yang terlewat.")
                    for item in event.get("comments", []):
                        if cursor is None or item["sequence"] > cursor:
                            print(item["user"]["name"], ":", item["comment"])
                    cursor = event["cursor"]
        except (OSError, websockets.WebSocketException):
            await asyncio.sleep(backoff)
            backoff = min(30, backoff * 2)

asyncio.run(main())
```

Instal `websockets` dan simpan key di environment server. Browser WebSocket tidak mendukung header kustom; gunakan backend perantara, jangan menaruh private API key di bundle frontend.

## Status dan batasan

- Pesan `snapshot`, `comments`, `status` mengikuti pola komentar Showroom.
- Status `connecting`, `connected`, `reconnecting`, `ended` berasal dari relay. `unavailable` berarti belum ada pengamatan atau heartbeat lebih dari 45 detik; bukan bukti member sudah endlive.
- Batch burst sekitar 250 ms, ditambah jaringan. Deteksi siaran memakai state collector lokal setiap 2 detik. Tidak ada janji latensi nol atau semua komentar sejak awal siaran.
- Relay membaca chat publik IDN; tidak mengirim komentar penonton. Metadata atau autentikasi sumber yang ditolak akan ditampilkan sebagai reconnect/unavailable.
- `partial: true` selalu digunakan. Buffer publik maksimal 100 komentar, antrean relay maksimal 2.000 per live. `gap` menunjukkan cursor di luar buffer; `dropped` menghitung komentar yang terbuang saat antrean penuh.
- Maksimal 4 koneksi per key per live dan 64 total per live. Reconnect diperlukan setiap 15 menit untuk memperbarui autentikasi. Koneksi/reconnect dihitung satu request API; setiap komentar bukan request tersendiri.
- Buffer dibersihkan setelah 24 jam tanpa pembaruan dan tanpa klien; fitur ini bukan arsip komentar permanen.
