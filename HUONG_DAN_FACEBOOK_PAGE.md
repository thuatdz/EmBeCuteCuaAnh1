# 📱 Hướng Dẫn Kết Nối Facebook Page với Bot

## 🎯 Tại Sao Dùng Facebook Page?

Facebook Page API là API chính thức từ Facebook, ổn định và không bị chặn như unofficial API.

✅ **Ưu điểm:**
- API chính thức, ổn định
- Không cần appstate (cookie)
- Không bị lỗi "Not logged in"
- Token có thể dùng lâu dài (không hết hạn)

---

## 📋 Yêu Cầu

1. **Facebook Page** (tạo page miễn phí)
2. **Facebook Developer App** (miễn phí)
3. **Page Access Token**
4. **Facebook User ID** của người nhận tin

---

## 🔧 Các Bước Setup

### Bước 1: Tạo Facebook Page (Nếu Chưa Có)

1. Vào https://www.facebook.com/pages/create
2. Chọn loại page (ví dụ: "Cộng đồng" hoặc "Thương hiệu")
3. Đặt tên page (ví dụ: "Bot Minecraft")
4. Tạo page

### Bước 2: Tạo Facebook Developer App

1. Vào https://developers.facebook.com/apps
2. Click **"Create App"** (Tạo ứng dụng)
3. Chọn **"Business"** hoặc **"Other"**
4. Điền thông tin:
   - App Name: `Minecraft Bot` (tên tùy ý)
   - App Contact Email: email của bạn
5. Click **"Create App"**

### Bước 3: Thêm Messenger Product

1. Trong dashboard của app, tìm **"Messenger"**
2. Click **"Set Up"** hoặc **"Add Product"**
3. Chọn **"Messenger"**

### Bước 4: Lấy Page Access Token

1. Trong Messenger settings, tìm phần **"Access Tokens"**
2. Click **"Add or Remove Pages"**
3. Chọn page bạn vừa tạo
4. Cấp quyền cho app
5. Quay lại Messenger settings
6. Trong phần **"Access Tokens"**, chọn page của bạn
7. Click **"Generate Token"**
8. Copy token (dạng: `EAAxxxxxxxxxxxxx...`)

⚠️ **LƯU Ý:** Token này rất quan trọng, KHÔNG chia sẻ với ai!

### Bước 5: Lấy Page ID

**Cách 1: Từ Page Settings**
1. Vào page của bạn
2. Click **"Settings"** (Cài đặt)
3. Chọn **"About"** (Giới thiệu)
4. Xem **"Page ID"**

**Cách 2: Từ URL**
1. Vào page của bạn
2. Xem URL: `https://www.facebook.com/profile.php?id=123456789`
3. Số `123456789` là Page ID

**Cách 3: Dùng Graph API Explorer**
1. Vào https://developers.facebook.com/tools/explorer
2. Chọn app của bạn
3. Chọn page access token
4. Gọi API: `me?fields=id,name`
5. Xem kết quả

### Bước 6: Lấy Facebook User ID (Người Nhận Tin)

**Cách 1: Từ Profile**
1. Vào profile Facebook của bạn
2. Xem URL: `https://www.facebook.com/profile.php?id=61587614518604`
3. Số `61587614518604` là User ID

**Cách 2: Dùng Tool**
1. Vào https://findmyfbid.com/
2. Paste link profile của bạn
3. Lấy User ID

### Bước 7: Cấu Hình .env

Thêm vào file `.env`:

\`\`\`env
# Facebook Page API Configuration
FB_PAGE_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FB_PAGE_ID=123456789012345
FB_RECIPIENT_ID=61587614518604
\`\`\`

**Giải thích:**
- `FB_PAGE_ACCESS_TOKEN`: Token từ bước 4
- `FB_PAGE_ID`: Page ID từ bước 5
- `FB_RECIPIENT_ID`: User ID của bạn (người nhận tin)

---

## 🚀 Chạy Bot

Sau khi cấu hình xong:

\`\`\`bash
npm run bot
\`\`\`

Bot sẽ:
1. Kết nối vào Minecraft server
2. Sau 9 giây, kết nối Facebook Page
3. Gửi tin nhắn tới User ID của bạn qua Page

---

## 📱 Nhận Tin Nhắn

Để nhận tin nhắn từ Page:

1. Vào Messenger
2. Tìm page của bạn
3. Gửi tin "Hello" để bắt đầu chat
4. Bot sẽ gửi thông báo qua đây

**Lưu ý:** Bạn phải gửi tin cho page trước thì page mới có thể gửi tin lại cho bạn (Facebook policy).

---

## 🔍 Kiểm Tra

Xem log khi bot chạy:

\`\`\`
✅ Đã kết nối Facebook Page: Bot Minecraft (ID: 123456789)
✅ Facebook Page đã kết nối thành công
✅ Đã gửi tin qua Facebook Page tới 61587614518604
\`\`\`

---

## ⚠️ Xử Lý Lỗi

### Lỗi: "Page Access Token không hợp lệ"
➡️ Token sai hoặc hết hạn, lấy lại token mới

### Lỗi: "FB_PAGE_ACCESS_TOKEN chưa được cấu hình"
➡️ Kiểm tra file `.env` có đúng không

### Lỗi: "Cannot send message to this user"
➡️ User phải gửi tin cho page trước (Facebook policy)
➡️ Vào Messenger, tìm page và gửi tin "Hello"

### Token hết hạn sau vài tháng
➡️ Tạo **Long-lived Token** (60 ngày) hoặc **Never-expire Token**

---

## 🔒 Tạo Long-Lived Token (Không Hết Hạn)

### Cách 1: Dùng Graph API Explorer

1. Vào https://developers.facebook.com/tools/explorer
2. Chọn app của bạn
3. Chọn page access token
4. Click **"Generate Access Token"**
5. Cấp quyền: `pages_messaging`, `pages_manage_metadata`
6. Copy token

### Cách 2: Dùng API

Gọi API này để chuyển short-lived token thành long-lived token:

\`\`\`
https://graph.facebook.com/v18.0/oauth/access_token?
  grant_type=fb_exchange_token&
  client_id={app-id}&
  client_secret={app-secret}&
  fb_exchange_token={short-lived-token}
\`\`\`

Thay:
- `{app-id}`: App ID từ dashboard
- `{app-secret}`: App Secret từ dashboard
- `{short-lived-token}`: Token hiện tại

---

## 🎉 Hoàn Tất!

Bây giờ bot sẽ gửi thông báo qua Facebook Page khi:
- ✅ Bot kết nối thành công vào server
- 💬 Có sự kiện quan trọng trong game
- 🎮 Bot chết, respawn, v.v.

Ổn định và không bị lỗi "Not logged in" nữa! 🚀
