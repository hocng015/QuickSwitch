import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { dataCenters, regions, findWorldDC, getWorldsForDC, getAllWorlds } from '../data/worlds.js';
import { getTerritory } from '../data/territories.js';
import {
    buildGoWizardEmbed,
    buildGoDCSelectEmbed,
    buildGoWorldSelectEmbed,
    buildGoAetheryteSelectEmbed,
    buildGoBookmarkSelectEmbed,
    buildGoInstanceSelectEmbed,
    buildGoConfirmEmbed,
    buildGoProgressEmbed,
    buildGoResultEmbed,
    buildStatusEmbed,
    buildBookmarkListEmbed,
    buildResultEmbed,
    buildOfflineEmbed,
    buildSwitchEmbed,
    buildSwitchProgressEmbed,
} from '../ui/embeds.js';
import { buildAuditLogEmbed } from '../ui/adminEmbeds.js';
import { isAdmin, postLog } from '../middleware.js';
import { getAuditLogs, isQsAllowed } from '../db.js';
import { renderMapPreview } from '../ui/mapRenderer.js';

import { findZone } from '../data/zoneIndex.js';

// Temporary cache for aetheryte lists (for pagination without re-fetching)
const aetheryteCache = new Map();

// Journey plan cache — stores the accumulated plan per user (expires after 10 minutes)
const planCache = new Map();

/**
 * Get the current journey plan for a user, or create an empty one.
 */
function getPlan(userId) {
    const entry = planCache.get(userId);
    if (entry && Date.now() < entry.expires) {
        return entry.plan;
    }
    const plan = {};
    setPlan(userId, plan);
    return plan;
}

/**
 * Store the journey plan for a user with a 10 minute expiry.
 */
function setPlan(userId, plan) {
    planCache.set(userId, { plan, expires: Date.now() + 600_000 });
}

/**
 * Clear the journey plan for a user.
 */
function clearPlan(userId) {
    planCache.delete(userId);
}

/**
 * Generate a map preview attachment for the given coordinates.
 *
 * Priority for determining which zone map to show:
 * 1. If the plan has an aetheryte with a territoryId, use that destination zone
 * 2. Otherwise, use the player's current zone from status
 *
 * @param {object} status - Plugin status data (may include mapId, mapSizeFactor, etc.)
 * @param {number} mapX - Map X coordinate
 * @param {number} mapY - Map Y coordinate
 * @param {object} plan - Current journey plan (may include aetheryteTerritoryId)
 * @returns {Promise<{ attachment: AttachmentBuilder, zoneName: string } | null>}
 */
async function generateMapAttachment(status, mapX, mapY, plan = {}) {
    let mapId = null;
    let sizeFactor = null;
    let zoneName = null;

    // Priority 1: Use destination territory from the selected aetheryte
    if (plan.aetheryteTerritoryId) {
        const territory = getTerritory(plan.aetheryteTerritoryId);
        if (territory) {
            mapId = territory.mapId;
            sizeFactor = territory.sizeFactor;
            zoneName = territory.zoneName;
        }
    }

    // Priority 2: Use the player's current zone from plugin status
    if (!mapId) {
        mapId = status?.mapId;
        sizeFactor = status?.mapSizeFactor;
        zoneName = status?.zoneName;
    }

    // Priority 3: Fallback to static lookup using current territoryId
    if (!mapId && status?.territoryId) {
        const territory = getTerritory(status.territoryId);
        if (territory) {
            mapId = territory.mapId;
            sizeFactor = territory.sizeFactor;
            zoneName = territory.zoneName;
        }
    }

    if (!mapId || !sizeFactor) return null;

    const imageBuffer = await renderMapPreview(mapId, mapX, mapY, sizeFactor);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'map.png' });

    return { attachment, zoneName: zoneName || 'Unknown Zone' };
}

/**
 * Helper: fetch status and return to the main wizard with the current plan.
 * When map preview is needed, defers the interaction to avoid 3-second timeout.
 */
async function returnToWizard(interaction, userId, useUpdate = true) {
    const plan = getPlan(userId);
    const needsMapPreview = plan.mapX != null && plan.mapY != null;

    // Defer if we need to generate a map preview (may take a moment for XIVAPI fetch)
    if (needsMapPreview && useUpdate) {
        await interaction.deferUpdate();
    }

    let status;
    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
        status = result.data || result;
    } catch {
        status = pluginSocket.getStatus(userId);
    }

    // Generate map preview if plan has coordinates
    let mapData = null;
    if (needsMapPreview) {
        try {
            mapData = await generateMapAttachment(status, plan.mapX, plan.mapY, plan);
        } catch (err) {
            console.error('[Map Preview] Failed to generate:', err.message);
        }
    }

    const payload = buildGoWizardEmbed(status, plan, mapData);

    if (needsMapPreview && useUpdate) {
        // Already deferred above, use editReply
        await interaction.editReply(payload);
    } else if (useUpdate) {
        await interaction.update(payload);
    } else {
        await interaction.editReply(payload);
    }
}

/**
 * Handle button and select menu interactions.
 */
export async function handleComponent(interaction) {
    const userId = interaction.user.id;
    const customId = interaction.customId;

    // Check plugin online (except status refresh)
    const skipOnlineCheck = customId.startsWith('status_');
    if (!pluginSocket.isOnline(userId) && !skipOnlineCheck) {
        await interaction.update({ ...buildOfflineEmbed(), components: [] });
        return;
    }

    // --- Go: Back to wizard ---
    if (customId === 'go_back') {
        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Cancel / Dismiss ---
    if (customId === 'go_cancel') {
        clearPlan(userId);
        await interaction.update(buildResultEmbed('Dismissed', 'Journey wizard closed.', false));
        return;
    }

    // --- Go: Clear All selections ---
    if (customId === 'go_clear') {
        clearPlan(userId);
        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Execute the accumulated plan ---
    if (customId === 'go_execute') {
        const plan = getPlan(userId);
        const hasPlan = plan.world || plan.aetheryteId || (plan.mapX != null && plan.mapY != null) || plan.instance || plan.bookmarkIndex != null;

        if (!hasPlan) {
            await interaction.update(buildResultEmbed('No Plan', 'Nothing selected. Use the buttons to build your journey first.', false));
            return;
        }

        // Build the command payload for the plugin
        const cmd = { action: 'go' };
        if (plan.world) cmd.world = plan.world;
        if (plan.aetheryteId) {
            cmd.aetheryteId = plan.aetheryteId;
            cmd.aetheryteSubIndex = plan.aetheryteSubIndex || 0;
        }
        if (plan.mapX != null && plan.mapY != null) {
            cmd.mapX = plan.mapX;
            cmd.mapY = plan.mapY;
        }
        if (plan.instance) cmd.instance = plan.instance;

        // Handle bookmark as a direct teleport (separate action)
        if (plan.bookmarkIndex != null && !plan.world && !plan.aetheryteId && plan.mapX == null) {
            await interaction.update(buildGoProgressEmbed('Teleporting to bookmark...'));
            try {
                const result = await pluginSocket.sendCommand(userId, {
                    action: 'teleport_bookmark',
                    index: plan.bookmarkIndex,
                }, 30_000);
                clearPlan(userId);
                await interaction.editReply(buildGoResultEmbed(result.message || 'Teleported to bookmark.'));
            } catch (err) {
                await interaction.editReply(buildGoResultEmbed(`Failed: ${err.message}`, false));
            }
            return;
        }

        await interaction.update(buildGoProgressEmbed('Starting journey...'));
        clearPlan(userId);

        try {
            const result = await pluginSocket.sendCommand(userId, cmd, 60_000);
            await interaction.editReply(buildGoResultEmbed(result.message || 'Journey started!'));
        } catch (err) {
            await interaction.editReply(buildGoResultEmbed(err.message, false));
        }
        return;
    }

    // --- Go: Pick World (show DC picker first) ---
    if (customId === 'go_pick_world') {
        let currentWorld, currentDC;
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
            const status = result.data || result;
            currentWorld = status.world;
            currentDC = status.dataCenter;
        } catch {
            const cached = pluginSocket.getStatus(userId);
            currentWorld = cached?.world;
            currentDC = cached?.dataCenter;
        }

        await interaction.update(buildGoDCSelectEmbed(dataCenters, regions, currentWorld, currentDC));
        return;
    }

    // --- Go: Select DC (from dropdown) → show worlds for that DC ---
    if (customId === 'go_select_dc' && interaction.isStringSelectMenu()) {
        const dcName = interaction.values[0];
        const dcWorlds = getWorldsForDC(dcName);
        const cached = pluginSocket.getStatus(userId);
        const currentWorld = cached?.world;

        await interaction.update(buildGoWorldSelectEmbed(dcName, dcWorlds, currentWorld));
        return;
    }

    // --- Go: Select World (from dropdown) → add to plan, return to wizard ---
    if (customId === 'go_select_world' && interaction.isStringSelectMenu()) {
        const worldName = interaction.values[0];
        const displayName = worldName.charAt(0).toUpperCase() + worldName.slice(1);

        const plan = getPlan(userId);
        plan.world = displayName;
        setPlan(userId, plan);

        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Pick Aetheryte ---
    if (customId === 'go_pick_aetheryte') {
        await interaction.deferUpdate();
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_aetherytes' });
            const aetherytes = result.data?.aetherytes ?? result.aetherytes;
            // Cache for pagination (expires in 5 minutes)
            aetheryteCache.set(userId, { aetherytes, expires: Date.now() + 300_000 });
            await interaction.editReply(buildGoAetheryteSelectEmbed(aetherytes, 0));
        } catch (err) {
            await interaction.editReply(buildResultEmbed('Error', `Failed to load aetherytes: ${err.message}`, false));
        }
        return;
    }

    // --- Go: Aetheryte Pagination ---
    if (customId.startsWith('go_aetheryte_page_')) {
        const page = parseInt(customId.replace('go_aetheryte_page_', ''));
        const cached = aetheryteCache.get(userId);
        if (!cached || Date.now() > cached.expires) {
            // Cache expired, re-fetch
            await interaction.deferUpdate();
            try {
                const result = await pluginSocket.sendCommand(userId, { action: 'get_aetherytes' });
                const aetherytes = result.data?.aetherytes ?? result.aetherytes;
                aetheryteCache.set(userId, { aetherytes, expires: Date.now() + 300_000 });
                await interaction.editReply(buildGoAetheryteSelectEmbed(aetherytes, page));
            } catch (err) {
                await interaction.editReply(buildResultEmbed('Error', `Failed to load aetherytes: ${err.message}`, false));
            }
        } else {
            await interaction.update(buildGoAetheryteSelectEmbed(cached.aetherytes, page));
        }
        return;
    }

    // --- Go: Select Aetheryte (from dropdown) → add to plan, return to wizard ---
    if (customId === 'go_select_aetheryte' && interaction.isStringSelectMenu()) {
        const [aetheryteId, subIndex] = interaction.values[0].split('_').map(Number);

        // Look up the aetheryte name and territory from cache
        let aetheryteName = `#${aetheryteId}`;
        let aetheryteTerritoryId = null;
        const cached = aetheryteCache.get(userId);
        if (cached) {
            const match = cached.aetherytes.find(a => a.id === aetheryteId && a.subIndex === subIndex);
            if (match) {
                aetheryteName = match.name;
                aetheryteTerritoryId = match.territoryId;
            }
        }

        const plan = getPlan(userId);
        plan.aetheryteId = aetheryteId;
        plan.aetheryteSubIndex = subIndex;
        plan.aetheryteName = aetheryteName;
        if (aetheryteTerritoryId) plan.aetheryteTerritoryId = aetheryteTerritoryId;
        setPlan(userId, plan);

        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Pick Instance ---
    if (customId === 'go_pick_instance') {
        await interaction.update(buildGoInstanceSelectEmbed());
        return;
    }

    // --- Go: Select Instance (from dropdown) → add to plan, return to wizard ---
    if (customId === 'go_select_instance' && interaction.isStringSelectMenu()) {
        const instance = parseInt(interaction.values[0]);

        const plan = getPlan(userId);
        plan.instance = instance;
        setPlan(userId, plan);

        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Pick Bookmark ---
    if (customId === 'go_pick_bookmark') {
        await interaction.deferUpdate();
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_bookmarks' });
            const bookmarks = result.data?.bookmarks ?? result.bookmarks;
            await interaction.editReply(buildGoBookmarkSelectEmbed(bookmarks));
        } catch (err) {
            await interaction.editReply(buildResultEmbed('Error', `Failed to load bookmarks: ${err.message}`, false));
        }
        return;
    }

    // --- Go: Select Bookmark (from dropdown) → add to plan, return to wizard ---
    if (customId === 'go_select_bookmark' && interaction.isStringSelectMenu()) {
        const index = parseInt(interaction.values[0]);

        // Look up the bookmark name from the plugin
        let bookmarkName = `Bookmark #${index + 1}`;
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_bookmarks' });
            const bookmarks = result.data?.bookmarks ?? result.bookmarks;
            if (bookmarks && bookmarks[index]) {
                bookmarkName = bookmarks[index].name;
            }
        } catch { /* use default name */ }

        const plan = getPlan(userId);
        plan.bookmarkIndex = index;
        plan.bookmarkName = bookmarkName;
        setPlan(userId, plan);

        await returnToWizard(interaction, userId);
        return;
    }

    // --- Go: Enter Coordinates (Modal) ---
    if (customId === 'go_enter_coords') {
        const modal = new ModalBuilder()
            .setCustomId('go_coords_modal')
            .setTitle('Enter Map Coordinates');

        const xInput = new TextInputBuilder()
            .setCustomId('coord_x')
            .setLabel('Map X (from in-game map)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 24.3')
            .setRequired(true);

        const yInput = new TextInputBuilder()
            .setCustomId('coord_y')
            .setLabel('Map Y (from in-game map)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 23.8')
            .setRequired(true);

        modal.addComponents(
            new ActionRowBuilder().addComponents(xInput),
            new ActionRowBuilder().addComponents(yInput),
        );

        await interaction.showModal(modal);
        return;
    }

    // --- Go: Return Home ---
    if (customId === 'go_return_home') {
        await interaction.deferUpdate();
        clearPlan(userId);
        try {
            const homeResult = await pluginSocket.sendCommand(userId, { action: 'travel_home' }, 30_000);
            await interaction.editReply(buildGoResultEmbed(homeResult.message || 'Traveling home...'));
        } catch (err) {
            await interaction.editReply(buildGoResultEmbed(err.message, false));
        }
        return;
    }

    // --- Go: Confirm Journey (from /go with direct args) ---
    if (customId.startsWith('go_confirm_')) {
        const planData = customId.replace('go_confirm_', '');

        let plan;
        try {
            plan = JSON.parse(Buffer.from(planData, 'base64').toString('utf-8'));
        } catch {
            await interaction.update(buildGoResultEmbed('Invalid journey data.', false));
            return;
        }

        await interaction.update(buildGoProgressEmbed('Starting journey...'));

        try {
            const result = await pluginSocket.sendCommand(userId, {
                action: 'go',
                ...plan,
            }, 60_000); // 60s timeout for journeys

            await interaction.editReply(buildGoResultEmbed(result.message || 'Journey started!'));
        } catch (err) {
            await interaction.editReply(buildGoResultEmbed(err.message, false));
        }
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

    // --- Status Refresh ---
    if (customId === 'status_refresh') {
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
            const status = result.data || result;
            await interaction.update(buildStatusEmbed(status, true));
        } catch {
            const cached = pluginSocket.getStatus(userId);
            await interaction.update(buildStatusEmbed(cached, pluginSocket.isOnline(userId)));
        }
        return;
    }

    // --- Bookmark Select (from /bookmark list) ---
    if (customId === 'bookmark_select' && interaction.isStringSelectMenu()) {
        const index = parseInt(interaction.values[0]);
        await interaction.deferUpdate();

        try {
            const result = await pluginSocket.sendCommand(userId, {
                action: 'teleport_bookmark',
                index,
            });
            await interaction.editReply(buildResultEmbed('Bookmark', result.message || 'Teleported to bookmark.'));
        } catch (err) {
            await interaction.editReply(buildResultEmbed('Bookmark', `Failed: ${err.message}`, false));
        }
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
    const userId = interaction.user.id;
    const customId = interaction.customId;

    if (customId === 'go_coords_modal') {
        const mapX = parseFloat(interaction.fields.getTextInputValue('coord_x'));
        const mapY = parseFloat(interaction.fields.getTextInputValue('coord_y'));

        if (isNaN(mapX) || isNaN(mapY) || mapX < 0 || mapX > 50 || mapY < 0 || mapY > 50) {
            await interaction.reply({
                ...buildResultEmbed('Invalid Coordinates', 'Please enter valid numbers for Map X and Map Y (0–50 range).', false),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        // Add coordinates to the plan and return to wizard
        const plan = getPlan(userId);
        plan.mapX = mapX;
        plan.mapY = mapY;
        setPlan(userId, plan);

        // Modal submissions require a reply (not update), so we defer then edit
        await interaction.deferReply();

        let status;
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
            status = result.data || result;
        } catch {
            status = pluginSocket.getStatus(userId);
        }

        // Generate map preview image with pin at coordinates
        let mapData = null;
        try {
            mapData = await generateMapAttachment(status, mapX, mapY, plan);
        } catch (err) {
            console.error('[Map Preview] Failed to generate:', err.message);
        }

        await interaction.editReply(buildGoWizardEmbed(status, plan, mapData));
    }
}
