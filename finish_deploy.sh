#!/bin/bash

DOMAIN=$1
APP_DIR="/var/www/app"

if [ -z "$DOMAIN" ]; then
    echo "Usage: ./finish_deploy.sh yourdomain.com"
    exit 1
fi

cd $APP_DIR

# 1. Install dependencies
echo "📦 Installing npm dependencies..."
npm install --production

# 2. Start application with PM2
echo "▶️ Starting app with PM2..."
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 3. Configure Nginx
echo "🛠️ Configuring Nginx for $DOMAIN..."
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

ln -s $NGINX_CONF /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# 4. Setup SSL
echo "🔐 Setting up SSL with Certbot..."
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN

echo "✨ Deployment Finished Successfully!"
echo "Your app should be live at https://$DOMAIN"
pm2 status
