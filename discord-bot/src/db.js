/**
 * PostgreSQL database layer for audit logging and user management.
 * Connects to Railway's Postgres via DATABASE_URL env var.
 */

import pg from 'pg';
const { Pool } = pg;

let pool;

/**
 * Initialize the database: connect to Postgres, create tables and indexes.
 */
export async function initDatabase() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('[DB] DATABASE_URL not set — database features disabled.');
        return;
    }

    pool = new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
    });

    // Test connection
    try {
        await pool.query('SELECT NOW()');
    } catch (err) {
        console.error('[DB] Failed to connect to Postgres:', err.message);
        pool = null;
        return;
    }

    // Create tables
    await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id          SERIAL PRIMARY KEY,
            user_id     TEXT NOT NULL,
            username    TEXT,
            action      TEXT NOT NULL,
            details     TEXT,
            success     BOOLEAN DEFAULT TRUE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_log(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id     TEXT PRIMARY KEY,
            username    TEXT,
            is_banned   BOOLEAN DEFAULT FALSE,
            ban_reason  TEXT,
            banned_at   TIMESTAMPTZ,
            banned_by   TEXT,
            first_seen  TIMESTAMPTZ DEFAULT NOW(),
            last_seen   TIMESTAMPTZ
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS qs_access (
            user_id     TEXT PRIMARY KEY,
            allowed     BOOLEAN DEFAULT TRUE,
            reason      TEXT,
            set_by      TEXT,
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Schedule daily cleanup of old audit logs (90 days)
    setInterval(async () => {
        try {
            const result = await pool.query(
                "DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '90 days'"
            );
            if (result.rowCount > 0) {
                console.log(`[DB] Cleaned up ${result.rowCount} audit log entries older than 90 days.`);
            }
        } catch (err) {
            console.error('[DB] Cleanup error:', err.message);
        }
    }, 24 * 3600_000);

    console.log('[DB] PostgreSQL database initialized.');
}

/**
 * Gracefully close the pool.
 */
export async function closeDatabase() {
    if (pool) await pool.end();
}

/**
 * Check if DB is available.
 */
function isReady() {
    return !!pool;
}

// ========== Audit Log ==========

/**
 * Log an action to the audit log.
 */
export async function logAudit({ userId, username, action, details, success = true }) {
    if (!isReady()) return;
    try {
        const detailsStr = typeof details === 'string' ? details : JSON.stringify(details || null);
        await pool.query(
            'INSERT INTO audit_log (user_id, username, action, details, success) VALUES ($1, $2, $3, $4, $5)',
            [userId, username || null, action, detailsStr, !!success]
        );
    } catch (err) {
        console.error('[DB] Failed to log audit:', err.message);
    }
}

/**
 * Query audit logs with optional filters.
 * @returns {{ rows: Array, total: number }}
 */
export async function getAuditLogs({ userId, action, limit = 25, offset = 0, since, until } = {}) {
    if (!isReady()) return { rows: [], total: 0 };

    const conditions = [];
    const params = [];
    let paramIdx = 1;

    if (userId) {
        conditions.push(`user_id = $${paramIdx++}`);
        params.push(userId);
    }
    if (action) {
        conditions.push(`action LIKE $${paramIdx++}`);
        params.push(`%${action}%`);
    }
    if (since) {
        conditions.push(`created_at >= $${paramIdx++}`);
        params.push(since);
    }
    if (until) {
        conditions.push(`created_at <= $${paramIdx++}`);
        params.push(until);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM audit_log ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const queryResult = await pool.query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, limit, offset]
    );

    return { rows: queryResult.rows, total };
}

/**
 * Get aggregate statistics from the audit log.
 */
export async function getAuditStats({ since } = {}) {
    if (!isReady()) return { actions: [], totalUsers: 0, totalActions: 0, topUser: null };

    const sinceClause = since ? 'WHERE created_at >= $1' : '';
    const params = since ? [since] : [];

    const actionsResult = await pool.query(`
        SELECT action,
               COUNT(*)::int as count,
               SUM(CASE WHEN success THEN 1 ELSE 0 END)::int as successes,
               SUM(CASE WHEN NOT success THEN 1 ELSE 0 END)::int as failures
        FROM audit_log ${sinceClause}
        GROUP BY action ORDER BY count DESC
    `, params);

    const totalUsersResult = await pool.query(
        `SELECT COUNT(DISTINCT user_id)::int as count FROM audit_log ${sinceClause}`,
        params
    );

    const totalActionsResult = await pool.query(
        `SELECT COUNT(*)::int as count FROM audit_log ${sinceClause}`,
        params
    );

    const topUserResult = await pool.query(`
        SELECT user_id, username, COUNT(*)::int as count
        FROM audit_log ${sinceClause}
        GROUP BY user_id, username ORDER BY count DESC LIMIT 1
    `, params);

    return {
        actions: actionsResult.rows,
        totalUsers: totalUsersResult.rows[0]?.count || 0,
        totalActions: totalActionsResult.rows[0]?.count || 0,
        topUser: topUserResult.rows[0] || null,
    };
}

// ========== User Management ==========

/**
 * Create or update a user record (updates last_seen and username).
 */
export async function upsertUser(userId, username) {
    if (!isReady()) return;
    try {
        await pool.query(`
            INSERT INTO users (user_id, username, last_seen)
            VALUES ($1, $2, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                username = COALESCE($2, users.username),
                last_seen = NOW()
        `, [userId, username || null]);
    } catch (err) {
        console.error('[DB] Failed to upsert user:', err.message);
    }
}

/**
 * Get a user record.
 */
export async function getUser(userId) {
    if (!isReady()) return null;
    const result = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    return result.rows[0] || null;
}

/**
 * Check if a user is banned.
 * @returns {{ banned: boolean, reason: string|null }}
 */
export async function isUserBanned(userId) {
    if (!isReady()) return { banned: false, reason: null };
    const result = await pool.query(
        'SELECT is_banned, ban_reason FROM users WHERE user_id = $1',
        [userId]
    );
    const row = result.rows[0];
    if (!row) return { banned: false, reason: null };
    return { banned: !!row.is_banned, reason: row.ban_reason };
}

/**
 * Ban a user.
 */
export async function banUser(userId, reason, bannedBy) {
    if (!isReady()) return;
    await upsertUser(userId, null);
    await pool.query(
        'UPDATE users SET is_banned = TRUE, ban_reason = $2, banned_at = NOW(), banned_by = $3 WHERE user_id = $1',
        [userId, reason || null, bannedBy]
    );
}

/**
 * Unban a user.
 */
export async function unbanUser(userId) {
    if (!isReady()) return;
    await pool.query(
        'UPDATE users SET is_banned = FALSE, ban_reason = NULL, banned_at = NULL, banned_by = NULL WHERE user_id = $1',
        [userId]
    );
}

/**
 * Get all known users.
 */
export async function getAllUsers() {
    if (!isReady()) return [];
    const result = await pool.query('SELECT * FROM users ORDER BY last_seen DESC NULLS LAST');
    return result.rows;
}

// ========== QuickSwitch Access Control ==========

/**
 * Check if a user is allowed to use QuickSwitch.
 * Returns { allowed: true } if no record exists (default allow).
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export async function isQsAllowed(userId) {
    if (!isReady()) return { allowed: true, reason: null };
    try {
        const result = await pool.query(
            'SELECT allowed, reason FROM qs_access WHERE user_id = $1',
            [userId]
        );
        if (!result.rows[0]) return { allowed: true, reason: null };
        return { allowed: !!result.rows[0].allowed, reason: result.rows[0].reason };
    } catch (err) {
        console.error('[DB] Failed to check qs access:', err.message);
        return { allowed: true, reason: null };
    }
}

/**
 * Set a user's QuickSwitch access (whitelist or blacklist).
 */
export async function setQsAccess(userId, allowed, reason, setBy) {
    if (!isReady()) return;
    try {
        await pool.query(`
            INSERT INTO qs_access (user_id, allowed, reason, set_by, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                allowed = $2,
                reason = $3,
                set_by = $4,
                updated_at = NOW()
        `, [userId, allowed, reason || null, setBy]);
    } catch (err) {
        console.error('[DB] Failed to set qs access:', err.message);
    }
}

/**
 * Remove a user's QuickSwitch access override (revert to default allow).
 */
export async function removeQsAccess(userId) {
    if (!isReady()) return;
    try {
        await pool.query('DELETE FROM qs_access WHERE user_id = $1', [userId]);
    } catch (err) {
        console.error('[DB] Failed to remove qs access:', err.message);
    }
}

/**
 * Get all QuickSwitch access entries.
 * @returns {Array<{ user_id, allowed, reason, set_by, updated_at }>}
 */
export async function getAllQsAccess() {
    if (!isReady()) return [];
    try {
        const result = await pool.query('SELECT * FROM qs_access ORDER BY updated_at DESC');
        return result.rows;
    } catch (err) {
        console.error('[DB] Failed to get qs access list:', err.message);
        return [];
    }
}
