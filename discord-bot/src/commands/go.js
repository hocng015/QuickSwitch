import { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { dataCenters, findWorldDC, getAllWorlds } from '../data/worlds.js';
import { findZone } from '../data/zoneIndex.js';
import { territories } from '../data/territories.js';
import {
    buildGoWizardEmbed,
    buildGoConfirmEmbed,
    buildResultEmbed,
    buildOfflineEmbed,
} from '../ui/embeds.js';

// Build zone name list for autocomplete
const allZoneNames = Object.values(territories).map(t => t.zoneName).sort();

export const data = new SlashCommandBuilder()
    .setName('go')
    .setDescription('Go to a destination — world, map coordinates, or bookmark.')
    .addStringOption(opt =>
        opt.setName('world')
            .setDescription('World name to travel to')
            .setRequired(false)
            .setAutocomplete(true)
    )
    .addStringOption(opt =>
        opt.setName('zone')
            .setDescription('Zone name — tells the plugin which zone to teleport to and use for coord conversion')
            .setRequired(false)
            .setAutocomplete(true)
    )
    .addNumberOption(opt =>
        opt.setName('x')
            .setDescription('Map X coordinate (from in-game map)')
            .setRequired(false)
    )
    .addNumberOption(opt =>
        opt.setName('y')
            .setDescription('Map Y coordinate (from in-game map)')
            .setRequired(false)
    )
    .addIntegerOption(opt =>
        opt.setName('instance')
            .setDescription('Zone instance number (1, 2, 3, etc.) for hunt trains / FATEs')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(9)
    )
    .addStringOption(opt =>
        opt.setName('bookmark')
            .setDescription('Bookmark name to teleport to')
            .setRequired(false)
    );

export async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);

    if (focused.name === 'world') {
        const search = focused.value.toLowerCase();
        const allWorlds = getAllWorlds();
        const filtered = allWorlds
            .filter(w => w.toLowerCase().includes(search))
            .slice(0, 25)
            .map(w => {
                const dc = findWorldDC(w);
                return { name: `${w} (${dc?.name || '?'})`, value: w };
            });
        await interaction.respond(filtered);
    }

    if (focused.name === 'zone') {
        const search = focused.value.toLowerCase();
        const filtered = allZoneNames
            .filter(z => z.toLowerCase().includes(search))
            .slice(0, 25)
            .map(z => ({ name: z, value: z }));
        await interaction.respond(filtered);
    }
}

export async function execute(interaction) {
    const userId = interaction.user.id;

    if (!pluginSocket.isOnline(userId)) {
        await interaction.reply({ ...buildOfflineEmbed(), flags: MessageFlags.Ephemeral });
        return;
    }

    const world = interaction.options.getString('world');
    const zoneName = interaction.options.getString('zone');
    const x = interaction.options.getNumber('x');
    const y = interaction.options.getNumber('y');
    const instance = interaction.options.getInteger('instance');
    const bookmark = interaction.options.getString('bookmark');

    // Resolve zone name to territory data (handles aliases too via findZone)
    let zoneData = null;
    if (zoneName) {
        zoneData = findZone(zoneName);
        if (!zoneData) {
            await interaction.reply({
                ...buildResultEmbed('Unknown Zone', `Could not find zone "${zoneName}". Try using the autocomplete suggestions.`, false),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
    }

    // If a bookmark name was provided, look it up and teleport
    if (bookmark) {
        await interaction.deferReply();
        try {
            const bmResult = await pluginSocket.sendCommand(userId, { action: 'get_bookmarks' });
            const bookmarks = bmResult.data?.bookmarks ?? bmResult.bookmarks;
            const match = bookmarks?.findIndex(
                bm => bm.name.toLowerCase() === bookmark.toLowerCase()
            );

            if (match === -1 || match === undefined) {
                await interaction.editReply(
                    buildResultEmbed('Bookmark Not Found', `No bookmark named "${bookmark}" found.`, false)
                );
                return;
            }

            const result = await pluginSocket.sendCommand(userId, {
                action: 'teleport_bookmark',
                index: match,
            });

            await interaction.editReply(
                buildResultEmbed('Bookmark', result.message || `Teleported to "${bookmark}".`)
            );
        } catch (err) {
            await interaction.editReply(
                buildResultEmbed('Error', err.message, false)
            );
        }
        return;
    }

    // If specific options were provided, build a journey plan and go
    if (world || zoneName || (x !== null && y !== null) || instance) {
        const plan = {};
        const steps = [];

        if (world) {
            plan.world = world;
            const dc = findWorldDC(world);
            steps.push(`Travel to **${world}** (${dc?.name || 'Unknown DC'})`);
        }

        // Zone → resolve territory ID for aetheryte auto-resolution and coord conversion
        if (zoneData) {
            plan.territoryId = zoneData.territoryId;
            steps.push(`Teleport to **${zoneData.zoneName}**`);
        }

        if (instance) {
            plan.instance = instance;
            steps.push(`Change to **Instance ${instance}**`);
        }

        if (x !== null && y !== null) {
            plan.mapX = x;
            plan.mapY = y;
            steps.push(`Move to map **(X: ${x.toFixed(1)}, Y: ${y.toFixed(1)})**`);
        }

        // Show confirmation
        await interaction.reply(buildGoConfirmEmbed(plan, steps));
        return;
    }

    // No options — show the interactive wizard with a fresh plan
    let status;
    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
        status = result.data || result;
    } catch {
        status = pluginSocket.getStatus(userId);
    }

    await interaction.reply(buildGoWizardEmbed(status, {}));
}
