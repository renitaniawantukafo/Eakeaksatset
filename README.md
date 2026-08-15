# 🗂️ SwipeSort

Aplikasi web (PWA) untuk merapikan galeri foto dengan gesture swipe, terinspirasi dari [Slidebox](https://play.google.com/store/apps/details?id=co.slidebox).

## ✨ Fitur

- **🗂 Alur ala Slidebox** — di Android, galeri dibaca otomatis dan dikelompokkan
  **per bulan**; pilih bulan, lalu sortir foto satu per satu. Tidak perlu impor manual.
- **🃏 Layar sortir** — foto tampil satu per satu:
  - **Swipe ke atas / ✕ BUANG** → tandai buang 🗑️
  - **Swipe ke kiri / ✓ LANJUT** → simpan & lanjut
  - **Swipe ke kanan** → foto sebelumnya
  - **PINDAHKAN KE ALBUM…** → ketuk album untuk memindahkan foto ke album galeri
- **🗑️ Trash aman** — foto yang dibuang ditinjau dulu; penghapusan & perpindahan
  sungguhan diterapkan sekaligus lewat **dialog konfirmasi sistem Android**
  (sesuai aturan scoped storage Android 11+).
- **↩️ Undo**, ringkasan per bulan, indikator progres `1 / 1018 · tanggal`.
- **👤 Filter wajah** — deteksi wajah on-device (`android.media.FaceDetector`,
  offline & privat): pilih **jumlah foto** yang dipindai (100/300/1000/semua),
  **jeda** kapan saja dan lanjutkan dari **daftar sesi tertunda**, foto yang
  sudah dipindai **otomatis dilewati selamanya**, hasil **dikelompokkan per
  bulan** dengan tombol pindah per bulan atau pindahkan semuanya sekaligus.
- **🏷 Sistem tag** — hasil deteksi wajah otomatis diberi **tag "Orang"**
  (hanya catatan di aplikasi, file tidak dipindah); buat tag lain dan tandai
  foto manual lewat seleksi; daftar tag tampil di layar Susun; pindahkan foto
  ke album **berdasarkan tag** kapan saja. Pemindaian berikutnya otomatis
  **melewati foto yang sudah ber-tag** (tag apa pun) atau sudah dipindai.
- **☑ Seleksi massal** — mode Pilih: ketuk foto satu-satu atau **seret jari**
  melintasi grid untuk memilih banyak foto sekaligus (dengan gulir otomatis di
  tepi), lalu pindahkan atau hapus yang terpilih.
- **🤏 Pinch zoom grid** — cubit/rentangkan dua jari pada grid untuk mengatur
  2–6 kolom, supaya lebih banyak foto terlihat dalam satu layar.
- **🧹 Bersihkan otomatis** — hapus semua foto berwajah yang **belum**
  dipindahkan ke album (yang bertanda 📁 aman), lewat dialog konfirmasi sistem.
- **🌐 Mode web** — di browser (tanpa Android), foto diimpor manual dan tetap
  dikelompokkan per bulan dari tanggal berkas; data tersimpan di IndexedDB.

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
