import { MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import {
    buildResultEmbed,
    buildOfflineEmbed,
    buildSwitchEmbed,
} from '../ui/embeds.js';
import { buildAuditLogEmbed } from '../ui/adminEmbeds.js';
import { isAdmin, postLog } from '../middleware.js';
import { getAuditLogs, isQsAllowed } from '../db.js';

/**
 * Handle button and select menu interactions.
 */
export async function handleComponent(interaction) {
    const userId = interaction.user.id;
    const customId = interaction.customId;

    // Check plugin online
    if (!pluginSocket.isOnline(userId) && !customId.startsWith('admin_')) {
        await interaction.update({ ...buildOfflineEmbed(), components: [] });
        return;
    }

    // --- Admin: Audit Log Pagination ---
    if (customId.startsWith('admin_audit_page_')) {
        if (!isAdmin(userId)) return;

        const page = parseInt(customId.replace('admin_audit_page_', ''));
        // Default to last 24h of logs
        const since = new Date(Date.now() - 24 * 3600_000).toISOString();
        const { rows, total } = await getAuditLogs({ limit: 25, offset: page * 25, since });

        await interaction.update({
            ...buildAuditLogEmbed(rows, total, page, { hours: 24 }),
        });
        return;
    }

    // --- QuickSwitch: Select Character (from dropdown) ---
    if (customId === 'qs_select_character' && interaction.isStringSelectMenu()) {
        const characterName = interaction.values[0];

        // Access control check
        const access = await isQsAllowed(userId);
        if (!access.allowed) {
            await interaction.update(buildResultEmbed('QuickSwitch', `You are blocked from using QuickSwitch.`, false));
            return;
        }

        await interaction.deferUpdate();

        try {
            const result = await pluginSocket.sendCommand(userId, {
                action: 'switch_character',
                name: characterName,
            }, 30_000);

            const success = result.success !== false;
            postLog(interaction, 'qs:switch', { character: characterName, result: result.message }, success);
            await interaction.editReply(
                buildResultEmbed(
                    'QuickSwitch',
                    result.message || (success ? `Switching to ${characterName}...` : 'Switch failed.'),
                    success,
                ));
        } catch (err) {
            postLog(interaction, 'qs:switch', { character: characterName, error: err.message }, false);
            await interaction.editReply(
                buildResultEmbed('QuickSwitch', `Failed: ${err.message}`, false));
        }
        return;
    }

    // --- QuickSwitch: Quick Logout ---
    if (customId === 'qs_logout') {
        // Access control check
        const access = await isQsAllowed(userId);
        if (!access.allowed) {
            await interaction.update(buildResultEmbed('QuickSwitch', `You are blocked from using QuickSwitch.`, false));
            return;
        }

        await interaction.deferUpdate();

        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'logout' }, 15_000);
            const success = result.success !== false;
            postLog(interaction, 'qs:logout', { result: result.message }, success);
            await interaction.editReply(
                buildResultEmbed(
                    'QuickSwitch',
                    result.message || (success ? 'Logging out to character select...' : 'Logout failed.'),
                    success,
                ));
        } catch (err) {
            postLog(interaction, 'qs:logout', { error: err.message }, false);
            await interaction.editReply(
                buildResultEmbed('QuickSwitch', `Failed: ${err.message}`, false));
        }
        return;
    }

    // --- QuickSwitch: Refresh character list ---
    if (customId === 'qs_refresh') {
        await interaction.deferUpdate();

        try {
            const [charResult, statusResult] = await Promise.all([
                pluginSocket.sendCommand(userId, { action: 'get_characters' }, 10_000),
                pluginSocket.sendCommand(userId, { action: 'get_status' }, 10_000),
            ]);

            const characters = charResult.data?.characters ?? charResult.characters ?? [];
            const status = statusResult.data || statusResult;
            await interaction.editReply(buildSwitchEmbed(characters, status));
        } catch (err) {
            await interaction.editReply(
                buildResultEmbed('QuickSwitch', `Failed to refresh: ${err.message}`, false));
        }
        return;
    }

    // --- QuickSwitch: Abort switch ---
    if (customId === 'qs_abort') {
        await interaction.deferUpdate();

        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'abort' }, 10_000);
            const success = result.success !== false;
            await interaction.editReply(
                buildResultEmbed(
                    'QuickSwitch',
                    result.message || (success ? 'Switch aborted.' : 'Nothing to abort.'),
                    success,
                ));
        } catch (err) {
            await interaction.editReply(
                buildResultEmbed('QuickSwitch', `Failed: ${err.message}`, false));
        }
        return;
    }

}

/**
 * Handle modal submissions.
 */
export async function handleModalSubmit(interaction) {
    // No modals currently used in QuickSwitch
}
