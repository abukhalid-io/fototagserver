# 📸 GeoTagging HD - Photo Tagging & Gallery Application

Aplikasi web untuk mengambil foto dengan geotagging, menyimpan metadata tag, dan melihat galeri dengan fitur pencarian.

## ✨ Fitur

### 📷 Kamera & Upload
- **Live Camera** - Ambil foto langsung dari browser
- **HD Mode** - Foto dengan resolusi tinggi
- **Auto Watermark** - Data tag otomatis tertulis di foto (Item, Lokasi, GPS, Waktu)
- **Auto GPS** - Mendeteksi lokasi GPS secara otomatis
- **Manual Input** - Input lokasi manual jika GPS tidak tersedia
- **Local Backup** - Foto otomatis terdownload ke device saat capture

### 🗄️ Database & Storage
- **SQLite Database** - Ringan dan mudah dikelola
- **Metadata Lengkap** - Item Tag, Lokasi, GPS Coordinates, Altitude, Waktu
- **Auto Index** - Pencarian cepat dengan indexing

### 🖼️ Galeri & Search
- **Photo Gallery** - Lihat semua foto dalam grid layout
- **Advanced Search** - Cari berdasarkan tag, lokasi, atau catatan
- **Tag Filter** - Filter cepat berdasarkan tag dengan satu klik
- **Statistics Dashboard** - Total foto, unique tags, foto 24 jam terakhir
- **Pagination** - Navigasi mudah untuk banyak foto
- **Image Modal** - Lihat foto dalam ukuran penuh dengan detail
- **Delete Photo** - Hapus foto dari galeri

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- npm atau yarn
- Linux VPS (Ubuntu/Debian/CentOS) atau local machine

### Installation

#### Option 1: Automatic Installation (Recommended untuk VPS)

```bash
# 1. Upload folder geotagging-app ke VPS
# 2. Jalankan script instalasi
chmod +x install.sh
./install.sh
```

Script akan otomatis:
- ✓ Update system packages
- ✓ Install Node.js (jika belum ada)
- ✓ Install build tools untuk native modules
- ✓ Install PM2 untuk process management
- ✓ Install semua dependencies
- ✓ Setup auto-start on boot
- ✓ Start aplikasi

#### Option 2: Manual Installation

```bash
# Install dependencies
npm install --production

# Create environment file
cp .env.example .env

# Start with PM2 (production)
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# Or start manually (development)
npm start
```

### Access Application

Setelah instalasi, akses aplikasi di:

- **Camera**: `http://YOUR_SERVER_IP:3000/`
- **Gallery**: `http://YOUR_SERVER_IP:3000/gallery`
- **API**: `http://YOUR_SERVER_IP:3000/api/photos`

## 📋 API Documentation

### Upload Photo
```bash
POST /api/upload
Content-Type: multipart/form-data

Body:
  - photo: File (image)
  - itemTag: String (required)
  - location: String
  - note: String
  - latitude: String
  - longitude: String
  - altitude: String
  - datetimeTaken: String

Response:
{
  "success": true,
  "id": 1,
  "filename": "1234567890-photo.jpg"
}
```

### Get All Photos
```bash
GET /api/photos?page=1&limit=20

Response:
{
  "success": true,
  "photos": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Search Photos
```bash
GET /api/search?q=TIANG
GET /api/search?tag=TIANG LISTRIK
GET /api/search?location=Jakarta

Response:
{
  "success": true,
  "photos": [...],
  "count": 10
}
```

### Get Single Photo
```bash
GET /api/photos/:id

Response:
{
  "success": true,
  "photo": { ... }
}
```

### Delete Photo
```bash
DELETE /api/photos/:id

Response:
{
  "success": true,
  "message": "Photo deleted successfully"
}
```

### Get Statistics
```bash
GET /api/stats

Response:
{
  "success": true,
  "stats": {
    "totalPhotos": 100,
    "uniqueTags": 25,
    "last24Hours": 10
  }
}
```

### Get All Tags
```bash
GET /api/tags

Response:
{
  "success": true,
  "tags": [
    { "item_tag": "TIANG LISTRIK A1", "count": 5 },
    { "item_tag": "METER AIR B2", "count": 3 }
  ]
}
```

## 🔧 Configuration

### Environment Variables

Buat file `.env` di root directory:

```env
PORT=3000
NODE_ENV=production
```

### PM2 Management

```bash
# Check status
pm2 status

# View logs
pm2 logs geotagging-app

# Restart
pm2 restart geotagging-app

# Stop
pm2 stop geotagging-app

# Monitor resources
pm2 monit

# View all processes
pm2 list
```

## 📁 Project Structure

```
geotagging-app/
├── server.js              # Main application server
├── database.js            # Database configuration & schema
├── package.json           # Dependencies
├── install.sh             # Automatic installation script
├── ecosystem.config.js    # PM2 configuration
├── .gitignore            # Git ignore rules
├── public/
│   ├── index.html        # Camera page
│   ├── gallery.html      # Gallery page
│   └── uploads/          # Uploaded photos storage
└── logs/
    ├── pm2-error.log
    ├── pm2-out.log
    └── pm2-combined.log
```

## 🗄️ Database Schema

```sql
CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  original_filename TEXT,
  item_tag TEXT NOT NULL,
  location TEXT,
  note TEXT,
  latitude TEXT,
  longitude TEXT,
  altitude TEXT,
  datetime_taken TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast search
CREATE INDEX idx_item_tag ON photos(item_tag);
CREATE INDEX idx_location ON photos(location);
CREATE INDEX idx_created_at ON photos(created_at);
```

## 🔒 Security Notes

- Upload limit: 50MB per file
- Production mode enabled
- CORS enabled for API access
- Input validation on server side
- SQL injection protection (parameterized queries)

## 🛠️ Troubleshooting

### Port already in use
```bash
# Find process using port 3000
lsof -i :3000
# or
netstat -tulpn | grep :3000

# Kill process
kill -9 <PID>

# Or change PORT in .env file
```

### Permission denied
```bash
# Make install script executable
chmod +x install.sh

# Or run with sudo
sudo ./install.sh
```

### Database errors
```bash
# Delete and recreate database
rm geotagging.db
pm2 restart geotagging-app
```

### Photos not showing
```bash
# Check uploads directory exists
ls -la public/uploads/

# Check permissions
chmod -R 755 public/uploads/
```

## 📊 Performance Tips

1. **Use PM2 in cluster mode** for multi-core utilization
2. **Enable gzip compression** in production
3. **Use CDN** for static assets if needed
4. **Regular database cleanup** for old photos
5. **Monitor memory usage** with `pm2 monit`

## 🔄 Backup & Restore

### Backup
```bash
# Backup database
cp geotagging.db geotagging.db.backup

# Backup photos
tar -czf uploads-backup.tar.gz public/uploads/

# Or use rsync for incremental backup
rsync -avz public/uploads/ /backup/location/
```

### Restore
```bash
# Restore database
cp geotagging.db.backup geotagging.db

# Restore photos
tar -xzf uploads-backup.tar.gz
pm2 restart geotagging-app
```

## 📝 License

MIT License - Feel free to use for personal and commercial projects.

## 🤝 Support

Untuk pertanyaan atau issue, silakan buat issue di repository ini.

---

**Made with ❤️ for efficient asset management**
