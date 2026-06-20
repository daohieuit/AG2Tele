# ====================================================
# AUTO INJECT Chat Bridge Script vào Antigravity
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
Write-Host "  ANTIGRAVITY CHAT BRIDGE - FULL AUTO INJECT" -ForegroundColor Cyan
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
$scriptPath = Join-Path $PSScriptRoot "chat_bridge_ws.js"
if (-not (Test-Path $scriptPath)) {
    Write-Host "[ERROR] Khong tim thay file: $scriptPath" -ForegroundColor Red
    exit 1
}

$scriptContent = Get-Content $scriptPath -Raw
Write-Host "[OK] Da doc script ($($scriptContent.Length) chars)" -ForegroundColor Green

# 3. Copy script vào clipboard
Set-Clipboard -Value $scriptContent
Write-Host "[OK] Da copy script vao clipboard" -ForegroundColor Green

# 4. Focus vào Antigravity window
[Win32]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null  # SW_RESTORE
[Win32]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 500
Write-Host "[OK] Da focus vao Antigravity window" -ForegroundColor Green

# 5. Gửi Ctrl+Shift+I để mở DevTools (F12 không hoạt động trong Antigravity)
Write-Host "[...] Dang mo DevTools (Ctrl+Shift+I)..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("^+i")
Start-Sleep -Milliseconds 2000  # Đợi DevTools mở

# 6. Gửi Ctrl+Shift+J để đảm bảo Console tab được mở
Write-Host "[...] Chuyen sang Console tab..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("^+j")
Start-Sleep -Milliseconds 500

# 7. Click vào console để focus
# Gửi Ctrl+Shift+P để mở command palette, sau đó type "focus console"
# Hoặc đơn giản là gửi Escape để đóng panel rồi focus lại
[System.Windows.Forms.SendKeys]::SendWait("{ESC}")
Start-Sleep -Milliseconds 200

# 8. Paste script (Ctrl+V)
Write-Host "[...] Dang paste script..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("^v")
Start-Sleep -Milliseconds 500

# 9. Gửi Enter để chạy script
Write-Host "[...] Chay script..." -ForegroundColor Yellow
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Start-Sleep -Milliseconds 500

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  THANH CONG! Script da duoc inject." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Kiem tra Console cua Antigravity de xac nhan." -ForegroundColor Cyan
Write-Host "Ban se thay: 'Antigravity Chat Bridge - READY!'" -ForegroundColor Cyan
Write-Host ""
