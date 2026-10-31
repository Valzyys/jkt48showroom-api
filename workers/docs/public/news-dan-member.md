# News & member

Gunakan berita untuk kabar terbaru, dan data member untuk profil, tanggal lahir, serta gambar yang sudah disediakan API.

## Berita

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=2' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/news/1881' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

`NEWS_ID` berasal dari hasil daftar. Respons daftar (nyata):

```json
{
  "news": [
    {
      "date": "2026-10-28T17:00:00.000Z",
      "title": "Pengumuman Mengenai JKT48 1st Generation Special Stage \"Homecoming: Where It All Began\"",
      "category": "Theater",
      "id": "1881",
      "link": "pengumuman-mengenai-jkt48-1st-generation-special-stage-homecoming-where-it-all-began",
      "url": "https://jkt48.com/news/..."
    }
  ],
  "page": 1,
  "perpage": 2,
  "total_count": 35
}
```

Detail berita mengembalikan field yang sama plus `content` berisi HTML artikel.

## Daftar dan profil member

```sh
curl 'https://api.jkt48connect.app/api/member' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/member/abigail-rachel' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/48/member?group=jkt48' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

**Perhatian:** daftar member mengembalikan **array langsung**, bukan objek `{ data: [...] }`:

```json
[
  {
    "_id": "b8146b538e3431a3bcd5cb15",
    "jkt48_id": "1",
    "name": "Abigail Rachel",
    "nicknames": ["Aralie"],
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
    "img_alt": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
    "url": "abigail-rachel",
    "group": "jkt48",
    "is_graduate": false,
    "idn_username": "jkt48_aralie"
  }
]
```

**Detail member memakai `url` (slug), bukan `jkt48_id`.** Request ke `/api/member/1` mengembalikan `404` — pakai `/api/member/abigail-rachel`:

```json
{
  "name": "Abigail Rachel",
  "nickname": "Aralie",
  "fullname": "Abigail Rachel",
  "img_alt": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
  "group": "jkt48",
  "is_graduate": false,
  "bloodType": "B",
  "height": "164cm",
  "birthdate": "2008-08-05T17:00:00.000Z",
  "url": "abigail-rachel",
  "stats": { "total_live": { "showroom": 0, "idn": 0 } },
  "recentTheater": [],
  "upcomingTheater": []
}
```

Bentuk daftar mengikuti endpoint. Jangan mengasumsikan semua respons memiliki properti `data` yang sama. Periksa contoh output sebelum melakukan parsing.

## Ulang tahun

```sh
curl 'https://api.jkt48connect.app/api/birthday' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/next_birthday' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Keduanya mengembalikan array (nyata):

```json
[
  {
    "name": "Ralyne",
    "birthdate": "2011-10-14T17:00:00.000Z",
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/ralyne_van_irwan.jpg"
  },
  {
    "name": "Nachia",
    "birthdate": "2009-10-15T17:00:00.000Z",
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/nina_tutachia.jpg",
    "room_id": 510065,
    "url_key": "jkt48_nachia"
  }
]
```

Gunakan URL gambar yang diberikan respons secara langsung. Tampilkan placeholder milik aplikasi ketika gambar belum tersedia, dan keadaan kosong ketika tidak ada hasil.

## Menampilkan gambar

```jsx
<img src={member.img} alt={member.name} loading="lazy" />
```

Nama properti gambar berbeda menurut endpoint; beberapa respons menyediakan `img`, `img_alt`, atau objek profil. Gunakan field sesuai referensi endpoint yang dipakai.
