# ====================================================
# AUTO INJECT Action Detector Script vào Antigravity
# Cho phép Accept/Reject AI actions từ mobile app
# Tự động: Focus window -> Mở DevTools -> Paste -> Enter
# ====================================================

Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  ANTIGRAVITY ACTION DETECTOR - AUTO INJECT" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Tìm Antigravity window
$proc = Get-Process | Where-Object { 
    $_.MainWindowTitle -like '*Antigravity*' -and 
    $_.MainWindowTitle -notlike '*Manager*' 
} | Select-Object -First 1

if (-not $proc) {
    Write-Host "[ERROR] Antigravity chua chay!" -ForegroundColor Red
    Write-Host "Hay mo Antigravity truoc, sau do chay lai script nay." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Tim thay Antigravity: $($proc.MainWindowTitle)" -ForegroundColor Green

# 2. Đọc script từ file
$scriptPath = Join-Path $PSScriptRoot "detect_actions.js"
if (-not (Test-Path $scriptPath)) {
    Write-Host "[ERROR] Khong tim thay file: $scriptPath" -ForegroundColor Red
    exit 1
}

$scriptContent = Get-Content $scriptPath -Raw

# 3. Thêm lệnh tự động start detector với WebSocket URL
$wsUrl = "ws://localhost:8000/ws/action-bridge"
$startCommand = @"

// ===== AUTO START =====
(function() {
    // Wait a bit for script to initialize
    setTimeout(function() {
        if (typeof window.__startActionDetector === 'function') {
            console.log('[ActionDetector] Auto-starting with WebSocket...');
            window.__startActionDetector({
                wsUrl: '$wsUrl',
                pollInterval: 500,
                debug: true
            });
        } else {
            console.error('[ActionDetector] Script not loaded properly!');
        }
    }, 100);
})();
"@

$fullScript = $scriptContent + $startCommand
Write-Host "[OK] Da doc script ($($fullScript.Length) chars)" -ForegroundColor Green

# 4. Copy script vào clipboard
Set-Clipboard -Value $fullScript
Write-Host "[OK] Da copy script vao clipboard" -ForegroundColor Green

# 5. Focus vào Antigravity window
[Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
[Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
Write-Host "[OK] Da focus vao Antigravity window" -ForegroundColor Green

# 6. Gửi F12 để mở DevTools
Write-Host "[...] Dang mo DevTools (F12)..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("{F12}")
Start-Sleep -Milliseconds 2000  # Đợi DevTools mở

# 7. Gửi Ctrl+Shift+J để đảm bảo Console tab được mở
Write-Host "[...] Chuyen sang Console tab..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("^+j")
Start-Sleep -Milliseconds 500

# 8. Click vào console để focus
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 200

# 9. Paste script (Ctrl+V)
Write-Host "[...] Dang paste script..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 500

# 10. Gửi Enter để chạy script
Write-Host "[...] Chay script..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 500

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  THANH CONG! Action Detector da duoc inject." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Kiem tra Console cua Antigravity de xac nhan." -ForegroundColor Cyan
Write-Host "Ban se thay: '[ActionDetector] Action detector script loaded'" -ForegroundColor Cyan
Write-Host "Va: '[ActionDetector] WebSocket connected to backend'" -ForegroundColor Cyan
Write-Host ""
Write-Host "Bay gio ban co the Accept/Reject actions tu mobile app!" -ForegroundColor Yellow
Write-Host ""
