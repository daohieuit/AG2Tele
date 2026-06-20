# Hướng Dẫn Đóng Góp (Contributing)

Cảm ơn bạn đã quan tâm và muốn đóng góp phát triển dự án AntiBridge! Dưới đây là hướng dẫn và lưu ý giúp bạn bắt đầu phát triển dễ dàng hơn.

## Cấu Trúc Thư Mục
- **`backend/`**: Chứa mã nguồn NodeJS/Express cốt lõi của máy chủ bot Telegram và các dịch vụ giao tiếp với IDE.
- **`scripts/`**: Chứa các đoạn mã Javascript nhúng trực tiếp vào Antigravity IDE, các script tự động click và tệp tin hỗ trợ.
- **`docs/`**: Các tài liệu hướng dẫn và mô tả kỹ thuật.

---

## Các Bước Thiết Lập Để Lập Trình

1. Fork/clone mã nguồn về máy tính cá nhân.
2. Khởi tạo và cài đặt các thư viện cần thiết:
   ```bash
   SETUP.bat
   ```
3. Tạo tệp `.env` từ file `.env.example` và điền token bot của bạn cùng ID chat để test.
4. Chạy máy chủ phát triển hỗ trợ tự động tải lại khi code thay đổi (hot reload):
   ```bash
   npm run dev
   ```

---

## Chỉnh Sửa Các Script Nhúng (Injected Scripts)
Khi bạn thực hiện chỉnh sửa các tệp tin trong thư mục `scripts/` (như `chat_bridge_ws.js` hoặc `detect_actions.js`):
- Các đoạn mã này sẽ được chèn trực tiếp vào tiến trình hiển thị của Chromium bên trong IDE.
- Khi kiểm thử, bạn cần chạy lệnh `/reconnect` trên Telegram hoặc khởi động lại bot để nạp lại mã mới vào IDE.
- Không sử dụng thêm thư viện ngoài (dependencies) cho các mã nhúng này; chỉ sử dụng API DOM thuần và đối tượng WebSocket tiêu chuẩn có sẵn trong trình duyệt.

---

## Tiêu Chuẩn Viết Code
- **Javascript**: Sử dụng chuẩn ES6+ hiện đại, ưu tiên cấu trúc `async/await` để viết code bất đồng bộ thay vì lồng ghép Promises.
- **Xử lý ngoại lệ**: Luôn bao bọc các đoạn mã truy vấn CDP và thao tác trang trong các khối `try/catch`. Cửa sổ IDE có thể bị tắt hoặc tải lại bất kỳ lúc nào, bot không được phép crash do các ngoại lệ này.
- **Chú thích**: Ghi chú rõ ràng lý do sử dụng các bộ chọn CSS (selector) hoặc các thủ thuật DOM cụ thể để các lập trình viên khác dễ theo dõi.

---

## Gửi Yêu Cầu Kéo (Pull Request)
1. Tạo một nhánh phát triển mới có tên rõ ràng: `git checkout -b feature/tính-năng-mới`.
2. Viết commit message mô tả ngắn gọn nhưng đủ nghĩa các thay đổi bạn thực hiện.
3. Đảm bảo không commit nhầm các file cấu hình chứa thông tin bảo mật hay file `.env`.
4. Push nhánh của bạn lên GitHub và gửi Pull Request.
5. Cập nhật tài liệu ở cả thư mục tiếng Anh (`docs/`) và tiếng Việt (`docs/vi/`) nếu PR của bạn bổ sung thêm các lệnh hoặc tham số cấu hình mới.
