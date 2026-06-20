@echo off
:: ====================================================
:: INJECT ACTION DETECTOR Script vào Antigravity
:: Cho phép Accept/Reject AI actions từ mobile app
:: ====================================================

echo.
echo ====================================================
echo   ANTIGRAVITY ACTION DETECTOR - AUTO INJECT
echo ====================================================
echo.

:: Chạy PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0inject_action_detector.ps1"

echo.
echo Done!
pause
