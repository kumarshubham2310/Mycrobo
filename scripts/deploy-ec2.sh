#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  MyCrobo AWS EC2 Automated Deployment   "
echo "=========================================="

# Detect OS / Package Manager
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
else
  echo "Unsupported package manager. Please use Ubuntu or Amazon Linux."
  exit 1
fi

echo "[1/6] Detected package manager: ${PKG_MGR}. Updating system packages..."
if [ "$PKG_MGR" = "apt" ]; then
  sudo apt-get update -y
  sudo apt-get install -y curl git ufw nginx
elif [ "$PKG_MGR" = "dnf" ]; then
  sudo dnf update -y
  sudo dnf install -y curl git nginx
elif [ "$PKG_MGR" = "yum" ]; then
  sudo yum update -y
  sudo yum install -y curl git nginx
fi

# 2. Install Node.js 22 LTS (Required for node:sqlite & --experimental-strip-types)
echo "[2/6] Installing Node.js 22.x LTS..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  if [ "$PKG_MGR" = "apt" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    sudo "$PKG_MGR" install -y nodejs
  fi
fi

NODE_VERSION=$(node -v)
echo "Node.js version installed: ${NODE_VERSION}"

# 3. Install PM2
echo "[3/6] Installing PM2 process manager..."
sudo npm install -g pm2

# 4. Configure Nginx Reverse Proxy
echo "[4/6] Configuring Nginx reverse proxy..."
sudo rm -f /etc/nginx/conf.d/mycrobo.conf /etc/nginx/conf.d/default.conf || true
if [ "$PKG_MGR" = "apt" ]; then
  NGINX_CONF="/etc/nginx/sites-available/mycrobo"
  sudo tee "${NGINX_CONF}" > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4177;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
EOF
  sudo rm -f /etc/nginx/sites-enabled/* || true
  sudo ln -sf /etc/nginx/sites-available/mycrobo /etc/nginx/sites-enabled/
else
  NGINX_CONF="/etc/nginx/conf.d/mycrobo.conf"
  sudo tee "${NGINX_CONF}" > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4177;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
}
EOF
fi

sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# 5. Configure Firewall (if UFW present)
echo "[5/6] Checking firewall configuration..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH
  sudo ufw allow 'Nginx Full'
  sudo ufw --force enable || true
fi

# 6. Start MyCrobo with PM2
echo "[6/6] Starting MyCrobo Gateway with PM2..."
sudo systemctl stop pm2-root mycrobo || true
sudo systemctl disable pm2-root mycrobo || true
sudo rm -f /etc/systemd/system/pm2-root.service /etc/systemd/system/mycrobo.service || true
sudo systemctl daemon-reload || true
sudo pm2 kill || true
pm2 kill || true
sudo fuser -k -9 4177/tcp || true
sleep 1
sudo fuser -k -9 4177/tcp || true

pm2 delete all || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

echo "=========================================="
echo "  Deployment Complete!                   "
echo "  Access MyCrobo at: http://$(curl -s http://checkip.amazonaws.com) "
echo "=========================================="
