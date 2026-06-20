# Contributing Guide

Thank you for your interest in contributing to AntiBridge! Here are some guidelines and tips to help you get started.

## Repository Layout
- **`backend/`**: Contains the core NodeJS/Express backend, the Telegram Bot, and services connecting to the IDE.
- **`scripts/`**: Holds JavaScript hooks that are injected into the Antigravity IDE, auto-click automation scripts, and helper script files.
- **`docs/`**: Documentation files.

---

## Development Setup

1. Fork/clone the repository to your local machine.
2. Initialize and install dependencies:
   ```bash
   SETUP.bat
   ```
3. Copy `.env.example` to `.env` and fill in your developer bot token and chat ID.
4. Run the development server with live reload:
   ```bash
   npm run dev
   ```

---

## Modifying Injected Scripts
When changing files like `scripts/chat_bridge_ws.js` or `scripts/detect_actions.js`:
- These scripts are injected directly into the Chromium page context of the IDE.
- When testing, you will need to run `/reconnect` or restart the bot to re-inject the modified scripts into the active page frame.
- Keep dependency size at zero for injected scripts; use vanilla DOM APIs and standard WebSockets available in the Chromium browser window.

---

## Code Quality and Style Guidelines
- **JavaScript**: Use clean, modern ES6+ standards. Use `async/await` rather than nested promises.
- **Error Handling**: Always wrap remote CDP evaluations and page interactions in `try/catch` blocks. The IDE window might be closed or refreshed at any time, which must not crash the bot server.
- **Comments**: Write descriptive comments for complex selectors or DOM manipulation hacks, detailing what class name/attribute is being targeted.

---

## Submitting Pull Requests
1. Create a descriptive feature branch: `git checkout -b feature/amazing-feature`.
2. Add clear commit messages detailing the changes.
3. Ensure no local secrets or active `.env` configuration properties are committed.
4. Push your branch and open a Pull Request.
5. Make sure to update the documentation in both English (`docs/`) and Vietnamese (`docs/vi/`) if your PR introduces new configuration parameters or commands.
