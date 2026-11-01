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

Daftar berita diperiksa otomatis sekitar setiap **15 detik** melalui satu proses bersama. Cache daftar API berlaku 3 detik; cache scraper untuk news paling lama 5 detik. Jika sumber resmi sehat, berita baru biasanya terlihat dalam sekitar 15–25 detik setelah tersedia pada API sumber. Ini tetap polling, bukan push langsung dari JKT48. Saat sumber menolak atau gagal, pemeriksaan menggunakan backoff 30 detik hingga 5 menit dan data terakhir tetap tersedia.

Pemeriksaan rutin membaca halaman terbaru saja. Jika isi belum berubah, database dan cache tidak ditulis ulang. Pemeriksaan otomatis tetap berjalan tanpa menunggu pengguna membuka daftar berita.

### Gambar pengumuman

Daftar dan detail news menyediakan `news_image` dalam gaya **JKT48Connect**. `status: "ready"` berarti gambar sudah tersimpan di R2; `url` menunjuk halaman pertama. `images` berisi seluruh halaman berikut ukuran aktualnya. Tinggi gambar mengikuti panjang artikel dan foto yang ada pada sumber. Artikel sangat panjang dibagi menjadi beberapa gambar agar teks tidak terpotong atau diperkecil berlebihan.

```json
{"news_image":{"style":"jkt48connect","status":"ready","url":"https://api.jkt48connect.app/media/news/jkt48connect/v1/1900/SOURCE_VERSION/1.png","images":[{"page":1,"url":"https://api.jkt48connect.app/media/news/jkt48connect/v1/1900/SOURCE_VERSION/1.png","width":1600,"height":3200}],"format":"png","page_count":1}}
```

Ukuran dan URL di atas hanya ilustrasi. Gunakan nilai dari respons. Saat `pending`, baca ulang metadata; gambar belum tentu tersedia. Isi artikel dan foto diambil dari pengumuman, tanpa teks berita yang dibuat AI.

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
