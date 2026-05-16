## 🔥 Lệnh Deploy Tự Động 100% (Full Auto)

Chỉ cần copy lệnh này, thay đổi 3 thông số ở đầu và dán vào VPS (Root). Website sẽ live sau 2 phút:

```bash
export DOMAIN="yourdomain.com" && \
export TOKEN1="your_bot_token_1" && \
export CHAT1="your_chat_id_1" && \
export TOKEN2="your_bot_token_2" && \
export CHAT2="your_chat_id_2" && \
export A_KEY="admin123" && \
curl -sSL https://raw.githubusercontent.com/kiendv97/effective-octo-broccoli/main/setup_vps.sh | bash -s $DOMAIN && \
rm -rf /var/www/app && mkdir -p /var/www/app && cd /var/www/app && \
git clone https://github.com/kiendv97/effective-octo-broccoli.git . && \
echo -e "TELEGRAM_BOT_TOKEN_1=$TOKEN1\nTELEGRAM_CHAT_ID_1=$CHAT1\nTELEGRAM_BOT_TOKEN_2=$TOKEN2\nTELEGRAM_CHAT_ID_2=$CHAT2\nALLOWED_ORIGIN=https://$DOMAIN\nANALYTICS_KEY=$A_KEY\nPORT=3000\nNODE_ENV=production" > .env && \
chmod +x finish_deploy.sh && ./finish_deploy.sh $DOMAIN
```

---

## 🚀 Lệnh Cài Đặt Nhanh (Setup & Clone)

Nếu bạn muốn tự động hóa Bước 1 và Bước 2, hãy copy và chạy lệnh duy nhất này trên VPS:

```bash
curl -sSL https://raw.githubusercontent.com/kiendv97/effective-octo-broccoli/main/setup_vps.sh | bash -s yourdomain.com && rm -rf /var/www/app && mkdir -p /var/www/app && cd /var/www/app && git clone https://github.com/kiendv97/effective-octo-broccoli.git .
```
*(Thay `yourdomain.com` bằng domain thật của bạn)*

---

## 🛠️ Bước 1: Cài đặt môi trường trên VPS (Thủ công)

```bash
rm -rf /var/www/app && mkdir -p /var/www/app && cd /var/www/app
git clone https://github.com/kiendv97/effective-octo-broccoli.git .
```

---

## 📋 Bước 3: Cấu hình Environment (.env)

Tạo file `.env` thủ công trên VPS vì file này không được đưa lên Git. Sử dụng file `.env.example` để làm mẫu.

```bash
nano .env
```

Nội dung mẫu:
```env
TELEGRAM_BOT_TOKEN_1=your_bot_token_1
TELEGRAM_CHAT_ID_1=your_chat_id_1

# Có thể thêm token 2 nếu cần
TELEGRAM_BOT_TOKEN_2=your_bot_token_2
TELEGRAM_CHAT_ID_2=your_chat_id_2

ALLOWED_ORIGIN=https://yourdomain.com
PORT=3000
NODE_ENV=production
```

---

## 📋 Bước 4: Hoàn tất Deployment

Chạy script `finish_deploy.sh` để cài dependencies, chạy PM2 và cấu hình Nginx SSL:

```bash
chmod +x finish_deploy.sh
./finish_deploy.sh yourdomain.com
```

---

## ⚡ Đổi Nhanh Domain/Token (Khi Domain die)

Nếu bạn cần đổi nhanh sang Domain mới hoặc đổi Token Telegram mà không muốn cài lại từ đầu:

1. Trỏ DNS của Domain mới về IP VPS.
2. Chạy lệnh sau trên VPS:
```bash
cd /var/www/app && chmod +x update_config.sh && ./update_config.sh newdomain.com token1 chat1 token2 chat2
```

Script này sẽ tự động cập nhật `.env`, cấu hình lại Nginx, cài SSL mới và restart app.

---

## 🔄 Quy trình Cập nhật Code (Update)

Khi bạn có thay đổi code ở máy local và muốn cập nhật lên server:

### 1. Tại máy Local:
```powershell
git add .
git commit -m "Ghi chú thay đổi"
git push origin main
```

### 2. Tại Server (VPS):
```bash
cd /var/www/app
git pull origin main

# Nếu có cài thêm thư viện mới:
npm install --production

# Restart ứng dụng:
pm2 restart frontend-app
```

---

## 📝 Quản lý ứng dụng
- **Xem trạng thái**: `pm2 status`
- **Xem logs**: `pm2 logs`
- **Khởi động lại**: `pm2 restart frontend-app`
- **Dừng app**: `pm2 stop frontend-app`
