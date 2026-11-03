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
  sudo apt-get install -y curl git ufw nginx golang-go certbot python3-certbot-nginx
elif [ "$PKG_MGR" = "dnf" ]; then
  sudo dnf update -y
  sudo dnf install -y curl git nginx golang certbot python3-certbot-nginx
elif [ "$PKG_MGR" = "yum" ]; then
  sudo yum update -y
  sudo yum install -y epel-release || true
  sudo yum install -y curl git nginx golang certbot python3-certbot-nginx
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

# 3. Build & ensure live WhatsApp bridge binary is ready
echo "[3/6] Ensuring WhatsApp live bridge binary is built..."
chmod +x bin/mycrobo-live-bridge 2>/dev/null || true
if [ ! -f bin/mycrobo-live-bridge ] || [ ! -s bin/mycrobo-live-bridge ]; then
  if command -v go >/dev/null 2>&1; then
    echo "Compiling bin/mycrobo-live-bridge from Go source..."
    (cd services/whatsapp-bridge && go build -trimpath -o ../../bin/mycrobo-live-bridge ./cmd/livebridge)
  fi
fi
chmod +x bin/mycrobo-live-bridge 2>/dev/null || true

# 3b. Ensure public website static export exists and is up-to-date
if [ -d "apps/public_html/legacy-export" ]; then
  echo "Syncing public website static export from legacy-export to out..."
  mkdir -p apps/public_html/out
  cp -r apps/public_html/legacy-export/. apps/public_html/out/
fi

# 4. Configure Nginx Reverse Proxy
echo "[4/6] Configuring Nginx reverse proxy..."
sudo rm -f /etc/nginx/conf.d/mycrobo.conf /etc/nginx/conf.d/default.conf || true
if [ "$PKG_MGR" = "apt" ]; then
  NGINX_CONF="/etc/nginx/sites-available/mycrobo"
  sudo tee "${NGINX_CONF}" > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name mycrobo.com www.mycrobo.com _;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4177;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
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

    server_name mycrobo.com www.mycrobo.com _;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:4177;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
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

# 5. Configure Firewall & Automated SSL Certificate
echo "[5/6] Checking firewall configuration & SSL certificate..."
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow OpenSSH || true
  sudo ufw allow 'Nginx Full' || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw --force enable || true
fi

# Attempt automatic SSL certificate if mycrobo.com resolves to this machine
if command -v certbot >/dev/null 2>&1; then
  echo "Checking DNS resolution for automated SSL certificate..."
  MY_IP=$(curl -s http://checkip.amazonaws.com || curl -s https://ifconfig.me || echo "")
  RESOLVED_IP=$(dig +short mycrobo.com 2>/dev/null || getent ahosts mycrobo.com 2>/dev/null | awk '{print $1}' | head -n 1 || echo "")
  if [ -n "$MY_IP" ] && [ "$MY_IP" = "$RESOLVED_IP" ]; then
    echo "Domain mycrobo.com points to this server IP (${MY_IP}). Requesting Let's Encrypt SSL certificate..."
    sudo certbot --nginx -d mycrobo.com --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
    sudo systemctl reload nginx || true
  else
    echo "Notice: mycrobo.com DNS does not match local IP yet (${RESOLVED_IP} vs ${MY_IP}). Skipping automatic Certbot."
  fi
fi

# 6. Start MyCrobo Service with Systemd (Starts live bridge + gateway)
echo "[6/6] Configuring MyCrobo systemd service..."
pm2 kill || true 2>/dev/null
sudo pm2 kill || true 2>/dev/null
sudo systemctl stop pm2-ubuntu pm2-root || true 2>/dev/null
sudo systemctl disable pm2-ubuntu pm2-root || true 2>/dev/null
sudo rm -f /etc/systemd/system/pm2-*.service || true
sudo fuser -k -9 4177/tcp || true 2>/dev/null
sleep 1

NODE_BIN=$(command -v node)
PROJECT_DIR="$(pwd)"

sudo tee /etc/systemd/system/mycrobo.service > /dev/null << EOF
[Unit]
Description=MyCrobo Web Gateway and WhatsApp Live Bridge
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} scripts/start-web.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=MYCROBO_GATEWAY_PORT=4177

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable mycrobo
sudo systemctl restart mycrobo

sleep 4
echo "Verifying local gateway status..."
curl -s http://127.0.0.1:4177/api/v1/status || true
echo ""

echo "=========================================="
echo "  Deployment Complete!                   "
echo "  Access MyCrobo at: http://$(curl -s http://checkip.amazonaws.com) "
echo "=========================================="
