# Groq API Setup - FREE & BLAZING FAST! ⚡

Bot đã chuyển sang **Groq API** với **Llama 3** - AI miễn phí, cực nhanh (800 tokens/giây), không cần train!

## 🚀 Tại sao chọn Groq?

| Feature | Groq (Llama 3) | Gemini | Wit.ai |
|---------|----------------|--------|--------|
| Tốc độ | ⚡ 800 tokens/s | 🐌 Chậm | ⚡ Nhanh |
| Chi phí | 💰 MIỄN PHÍ | 💰 Có giới hạn | 💰 Miễn phí |
| Training | ✅ Không cần | ❌ Không | ❌ Phải train |
| Hiểu ngữ cảnh | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| Dễ sử dụng | ✅ Cực dễ | ✅ Dễ | ❌ Phức tạp |

## 📝 Cách lấy Groq API Key (MIỄN PHÍ)

### Bước 1: Đăng ký tài khoản
1. Truy cập: https://console.groq.com
2. Click "Sign Up" hoặc "Get Started"
3. Đăng ký bằng:
   - Google account (nhanh nhất)
   - GitHub account
   - Email

### Bước 2: Tạo API Key
1. Sau khi đăng nhập, vào https://console.groq.com/keys
2. Click "Create API Key"
3. Đặt tên cho key (ví dụ: "minecraft-bot")
4. Click "Submit"
5. **QUAN TRỌNG**: Copy API key ngay (chỉ hiện 1 lần!)

### Bước 3: Cấu hình trong .env
Mở file `.env` và thay thế:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Bằng API key vừa copy:

```env
GROQ_API_KEY=gsk_abc123xyz...
```

### Bước 4: Khởi động bot
```bash
npm run dev
```

## ✨ Tính năng

Bot giờ có thể:
- ✅ Trả lời chat tự nhiên với phong cách kawaii
- ✅ Hiểu ngữ cảnh và trả lời thông minh
- ✅ Trả lời câu hỏi (lệnh: "tớ hỏi nè ...")
- ✅ Giúp đỡ task với AI
- ✅ Cực nhanh (< 1 giây response)
- ✅ Hoàn toàn miễn phí

## 🎮 Ví dụ sử dụng

### Chat thông thường
```
Player: hi
Bot: Chào cậu! Hôm nay cậu thế nào? 💕✨

Player: bạn tên gì
Bot: Tớ là Loli, bot Minecraft dễ thương nè~ UwU 💖

Player: cảm ơn
Bot: Không có gì đâu! Tớ luôn sẵn sàng giúp cậu~ 😊💕
```

### Hỏi đáp
```
Player: tớ hỏi nè minecraft có bao nhiêu dimension
Bot: Minecraft có 3 dimension: Overworld, Nether và End nè! ✨

Player: tớ hỏi nè làm sao craft diamond sword
Bot: Cần 2 diamond + 1 stick, xếp dọc trên crafting table nha! ⚔️💎
```

### AI Agent
```
Player: AI hãy giúp tớ tìm diamond
Bot: Okie! Tớ sẽ đào xuống Y=11 để tìm diamond cho cậu nha~ ⛏️💎
```

## 🔧 Troubleshooting

### Bot không phản hồi AI
1. Kiểm tra `GROQ_API_KEY` trong `.env`
2. Xem console log có lỗi không
3. Verify API key tại https://console.groq.com/keys

### API key không hoạt động
1. Đảm bảo copy đúng key (không có khoảng trắng)
2. Key phải bắt đầu bằng `gsk_`
3. Tạo key mới nếu cần

### Rate limit
- Free tier: 30 requests/phút
- Nếu vượt quá, đợi 1 phút rồi thử lại
- Hoặc nâng cấp lên paid plan (rất rẻ)

## 📊 Giới hạn Free Tier

Groq Free Tier cực hào phóng:
- ✅ 30 requests/phút
- ✅ 14,400 tokens/phút
- ✅ Không giới hạn tổng requests
- ✅ Truy cập tất cả models (Llama 3, Mixtral, Gemma)
- ✅ Không cần thẻ tín dụng

## 🎯 Models có sẵn

Bot đang dùng `llama3-8b-8192`:
- ⚡ Cực nhanh: 800 tokens/giây
- 🧠 Thông minh: 8 billion parameters
- 💬 Context: 8,192 tokens
- 💰 Miễn phí

Các model khác:
- `llama3-70b-8192`: Thông minh hơn, chậm hơn (300 tokens/s)
- `mixtral-8x7b-32768`: Context dài hơn (32K tokens)
- `gemma-7b-it`: Nhẹ và nhanh

## 🔗 Links hữu ích

- Console: https://console.groq.com
- API Keys: https://console.groq.com/keys
- Documentation: https://console.groq.com/docs
- Playground: https://console.groq.com/playground
- Rate Limits: https://console.groq.com/settings/limits

## 💡 Tips

1. **Tối ưu response**: Bot đã cấu hình max_tokens=150 để response nhanh
2. **Phong cách kawaii**: System prompt đã được tối ưu cho phong cách loli cute
3. **Fallback**: Nếu API lỗi, bot vẫn trả lời bằng fallback responses
4. **Logging**: Console log chi tiết để debug dễ dàng

## 🎉 Kết luận

Groq API là lựa chọn tốt nhất cho bot Minecraft:
- ✅ Miễn phí hoàn toàn
- ✅ Cực kỳ nhanh
- ✅ Không cần train
- ✅ Dễ sử dụng
- ✅ Hiểu tiếng Việt tốt

Chỉ cần lấy API key và bot sẽ hoạt động ngay! 🚀
