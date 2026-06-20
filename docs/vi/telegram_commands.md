# Danh Sách Lệnh Telegram

Tài liệu này giải thích chi tiết chức năng và cách sử dụng tất cả các lệnh điều khiển bot qua Telegram.

| Lệnh | Tham số | Giao diện Inline | Mô tả |
|------|---------|------------------|-------|
| `/start` | Không | Không | Chào mừng người dùng, in thông tin trạng thái và kiểm tra kết nối hệ thống. |
| `/status` | Không | Không | Kiểm tra kết nối tới cả cổng Chrome DevTools (CDP) và cổng WebSocket Bridge. |
| `/quota` | Không | Không | Truy vấn dung lượng (quota) của các model AI từ IDE. Lưu thông tin vào `quota_history.json` và trả về kết quả thời gian thực. |
| `/history_quota` | Không | Không | Hiển thị lịch sử tăng/giảm quota của các model AI kể từ khi bot hoạt động. |
| `/model` | Không | **Có** | Mở một bảng danh sách các model AI có sẵn (Gemini, Claude, GPT...) để thay đổi model nhanh bằng một cú chạm. |
| `/stop` | Không | Không | Gửi tín hiệu dừng sinh phản hồi / dừng suy nghĩ của trợ lý AI trong IDE ngay lập tức. |
| `/screenshot` | Không | Không | Chụp ảnh màn hình làm việc hiện tại của Antigravity IDE và gửi ảnh về Telegram. |
| `/reconnect` | Không | Không | Buộc tái kết nối lại giao thức gỡ lỗi CDP tới IDE. |
| `/clear` | Không | Không | Xóa sạch lịch sử hội thoại hiện tại trong tab chat của IDE. |
| `/accept` | Không | Không | Tự động click nút `Accept` để áp dụng chỉnh sửa mã nguồn do AI đề xuất. |
| `/reject` | Không | Không | Tự động click nút `Reject` để từ chối chỉnh sửa mã nguồn do AI đề xuất. |
| `/conversations` | Không | **Có** | Lấy danh sách các cuộc hội thoại đang mở trong IDE, cho phép bấm nút inline để chuyển đổi nhanh giữa chúng. |
| `/open` | Không | **Có** | Trình quản lý thư mục tương tác để bạn duyệt cây thư mục và mở trực tiếp các dự án khác trên IDE (có hỗ trợ phân trang). |
| `/setproject` | `<đường_dẫn>` | Không | Cấu hình thủ công thư mục gốc của dự án sang đường dẫn tuyệt đối được chỉ định. |
| `/workflows` | Không | **Có** | Quét và hiển thị danh sách các file kịch bản tự động (`.md`) trong `.agent/workflows/` để chọn chạy trực tiếp. |
| `/skills` | Không | **Có** | Quét và hiển thị danh sách các thư mục skill tùy biến trong `.agent/skills/` để chọn chạy trực tiếp. |
| `/endtask` | Không | Không | Tắt hoàn toàn tiến trình Antigravity IDE từ xa. |

---

## Chi Tiết Hướng Dẫn Sử Dụng Lệnh

### Thay Đổi Model AI (`/model`)
Khi bạn gửi `/model`, bot sẽ tạo ra các nút nhấn dựa trên danh sách `AVAILABLE_MODELS` trong file `.env`. Nhấn vào bất kỳ nút nào sẽ lập tức chuyển đổi model AI đang sử dụng trong IDE mà không cần chạm vào máy tính.

### Trình Duyệt File Tương Tác (`/open`)
Gửi lệnh `/open` sẽ kích hoạt trình quản lý thư mục:
- Bấm vào tên thư mục để đi sâu vào bên trong.
- Bấm `[ Open Here ]` để ra lệnh cho IDE mở thư mục hiện tại làm thư mục làm việc.
- Hỗ trợ các nút phân trang (`<< Prev`, `Next >>`) nếu số lượng thư mục con quá nhiều.

### Theo Dõi Biến Động Quota (`/history_quota`)
Bot duy trì nhật ký sử dụng AI của bạn. Khi lệnh `/quota` được chạy (thủ công hoặc tự động mỗi 5 phút), dữ liệu được cập nhật vào `quota_history.json`. Lệnh `/history_quota` sẽ phân tích tệp nhật ký này để thống kê mức tiêu hao token (ví dụ: `-100 tokens` hoặc `-5.3%`).
