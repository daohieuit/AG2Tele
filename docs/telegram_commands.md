# Telegram Commands Reference

This is a comprehensive reference manual for all slash commands supported by the AntiBridge bot.

| Command | Arguments | Inline Interface | Description |
|---------|-----------|------------------|-------------|
| `/start` | None | No | Welcomes the user, prints status info, and initiates the connection check. |
| `/status` | None | No | Checks connection status to both the Chrome DevTools Protocol (CDP) port and the WebSocket bridge. |
| `/quota` | None | No | Queries current AI model quotas from the IDE. Saves records to `quota_history.json` and reports real-time usage. |
| `/history_quota` | None | No | Displays the list of quota changes (decreases/increases) since the bot started. |
| `/model` | None | **Yes** | Shows a menu of available AI models (Gemini, Claude, GPT, etc.) allowing you to switch the active model with one click. |
| `/stop` | None | No | Instructs the active IDE assistant to stop current generation/thinking. |
| `/screenshot` | None | No | Captures a screenshot of the active Antigravity IDE workspace and sends it to Telegram. |
| `/reconnect` | None | No | Forces a reconnect cycle of the Puppeteer CDP bridge. |
| `/clear` | None | No | Clears the active conversation chat history inside the IDE. |
| `/accept` | None | No | Clicks the `Accept` button on the active AI code modification proposal in the IDE. |
| `/reject` | None | No | Clicks the `Reject` button on the active AI code modification proposal in the IDE. |
| `/conversations` | None | **Yes** | Fetches all open conversation threads in the IDE, allowing you to quickly switch between them via inline buttons. |
| `/open` | None | **Yes** | Interactive file explorer that lets you navigate through directories and open folder paths in the IDE (supports paginated navigation). |
| `/setproject` | `<path>` | No | Manually sets the active project root directory to the specified absolute path. |
| `/workflows` | None | **Yes** | Scans and lists executable workflow files (`.md` format) in `.agent/workflows/` and triggers them in the IDE. |
| `/skills` | None | **Yes** | Scans and lists executable custom skill directories in `.agent/skills/` and runs them. |
| `/endtask` | None | No | Remotely terminates the Antigravity process. |

---

## Command Highlights & Usage

### Model Switcher (`/model`)
When you send `/model`, the bot generates an inline button grid populated from the `AVAILABLE_MODELS` list in your `.env` configuration. Clicking any button updates the selected model in the IDE immediately without needing to open the IDE interface manually.

### Workspace Explorer (`/open`)
Send `/open` to trigger a directory browser. It starts at the current project directory:
- Click folders to drill down.
- Click `[ Open Here ]` to set the IDE workspace folder to the current directory.
- Supports paging options (`<< Prev`, `Next >>`) if a directory contains too many sub-items.

### Quota Delta Tracking (`/history_quota`)
The bot maintains a log of your AI usage. When `/quota` runs (either manually or via the automatic 5-minute background checker), it writes to `quota_history.json`. Running `/history_quota` parses this log to show your usage delta (e.g., `-100 tokens` or `-5.3%`).
