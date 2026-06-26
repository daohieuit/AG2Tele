/**
 * TelegramBot Service
 * Giao tiếp giữa Telegram và Antigravity AI
 * Thay thế web frontend bằng Telegram Bot
 */

const TelegramBot = require('node-telegram-bot-api');
const { spawn, exec, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const QuotaService = require('./QuotaService');
const TerminalBridge = require('./TerminalBridge');

class TelegramBotService {
    constructor({ botToken, chatId, antigravityBridge, acceptDetector, messageLogger, eventBus }) {
        this.botToken = botToken;
        this.chatId = String(chatId);
        this.antigravityBridge = antigravityBridge;
        this.acceptDetector = acceptDetector;
        this.messageLogger = messageLogger;
        this.eventBus = eventBus;

        // Telegram message limit
        this.MAX_MSG_LENGTH = 4096;

        // Track streaming state
        this.lastStreamingMsg = null;
        this.streamingTimeout = null;
        this.lastSentText = '';
        this.isProcessing = false;

        this.currentMode = 'antigravity'; // 'antigravity' or 'terminal'
        this.terminalBridge = new TerminalBridge(this);

        // Cloudflare Tunnel state: Map<port, { process, url }>
        this._tunnels = new Map();

        // Manual override for project root (fallback if CDP fails)
        // Load saved project root first, fallback to cwd
        this._projectRootFile = path.join(__dirname, '..', '..', 'Data', 'last_project.txt');
        this._errorLogFile = path.join(__dirname, '..', '..', 'Data', 'error_log.txt');
        this.manualProjectRoot = this._loadProjectRoot() || process.cwd();
        console.log(`📂 Project root: ${this.manualProjectRoot}`);

        // File explorer & editor states
        this._messageDirectoryItems = new Map();
        this._messageFileView = new Map();
        this.pendingFileEdit = null;            // { filePath, messageId, promptMessageId }
        this.pendingNewFilePrompt = null;       // { parentDir, messageId }

        // Load available models from env
        this.availableModels = (process.env.AVAILABLE_MODELS || '')
            .split(',')
            .map(m => m.trim())
            .filter(m => m.length > 0);

        // Initialize bot
        this.bot = new TelegramBot(this.botToken, { polling: true });
        this.quotaService = new QuotaService();

        this._setupCommands();
        this._setupMessageHandler();
        this._setupCallbackHandler();

        // Start background quota monitor (check mỗi 5 phút)
        this.quotaService.startMonitor();

        console.log('🤖 Telegram Bot initialized');

        // Start background AI response monitor (detects responses even from IDE-originated messages)
        this._startBackgroundMonitor();
    }

    /**
     * Background monitor: polls getLastAIResponse() every 2s
     * Detects new AI responses regardless of origin (Telegram or IDE direct)
     */
    _startBackgroundMonitor() {
        this._lastMonitoredText = '';
        this._lastMonitoredThinking = '';
        this._monitorCount = 0;
        this._skipInitialPolls = 3;

        this._bgMonitorInterval = setInterval(async () => {
            if (!this.antigravityBridge?.isConnected) return;

            this._monitorCount++;
            try {
                const result = await this.antigravityBridge.getLastAIResponse();
                if (!result) return;

                const currentText = (result.text || '').trim();
                const currentThinking = (result.thinking || '').trim();
                const currentTaskProgress = (result.taskProgress || '').trim();

                // Skip initial polls — just set baseline without sending
                if (this._skipInitialPolls > 0) {
                    this._skipInitialPolls--;
                    this._lastMonitoredText = currentText;
                    this._lastMonitoredThinking = currentThinking;
                    this._lastMonitoredProgress = currentTaskProgress;
                    if (this._skipInitialPolls === 0) {
                        console.log(`🔔 BG Monitor: Baseline set. Now monitoring.`);
                    }
                    return;
                }

                // Nothing to show
                if (currentText.length === 0 && currentThinking.length === 0 && currentTaskProgress.length === 0) return;

                // Determine what actually CHANGED
                const responseChanged = currentText !== this._lastMonitoredText;
                const thinkingChanged = currentThinking !== this._lastMonitoredThinking;
                const progressChanged = currentTaskProgress !== this._lastMonitoredProgress;

                // Update tracked state
                this._lastMonitoredText = currentText;
                this._lastMonitoredThinking = currentThinking;
                this._lastMonitoredProgress = currentTaskProgress;

                // Show what CHANGED — prefer task progress over stale response
                let displayMsg = '';
                if (progressChanged && currentTaskProgress.length > 0) {
                    // Task progress changed → ALWAYS show task progress (task is actively running)
                    displayMsg = `📋 Progress:\n${currentTaskProgress}`;
                } else if (responseChanged && currentText.length > 0 && !progressChanged) {
                    // Response changed but progress did NOT → task is done, show final response
                    const formatted = this._formatTablesForTelegram(currentText);
                    displayMsg = `🤖 AI:\n\n${formatted}`;
                } else if (thinkingChanged && currentThinking.length > 0) {
                    // Thinking changed → show thinking
                    displayMsg = `💭 Thinking:\n${currentThinking}`;
                } else if (responseChanged && currentText.length > 0) {
                    // Response changed (with progress also changing) → show response too
                    const formatted = this._formatTablesForTelegram(currentText);
                    displayMsg = `🤖 AI:\n\n${formatted}`;
                } else {
                    // Nothing meaningful changed — skip
                    return;
                }

                // Send or edit the unified active response message
                await this._sendOrEditResponse(displayMsg);

            } catch (e) {
                if (this._monitorCount % 30 === 0) {
                    console.log(`⚠️ BG Monitor error: ${e.message?.substring(0, 60)}`);
                }
            }
        }, 1500);

        console.log('🔔 Background AI response monitor started (1.5s)');
    }

    // ==========================================
    // COMMANDS
    // ==========================================

    _setupCommands() {
        // Set bot commands menu
        this.bot.setMyCommands([
            { command: 'accept', description: '✅ Accept action hiện tại' },
            { command: 'artifacts', description: '📄 Đọc file artifact (.md)' },
            { command: 'clear', description: '🗑️ Xóa chat history' },
            { command: 'conversations', description: '🗂️ Chuyển cuộc trò chuyện' },
            { command: 'ctrl_c', description: '🛑 Gửi Ctrl+C tới Terminal' },
            { command: 'endtask', description: '🔴 Tắt Antigravity' },
            { command: 'golive', description: '🔴 Toggle Live Server (Go Live)' },
            { command: 'history_quota', description: '📜 Lịch sử thay đổi quota' },
            { command: 'kill', description: '☠️ Khởi động lại (Kill) Terminal bị nghẽn' },
            { command: 'mode', description: '🔀 Đổi chế độ: /mode antigravity hoặc /mode terminal' },
            { command: 'model', description: '🎨 Đổi model AI' },
            { command: 'open', description: '📂 Mở dự án khác' },
            { command: 'quota', description: '📊 Xem quota Antigravity' },
            { command: 'reconnect', description: '🔄 Reconnect CDP' },
            { command: 'reject', description: '❌ Reject action hiện tại' },
            { command: 'restart', description: '🔄 Restart bot (load code mới)' },
            { command: 'runaccept', description: '🚀 Run/Accept (Alt+Enter)' },
            { command: 'screenshot', description: '📸 Chụp màn hình' },
            { command: 'skills', description: '🛠️ Chạy Skill (.agent/skills)' },
            { command: 'start', description: '👋 Giới thiệu bot' },
            { command: 'status', description: '📊 Kiểm tra kết nối' },
            { command: 'stop', description: '⏹️ Stop AI generation' },
            { command: 'stoptunnel', description: '🔴 Tắt tunnel (vd: /stoptunnel 3000)' },
            { command: 'tpad', description: '🕹️ Mở Control Pad (Điều hướng bằng phím)' },
            { command: 'tunnel', description: '🌐 Mở Cloudflare Tunnel (vd: /tunnel 3000)' },
            { command: 'tunnellist', description: '📋 Danh sách tunnel đang chạy' },
            { command: 'workflows', description: '⚡ Chạy Workflow (.agent/workflows)' },
        ]);

        this.bot.onText(/\/start/, (msg) => this._handleStart(msg));
        this.bot.onText(/\/status/, (msg) => this._handleStatus(msg));
        this.bot.onText(/\/accept/, (msg) => this._handleAccept(msg));
        this.bot.onText(/\/reject/, (msg) => this._handleReject(msg));
        this.bot.onText(/\/stop/, (msg) => this._handleStop(msg));
        this.bot.onText(/^\/model(?:\s+|$)(.*)/, (msg, match) => this._handleModel(msg, match));
        this.bot.onText(/\/screenshot/, (msg) => this._handleScreenshot(msg));
        this.bot.onText(/\/reconnect/, (msg) => this._handleReconnect(msg));
        this.bot.onText(/\/clear/, (msg) => this._handleClear(msg));
        this.bot.onText(/\/quota/, (msg) => this._handleQuota(msg));
        this.bot.onText(/\/history_quota/, (msg) => this._handleHistoryQuota(msg));
        this.bot.onText(/\/conversations/, (msg) => this._handleConversations(msg));
        this.bot.onText(/\/open(.*)/, (msg, match) => this._handleOpen(msg, match));
        this.bot.onText(/\/setproject(.*)/, (msg, match) => this._handleSetProject(msg, match));
        this.bot.onText(/\/workflows/, (msg) => this._handleWorkflows(msg));
        this.bot.onText(/\/skills/, (msg) => this._handleSkills(msg));
        this.bot.onText(/\/endtask/, (msg) => this._handleEndTask(msg));
        this.bot.onText(/\/restart/, (msg) => this._handleRestart(msg));
        this.bot.onText(/\/stoptunnel\s*(\d*)/, (msg, match) => this._handleStopTunnel(msg, match));
        this.bot.onText(/\/tunnellist/, (msg) => this._handleTunnelList(msg));
        this.bot.onText(/\/tunnel\s+(\d+)/, (msg, match) => this._handleTunnel(msg, match));
        this.bot.onText(/\/tunnel$/, (msg) => this._handleTunnel(msg, null));
        this.bot.onText(/\/golive/, (msg) => this._handleGoLive(msg));
        this.bot.onText(/\/runaccept/, (msg) => this._handleRunAccept(msg));
        this.bot.onText(/^\/mode(?:\s+|$)(.*)/, (msg, match) => this._handleMode(msg, match));
        this.bot.onText(/\/ctrl_c/, (msg) => this._handleCtrlC(msg));
        this.bot.onText(/\/kill/, (msg) => this._handleKill(msg));
        this.bot.onText(/\/tpad/, (msg) => this._handleTpad(msg));
        this.bot.onText(/^\/artifacts/, (msg) => this._handleArtifacts(msg));
    }

    _isAuthorized(msg) {
        return String(msg.chat.id) === this.chatId;
    }

    async _handleStart(msg) {
        if (!this._isAuthorized(msg)) return;

        await this.sendMessage(
            `🌉 *AG2Tele Telegram*\n\n` +
            `Điều khiển Antigravity AI qua Telegram.\n\n` +
            `📝 Gửi tin nhắn bất kỳ → AI xử lý\n` +
            `✅ /accept - Accept action\n` +
            `❌ /reject - Reject action\n` +
            `⏹️ /stop - Stop generation\n` +
            `🎨 /model <name> - Đổi model\n` +
            `📸 /screenshot - Chụp màn hình\n` +
            `📊 /status - Kiểm tra kết nối\n\n` +
            `🔀 *Modes:*\n/mode antigravity - Điều khiển IDE\n/mode terminal - Mở PowerShell/Claude`,
            { parse_mode: 'Markdown' }
        );
    }

    async _handleStatus(msg) {
        if (!this._isAuthorized(msg)) return;

        const cdpConnected = this.antigravityBridge?.isConnected || false;
        let stateInfo = '';

        if (cdpConnected) {
            try {
                const state = await this.antigravityBridge.getCurrentState();
                if (state?.success) {
                    stateInfo = `\n🎨 Model: ${state.model || 'N/A'}`;
                    if (state.pendingActions > 0) {
                        stateInfo += `\n🎯 Pending actions: ${state.pendingActions}`;
                    }
                    if (state.isStreaming) {
                        stateInfo += `\n⏳ AI đang trả lời...`;
                    }
                }
            } catch (e) { /* ignore */ }
        }

        const detectorStats = this.acceptDetector?.getStats?.() || {};

        const modeStr = this.currentMode === 'terminal' ? '💻 Terminal' : '🌌 Antigravity IDE';

        await this.sendMessage(
            `📊 *Trạng thái hệ thống*\n\n` +
            `🔀 Mode: ${modeStr}\n` +
            `🔌 CDP: ${cdpConnected ? '✅ Connected' : '❌ Disconnected'}\n` +
            `🤖 Bot: ✅ Online${stateInfo}\n` +
            `🎯 Detector: ${detectorStats.running ? '✅ Running' : '⏹️ Stopped'}`,
            { parse_mode: 'Markdown' }
        );
    }

    async _handleMode(msg, match) {
        if (!this._isAuthorized(msg)) return;
        
        const modeArg = (match[1] || '').trim().toLowerCase();

        // Xác định đường dẫn khởi động riêng cho Terminal
        let ptyPath = this.terminalProjectRoot;
        if (!ptyPath && this.antigravityBridge.isConnected) {
            try { ptyPath = await this.antigravityBridge.getCurrentProjectRoot(); } catch(e) {}
        }
        if (!ptyPath) ptyPath = process.cwd();
        this.terminalProjectRoot = ptyPath; // Lưu lại để dùng sau
        
        if (modeArg === 'terminal') {
            this.currentMode = 'terminal';
            this.terminalBridge.start(ptyPath);
            await this.sendMessage(`💻 Đã chuyển sang chế độ **Terminal Mode**.\n📁 Dir: \`${ptyPath || 'default'}\`\nGõ lệnh trực tiếp vào đây (vd: \`claude\` hoặc \`ls\`). Dùng /ctrl_c để ngắt lệnh.`, { parse_mode: 'Markdown' });
        } else if (modeArg === 'antigravity') {
            this.currentMode = 'antigravity';
            this.terminalBridge.stop();
            await this.sendMessage('🌌 Đã chuyển sang chế độ **Antigravity Mode**.');
        } else {
            // Toggle
            if (this.currentMode === 'antigravity') {
                this.currentMode = 'terminal';
                this.terminalBridge.start(ptyPath);
                await this.sendMessage(`💻 Đã chuyển sang chế độ **Terminal Mode**.\n📁 Dir: \`${ptyPath || 'default'}\`\nGõ lệnh trực tiếp vào đây. Dùng /ctrl_c để ngắt lệnh.`, { parse_mode: 'Markdown' });
            } else {
                this.currentMode = 'antigravity';
                this.terminalBridge.stop();
                await this.sendMessage('🌌 Đã chuyển sang chế độ **Antigravity Mode**.');
            }
        }
    }

    async _handleCtrlC(msg) {
        if (!this._isAuthorized(msg)) return;
        if (this.currentMode !== 'terminal') {
            await this.sendMessage('Chỉ dùng được trong /mode terminal.');
            return;
        }
        this.terminalBridge.sendCtrlC();
    }

    async _handleKill(msg) {
        if (!this._isAuthorized(msg)) return;
        if (this.currentMode !== 'terminal') {
            await this.sendMessage('Chỉ dùng được trong /mode terminal.');
            return;
        }
        this.terminalBridge.stop();
        this.terminalBridge.start();
        await this.sendMessage('💀 Đã ép buộc đóng và khởi động lại phiên Terminal hoàn toàn mới tại thư mục hiện tại.');
    }

    async _handleTpad(msg) {
        if (!this._isAuthorized(msg)) return;
        if (this.currentMode !== 'terminal') {
            await this.sendMessage('Chỉ dùng được trong /mode terminal.');
            return;
        }

        const keyboard = [
            [{ text: '▲ Lên', callback_data: 'tpad_up' }],
            [
                { text: '◄ Trái', callback_data: 'tpad_left' },
                { text: '▼ Xuống', callback_data: 'tpad_down' },
                { text: '► Phải', callback_data: 'tpad_right' }
            ],
            [
                { text: 'Tab ↹', callback_data: 'tpad_tab' },
                { text: 'Enter ↵', callback_data: 'tpad_enter' },
                { text: 'Esc', callback_data: 'tpad_esc' }
            ],
            [{ text: '🛑 Ctrl+C', callback_data: 'tpad_ctrlc' }]
        ];

        await this.sendMessage('⌨️ **Terminal Control Pad**\nGhim (pin) tin nhắn này lại để tiện điều hướng Terminal nhé:', {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }



    async _handleAccept(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('✅ Đang Accept...');
            const result = await this.antigravityBridge.acceptByClick();
            if (result?.success) {
                await this.sendMessage('✅ Accepted!');
            } else {
                // Fallback to shortcut
                const shortcutResult = await this.antigravityBridge.sendAcceptShortcut();
                await this.sendMessage(shortcutResult?.success ? '✅ Accepted (shortcut)!' : '❌ Accept failed');
            }
        } catch (e) {
            await this.sendMessage(`❌ Accept error: ${e.message}`);
        }
    }

    async _handleReject(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('❌ Đang Reject...');
            const result = await this.antigravityBridge.rejectByClick();
            if (result?.success) {
                await this.sendMessage('❌ Rejected!');
            } else {
                const shortcutResult = await this.antigravityBridge.sendRejectShortcut();
                await this.sendMessage(shortcutResult?.success ? '❌ Rejected (shortcut)!' : '❌ Reject failed');
            }
        } catch (e) {
            await this.sendMessage(`❌ Reject error: ${e.message}`);
        }
    }

    async _handleRunAccept(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('🚀 Đang gửi Alt+Enter...');
            const result = await this.antigravityBridge.sendRunAcceptShortcut();
            if (result?.success) {
                await this.sendMessage('✅ Đã gửi lệnh Run/Accept (Alt+Enter)!');
            } else {
                await this.sendMessage(`❌ Lỗi gửi lệnh Run/Accept: ${result?.error || 'Unknown error'}`);
            }
        } catch (e) {
            await this.sendMessage(`❌ Run/Accept error: ${e.message}`);
        }
    }

    async _handleStop(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('⏹️ Đang Stop...');
            const result = await this.antigravityBridge.stopGeneration();
            await this.sendMessage(result?.success ? '⏹️ Stopped!' : '❌ Stop failed');
        } catch (e) {
            await this.sendMessage(`❌ Stop error: ${e.message}`);
        }
    }

    async _handleModel(msg, match) {
        if (!this._isAuthorized(msg)) return;

        const modelName = (match[1] || '').trim();

        // If user typed a model name directly
        if (modelName) {
            // Reserved mode aliases: /model antigravity or /model terminal should switch mode, not model.
            const modeAlias = modelName.toLowerCase();
            if (modeAlias === 'antigravity' || modeAlias === 'terminal') {
                return this._handleMode(msg, [null, modelName]);
            }
            return this._switchModel(modelName);
        }

        // Show inline buttons for model selection
        await this.sendMessage('⏳ Đang lấy danh sách model từ Antigravity...');
        const result = await this.antigravityBridge.getModels();

        if (!result || !result.success || !result.models || result.models.length === 0) {
            await this.sendMessage('⚠️ Không thể lấy danh sách model hoặc không tìm thấy model nào.');
            return;
        }

        const models = result.models;

        // Build keyboard: 1 button per row for clarity
        // Telegram limit 64 bytes for callback_data, we use max 30 chars of the model name
        const keyboard = [];
        for (const m of models) {
            const marker = m.isActive ? '✅ ' : '';
            const btnText = `${marker}${m.name}`;
            const cbData = `model_${m.name.substring(0, 30)}`;
            keyboard.push([{ text: btnText, callback_data: cbData }]);
        }

        // Save available models for name lookup later
        this.availableModels = models.map(m => m.name);

        const activeModel = models.find(m => m.isActive);
        const headerText = activeModel
            ? `🎨 Chọn model AI:\n\n📌 Hiện tại: ${activeModel.name}`
            : '🎨 Chọn model AI:';

        await this.bot.sendMessage(this.chatId, headerText, {
            reply_markup: { inline_keyboard: keyboard }
        });
    }

    async _switchModel(modelName, silent = false) {
        try {
            if (!silent) await this.sendMessage(`🎨 Đang đổi sang: ${modelName}...`);
            const result = await this.antigravityBridge.changeModel(modelName);
            if (result?.success) {
                if (!silent) await this.sendMessage(`✅ Đã đổi model: ${result.model || modelName}`);
            } else {
                if (!silent) await this.sendMessage(`❌ Không tìm thấy model: ${modelName}`);
            }
            return result;
        } catch (e) {
            if (!silent) await this.sendMessage(`❌ Lỗi đổi model: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async _handleScreenshot(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('📸 Đang chụp...');

            if (!this.antigravityBridge?.page) {
                await this.sendMessage('❌ CDP chưa kết nối');
                return;
            }

            const screenshot = await this.antigravityBridge.page.screenshot({
                type: 'png',
                fullPage: false
            });

            await this.bot.sendPhoto(this.chatId, screenshot, {
                caption: `📸 Screenshot ${new Date().toLocaleTimeString('vi-VN')}`
            });
        } catch (e) {
            await this.sendMessage(`❌ Screenshot error: ${e.message}`);
        }
    }

    async _handleReconnect(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('🔄 Đang reconnect CDP...');

            // Force disconnect first
            this.antigravityBridge.isConnected = false;
            this.antigravityBridge.browser = null;
            this.antigravityBridge.page = null;

            const connected = await this.antigravityBridge.connect();
            if (connected) {
                await this.sendMessage('✅ CDP reconnected!');
            } else {
                await this.sendMessage('❌ CDP reconnect failed. Antigravity có đang chạy với --remote-debugging-port=9000 không?');
            }
        } catch (e) {
            await this.sendMessage(`❌ Reconnect error: ${e.message}`);
        }
    }

    async _handleClear(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            this.messageLogger?.clearHistory?.();
            this.lastSentText = '';
            await this.sendMessage('🗑️ Đã xóa chat history');
        } catch (e) {
            await this.sendMessage(`❌ Clear error: ${e.message}`);
        }
    }

    async _handleQuota(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('⏳ Đang lấy quota...');

            const data = await this.quotaService.getQuotaData();
            if (!data) {
                await this.sendMessage('❌ Không lấy được quota. Kiểm tra Antigravity đang chạy?');
                return;
            }

            // Save to history
            this.quotaService.saveToHistory(data);

            // Format and send
            const formatted = this.quotaService.formatQuotaForTelegram(data);
            await this.sendMessage(formatted || '❌ Không parse được quota');
        } catch (e) {
            await this.sendMessage(`❌ Quota error: ${e.message}`);
        }
    }

    async _handleHistoryQuota(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            const formatted = this.quotaService.formatHistoryForTelegram(15);
            await this.sendMessage(formatted);
        } catch (e) {
            await this.sendMessage(`❌ History error: ${e.message}`);
        }
    }

    // ==========================================
    // 🔴 END TASK: Kill Antigravity Process
    // ==========================================

    async _handleEndTask(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('⏳ Đang tắt Antigravity IDE...');

            let killed = false;
            try {
                execSync('taskkill /F /IM "Antigravity IDE.exe"', { stdio: 'ignore' });
                killed = true;
            } catch (e) {}
            try {
                execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' });
                killed = true;
            } catch (e) {}

            if (killed) {
                await this.sendMessage(
                    '✅ **Đã tắt Antigravity IDE!**\n\n' +
                    '🔌 CDP sẽ mất kết nối.\n' +
                    '👉 Dùng `/open` để mở lại khi cần.'
                );
            } else {
                await this.sendMessage('⚠️ Không tìm thấy Antigravity IDE đang chạy.');
            }
        } catch (e) {
            await this.sendMessage(`❌ EndTask error: ${e.message}`);
        }
    }

    async _handleRestart(msg) {
        if (!this._isAuthorized(msg)) return;

        const DATA_DIR = path.join(__dirname, '..', '..', 'Data');
        const SAFE_MODE_FILE = path.join(DATA_DIR, '.safe_mode');
        const CRASH_LOG_FILE = path.join(DATA_DIR, 'crash_error.log');

        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SAFE_MODE_FILE, `restart_requested|${Date.now()}|bot_restart_via_telegram`);
        fs.writeFileSync(CRASH_LOG_FILE, 'Bot restart requested via Telegram. If the next startup crashes, safe-startup.js will report this and rollback to GitHub origin/main.');

        await this.sendMessage(
            '🔄 **Restarting bot...**\n\n' +
            '⏳ Bot sẽ tự khởi động lại trong vài giây.\n' +
            '✅ Code mới nhất trên disk sẽ được load.\n' +
            '🛡️ Nếu code mới lỗi → báo Telegram + rollback về bản mới nhất trên GitHub.'
        );

        await new Promise(r => setTimeout(r, 1000));

        console.log('🔄 Restart requested via Telegram. Exiting (Safe Mode marker set)...');
        process.exit(0);
    }

    // ==========================================
    // 🌐 CLOUDFLARE TUNNEL (multi-port)
    // ==========================================

    async _handleTunnel(msg, match) {
        if (!this._isAuthorized(msg)) return;

        const port = (match && match[1]) ? parseInt(match[1]) : (parseInt(process.env.WS_PORT) || 8000);

        // Already running on this port?
        const existing = this._tunnels.get(port);
        if (existing && existing.process && !existing.process.killed) {
            if (existing.url) {
                await this.sendMessage(
                    `🌐 Tunnel port ${port} đang chạy!\n\n` +
                    `🔗 URL: ${existing.url}\n\n` +
                    `Dùng /stoptunnel ${port} để tắt.`
                );
            } else {
                await this.sendMessage(`⏳ Tunnel port ${port} đang khởi động, vui lòng chờ...`);
            }
            return;
        }

        try {
            await this.sendMessage(`🌐 Đang khởi chạy Cloudflare Tunnel cho port ${port}...`);

            const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            });

            const tunnelState = { process: tunnelProcess, url: null };
            this._tunnels.set(port, tunnelState);

            let urlFound = false;
            const urlRegex = /https:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/;

            const processOutput = (data) => {
                if (urlFound) return;
                const text = data.toString();
                const urlMatch = text.match(urlRegex);
                if (urlMatch) {
                    urlFound = true;
                    tunnelState.url = urlMatch[0];
                    console.log(`🌐 Tunnel port ${port} URL: ${tunnelState.url}`);
                    this.sendMessage(
                        `✅ Tunnel port ${port} sẵn sàng!\n\n` +
                        `🔗 URL: ${tunnelState.url}\n\n` +
                        `Dùng /stoptunnel ${port} để tắt.`
                    );
                }
            };

            tunnelProcess.stdout.on('data', processOutput);
            tunnelProcess.stderr.on('data', processOutput);

            tunnelProcess.on('error', async (err) => {
                console.error(`❌ Tunnel port ${port} error:`, err.message);
                await this.sendMessage(`❌ Lỗi Tunnel port ${port}: ${err.message}\n\nĐảm bảo đã cài cloudflared.`);
                this._tunnels.delete(port);
            });

            tunnelProcess.on('exit', (code) => {
                console.log(`🌐 Tunnel port ${port} exited (code: ${code})`);
                this._tunnels.delete(port);
            });

            // Timeout: 15s
            setTimeout(async () => {
                if (!urlFound && this._tunnels.has(port)) {
                    const t = this._tunnels.get(port);
                    if (t && t.process && !t.process.killed) {
                        await this.sendMessage(`⚠️ Tunnel port ${port}: không tìm được URL sau 15s.\nDùng /stoptunnel ${port} nếu muốn thử lại.`);
                    }
                }
            }, 15000);

        } catch (e) {
            await this.sendMessage(`❌ Tunnel error: ${e.message}`);
            this._tunnels.delete(port);
        }
    }

    async _handleTunnelList(msg) {
        if (!this._isAuthorized(msg)) return;

        if (this._tunnels.size === 0) {
            await this.sendMessage('📋 Không có tunnel nào đang chạy.');
            return;
        }

        let text = `📋 Tunnel đang chạy (${this._tunnels.size}):\n\n`;
        for (const [port, state] of this._tunnels) {
            const status = state.url ? `✅ ${state.url}` : '⏳ Đang khởi động...';
            text += `🔹 Port ${port} → ${status}\n`;
        }
        text += `\nDùng /stoptunnel <port> để tắt.`;

        await this.sendMessage(text);
    }

    async _handleStopTunnel(msg, match) {
        if (!this._isAuthorized(msg)) return;

        const portArg = (match && match[1]) ? match[1].trim() : '';

        // Stop specific port
        if (portArg) {
            const port = parseInt(portArg);
            const tunnel = this._tunnels.get(port);
            if (!tunnel || !tunnel.process || tunnel.process.killed) {
                await this.sendMessage(`⚠️ Không có tunnel nào chạy trên port ${port}.`);
                return;
            }
            try {
                tunnel.process.kill();
                this._tunnels.delete(port);
                await this.sendMessage(`🔴 Đã tắt tunnel port ${port}.`);
            } catch (e) {
                await this.sendMessage(`❌ Stop tunnel error: ${e.message}`);
            }
            return;
        }

        // No port specified: stop all
        if (this._tunnels.size === 0) {
            await this.sendMessage('⚠️ Không có tunnel nào đang chạy.');
            return;
        }

        const count = this._tunnels.size;
        for (const [port, state] of this._tunnels) {
            try { state.process.kill(); } catch (e) { /* ignore */ }
        }
        this._tunnels.clear();
        await this.sendMessage(`🔴 Đã tắt tất cả ${count} tunnel.`);
    }

    // ==========================================
    // 🔴 GO LIVE (Live Server)
    // ==========================================

    async _handleGoLive(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('🔴 Đang toggle Go Live...');
            const result = await this.antigravityBridge.clickGoLive();

            if (result?.success) {
                const emoji = result.wasLive ? '⏹️' : '▶️';
                await this.sendMessage(`${emoji} ${result.action} Live Server! (${result.label})`);
            } else {
                await this.sendMessage(`❌ ${result?.error || 'Không tìm thấy nút Go Live'}`);
            }
        } catch (e) {
            await this.sendMessage(`❌ Go Live error: ${e.message}`);
        }
    }

    // ==========================================
    // 🗂️ NEW FEATURES: Conversations, Open, Skills
    // ==========================================

    async _handleConversations(msg, page = 0, isEdit = false) {
        if (!this._isAuthorized(msg)) return;

        try {
            if (!isEdit) await this.sendMessage('🔄 Đang tải danh sách...');

            const result = await this.antigravityBridge.getConversations();
            if (!result?.success || !result.data) {
                await this.sendMessage(`❌ Lỗi: ${result?.error || 'Không lấy được danh sách'}`);
                return;
            }

            const convs = result.data;
            if (convs.length === 0) {
                await this.sendMessage('📭 Không có cuộc trò chuyện nào.');
                return;
            }

            // Pagination: 5 items per page
            const ITEMS_PER_PAGE = 5;
            const totalPages = Math.ceil(convs.length / ITEMS_PER_PAGE);
            if (page < 0) page = 0;
            if (page >= totalPages) page = totalPages - 1;

            const startIdx = page * ITEMS_PER_PAGE;
            const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, convs.length);
            const pageItems = convs.slice(startIdx, endIdx);

            const keyboard = [];

            // Build list items
            for (const item of pageItems) {
                const marker = item.isCurrent ? '✅ ' : '';
                const btnText = `${marker}${item.title} ${item.time ? `(${item.time})` : ''}`.trim();
                // Use conversation ID for callback (UUID is 36 chars, fits in 64 byte limit)
                // Fallback to substring title if ID is missing
                const cbData = item.id ? item.id : item.title.substring(0, 30);
                keyboard.push([{ text: btnText, callback_data: `conv_${cbData}` }]);
            }

            // Navigation buttons
            const navRow = [];
            if (page > 0) navRow.push({ text: '⬅️ Trước', callback_data: `conv_page_${page - 1}` });
            if (page < totalPages - 1) navRow.push({ text: 'Sau ➡️', callback_data: `conv_page_${page + 1}` });
            if (navRow.length > 0) keyboard.push(navRow);

            const text = `🗂️ **Danh sách hội thoại** (Trang ${page + 1}/${totalPages})`;

            if (isEdit) {
                await this.bot.editMessageText(text, {
                    chat_id: this.chatId,
                    message_id: msg.message.message_id, // For callback queries, message is inside msg
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                await this.sendMessage(text, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }

        } catch (e) {
            await this.sendMessage(`❌ Conversations error: ${e.message}`);
        }
    }

    async _handleArtifacts(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('🔍 Đang quét tìm các file Artifacts...');
            
            const fs = require('fs');
            const path = require('path');
            const os = require('os');
            
            let ptyPath = this.terminalProjectRoot;
            if (!ptyPath && this.antigravityBridge.isConnected) {
                try { ptyPath = await this.antigravityBridge.getCurrentProjectRoot(); } catch(e) {}
            }
            if (!ptyPath) ptyPath = process.cwd();

            const artifactsFound = [];
            const addedPaths = new Set();
            
            const addArtifact = (title, filepath) => {
                if (!addedPaths.has(filepath)) {
                    artifactsFound.push({ title, path: filepath });
                    addedPaths.add(filepath);
                }
            };
            
            // 1. Quét thư mục gốc project
            const rootFiles = ['implementation_plan.md', 'task.md', 'walkthrough.md'];
            for (const f of rootFiles) {
                const fp = path.join(ptyPath, f);
                if (fs.existsSync(fp)) addArtifact(`📄 ${f} (Root)`, fp);
            }
            
            // 2. Quét .artifacts/
            const artsDir = path.join(ptyPath, '.artifacts');
            if (fs.existsSync(artsDir)) {
                try {
                    const files = fs.readdirSync(artsDir);
                    for (const f of files) {
                        if (f.endsWith('.md')) addArtifact(`📂 ${f} (.artifacts)`, path.join(artsDir, f));
                    }
                } catch(e) {}
            }
            
            // 3. Quét ~/.gemini/antigravity-ide/brain/
            const brainDir = path.join(os.homedir(), '.gemini', 'antigravity-ide', 'brain');
            if (fs.existsSync(brainDir)) {
                try {
                    const convs = fs.readdirSync(brainDir, { withFileTypes: true })
                                    .filter(d => d.isDirectory());
                    
                    let latestConv = null;
                    let latestTime = 0;
                    
                    for (const conv of convs) {
                        const convPath = path.join(brainDir, conv.name);
                        let hasArtifact = false;
                        let lastMod = 0;
                        for (const f of rootFiles) {
                            const fp = path.join(convPath, f);
                            if (fs.existsSync(fp)) {
                                hasArtifact = true;
                                const stat = fs.statSync(fp);
                                if (stat.mtimeMs > lastMod) lastMod = stat.mtimeMs;
                            }
                        }
                        if (hasArtifact && lastMod > latestTime) {
                            latestTime = lastMod;
                            latestConv = convPath;
                        }
                    }
                    
                    if (latestConv) {
                        for (const f of rootFiles) {
                            const fp = path.join(latestConv, f);
                            if (fs.existsSync(fp)) {
                                addArtifact(`🧠 ${f} (Brain)`, fp);
                            }
                        }
                    }
                } catch(e) {}
            }
            
            if (artifactsFound.length === 0) {
                await this.sendMessage('📭 Không tìm thấy file artifact nào.');
                return;
            }
            
            // Store mapped paths in memory for callback
            if (!this._artifactMap) this._artifactMap = new Map();
            
            const keyboard = [];
            for (let i = 0; i < artifactsFound.length; i++) {
                const item = artifactsFound[i];
                const id = `art_${Date.now()}_${i}`;
                this._artifactMap.set(id, item.path);
                
                // Keep callback_data short
                keyboard.push([{ text: item.title, callback_data: id.substring(0, 60) }]);
            }
            
            await this.sendMessage('📑 **Danh sách Artifacts tìm thấy:**\nChọn một file để xem nội dung:', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
            
        } catch(e) {
            await this.sendMessage(`❌ Artifacts error: ${e.message}`);
        }
    }

    _cacheMessageData(map, messageId, data) {
        if (map.size > 100) {
            const firstKey = map.keys().next().value;
            map.delete(firstKey);
        }
        map.set(messageId, data);
    }

    async _handleOpen(msg, match = null, directPath = null, isEdit = false, page = 0) {
        if (!this._isAuthorized(msg)) return;

        try {
            // Determine path to browse
            let browsePath = directPath;
            if (!browsePath) {
                if (match && match[1] && match[1].trim()) {
                    browsePath = match[1].trim();
                } else {
                    browsePath = this.currentBrowsePath || process.cwd();
                }
            }

            // Normalize
            browsePath = path.resolve(browsePath);
            this.currentBrowsePath = browsePath; // save state

            // Read directory
            let entries = [];
            try {
                entries = fs.readdirSync(browsePath, { withFileTypes: true });
            } catch (e) {
                await this.sendMessage(`❌ Không đọc được folder: ${browsePath}\n${e.message}`);
                return;
            }

            // Read folders and files
            const folders = [];
            const files = [];
            for (const entry of entries) {
                try {
                    if (entry.isDirectory()) {
                        folders.push(entry.name);
                    } else if (entry.isFile()) {
                        files.push(entry.name);
                    }
                } catch (e) {}
            }

            // Sort: .agent first, then others
            folders.sort((a, b) => {
                const aDot = a.startsWith('.');
                const bDot = b.startsWith('.');
                if (aDot && !bDot) return -1;
                if (!aDot && bDot) return 1;
                return a.localeCompare(b);
            });

            files.sort((a, b) => a.localeCompare(b));

            // Merge into single items array
            const allItems = [
                ...folders.map(f => ({ name: f, isDir: true })),
                ...files.map(f => ({ name: f, isDir: false }))
            ];

            // Pagination Logic
            const ITEMS_PER_PAGE = 10;
            const totalPages = Math.ceil(allItems.length / ITEMS_PER_PAGE);
            if (page < 0) page = 0;
            if (page >= totalPages && totalPages > 0) page = totalPages - 1;

            const startIdx = page * ITEMS_PER_PAGE;
            const endIdx = startIdx + ITEMS_PER_PAGE;
            const currentPageItems = allItems.slice(startIdx, endIdx);

            // Build UI
            const keyboard = [];

            // 1. Open Current Button
            keyboard.push([{ text: `✅ Mở Project này: ${path.basename(browsePath)}`, callback_data: `db_open_current` }]);

            // 2. Parent Directory, Create Folder, Create File
            const parent = path.dirname(browsePath);
            const actionRow = [];
            if (parent !== browsePath) {
                actionRow.push({ text: '⬅️ .. (Lên)', callback_data: 'db_parent' });
            }
            actionRow.push({ text: '📁 + Thư mục', callback_data: 'db_newfolder' });
            actionRow.push({ text: '📄 + File', callback_data: 'db_newfile' });
            keyboard.push(actionRow);

            // 3. Subfolders and files in current page
            currentPageItems.forEach((item, indexInPage) => {
                const absoluteIndex = startIdx + indexInPage;
                const emoji = item.isDir ? '📂' : '📄';
                const callback = item.isDir ? `db_dir_${absoluteIndex}` : `db_file_${absoluteIndex}`;
                keyboard.push([{ text: `${emoji} ${item.name}`, callback_data: callback }]);
            });

            // 4. Pagination Controls
            if (totalPages > 1) {
                const navRow = [];
                if (page > 0) {
                    navRow.push({ text: '<< Trước', callback_data: `db_page_${page - 1}` });
                }
                navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'ignore' });
                if (page < totalPages - 1) {
                    navRow.push({ text: 'Sau >>', callback_data: `db_page_${page + 1}` });
                }
                keyboard.push(navRow);
            }

            const text = `📂 **Duyệt File System**\n📍 Path: \`${browsePath}\`\n📄 Trang ${page + 1}/${totalPages || 1}`;

            const options = {
                chat_id: this.chatId,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            };

            let sentMsg = null;
            if (isEdit) {
                const msgId = msg.message_id || msg.message?.message_id;
                if (msgId) {
                    options.message_id = msgId;
                    try {
                        sentMsg = await this.bot.editMessageText(text, options);
                    } catch (editErr) {
                        if (!editErr.message?.includes('not modified')) {
                            sentMsg = await this.bot.sendMessage(this.chatId, text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
                        } else {
                            sentMsg = msg;
                        }
                    }
                } else {
                    sentMsg = await this.bot.sendMessage(this.chatId, text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
                }
            } else {
                sentMsg = await this.bot.sendMessage(this.chatId, text, { reply_markup: { inline_keyboard: keyboard }, parse_mode: 'Markdown' });
            }

            const targetMsgId = sentMsg?.message_id || msg.message_id || msg.message?.message_id;
            if (targetMsgId) {
                this._cacheMessageData(this._messageDirectoryItems, targetMsgId, {
                    path: browsePath,
                    items: allItems,
                    page: page
                });
            }

        } catch (e) {
            await this.sendMessage(`❌ Open error: ${e.message}`);
        }
    }

    async _viewFile(msg, filePath, isEdit = false, page = 0) {
        try {
            if (!fs.existsSync(filePath)) {
                await this.sendMessage(`❌ File không tồn tại: ${filePath}`);
                return;
            }

            const stats = fs.statSync(filePath);
            if (stats.size > 100 * 1024) {
                await this.sendMessage(`⚠️ File quá lớn để xem trực tiếp (${(stats.size / 1024).toFixed(1)} KB). Vui lòng dùng Terminal.`);
                return;
            }

            let content = '';
            try {
                content = fs.readFileSync(filePath, 'utf-8');
            } catch (readErr) {
                await this.sendMessage(`❌ Không thể đọc file: ${readErr.message}`);
                return;
            }

            if (content.includes('\0')) {
                await this.sendMessage(`⚠️ Đây là file nhị phân (binary), không thể xem văn bản.`);
                return;
            }

            const PAGE_SIZE = 3000;
            const totalPages = Math.ceil(content.length / PAGE_SIZE) || 1;
            if (page < 0) page = 0;
            if (page >= totalPages) page = totalPages - 1;

            const fileChunk = content.substring(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

            const escapeHTML = (txt) => {
                return txt
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;');
            };

            const fileName = path.basename(filePath);
            
            let messageText = `📄 <b>File</b>: <code>${escapeHTML(fileName)}</code>\n`;
            messageText += `📍 Path: <code>${escapeHTML(filePath)}</code>\n`;
            messageText += `📊 Trang ${page + 1}/${totalPages} (${content.length} ký tự)\n\n`;
            messageText += `<pre>${escapeHTML(fileChunk)}</pre>`;

            const keyboard = [];
            const navRow = [];
            if (page > 0) {
                navRow.push({ text: '◀️ Trang trước', callback_data: `fv_page_${page - 1}` });
            }
            if (page < totalPages - 1) {
                navRow.push({ text: 'Trang sau ▶️', callback_data: `fv_page_${page + 1}` });
            }
            if (navRow.length > 0) keyboard.push(navRow);

            keyboard.push([
                { text: '✏️ Sửa (Edit)', callback_data: 'fv_edit' },
                { text: '🗑️ Xóa (Delete)', callback_data: 'fv_delete' }
            ]);

            keyboard.push([{ text: '🔙 Quay lại', callback_data: 'fv_back' }]);

            const options = {
                chat_id: this.chatId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: keyboard }
            };

            let sentMsg = null;
            if (isEdit) {
                const msgId = msg.message_id || msg.message?.message_id;
                if (msgId) {
                    options.message_id = msgId;
                    try {
                        sentMsg = await this.bot.editMessageText(messageText, options);
                    } catch (editErr) {
                        if (!editErr.message?.includes('not modified')) {
                            try {
                                sentMsg = await this.bot.sendMessage(this.chatId, messageText, options);
                            } catch (plainErr) {
                                const plainText = `📄 File: ${fileName}\n📍 Path: ${filePath}\n\n${fileChunk}`;
                                sentMsg = await this.bot.sendMessage(this.chatId, plainText);
                            }
                        } else {
                            sentMsg = msg;
                        }
                    }
                } else {
                    sentMsg = await this.bot.sendMessage(this.chatId, messageText, options);
                }
            } else {
                sentMsg = await this.bot.sendMessage(this.chatId, messageText, options);
            }

            const targetMsgId = sentMsg?.message_id || msg.message_id || msg.message?.message_id;
            if (targetMsgId) {
                this._cacheMessageData(this._messageFileView, targetMsgId, {
                    filePath: filePath,
                    content: content,
                    page: page,
                    totalPages: totalPages
                });
            }

        } catch (e) {
            await this.sendMessage(`❌ View file error: ${e.message}`);
        }
    }

    async _deleteFile(msg, filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                await this.sendMessage(`❌ File không tồn tại: ${filePath}`);
                return;
            }

            const stats = fs.statSync(filePath);
            const parentDir = path.dirname(filePath);
            const name = path.basename(filePath);

            if (stats.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
                await this.sendMessage(`✅ Đã xóa thư mục: **${name}**`, { parse_mode: 'Markdown' });
            } else {
                fs.unlinkSync(filePath);
                await this.sendMessage(`✅ Đã xóa file: **${name}**`, { parse_mode: 'Markdown' });
            }

            await this._handleOpen(msg, null, parentDir, false);
        } catch (e) {
            await this.sendMessage(`❌ Lỗi khi xóa: ${e.message}`);
        }
    }

    async _handleWorkflows(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('⚡ Đang quét workflows...');

            // 1. Get current project root
            const rootPath = await this._getProjectRoot();
            if (!rootPath) {
                await this.sendMessage('❌ Không xác định được Project Root.\n(Hãy dùng `/open` hoặc `/setproject <path>` để set thủ công)');
                return;
            }

            // 2. Check .agent/workflows
            const workflowsPath = path.join(rootPath, '.agent', 'workflows');
            if (!fs.existsSync(workflowsPath)) {
                await this.sendMessage(`⚠️ Không tìm thấy folder workflows: \`${workflowsPath}\``, { parse_mode: 'Markdown' });
                return;
            }

            // 3. List .md files
            const entries = fs.readdirSync(workflowsPath, { withFileTypes: true });
            const files = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);

            if (files.length === 0) {
                await this.sendMessage('📭 Không có file workflow (.md) nào.');
                return;
            }

            // 4. Build keyboard
            const keyboard = [];
            for (const file of files) {
                keyboard.push([{ text: `⚡ ${file}`, callback_data: `workflow_${file}` }]);
            }

            await this.sendMessage(`⚡ **Danh sách Workflow**\n📍 \`${workflowsPath}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (e) {
            await this.sendMessage(`❌ Workflow error: ${e.message}`);
        }
    }

    async _executeWorkflow(filename, queryId) {
        try {
            await this.bot.answerCallbackQuery(queryId, { text: `⚡ Workflow: ${filename}` });

            const commandName = '/' + filename.replace(/\.md$/i, '');
            // this._logToFile('INFO', '_executeWorkflow', `Injecting "${commandName}" with autocomplete click`);

            // Type command char-by-char and click autocomplete dropdown
            const result = await this.antigravityBridge.injectSlashCommand(commandName);
            // this._logToFile('INFO', '_executeWorkflow', `Slash command result: ${JSON.stringify(result)}`);

            if (result?.success && result?.clicked) {
                await this.sendMessage(`⚡ Đã gắn workflow ${commandName} vào chat.\nGõ thêm nội dung rồi gửi nhé!`);
            } else if (result?.success) {
                await this.sendMessage(`⚡ Đã gõ ${commandName} vào chat (không tìm thấy dropdown).\nGõ thêm nội dung rồi gửi nhé!`);
            } else {
                // this._logToFile('WARN', '_executeWorkflow', `Slash command failed, clipboard fallback`);
                try {
                    execSync(`echo ${commandName}| clip`, { encoding: 'utf-8' });
                    await this.sendMessage(`⚠️ CDP thất bại.\n📋 Đã copy ${commandName} vào clipboard.\nDán (Ctrl+V) vào chat nhé!`);
                } catch (clipErr) {
                    // this._logToFile('ERROR', '_executeWorkflow', `Clipboard fallback failed`, clipErr);
                    await this.sendMessage(`❌ Gắn workflow thất bại.`);
                }
            }

        } catch (e) {
            // this._logToFile('ERROR', '_executeWorkflow', `Workflow "${filename}" error`, e);
            await this.sendMessage(`❌ Workflow error: ${e.message}`);
        }
    }

    async _handleSkills(msg) {
        if (!this._isAuthorized(msg)) return;

        try {
            await this.sendMessage('🛠️ Đang quét skills...');

            const rootPath = await this._getProjectRoot();
            if (!rootPath) {
                await this.sendMessage('❌ Không xác định được Project Root.\n(Hãy dùng `/open` hoặc `/setproject <path>` để set thủ công)');
                return;
            }

            const skillsPath = path.join(rootPath, '.agent', 'skills');
            if (!fs.existsSync(skillsPath)) {
                await this.sendMessage(`⚠️ Không tìm thấy folder skills: \`${skillsPath}\``, { parse_mode: 'Markdown' });
                return;
            }

            // List Directories
            const entries = fs.readdirSync(skillsPath, { withFileTypes: true });
            const folders = entries.filter(e => e.isDirectory()).map(e => e.name);

            if (folders.length === 0) {
                await this.sendMessage('📭 Không có skill folder nào.');
                return;
            }

            // Build Folder Keyboard
            const keyboard = [];
            for (const folder of folders) {
                keyboard.push([{ text: `📂 ${folder}`, callback_data: `skill_folder_${folder}` }]);
            }

            await this.sendMessage(`🛠️ **Danh sách Skill Folder**\n📍 \`${skillsPath}\``, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (e) {
            await this.sendMessage(`❌ Skill scanner error: ${e.message}`);
        }
    }

    async _handleSkillFolder(msg, folderName, isEdit = false) {
        try {
            const rootPath = await this._getProjectRoot();
            const folderPath = path.join(rootPath, '.agent', 'skills', folderName);

            // List .md files in skill folder
            const entries = fs.readdirSync(folderPath, { withFileTypes: true });
            const files = entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => e.name);

            if (files.length === 0) {
                await this.sendMessage(`📭 Folder \`${folderName}\` không có file .md nào.`);
                return;
            }

            // Build File Keyboard
            const keyboard = [];
            for (const file of files) {
                keyboard.push([{ text: `📜 ${file}`, callback_data: `skill_file_${folderName}|${file}` }]);
            }

            const text = `🛠️ **Skill: ${folderName}**\nChọn file để chạy:`;

            if (isEdit && msg.message) {
                await this.bot.editMessageText(text, {
                    chat_id: this.chatId,
                    message_id: msg.message.message_id,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            } else {
                await this.sendMessage(text, {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
            }

        } catch (e) {
            await this.sendMessage(`❌ Skill folder error: ${e.message}`);
        }
    }

    async _executeSkillFile(folder, filename, queryId) {
        try {
            await this.bot.answerCallbackQuery(queryId, { text: `⚡ Skill: ${folder}/${filename}` });

            // Inject slash command into chat WITHOUT submitting (no Enter)
            const commandName = '/' + filename.replace(/\.md$/i, '');
            const result = await this.antigravityBridge.injectTextToChat(commandName + ' ', false);
            if (result?.success) {
                await this.sendMessage(`⚡ Đã gắn ${commandName} vào chat.\nGõ thêm nội dung rồi gửi nhé!`);
            } else {
                await this.sendMessage('❌ Gắn skill thất bại.');
            }
        } catch (e) {
            await this.sendMessage(`❌ Execute skill error: ${e.message}`);
        }
    }

    // ==========================================
    // MESSAGE HANDLER (gửi tin nhắn đến Antigravity)
    // ==========================================

    _setupMessageHandler() {
        this.bot.on('message', async (msg) => {
            if (!this._isAuthorized(msg)) return;

            let text = (msg.text || msg.caption || '').trim();
            const hasPhoto = msg.photo && msg.photo.length > 0;

            // 1. Kiểm tra và xử lý trạng thái pending trước
            // Xử lý hủy trạng thái pending khi nhận lệnh /cancel
            if (text.toLowerCase() === '/cancel') {
                if (this.pendingFolderNamePrompt) {
                    this.pendingFolderNamePrompt = false;
                    await this.sendMessage('Đã hủy tạo thư mục.');
                    return;
                }
                if (this.pendingNewFilePrompt) {
                    this.pendingNewFilePrompt = null;
                    await this.sendMessage('Đã hủy tạo file.');
                    return;
                }
                if (this.pendingFileEdit) {
                    this.pendingFileEdit = null;
                    await this.sendMessage('Đã hủy chỉnh sửa file.');
                    return;
                }
            }

            // Xử lý các lệnh hệ thống khác khi đang treo prompt (tự động xóa prompt)
            const isCommand = text.startsWith('/') && !text.startsWith('//');
            if (isCommand && text.toLowerCase() !== '/cancel') {
                this.pendingFolderNamePrompt = false;
                this.pendingNewFilePrompt = null;
                this.pendingFileEdit = null;
            }

            // Xử lý tạo folder mới
            if (this.pendingFolderNamePrompt) {
                this.pendingFolderNamePrompt = false; // Reset state immediately

                // Validate folder name
                const folderName = text.trim();
                if (!folderName || /[<>:"/\\|?*]/.test(folderName)) {
                    await this.sendMessage('❌ Tên thư mục không hợp lệ. Vui lòng thử lại.');
                    return;
                }

                try {
                    const parentDir = this.currentBrowsePath || 'C:\\';
                    const newPath = path.join(parentDir, folderName);
                    if (fs.existsSync(newPath)) {
                        await this.sendMessage(`⚠️ Thư mục **${folderName}** đã tồn tại.`, { parse_mode: 'Markdown' });
                    } else {
                        fs.mkdirSync(newPath, { recursive: true });
                        await this.sendMessage(`✅ Đã tạo thư mục: **${folderName}**`, { parse_mode: 'Markdown' });
                        await this._handleOpen(msg, null, parentDir, false);
                    }
                } catch (e) {
                    await this.sendMessage(`❌ Lỗi tạo thư mục: ${e.message}`);
                }
                return;
            }

            // Xử lý tạo file mới
            if (this.pendingNewFilePrompt) {
                const promptState = this.pendingNewFilePrompt;
                this.pendingNewFilePrompt = null; // Reset state immediately

                const fileName = text.trim();
                if (!fileName || /[<>:"/\\|?*]/.test(fileName)) {
                    await this.sendMessage('❌ Tên file không hợp lệ. Vui lòng thử lại.');
                    return;
                }

                try {
                    const filePath = path.join(promptState.parentDir, fileName);
                    if (fs.existsSync(filePath)) {
                        await this.sendMessage(`⚠️ File **${fileName}** đã tồn tại.`, { parse_mode: 'Markdown' });
                    } else {
                        fs.writeFileSync(filePath, '', 'utf-8');
                        await this.sendMessage(`✅ Đã tạo file: **${fileName}**`, { parse_mode: 'Markdown' });
                        const mockMsg = { message_id: promptState.messageId };
                        await this._handleOpen(mockMsg, null, promptState.parentDir, true);
                    }
                } catch (e) {
                    await this.sendMessage(`❌ Lỗi tạo file: ${e.message}`);
                }
                return;
            }

            // Xử lý chỉnh sửa file
            if (this.pendingFileEdit) {
                const editState = this.pendingFileEdit;
                this.pendingFileEdit = null; // Reset state immediately

                try {
                    fs.writeFileSync(editState.filePath, text, 'utf-8');
                    await this.sendMessage(`✅ Đã lưu thay đổi cho file: **${path.basename(editState.filePath)}**`, { parse_mode: 'Markdown' });
                    const mockMsg = { message_id: editState.messageId };
                    await this._viewFile(mockMsg, editState.filePath, true, 0);
                } catch (e) {
                    await this.sendMessage(`❌ Lỗi lưu file: ${e.message}`);
                }
                return;
            }

            // Xử lý Escape: nếu nhắn // thì sẽ gửi kí tự / vào Terminal hoặc Antigravity
            if (text.startsWith('//')) {
                text = text.substring(1);
            } else if (text.startsWith('/')) {
                // Nếu chỉ là / thông thường (bot command), nhường cho các handler xử lý
                return;
            }

            // Skip if no text AND no photo
            if (!text && !hasPhoto) return;

            console.log(`📱 Telegram: ${hasPhoto ? '🖼️ Photo' : ''}${text ? ` "${text.substring(0, 50)}..."` : ' (no caption)'}`);

            // Reset active response message for new turn
            this._resetActiveResponse();

            // Save to history
            this.messageLogger?.saveHistory?.('user', text || '[Image]', null);

            // ========== HANDLE PHOTO ==========
            if (hasPhoto) {
                await this.sendMessage('🖼️ Đang tải ảnh và gửi cho Antigravity...');

                try {
                    // Create temp directory
                    const tempDir = path.join(__dirname, '..', '..', 'Data', 'temp_images');
                    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

                    // Pick photo: prefer medium size if available (faster), else highest
                    const photoSizes = msg.photo;
                    const photo = photoSizes.length > 2 ? photoSizes[photoSizes.length - 2] : photoSizes[photoSizes.length - 1];
                    console.log(`📷 Photo size: ${photo.width}x${photo.height}, file_id: ${photo.file_id.substring(0, 20)}...`);

                    // Use bot.downloadFile() — built-in, handles download internally
                    const localPath = await this.bot.downloadFile(photo.file_id, tempDir);
                    const fileSize = fs.statSync(localPath).size;
                    console.log(`📥 Downloaded image: ${localPath} (${(fileSize / 1024).toFixed(1)}KB)`);

                    // Grab baseline text BEFORE sending
                    let baselineText = '';
                    try { const _r = await this.antigravityBridge.getLastAIResponse(); baselineText = (typeof _r === 'object' ? _r?.text : _r) || ''; } catch (e) { }

                    // Process @file mentions in caption
                    const processedCaption = await this._processFileMentions(text);

                    // Try sending image via CDP
                    let sent = false;
                    if (this.antigravityBridge.isConnected) {
                        try {
                            const result = await this.antigravityBridge.injectImageToChat(localPath, processedCaption);
                            if (result && result.injected) {
                                sent = true;
                            }
                        } catch (e) {}
                    }

                    // Fallback: PowerShell clipboard paste
                    if (!sent) {
                        console.log('📋 Falling back to PowerShell image clipboard...');
                        try {
                            await this._sendImageViaClipboard(localPath, processedCaption);
                            sent = true;
                            console.log('✅ Image sent via PowerShell clipboard');
                        } catch (e) {}
                    }

                    // Cleanup temp file
                    try { fs.unlinkSync(localPath); } catch (e) { }

                    if (sent) {
                        await this.sendMessage('✅ Đã gửi ảnh! Đang đợi AI trả lời...');
                        this._pollForResponse(baselineText);
                    } else {
                        await this.sendMessage('❌ Không thể gửi ảnh. Kiểm tra Antigravity đang chạy?');
                    }
                } catch (e) {
                    console.error('❌ Photo handling error:', e.message);
                    await this.sendMessage(`❌ Lỗi xử lý ảnh: ${e.message}`);
                }
                return;
            }

            // ========== HANDLE TEXT-ONLY (existing flow) ==========
            if (!text) return;

            // ===== TERMINAL MODE ROUTING =====
            if (this.currentMode === 'terminal') {
                console.log(`📱 [Terminal] Sending text: "${text.substring(0, 50)}..."`);
                this.terminalBridge.write(text);
                return;
            }

            console.log(`📱 Sending text: "${text.substring(0, 50)}..."`);

            // Send status
            await this.sendMessage('🚀 Đang gửi cho Antigravity...');

            // Grab baseline text BEFORE sending (to detect new response)
            let baselineText = '';
            try {
                const _r = await this.antigravityBridge.getLastAIResponse();
                baselineText = (typeof _r === 'object' ? _r?.text : _r) || '';
            } catch (e) { /* ignore */ }

            // Process file mentions in prompt text
            const processedText = await this._processFileMentions(text);

            try {
                // ===== TRY 1: CDP injection =====
                let sent = false;

                if (this.antigravityBridge.isConnected) {
                    try {
                        // Capture current response as baseline so BG Monitor doesn't resend old content
                        try {
                            const baseline = await this.antigravityBridge.getLastAIResponse();
                            this._lastMonitoredText = (baseline?.text || '').trim();
                            this._lastMonitoredThinking = (baseline?.thinking || '').trim();
                            this._lastMonitoredProgress = (baseline?.taskProgress || '').trim();
                        } catch (e) { /* ignore */ }

                        this._skipInitialPolls = 0;

                        const result = await this.antigravityBridge.injectTextToChat(processedText);
                        if (result && result.success) {
                            sent = true;
                            console.log('✅ Sent via CDP');
                        }
                    } catch (e) {
                        console.log(`⚠️ CDP inject failed: ${e.message}`);
                    }
                }

                // ===== TRY 2: PowerShell clipboard (same as web default) =====
                // WARNING: This steals window focus (SetForegroundWindow)
                if (!sent) {
                    console.log('📋 Falling back to PowerShell clipboard (⚠️ will steal window focus)...');
                    try {
                        await this._sendViaClipboard(processedText);
                        sent = true;
                        console.log('✅ Sent via PowerShell clipboard');
                    } catch (e) {
                        console.error('❌ Clipboard fallback failed:', e.message);
                    }
                }

                if (sent) {
                    // Start response polling to guarantee delivery even if WS is down
                    this._pollForResponse(baselineText);
                    console.log('✅ Message injected. Polling started.');
                } else {
                    await this.sendMessage('❌ Không thể gửi tin nhắn. Kiểm tra Antigravity đang chạy?');
                }
            } catch (e) {
                console.error('❌ Send to Antigravity error:', e.message);
                await this.sendMessage(`❌ Lỗi: ${e.message}`);
            }
        });
    }

    /**
     * Poll CDP for AI response with smart backoff
     * Phase 1: Fast polling (3s) for first 2 min — catches quick responses
     * Phase 2: Slow polling (10s) from 2-15 min — handles long tasks
     * Total max: ~15 min wait time
     */
    async _pollForResponse(baselineText) {
        const FAST_INTERVAL = 1500;   // 1.5s
        const SLOW_INTERVAL = 5000;   // 5s
        const FAST_PHASE_MS = 120000; // 2 min fast polling
        const MAX_TOTAL_MS = 900000;  // 15 min total
        const STABLE_COUNT = 1;       // 1 consecutive same-text = complete

        let pollCount = 0;
        let lastPollText = '';
        let stableCount = 0;
        let responseSentViaPolling = false;
        const startTime = Date.now();
        const myGeneration = this._pollGeneration || 0; // snapshot current generation

        console.log('🔄 Starting CDP response polling (fast 2min → slow 15min)...');

        const doPoll = async () => {
            if (responseSentViaPolling) return;

            // Cancel if a new user message reset the generation
            if ((this._pollGeneration || 0) !== myGeneration) {
                console.log('🛑 Poll cancelled (new user message started)');
                return;
            }

            const elapsed = Date.now() - startTime;
            pollCount++;

            // Stop if bridge already delivered the response
            if (this.lastSentText && this.lastSentText !== baselineText && pollCount > 3) {
                console.log('✅ Response already delivered via bridge, stopping poll');
                return;
            }

            if (elapsed > MAX_TOTAL_MS) {
                console.log('⏰ CDP polling timed out (15min)');
                return;
            }

            try {
                const _result = await this.antigravityBridge.getLastAIResponse();
                const currentText = typeof _result === 'object' ? _result?.text : _result;
                const currentThinking = typeof _result === 'object' ? _result?.thinking : '';
                if (!currentText) {
                    if (pollCount <= 5) console.log(`🔄 Poll ${pollCount}: no AI text found`);
                } else if (currentText === baselineText) {
                    if (pollCount <= 5) console.log(`🔄 Poll ${pollCount}: same as baseline (${currentText.length} chars)`);
                } else if (currentText === lastPollText) {
                    // Same as last poll = text is stabilizing
                    stableCount++;
                    console.log(`🔄 Poll ${pollCount}: text stable (${stableCount}/${STABLE_COUNT})`);

                    if (stableCount >= STABLE_COUNT && !responseSentViaPolling) {
                        responseSentViaPolling = true;

                        // Check if bridge already sent this
                        if (this.lastSentText === currentText) {
                            console.log('✅ Response already sent via bridge');
                            return;
                        }

                        console.log(`🤖 CDP Poll: AI response detected (${currentText.length} chars, thinking: ${(currentThinking || '').length} chars)`);
                        this.lastSentText = currentText;
                        this._lastMonitoredText = currentText;

                        // Save to history
                        this.messageLogger?.saveHistory?.('assistant', currentText, null);

                        // Send directly via unified response mechanism
                        const formatted = this._formatTablesForTelegram(currentText);
                        await this._sendOrEditResponse(`🤖 AI:\n\n${formatted}`);
                        return;
                    }
                } else {
                    // New text detected — reset stability counter
                    stableCount = 0;
                    lastPollText = currentText;
                    if (pollCount <= 10 || pollCount % 5 === 0) {
                        console.log(`🔄 Poll ${pollCount}: new text (${currentText.length} chars): "${currentText.substring(0, 60)}..."`);
                    }
                }
            } catch (e) {
                // Ignore polling errors
            }

            // Schedule next poll with smart interval
            const nextInterval = elapsed < FAST_PHASE_MS ? FAST_INTERVAL : SLOW_INTERVAL;
            setTimeout(doPoll, nextInterval);
        };

        // Start first poll
        setTimeout(doPoll, FAST_INTERVAL);
    }

    /**
     * Parse @file.ext references in message text and append their contents.
     */
    async _processFileMentions(text) {
        if (!text) return text;
        const projectRoot = await this._getProjectRoot();
        if (!projectRoot) return text;

        const mentionRegex = /@([^\s]+)/g;
        let match;
        let modifiedText = text;
        const attachments = [];
        const processedPaths = new Set();

        // Reset regex index
        mentionRegex.lastIndex = 0;

        while ((match = mentionRegex.exec(text)) !== null) {
            const mentionStr = match[0];
            const filePathPart = match[1];

            // Clean path (remove trailing punctuation commonly typed by users like . , ; : ? !)
            const cleanPath = filePathPart.replace(/[.,;:?!]$/, '');

            // Try resolving relative to project root first, then absolute
            let fullPath = path.resolve(projectRoot, cleanPath);
            if (!fs.existsSync(fullPath)) {
                if (fs.existsSync(cleanPath)) {
                    fullPath = path.resolve(cleanPath);
                } else {
                    continue;
                }
            }

            // Avoid reading the same file twice
            if (processedPaths.has(fullPath)) continue;
            processedPaths.add(fullPath);

            try {
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) continue;

                // Max file size: 50 KB to avoid token overflow
                if (stat.size > 50 * 1024) {
                    attachments.push(`\n\n[File: ${cleanPath} - Bỏ qua vì kích thước lớn hơn 50KB]`);
                    continue;
                }

                const content = fs.readFileSync(fullPath, 'utf-8');
                attachments.push(`\n\n📄 **File: ${cleanPath}**\n\`\`\`\n${content}\n\`\`\``);
            } catch (e) {
                console.error(`Error reading mentioned file ${cleanPath}:`, e.message);
            }
        }

        if (attachments.length > 0) {
            modifiedText = modifiedText + attachments.join('');
        }

        return modifiedText;
    }

    /**
     * Gửi tin nhắn qua PowerShell clipboard
     * Copy text → focus Antigravity → Ctrl+V → Enter
     * (Giống cách web client gửi mặc định)
     */
    _sendViaClipboard(text) {
        return new Promise((resolve, reject) => {
            // Copy to clipboard
            const copyProcess = exec('clip', (err) => {
                if (err) console.error('Clipboard error:', err.message);
            });
            copyProcess.stdin.write(text);
            copyProcess.stdin.end();

            // PowerShell: focus Antigravity → paste → enter
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*Antigravity*' -and $_.MainWindowTitle -notlike '*Manager*' } | Select-Object -First 1

if ($proc) {
    [Win32]::ShowWindow($proc.MainWindowHandle, 9)
    [Win32]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Host "OK"
} else {
    Write-Host "Antigravity not found"
}
`;

            const psPath = path.join(__dirname, '..', 'temp_tg_paste.ps1');
            fs.writeFileSync(psPath, psScript, 'utf8');

            exec(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 15000 }, (err, stdout) => {
                try { fs.unlinkSync(psPath); } catch (e) { }

                if (err) {
                    reject(new Error(`PowerShell error: ${err.message}`));
                    return;
                }

                const output = (stdout || '').trim();
                if (output.includes('OK')) {
                    resolve(true);
                } else if (output.includes('not found')) {
                    reject(new Error('Antigravity window not found'));
                } else {
                    reject(new Error(`PowerShell output: ${output}`));
                }
            });
        });
    }

    /**
     * Gửi ảnh qua PowerShell clipboard
     * Copy image → focus Antigravity → Ctrl+V → (optional caption) → Enter
     */
    _sendImageViaClipboard(imagePath, caption = '') {
        return new Promise((resolve, reject) => {
            // PowerShell: copy image to clipboard → focus Antigravity → paste
            const captionEscaped = caption.replace(/'/g, "''").replace(/`/g, '``');
            const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32Image {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

# Copy image to clipboard
$img = [System.Drawing.Image]::FromFile('${imagePath.replace(/\\/g, '\\\\')}')
[System.Windows.Forms.Clipboard]::SetImage($img)
$img.Dispose()

# Find and focus Antigravity window
$proc = Get-Process | Where-Object { $_.MainWindowTitle -like '*Antigravity*' -and $_.MainWindowTitle -notlike '*Manager*' } | Select-Object -First 1

if ($proc) {
    [Win32Image]::ShowWindow($proc.MainWindowHandle, 9)
    [Win32Image]::SetForegroundWindow($proc.MainWindowHandle)
    Start-Sleep -Milliseconds 500
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 800
${caption ? `    # Type caption
    [System.Windows.Forms.Clipboard]::SetText('${captionEscaped}')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("^v")
    Start-Sleep -Milliseconds 300` : ''}
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    Write-Host "OK"
} else {
    Write-Host "Antigravity not found"
}
`;

            const psPath = path.join(__dirname, '..', 'temp_tg_img_paste.ps1');
            fs.writeFileSync(psPath, psScript, 'utf8');

            exec(`powershell -ExecutionPolicy Bypass -File "${psPath}"`, { timeout: 20000 }, (err, stdout) => {
                try { fs.unlinkSync(psPath); } catch (e) { }

                if (err) {
                    reject(new Error(`PowerShell error: ${err.message}`));
                    return;
                }

                const output = (stdout || '').trim();
                if (output.includes('OK')) {
                    resolve(true);
                } else if (output.includes('not found')) {
                    reject(new Error('Antigravity window not found'));
                } else {
                    reject(new Error(`PowerShell output: ${output}`));
                }
            });
        });
    }

    // ==========================================
    // CALLBACK HANDLER (Inline buttons)
    // ==========================================

    _setupCallbackHandler() {
        this.bot.on('callback_query', async (query) => {
            const chatId = String(query.message.chat.id);
            if (chatId !== this.chatId) return;

            const action = query.data;
            console.log(`🎯 Callback: ${action}`);

            try {
                if (action === 'accept_action') {
                    const result = await this.antigravityBridge.acceptByClick();
                    if (!result?.success) {
                        await this.antigravityBridge.sendAcceptShortcut();
                    }
                    await this.bot.answerCallbackQuery(query.id, { text: '✅ Accepted!' });
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [[{ text: '✅ Đã Accept', callback_data: 'done' }]] },
                        { chat_id: this.chatId, message_id: query.message.message_id }
                    );
                } else if (action === 'reject_action') {
                    const result = await this.antigravityBridge.rejectByClick();
                    if (!result?.success) {
                        await this.antigravityBridge.sendRejectShortcut();
                    }
                    await this.bot.answerCallbackQuery(query.id, { text: '❌ Rejected!' });
                    await this.bot.editMessageReplyMarkup(
                        { inline_keyboard: [[{ text: '❌ Đã Reject', callback_data: 'done' }]] },
                        { chat_id: this.chatId, message_id: query.message.message_id }
                    );
                } else if (action.startsWith('tpad_')) {
                    await this.bot.answerCallbackQuery(query.id);
                    if (this.currentMode !== 'terminal') return;
                    const cmd = action.replace('tpad_', '');
                    console.log(`🕹️ TPad action: ${cmd}`);
                    switch (cmd) {
                        case 'up': this.terminalBridge.writeRaw('\x1b[A'); break;
                        case 'down': this.terminalBridge.writeRaw('\x1b[B'); break;
                        case 'right': this.terminalBridge.writeRaw('\x1b[C'); break;
                        case 'left': this.terminalBridge.writeRaw('\x1b[D'); break;
                        case 'enter': this.terminalBridge.writeRaw('\r'); break;
                        case 'esc': this.terminalBridge.writeRaw('\x1b'); break;
                        case 'tab': this.terminalBridge.writeRaw('\t'); break;
                        case 'ctrlc': this.terminalBridge.sendCtrlC(); break;
                    }

                } else if (action === 'stop_generation') {
                    await this.antigravityBridge.stopGeneration();
                    await this.bot.answerCallbackQuery(query.id, { text: '⏹️ Stopped!' });
                } else if (action.startsWith('art_')) {
                    const filePath = this._artifactMap?.get(action);
                    if (!filePath) {
                        await this.bot.answerCallbackQuery(query.id, { text: '❌ Link đã hết hạn, vui lòng gõ lại /artifacts' });
                        return;
                    }
                    
                    const fs = require('fs');
                    if (!fs.existsSync(filePath)) {
                        await this.bot.answerCallbackQuery(query.id, { text: '❌ File không còn tồn tại' });
                        return;
                    }
                    
                    await this.bot.answerCallbackQuery(query.id, { text: '📄 Đang chuẩn bị file...' });
                    
                    const content = fs.readFileSync(filePath, 'utf8');
                    // Telegram message limit is 4096, markdown makes it tricky
                    if (content.length > 3800) {
                        await this.bot.sendDocument(this.chatId, filePath, {
                            caption: `📄 Nội dung quá dài, gửi dưới dạng file đính kèm.`
                        });
                    } else {
                        const path = require('path');
                        // Tắt parse_mode Markdown nếu sợ lỗi parse markdown (file artifact có syntax phức tạp)
                        await this.sendMessage(`📄 **${path.basename(filePath)}**\n\n\`\`\`md\n${content}\n\`\`\``, { parse_mode: 'Markdown' });
                    }
                } else if (action.startsWith('model_')) {
                    const modelNameChunk = action.replace('model_', '');

                    if (modelNameChunk) {
                        await this.bot.answerCallbackQuery(query.id, { text: `🎨 Đang chuyển model...` });
                        // Update message while switching
                        await this.bot.editMessageText(`⏳ Đang chuyển sang: ${modelNameChunk}...`, {
                            chat_id: this.chatId,
                            message_id: query.message.message_id
                        });
                        // Use silent mode to avoid duplicate messages
                        const result = await this._switchModel(modelNameChunk, true);
                        // Update message with final result
                        if (result?.success) {
                            await this.bot.editMessageText(`✅ Đã đổi model: ${result.model || modelNameChunk}`, {
                                chat_id: this.chatId,
                                message_id: query.message.message_id
                            });
                        } else {
                            await this.bot.editMessageText(`❌ Không tìm thấy model: ${modelNameChunk}`, {
                                chat_id: this.chatId,
                                message_id: query.message.message_id
                            });
                        }
                    } else {
                        await this.bot.answerCallbackQuery(query.id, { text: '❌ Model không hợp lệ' });
                    }
                }
                // --- Conversation Callbacks ---
                else if (action.startsWith('conv_')) {
                    const target = action.replace('conv_', ''); // could be index or title? better index
                    // If page navigation
                    if (target.startsWith('page_')) {
                        const page = parseInt(target.replace('page_', ''));
                        await this._handleConversations(query.message, page, true); // edit mode
                        await this.bot.answerCallbackQuery(query.id);
                    } else {
                        // Switch conversation by title
                        await this.bot.answerCallbackQuery(query.id, { text: '🔄 Đang chuyển...' });
                        const result = await this.antigravityBridge.switchConversation(target);
                        if (result?.success) {
                            await this.bot.sendMessage(`✅ Đã chuyển đổi cuộc trò chuyện!`);
                        } else {
                            await this.bot.sendMessage(`❌ Không thể chuyển: ${result?.error}`);
                        }
                    }
                }
                // --- Directory Browser Callbacks (db_*) ---
                else if (action.startsWith('db_')) {
                    const messageId = query.message.message_id;
                    const msgData = this._messageDirectoryItems.get(messageId);

                    if (action === 'db_open_current') {
                        // Open current folder in Antigravity
                        const finalPath = this.currentBrowsePath || msgData?.path || process.cwd();
                        console.log(`📂 User requested open: ${finalPath}`);
                        await this.bot.answerCallbackQuery(query.id, { text: '📂 Đang mở dự án...' });

                        try {
                            if (this.currentMode === 'terminal') {
                                this.terminalProjectRoot = finalPath;
                                this.terminalBridge.stop();
                                this.terminalBridge.start(finalPath);
                                await this.bot.sendMessage(this.chatId, `✅ Đã chuyển đổi thư mục Terminal Mode sang:\n\`${finalPath}\``, { parse_mode: 'Markdown' });
                            } else {
                                this.manualProjectRoot = finalPath;
                                this._saveProjectRoot(finalPath);

                                const exePath = await this._findAntigravityExecutable();
                                let launched = false;

                                if (exePath && fs.existsSync(exePath)) {
                                    try {
                                        // Force close existing instances to ensure debug port is opened
                                        if (process.env.NO_KILL_IDE !== 'true') {
                                            try {
                                                execSync('taskkill /F /IM "Antigravity IDE.exe"', { stdio: 'ignore' });
                                            } catch (e) {}
                                            try {
                                                execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore' });
                                            } catch (e) {}
                                        }

                                        const cdpPort = process.env.CDP_PORT || '9000';
                                        const subprocess = spawn(exePath, [finalPath, `--remote-debugging-port=${cdpPort}`], {
                                            detached: true,
                                            stdio: 'ignore',
                                            windowsHide: false
                                        });
                                        subprocess.unref();
                                        launched = true;
                                    } catch (e) {
                                        console.error('❌ Native launch failed:', e);
                                    }
                                }

                                if (launched) {
                                    await this.bot.sendMessage(this.chatId, `🚀 **Đang mở dự án...**\n📂 Path: \`${finalPath}\``);
                                } else {
                                    await this.bot.sendMessage(this.chatId, `⚠️ **Không thể mở dự án**\n- Native launch thất bại: Không tìm thấy Antigravity IDE\n\n👉 Tuy nhiên, Bot **đã chuyển context** sang:\n\`${finalPath}\``);
                                }
                            }
                        } catch (openErr) {
                            console.error('❌ Open Project Error:', openErr);
                            await this.bot.sendMessage(this.chatId, `❌ Lỗi ngoại lệ: ${openErr.message}`);
                        }
                    }
                    else if (action === 'db_parent') {
                        const currentPath = msgData?.path || this.currentBrowsePath || process.cwd();
                        const parent = path.dirname(currentPath);
                        await this._handleOpen(query.message, null, parent, true);
                        await this.bot.answerCallbackQuery(query.id);
                    }
                    else if (action === 'db_newfolder') {
                        const currentPath = msgData?.path || this.currentBrowsePath || process.cwd();
                        this.pendingFolderNamePrompt = true; // Set state
                        this.currentBrowsePath = currentPath;
                        await this.bot.answerCallbackQuery(query.id);
                        await this.bot.sendMessage(this.chatId, `📁 **Tạo Folder mới**\n\nTrong thư mục hiện tại:\n\`${currentPath}\`\n\n👉 Vui lòng gõ tên thư mục muốn tạo (hoặc gửi /cancel để hủy):`, { parse_mode: 'Markdown' });
                    }
                    else if (action === 'db_newfile') {
                        const currentPath = msgData?.path || this.currentBrowsePath || process.cwd();
                        this.pendingNewFilePrompt = { parentDir: currentPath, messageId: messageId };
                        await this.bot.answerCallbackQuery(query.id);
                        await this.bot.sendMessage(this.chatId, `📄 **Tạo File mới**\n\nTrong thư mục hiện tại:\n\`${currentPath}\`\n\n👉 Vui lòng nhập tên file muốn tạo (hoặc gửi /cancel để hủy):`, { parse_mode: 'Markdown' });
                    }
                    else if (action.startsWith('db_page_')) {
                        const targetPage = parseInt(action.replace('db_page_', '')) || 0;
                        const currentPath = msgData?.path || this.currentBrowsePath || process.cwd();
                        await this._handleOpen(query.message, null, currentPath, true, targetPage);
                        await this.bot.answerCallbackQuery(query.id);
                    }
                    else if (action.startsWith('db_dir_')) {
                        if (!msgData) {
                            await this.bot.answerCallbackQuery(query.id, { text: '⚠️ Menu hết hạn, hãy dùng lại /open' });
                            return;
                        }
                        const index = parseInt(action.replace('db_dir_', ''));
                        const item = msgData.items[index];
                        if (item) {
                            const newPath = path.join(msgData.path, item.name);
                            await this._handleOpen(query.message, null, newPath, true);
                        }
                        await this.bot.answerCallbackQuery(query.id);
                    }
                    else if (action.startsWith('db_file_')) {
                        if (!msgData) {
                            await this.bot.answerCallbackQuery(query.id, { text: '⚠️ Menu hết hạn, hãy dùng lại /open' });
                            return;
                        }
                        const index = parseInt(action.replace('db_file_', ''));
                        const item = msgData.items[index];
                        if (item) {
                            const filePath = path.join(msgData.path, item.name);
                            await this._viewFile(query.message, filePath, true);
                        }
                        await this.bot.answerCallbackQuery(query.id);
                    }
                }
                // --- File Viewer Callbacks (fv_*) ---
                else if (action.startsWith('fv_')) {
                    const messageId = query.message.message_id;
                    const fileData = this._messageFileView.get(messageId);

                    if (!fileData) {
                        await this.bot.answerCallbackQuery(query.id, { text: '⚠️ Phiên làm việc với file đã hết hạn.' });
                        return;
                    }

                    if (action.startsWith('fv_page_')) {
                        const targetPage = parseInt(action.replace('fv_page_', '')) || 0;
                        await this._viewFile(query.message, fileData.filePath, true, targetPage);
                        await this.bot.answerCallbackQuery(query.id);
                    }
                    else if (action === 'fv_edit') {
                        this.pendingFileEdit = {
                            filePath: fileData.filePath,
                            messageId: messageId,
                            promptMessageId: null
                        };
                        await this.bot.answerCallbackQuery(query.id);
                        const promptMsg = await this.bot.sendMessage(this.chatId, `✍️ **Sửa File**: \`${path.basename(fileData.filePath)}\`\n\n👉 Vui lòng gửi nội dung mới cho file này (hoặc gửi /cancel để hủy).\n\n⚠️ *Lưu ý*: Toàn bộ nội dung file sẽ được thay thế bằng nội dung tin nhắn của bạn.`, { parse_mode: 'Markdown' });
                        this.pendingFileEdit.promptMessageId = promptMsg.message_id;
                    }
                    else if (action === 'fv_delete') {
                        // Ask for confirmation
                        const confirmKeyboard = {
                            inline_keyboard: [
                                [
                                    { text: '⚠️ XÁC NHẬN XÓA', callback_data: 'fv_delete_confirm' },
                                    { text: '❌ Hủy', callback_data: `fv_page_${fileData.page}` }
                                ]
                            ]
                        };
                        await this.bot.editMessageReplyMarkup(confirmKeyboard, {
                            chat_id: this.chatId,
                            message_id: messageId
                        });
                        await this.bot.answerCallbackQuery(query.id);
                    }
                    else if (action === 'fv_delete_confirm') {
                        await this.bot.answerCallbackQuery(query.id, { text: '🗑️ Đang xóa...' });
                        await this._deleteFile(query.message, fileData.filePath);
                    }
                    else if (action === 'fv_back') {
                        const parentDir = path.dirname(fileData.filePath);
                        await this._handleOpen(query.message, null, parentDir, true);
                        await this.bot.answerCallbackQuery(query.id);
                    }
                }
                // --- Workflow Callbacks ---
                else if (action.startsWith('workflow_')) {
                    const filename = action.replace('workflow_', '');
                    await this._executeWorkflow(filename, query.id);
                }
                // --- Skill Callbacks ---
                else if (action.startsWith('skill_folder_')) {
                    const folderName = action.replace('skill_folder_', '');
                    await this._handleSkillFolder(query.message, folderName, true); // list files
                    await this.bot.answerCallbackQuery(query.id);
                }
                else if (action.startsWith('skill_file_')) {
                    // format: skill_file_FOLDER|FILENAME
                    const [folder, filename] = action.replace('skill_file_', '').split('|');
                    if (folder && filename) {
                        await this._executeSkillFile(folder, filename, query.id);
                    }
                }
                // --- Conversation Callbacks ---
                else if (action.startsWith('conv_page_')) {
                    const page = parseInt(action.replace('conv_page_', '')) || 0;
                    await this._handleConversations(query, page, true);
                    await this.bot.answerCallbackQuery(query.id);
                }
                else if (action.startsWith('conv_')) {
                    // Switch to conversation by title snippet
                    const titleSnippet = action.replace('conv_', '');
                    await this.bot.answerCallbackQuery(query.id, { text: `🔄 Đang chuyển...` });
                    const result = await this.antigravityBridge.switchConversation(titleSnippet);
                    if (result?.success) {
                        await this.sendMessage(`✅ Đã chuyển sang: "${titleSnippet}"`);
                    } else {
                        await this.sendMessage(`❌ Chuyển thất bại: ${result?.error || 'không tìm thấy'}`);
                    }
                }
                else {
                    await this.bot.answerCallbackQuery(query.id);
                }
            } catch (e) {
                console.error('❌ Callback error:', e.message);
                await this.bot.answerCallbackQuery(query.id, { text: `❌ Error: ${e.message}` });
            }
        });
    }

    // ==========================================
    // RECEIVE AI RESPONSE (from bridge WebSocket)
    // ==========================================

    /**
     * Reset active response message — call when user sends new message
     * Increments _pollGeneration to auto-cancel any in-progress polling
     */
    _resetActiveResponse() {
        this._activeResponseMsgId = null;
        this._lastEditedText = null;
        this._lastEditTime = null;
        this._sendLock = Promise.resolve(); // reset lock chain
        this.lastSentText = null;
        this._pollGeneration = (this._pollGeneration || 0) + 1; // cancel old polls
        if (this.streamingTimeout) {
            clearTimeout(this.streamingTimeout);
            this.streamingTimeout = null;
        }
        this.lastStreamingMsg = null;
    }

    /**
     * Send or edit the ONE active response message (with async lock)
     * Uses a promise chain to prevent race conditions where multiple
     * concurrent calls create duplicate messages
     */
    async _sendOrEditResponse(text) {
        if (!text) return;

        // Chain onto the lock — only one call executes at a time
        this._sendLock = (this._sendLock || Promise.resolve()).then(async () => {
            // Truncate for Telegram 4096 limit
            const displayText = text.length > 4000 ? text.substring(text.length - 4000) : text;

            // Skip if identical to last edit
            if (displayText === this._lastEditedText) return;

            // Throttle edits: max 1 per 2s (only for edits, not first send)
            const now = Date.now();
            if (this._activeResponseMsgId && this._lastEditTime && now - this._lastEditTime < 2000) return;

            try {
                if (!this._activeResponseMsgId) {
                    // FIRST: send new message
                    const sent = await this.bot.sendMessage(this.chatId, displayText);
                    this._activeResponseMsgId = sent.message_id;
                    console.log(`📝 Active response msg created: ${sent.message_id}`);
                } else {
                    // SUBSEQUENT: edit existing
                    try {
                        await this.bot.editMessageText(displayText, {
                            chat_id: this.chatId,
                            message_id: this._activeResponseMsgId
                        });
                    } catch (editErr) {
                        if (!editErr.message?.includes('not modified')) {
                            console.log(`⚠️ Edit error: ${editErr.message?.substring(0, 60)}`);
                            if (editErr.message?.includes('message to edit not found') ||
                                editErr.message?.includes('MESSAGE_ID_INVALID')) {
                                const sent = await this.bot.sendMessage(this.chatId, displayText);
                                this._activeResponseMsgId = sent.message_id;
                            }
                        }
                    }
                }

                this._lastEditedText = displayText;
                this._lastEditTime = now;
            } catch (e) {
                console.log(`⚠️ Send/edit error: ${e.message?.substring(0, 60)}`);
            }
        }).catch(e => {
            console.log(`⚠️ Send lock error: ${e.message?.substring(0, 60)}`);
        });

        return this._sendLock;
    }

    /**
     * Xử lý streaming messages từ bridge
     * Mọi update đều edit cùng 1 message duy nhất
     */
    async handleStreamingMessage(messages) {
        if (!messages || messages.length === 0) return;

        const latest = messages[messages.length - 1];
        this.lastStreamingMsg = latest;

        const text = latest.text || '';
        if (!text || text.length < 5) return;

        // Format streaming text too (use HTML if available for consistent output)
        let displayText = text;
        if (latest.html && latest.html.length > 10) {
            displayText = this._htmlToFormattedText(latest.html);
        } else {
            displayText = this._formatTablesForTelegram(text);
        }

        // Send/edit the single active response message
        await this._sendOrEditResponse(`⏳ AI đang trả lời...\n\n${displayText}`);

        // Reset timeout — đợi thêm data
        if (this.streamingTimeout) clearTimeout(this.streamingTimeout);

        this.streamingTimeout = setTimeout(() => {
            if (this.lastStreamingMsg) {
                const finalText = this.lastStreamingMsg.text || '';
                if (finalText && finalText !== this.lastSentText) {
                    this.handleCompleteMessage({
                        text: finalText,
                        html: this.lastStreamingMsg.html,
                        role: 'assistant'
                    });
                }
                this.lastStreamingMsg = null;
            }
        }, 5000);
    }

    /**
     * Xử lý tin nhắn hoàn chỉnh từ AI
     * Edit lần cuối — bỏ prefix ⏳, thêm 🤖
     */
    async handleCompleteMessage(message) {
        if (!message) return;

        const text = message.text || '';
        if (!text || text.length < 5) return;

        // Dedupe
        if (text === this.lastSentText) return;
        this.lastSentText = text;

        // Clear streaming state
        if (this.streamingTimeout) {
            clearTimeout(this.streamingTimeout);
            this.streamingTimeout = null;
        }
        this.lastStreamingMsg = null;

        console.log(`🤖 AI Response (final): ${text.substring(0, 80)}...`);

        // Save to history
        this.messageLogger?.saveHistory?.('assistant', text, message.html || null);

        // Always prefer HTML-based conversion when available
        // (text path strips <pre> elements, losing code blocks entirely)
        let formattedText;
        if (message.html && message.html.length > 10) {
            formattedText = this._htmlToFormattedText(message.html);
            console.log('📊 Used HTML-to-text conversion');
        } else {
            formattedText = this._formatTablesForTelegram(text);
        }

        // Final edit — clean format without ⏳
        await this._sendOrEditResponse(`🤖 AI:\n\n${formattedText}`);
    }

    /**
     * Xử lý khi có pending action (Accept/Reject)
     */
    async handlePendingAction(action) {
        const actionText = action.command || action.type || 'Unknown action';
        const actionDetail = action.detail || '';

        let msg = `🎯 *Action cần xử lý*\n\n`;
        msg += `📋 ${this._escapeMarkdown(actionText)}`;
        if (actionDetail) {
            msg += `\n\`\`\`\n${actionDetail.substring(0, 500)}\n\`\`\``;
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Accept', callback_data: 'accept_action' },
                    { text: '❌ Reject', callback_data: 'reject_action' }
                ]
            ]
        };

        await this.sendMessage(msg, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }

    // ==========================================
    // HELPERS
    // ==========================================

    /**
     * Clean up text for Telegram display (no parse_mode)
     * Strips CSS noise, language labels, and raw markdown artifacts
     */
    _formatTablesForTelegram(text) {
        if (!text) return text;

        // Strip leaked CSS patterns
        text = text.replace(/@keyframes[\s\S]*?\}\s*\}/g, '');
        text = text.replace(/\.code-block[\s\S]*?\}/g, '');
        text = text.replace(/\*::selection\s*\{[\s\S]*?\}/g, '');

        // Clean up code block language labels that innerText picks up
        const langLabels = ['javascript', 'typescript', 'python', 'java', 'go', 'rust', 'bash', 'shell', 'css', 'html', 'json', 'yaml', 'sql', 'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'jsx', 'tsx'];
        for (const lang of langLabels) {
            text = text.replace(new RegExp(`^${lang}\\s*$`, 'gim'), '');
            text = text.replace(new RegExp(`^${lang}(\\s*(?://|/\\*|#|<!--|\\n))`, 'gim'), '$1');
        }

        // Strip raw markdown artifacts (since no parse_mode is used)
        text = text.replace(/```\w*\n?/g, '');  // triple backticks
        text = text.replace(/\*\*([^*]+)\*\*/g, '$1');  // **bold**
        text = text.replace(/__([^_]+)__/g, '$1');  // __bold__
        text = text.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');  // _italic_
        // Don't strip single backticks from code — they look fine without parse_mode

        // Clean up excessive newlines
        text = text.replace(/\n{3,}/g, '\n\n').trim();

        return text;
    }

    /**
     * Convert HTML to formatted text, handling tables as blocks
     * Strips style/script content, converts tables to block format
     * @param {string} html - Raw HTML string
     * @returns {string} - Formatted text with tables as blocks
     */
    _htmlToFormattedText(html) {
        if (!html) return '';

        try {
            let text = html;

            // ===== FIRST: Strip style and script content entirely =====
            text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
            text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

            // ===== Convert HTML tables to block format =====
            // Each row becomes a block with labeled lines
            const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
            text = text.replace(tableRegex, (match, tableContent) => {
                const rows = [];

                // Extract all rows
                const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
                let trMatch;
                while ((trMatch = trRegex.exec(tableContent)) !== null) {
                    const cells = [];
                    const cellRegex = /<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
                    let cellMatch;
                    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
                        const cellText = cellMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
                        cells.push(cellText);
                    }
                    if (cells.length > 0) rows.push(cells);
                }

                if (rows.length === 0) return '';

                // First row = headers
                const headers = rows[0];
                const dataRows = rows.slice(1);

                if (dataRows.length === 0) {
                    // Only header row, just show as list
                    return '\n' + headers.join(' | ') + '\n';
                }

                // Build block format: each data row = block with header labels
                const blocks = [];
                for (const row of dataRows) {
                    const lines = [];
                    for (let i = 0; i < row.length; i++) {
                        const label = headers[i] || `Col${i + 1}`;
                        const value = row[i] || '';
                        if (value) {
                            lines.push(`  ${label}: ${value}`);
                        }
                    }
                    if (lines.length > 0) {
                        blocks.push('📌 ' + (row[0] || '') + '\n' + lines.slice(1).join('\n'));
                    }
                }
                return '\n' + blocks.join('\n\n') + '\n';
            });

            // ===== Convert inline <pre class="inline"> first (before code blocks) =====
            // Antigravity uses <pre class="inline"><code>...</code></pre> for inline code
            text = text.replace(/<pre[^>]*class="[^"]*inline[^"]*"[^>]*>([\s\S]*?)<\/pre>/gi, (match, inner) => {
                return inner.replace(/<[^>]+>/g, '').trim();
            });

            // ===== Convert Antigravity code blocks =====
            // Structure: <pre> > div > div.code-block > div.code-line > div.line-content > spans
            text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, preContent) => {
                // Check if Antigravity code block (has line-content divs)
                if (!preContent.includes('line-content')) {
                    // Traditional <pre> — just strip tags
                    let code = preContent.replace(/<[^>]+>/g, '').trim();
                    code = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                    if (!code) return '';
                    return '\n━━━━━━━━━━━━━━━━\n' + code + '\n━━━━━━━━━━━━━━━━\n';
                }

                // Extract text from each line-content div
                const lines = [];
                const lineContentRegex = /<div[^>]*class="[^"]*line-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
                let lcMatch;
                while ((lcMatch = lineContentRegex.exec(preContent)) !== null) {
                    let lineText = lcMatch[1].replace(/<[^>]+>/g, '');
                    lineText = lineText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                    lines.push(lineText);
                }

                if (lines.length === 0) return '';

                const code = lines.join('\n').trim();
                return '\n━━━ Code ━━━\n' + code + '\n━━━━━━━━━━━━\n';
            });

            // ===== Convert other HTML elements (NO parse_mode, so no markdown syntax) =====
            // Inline code — just show text without backticks
            text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (m, content) => {
                return content.replace(/<[^>]+>/g, '').trim();
            });
            // Bold — just show text (no ** since Telegram won't parse it)
            text = text.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '$1');
            // Italic — just show text
            text = text.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '$1');
            // Line breaks and paragraphs
            text = text.replace(/<br\s*\/?>/gi, '\n');
            text = text.replace(/<\/p>/gi, '\n');
            text = text.replace(/<\/li>/gi, '\n');
            text = text.replace(/<li[^>]*>/gi, '• ');
            // Headings — use emoji marker instead of markdown
            text = text.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n📍 $1\n');
            // Strip remaining HTML tags
            text = text.replace(/<[^>]+>/g, '');
            // Decode HTML entities
            text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
            // Clean up excessive newlines
            text = text.replace(/\n{3,}/g, '\n\n').trim();

            return text;
        } catch (e) {
            console.log(`⚠️ HTML to text conversion error: ${e.message}`);
            return html.replace(/<[^>]+>/g, '').trim();
        }
    }

    /**
     * 🧠 Helper: Lấy Project Root (CDP -> Fallback Manual)
     */
    async _getProjectRoot() {
        // 1. Try CDP
        const cdpRoot = await this.antigravityBridge.getCurrentProjectRoot();
        if (cdpRoot && !cdpRoot.startsWith('ERROR_') && cdpRoot !== 'NO_WORKSPACE') {
            // Update manual root to sync
            this.manualProjectRoot = cdpRoot;
            this._saveProjectRoot(cdpRoot);
            return cdpRoot;
        }

        // 2. Fallback to manual
        if (this.manualProjectRoot) {
            console.log(`⚠️ Using manual project root: ${this.manualProjectRoot}`);
            return this.manualProjectRoot;
        }

        return null;
    }

    /**
     * 📁 Handler: /setproject <path>
     */
    async _handleSetProject(msg, match) {
        if (!this._isAuthorized(msg)) return;
        const pathStr = match[1] ? match[1].trim() : '';

        if (!pathStr) {
            await this.sendMessage('⚠️ Vui lòng nhập đường dẫn. Ví dụ: `/setproject G:\\Job\\MyProject`');
            return;
        }

        if (fs.existsSync(pathStr)) {
            this.manualProjectRoot = pathStr;
            this._saveProjectRoot(pathStr);
            await this.sendMessage(`✅ Đã set Project Root thủ công: \`${pathStr}\`\n(Bạn có thể dùng /skills now!)`);
        } else {
            await this.sendMessage(`❌ Đường dẫn không tồn tại: \`${pathStr}\``);
        }
    }

    // ==========================================
    // PERSISTENCE & LOGGING HELPERS
    // ==========================================

    /**
     * Save project root to disk for persistence across restarts
     */
    _saveProjectRoot(rootPath) {
        try {
            const dir = path.dirname(this._projectRootFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this._projectRootFile, rootPath, 'utf-8');
            console.log(`💾 Saved project root: ${rootPath}`);
        } catch (e) {
            console.error(`❌ Failed to save project root:`, e.message);
        }
    }

    /**
     * Load saved project root from disk
     */
    _loadProjectRoot() {
        try {
            if (fs.existsSync(this._projectRootFile)) {
                const saved = fs.readFileSync(this._projectRootFile, 'utf-8').trim();
                if (saved && fs.existsSync(saved)) {
                    console.log(`📂 Loaded saved project root: ${saved}`);
                    return saved;
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /**
     * Ghi log vào file Data/error_log.txt
     * @param {string} level - 'ERROR' | 'WARN' | 'INFO'
     * @param {string} context - Tên function/module
     * @param {string} message - Nội dung log
     * @param {Error} [error] - Error object (optional)
     */
    _logToFile(level, context, message, error = null) {
        try {
            const now = new Date().toISOString();
            let line = `[${now}] [${level}] [${context}] ${message}`;
            if (error) {
                line += `\n  Stack: ${error.stack || error.message}`;
            }
            line += '\n';

            const dir = path.dirname(this._errorLogFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.appendFileSync(this._errorLogFile, line, 'utf-8');

            // Also log to console
            if (level === 'ERROR') console.error(line.trim());
            else console.log(line.trim());
        } catch (e) { /* silent */ }
    }

    // ==========================================

    /**
     * Gửi message đến Telegram chat
     * Hỗ trợ tách tin nhắn dài > 4096 ký tự
     */
    async sendMessage(text, options = {}) {
        if (!text) return;

        try {
            const chunks = this._splitMessage(text);
            for (const chunk of chunks) {
                try {
                    await this.bot.sendMessage(this.chatId, chunk, options);
                } catch (sendErr) {
                    // Bất kỳ lỗi nào → thử gửi lại không format
                    console.log(`⚠️ Send error (${sendErr.message?.substring(0, 60)}), retrying plain text`);
                    try {
                        await this.bot.sendMessage(this.chatId, chunk);
                    } catch (plainErr) {
                        console.error('❌ Plain text send also failed:', plainErr.message);
                    }
                }
            }
        } catch (e) {
            console.error('❌ Telegram sendMessage error:', e.message);
        }
    }

    /**
     * Format AI response cho Telegram
     * Chuyển HTML → text thuần, giữ code blocks
     */
    async _sendFormattedResponse(text) {
        // Gửi plain text trước (ổn định nhất), Markdown hay lỗi với AI output
        await this.sendMessage(`🤖 AI:\n\n${text}`);
    }

    /**
     * Tách tin nhắn dài thành chunks <= 4096 ký tự
     */
    _splitMessage(text) {
        if (text.length <= this.MAX_MSG_LENGTH) {
            return [text];
        }

        const chunks = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= this.MAX_MSG_LENGTH) {
                chunks.push(remaining);
                break;
            }

            // Tìm điểm cắt hợp lý (newline, dấu chấm, khoảng trắng)
            let splitIdx = this.MAX_MSG_LENGTH;

            // Ưu tiên cắt ở newline
            const lastNewline = remaining.lastIndexOf('\n', this.MAX_MSG_LENGTH);
            if (lastNewline > this.MAX_MSG_LENGTH * 0.5) {
                splitIdx = lastNewline;
            } else {
                // Fallback: cắt ở dấu chấm
                const lastDot = remaining.lastIndexOf('. ', this.MAX_MSG_LENGTH);
                if (lastDot > this.MAX_MSG_LENGTH * 0.5) {
                    splitIdx = lastDot + 1;
                } else {
                    // Fallback: cắt ở khoảng trắng
                    const lastSpace = remaining.lastIndexOf(' ', this.MAX_MSG_LENGTH);
                    if (lastSpace > this.MAX_MSG_LENGTH * 0.5) {
                        splitIdx = lastSpace;
                    }
                }
            }

            chunks.push(remaining.substring(0, splitIdx));
            remaining = remaining.substring(splitIdx).trimStart();
        }

        // Đánh số nếu có nhiều phần
        if (chunks.length > 1) {
            return chunks.map((chunk, i) => `📄 [${i + 1}/${chunks.length}]\n\n${chunk}`);
        }

        return chunks;
    }

    _escapeMarkdown(text) {
        return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    }

    /**
     * Dọn dẹp khi shutdown
     */
    stop() {
        if (this.streamingTimeout) {
            clearTimeout(this.streamingTimeout);
        }
        if (this.bot) {
            this.bot.stopPolling();
            console.log('🤖 Telegram Bot stopped');
        }
    }
    /**
     * Finds the Antigravity executable path dynamically.
     * Tries:
     * 1. process.env.ANTIGRAVITY_PATH
     * 2. Default Windows installation paths (LOCALAPPDATA / Program Files)
     * 3. wmic process (running instance)
     */
    async _findAntigravityExecutable() {
        if (process.env.ANTIGRAVITY_PATH && fs.existsSync(process.env.ANTIGRAVITY_PATH)) {
            return process.env.ANTIGRAVITY_PATH;
        }

        // Try standard installation paths on Windows
        if (process.platform === 'win32') {
            const localAppData = process.env.LOCALAPPDATA;
            if (localAppData) {
                const userPath = path.join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe');
                if (fs.existsSync(userPath)) {
                    return userPath;
                }
            }

            const programFiles = process.env.ProgramFiles;
            if (programFiles) {
                const systemPath = path.join(programFiles, 'Antigravity IDE', 'Antigravity IDE.exe');
                if (fs.existsSync(systemPath)) {
                    return systemPath;
                }
            }
        }

        return new Promise((resolve) => {
            exec('wmic process where "name like \'%Antigravity%\'" get executablepath', (err, stdout) => {
                if (!err && stdout) {
                    const lines = stdout.split('\n').map(l => l.trim()).filter(l => l && l.toLowerCase().includes('antigravity'));
                    if (lines.length > 0) {
                        const path = lines.find(l => l.toLowerCase().endsWith('.exe'));
                        if (path) {
                            console.log(`🔍 Found Antigravity path via wmic: ${path}`);
                            resolve(path);
                            return;
                        }
                    }
                }
                // Fallback: Return null if not found
                console.log('⚠️ Could not find Antigravity path via wmic.');
                resolve(null);
            });
        });
    }
}

module.exports = TelegramBotService;
