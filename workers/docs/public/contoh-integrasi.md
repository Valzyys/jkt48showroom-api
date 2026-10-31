# Contoh integrasi

Contoh di halaman ini siap dipakai di produksi: client dengan retry dan pembacaan kuota, backend proxy dengan cache, request paralel di Python, proxy di Cloudflare Workers, dan bot notifikasi live. Semua memakai key `jkc_…` dari [dashboard](/dashboard/keys) yang disimpan di environment variable `JKT48CONNECT_API_KEY`.

> [!TIP]
> Mulai dari client TypeScript di bawah. Contoh lain di halaman ini membangun di atas pola yang sama: satu fungsi request, retry terbatas, dan kuota dibaca dari header.

## Client TypeScript dengan retry dan kuota

Client ini mengirim key lewat header, membatasi waktu tiap request, mengulang request saat `5xx` atau jaringan gagal dengan backoff eksponensial, dan berhenti dengan error yang jelas saat `401` atau `429`.

```ts
// jkt48connect.ts
const BASE = 'https://api.jkt48connect.app';
const KEY_FORMAT = /^jkc_[a-f0-9]{40}$/;

export type Quota = { limit: number; remaining: number; resetsAt: Date; period: string };

export class JKT48ConnectError extends Error {
  constructor(public status: number, message: string, public body: unknown) {
    super(message);
  }
}

export class JKT48Connect {
  quota: Quota | null = null;

  constructor(
    private key = process.env.JKT48CONNECT_API_KEY ?? '',
    private opts = { timeoutMs: 15_000, retries: 3 },
  ) {
    if (!KEY_FORMAT.test(key)) throw new Error('API key harus jkc_ + 40 karakter hex');
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
      try {
        const res = await fetch(url, {
          headers: { 'X-API-Key': this.key, Accept: 'application/json' },
          signal: controller.signal,
        });
        this.readQuota(res.headers);
        const body = await res.json().catch(() => null);

        if (res.ok) return body as T;
        // 401/403/404/429 tidak akan berubah dengan retry.
        if (res.status < 500) throw new JKT48ConnectError(res.status, body?.message ?? res.statusText, body);
        if (attempt >= this.opts.retries) throw new JKT48ConnectError(res.status, 'Server sibuk', body);
      } catch (error) {
        if (error instanceof JKT48ConnectError || attempt >= this.opts.retries) throw error;
      } finally {
        clearTimeout(timer);
      }
      // 0.5 s, 1 s, 2 s + jitter
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt + Math.random() * 250));
    }
  }

  private readQuota(h: Headers) {
    const limit = h.get('X-RateLimit-Limit');
    if (!limit) return;
    this.quota = {
      limit: Number(limit),
      remaining: Number(h.get('X-RateLimit-Remaining')),
      resetsAt: new Date(Number(h.get('X-RateLimit-Reset')) * 1000),
      period: h.get('X-Quota-Period') ?? '',
    };
  }
}
```

Pemakaian:

```ts
import { JKT48Connect, JKT48ConnectError } from './jkt48connect';

const api = new JKT48Connect();
try {
  const { news } = await api.get<{ news: { id: string; title: string }[] }>('/api/news', { page: 1, perpage: 5 });
  news.forEach((n) => console.log(n.title));
  console.log(`Sisa kuota ${api.quota?.remaining}/${api.quota?.limit}`);
} catch (error) {
  if (error instanceof JKT48ConnectError && error.status === 429) {
    console.error('Kuota habis, reset pada', (error.body as { resets_at: string }).resets_at);
  } else throw error;
}
```

## Backend proxy Express dengan cache

Frontend memanggil backend-mu, bukan JKT48Connect langsung, sehingga key tidak pernah sampai ke browser. Cache singkat di memori menghemat kuota: seratus pengunjung dalam satu menit hanya memakai satu request.

```js
// server.mjs: node server.mjs
import express from 'express';

const BASE = 'https://api.jkt48connect.app';
const KEY = process.env.JKT48CONNECT_API_KEY;
const ALLOWED = new Set(['/api/news', '/api/member', '/api/theater', '/api/now_live', '/api/recent']);
const TTL = { '/api/now_live': 20_000, default: 60_000 };
const cache = new Map(); // url -> { at, status, body }
const inflight = new Map(); // url -> Promise, satu request untuk banyak pemanggil

const app = express();

app.get('/jkt48/*', async (req, res) => {
  const path = '/api/' + req.params[0];
  if (![...ALLOWED].some((p) => path === p || path.startsWith(p + '/')))
    return res.status(404).json({ message: 'Endpoint tidak diizinkan' });

  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, String(v));
  const keyOf = url.toString();
  const ttl = TTL[path] ?? TTL.default;

  const hit = cache.get(keyOf);
  if (hit && Date.now() - hit.at < ttl) return res.status(hit.status).set('X-Cache', 'HIT').send(hit.body);

  if (!inflight.has(keyOf)) {
    inflight.set(
      keyOf,
      fetch(url, { headers: { 'X-API-Key': KEY } })
        .then(async (r) => ({ status: r.status, body: await r.text(), remaining: r.headers.get('X-RateLimit-Remaining') }))
        .finally(() => inflight.delete(keyOf)),
    );
  }
  try {
    const result = await inflight.get(keyOf);
    if (result.status === 200) cache.set(keyOf, { at: Date.now(), ...result });
    if (Number(result.remaining) < 100) console.warn('Kuota JKT48Connect hampir habis:', result.remaining);
    res.status(result.status).type('json').set('X-Cache', 'MISS').send(result.body);
  } catch {
    // Saat upstream gagal, sajikan data lama daripada error.
    if (hit) return res.status(hit.status).set('X-Cache', 'STALE').send(hit.body);
    res.status(502).json({ message: 'JKT48Connect tidak bisa dihubungi' });
  }
});

app.listen(3000, () => console.log('Proxy di http://localhost:3000/jkt48/news'));
```

## Python async: banyak request sekaligus

`httpx.AsyncClient` memakai ulang koneksi, dan `asyncio.Semaphore` membatasi request paralel agar tidak membanjiri server. Contoh ini mengambil lima halaman berita dan semua member dalam satu waktu.

```python
# pip install httpx
import asyncio
import os

import httpx

BASE = "https://api.jkt48connect.app"
KEY = os.environ["JKT48CONNECT_API_KEY"]
LIMIT = asyncio.Semaphore(4)  # maksimal 4 request bersamaan


async def get(client: httpx.AsyncClient, path: str, **params):
    async with LIMIT:
        for attempt in range(4):
            r = await client.get(path, params=params)
            if r.status_code == 429:
                body = r.json()
                raise RuntimeError(f"Kuota habis, reset {body['resets_at']}")
            if r.status_code < 500:
                r.raise_for_status()
                return r.json()
            await asyncio.sleep(0.5 * 2**attempt)
        r.raise_for_status()


async def main():
    async with httpx.AsyncClient(
        base_url=BASE,
        headers={"X-API-Key": KEY},
        timeout=httpx.Timeout(20.0),
    ) as client:
        pages = [get(client, "/api/news", page=p, perpage=20) for p in range(1, 6)]
        members, *news_pages = await asyncio.gather(get(client, "/api/member"), *pages)

        titles = [n["title"] for page in news_pages for n in page["news"]]
        print(f"{len(titles)} berita, {len(members.get('members', members))} member")


asyncio.run(main())
```

## Proxy di Cloudflare Workers

Worker kecil yang menambahkan key dari secret, menyimpan respons di cache edge, dan memberi header CORS untuk frontend-mu sendiri. Simpan key dengan `npx wrangler secret put JKT48CONNECT_API_KEY`.

```js
// worker.js
const BASE = 'https://api.jkt48connect.app';
const ORIGIN = 'https://fanbase-kamu.com';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (request.method !== 'GET' || !url.pathname.startsWith('/api/'))
      return cors(Response.json({ message: 'Tidak ditemukan' }, { status: 404 }));

    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cors(cached);

    const upstream = await fetch(BASE + url.pathname + url.search, {
      headers: { 'X-API-Key': env.JKT48CONNECT_API_KEY },
    });
    const response = new Response(upstream.body, upstream);
    if (upstream.ok) {
      response.headers.set('Cache-Control', 'public, max-age=60');
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }
    return cors(response);
  },
};

function cors(response) {
  const r = new Response(response.body, response);
  r.headers.set('Access-Control-Allow-Origin', ORIGIN);
  r.headers.set('Vary', 'Origin');
  return r;
}
```

## Bot notifikasi live (Discord webhook)

Bot memeriksa `/api/now_live` tiap menit, membandingkan dengan sesi yang sudah diumumkan, dan hanya mengirim pesan untuk sesi baru. Satu cek per menit memakai sekitar 44.000 request per bulan, jadi pakai paket Starter ke atas atau perpanjang interval.

```js
// live-bot.mjs: node live-bot.mjs
const BASE = 'https://api.jkt48connect.app';
const KEY = process.env.JKT48CONNECT_API_KEY;
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const INTERVAL = 60_000;
const announced = new Set();

async function check() {
  const res = await fetch(`${BASE}/api/now_live?group=jkt48`, { headers: { 'X-API-Key': KEY } });
  if (res.status === 429) {
    const { resets_at } = await res.json();
    console.warn('Kuota habis sampai', resets_at);
    return Math.max(Date.parse(resets_at) - Date.now(), INTERVAL);
  }
  if (!res.ok) return INTERVAL * 2; // backoff ringan saat server bermasalah

  const lives = await res.json();
  const list = Array.isArray(lives) ? lives : (lives.data ?? []);
  const live = new Set();
  for (const s of list) {
    const id = String(s.data_id ?? s.room_id ?? s.slug ?? s.name);
    live.add(id);
    if (announced.has(id)) continue;
    announced.add(id);
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🔴 **${s.name}** sedang live di ${s.type === 'idn' ? 'IDN' : 'Showroom'}!`,
      }),
    });
  }
  // Lupakan sesi yang sudah selesai agar live berikutnya diumumkan lagi.
  for (const id of announced) if (!live.has(id)) announced.delete(id);
  return INTERVAL;
}

async function loop() {
  let wait = INTERVAL;
  try {
    wait = await check();
  } catch (error) {
    console.error(error);
  }
  setTimeout(loop, wait);
}
loop();
```

> [!NOTE]
> Bentuk item `now_live` berbeda antara IDN dan Showroom. Bot di atas membaca beberapa kemungkinan nama field ID. Cek bentuk aktualnya di [referensi](/docs/reference) dengan tombol **Coba GET**.

## Key lewat query untuk alat tanpa header

Google Sheets, Excel Power Query, atau embed sederhana sering tidak bisa menambah header. Untuk itu kirim key lewat query:

```text
=IMPORTDATA("https://api.jkt48connect.app/api/news?page=1&perpage=10&apikey=jkc_8f3a1c0b7e2d4a9f6c5b1e0d3a7f9c2b4e6d9d2e")
```

```sh
curl "https://api.jkt48connect.app/api/member?apikey=${JKT48CONNECT_API_KEY}"
curl "https://api.jkt48connect.app/api/theater?page=1&api_key=${JKT48CONNECT_API_KEY}"
```

> [!WARNING]
> URL ber-key bisa tercatat di riwayat browser dan log. Pakai key terpisah khusus untuk spreadsheet atau embed, beri nama yang jelas di dashboard, lalu cabut saja key itu bila bocor tanpa mengganggu key backend utama.

## Daftar periksa produksi

| Cek | Kenapa |
| --- | --- |
| Key hanya di server atau secret | Key di JavaScript browser bisa disalin siapa pun |
| Satu key per aplikasi | Pemakaian terlihat terpisah di dashboard dan mudah dicabut |
| Cache 20–60 detik | Data live berubah cepat, berita dan member jarang |
| Retry hanya untuk `5xx` dan jaringan | `401` dan `429` tidak akan sembuh dengan retry |
| Baca `X-RateLimit-Remaining` | Beri peringatan sebelum kuota habis |
| Hormati `Retry-After` | Jangan terus memanggil saat kuota habis |

## Catatan bentuk respons (terverifikasi 2026-10-31)

- Objek paginasi: `/api/news`, `/api/theater`, `/api/recent` → `{ data: [...], page, perpage, total_count }`
- Array langsung: `/api/member`, `/api/birthday`, `/api/setlist`, `/api/next_schedule`, `/api/now_live`
- Detail member: pakai slug `url` → `/api/member/abigail-rachel` (bukan ID angka)
- Detail recent: pakai `data_id` → `/api/recent/idn-...` (bukan `_id`)
- Detail theater: `{ date, shows: [...] }` — data ada di dalam array `shows`
