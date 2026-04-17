#!/bin/bash

# ============================================================
#   GeoTagging App - Install Script untuk Linux VPS/Server
# ============================================================
#   Jalankan: bash install.sh
#   Butuh: Ubuntu 20.04 / 22.04 / Debian 11+
# ============================================================

set -e

# --- Warna ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="geotagging-app"
PORT=${PORT:-3000}

ok()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }

echo -e "${BLUE}"
echo "  ╔══════════════════════════════════════════════════╗"
echo "  ║      GeoTagging App - Server Install Script     ║"
echo "  ║         Foto Watermark + GPS + OCR              ║"
echo "  ╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ────────────────────────────────────────
# 1. Deteksi OS
# ────────────────────────────────────────
step "1/9 · Deteksi sistem operasi"
if command -v apt-get &>/dev/null; then
    PKG="apt"
    ok "Paket manager: APT (Ubuntu/Debian)"
elif command -v yum &>/dev/null; then
    PKG="yum"
    ok "Paket manager: YUM (CentOS/RHEL)"
else
    warn "Paket manager tidak dikenali — lanjut manual"
    PKG="unknown"
fi

# ────────────────────────────────────────
# 2. Update sistem
# ────────────────────────────────────────
step "2/9 · Update paket sistem"
if [ "$PKG" = "apt" ]; then
    sudo apt-get update -y -q
    ok "APT updated"
elif [ "$PKG" = "yum" ]; then
    sudo yum update -y -q
    ok "YUM updated"
fi

# ────────────────────────────────────────
# 3. Install Node.js 20 LTS
# ────────────────────────────────────────
step "3/9 · Node.js 20 LTS"
if command -v node &>/dev/null; then
    NODE_VER=$(node -e "process.exit(parseInt(process.version.slice(1)))" 2>/dev/null; node --version)
    MAJOR=$(node -e "process.stdout.write(String(parseInt(process.version.slice(1))))")
    if [ "$MAJOR" -ge 18 ]; then
        ok "Node.js sudah terinstall: $(node --version)"
    else
        warn "Node.js versi lama ($NODE_VER). Upgrade ke v20..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -q
        sudo apt-get install -y nodejs -q
        ok "Node.js upgraded: $(node --version)"
    fi
else
    warn "Node.js belum ada. Menginstall v20 LTS..."
    if [ "$PKG" = "apt" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -q
        sudo apt-get install -y nodejs -q
    elif [ "$PKG" = "yum" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - -q
        sudo yum install -y nodejs -q
    fi
    ok "Node.js installed: $(node --version)"
fi

# ────────────────────────────────────────
# 4. Build tools (wajib untuk better-sqlite3)
# ────────────────────────────────────────
step "4/9 · Build tools (Python, make, g++)"
if [ "$PKG" = "apt" ]; then
    sudo apt-get install -y -q \
        build-essential \
        python3 \
        python3-pip \
        make \
        g++ \
        git \
        curl \
        ca-certificates
    ok "Build tools installed"
elif [ "$PKG" = "yum" ]; then
    sudo yum groupinstall -y "Development Tools" -q
    sudo yum install -y python3 git curl -q
    ok "Build tools installed"
fi

# ────────────────────────────────────────
# 5. Dependensi untuk Sharp (image processing)
# ────────────────────────────────────────
step "5/9 · Dependensi Sharp (libvips, dll)"
# Sharp menggunakan prebuilt binary, tapi butuh library ini di runtime
if [ "$PKG" = "apt" ]; then
    sudo apt-get install -y -q \
        libvips-dev \
        libglib2.0-dev \
        libjpeg-dev \
        libpng-dev \
        libwebp-dev \
        libtiff-dev \
        libexif-dev \
        libgomp1 2>/dev/null || true
    ok "Sharp dependencies installed"
fi

# ────────────────────────────────────────
# 6. Install npm dependencies aplikasi
# ────────────────────────────────────────
step "6/9 · Install npm packages aplikasi"
cd "$APP_DIR"

if [ ! -f "package.json" ]; then
    err "package.json tidak ditemukan di: $APP_DIR"
fi

# Install semua dependency (termasuk tesseract.js, sharp, better-sqlite3, dll)
npm install --omit=dev

# Verifikasi modul penting
echo "  Memeriksa modul..."
node -e "require('express')"        && ok "  express         ✓"
node -e "require('better-sqlite3')" && ok "  better-sqlite3  ✓"
node -e "require('sharp')"          && ok "  sharp           ✓"
node -e "require('tesseract.js')"   && ok "  tesseract.js    ✓"
node -e "require('multer')"         && ok "  multer          ✓"
node -e "require('exifr')"          && ok "  exifr           ✓"

# ────────────────────────────────────────
# 7. Buat folder yang dibutuhkan
# ────────────────────────────────────────
step "7/9 · Membuat folder"
mkdir -p "$APP_DIR/public/uploads"
mkdir -p "$APP_DIR/logs"
chmod 755 "$APP_DIR/public/uploads"
ok "Folder uploads & logs siap"

# Buat .env jika belum ada
if [ ! -f "$APP_DIR/.env" ]; then
    echo "PORT=$PORT" > "$APP_DIR/.env"
    ok "File .env dibuat (PORT=$PORT)"
else
    ok "File .env sudah ada"
fi

# ────────────────────────────────────────
# 8. Install & setup PM2 (process manager)
# ────────────────────────────────────────
step "8/9 · PM2 Process Manager"
if command -v pm2 &>/dev/null; then
    ok "PM2 sudah terinstall: $(pm2 --version)"
else
    sudo npm install -g pm2 -q
    ok "PM2 installed: $(pm2 --version)"
fi

# Buat ecosystem PM2
cat > "$APP_DIR/ecosystem.config.js" << EOFPM2
module.exports = {
  apps: [{
    name: '${APP_NAME}',
    script: 'server.js',
    cwd: '${APP_DIR}',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: ${PORT}
    },
    error_file: '${APP_DIR}/logs/error.log',
    out_file:   '${APP_DIR}/logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
EOFPM2
ok "File ecosystem.config.js dibuat"

# ────────────────────────────────────────
# 9. Start aplikasi
# ────────────────────────────────────────
step "9/9 · Menjalankan aplikasi"

# Stop jika sudah jalan
pm2 stop "$APP_NAME" 2>/dev/null || true
pm2 delete "$APP_NAME" 2>/dev/null || true

# Start
pm2 start ecosystem.config.js
pm2 save

# Auto-start saat server reboot
pm2 startup 2>/dev/null | grep "sudo" | bash 2>/dev/null || true
ok "Aplikasi berjalan dengan PM2"

# ────────────────────────────────────────
# Ringkasan
# ────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Instalasi Selesai!  🎉                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Paket yang terinstall:${NC}"
echo -e "  • Node.js $(node --version)  — runtime server"
echo -e "  • express                 — web server"
echo -e "  • better-sqlite3          — database lokal"
echo -e "  • sharp                   — crop & proses gambar untuk OCR"
echo -e "  • tesseract.js            — OCR ekstrak teks watermark"
echo -e "  • multer                  — upload foto"
echo -e "  • exifr                   — baca GPS dari EXIF foto"
echo -e "  • PM2                     — process manager (auto-restart)"
echo ""
echo -e "${BLUE}Akses Aplikasi:${NC}"
echo -e "  📷 Kamera : ${YELLOW}http://YOUR_SERVER_IP:$PORT/${NC}"
echo -e "  🖼️  Galeri  : ${YELLOW}http://YOUR_SERVER_IP:$PORT/gallery${NC}"
echo -e "  🔌 API    : ${YELLOW}http://YOUR_SERVER_IP:$PORT/api/photos${NC}"
echo ""
echo -e "${BLUE}Perintah berguna:${NC}"
echo -e "  ${YELLOW}pm2 list${NC}                      — lihat status"
echo -e "  ${YELLOW}pm2 logs $APP_NAME${NC}     — lihat log real-time"
echo -e "  ${YELLOW}pm2 restart $APP_NAME${NC}  — restart aplikasi"
echo -e "  ${YELLOW}pm2 monit${NC}                     — monitor CPU & RAM"
echo ""
echo -e "${YELLOW}Ganti YOUR_SERVER_IP dengan IP server Anda.${NC}"
echo -e "${GREEN}Selesai!${NC}"
