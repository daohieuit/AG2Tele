@echo off
chcp 65001 >nul
color 0A

echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                                                        ║
echo ║       🌉 AG2Tele v3.7.1 - Auto Setup               ║
echo ║       Remote Control for Antigravity AI               ║
echo ║                                                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.

REM ========================================
REM  Step 1: Check Node.js
REM ========================================
echo [1/5] Kiểm tra Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js chưa được cài đặt!
    echo.
    echo 📥 Vui lòng tải và cài Node.js v18+:
    echo    https://nodejs.org
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION% đã sẵn sàng!
echo.

REM ========================================
REM  Step 2: Install Dependencies
REM ========================================
echo [2/5] Cài đặt dependencies...
echo.
call npm install
if errorlevel 1 (
    echo ❌ Lỗi khi cài dependencies!
    pause
    exit /b 1
)
echo.
echo ✅ Đã cài đặt tất cả dependencies!
echo.

REM ========================================
REM  Step 3: Create Data Folders
REM ========================================
echo [3/5] Tạo các folder cần thiết...

if not exist "Data" mkdir Data
if not exist "Data\Text" mkdir Data\Text
if not exist "backend\logs" mkdir backend\logs
if not exist "backend\logs\chat" mkdir backend\logs\chat
if not exist "backend\db" mkdir backend\db

echo ✅ Đã tạo folder structure!
echo.

REM ========================================
REM  Step 4: Create Empty Database
REM ========================================
echo [4/5] Khởi tạo database...

echo {} > backend\db\sessions.json

echo ✅ Database sẵn sàng!
echo.

REM ========================================
REM  Step 5: Check CDP Port
REM ========================================
echo [5/5] Kiểm tra Antigravity CDP...
echo.

netstat -ano | findstr :9000 >nul 2>&1
if errorlevel 1 (
    echo ⚠️  Antigravity CDP chưa chạy trên port 9000
    echo.
    echo 📌 Để bật CDP, chạy:
    echo    .\OPEN_ANTIGRAVITY_CDP.vbs
    echo.
    echo    Hoặc thêm vào shortcut Antigravity:
    echo    --remote-debugging-port=9000
    echo.
) else (
    echo ✅ Antigravity CDP đang chạy!
)

echo.
echo ╔════════════════════════════════════════════════════════╗
echo ║                                                        ║
echo ║                  ✅ SETUP HOÀN TẤT!                   ║
echo ║                                                        ║
echo ╚════════════════════════════════════════════════════════╝
echo.
echo 🚀 Các bước tiếp theo:
echo.
echo    1. Mở và chỉnh sửa file .env: Điền thông tin TELEGRAM_BOT_TOKEN và TELEGRAM_CHAT_ID.
echo.
echo    2. Khởi chạy Bot và IDE ngầm tự động (Chế độ một chạm):
echo       Chạy file: .\START_ALL_SILENT.vbs
echo.
echo    3. Truy cập vào Telegram trên điện thoại để bắt đầu sử dụng!
echo.
echo ========================================
set /p CREATE_SHORTCUT="Bạn có muốn tạo lối tắt Start Menu để Bật/Tắt nhanh không? (Y/N): "
if /i "%CREATE_SHORTCUT%"=="Y" (
    echo.
    echo ⏳ Đang tạo lối tắt Start Menu...
    powershell -ExecutionPolicy Bypass -File ".\scripts\create_start_menu_shortcuts.ps1"
)
echo.
pause

