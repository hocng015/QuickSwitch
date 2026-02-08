import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const SECRET = process.env.PLUGIN_AUTH_SECRET || 'change-me-in-production';

// In-memory store for active pairing codes
// Map<code, { userId, expiresAt }>
const pairingCodes = new Map();

// Cleanup expired codes every 60 seconds
setInterval(() => {
    const now = Date.now();
    for (const [code, data] of pairingCodes) {
        if (now > data.expiresAt) {
            pairingCodes.delete(code);
        }
    }
}, 60_000);

/**
 * Generate a 6-character alphanumeric pairing code for a Discord user.
 * Valid for 5 minutes.
 */
export function generatePairingCode(userId) {
    // Remove any existing code for this user
    for (const [code, data] of pairingCodes) {
        if (data.userId === userId) {
            pairingCodes.delete(code);
        }
    }

    const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
    pairingCodes.set(code, {
        userId,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });

    return code;
}

/**
 * Validate a pairing code and return a JWT if valid.
 * Returns { success: true, token, userId } or { success: false, error }.
 */
export function validatePairingCode(code) {
    const upperCode = code.toUpperCase();
    const data = pairingCodes.get(upperCode);

    if (!data) {
        return { success: false, error: 'Invalid or expired pairing code.' };
    }

    if (Date.now() > data.expiresAt) {
        pairingCodes.delete(upperCode);
        return { success: false, error: 'Pairing code has expired.' };
    }

    // Code is valid - generate JWT and consume the code
    pairingCodes.delete(upperCode);

    const token = jwt.sign(
        { userId: data.userId, type: 'plugin_auth' },
        SECRET,
        { expiresIn: '365d' } // Long-lived token
    );

    return { success: true, token, userId: data.userId };
}

/**
 * Validate a JWT token and return the userId.
 * Returns userId string or null if invalid.
 */
export function validateToken(token) {
    try {
        const payload = jwt.verify(token, SECRET);
        if (payload.type !== 'plugin_auth') return null;
        return payload.userId;
    } catch {
        return null;
    }
}
