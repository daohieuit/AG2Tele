/**
 * ScreenCapture Service
 * Chụp screenshot Antigravity và gửi về điện thoại
 */

const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

class ScreenCapture {
    constructor(eventBus, frontendPath) {
        this.eventBus = eventBus;
        this.screenshotPath = path.join(frontendPath, 'screenshot.png');
        this.captureInterval = null;
    }

    /**
     * Bắt đầu chụp screenshot định kỳ
     */
    startCapture(sessionId, intervalMs = 2000) {
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
        }

        console.log(`📸 ScreenCapture: Bắt đầu capture mỗi ${intervalMs}ms`);

        this.captureInterval = setInterval(async () => {
            await this.captureAndSend(sessionId);
        }, intervalMs);

        // Capture ngay lập tức
        this.captureAndSend(sessionId);
    }

    /**
     * Dừng capture
     */
    stopCapture() {
        if (this.captureInterval) {
            clearInterval(this.captureInterval);
            this.captureInterval = null;
            console.log('📸 ScreenCapture: Đã dừng');
        }
    }

    /**
     * Chụp screenshot và gửi về client
     */
    async captureAndSend(sessionId) {
        try {
            // Dùng PowerShell để chụp screenshot
            const psScript = `
                Add-Type -AssemblyName System.Windows.Forms
                $screen = [System.Windows.Forms.Screen]::PrimaryScreen
                $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
                $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
                $bitmap.Save('${this.screenshotPath.replace(/\\/g, '\\\\')}')
                $graphics.Dispose()
                $bitmap.Dispose()
            `;

            await this.execPromise(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);

            // Thông báo client có screenshot mới
            if (this.eventBus && sessionId) {
                this.eventBus.emit(sessionId, 'screenshot', {
                    url: '/screenshot.png?t=' + Date.now()
                });
            }

        } catch (err) {
            console.error('❌ Screenshot error:', err.message);
        }
    }

    /**
     * Click vào vị trí trên màn hình
     */
    async clickAt(x, y) {
        const psScript = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
            
            $signature = @"
            [DllImport("user32.dll", CharSet=CharSet.Auto, CallingConvention=CallingConvention.StdCall)]
            public static extern void mouse_event(long dwFlags, long dx, long dy, long cButtons, long dwExtraInfo);
"@
            $SendMouseClick = Add-Type -memberDefinition $signature -name "Win32MouseEventNew" -namespace Win32Functions -passThru
            $SendMouseClick::mouse_event(0x00000002, 0, 0, 0, 0) # Left down
            $SendMouseClick::mouse_event(0x00000004, 0, 0, 0, 0) # Left up
        `;

        try {
            await this.execPromise(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`);
            console.log(`🖱️ Clicked at (${x}, ${y})`);
        } catch (err) {
            console.error('❌ Click error:', err.message);
        }
    }

    /**
     * Click Accept button (vị trí tương đối trên Antigravity)
     */
    async clickAccept() {
        // Focus Antigravity trước
        await this.execPromise(`powershell -Command "$w = New-Object -ComObject wscript.shell; $w.AppActivate('Antigravity')"`);
        await new Promise(r => setTimeout(r, 300));

        // Gửi phím Y (thường là Accept shortcut) hoặc click vào button
        // Thử dùng keyboard shortcut trước
        await this.execPromise(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('y')"`);
        console.log('✅ Sent Accept (Y)');
    }

    /**
     * Click Reject button
     */
    async clickReject() {
        await this.execPromise(`powershell -Command "$w = New-Object -ComObject wscript.shell; $w.AppActivate('Antigravity')"`);
        await new Promise(r => setTimeout(r, 300));

        await this.execPromise(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('n')"`);
        console.log('❌ Sent Reject (N)');
    }

    execPromise(command) {
        return new Promise((resolve, reject) => {
            exec(command, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });
    }
}

module.exports = ScreenCapture;
