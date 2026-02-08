/**
 * Middleware layer for safety guards: ban checking, rate limiting, and audit logging.
 */

import { logAudit, upsertUser, isUserBanned } from './db.js';

// ========== Rate Limiting ==========

// Map<userId, Map<actionCategory, { count, resetAt }>>
const rateLimits = new Map();

const RATE_LIMIT_RULES = {
    'command:setup':    { max: 3,  windowMs: 300_000 },
    'command:admin':    { max: 20, windowMs: 60_000 },
    'command:switch':   { max: 5,  windowMs: 60_000 },
    'component':        { max: 30, windowMs: 60_000 },
    'modal':            { max: 10, windowMs: 60_000 },
    'default':          { max: 15, windowMs: 60_000 },
};

/**
 * Check if a user is rate-limited for the given action category.
 * @returns {{ limited: boolean, retryAfterMs: number }}
 */
function checkRateLimit(userId, actionCategory) {
    // Determine the rule: try exact match, then prefix, then default
    const rule = RATE_LIMIT_RULES[actionCategory]
        || RATE_LIMIT_RULES[actionCategory.split(':')[0]]
        || RATE_LIMIT_RULES.default;

    if (!rateLimits.has(userId)) {
        rateLimits.set(userId, new Map());
    }
    const userLimits = rateLimits.get(userId);

    const now = Date.now();
    const entry = userLimits.get(actionCategory);

    if (!entry || now >= entry.resetAt) {
        // New window
        userLimits.set(actionCategory, { count: 1, resetAt: now + rule.windowMs });
        return { limited: false, retryAfterMs: 0 };
    }

    if (entry.count >= rule.max) {
        const retryAfterMs = entry.resetAt - now;
        return { limited: true, retryAfterMs };
    }

    entry.count++;
    return { limited: false, retryAfterMs: 0 };
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [userId, userLimits] of rateLimits) {
        for (const [action, entry] of userLimits) {
            if (now >= entry.resetAt) {
                userLimits.delete(action);
            }
        }
        if (userLimits.size === 0) {
            rateLimits.delete(userId);
        }
    }
}, 300_000);

// ========== Admin Check ==========

/**
 * Check if a user ID is an admin (from ADMIN_USER_IDS env var).
 */
export function isAdmin(userId) {
    const adminIds = (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return adminIds.includes(userId);
}

// ========== Pre-execution Check ==========

/**
 * Run all pre-execution checks for an interaction.
 * Updates user tracking, checks bans, checks rate limits.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} actionType - e.g. 'command:go', 'component:go_execute'
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function preCheck(interaction, actionType) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // 1. Update user tracking (last_seen, create if new) — fire and forget
    upsertUser(userId, username);

    // 2. Check if banned
    const banStatus = await isUserBanned(userId);
    if (banStatus.banned) {
        const reason = banStatus.reason ? `: ${banStatus.reason}` : '.';
        logAudit({
            userId,
            username,
            action: actionType,
            details: { blocked: 'banned' },
            success: false,
        });
        return { allowed: false, reason: `You are banned from using this bot${reason}` };
    }

    // 3. Check rate limit (in-memory, stays synchronous)
    const rateCategory = actionType.startsWith('component:') ? 'component'
        : actionType.startsWith('modal:') ? 'modal'
        : actionType;

    const rateResult = checkRateLimit(userId, rateCategory);
    if (rateResult.limited) {
        const retrySeconds = Math.ceil(rateResult.retryAfterMs / 1000);
        logAudit({
            userId,
            username,
            action: actionType,
            details: { blocked: 'rate_limited', retryAfterMs: rateResult.retryAfterMs },
            success: false,
        });
        return { allowed: false, reason: `Slow down! Try again in ${retrySeconds}s.` };
    }

    return { allowed: true };
}

// ========== Post-execution Logging ==========

/**
 * Log a completed action to the audit log.
 * Fire-and-forget — does not need to be awaited.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {string} actionType
 * @param {object} details
 * @param {boolean} success
 */
export function postLog(interaction, actionType, details = {}, success = true) {
    // logAudit is async but we intentionally don't await it here
    // to avoid slowing down interaction responses
    logAudit({
        userId: interaction.user.id,
        username: interaction.user.username,
        action: actionType,
        details,
        success,
    });
}

// ========== Utility ==========

/**
 * Extract command options/subcommands from an interaction for audit logging.
 */
export function buildCommandDetails(interaction) {
    const opts = {};
    if (!interaction.options?.data) return opts;

    for (const opt of interaction.options.data) {
        if (opt.type === 1 || opt.type === 2) {
            // Subcommand or subcommand group
            opts.subcommand = opt.name;
            for (const sub of opt.options || []) {
                opts[sub.name] = sub.value;
            }
        } else {
            opts[opt.name] = opt.value;
        }
    }
    return opts;
}
