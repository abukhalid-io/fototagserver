# 🚀 Panduan Deploy ke VPS Linux

## Step-by-Step Deployment

### 1. Persiapan VPS

```bash
# Login ke VPS via SSH
ssh root@YOUR_VPS_IP

# Update sistem
sudo apt update && sudo apt upgrade -y

# Install git (jika belum ada)
sudo apt install git -y
```

### 2. Upload Aplikasi

**Option A: Via SCP/SFTP**
```bash
# Dari komputer lokal
scp -r "C:\Users\randex\Desktop\project foto tag di server\geotagging-app" root@YOUR_VPS_IP:/opt/
```

**Option B: Via Git**
```bash
# Di VPS
cd /opt
git clone <YOUR_REPO_URL>
cd geotagging-app
```

**Option C: Via ZIP**
```bash
# Di komputer lokal, zip folder geotagging-app
# Upload via SCP
scp geotagging-app.zip root@YOUR_VPS_IP:/opt/

# Di VPS
cd /opt
unzip geotagging-app.zip
cd geotagging-app
```

### 3. Jalankan Script Instalasi

```bash
# Masuk ke folder aplikasi
cd /opt/geotagging-app

# Beri permission ke script
chmod +x install.sh

# Jalankan instalasi
./install.sh
```

Script akan otomatis melakukan:
- ✓ Install Node.js 20.x (jika belum ada)
- ✓ Install build-essential untuk native modules
- ✓ Install PM2 global
- ✓ Install semua npm dependencies
- ✓ Buat folder uploads dan logs
- ✓ Setup PM2 auto-start on boot
- ✓ Start aplikasi

### 4. Verifikasi Instalasi

```bash
# Cek apakah aplikasi berjalan
pm2 status

# Harusnya muncul seperti ini:
# ┌────┬─────────────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────┬──────────┬──────────┬──────────┐
# │ id │ name            │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu  │ mem      │ user     │ watching │
# ├────┼─────────────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────┼──────────┼──────────┼──────────┤
# │ 0  │ geotagging-app  │ default     │ 1.0.0   │ fork    │ 12345    │ 10s    │ 0    │ online    │ 0%   │ 50mb     │ root     │ disabled │
# └────┴─────────────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────┴──────────┴──────────┴──────────┘

# Test akses dari VPS
curl http://localhost:3000
```

### 5. Buka Firewall (Jika Ada)

```bash
# Untuk UFW (Ubuntu)
sudo ufw allow 3000/tcp
sudo ufw reload

# Untuk firewall-cmd (CentOS/RHEL)
sudo firewall-cmd --permanent --add-port=3000/tcp
sudo firewall-cmd --reload

# Untuk iptables
sudo iptables -A INPUT -p tcp --dport 3000 -j ACCEPT
sudo iptables-save
```

### 6. Akses Aplikasi

Buka browser dan akses:

- **Camera**: `http://YOUR_VPS_IP:3000/`
- **Gallery**: `http://YOUR_VPS_IP:3000/gallery`

## 🔧 Konfigurasi Lanjutan

### Setup Reverse Proxy dengan Nginx (Optional)

Untuk menggunakan domain dan SSL:

```bash
# Install Nginx
sudo apt install nginx -y

# Buat konfigurasi
sudo nano /etc/nginx/sites-available/geotagging-app

# Isi dengan:
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Aktifkan site
sudo ln -s /etc/nginx/sites-available/geotagging-app /etc/nginx/sites-enabled/

# Test konfigurasi
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Setup SSL dengan Let's Encrypt (Optional)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx -y

# Generate SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal test
sudo certbot renew --dry-run
```

Sekarang aplikasi bisa diakses via HTTPS: `https://yourdomain.com`

### Setup Database Backup Otomatis

```bash
# Buat script backup
sudo nano /opt/backup-geotagging.sh

# Isi dengan:
#!/bin/bash
BACKUP_DIR="/opt/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup database
cp /opt/geotagging-app/geotagging.db $BACKUP_DIR/geotagging_$DATE.db

# Backup photos
tar -czf $BACKUP_DIR/uploads_$DATE.tar.gz /opt/geotagging-app/public/uploads/

# Hapus backup lama (lebih dari 7 hari)
find $BACKUP_DIR -name "*.db" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"

# Beri permission
sudo chmod +x /opt/backup-geotagging.sh

# Tambah ke crontab (backup setiap hari jam 2 pagi)
crontab -e
# Tambah baris:
0 2 * * * /opt/backup-geotagging.sh >> /var/log/backup-geotagging.log 2>&1
```

### Monitoring dengan PM2

```bash
# Real-time monitoring
pm2 monit

# View logs
pm2 logs geotagging-app

# View error logs only
pm2 logs geotagging-app --err

# View logs dengan lines
pm2 logs geotagging-app --lines 100
```

## 🐛 Troubleshooting

### Aplikasi tidak bisa diakses dari luar

1. Cek firewall
```bash
sudo ufw status
sudo ufw allow 3000/tcp
```

2. Cek apakah aplikasi listen di port yang benar
```bash
netstat -tulpn | grep 3000
```

3. Pastikan bind ke 0.0.0.0, bukan 127.0.0.1
```bash
# Cek di server.js, pastikan:
app.listen(PORT, '0.0.0.0', () => { ... });
```

### Out of Memory

```bash
# Cek memory usage
free -h
pm2 monit

# Restart aplikasi
pm2 restart geotagging-app

# Jika perlu, tambah swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### Database Corrupted

```bash
# Stop aplikasi
pm2 stop geotagging-app

# Backup database yang ada
cp geotagging.db geotagging.db.corrupted

# Hapus dan recreate
rm geotagging.db

# Start kembali (akan buat database baru)
pm2 start geotagging-app
```

### Upload Gagal

```bash
# Cek permission folder uploads
ls -la public/
chmod -R 755 public/uploads/

# Cek disk space
df -h

# Bersihkan space jika penuh
sudo apt clean
rm -rf /tmp/*
```

## 📊 Performance Optimization

### Enable Gzip Compression

Tambahkan di `server.js` sebelum routes:

```javascript
const compression = require('compression');
app.use(compression());
```

### Set Static Cache Headers

```javascript
// Di server.js, setelah static files
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1d'
}));
```

### Database Optimization

```sql
-- Jalankan di SQLite CLI
sqlite3 geotagging.db

-- Analyze database
ANALYZE;

-- Vacuum untuk optimize
VACUUM;

-- Check database integrity
PRAGMA integrity_check;
```

## 📞 Support

Jika ada masalah saat deployment:

1. Cek logs: `pm2 logs geotagging-app`
2. Cek status: `pm2 status`
3. Restart: `pm2 restart geotagging-app`
4. Pastikan port tidak dipakai aplikasi lain

---

**Happy Deploying! 🎉**
