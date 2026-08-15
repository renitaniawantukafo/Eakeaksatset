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

## 🚀 Menjalankan (versi web)

Tidak ada build step — cukup sajikan folder `webapp/` dengan server statis apa pun:

```bash
cd webapp
python3 -m http.server 8080   # atau: npx serve .
```

Lalu buka `http://localhost:8080`.

> Catatan: aplikasi harus diakses lewat server (bukan `file://`) karena memakai ES modules. Service worker/offline hanya aktif lewat HTTPS atau `localhost`.

## 🤖 Versi Android (APK)

Folder `android/` berisi cangkang WebView native yang membundel aplikasi web
ini menjadi APK — dengan pemilih foto galeri native (system picker, tanpa izin
storage apa pun) dan penyimpanan IndexedDB yang persisten.

- **Unduh APK**: setiap push, GitHub Actions membangun APK debug dan
  menerbitkannya ke branch [`apk-dist`](../../tree/apk-dist) (juga tersedia
  sebagai artifact di tab Actions).
- **Build sendiri** (butuh Android SDK):

  ```bash
  cd android
  ./gradlew assembleDebug
  # hasil: app/build/outputs/apk/debug/app-debug.apk
  ```

Saat memasang, Android akan meminta izin "install dari sumber tidak dikenal" —
itu normal untuk APK di luar Play Store.

## 🏗️ Struktur

```
webapp/                 # Aplikasi web (PWA) — sumber tunggal UI
  index.html            #   Markup semua layar (beranda, sortir, trash, album)
  css/app.css           #   Tema gelap, layout mobile-first
  js/app.js             #   Logika utama: gesture, sortir, album, trash, undo
  js/db.js              #   Lapisan penyimpanan IndexedDB
  sw.js                 #   Service worker (cache cangkang aplikasi, hanya web)
  manifest.webmanifest  #   Manifest PWA
  icons/icon.svg        #   Ikon aplikasi
android/                # Cangkang WebView Android (webapp/ dibundel sebagai assets)
  app/src/main/java/app/swipesort/MainActivity.java
.github/workflows/build-apk.yml  # CI: build & publikasi APK
```

## 🔒 Privasi

Semua foto diproses dan disimpan **hanya di browser kamu** (IndexedDB). Tidak ada yang diunggah ke server mana pun.
