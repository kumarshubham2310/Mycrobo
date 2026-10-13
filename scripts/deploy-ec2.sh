#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  MyCrobo AWS EC2 Automated Deployment   "
echo "=========================================="

# 1. Update system
echo "[1/6] Updating system packages..."
sudo apt-get update -y
sudo apt-get install -y curl git ufw nginx

# 2. Install Node.js 22 LTS (Required for node:sqlite & --experimental-strip-types)
echo "[2/6] Installing Node.js 22.x LTS..."
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

NODE_VERSION=$(node -v)
echo "Node.js version installed: ${NODE_VERSION}"

# 3. Install PM2
echo "[3/6] Installing PM2 process manager..."
sudo npm install -g pm2

# 4. Configure Nginx Reverse Proxy
echo "[4/6] Configuring Nginx reverse proxy..."
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
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/mycrobo /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# 5. Configure Firewall
echo "[5/6] Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable || true

# 6. Start MyCrobo with PM2
echo "[6/6] Starting MyCrobo Gateway with PM2..."
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | bash || true

echo "=========================================="
echo "  Deployment Complete!                   "
echo "  Access MyCrobo at: http://$(curl -s http://checkip.amazonaws.com) "
echo "=========================================="
