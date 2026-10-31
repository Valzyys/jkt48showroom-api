# Tentang API

JKT48Connect menyediakan data JKT48 untuk website, aplikasi, bot komunitas, dan proyek penggemar. Mulai dari berita serta profil member, sampai jadwal theater dan rekap live.

## Satu alamat untuk integrasi

```text
https://api.jkt48connect.app
```

Semua endpoint data ada di bawah `/api/` dan **wajib memakai API key** (tanpa key → `401`). Media (gambar, screenshot, replay) ada di bawah `/media/` dan `/replay/` dan bisa dibuka tanpa key.

Gunakan **API Reference** untuk melihat method, path, parameter, label akses, dan contoh respons setiap endpoint. Pencarian tersedia melalui `Ctrl+K` atau `⌘K`.

| Kelompok | Data yang tersedia |
| --- | --- |
| Kabar & profil | News, member, ulang tahun, banner |
| Theater & acara | Jadwal, detail show, setlist, event, rekaman YouTube |
| Live & recent | Sesi aktif, rekap, gift, leaderboard |
| Media | Foto, screenshot, gambar leaderboard, replay |

> [!NOTE]
> API ini merupakan proyek penggemar dan tidak berafiliasi dengan manajemen JKT48. Ketersediaan data mengikuti sumber dan sesi yang tercatat.

## Mulai dari data yang sederhana

Semua endpoint data memakai API key gratis dari [dashboard developer](/dashboard/keys). Mulai dari news dan member, lalu lanjut ke endpoint lain sesuai kebutuhan proyekmu.

[Ikuti quick start →](/docs/guide/mulai-menggunakan)
