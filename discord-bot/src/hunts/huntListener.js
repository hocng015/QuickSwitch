/**
 * Hunt notification listener.
 * Monitors configured channels for hunt bot messages, parses them,
 * and posts formatted alerts with Travel Now buttons in the output channel.
 */

import { Events } from 'discord.js';
import { parseHuntMessage } from './huntParser.js';
import { buildHuntAlertEmbed } from './huntEmbeds.js';
import { findZone } from '../data/zoneIndex.js';
import { findWorldDC } from '../data/worlds.js';
import { renderMapPreview } from '../ui/mapRenderer.js';
import { getHuntConfig, getHuntSubscribers } from '../db.js';

// ========== Deduplication ==========

const recentHunts = new Map(); // key → timestamp
const DEDUP_WINDOW_MS = 5 * 60_000; // 5 minutes

function isDuplicate(huntInfo) {
    const key = huntInfo.isTrain
        ? `train:${huntInfo.world.toLowerCase()}`
        : [
            (huntInfo.rank || '?').toUpperCase(),
            (huntInfo.mobName || '?').toLowerCase(),
            huntInfo.world.toLowerCase(),
            huntInfo.instance || 0,
        ].join(':');

    const now = Date.now();

    // Clean old entries
    for (const [k, ts] of recentHunts) {
        if (now - ts > DEDUP_WINDOW_MS) recentHunts.delete(k);
    }

    if (recentHunts.has(key)) return true;
    recentHunts.set(key, now);
    return false;
}

// ========== Config Cache ==========

let watchedChannels = new Set();
let outputChannelId = null;
let cachedClient = null;

/**
 * Reload hunt configuration from the database.
 */
export async function reloadConfig() {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;

    const config = await getHuntConfig(guildId);
    watchedChannels = new Set(config.watchChannels || []);
    outputChannelId = config.outputChannel || null;

    console.log(`[Hunts] Config reloaded: watching ${watchedChannels.size} channel(s), output: ${outputChannelId || 'none'}`);
}

// ========== Alert Posting ==========

/**
 * Generate a map preview image for the hunt location.
 */
async function generateMapPreview(huntInfo) {
    // Try to find zone data for map rendering
    let zoneData = null;
    if (huntInfo.zone) {
        zoneData = findZone(huntInfo.zone);
    }

    if (!zoneData || huntInfo.x == null || huntInfo.y == null) {
        return null;
    }

    try {
        const buffer = await renderMapPreview(
            zoneData.mapId,
            huntInfo.x,
            huntInfo.y,
            zoneData.sizeFactor
        );
        return buffer;
    } catch (err) {
        console.error('[Hunts] Map preview generation failed:', err.message);
        return null;
    }
}

/**
 * Post a hunt alert to the output channel.
 */
async function postHuntAlert(huntInfo, sourceChannelName) {
    if (!cachedClient || !outputChannelId) return;

    try {
        const outputChannel = await cachedClient.channels.fetch(outputChannelId);
        if (!outputChannel) {
            console.error('[Hunts] Output channel not found:', outputChannelId);
            return;
        }

        // Resolve zone data for territory ID and map preview
        let zoneData = null;
        if (huntInfo.zone) {
            zoneData = findZone(huntInfo.zone);
            if (zoneData) {
                huntInfo.territoryId = zoneData.territoryId;
            }
        }

        // Generate map preview
        const mapBuffer = await generateMapPreview(huntInfo);

        // Get subscribers for this hunt's DC to ping
        const dc = findWorldDC(huntInfo.world);
        let pingUserIds = [];
        if (dc) {
            pingUserIds = await getHuntSubscribers(dc.name);
        }

        // Build and send the alert
        const payload = buildHuntAlertEmbed(huntInfo, {
            mapBuffer,
            sourceChannel: sourceChannelName,
            pingUserIds,
        });

        await outputChannel.send(payload);
        console.log(`[Hunts] Posted alert: [${huntInfo.rank || '?'}] ${huntInfo.mobName || 'Unknown'} on ${huntInfo.world}`);
    } catch (err) {
        console.error('[Hunts] Failed to post alert:', err.message);
    }
}

// ========== Public: Post from /hunt report ==========

/**
 * Post a hunt alert from a manual user report.
 * @param {object} huntInfo - Parsed or constructed hunt data
 * @param {string} reportedBy - Username who reported
 * @returns {boolean} Whether the alert was posted
 */
export async function postManualHuntAlert(huntInfo, reportedBy) {
    if (!cachedClient || !outputChannelId) return false;

    // Dedup check
    if (isDuplicate(huntInfo)) return false;

    try {
        const outputChannel = await cachedClient.channels.fetch(outputChannelId);
        if (!outputChannel) return false;

        // Resolve territory ID from zone
        if (huntInfo.zone && !huntInfo.territoryId) {
            const zoneData = findZone(huntInfo.zone);
            if (zoneData) huntInfo.territoryId = zoneData.territoryId;
        }

        const mapBuffer = await generateMapPreview(huntInfo);

        const dc = findWorldDC(huntInfo.world);
        let pingUserIds = [];
        if (dc) {
            pingUserIds = await getHuntSubscribers(dc.name);
        }

        const payload = buildHuntAlertEmbed(huntInfo, {
            mapBuffer,
            reportedBy,
            pingUserIds,
        });

        await outputChannel.send(payload);
        console.log(`[Hunts] User report posted: [${huntInfo.rank || '?'}] ${huntInfo.mobName || 'Unknown'} on ${huntInfo.world} (by ${reportedBy})`);
        return true;
    } catch (err) {
        console.error('[Hunts] Failed to post user report:', err.message);
        return false;
    }
}

// ========== Initialization ==========

/**
 * Initialize the hunt listener. Called once from index.js on ClientReady.
 * @param {import('discord.js').Client} client
 */
export async function initHuntListener(client) {
    cachedClient = client;
    await reloadConfig();

    client.on(Events.MessageCreate, async (message) => {
        // Ignore if no channels configured
        if (watchedChannels.size === 0 || !outputChannelId) return;

        // Only process messages in watched channels
        if (!watchedChannels.has(message.channel.id)) return;

        // Ignore our own messages
        if (message.author.id === client.user.id) return;

        try {
            // If this is a forwarded message, extract the original content from snapshots
            let msgToParse = message;
            if (message.messageSnapshots?.size > 0) {
                const snapshot = message.messageSnapshots.first();
                msgToParse = {
                    content: snapshot.content || '',
                    embeds: snapshot.embeds || [],
                };
            }

            // Parse the message
            const huntInfo = parseHuntMessage(msgToParse);
            if (!huntInfo) {
                // Debug: log that we saw a message but couldn't parse it
                const preview = (msgToParse.content || '').substring(0, 80)
                    || msgToParse.embeds?.[0]?.title
                    || '(embed only, no title)';
                const fwdTag = message.messageSnapshots?.size > 0 ? ' [forwarded]' : '';
                console.log(`[Hunts] Skipped message (no parse)${fwdTag}: "${preview}"`);
                return;
            }

            // Dedup check
            if (isDuplicate(huntInfo)) {
                console.log(`[Hunts] Skipped duplicate: [${huntInfo.rank || '?'}] ${huntInfo.mobName || 'Unknown'} on ${huntInfo.world}`);
                return;
            }

            // Post alert
            await postHuntAlert(huntInfo, message.channel.name);
        } catch (err) {
            console.error('[Hunts] Error processing message:', err.message);
        }
    });

    console.log('[Hunts] Hunt listener initialized.');
}
