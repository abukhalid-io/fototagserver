# 📱 Panduan Install Aplikasi GeoTagging di Smartphone

## Aplikasi PWA (Progressive Web App)

Aplikasi GeoTagging adalah **PWA** yang bisa diinstall di smartphone **tanpa perlu Google Play Store atau App Store**. Cukup gunakan browser!

## ✅ Keuntungan PWA

- ✅ **Install langsung** - Tidak perlu download dari Play Store
- ✅ **Offline Mode** - Bisa foto dan simpan data meski tidak ada internet
- ✅ **Auto Sync** - Foto otomatis ter-upload saat ada internet
- ✅ **Ringan** - Tidak menghabiskan storage banyak
- ✅ **Selalu Update** - Selalu versi terbaru

---

## 📲 Cara Install di Android

### Metode 1: Install dari Browser (Recommended)

1. **Buka aplikasi di Chrome Android**
   ```
   http://YOUR_VPS_IP:3000
   ```

2. **Tunggu muncul tombol "Install App"** di bagian bawah layar
   - Atau klik menu ⋮ (titik tiga) di pojok kanan atas
   - Pilih **"Install app"** atau **"Add to Home screen"**

3. **Konfirmasi Install**
   - Klik **"Install"** saat muncul prompt
   - Tunggu beberapa detik

4. **Akses Aplikasi**
   - Icon akan muncul di home screen atau app drawer
   - Bisa dibuka seperti aplikasi biasa!

### Metode 2: Add to Home Screen Manual

Jika tombol install tidak muncul:

1. Buka `http://YOUR_VPS_IP:3000` di **Chrome**
2. Klik menu ⋮ (titik tiga)
3. Pilih **"Add to Home screen"** atau **"Install app"**
4. Beri nama "GeoTag"
5. Klik **"Add"**

---

## 🍎 Cara Install di iPhone (iOS)

### Syarat
- iOS 11.3 atau lebih baru
- Safari browser

### Langkah-langkah

1. **Buka di Safari**
   ```
   http://YOUR_VPS_IP:3000
   ```
   **PENTING: Harus pakai Safari, bukan Chrome!**

2. **Klik tombol Share** (kotak dengan panah ke atas)
   - Ada di bagian bawah Safari

3. **Scroll dan pilih "Add to Home Screen"**

4. **Edit nama jika perlu** (disarankan: "GeoTag")

5. **Klik "Add"** di pojok kanan atas

6. **Selesai!** Icon akan muncul di home screen

---

## 💡 Cara Kerja Offline Mode

### Saat Online ✅
1. Ambil foto dengan kamera
2. Isi data tag (Item, Lokasi, Catatan)
3. Klik "Simpan ke Server"
4. Foto langsung ter-upload ke server
5. Tersimpan di database + galeri

### Saat Offline ⚠️
1. Ambil foto dengan kamera
2. Isi data tag
3. Klik "Simpan ke Server"
4. **Foto tersimpan di perangkat (IndexedDB)**
5. Muncul badge "💾 TERSIMPAN LOKAL"
6. Badge "⚠️ OFFLINE" muncul di pojok kanan atas

### Saat Koneksi Kembali ✅
1. Aplikasi **otomatis mendeteksi** koneksi internet
2. Badge "🔄 Syncing..." muncul
3. **Foto pending otomatis ter-upload** ke server
4. Badge offline hilang
5. Muncul notifikasi "✅ X foto berhasil disinkronkan!"

### Sync Manual
Jika auto-sync tidak berjalan:
1. Buka halaman **Galeri**
2. Lihat bagian **"Foto Menunggu Upload"**
3. Klik tombol **"🔄 Sync Sekarang"**
4. Tunggu proses selesai

---

## 📊 Lihat Status Foto Pending

### Di Halaman Kamera
- Badge **"⚠️ OFFLINE"** (merah) = sedang offline
- Badge **"🔄 Syncing..."** (kuning) = sedang sync
- Counter **"X pending"** = jumlah foto yang belum ter-upload
- Status koneksi di bawah form

### Di Halaman Galeri
- Banner **"Mode Offline"** = sedang offline
- Section **"Foto Menunggu Upload"** = daftar foto pending
- Tombol **"Sync Sekarang"** = sync manual

---

## 🎯 Fitur Lengkap

### 📷 Kamera
- ✅ Live camera dari browser
- ✅ Mode HD dan Standard
- ✅ Auto-detect GPS
- ✅ Manual input lokasi
- ✅ Watermark otomatis di foto
- ✅ Auto-download backup ke perangkat
- ✅ **Offline save** saat tidak ada internet

### 🖼️ Galeri
- ✅ Lihat semua foto
- ✅ Search by tag/lokasi/catatan
- ✅ Filter by tag
- ✅ **Lihat foto pending** (offline mode)
- ✅ Sync manual
- ✅ Statistics dashboard
- ✅ Delete foto

### 📱 PWA
- ✅ Installable di home screen
- ✅ Offline support
- ✅ Auto-sync when online
- ✅ Background sync
- ✅ Push notifications (future)
- ✅ Full screen mode

---

## ⚙️ Technical Details

### Penyimpanan Lokal
Foto offline disimpan di:
- **IndexedDB** (browser database)
- Nama database: `GeoTaggingDB`
- Stores:
  - `pending_photos` - foto menunggu upload
  - `cached_photos` - cache dari server
  - `settings` - pengaturan aplikasi

### Data Foto (per foto)
```javascript
{
  imageBase64: "...", // Base64 encoded JPEG
  itemTag: "TIANG A1", // Tag item (uppercase)
  location: "Jakarta", // Lokasi manual
  note: "Kondisi baik", // Catatan
  latitude: "-6.2088", // GPS Latitude
  longitude: "106.8456", // GPS Longitude
  altitude: "50m", // Altitude
  datetimeTaken: "2024-01-01 10:00:00", // Waktu
  timestamp: 1704067200000, // Timestamp saat save
  synced: false, // Status sync
  retryCount: 0 // Jumlah retry gagal
}
```

### Auto-Sync Behavior
- Trigger: Saat koneksi internet kembali
- Retry limit: 10 kali per foto
- Auto-delete setelah 10x gagal
- Sync order: Dari yang paling lama
- Background: Via Service Worker

---

## 🐛 Troubleshooting

### Icon install tidak muncul
- **Android**: Pastikan menggunakan Chrome
- **iOS**: Harus pakai Safari, bukan browser lain
- Refresh halaman (Ctrl+R atau pull down)
- Clear cache browser jika perlu

### Foto tidak ter-sync otomatis
1. Cek koneksi internet
2. Buka halaman Galeri
3. Klik "Sync Sekarang" manual
4. Tunggu proses selesai

### Storage penuh di perangkat
- Foto pending menggunakan storage IndexedDB
- Limit tergantung browser (biasanya 50-100MB)
- Sync foto secepatnya untuk free up space
- Clear browser data jika perlu (akan hilang foto pending)

### Aplikasi hilang dari home screen
- Install ulang dengan cara yang sama
- Data pending mungkin hilang jika uninstall
- Pastikan sync semua foto sebelum uninstall

### GPS tidak terdeteksi
- Pastikan Location/GPS enabled di perangkat
- Beri izin lokasi ke browser
- Bisa input lokasi manual sebagai alternatif

---

## 🔐 Privacy & Security

- ✅ Foto offline **hanya tersimpan di perangkat Anda**
- ✅ Tidak ada data yang dikirim ke pihak ketiga
- ✅ Upload hanya ke server Anda sendiri
- ✅ IndexedDB terisolasi per domain
- ✅ Bisa hapus data kapan saja via browser settings

---

## 📞 Support

Jika ada masalah:
1. Cek badge status (offline/syncing)
2. Lihat console log di browser (F12 atau Remote Debug)
3. Coba sync manual dari halaman Galeri
4. Restart browser jika perlu

---

**Selain menggunakan! 🎉**

Aplikasi siap digunakan offline maupun online!
