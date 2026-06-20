# 🌉 AntiBridge - Antigravity Telegram Remote

> Control Antigravity IDE remotely via Telegram — Chat with AI, monitor quotas, manage projects, and more.

[Phiên bản Tiếng Việt](README_VI.md)

---

## 📚 Documentation

- [Architecture Overview](docs/architecture.md)
- [Configuration Guide](docs/configuration.md)
- [Telegram Commands Reference](docs/telegram_commands.md)
- [Contributing Guide](docs/contributing.md)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 💬 **2-Way Chat** | Send messages from Telegram → Antigravity, receive AI responses directly on Telegram |
| 📝 **Single Message** | All updates (thinking, streaming, final) on **one single message** — no spam |
| 🔧 **CDP Injection** | Commands via Chrome DevTools Protocol — no mouse stealing, no window minimizing |
| 📊 **Quota Monitor** | View AI model usage (Claude, Gemini, GPT) via internal API |
| 🔄 **Auto Monitor** | Auto-check quota every 5 minutes, **only logs when changes detected** |
| 📜 **Quota History** | View quota change log with `/history_quota` — track deltas |
| ⏱️ **Smart Polling** | Auto-adjusting poll speed (fast 3s → slow 10s, max 15 min timeout) |
| 🤖 **Model Switch** | Switch AI models on Telegram with `/model` |
| 📸 **Screenshot** | Capture Antigravity IDE screenshot to Telegram |
| 🗂️ **Conversations** | Switch between open conversations with `/conversations` |
| 📂 **Open Project** | Browse file system and open projects remotely with `/open` (paginated, edit-in-place) |
| ⚡ **Workflows** | Run workflow files from `.agent/workflows` with `/workflows` |
| 🛠️ **Skills** | Run skill folders from `.agent/skills` with `/skills` |
| 🔴 **End Task** | Kill Antigravity process remotely with `/endtask` |

---

## 🙏 Credits & Authors

This project is built upon [AntiBridge-Antigravity-remote](https://github.com/linhbq82/AntiBridge-Antigravity-remote) by **linhbq82**.

- **Original Author**: [linhbq82](https://github.com/linhbq82)
- **Contributors**: [Linh Bui](https://github.com/linhbq82), [Nhqvu2005](https://github.com/Nhqvu2005)
- **Maintainer / Co-Author**: **DaoHieuIT**

Special thanks to all original contributors for laying the foundation of this amazing remote tool. This repository is maintained and expanded with advanced features by DaoHieuIT.

---

## 📦 Installation

### Requirements
- **Node.js** v18+
- **Antigravity IDE** (The bot will automatically launch and configure debug port 9000 if not running)

### Setup

1. Download and extract the repository.
2. Run `SETUP.bat` to automatically install dependencies and initialize folders.
3. Configure `.env`:
   - Copy `.env.example` to `.env`.
   - Fill in `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
   - Set `DISABLE_SAFE_ROLLBACK=true` to protect your local code changes from auto-rollbacks.

### Start & Stop Bot

- **One-click silent startup:**
  - Double-click `START_ALL_SILENT.vbs` in the root folder.
  - This automatically closes existing buggy IDE processes, relaunches the IDE with the debug port enabled, and runs the bot in the background.
- **Stop bot completely:**
  - Run `KILL_SERVER.bat` (or `KILL_SERVER_ADMIN.vbs` for Admin rights).
  - This scans and terminates all background bot loops, safe-startup wrappers, server instances, and frees up port 8000.

**Or run in foreground for debugging:**
```bash
npm start
# or watch mode
npm run dev
```

---

## 🎮 Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | 👋 Start bot, check connection |
| `/status` | 📊 Connection status to Antigravity |
| `/quota` | 📊 View AI model quotas (realtime + saved to history) |
| `/history_quota` | 📜 View quota change log (deltas only) |
| `/model` | 🎨 Switch AI model (Claude, Gemini, GPT...) |
| `/stop` | ⏹️ Stop AI generation |
| `/screenshot` | 📸 Screenshot Antigravity IDE |
| `/reconnect` | 🔄 Reconnect to CDP |
| `/clear` | 🗑️ Clear chat history |
| `/accept` | ✅ Accept current action |
| `/reject` | ❌ Reject current action |
| `/conversations` | 🗂️ List & switch conversations |
| `/open` | 📂 Browse files & open projects (with pagination) |
| `/setproject <path>` | 📁 Manually set project root |
| `/workflows` | ⚡ Run workflows from `.agent/workflows` |
| `/skills` | 🛠️ Run skills from `.agent/skills` |
| `/endtask` | 🔴 Kill Antigravity process |

---

## 🏗️ Architecture

```
Telegram ←→ TelegramBot.js ←→ AntigravityBridge.js ←→ CDP ←→ Antigravity IDE
                ↕                       ↕
          QuotaService.js         chat_bridge_ws.js
                                  detect_actions.js
```

- **TelegramBot.js** — Handles Telegram commands, message routing, UI (pagination, inline keyboards)
- **AntigravityBridge.js** — CDP connection, DOM injection, conversation/project management
- **QuotaService.js** — Quota monitoring, history tracking, formatted reporting
- **chat_bridge_ws.js** — WebSocket bridge injected into Antigravity for real-time message capture
- **detect_actions.js** — Detects Accept/Reject action buttons in the IDE

---

## 🛠️ Troubleshooting

| Error | Solution |
|-------|----------|
| `CDP Chat context NOT found` | Ensure Antigravity is open and logged in. Try `/reconnect`. |
| `Not receiving messages` | Check `TELEGRAM_CHAT_ID` in `.env`. |
| `Bot not responding` | Verify `TELEGRAM_BOT_TOKEN` and restart with `npm start`. |
| `Port 8000 in use` | Run `KILL_SERVER.bat` to free up the port and stop background processes. |

---

## 📄 License

MIT — See [LICENSE](LICENSE) for details.

**Disclaimer**: This is an unofficial tool and is not affiliated with Antigravity. Use at your own risk.