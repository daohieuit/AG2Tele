/**
 * AcceptDetector Service
 * Detect và quản lý Accept/Reject actions từ Antigravity
 * Sử dụng CDP (Chrome DevTools Protocol) để inject script và điều khiển WebView
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_PORT = 9000;  // Antigravity đang chạy CDP trên port 9000
const PORT_RANGE = 5;    // Scan ports 9218-9228 to cover edge cases

class AcceptDetector {
    constructor(eventBus, logger = console.log) {
        this.eventBus = eventBus;
        this.logger = logger;
        this.connections = new Map(); // port:pageId -> { ws, injected }
        this.pendingActions = new Map(); // actionId -> action object
        this.isRunning = false;
        this.msgId = 1;
        this.pollTimer = null;
        this.bridgeWs = null; // WebSocket từ detect_actions.js
        this.actionBridgeWs = null; // WebSocket connection to detect_actions.js in Antigravity
    }

    /**
     * Set the WebSocket connection from detect_actions.js
     * Called by server when action bridge connects
     */
    setBridgeWs(ws) {
        this.actionBridgeWs = ws;
        this.log('Action Bridge WebSocket set');
    }

    /**
     * Clear the WebSocket connection
     * Called by server when action bridge disconnects
     */
    clearBridgeWs() {
        this.actionBridgeWs = null;
        this.log('Action Bridge WebSocket cleared');
    }

    log(msg) {
        this.logger(`[AcceptDetector] ${msg}`);
    }

    logError(msg) {
        this.logger(`[AcceptDetector] ERROR: ${msg}`);
    }

    // ===== CDP PORT SCANNING =====

    /**
     * Check if any CDP port is available
     */
    async isCDPAvailable() {
        for (let port = BASE_PORT - PORT_RANGE; port <= BASE_PORT + PORT_RANGE; port++) {
            try {
                const pages = await this._getPages(port);
                if (pages.length > 0) {
                    this.log(`CDP available on port ${port}`);
                    return true;
                }
            } catch (e) {
                // Port not available
            }
        }
        return false;
    }

    /**
     * Get list of debuggable pages from CDP endpoint
     */
    async _getPages(port) {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: '127.0.0.1',
                port: port,
                path: '/json/list',
                timeout: 1000
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    try {
                        const pages = JSON.parse(body);
                        // Filter for pages that look like IDE windows
                        resolve(pages.filter(p =>
                            p.webSocketDebuggerUrl &&
                            (p.type === 'page' || p.type === 'webview')
                        ));
                    } catch (e) {
                        resolve([]);
                    }
                });
            });
            req.on('error', () => resolve([]));
            req.on('timeout', () => { req.destroy(); resolve([]); });
        });
    }

    // ===== CDP CONNECTION =====

    /**
     * Connect to a CDP page
     */
    async _connect(id, url) {
        return new Promise((resolve) => {
            try {
                const ws = new WebSocket(url);

                ws.on('open', () => {
                    this.connections.set(id, { ws, injected: false });
                    this.log(`Connected to page ${id}`);
                    resolve(true);
                });

                ws.on('error', (err) => {
                    this.logError(`Connection error for ${id}: ${err.message}`);
                    resolve(false);
                });

                ws.on('close', () => {
                    this.connections.delete(id);
                    this.log(`Disconnected from page ${id}`);
                });

            } catch (e) {
                this.logError(`Failed to connect to ${id}: ${e.message}`);
                resolve(false);
            }
        });
    }

    /**
     * Evaluate JavaScript in page context via CDP
     */
    async _evaluate(id, expression) {
        const conn = this.connections.get(id);
        if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const currentId = this.msgId++;
            const timeout = setTimeout(() => reject(new Error('CDP Timeout')), 5000);

            const onMessage = (data) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id === currentId) {
                        conn.ws.off('message', onMessage);
                        clearTimeout(timeout);
                        resolve(msg.result);
                    }
                } catch (e) {
                    // Ignore parse errors for other messages
                }
            };

            conn.ws.on('message', onMessage);
            conn.ws.send(JSON.stringify({
                id: currentId,
                method: 'Runtime.evaluate',
                params: {
                    expression: expression,
                    userGesture: true,
                    awaitPromise: true,
                    returnByValue: true
                }
            }));
        });
    }

    // ===== SCRIPT INJECTION =====

    /**
     * Inject the detect_actions.js script into page
     */
    async _inject(id, wsUrl) {
        const conn = this.connections.get(id);
        if (!conn) return false;

        try {
            if (!conn.injected) {
                // Read the detection script
                const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'detect_actions.js');
                const script = fs.readFileSync(scriptPath, 'utf8');

                // Inject the script
                await this._evaluate(id, script);
                conn.injected = true;
                this.log(`Script injected into ${id}`);
            }

            // Start the detector with WebSocket URL
            const startCmd = `window.__startActionDetector({ wsUrl: '${wsUrl}', pollInterval: 500 })`;
            await this._evaluate(id, startCmd);

            return true;
        } catch (e) {
            this.logError(`Injection failed for ${id}: ${e.message}`);
            return false;
        }
    }

    // ===== PUBLIC API =====

    /**
     * Start the AcceptDetector service
     */
    async start(wsUrl) {
        if (this.isRunning) {
            this.log('Already running');
            return true;
        }

        this.log('Starting AcceptDetector...');
        this.isRunning = true;

        // Scan and connect to CDP pages
        await this._scanAndConnect(wsUrl);

        // Setup periodic re-scan (pages may open/close)
        this.pollTimer = setInterval(async () => {
            await this._scanAndConnect(wsUrl);
            await this._pollPendingActions();
        }, 5000);

        return true;
    }

    /**
     * Stop the AcceptDetector service
     */
    async stop() {
        this.isRunning = false;

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        // Stop detector in all pages
        for (const [id, conn] of this.connections) {
            try {
                await this._evaluate(id, 'window.__stopActionDetector && window.__stopActionDetector()');
                conn.ws.close();
            } catch (e) {
                // Ignore errors during shutdown
            }
        }

        this.connections.clear();
        this.log('AcceptDetector stopped');
    }

    /**
     * Scan CDP ports and connect to pages
     */
    async _scanAndConnect(wsUrl) {
        this.log('Scanning CDP ports...');

        for (let port = BASE_PORT - PORT_RANGE; port <= BASE_PORT + PORT_RANGE; port++) {
            try {
                const pages = await this._getPages(port);

                for (const page of pages) {
                    const id = `${port}:${page.id}`;

                    if (!this.connections.has(id)) {
                        await this._connect(id, page.webSocketDebuggerUrl);
                    }

                    await this._inject(id, wsUrl);
                }
            } catch (e) {
                // Port not available, skip
            }
        }
    }

    /**
     * Poll pending actions from all connected pages
     */
    async _pollPendingActions() {
        for (const [id] of this.connections) {
            try {
                const result = await this._evaluate(id,
                    'JSON.stringify(window.__getPendingActions ? window.__getPendingActions() : [])'
                );

                if (result?.result?.value) {
                    const actions = JSON.parse(result.result.value);

                    for (const action of actions) {
                        // Check if this is a new action
                        if (!this.pendingActions.has(action.id)) {
                            this.pendingActions.set(action.id, {
                                ...action,
                                pageId: id
                            });

                            this.log(`New pending action: ${action.id} (${action.type})`);

                            // Emit event for WebSocket broadcast (use broadcast to all sessions)
                            this.eventBus.broadcast('pending_action', {
                                ...action,
                                pageId: id
                            });
                        }
                    }

                    // Remove actions that are no longer pending
                    const currentIds = new Set(actions.map(a => a.id));
                    for (const [actionId, action] of this.pendingActions) {
                        if (action.pageId === id && !currentIds.has(actionId)) {
                            this.pendingActions.delete(actionId);
                        }
                    }
                }
            } catch (e) {
                // Connection may have closed
            }
        }
    }

    /**
     * Get list of pending actions
     */
    getPendingActions() {
        return Array.from(this.pendingActions.values());
    }

    /**
     * Accept an action by ID
     * PRIORITY: Use WebSocket Bridge (more reliable) > CDP evaluation (fallback)
     */
    async acceptAction(actionId) {
        const action = this.pendingActions.get(actionId);
        if (!action) {
            return { success: false, error: 'Action not found' };
        }

        // ===== METHOD 1: WebSocket Bridge (PREFERRED) =====
        if (this.actionBridgeWs && this.actionBridgeWs.readyState === 1) { // WebSocket.OPEN = 1
            try {
                this.log(`Sending accept_action via WebSocket Bridge: ${actionId}`);
                this.actionBridgeWs.send(JSON.stringify({
                    type: 'accept_action',
                    actionId: actionId
                }));

                // Remove from pending (trust the bridge will handle it)
                this.pendingActions.delete(actionId);
                this.log(`Action accepted via Bridge: ${actionId}`);
                this.eventBus.broadcast('action_accepted', { id: actionId });

                return { success: true, method: 'websocket_bridge' };
            } catch (e) {
                this.logError(`WebSocket Bridge accept failed: ${e.message}`);
                // Fall through to CDP method
            }
        }

        // ===== METHOD 2: CDP Evaluation (FALLBACK) =====
        if (action.pageId) {
            try {
                this.log(`Trying CDP evaluation for: ${actionId}`);
                const result = await this._evaluate(action.pageId,
                    `JSON.stringify(window.__acceptAction('${actionId}'))`
                );

                if (result?.result?.value) {
                    const response = JSON.parse(result.result.value);
                    if (response.success) {
                        this.pendingActions.delete(actionId);
                        this.log(`Action accepted via CDP: ${actionId}`);
                        this.eventBus.broadcast('action_accepted', { id: actionId });
                    }
                    return { ...response, method: 'cdp' };
                }
            } catch (e) {
                this.logError(`CDP accept failed: ${e.message}`);
            }
        }

        return { success: false, error: 'No available method to accept action (WebSocket disconnected, CDP failed)' };
    }

    /**
     * Reject an action by ID
     * PRIORITY: Use WebSocket Bridge (more reliable) > CDP evaluation (fallback)
     */
    async rejectAction(actionId) {
        const action = this.pendingActions.get(actionId);
        if (!action) {
            return { success: false, error: 'Action not found' };
        }

        // ===== METHOD 1: WebSocket Bridge (PREFERRED) =====
        if (this.actionBridgeWs && this.actionBridgeWs.readyState === 1) { // WebSocket.OPEN = 1
            try {
                this.log(`Sending reject_action via WebSocket Bridge: ${actionId}`);
                this.actionBridgeWs.send(JSON.stringify({
                    type: 'reject_action',
                    actionId: actionId
                }));

                // Remove from pending (trust the bridge will handle it)
                this.pendingActions.delete(actionId);
                this.log(`Action rejected via Bridge: ${actionId}`);
                this.eventBus.broadcast('action_rejected', { id: actionId });

                return { success: true, method: 'websocket_bridge' };
            } catch (e) {
                this.logError(`WebSocket Bridge reject failed: ${e.message}`);
                // Fall through to CDP method
            }
        }

        // ===== METHOD 2: CDP Evaluation (FALLBACK) =====
        if (action.pageId) {
            try {
                this.log(`Trying CDP evaluation for reject: ${actionId}`);
                const result = await this._evaluate(action.pageId,
                    `JSON.stringify(window.__rejectAction('${actionId}'))`
                );

                if (result?.result?.value) {
                    const response = JSON.parse(result.result.value);
                    if (response.success) {
                        this.pendingActions.delete(actionId);
                        this.log(`Action rejected via CDP: ${actionId}`);
                        this.eventBus.broadcast('action_rejected', { id: actionId });
                    }
                    return { ...response, method: 'cdp' };
                }
            } catch (e) {
                this.logError(`CDP reject failed: ${e.message}`);
            }
        }

        return { success: false, error: 'No available method to reject action (WebSocket disconnected, CDP failed)' };
    }

    /**
     * Get statistics
     */
    async getStats() {
        const stats = {
            connections: this.connections.size,
            pendingActions: this.pendingActions.size,
            isRunning: this.isRunning,
        };

        // Aggregate stats from all pages
        for (const [id] of this.connections) {
            try {
                const result = await this._evaluate(id,
                    'JSON.stringify(window.__getActionStats ? window.__getActionStats() : {})'
                );
                if (result?.result?.value) {
                    const pageStats = JSON.parse(result.result.value);
                    stats.detected = (stats.detected || 0) + (pageStats.detected || 0);
                    stats.accepted = (stats.accepted || 0) + (pageStats.accepted || 0);
                    stats.rejected = (stats.rejected || 0) + (pageStats.rejected || 0);
                    stats.blocked = (stats.blocked || 0) + (pageStats.blocked || 0);
                }
            } catch (e) {
                // Ignore errors
            }
        }

        return stats;
    }

    /**
     * Handle incoming WebSocket message from detect_actions.js
     */
    handleBridgeMessage(message) {
        switch (message.type) {
            case 'action_detected':
                if (message.data && message.data.id) {
                    // ✅ FIX: Only broadcast if this is a NEW action (not already tracked)
                    if (!this.pendingActions.has(message.data.id)) {
                        this.pendingActions.set(message.data.id, message.data);
                        this.eventBus.broadcast('pending_action', message.data);
                        this.log(`New action from bridge: ${message.data.id}`);
                    }
                }
                break;

            case 'action_accepted':
                if (message.data?.id) {
                    this.pendingActions.delete(message.data.id);
                    this.eventBus.broadcast('action_accepted', message.data);
                }
                break;

            case 'action_rejected':
                if (message.data?.id) {
                    this.pendingActions.delete(message.data.id);
                    this.eventBus.broadcast('action_rejected', message.data);
                }
                break;

            case 'action_timeout':
                if (message.data?.id) {
                    this.pendingActions.delete(message.data.id);
                    this.eventBus.broadcast('action_timeout', message.data);
                }
                break;
        }
    }
}

module.exports = AcceptDetector;
