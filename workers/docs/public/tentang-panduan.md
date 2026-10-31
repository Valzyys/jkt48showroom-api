# Tentang API

JKT48Connect menyediakan data JKT48 untuk website, aplikasi, bot komunitas, dan proyek penggemar. Mulai dari berita serta profil member, sampai jadwal theater dan rekap live.

## Satu alamat untuk integrasi

```text
https://api.jkt48connect.app
```

Gunakan **API Reference** untuk melihat method, path, parameter, label akses, dan contoh respons setiap endpoint. Pencarian tersedia melalui `Ctrl+K` atau `⌘K`.

| Kelompok | Data yang tersedia |
| --- | --- |
| Kabar & profil | News, member, ulang tahun, banner |
| Theater & acara | Jadwal, detail show, setlist, event |
| Live & recent | Sesi aktif, rekap, gift, leaderboard |
| Media | Foto, screenshot, gambar leaderboard, replay |

> [!NOTE]
> API ini merupakan proyek penggemar dan tidak berafiliasi dengan manajemen JKT48. Ketersediaan data mengikuti sumber dan sesi yang tercatat.

## Mulai dari data yang sederhana

Semua endpoint data memakai API key gratis dari [dashboard developer](/dashboard/keys). Mulai dari news dan member, lalu lanjut ke endpoint lain sesuai kebutuhan proyekmu.

[Ikuti quick start →](/docs/guide/mulai-menggunakan)

## Catatan akses (terverifikasi 2026-10-31)

- Semua endpoint di bawah `/api/` **wajib** memakai API key — tanpa key mengembalikan `401`.
- Endpoint media di bawah `/media/` dan `/replay/` (gambar, screenshot, replay) bisa dibuka **tanpa** API key.
