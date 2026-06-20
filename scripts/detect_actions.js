/**
 * Accept/Reject Action Detector Script
 * Được inject vào Antigravity WebView qua CDP để detect các pending actions
 * 
 * Exposed globals:
 * - window.__pendingActions: Array of pending action objects
 * - window.__getPendingActions(): Get current pending actions
 * - window.__acceptAction(id): Accept a specific action
 * - window.__rejectAction(id): Reject a specific action
 * - window.__startActionDetector(config): Start detection loop
 * - window.__stopActionDetector(): Stop detection loop
 */

(function () {
    'use strict';

    // ===== CONFIGURATION =====
    const CONFIG = {
        pollInterval: 500,  // ms between polls
        debug: true,
        timeout: 120000,    // 2 minutes timeout for actions
    };

    // ===== DANGEROUS COMMANDS BLOCKLIST =====
    const BANNED_COMMANDS = [
        'rm -rf /',
        'rm -rf ~',
        'rm -rf *',
        'rm -rf .',
        'format c:',
        'del /f /s /q c:',
        'rmdir /s /q c:',
        ':(){:|:&};:',      // fork bomb
        'dd if=/dev/zero',
        'dd if=/dev/random',
        'mkfs.',
        '> /dev/sda',
        'chmod -R 777 /',
        'chmod 000 /',
        'shutdown',
        'reboot',
        'halt',
        'poweroff',
    ];

    // ===== ACCEPT PATTERNS (from Auto Accept Agent) =====
    // https://github.com/MunKhin/auto-accept-agent
    const ACCEPT_PATTERNS = [
        { pattern: 'accept', exact: false },
        { pattern: 'accept all', exact: false },
        { pattern: 'acceptalt', exact: false },
        { pattern: 'run command', exact: false },
        { pattern: 'run', exact: false },
        { pattern: 'run code', exact: false },
        { pattern: 'run cell', exact: false },
        { pattern: 'run all', exact: false },
        { pattern: 'run selection', exact: false },
        { pattern: 'run and debug', exact: false },
        { pattern: 'run test', exact: false },
        { pattern: 'apply', exact: true },
        { pattern: 'execute', exact: true },
        { pattern: 'resume', exact: true },
        { pattern: 'retry', exact: true },
        { pattern: 'try again', exact: false },
        { pattern: 'confirm', exact: false },
        { pattern: 'allow once', exact: true }
    ];

    const REJECT_PATTERNS = ['skip', 'reject', 'cancel', 'discard', 'deny', 'close', 'refine', 'other'];

    // ===== ACCEPT BUTTON SELECTORS (from Auto Accept Agent) =====
    // CHÚ Ý: Không dùng selectors quá rộng như 'button' hay '[class*="button"]' vì gây spam!
    const ACCEPT_SELECTORS = [
        // Antigravity specific (từ Auto Accept Agent)
        '.bg-ide-button-background',

        // Class-based - chỉ những class cụ thể liên quan đến accept/run
        '[class*="accept"]',
        '[class*="run-button"]',
        '[class*="apply-button"]',
        '[class*="execute-button"]',

        // Data attributes
        '[data-testid*="accept"]',
        '[data-testid*="run"]',
        '[data-action="accept"]',
        '[data-action="run"]',
    ];

    const REJECT_SELECTORS = [
        '[data-testid*="reject"]',
        '[data-action="reject"]',
        '[class*="reject"]',
        '[class*="cancel-button"]',
    ];

    // ===== STATE =====
    let pollTimer = null;
    let actionCounter = 0;
    let wsConnection = null;

    window.__pendingActions = [];
    window.__actionStats = {
        detected: 0,
        accepted: 0,
        rejected: 0,
        blocked: 0,
        timedOut: 0,
    };

    // ===== LOGGING =====
    function log(msg) {
        if (CONFIG.debug) {
            console.log(`[ActionDetector] ${msg}`);
        }
    }

    function logError(msg) {
        console.error(`[ActionDetector] ERROR: ${msg}`);
    }

    // ===== UTILITY FUNCTIONS =====

    /**
     * Find all elements matching any of the selectors
     */
    function findElements(selectors) {
        const results = [];
        const seen = new Set();

        for (const selector of selectors) {
            try {
                // Handle :has-text pseudo selector (not native CSS)
                if (selector.includes(':has-text(')) {
                    const match = selector.match(/(.*):has-text\("(.*)"\)/);
                    if (match) {
                        const [, baseSelector, text] = match;
                        const base = baseSelector || '*';
                        document.querySelectorAll(base).forEach(el => {
                            if (el.textContent?.includes(text) && !seen.has(el)) {
                                seen.add(el);
                                results.push(el);
                            }
                        });
                    }
                } else {
                    document.querySelectorAll(selector).forEach(el => {
                        if (!seen.has(el)) {
                            seen.add(el);
                            results.push(el);
                        }
                    });
                }
            } catch (e) {
                // Ignore invalid selectors
            }
        }

        return results;
    }

    /**
     * Check if element is visible (from Auto Accept Agent)
     */
    function isElementVisible(el) {
        if (!el) return false;
        const win = el.ownerDocument.defaultView || window;
        const style = win.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            parseFloat(style.opacity) > 0.1 &&
            rect.width > 0 &&
            rect.height > 0;
    }

    /**
     * Check if element is clickable (from Auto Accept Agent)
     */
    function isElementClickable(el) {
        if (!el) return false;
        const win = el.ownerDocument.defaultView || window;
        const style = win.getComputedStyle(el);
        return style.pointerEvents !== 'none' && !el.disabled && !el.hasAttribute('disabled');
    }

    /**
     * Check if button is an Accept button based on text (from Auto Accept Agent)
     */
    function isAcceptButton(el) {
        if (!el || !el.textContent) return false;

        const text = el.textContent.trim().toLowerCase();
        if (text.length === 0 || text.length > 50) return false;

        // Pattern matching với ACCEPT_PATTERNS
        const matched = ACCEPT_PATTERNS.some(p =>
            p.exact ? text === p.pattern : text.includes(p.pattern)
        );
        if (!matched) return false;

        // Reject nếu match với REJECT_PATTERNS
        if (REJECT_PATTERNS.some(p => text.includes(p))) {
            return false;
        }

        // State validation
        return isElementVisible(el) && isElementClickable(el);
    }

    /**
     * Check if a command is dangerous
     */
    function isDangerousCommand(command) {
        if (!command) return false;
        const lowerCmd = command.toLowerCase().trim();

        for (const banned of BANNED_COMMANDS) {
            if (lowerCmd.includes(banned.toLowerCase())) {
                return true;
            }
        }

        // Additional pattern checks
        if (/rm\s+(-[rf]+\s+)*\//.test(lowerCmd)) return true;
        if (/dd\s+if=\/dev\/(zero|random|urandom)/.test(lowerCmd)) return true;

        return false;
    }

    /**
     * Extract action details from button context
     */
    function extractActionDetails(button) {
        const action = {
            type: 'unknown',
            content: '',
            fileName: null,
            command: null,
            isDangerous: false,
        };

        // Try to determine action type from button text or parent context
        const buttonText = button.textContent?.toLowerCase() || '';
        const parentText = button.closest('[class*="message"], [class*="action"], [class*="diff"]')?.textContent || '';

        // Detect file changes
        if (buttonText.includes('accept') || parentText.includes('file') || parentText.includes('changes')) {
            action.type = 'file_edit';

            // Try to find file name
            const fileMatch = parentText.match(/([a-zA-Z0-9_\-./]+\.[a-zA-Z0-9]+)/);
            if (fileMatch) {
                action.fileName = fileMatch[1];
            }

            // Look for diff stats
            const diffMatch = parentText.match(/\+(\d+)\s*-(\d+)/);
            if (diffMatch) {
                action.content = `+${diffMatch[1]} -${diffMatch[2]} lines`;
            }
        }

        // Detect terminal commands
        if (buttonText.includes('run') || buttonText.includes('execute') ||
            parentText.includes('terminal') || parentText.includes('command')) {
            action.type = 'terminal_command';

            // Try to extract command
            const codeBlock = button.closest('[class*="message"]')?.querySelector('code, pre');
            if (codeBlock) {
                action.command = codeBlock.textContent?.trim();
                action.content = action.command;
                action.isDangerous = isDangerousCommand(action.command);
            }
        }

        // Detect retry prompts
        if (buttonText.includes('retry') || buttonText.includes('try again')) {
            action.type = 'retry';
            action.content = 'Retry failed action';
        }

        return action;
    }

    /**
     * Find paired reject button for an accept button
     */
    function findRejectButton(acceptButton) {
        // Look for reject button in same container
        const container = acceptButton.closest('[class*="action"], [class*="button"], [class*="toolbar"]');
        if (container) {
            const rejectButtons = findElements(REJECT_SELECTORS);
            for (const btn of rejectButtons) {
                if (container.contains(btn)) {
                    return btn;
                }
            }
        }
        return null;
    }

    // ===== CORE DETECTION =====

    /**
     * Scan DOM for accept buttons and update pending actions
     */
    function scanForActions() {
        const allButtons = findElements(ACCEPT_SELECTORS);
        const newActions = [];

        for (const button of allButtons) {
            // ========== FIX: Dùng isAcceptButton để filter đúng ==========
            // Chỉ những button có text match với ACCEPT_PATTERNS mới được detect
            if (!isAcceptButton(button)) continue;

            // Check if we already tracked this button
            const existingAction = window.__pendingActions.find(a => a.element === button);
            if (existingAction) {
                // Keep existing action
                newActions.push(existingAction);
                continue;
            }

            // Create new action
            const details = extractActionDetails(button);
            const rejectButton = findRejectButton(button);

            // ========== FIX: Chỉ detect nếu type không phải 'unknown' ==========
            // Tránh spam những button không liên quan
            if (details.type === 'unknown') {
                // Double check: nếu button text chứa accept/run thì vẫn cho qua
                const btnText = button.textContent?.toLowerCase() || '';
                if (!btnText.includes('accept') && !btnText.includes('run') &&
                    !btnText.includes('apply') && !btnText.includes('execute')) {
                    continue;
                }
                details.type = 'action_request';
                details.content = button.textContent?.trim().substring(0, 100) || '';
            }

            const action = {
                id: `action_${++actionCounter}_${Date.now()}`,
                element: button,
                rejectElement: rejectButton,
                type: details.type,
                content: details.content,
                fileName: details.fileName,
                command: details.command,
                isDangerous: details.isDangerous,
                detectedAt: Date.now(),
                status: 'pending',
            };

            newActions.push(action);
            window.__actionStats.detected++;

            log(`New action detected: ${action.id} (${action.type}) - "${button.textContent?.trim().substring(0, 30)}"`);

            // Notify backend via WebSocket if connected
            notifyBackend('action_detected', action);
        }

        // Check for timed out actions
        const now = Date.now();
        window.__pendingActions = newActions.filter(action => {
            if (now - action.detectedAt > CONFIG.timeout) {
                log(`Action timed out: ${action.id}`);
                window.__actionStats.timedOut++;
                notifyBackend('action_timeout', { id: action.id });
                return false;
            }
            return true;
        });
    }

    // ===== WEBSOCKET COMMUNICATION =====

    /**
     * Connect to backend WebSocket
     */
    function connectToBackend(wsUrl) {
        if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
            log('WebSocket already connected');
            return;
        }

        try {
            wsConnection = new WebSocket(wsUrl);

            wsConnection.onopen = () => {
                log('WebSocket connected to backend');
                wsConnection.send(JSON.stringify({
                    type: 'action_detector_register',
                    source: 'antigravity'
                }));
            };

            wsConnection.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleBackendMessage(msg);
                } catch (e) {
                    logError(`Failed to parse WebSocket message: ${e.message}`);
                }
            };

            wsConnection.onclose = () => {
                log('WebSocket disconnected, will retry...');
                wsConnection = null;
                // Retry connection after 5 seconds
                setTimeout(() => connectToBackend(wsUrl), 5000);
            };

            wsConnection.onerror = (error) => {
                logError(`WebSocket error: ${error.message || 'Unknown'}`);
            };

        } catch (e) {
            logError(`Failed to connect WebSocket: ${e.message}`);
        }
    }

    /**
     * Send message to backend
     */
    function notifyBackend(type, data) {
        if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
            log(`Cannot notify backend (not connected): ${type}`);
            return;
        }

        const message = {
            type: type,
            data: {
                ...data,
                // Don't send DOM elements
                element: undefined,
                rejectElement: undefined,
            },
            timestamp: Date.now(),
        };

        wsConnection.send(JSON.stringify(message));
    }

    /**
     * Handle messages from backend
     */
    function handleBackendMessage(msg) {
        log(`Received from backend: ${msg.type}`);

        switch (msg.type) {
            case 'accept_action':
                window.__acceptAction(msg.actionId);
                break;
            case 'reject_action':
                window.__rejectAction(msg.actionId);
                break;
            case 'get_pending':
                notifyBackend('pending_actions', {
                    actions: window.__getPendingActions()
                });
                break;
        }
    }

    // ===== PUBLIC API =====

    /**
     * Get list of pending actions (without DOM elements)
     */
    window.__getPendingActions = function () {
        return window.__pendingActions.map(a => ({
            id: a.id,
            type: a.type,
            content: a.content,
            fileName: a.fileName,
            command: a.command,
            isDangerous: a.isDangerous,
            detectedAt: a.detectedAt,
            status: a.status,
            age: Date.now() - a.detectedAt,
        }));
    };

    /**
     * Accept a specific action by ID
     */
    window.__acceptAction = function (actionId) {
        const action = window.__pendingActions.find(a => a.id === actionId);

        if (!action) {
            logError(`Action not found: ${actionId}`);
            return { success: false, error: 'Action not found' };
        }

        if (action.isDangerous) {
            log(`WARNING: Accepting dangerous action: ${actionId}`);
            window.__actionStats.blocked++; // Track but still allow if user confirms
        }

        try {
            // Click the accept button
            action.element.click();
            action.status = 'accepted';
            window.__actionStats.accepted++;

            log(`Action accepted: ${actionId}`);
            notifyBackend('action_accepted', { id: actionId });

            // Remove from pending
            window.__pendingActions = window.__pendingActions.filter(a => a.id !== actionId);

            return { success: true };
        } catch (e) {
            logError(`Failed to accept action: ${e.message}`);
            return { success: false, error: e.message };
        }
    };

    /**
     * Reject a specific action by ID
     */
    window.__rejectAction = function (actionId) {
        const action = window.__pendingActions.find(a => a.id === actionId);

        if (!action) {
            logError(`Action not found: ${actionId}`);
            return { success: false, error: 'Action not found' };
        }

        try {
            if (action.rejectElement) {
                // Click the reject button
                action.rejectElement.click();
            } else {
                // Try pressing Escape or finding dismiss button
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            }

            action.status = 'rejected';
            window.__actionStats.rejected++;

            log(`Action rejected: ${actionId}`);
            notifyBackend('action_rejected', { id: actionId });

            // Remove from pending
            window.__pendingActions = window.__pendingActions.filter(a => a.id !== actionId);

            return { success: true };
        } catch (e) {
            logError(`Failed to reject action: ${e.message}`);
            return { success: false, error: e.message };
        }
    };

    /**
     * Start the action detector
     */
    window.__startActionDetector = function (config = {}) {
        if (pollTimer) {
            log('Action detector already running');
            return;
        }

        // Merge config
        Object.assign(CONFIG, config);

        log(`Starting action detector (poll interval: ${CONFIG.pollInterval}ms)`);

        // Connect to backend if URL provided
        if (config.wsUrl) {
            connectToBackend(config.wsUrl);
        }

        // Start polling
        scanForActions();
        pollTimer = setInterval(scanForActions, CONFIG.pollInterval);

        return { success: true, message: 'Action detector started' };
    };

    /**
     * Stop the action detector
     */
    window.__stopActionDetector = function () {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        if (wsConnection) {
            wsConnection.close();
            wsConnection = null;
        }

        log('Action detector stopped');
        return { success: true, message: 'Action detector stopped' };
    };

    /**
     * Get statistics
     */
    window.__getActionStats = function () {
        return {
            ...window.__actionStats,
            pendingCount: window.__pendingActions.length,
        };
    };

    // Log initialization
    log('Action detector script loaded');

})();
