/**
 * Hunt alert embed builder.
 * Creates formatted Discord embeds for hunt notifications with
 * map preview images and Travel Now / Dismiss buttons.
 */

import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    AttachmentBuilder,
} from 'discord.js';
import { findWorldDC } from '../data/worlds.js';

// Rank → color mapping
const RANK_COLORS = {
    SS: 0xCC0000,
    S: 0xFF0000,
    A: 0xFFA500,
    B: 0x5865F2,
};

// Rank → emoji
const RANK_EMOJI = {
    SS: '\uD83D\uDD34',  // red circle
    S: '\uD83D\uDD34',   // red circle
    A: '\uD83D\uDFE0',   // orange circle
    B: '\uD83D\uDD35',   // blue circle
};

/**
 * Build a hunt alert embed with Travel Now button.
 * @param {object} huntInfo - Parsed hunt data
 * @param {object} options
 * @param {Buffer|null} options.mapBuffer - Map preview PNG buffer
 * @param {string|null} options.sourceChannel - Channel name where hunt was detected
 * @param {string|null} options.reportedBy - Username who reported (for /hunt report)
 * @param {string[]} options.pingUserIds - User IDs to mention
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[], files: AttachmentBuilder[], content: string }}
 */
export function buildHuntAlertEmbed(huntInfo, { mapBuffer = null, sourceChannel = null, reportedBy = null, pingUserIds = [] } = {}) {
    const rank = huntInfo.rank || '?';
    const emoji = RANK_EMOJI[rank] || '\u2753'; // question mark fallback
    const color = huntInfo.isTrain ? 0xFFD700 : (RANK_COLORS[rank] || 0x808080); // gold for trains

    let title;
    if (huntInfo.isTrain) {
        title = `\uD83D\uDE82 Hunt Train — ${huntInfo.world}`;
    } else {
        title = huntInfo.mobName
            ? `${emoji} [${rank}] ${huntInfo.mobName}`
            : `${emoji} [${rank}] Hunt Spotted`;
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp();

    // World + DC
    const dc = findWorldDC(huntInfo.world);
    embed.addFields(
        { name: 'World', value: huntInfo.world, inline: true },
        { name: 'Data Center', value: dc?.name || 'Unknown', inline: true },
    );

    // Zone
    if (huntInfo.zone) {
        embed.addFields({ name: 'Zone', value: huntInfo.zone, inline: true });
    }

    // Coordinates
    if (huntInfo.x != null && huntInfo.y != null) {
        embed.addFields({
            name: 'Coordinates',
            value: `X: ${huntInfo.x}, Y: ${huntInfo.y}`,
            inline: true,
        });
    }

    // Instance
    if (huntInfo.instance) {
        embed.addFields({ name: 'Instance', value: `${huntInfo.instance}`, inline: true });
    }

    // For trains, include a snippet of the announcement text
    if (huntInfo.isTrain && huntInfo.raw) {
        // Strip Discord role mentions <@&id> and custom emoji <:name:id>, trim to 300 chars
        const cleaned = huntInfo.raw
            .replace(/<@&?\d+>/g, '')
            .replace(/<:\w+:\d+>/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim()
            .substring(0, 300);
        if (cleaned) {
            embed.setDescription(cleaned);
        }
    }

    // Footer
    const footerParts = [];
    if (sourceChannel) footerParts.push(`Detected from #${sourceChannel}`);
    if (reportedBy) footerParts.push(`Reported by ${reportedBy}`);
    if (footerParts.length > 0) {
        embed.setFooter({ text: footerParts.join(' | ') });
    }

    // Map image
    const files = [];
    if (mapBuffer) {
        const attachment = new AttachmentBuilder(mapBuffer, { name: 'map.png' });
        embed.setImage('attachment://map.png');
        files.push(attachment);
    }

    // Encode travel data into button customId
    const travelData = {
        w: huntInfo.world,
        x: huntInfo.x,
        y: huntInfo.y,
        i: huntInfo.instance || null,
        t: huntInfo.territoryId || null, // territory ID for correct zone teleport + coord conversion
    };
    const encoded = Buffer.from(JSON.stringify(travelData)).toString('base64').substring(0, 80);

    // Action row
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`hunt_travel_${encoded}`)
            .setLabel('Travel Now')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('hunt_dismiss')
            .setLabel('Dismiss')
            .setStyle(ButtonStyle.Secondary),
    );

    // Build ping content for subscribed users
    let content = '';
    if (pingUserIds.length > 0) {
        content = pingUserIds.map(id => `<@${id}>`).join(' ');
    }

    return {
        content: content || undefined,
        embeds: [embed],
        components: [row],
        files,
    };
}
