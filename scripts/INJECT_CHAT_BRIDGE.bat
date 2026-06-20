@echo off
:: ====================================================
:: AUTO INJECT Chat Bridge Script vào Antigravity
:: Sử dụng: Mở Antigravity, sau đó chạy file này
:: Script sẽ tự động inject vào DevTools Console
:: ====================================================

echo.
echo ====================================================
echo   ANTIGRAVITY CHAT BRIDGE - AUTO INJECT
echo ====================================================
echo.

:: Kiểm tra Antigravity đang chạy
powershell -Command "if (!(Get-Process -Name 'Antigravity*' -ErrorAction SilentlyContinue)) { Write-Host 'ERROR: Antigravity chua chay!' -ForegroundColor Red; exit 1 }"
if %errorlevel% neq 0 (
    echo.
    echo Hay mo Antigravity truoc, sau do chay lai file nay.
    pause
    exit /b 1
)

echo [OK] Antigravity dang chay
echo.

:: Đọc script từ file
set SCRIPT_PATH=%~dp0chat_bridge_ws.js

if not exist "%SCRIPT_PATH%" (
    echo ERROR: Khong tim thay file chat_bridge.js
    pause
    exit /b 1
)

echo [OK] Tim thay script: %SCRIPT_PATH%
echo.

:: Copy script vào clipboard
powershell -Command "Get-Content '%SCRIPT_PATH%' -Raw | Set-Clipboard"
echo [OK] Da copy script vao clipboard
echo.

:: Hướng dẫn user
echo ====================================================
echo   HUONG DAN:
echo ====================================================
echo.
echo   1. Chuyen sang cua so Antigravity
echo   2. Nhan F12 de mo DevTools
echo   3. Chon tab "Console"
echo   4. Nhan Ctrl+V de paste script
echo   5. Nhan Enter de chay
echo.
echo   Script se tu dong:
echo   - Capture AI responses
echo   - Gui ve server (localhost:8000)
echo   - Forward qua WebSocket den mobile
echo.
echo ====================================================
echo.

:: Tự động focus vào Antigravity window
powershell -Command ^
    "$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*Antigravity*' } | Select-Object -First 1; " ^
    "if ($proc) { " ^
    "    Add-Type @'`n" ^
    "using System;`n" ^
    "using System.Runtime.InteropServices;`n" ^
    "public class Win32 {`n" ^
    "    [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);`n" ^
    "}`n'@`n" ^
    "    [Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null; " ^
    "    Write-Host '[OK] Da focus vao Antigravity window' -ForegroundColor Green; " ^
    "}"

echo.
echo Nhan phim bat ky de dong cua so nay...
pause > nul
