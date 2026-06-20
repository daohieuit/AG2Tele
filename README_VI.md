# 🌉 AntiBridge - Antigravity Telegram Remote

> Điều khiển Antigravity IDE từ xa qua Telegram — Chat AI, giám sát quota, và nhiều hơn thế.

[English Version](README.md)

---

## 📚 Tài Liệu Hướng Dẫn

- [Tổng quan kiến trúc](docs/vi/architecture.md)
- [Hướng dẫn cấu hình](docs/vi/configuration.md)
- [Danh sách lệnh Telegram](docs/vi/telegram_commands.md)
- [Hướng dẫn đóng góp phát triển](docs/vi/contributing.md)

---

## ✨ Tính Năng

| Tính năng | Mô tả |
|-----------|-------|
| 💬 **Chat 2 chiều** | Gửi tin nhắn từ Telegram → Antigravity, nhận câu trả lời AI ngay trên Telegram |
| 📝 **Single Message** | Mọi update (thinking, streaming, final) trên **1 tin nhắn duy nhất** — không spam |
| 🔧 **CDP Injection** | Gửi lệnh qua Chrome DevTools Protocol — không chiếm chuột, không minimize cửa sổ |
| 📊 **Quota Monitor** | Xem % sử dụng các model AI (Claude, Gemini, GPT) qua API nội bộ |
| 🔄 **Auto Monitor** | Tự động check quota mỗi 5 phút, **chỉ ghi log khi có thay đổi** |
| 📜 **Quota History** | Xem lịch sử cộng/trừ quota với `/history_quota` — theo dõi delta |
| ⏱️ **Smart Polling** | Tự động điều chỉnh tốc độ polling (nhanh 3s → chậm 10s, tối đa 15 phút) |
| 🤖 **Đổi Model** | Chuyển đổi model AI ngay trên Telegram với `/model` |
| 📸 **Screenshot** | Chụp ảnh Antigravity IDE gửi về Telegram |
| 🗂️ **Conversations** | Chuyển đổi qua lại giữa các cuộc trò chuyện đang mở với `/conversations` |
| 📂 **Open Project** | Duyệt file system và mở dự án khác từ xa với `/open` |
| ⚡ **Skills** | Chạy các workflow/skill từ folder `.agent/workflows` với `/skills` |

---

## 🙏 Credits & Tác Giả

Dự án này được phát triển dựa trên nền tảng [AntiBridge-Antigravity-remote](https://github.com/linhbq82/AntiBridge-Antigravity-remote) của **linhbq82**.

- **Tác giả gốc**: [linhbq82](https://github.com/linhbq82)
- **Người đóng góp**: [Linh Bui](https://github.com/linhbq82), [Nhqvu2005](https://github.com/Nhqvu2005)
- **Người duy trì / Đồng tác giả**: **DaoHieuIT**

Xin chân thành cảm ơn tất cả những người đóng góp trước đây đã tạo dựng nền móng vững chắc cho công cụ điều khiển từ xa tuyệt vời này. Dự án hiện được duy trì và phát triển thêm các tính năng nâng cao bởi DaoHieuIT.

---

## 📦 Cài Đặt

### Yêu cầu
- **Node.js** v18 trở lên
- **Antigravity IDE** (Bot sẽ tự động khởi động và cấu hình cổng debug 9000)

### Hướng dẫn

1. Tải và giải nén thư mục dự án.
2. Chạy tệp `SETUP.bat` để tự động cài đặt các thư viện cần thiết.
3. Cấu hình tệp `.env`:
   - Tạo file `.env` từ `.env.example`.
   - Điền thông tin `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`.
   - Cài đặt `DISABLE_SAFE_ROLLBACK=true` nếu muốn bảo vệ các chỉnh sửa code cục bộ.

### Khởi chạy & Tắt Bot

- **Khởi động một chạm ngầm:**
  - Double-click vào tệp `START_ALL_SILENT.vbs` ở thư mục gốc.
  - Bot sẽ tự động tắt các phiên bản IDE lỗi (không bật debug), bật lại IDE kèm cổng debug, và chạy server ẩn dưới nền.
- **Tắt bot hoàn toàn:**
  - Chạy tệp `KILL_SERVER.bat` (hoặc `KILL_SERVER_ADMIN.vbs` để chạy quyền Admin).
  - Tệp script mới sẽ quét và tắt sạch vòng lặp bot, safe-startup, server và giải phóng port 8000.
- **Khởi động nhanh từ Start Menu (Tiện lợi khi Remote):**
  - Khi chạy `SETUP.bat`, chọn `Y` khi được hỏi để tạo thư mục phím tắt trong Start Menu.
  - Từ đó, bạn chỉ cần mở Start Menu, gõ tìm **`AG2Tele - Start`** để bật hoặc **`AG2Tele - Stop`** để tắt.


**Hoặc chạy debug trực tiếp qua terminal:**
```bash
npm start
# hoặc chế độ watch code thay đổi
npm run dev
```

---

## 🎮 Các Lệnh Telegram

| Lệnh | Mô tả |
|-------|-------|
| `/start` | 👋 Khởi động bot, kiểm tra kết nối |
| `/status` | 📊 Trạng thái kết nối tới Antigravity |
| `/quota` | 📊 Xem quota model AI (realtime + lưu history) |
| `/history_quota` | 📜 Xem lịch sử thay đổi quota (cộng/trừ) |
| `/model` | 🎨 Đổi model AI (Claude, Gemini, GPT...) |
| `/stop` | ⏹️ Dừng AI đang trả lời |
| `/screenshot` | 📸 Chụp ảnh màn hình Antigravity |
| `/reconnect` | 🔄 Kết nối lại CDP |
| `/clear` | 🗑️ Xóa lịch sử chat |
| `/accept` | ✅ Accept action hiện tại |
| `/accept` | ✅ Accept action hiện tại |
| `/reject` | ❌ Reject action hiện tại |
| `/conversations` | 🗂️ Danh sách và chuyển đổi cuộc trò chuyện |
| `/open` | 📂 Duyệt file và mở dự án (Folder) |
| `/workflows` | ⚡ Chạy Workflow (file .md trong .agent/workflows) |
| `/skills` | 🛠️ Chạy Skill (folder trong .agent/skills) |
| `/endtask` | 🔴 Tắt Antigravity từ xa |

---

## 🛠️ Xử Lý Sự Cố

| Lỗi | Giải pháp |
|-----|-----------|
| `CDP Chat context NOT found` | Đảm bảo Antigravity đang mở và bạn đã login. Thử `/reconnect`. |
| `Không nhận được tin nhắn` | Kiểm tra `TELEGRAM_CHAT_ID` trong `.env` có đúng không. |
| `Bot không phản hồi` | Kiểm tra `TELEGRAM_BOT_TOKEN` và chạy lại bằng `npm start`. |
| `Cổng 8000 bị bận (busy)` | Chạy tệp `KILL_SERVER.bat` để tắt sạch bot chạy ngầm và giải phóng cổng. |

---

## 📄 License

MIT — Xem file [LICENSE](LICENSE) để biết thêm chi tiết.

**Disclaimer**: Đây là công cụ không chính thức, không liên kết với Antigravity. Sử dụng theo trách nhiệm cá nhân.
