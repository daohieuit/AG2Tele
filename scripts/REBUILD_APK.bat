@echo off
echo ========================================
echo    REBUILD ANDROID APK
echo ========================================
echo.

cd /d "D:\01_BUILD_APP\REMOTE_AGENT\mobile-app"

echo [1/2] Syncing web assets to Android...
call npx cap sync android
if errorlevel 1 (
    echo ERROR: Sync failed!
    pause
    exit /b 1
)
echo.

echo [2/2] Building APK...
cd android
call gradlew.bat assembleDebug
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)
echo.

echo ========================================
echo    BUILD SUCCESSFUL!
echo ========================================
echo.
echo APK location:
echo mobile-app\android\app\build\outputs\apk\debug\app-debug.apk
echo.
echo Copy this file to your phone to install.
echo ========================================
pause
