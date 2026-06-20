@echo off
chcp 65001 >nul
color 0C

echo.
echo ============================================================
echo           AntiBridge - Tien Hanh Tat He Thong
echo ============================================================
echo.

echo [1/3] Dang tim va tat tien trinh START_BOT.bat...
wmic process where "name='cmd.exe' and commandline like '%%START_BOT.bat%%'" delete >nul 2>&1

echo [2/3] Dang tim va tat tien trinh safe-startup.js...
wmic process where "name='node.exe' and commandline like '%%safe-startup.js%%'" delete >nul 2>&1

echo [3/3] Dang tim va tat tien trinh server port 8000...
wmic process where "name='node.exe' and commandline like '%%telegram-server.js%%'" delete >nul 2>&1

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
