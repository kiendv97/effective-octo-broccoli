#!/bin/bash

# --- IMPROVED UPDATE CONFIG SCRIPT ---

DOMAIN=$1
TOKEN1=$2
CHAT1=$3
TOKEN2=$4
CHAT2=$5

if [ -z "$DOMAIN" ] || [ -z "$TOKEN1" ] || [ -z "$CHAT1" ]; then
    echo "Usage: ./update_config.sh newdomain.com token1 chat1 [token2] [chat2]"
    exit 1
fi

APP_DIR="/var/www/app"
cd $APP_DIR

# Get current domain from .env (if exists)
OLD_DOMAIN=$(grep ALLOWED_ORIGIN .env | cut -d'/' -f3)

echo "🔄 Updating configuration..."

# 1. Update .env file
echo "📝 Updating .env..."
cat > .env <<EOF
TELEGRAM_BOT_TOKEN_1=$TOKEN1
TELEGRAM_CHAT_ID_1=$CHAT1
TELEGRAM_BOT_TOKEN_2=$TOKEN2
TELEGRAM_CHAT_ID_2=$CHAT2
ALLOWED_ORIGIN=https://$DOMAIN
ANALYTICS_KEY=admin123
PORT=3000
NODE_ENV=production
EOF

# 2. Check if Domain changed
if [ "$DOMAIN" != "$OLD_DOMAIN" ]; then
    echo "🌐 Domain changed from [$OLD_DOMAIN] to [$DOMAIN]. Updating Nginx & SSL..."
    
    # Update Nginx Configuration
    NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"
    cat > $NGINX_CONF <<EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
EOF
    ln -sf $NGINX_CONF /etc/nginx/sites-enabled/
    nginx -t && systemctl restart nginx

    # Setup SSL
    echo "🔐 Setting up SSL for $DOMAIN..."
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --register-unsafely-without-email
else
    echo "✅ Domain is same ($DOMAIN). Skipping Nginx & SSL setup."
fi

# 3. Restart App
echo "▶️ Restarting PM2 app..."
pm2 restart frontend-app

echo "✨ Done! App is updated."
