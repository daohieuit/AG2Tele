@echo off
chcp 65001 > nul
:: ========================================================
:: COPY CHAT BRIDGE SCRIPT TO CLIPBOARD
:: Sau đó paste vào Antigravity Console (F12)
:: ========================================================

echo.
echo ====================================================
echo   CHAT BRIDGE - COPY TO CLIPBOARD
echo ====================================================
echo.

set "SCRIPT_PATH=%~dp0chat_bridge_ws.js"

if not exist "%SCRIPT_PATH%" (
    echo [LOI] Khong tim thay: %SCRIPT_PATH%
    pause
    exit /b 1
)

powershell -Command "Get-Content '%SCRIPT_PATH%' -Raw | Set-Clipboard"

echo [OK] Da copy script vao clipboard!
echo.
echo ====================================================
echo   HUONG DAN:
echo ====================================================
echo.
echo   1. Mo Antigravity
echo   2. Nhan F12 de mo DevTools
echo   3. Click vao tab "Console"
echo   4. Nhan Ctrl+V de paste
echo   5. Nhan Enter
echo.
echo   Done! Script se tu dong capture AI responses
echo   va gui ve backend server.
echo.
echo ====================================================
pause
