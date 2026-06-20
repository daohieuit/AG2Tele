@echo off
:: ====================================================
:: FULL AUTO INJECT - Tự động hoàn toàn
:: Mở DevTools, paste script, và chạy
:: ====================================================

echo.
echo ====================================================
echo   ANTIGRAVITY CHAT BRIDGE - FULL AUTO INJECT
echo ====================================================
echo.

:: Chạy PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0auto_inject.ps1"

echo.
echo Done!
pause
