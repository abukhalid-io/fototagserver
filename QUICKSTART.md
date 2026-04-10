# 🚀 Quick Start - GeoTagging App

## Deploy dalam 3 Langkah

### 1️⃣ Upload ke VPS

```bash
# Cara termudah - zip dan upload
# Dari Windows (PowerShell):
scp -r "C:\Users\randex\Desktop\project foto tag di server\geotagging-app" root@YOUR_VPS_IP:/opt/
```

### 2️⃣ Install & Run

```bash
# SSH ke VPS
ssh root@YOUR_VPS_IP

# Masuk folder dan install
cd /opt/geotagging-app
chmod +x install.sh
./install.sh
```

### 3️⃣ Akses Aplikasi

Buka browser:
- 📷 **Camera**: http://YOUR_VPS_IP:3000
- 🖼️ **Gallery**: http://YOUR_VPS_IP:3000/gallery

---

## Perintah Penting PM2

```bash
pm2 status                    # Cek status aplikasi
pm2 logs geotagging-app       # Lihat logs
pm2 restart geotagging-app    # Restart aplikasi
pm2 stop geotagging-app       # Stop aplikasi
pm2 monit                     # Monitor real-time
```

## Troubleshooting Cepat

```bash
# Aplikasi tidak jalan?
pm2 restart geotagging-app

# Port sudah dipakai?
# Edit .env, ganti PORT=3001

# Foto tidak ter-upload?
chmod -R 755 public/uploads/

# Database error?
rm geotagging.db
pm2 restart geotagging-app
```

## Backup Database

```bash
# Backup
cp geotagging.db geotagging.db.backup

# Restore
cp geotagging.db.backup geotagging.db
pm2 restart geotagging-app
```

---

**That's it! Aplikasi siap digunakan! 🎉**
