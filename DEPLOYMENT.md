# 🚀 Hướng Dẫn Deploy Lên VPS Ubuntu

Tài liệu này hướng dẫn cách deploy project lên một VPS mới từ đầu.

## 📋 Yêu Cầu
- VPS Ubuntu 22.04 LTS.
- Domain đã trỏ A Record về IP của VPS.
- Thông tin Telegram (Bot Token & Chat ID).

---

## 🛠️ Bước 1: Cài đặt môi trường trên VPS

Kết nối SSH vào VPS và chạy script `setup_vps.sh`:

```bash
# Tạo file script trên VPS
nano setup_vps.sh
# (Copy nội dung file setup_vps.sh từ repo này dán vào)

chmod +x setup_vps.sh
./setup_vps.sh YOUR_DOMAIN.com
```

---

## 📋 Bước 2: Lấy code từ Git

```bash
mkdir -p /var/www/app
cd /var/www/app
git clone YOUR_GIT_REPO_URL .
```

---

## 📋 Bước 3: Cấu hình Environment (.env)

Tạo file `.env` thủ công trên VPS vì file này không được đưa lên Git:

```bash
nano .env
```

Nội dung mẫu:
```env
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_CHAT_ID=YOUR_CHAT_ID
ALLOWED_ORIGIN=https://YOUR_DOMAIN.com
PORT=3000
NODE_ENV=production
```

---

## 📋 Bước 4: Hoàn tất Deployment

Chạy script `finish_deploy.sh` để cài dependencies, chạy PM2 và cấu hình Nginx SSL:

```bash
chmod +x finish_deploy.sh
./finish_deploy.sh YOUR_DOMAIN.com
```

---

## 📝 Quản lý ứng dụng
- **Xem trạng thái**: `pm2 status`
- **Xem logs**: `pm2 logs`
- **Khởi động lại**: `pm2 restart all`
- **Cấu hình Nginx**: `/etc/nginx/sites-available/YOUR_DOMAIN.com`

---

## 💡 Ghi chú cho Server/Domain khác:
Khi dùng cho domain khác:
1. Trỏ DNS Domain mới về IP Server mới.
2. Cập nhật `ALLOWED_ORIGIN` trong file `.env` trên server đó.
3. Chạy các script với tham số là domain mới.
