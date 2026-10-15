#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "  MyCrobo SSL / HTTPS Automated Setup     "
echo "=========================================="

DOMAIN="mycrobo.com"

# 1. Detect package manager & install Certbot
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
  echo "Installing certbot and python3-certbot-nginx via apt..."
  sudo apt-get update -y
  sudo apt-get install -y certbot python3-certbot-nginx
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
  echo "Installing certbot and python3-certbot-nginx via dnf..."
  sudo dnf install -y certbot python3-certbot-nginx
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
  echo "Installing certbot and python3-certbot-nginx via yum..."
  sudo yum install -y epel-release || true
  sudo yum install -y certbot python3-certbot-nginx
else
  echo "Unsupported package manager. Please run on Ubuntu or Amazon Linux."
  exit 1
fi

# 2. Allow port 80 and 443 in UFW if present
if command -v ufw >/dev/null 2>&1; then
  echo "Configuring firewall to allow HTTP (80) and HTTPS (443)..."
  sudo ufw allow OpenSSH || true
  sudo ufw allow 'Nginx Full' || true
  sudo ufw allow 80/tcp || true
  sudo ufw allow 443/tcp || true
  sudo ufw --force enable || true
fi

# 3. Configure Nginx with domain names
echo "Updating Nginx configuration with server_name ${DOMAIN}..."
sudo rm -f /etc/nginx/conf.d/mycrobo.conf /etc/nginx/conf.d/default.conf || true

if [ "$PKG_MGR" = "apt" ]; then
  NGINX_CONF="/etc/nginx/sites-available/mycrobo"
  sudo tee "${NGINX_CONF}" > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;

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
    listen 80;
    listen [::]:80;

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
sudo systemctl reload nginx

# 4. Request Let's Encrypt SSL Certificate
echo "Requesting Let's Encrypt SSL certificate for ${DOMAIN}..."
CERT_DOMAINS="-d ${DOMAIN}"

# Check if www.mycrobo.com also points to this server
MY_IP=$(curl -s http://checkip.amazonaws.com || curl -s https://ifconfig.me || echo "")
WWW_IP=$(dig +short www.${DOMAIN} 2>/dev/null || getent ahosts www.${DOMAIN} 2>/dev/null | awk '{print $1}' | head -n 1 || echo "")

if [ -n "$MY_IP" ] && [ "$MY_IP" = "$WWW_IP" ]; then
  echo "www.${DOMAIN} points to this server IP (${MY_IP}). Including www in SSL certificate."
  CERT_DOMAINS="-d ${DOMAIN} -d www.${DOMAIN}"
else
  echo "Notice: www.${DOMAIN} does not point to this server yet. Requesting SSL certificate for ${DOMAIN} only."
fi

sudo certbot --nginx ${CERT_DOMAINS} --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
  echo "WARNING: Automated certbot provisioning failed."
  echo "Please verify that AWS EC2 Security Group allows Inbound Port 443 (HTTPS) and Port 80 (HTTP)."
  echo "You can re-run manually: sudo certbot --nginx -d ${DOMAIN}"
}

sudo systemctl reload nginx

echo "=========================================="
echo "  HTTPS / SSL Configuration Finished!     "
echo "  Test in browser: https://${DOMAIN}      "
echo "=========================================="
