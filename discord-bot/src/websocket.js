import { WebSocketServer } from 'ws';
import { validateToken, validatePairingCode } from './auth.js';

/**
 * Manages WebSocket connections from Dalamud plugins.
 * Each connection is authenticated and associated with a Discord user ID.
 */
export class PluginSocketManager {
    constructor() {
        /** @type {Map<string, import('ws').WebSocket>} userId -> WebSocket */
        this.connections = new Map();

        /** @type {Map<string, object>} userId -> last known status */
        this.statusCache = new Map();

        /** @type {Map<string, { resolve, reject, timer }>} requestId -> pending response */
        this.pendingRequests = new Map();

        this.wss = null;
    }

    /**
     * Attach to an HTTP server for WebSocket upgrade handling.
     */
    attach(httpServer) {
        this.wss = new WebSocketServer({ server: httpServer });

        this.wss.on('connection', (ws, req) => {
            this._handleConnection(ws, req);
        });

        console.log('[WS] WebSocket server attached.');
    }

    /**
     * Check if a user's plugin is currently connected.
     */
    isOnline(userId) {
        const ws = this.connections.get(userId);
        return ws && ws.readyState === 1; // WebSocket.OPEN
    }

    /**
     * Get the last known status for a user.
     */
    getStatus(userId) {
        return this.statusCache.get(userId) || null;
    }

    /**
     * Send a command to a user's plugin and wait for a response.
     * Returns a Promise that resolves with the result payload.
     * @param {string} userId
     * @param {object} payload - Command payload (action, params, etc.)
     * @param {number} timeoutMs - Timeout in milliseconds (default 15s)
     */
    sendCommand(userId, payload, timeoutMs = 15_000) {
        return new Promise((resolve, reject) => {
            const ws = this.connections.get(userId);
            if (!ws || ws.readyState !== 1) {
                reject(new Error('Plugin is not connected.'));
                return;
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestId);
                reject(new Error('Plugin did not respond in time.'));
            }, timeoutMs);

            this.pendingRequests.set(requestId, { resolve, reject, timer });

            const message = JSON.stringify({
                type: 'command',
                requestId,
                payload,
            });

            ws.send(message);
        });
    }

    /**
     * Send a fire-and-forget message to a user's plugin.
     */
    sendMessage(userId, type, payload) {
        const ws = this.connections.get(userId);
        if (!ws || ws.readyState !== 1) return false;

        ws.send(JSON.stringify({ type, payload }));
        return true;
    }

    // --- Private ---

    _handleConnection(ws, req) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const pairingCode = url.searchParams.get('pair');

        // Handle pairing flow
        if (pairingCode) {
            this._handlePairing(ws, pairingCode);
            return;
        }

        // Handle token auth
        if (!token) {
            ws.close(4001, 'Missing authentication token.');
            return;
        }

        const userId = validateToken(token);
        if (!userId) {
            ws.close(4001, 'Invalid authentication token.');
            return;
        }

        // Close existing connection for this user (if any)
        const existing = this.connections.get(userId);
        if (existing && existing.readyState === 1) {
            existing.close(4000, 'New connection established.');
        }

        this.connections.set(userId, ws);
        console.log(`[WS] Plugin connected for user ${userId}`);

        // Send welcome
        ws.send(JSON.stringify({
            type: 'connected',
            payload: { message: 'Connected to QuickSwitch server.' },
        }));

        ws.on('message', (data) => {
            this._handleMessage(userId, ws, data);
        });

        ws.on('close', (code, reason) => {
            if (this.connections.get(userId) === ws) {
                this.connections.delete(userId);
                console.log(`[WS] Plugin disconnected for user ${userId} (code: ${code})`);
            }
        });

        ws.on('error', (err) => {
            console.error(`[WS] Error for user ${userId}:`, err.message);
        });
    }

    _handlePairing(ws, code) {
        const result = validatePairingCode(code);

        ws.send(JSON.stringify({
            type: 'auth_result',
            payload: result,
        }));

        if (result.success) {
            console.log(`[WS] Pairing successful for user ${result.userId}`);
            // Don't close - let the plugin reconnect with the token
        }

        // Close the pairing connection after sending result
        setTimeout(() => ws.close(1000, 'Pairing complete.'), 1000);
    }

    _handleMessage(userId, ws, data) {
        let msg;
        try {
            msg = JSON.parse(data.toString());
        } catch {
            return;
        }

        switch (msg.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong', payload: { timestamp: Date.now() } }));
                break;

            case 'status_update':
                this.statusCache.set(userId, {
                    ...msg.payload,
                    lastUpdate: Date.now(),
                });
                break;

            case 'command_result': {
                const pending = this.pendingRequests.get(msg.requestId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pendingRequests.delete(msg.requestId);
                    pending.resolve(msg.payload);
                }
                break;
            }

            default:
                break;
        }
    }
}

// Singleton instance
export const pluginSocket = new PluginSocketManager();
