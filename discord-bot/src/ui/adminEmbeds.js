/**
 * Embed builders for /admin commands.
 */

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';
import { Colors } from './embeds.js';

/**
 * Build an audit log embed with pagination.
 * @param {Array} rows - Audit log rows
 * @param {number} total - Total matching rows
 * @param {number} page - Current page (0-based)
 * @param {object} filters - Active filters for display
 */
export function buildAuditLogEmbed(rows, total, page, filters = {}) {
    const pageSize = 25;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const embed = new EmbedBuilder()
        .setTitle('Audit Log')
        .setColor(Colors.Info)
        .setTimestamp();

    // Show active filters
    const filterParts = [];
    if (filters.user) filterParts.push(`User: <@${filters.userId}>`);
    if (filters.action) filterParts.push(`Action: \`${filters.action}\``);
    if (filters.hours) filterParts.push(`Last ${filters.hours}h`);
    const filterLine = filterParts.length > 0 ? `**Filters:** ${filterParts.join(' | ')}\n` : '';

    if (rows.length === 0) {
        embed.setDescription(`${filterLine}No audit log entries found.`);
        return { embeds: [embed], components: [] };
    }

    // Format entries
    const lines = rows.map(row => {
        const ts = row.created_at instanceof Date
            ? row.created_at.toISOString()
            : (row.created_at || '');
        const time = ts.slice(5, 16).replace('T', ' ') || '?';
        const icon = row.success ? '✓' : '✗';
        const user = row.username || row.user_id;
        // Truncate details to keep embed manageable
        let detail = '';
        try {
            const parsed = JSON.parse(row.details);
            if (parsed) {
                const keys = Object.keys(parsed).slice(0, 3);
                detail = keys.map(k => `${k}=${JSON.stringify(parsed[k])}`).join(', ');
                if (detail.length > 60) detail = detail.slice(0, 57) + '...';
            }
        } catch { /* skip */ }

        return `\`${time}\` ${icon} **${user}** — \`${row.action}\`${detail ? ` (${detail})` : ''}`;
    });

    embed.setDescription(
        `${filterLine}` +
        `Showing ${safePage * pageSize + 1}–${safePage * pageSize + rows.length} of ${total}\n\n` +
        lines.join('\n')
    );

    embed.setFooter({ text: `Page ${safePage + 1} of ${totalPages}` });

    // Pagination buttons
    const navButtons = [];
    if (safePage > 0) {
        navButtons.push(
            new ButtonBuilder()
                .setCustomId(`admin_audit_page_${safePage - 1}`)
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (safePage < totalPages - 1) {
        navButtons.push(
            new ButtonBuilder()
                .setCustomId(`admin_audit_page_${safePage + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Primary)
        );
    }

    const components = navButtons.length > 0
        ? [new ActionRowBuilder().addComponents(navButtons)]
        : [];

    return { embeds: [embed], components };
}

/**
 * Build a users list embed.
 * @param {Array} users - User records from DB
 * @param {Set<string>} onlineUserIds - Set of currently online user IDs
 */
export function buildUsersListEmbed(users, onlineUserIds) {
    const embed = new EmbedBuilder()
        .setTitle('Known Users')
        .setColor(Colors.Info)
        .setTimestamp();

    if (!users || users.length === 0) {
        embed.setDescription('No users found.');
        return { embeds: [embed], components: [] };
    }

    const lines = users.map(u => {
        const online = onlineUserIds.has(u.user_id) ? '🟢' : '⚫';
        const banned = u.is_banned ? ' 🚫 BANNED' : '';
        const name = u.username || u.user_id;
        const lsTs = u.last_seen instanceof Date
            ? u.last_seen.toISOString()
            : (u.last_seen || '');
        const lastSeen = lsTs ? lsTs.slice(0, 16).replace('T', ' ') : 'never';
        return `${online} **${name}**${banned} — Last: \`${lastSeen}\``;
    });

    // Discord embed description limit is 4096 chars — truncate if needed
    let description = lines.join('\n');
    if (description.length > 4000) {
        description = description.slice(0, 3990) + '\n...truncated';
    }

    embed.setDescription(description);
    embed.setFooter({ text: `${users.length} users total | ${onlineUserIds.size} online` });

    return { embeds: [embed], components: [] };
}

/**
 * Build a ban/unban result embed.
 */
export function buildBanResultEmbed(targetUser, banned, reason) {
    const embed = new EmbedBuilder()
        .setTitle(banned ? 'User Banned' : 'User Unbanned')
        .setColor(banned ? Colors.Error : Colors.Success)
        .setDescription(
            banned
                ? `**${targetUser}** has been banned from using the bot.${reason ? `\n**Reason:** ${reason}` : ''}`
                : `**${targetUser}** has been unbanned and can use the bot again.`
        )
        .setTimestamp();

    return { embeds: [embed], components: [] };
}

/**
 * Build a usage statistics embed.
 * @param {object} stats - From getAuditStats()
 * @param {number} hours - Time window for display
 */
export function buildStatsEmbed(stats, hours) {
    const embed = new EmbedBuilder()
        .setTitle(`Usage Statistics — Last ${hours}h`)
        .setColor(Colors.Info)
        .setTimestamp();

    const lines = [];
    lines.push(`**Total actions:** ${stats.totalActions}`);
    lines.push(`**Unique users:** ${stats.totalUsers}`);

    if (stats.topUser) {
        lines.push(`**Most active:** ${stats.topUser.username || stats.topUser.user_id} (${stats.topUser.count} actions)`);
    }

    lines.push('');
    lines.push('**Breakdown by action:**');

    if (stats.actions && stats.actions.length > 0) {
        for (const a of stats.actions.slice(0, 20)) {
            const failText = a.failures > 0 ? ` (${a.failures} failed)` : '';
            lines.push(`\`${a.action}\` — ${a.count}${failText}`);
        }
    } else {
        lines.push('No actions recorded in this period.');
    }

    embed.setDescription(lines.join('\n'));

    return { embeds: [embed], components: [] };
}

// ========== QuickSwitch Admin Embeds ==========

/**
 * Build a QuickSwitch access list embed.
 * @param {Array} entries - qs_access rows
 */
export function buildQsAccessEmbed(entries) {
    const embed = new EmbedBuilder()
        .setTitle('QuickSwitch Access List')
        .setColor(Colors.Info)
        .setTimestamp();

    if (!entries || entries.length === 0) {
        embed.setDescription('No access overrides configured. All users have default access.');
        return { embeds: [embed], components: [] };
    }

    const lines = entries.map(e => {
        const icon = e.allowed ? '✅' : '🚫';
        const status = e.allowed ? 'Allowed' : 'Blocked';
        const reason = e.reason ? ` — ${e.reason}` : '';
        const ts = e.updated_at instanceof Date
            ? e.updated_at.toISOString()
            : (e.updated_at || '');
        const time = ts ? ts.slice(0, 16).replace('T', ' ') : '';
        return `${icon} <@${e.user_id}> — **${status}**${reason} (${time})`;
    });

    let description = lines.join('\n');
    if (description.length > 4000) {
        description = description.slice(0, 3990) + '\n...truncated';
    }

    embed.setDescription(description);
    embed.setFooter({ text: `${entries.length} entries` });

    return { embeds: [embed], components: [] };
}

/**
 * Build a QS access allow/block result embed.
 */
export function buildQsAccessResultEmbed(targetUser, allowed, reason) {
    const embed = new EmbedBuilder()
        .setTitle(allowed ? 'QS Access Allowed' : 'QS Access Blocked')
        .setColor(allowed ? Colors.Success : Colors.Error)
        .setDescription(
            allowed
                ? `**${targetUser}** has been allowed to use QuickSwitch.`
                : `**${targetUser}** has been blocked from using QuickSwitch.${reason ? `\n**Reason:** ${reason}` : ''}`
        )
        .setTimestamp();

    return { embeds: [embed], components: [] };
}

/**
 * Build a force switch/logout result embed.
 */
export function buildQsForceResultEmbed(action, targetUser, characterName, message, success) {
    const embed = new EmbedBuilder()
        .setTitle(action)
        .setColor(success ? Colors.Success : Colors.Error)
        .setTimestamp();

    const lines = [`**Target:** ${targetUser}`];
    if (characterName) lines.push(`**Character:** ${characterName}`);
    lines.push(`**Result:** ${message}`);

    embed.setDescription(lines.join('\n'));

    return { embeds: [embed], components: [] };
}
