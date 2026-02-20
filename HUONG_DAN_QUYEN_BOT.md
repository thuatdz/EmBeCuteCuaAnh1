# Hướng Dẫn Quản Lý Quyền Điều Khiển Bot

## Tổng Quan

Bot đã được cập nhật với hệ thống xác thực người chơi. Chỉ những người chơi có tên trong danh sách `server.namgt68` mới có thể ra lệnh điều khiển bot.

## Cách Hoạt Động

### 1. File Danh Sách Người Chơi

File `server.namgt68` chứa danh sách người chơi được phép điều khiển bot.

**Vị trí:** Thư mục gốc của project (cùng cấp với file `.env`)

**Cấu trúc:**
```
# Danh sách người chơi được phép điều khiển bot
# Mỗi dòng là một tên người chơi
# Bot sẽ so sánh tên với độ tương đồng 98%

namgt68
PlayerName2
AnotherPlayer
```

### 2. Độ Tương Đồng 98%

Bot sử dụng thuật toán Levenshtein Distance để so sánh tên người chơi với độ chính xác 98%. Điều này có nghĩa:

- ✅ `namgt68` khớp với `namgt68` (100%)
- ✅ `namgt68` khớp với `Namgt68` (100% - không phân biệt hoa thường)
- ✅ `namgt68` khớp với `namgt6` (98.5%)
- ❌ `namgt68` KHÔNG khớp với `player123` (0%)

### 3. Các Lệnh Được Bảo Vệ

Tất cả các lệnh điều khiển bot đều yêu cầu xác thực:

- `theo`, `bảo vệ`
- `dừng`, `stop`
- `farm`, `câu`, `fishing`
- `auto mine`, `auto đào`
- `auto xây`, `dừng xây`
- `auto tìm rương`, `auto chest`
- `auto explore`, `tự khám phá`
- `auto thu thập`, `thu thập`
- `auto farmer`, `crop farm`
- `pvp <tên>`
- `ngủ`, `cần`, `cất đồ`
- `home`, `về nhà`
- `spam attack`
- `en <công cụ>`
- `AI <yêu cầu>`

### 4. Hành Vi Bot

**Khi người chơi ĐƯỢC PHÉP:**
- Bot thực hiện lệnh bình thường
- Log console: `✅ Player "namgt68" có quyền điều khiển bot`

**Khi người chơi KHÔNG ĐƯỢC PHÉP:**
- Bot hoàn toàn im lặng (không phản hồi gì)
- Log console: `🚫 Player "unauthorized_player" không có quyền điều khiển bot`
- Bot vẫn trả lời chat thường (không phải lệnh) bằng AI

### 5. Chat Thường vs Lệnh Điều Khiển

- **Chat thường:** Bot vẫn trả lời tất cả mọi người bằng AI (không cần quyền)
- **Lệnh điều khiển:** Chỉ người trong danh sách mới được thực hiện

**Ví dụ:**
```
Player1: "Xin chào bot!"
Bot: "Chào bạn! Tôi có thể giúp gì cho bạn?"  ✅ (chat thường)

Player1: "theo tớ"
Bot: (im lặng)  ❌ (lệnh điều khiển - không có quyền)

namgt68: "theo tớ"
Bot: "❤️ Tớ sẽ theo cậu đến cùng trời cuối đất!"  ✅ (có quyền)
```

## Cách Thêm/Xóa Người Chơi

### Thêm Người Chơi Mới

1. Mở file `server.namgt68`
2. Thêm tên người chơi vào dòng mới
3. Lưu file
4. Khởi động lại bot

**Ví dụ:**
```
namgt68
NewPlayer123
AnotherFriend
```

### Xóa Người Chơi

1. Mở file `server.namgt68`
2. Xóa dòng chứa tên người chơi
3. Lưu file
4. Khởi động lại bot

### Cho Phép Tất Cả (Tắt Xác Thực)

Nếu muốn tất cả người chơi đều có thể điều khiển bot:

1. Xóa file `server.namgt68` HOẶC
2. Để file rỗng (chỉ có comment)

## Kiểm Tra Log

Khi bot khởi động, bạn sẽ thấy:
```
✅ Đã tải 1 người chơi được phép: [ 'namgt68' ]
```

Khi có người ra lệnh:
```
🔍 So sánh "namgt68" với "namgt68": 100.00%
✅ Player "namgt68" được phép điều khiển bot (100.00% khớp)
```

Hoặc:
```
🔍 So sánh "hacker123" với "namgt68": 12.50%
❌ Player "hacker123" KHÔNG được phép điều khiển bot
🚫 Player "hacker123" không có quyền điều khiển bot
```

## Lưu Ý Quan Trọng

1. **Tên không phân biệt hoa thường:** `NAMGT68`, `namgt68`, `NaMgT68` đều giống nhau
2. **Độ chính xác 98%:** Cho phép sai lệch nhỏ (1-2 ký tự)
3. **Bot im lặng:** Người không có quyền sẽ không nhận được bất kỳ phản hồi nào từ lệnh
4. **Chat AI vẫn hoạt động:** Mọi người vẫn có thể chat thường với bot
5. **Khởi động lại:** Cần khởi động lại bot sau khi sửa file `server.namgt68`

## Troubleshooting

### Bot không phản hồi lệnh của tôi

1. Kiểm tra tên của bạn có trong file `server.namgt68` không
2. Kiểm tra chính tả tên (phải khớp 98%)
3. Xem log console để kiểm tra độ tương đồng
4. Khởi động lại bot sau khi sửa file

### Bot phản hồi tất cả mọi người

1. Kiểm tra file `server.namgt68` có tồn tại không
2. Kiểm tra file có nội dung không (không rỗng)
3. Xem log khi bot khởi động: `✅ Đã tải X người chơi được phép`

### Muốn thêm nhiều người

Mỗi người một dòng trong file `server.namgt68`:
```
namgt68
Friend1
Friend2
Friend3
```

## Ví Dụ Thực Tế

**File server.namgt68:**
```
# Chủ server
namgt68

# Bạn bè
PlayerABC
MinecraftPro
```

**Kết quả:**
- `namgt68` → ✅ Có quyền
- `PlayerABC` → ✅ Có quyền  
- `MinecraftPro` → ✅ Có quyền
- `RandomPlayer` → ❌ Không có quyền
- `Hacker123` → ❌ Không có quyền
