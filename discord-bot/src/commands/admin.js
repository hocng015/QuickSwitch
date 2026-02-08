/**
 * /admin command — Admin tools for managing the bot.
 * Subcommands: audit, users, ban, unban, stats
 */

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { isAdmin, postLog } from '../middleware.js';
import { getAuditLogs, getAuditStats, getAllUsers, banUser, unbanUser, upsertUser, setQsAccess, removeQsAccess, getAllQsAccess, isQsAllowed } from '../db.js';
import { pluginSocket } from '../websocket.js';
import { buildAuditLogEmbed, buildUsersListEmbed, buildBanResultEmbed, buildStatsEmbed, buildQsAccessEmbed, buildQsAccessResultEmbed, buildQsForceResultEmbed } from '../ui/adminEmbeds.js';
import { buildResultEmbed } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Admin commands for managing MoveMeXiv.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('audit')
            .setDescription('View the audit log.')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('Filter by user')
            )
            .addStringOption(opt =>
                opt.setName('action')
                    .setDescription('Filter by action type (e.g. command:go, component:go_execute)')
            )
            .addIntegerOption(opt =>
                opt.setName('hours')
                    .setDescription('Show last N hours (default 24)')
                    .setMinValue(1)
                    .setMaxValue(720)
            )
            .addIntegerOption(opt =>
                opt.setName('page')
                    .setDescription('Page number (default 1)')
                    .setMinValue(1)
            )
    )
    .addSubcommand(sub =>
        sub.setName('users')
            .setDescription('List all known users and their status.')
    )
    .addSubcommand(sub =>
        sub.setName('ban')
            .setDescription('Ban a user from using the bot.')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('User to ban')
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName('reason')
                    .setDescription('Ban reason')
            )
    )
    .addSubcommand(sub =>
        sub.setName('unban')
            .setDescription('Unban a user.')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('User to unban')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('stats')
            .setDescription('View usage statistics.')
            .addIntegerOption(opt =>
                opt.setName('hours')
                    .setDescription('Stats for last N hours (default 24)')
                    .setMinValue(1)
                    .setMaxValue(720)
            )
    )
    .addSubcommand(sub =>
        sub.setName('qs-allow')
            .setDescription('Allow a user to use QuickSwitch (whitelist).')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('User to allow')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('qs-block')
            .setDescription('Block a user from using QuickSwitch (blacklist).')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('User to block')
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName('reason')
                    .setDescription('Reason for blocking')
            )
    )
    .addSubcommand(sub =>
        sub.setName('qs-reset')
            .setDescription('Remove a user\'s QuickSwitch access override (revert to default).')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('User to reset')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('qs-access')
            .setDescription('View QuickSwitch access list (whitelist/blacklist).')
    )
    .addSubcommand(sub =>
        sub.setName('qs-force-switch')
            .setDescription('Force switch another user\'s character remotely.')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            )
            .addStringOption(opt =>
                opt.setName('character')
                    .setDescription('Character name to switch to')
                    .setRequired(true)
            )
    )
    .addSubcommand(sub =>
        sub.setName('qs-force-logout')
            .setDescription('Force logout another user\'s character remotely.')
            .addUserOption(opt =>
                opt.setName('user')
                    .setDescription('Target user')
                    .setRequired(true)
            )
    );

export async function execute(interaction) {
    // Double-check admin status (env var check, not just Discord perms)
    if (!isAdmin(interaction.user.id)) {
        await interaction.reply({
            content: 'You do not have permission to use admin commands.',
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    const sub = interaction.options.getSubcommand();

    switch (sub) {
        case 'audit':           return handleAudit(interaction);
        case 'users':           return handleUsers(interaction);
        case 'ban':             return handleBan(interaction);
        case 'unban':           return handleUnban(interaction);
        case 'stats':           return handleStats(interaction);
        case 'qs-allow':        return handleQsAllow(interaction);
        case 'qs-block':        return handleQsBlock(interaction);
        case 'qs-reset':        return handleQsReset(interaction);
        case 'qs-access':       return handleQsAccess(interaction);
        case 'qs-force-switch': return handleQsForceSwitch(interaction);
        case 'qs-force-logout': return handleQsForceLogout(interaction);
    }
}

// ========== Subcommand Handlers ==========

async function handleAudit(interaction) {
    const targetUser = interaction.options.getUser('user');
    const action = interaction.options.getString('action');
    const hours = interaction.options.getInteger('hours') || 24;
    const page = (interaction.options.getInteger('page') || 1) - 1; // 0-based internally

    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const filters = {
        userId: targetUser?.id,
        action,
        hours,
        user: targetUser?.username,
    };

    const { rows, total } = await getAuditLogs({
        userId: targetUser?.id,
        action,
        limit: 25,
        offset: page * 25,
        since,
    });

    await interaction.reply({
        ...buildAuditLogEmbed(rows, total, page, filters),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleUsers(interaction) {
    const users = await getAllUsers();

    // Get currently online user IDs
    const onlineUserIds = new Set();
    for (const [userId] of pluginSocket.connections) {
        if (pluginSocket.isOnline(userId)) {
            onlineUserIds.add(userId);
        }
    }

    await interaction.reply({
        ...buildUsersListEmbed(users, onlineUserIds),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleBan(interaction) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    // Prevent self-ban
    if (targetUser.id === interaction.user.id) {
        await interaction.reply({ content: 'You cannot ban yourself.', flags: MessageFlags.Ephemeral });
        return;
    }

    // Prevent banning other admins
    if (isAdmin(targetUser.id)) {
        await interaction.reply({ content: 'You cannot ban another admin.', flags: MessageFlags.Ephemeral });
        return;
    }

    // Ensure the user exists in DB first
    await upsertUser(targetUser.id, targetUser.username);

    // Ban the user
    await banUser(targetUser.id, reason, interaction.user.id);

    // Disconnect their plugin if connected
    const ws = pluginSocket.connections.get(targetUser.id);
    if (ws && ws.readyState === 1) {
        ws.close(4003, 'Banned');
        console.log(`[Admin] Disconnected banned user ${targetUser.username} (${targetUser.id})`);
    }

    // Log the admin action
    postLog(interaction, 'admin:ban', {
        targetId: targetUser.id,
        targetName: targetUser.username,
        reason,
    }, true);

    await interaction.reply({
        ...buildBanResultEmbed(targetUser.username, true, reason),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleUnban(interaction) {
    const targetUser = interaction.options.getUser('user');

    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    await unbanUser(targetUser.id);

    postLog(interaction, 'admin:unban', {
        targetId: targetUser.id,
        targetName: targetUser.username,
    }, true);

    await interaction.reply({
        ...buildBanResultEmbed(targetUser.username, false),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleStats(interaction) {
    const hours = interaction.options.getInteger('hours') || 24;
    const since = new Date(Date.now() - hours * 3600_000).toISOString();

    const stats = await getAuditStats({ since });

    await interaction.reply({
        ...buildStatsEmbed(stats, hours),
        flags: MessageFlags.Ephemeral,
    });
}

// ========== QuickSwitch Admin Handlers ==========

async function handleQsAllow(interaction) {
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    await setQsAccess(targetUser.id, true, null, interaction.user.id);

    postLog(interaction, 'admin:qs-allow', {
        targetId: targetUser.id,
        targetName: targetUser.username,
    }, true);

    await interaction.reply({
        ...buildQsAccessResultEmbed(targetUser.username, true),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleQsBlock(interaction) {
    const targetUser = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason');

    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (isAdmin(targetUser.id)) {
        await interaction.reply({ content: 'You cannot block an admin.', flags: MessageFlags.Ephemeral });
        return;
    }

    await setQsAccess(targetUser.id, false, reason, interaction.user.id);

    postLog(interaction, 'admin:qs-block', {
        targetId: targetUser.id,
        targetName: targetUser.username,
        reason,
    }, true);

    await interaction.reply({
        ...buildQsAccessResultEmbed(targetUser.username, false, reason),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleQsReset(interaction) {
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    await removeQsAccess(targetUser.id);

    postLog(interaction, 'admin:qs-reset', {
        targetId: targetUser.id,
        targetName: targetUser.username,
    }, true);

    await interaction.reply({
        ...buildResultEmbed('QS Access Reset', `Access override removed for **${targetUser.username}**. Default access restored.`, true),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleQsAccess(interaction) {
    const entries = await getAllQsAccess();

    await interaction.reply({
        ...buildQsAccessEmbed(entries),
        flags: MessageFlags.Ephemeral,
    });
}

async function handleQsForceSwitch(interaction) {
    const targetUser = interaction.options.getUser('user');
    const characterName = interaction.options.getString('character');

    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!pluginSocket.isOnline(targetUser.id)) {
        await interaction.reply({ content: `${targetUser.username}'s plugin is not connected.`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const result = await pluginSocket.sendCommand(targetUser.id, {
            action: 'switch_character',
            name: characterName,
            force: true,
        }, 30_000);

        const success = result.success !== false;

        postLog(interaction, 'admin:qs-force-switch', {
            targetId: targetUser.id,
            targetName: targetUser.username,
            character: characterName,
            result: result.message,
        }, success);

        await interaction.editReply(
            buildQsForceResultEmbed('Force Switch', targetUser.username, characterName,
                result.message || (success ? 'Switch initiated.' : 'Switch failed.'), success));
    } catch (err) {
        postLog(interaction, 'admin:qs-force-switch', {
            targetId: targetUser.id,
            targetName: targetUser.username,
            character: characterName,
            error: err.message,
        }, false);

        await interaction.editReply(
            buildQsForceResultEmbed('Force Switch', targetUser.username, characterName, `Failed: ${err.message}`, false));
    }
}

async function handleQsForceLogout(interaction) {
    const targetUser = interaction.options.getUser('user');

    if (!targetUser) {
        await interaction.reply({ content: 'User not found.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (!pluginSocket.isOnline(targetUser.id)) {
        await interaction.reply({ content: `${targetUser.username}'s plugin is not connected.`, flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        const result = await pluginSocket.sendCommand(targetUser.id, {
            action: 'logout',
            force: true,
        }, 15_000);

        const success = result.success !== false;

        postLog(interaction, 'admin:qs-force-logout', {
            targetId: targetUser.id,
            targetName: targetUser.username,
            result: result.message,
        }, success);

        await interaction.editReply(
            buildQsForceResultEmbed('Force Logout', targetUser.username, null,
                result.message || (success ? 'Logout initiated.' : 'Logout failed.'), success));
    } catch (err) {
        postLog(interaction, 'admin:qs-force-logout', {
            targetId: targetUser.id,
            targetName: targetUser.username,
            error: err.message,
        }, false);

        await interaction.editReply(
            buildQsForceResultEmbed('Force Logout', targetUser.username, null, `Failed: ${err.message}`, false));
    }
}
