VALZY Studio — pemasangan

1. Ekstrak ZIP ke folder tetap.
2. Buka chrome://extensions, aktifkan Developer mode.
3. Pilih Load unpacked, lalu pilih folder yang berisi manifest.json.
4. Buka ekstensi, masukkan lisensi yang dibuat oleh admin.

Panel admin:
https://api.jkt48connect.app/control/admin?tab=licenses

Admin bisa menyimpan API key penyedia, mengatur prefix, membuat Trial/Pro,
memilih menit/jam/hari/minggu/bulan/tahun, mengikat email opsional dan
mengatur batas perangkat. Tahun dikonversi menjadi 12 bulan per tahun.
Lisensi lama tetap mengikuti prefix sebelumnya. API key penyedia hanya
tersimpan terenkripsi di server dan tidak disertakan dalam ZIP.

Perubahan ekstensi dibatasi pada UI, aset branding dan integrasi lisensi.
Kode content, page-ws, panel, fingerprint dan translations dipertahankan.
Validasi dan tanda tangan lisensi tetap diperiksa; permintaan operasional
lain tetap menuju penyedia semula dengan kredensial lisensi per pelanggan.
Lisensi Eklas lama tetap dapat divalidasi melalui penyedia asli.

Jika aktivasi gagal, periksa expiry, email yang digunakan dan batas perangkat.
Tidak ada API key global yang perlu diisi pada ekstensi.
