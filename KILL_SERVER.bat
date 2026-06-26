@echo off
chcp 65001 >nul
color 0C

echo.
echo ============================================================
echo           AG2Tele - Tien Hanh Tat He Thong
echo ============================================================
echo.

echo [1/3] Dang tim va tat tien trinh START_BOT.bat...
taskkill /F /FI "WINDOWTITLE eq AG2Tele Telegram Bot - Safe Startup" >nul 2>&1
powershell -Command "Get-CimInstance Win32_Process -Filter \"name='cmd.exe' and CommandLine like '%%START_BOT.bat%%'\" | Remove-CimInstance" >nul 2>&1

echo [2/3] Dang tim va tat tien trinh safe-startup.js...
powershell -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe' and CommandLine like '%%safe-startup.js%%'\" | Remove-CimInstance" >nul 2>&1

echo [3/3] Dang tim va tat tien trinh server port 8000...
powershell -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe' and CommandLine like '%%telegram-server.js%%'\" | Remove-CimInstance" >nul 2>&1

REM Fallback check for port 8000
netstat -ano | findstr :8000 > nul
if %errorlevel% equ 0 (
    echo Port 8000 van dang ban, tien hanh quet va giai phong truc tiep...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
        taskkill /PID %%a /F >nul 2>&1
        echo Da giai phong Port 8000 (PID: %%a)
    )
)

echo.
echo ============================================================
echo              HE THONG DA DUOC TAT HOAN TOAN!
echo ============================================================
echo.
pause
