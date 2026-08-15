# 🗂️ SwipeSort

Aplikasi web (PWA) untuk merapikan galeri foto dengan gesture swipe, terinspirasi dari [Slidebox](https://play.google.com/store/apps/details?id=co.slidebox).

## ✨ Fitur

- **📥 Impor foto** — pilih banyak foto sekaligus lewat tombol impor atau tarik & letakkan (drag & drop).
- **🃏 Sortir ala kartu** — foto tampil satu per satu seperti tumpukan kartu:
  - **Swipe ke atas** → buang ke Trash 🗑️
  - **Swipe ke kiri** → simpan & lanjut ✅
  - **Swipe ke kanan** → kembali ke foto sebelumnya ⬅️
  - **Ketuk foto** → pratinjau ukuran penuh 🔍
- **📁 Sortir ke album** — ketuk tab album di atas untuk langsung memasukkan foto ke album; buat album baru kapan saja.
- **🗑️ Trash aman** — foto yang dibuang masuk Trash dulu; tinjau, kembalikan, atau kosongkan permanen.
- **↩️ Undo** — urungkan aksi sortir terakhir kapan pun.
- **📊 Progres** — indikator jumlah foto yang sudah disortir.
- **💾 Persisten** — semua foto, album, dan status tersimpan di IndexedDB browser; tutup tab dan lanjutkan nanti.
- **📱 PWA** — bisa di-install ke home screen dan berjalan offline (butuh HTTPS).

## ⌨️ Pintasan keyboard

| Tombol | Aksi |
| --- | --- |
| `↑` / `Delete` | Buang ke Trash |
| `Spasi` | Simpan & lanjut |
| `←` / `→` | Foto sebelumnya / berikutnya |
| `Z` | Undo |
| `1`–`9` | Sortir ke album ke-n |
| `Esc` | Tutup pratinjau |

## 🚀 Menjalankan

Tidak ada build step — cukup sajikan folder ini dengan server statis apa pun:

```bash
# Python
python3 -m http.server 8080

# atau Node
npx serve .
```

Lalu buka `http://localhost:8080`.

> Catatan: aplikasi harus diakses lewat server (bukan `file://`) karena memakai ES modules. Service worker/offline hanya aktif lewat HTTPS atau `localhost`.

## 🏗️ Struktur

```
index.html            # Markup semua layar (beranda, sortir, trash, album)
css/app.css           # Tema gelap, layout mobile-first
js/app.js             # Logika utama: gesture, sortir, album, trash, undo
js/db.js              # Lapisan penyimpanan IndexedDB
sw.js                 # Service worker (cache cangkang aplikasi)
manifest.webmanifest  # Manifest PWA
icons/icon.svg        # Ikon aplikasi
```

## 🔒 Privasi

Semua foto diproses dan disimpan **hanya di browser kamu** (IndexedDB). Tidak ada yang diunggah ke server mana pun.
