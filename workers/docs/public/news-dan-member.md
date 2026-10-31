# News & member

Gunakan berita untuk kabar terbaru, dan data member untuk profil, tanggal lahir, serta gambar yang sudah disediakan API.

## Berita

```sh
curl 'https://api.jkt48connect.app/api/news?page=1&perpage=10' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/news/NEWS_ID' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

`NEWS_ID` berasal dari hasil daftar. Contoh output produksi yang tersimpan diberi tanggal di referensi; gunakan playground untuk data terbaru.

## Daftar dan profil member

```sh
curl 'https://api.jkt48connect.app/api/member' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/member/MEMBER_ID' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/48/member?group=jkt48' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Bentuk daftar mengikuti endpoint. Jangan mengasumsikan semua respons memiliki properti `data` yang sama. Periksa contoh output sebelum melakukan parsing.

## Ulang tahun

```sh
curl 'https://api.jkt48connect.app/api/birthday' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
curl 'https://api.jkt48connect.app/api/next_birthday' \
  -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```

Gunakan URL gambar yang diberikan respons secara langsung. Tampilkan placeholder milik aplikasi ketika gambar belum tersedia, dan keadaan kosong ketika tidak ada hasil.

## Menampilkan gambar

```jsx
<img src={member.img} alt={member.name} loading="lazy" />
```

Nama properti gambar berbeda menurut endpoint; beberapa respons menyediakan `img`, `img_alt`, atau objek profil. Gunakan field sesuai referensi endpoint yang dipakai.

## Contoh nyata & jebakan umum (terverifikasi 2026-10-31)

**Daftar member mengembalikan array langsung** (bukan objek):

```json
[
  {
    "jkt48_id": "1",
    "name": "Abigail Rachel",
    "nicknames": ["Aralie"],
    "img": "https://api.jkt48connect.app/media/jkt48/media/jkt48-member/abigail_rachel.jpg",
    "url": "abigail-rachel",
    "group": "jkt48",
    "is_graduate": false
  }
]
```

**Detail member memakai slug `url`, bukan `jkt48_id`:**

```sh
# BENAR -> 200
curl 'https://api.jkt48connect.app/api/member/abigail-rachel' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"

# SALAH -> 404 {"status":404,"message":"Data not found!"}
curl 'https://api.jkt48connect.app/api/member/1' -H "X-API-Key: ${JKT48CONNECT_API_KEY}"
```
