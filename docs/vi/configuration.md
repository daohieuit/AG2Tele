# Hướng Dẫn Cấu Hình

Tài liệu này hướng dẫn cách cấu hình chi tiết cho công cụ AntiBridge Telegram Remote.

## Biến Môi Trường (`.env`)

Tạo một tệp tin `.env` trong thư mục gốc của dự án bằng cách sao chép nội dung từ `.env.example` và cập nhật các giá trị thích hợp.

| Biến | Mô tả | Bắt buộc | Mặc định |
|------|-------|----------|----------|
| `TELEGRAM_BOT_TOKEN` | Token của Telegram bot được tạo ra bởi [@BotFather](https://t.me/BotFather). | **Có** | Không |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID của bạn. Lấy từ [@userinfobot](https://t.me/userinfobot). Vì lý do bảo mật, bot chỉ phản hồi các lệnh từ ID này. | **Có** | Không |
| `WS_PORT` | Cổng kết nối cục bộ được sử dụng bởi máy chủ Express/WebSocket để ghi nhận luồng phản hồi của AI. | Không | `8000` |
| `CDP_PORT` | Cổng gỡ lỗi Chromium được dùng để giao tiếp với Antigravity IDE. | Không | `9000` |
| `ANTIGRAVITY_PATH` | Đường dẫn tuyệt đối đến tệp `Antigravity.exe` của bạn. Nếu để trống, bot sẽ tự động tìm kiếm nó trong hệ thống. | Không | *Tự động quét* |
| `AVAILABLE_MODELS` | Danh sách các model AI được phân tách bằng dấu phẩy để hiển thị khi người dùng gõ lệnh `/model` trên Telegram. | Không | Tập hợp model mặc định |
| `DISABLE_SAFE_ROLLBACK` | Thiết lập bằng `true` để bảo vệ các chỉnh sửa code cục bộ của bạn khỏi các hành động hoàn tác (rollback) tự động từ IDE. | Không | `false` |

---

## Các Tệp Tin Script Tự Động Hóa (Windows)

Dự án cung cấp sẵn một số script `.bat` và `.vbs` ở thư mục gốc để đơn giản hóa quá trình chạy và dừng bot trên hệ điều hành Windows:

### 1. Cài đặt Ban đầu
- **`SETUP.bat`**: Tự động cài đặt các gói thư viện NPM cho cả thư mục gốc và thư mục backend. Cần chạy file này trước tiên khi tải dự án về.

### 2. Script Khởi chạy
- **`START_ALL_SILENT.vbs`**: Khởi chạy bot ẩn dưới nền hệ thống (silent mode).
  - Tự động quét và tắt các phiên bản Antigravity bị treo hoặc không mở cổng debug.
  - Khởi động lại Antigravity kèm tham số gỡ lỗi `--remote-debugging-port=9000`.
  - Khởi chạy máy chủ backend của bot ẩn dưới nền (không hiển thị cửa sổ cmd).
- **`START_BOT.bat`**: Chạy máy chủ bot trực tiếp trên màn hình, hiển thị cửa sổ console. Thích hợp cho việc debug và xem log hoạt động trực tiếp.

### 3. Script Dừng Hoạt động
- **`KILL_SERVER.bat`**: Tìm và tắt các tiến trình máy chủ bot, tắt script node chạy ngầm và giải phóng cổng `8000`.
- **`KILL_SERVER_ADMIN.vbs`**: Chạy tệp `KILL_SERVER.bat` dưới quyền Quản trị viên (Administrator) để đảm bảo giải phóng sạch các cổng bị chiếm dụng.

---

## Xử Lý Sự Cố Trùng Cổng
Nếu bạn gặp thông báo lỗi `Port 8000 in use` hoặc `Port 9000 in use`:
1. Chạy tệp `KILL_SERVER_ADMIN.vbs` để đóng tất cả các tiến trình chạy ngầm.
2. Kiểm tra trong Task Manager xem có tiến trình `node.exe` hoặc `Antigravity.exe` nào đang chạy ngầm bị treo hay không và tắt chúng đi.
3. Bạn có thể thay đổi `WS_PORT` trong `.env` thành một cổng khác (ví dụ: `8080`) nếu cổng `8000` bị ứng dụng khác trong hệ thống chiếm đóng.
