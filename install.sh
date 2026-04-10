#!/bin/bash

# ============================================================
# GeoTagging App - Installation Script for Linux VPS
# ============================================================
# Script ini akan menginstall semua dependencies yang diperlukan
# untuk menjalankan aplikasi GeoTagging di VPS Linux
# ============================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="geotagging-app"
PORT=3000

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   GeoTagging App - VPS Installation Script        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    print_warning "Running as root user"
else
    print_warning "Consider running with sudo privileges if needed"
fi

# Step 1: Update system packages
echo -e "\n${BLUE}[1/7]${NC} Updating system packages..."
if command -v apt-get &> /dev/null; then
    sudo apt-get update -y
    sudo apt-get upgrade -y
    print_status "System packages updated (apt)"
elif command -v yum &> /dev/null; then
    sudo yum update -y
    print_status "System packages updated (yum)"
else
    print_warning "Package manager not recognized, continuing anyway..."
fi

# Step 2: Install Node.js
echo -e "\n${BLUE}[2/7]${NC} Checking Node.js installation..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_status "Node.js already installed: $NODE_VERSION"
else
    print_warning "Node.js not found. Installing Node.js 20.x..."
    
    # Install Node.js from NodeSource
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    
    if command -v node &> /dev/null; then
        print_status "Node.js installed: $(node --version)"
    else
        print_error "Failed to install Node.js"
        exit 1
    fi
fi

# Step 3: Install npm and check dependencies
echo -e "\n${BLUE}[3/7]${NC} Checking npm..."
if command -v npm &> /dev/null; then
    print_status "npm version: $(npm --version)"
else
    print_error "npm not found. Please install npm."
    exit 1
fi

# Step 4: Install build tools (required for native modules like better-sqlite3)
echo -e "\n${BLUE}[4/7]${NC} Installing build tools..."
if command -v apt-get &> /dev/null; then
    sudo apt-get install -y build-essential python3
    print_status "Build tools installed"
elif command -v yum &> /dev/null; then
    sudo yum groupinstall -y "Development Tools"
    sudo yum install -y python3
    print_status "Build tools installed"
else
    print_warning "Could not install build tools, continuing anyway..."
fi

# Step 5: Install PM2 for process management
echo -e "\n${BLUE}[5/7]${NC} Checking PM2..."
if command -v pm2 &> /dev/null; then
    print_status "PM2 already installed: $(pm2 --version)"
else
    print_warning "Installing PM2 for process management..."
    sudo npm install -g pm2
    print_status "PM2 installed"
fi

# Step 6: Install application dependencies
echo -e "\n${BLUE}[6/7]${NC} Installing application dependencies..."
cd "$APP_DIR"

if [ -f "package.json" ]; then
    npm install --production
    print_status "Application dependencies installed"
else
    print_error "package.json not found in $APP_DIR"
    exit 1
fi

# Step 7: Create necessary directories
echo -e "\n${BLUE}[7/7]${NC} Setting up directories..."
mkdir -p "$APP_DIR/public/uploads"
mkdir -p "$APP_DIR/logs"
print_status "Directories created"

# Create .env file if not exists
if [ ! -f "$APP_DIR/.env" ]; then
    echo "PORT=$PORT" > "$APP_DIR/.env"
    print_status "Created .env file with PORT=$PORT"
fi

# Create PM2 ecosystem file
cat > "$APP_DIR/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: '$APP_NAME',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: $PORT
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
EOF
print_status "PM2 ecosystem file created"

# Setup PM2 to start on boot
echo -e "\n${BLUE}Setting up PM2 startup on boot...${NC}"
pm2 startup 2>/dev/null || true
print_status "PM2 startup configured"

# Start the application
echo -e "\n${BLUE}Starting application with PM2...${NC}"
cd "$APP_DIR"
pm2 start ecosystem.config.js
pm2 save
print_status "Application started"

# Setup basic firewall (optional, commented by default)
echo -e "\n${BLUE}Optional: Firewall configuration${NC}"
print_warning "If you need to open port $PORT, run:"
echo -e "  ${YELLOW}sudo ufw allow $PORT/tcp${NC}"
echo -e "  ${YELLOW}sudo ufw reload${NC}"

# Display status
echo -e "\n${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          Installation Complete! 🎉                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"

echo -e "\n${BLUE}Application Details:${NC}"
echo -e "  📍 Directory: $APP_DIR"
echo -e "  🌐 Port: $PORT"
echo -e "  📊 PM2 Status:"
pm2 list

echo -e "\n${BLUE}Useful Commands:${NC}"
echo -e "  ${YELLOW}pm2 status${NC}                  - Check application status"
echo -e "  ${YELLOW}pm2 logs geotagging-app${NC}     - View application logs"
echo -e "  ${YELLOW}pm2 restart geotagging-app${NC}  - Restart application"
echo -e "  ${YELLOW}pm2 stop geotagging-app${NC}     - Stop application"
echo -e "  ${YELLOW}pm2 monit${NC}                   - Monitor application"

echo -e "\n${BLUE}Access Your Application:${NC}"
echo -e "  📷 Camera: http://YOUR_SERVER_IP:$PORT/"
echo -e "  🖼️ Gallery: http://YOUR_SERVER_IP:$PORT/gallery"
echo -e "  🔌 API: http://YOUR_SERVER_IP:$PORT/api/photos"

echo -e "\n${GREEN}Installation completed successfully!${NC}"
echo -e "${YELLOW}Remember to replace YOUR_SERVER_IP with your actual VPS IP address${NC}"
