#!/bin/bash

# --- CONFIGURATION ---
APP_DIR="/var/www/app"
DOMAIN=$1

if [ -z "$DOMAIN" ]; then
    echo "Usage: ./deploy.sh yourdomain.com"
    exit 1
fi

echo "🚀 Starting deployment for $DOMAIN..."

# 1. Update system
echo "🔄 Updating system..."
apt update && apt upgrade -y

# 2. Install Node.js 20
echo "🟢 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 3. Install PM2
echo "⚙️ Installing PM2..."
npm install -g pm2

# 4. Install Nginx
echo "🌐 Installing Nginx..."
apt install -y nginx
systemctl enable nginx
systemctl start nginx

# 5. Install Certbot
echo "🔒 Installing Certbot..."
apt install -y certbot python3-certbot-nginx

# 6. Create App Directory
echo "📂 Creating app directory at $APP_DIR..."
mkdir -p $APP_DIR
chown -R $USER:$USER $APP_DIR

echo "✅ Environment setup complete!"
echo "👉 Now, please upload your code to $APP_DIR on the server."
echo "You can use this command from your local machine:"
echo "scp -r ./* root@103.75.183.40:$APP_DIR"
echo ""
echo "After uploading, run: ./finish_deploy.sh $DOMAIN"
