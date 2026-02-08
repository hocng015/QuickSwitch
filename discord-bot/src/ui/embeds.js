import {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
} from 'discord.js';

// Color palette
export const Colors = {
    Info: 0x5865F2,
    Success: 0x00AA00,
    Error: 0xFF0000,
    Warning: 0xFFA500,
    Travel: 0x00BFFF,
    Mount: 0xDAA520,
};

// ========== /go Wizard Embeds ==========

/**
 * Build the main /go wizard embed showing the current plan and picker buttons.
 * The plan object accumulates selections: { world, aetheryteId, aetheryteSubIndex, aetheryteName, mapX, mapY, instance, bookmark }
 * @param {object} status - Plugin status data
 * @param {object} plan - Accumulated journey plan
 * @param {{ attachment: import('discord.js').AttachmentBuilder, zoneName: string } | null} mapData - Map preview image data
 */
export function buildGoWizardEmbed(status, plan = {}, mapData = null) {
    const embed = new EmbedBuilder()
        .setTitle('MoveMeXiv - Go To')
        .setColor(Colors.Travel)
        .setTimestamp();

    // Show current location
    if (status) {
        const pos = status.position || { x: 0, y: 0, z: 0 };
        embed.addFields(
            { name: 'Current Location', value: `\`X: ${pos.x?.toFixed(2) ?? '?'}  Y: ${pos.y?.toFixed(2) ?? '?'}  Z: ${pos.z?.toFixed(2) ?? '?'}\``, inline: false },
            { name: 'World', value: status.world || 'Unknown', inline: true },
            { name: 'Data Center', value: status.dataCenter || 'Unknown', inline: true },
        );

        if (status.journeyActive) {
            embed.addFields({ name: 'Active Journey', value: status.journeyStep || 'In progress...', inline: false });
        }
    }

    // Build journey plan summary
    const hasWorld = !!plan.world;
    const hasAetheryte = !!plan.aetheryteId;
    const hasCoords = plan.mapX != null && plan.mapY != null;
    const hasInstance = !!plan.instance;
    const hasBookmark = plan.bookmarkIndex != null;
    const hasPlan = hasWorld || hasAetheryte || hasCoords || hasInstance || hasBookmark;

    if (hasPlan) {
        const planLines = [];
        if (hasWorld) planLines.push(`**World:** ${plan.world}`);
        if (hasAetheryte) planLines.push(`**Aetheryte:** ${plan.aetheryteName || `#${plan.aetheryteId}`}`);
        if (hasInstance) planLines.push(`**Instance:** ${plan.instance}`);
        if (hasCoords) {
            const zoneStr = mapData?.zoneName ? ` (${mapData.zoneName})` : '';
            planLines.push(`**Coordinates:** X: ${plan.mapX.toFixed(1)}, Y: ${plan.mapY.toFixed(1)}${zoneStr}`);
        }
        if (hasBookmark) planLines.push(`**Bookmark:** ${plan.bookmarkName || `#${plan.bookmarkIndex}`}`);

        embed.setDescription('**Journey Plan:**\n' + planLines.join('\n'));
    } else {
        embed.setDescription('Select destinations below to build your journey plan.\nYou can combine world travel, aetheryte, coordinates, and instance.');
    }

    // Show map preview image if available
    if (mapData && hasCoords) {
        embed.setImage('attachment://map.png');
    }

    // Row 1: Destination picker buttons
    const pickerButtons = [];
    pickerButtons.push(
        new ButtonBuilder()
            .setCustomId('go_pick_world')
            .setLabel(hasWorld ? `World: ${plan.world}` : 'Pick World')
            .setStyle(hasWorld ? ButtonStyle.Success : ButtonStyle.Primary),
    );
    pickerButtons.push(
        new ButtonBuilder()
            .setCustomId('go_pick_aetheryte')
            .setLabel(hasAetheryte ? `Aetheryte: ${(plan.aetheryteName || '').slice(0, 12)}` : 'Pick Aetheryte')
            .setStyle(hasAetheryte ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    pickerButtons.push(
        new ButtonBuilder()
            .setCustomId('go_enter_coords')
            .setLabel(hasCoords ? `Coords: ${plan.mapX.toFixed(1)}, ${plan.mapY.toFixed(1)}` : 'Enter Coordinates')
            .setStyle(hasCoords ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
    pickerButtons.push(
        new ButtonBuilder()
            .setCustomId('go_pick_instance')
            .setLabel(hasInstance ? `Instance: ${plan.instance}` : 'Set Instance')
            .setStyle(hasInstance ? ButtonStyle.Success : ButtonStyle.Secondary),
    );

    const row1 = new ActionRowBuilder().addComponents(pickerButtons);

    // Row 2: Bookmarks & Return Home
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('go_pick_bookmark')
            .setLabel('Bookmarks')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('go_return_home')
            .setLabel('Return Home')
            .setStyle(ButtonStyle.Secondary),
    );

    // Row 3: Go! / Clear / Cancel (only show Go! when there's a plan)
    const actionButtons = [];
    if (hasPlan) {
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId('go_execute')
                .setLabel('Go!')
                .setStyle(ButtonStyle.Success),
        );
        actionButtons.push(
            new ButtonBuilder()
                .setCustomId('go_clear')
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger),
        );
    }
    actionButtons.push(
        new ButtonBuilder()
            .setCustomId('go_cancel')
            .setLabel('Dismiss')
            .setStyle(ButtonStyle.Secondary),
    );

    const row3 = new ActionRowBuilder().addComponents(actionButtons);

    const result = { embeds: [embed], components: [row1, row2, row3] };

    // Attach map image file if available
    if (mapData?.attachment) {
        result.files = [mapData.attachment];
    }

    return result;
}

/**
 * Build a data center picker — user picks a DC first, then sees its worlds.
 */
export function buildGoDCSelectEmbed(dataCenters, regions, currentWorld, currentDC) {
    const embed = new EmbedBuilder()
        .setTitle('Select Data Center')
        .setColor(Colors.Travel)
        .setDescription(`Current: **${currentWorld || '?'}** on **${currentDC || '?'}**\nPick a data center to browse its worlds.`)
        .setTimestamp();

    const options = dataCenters.map(dc => {
        const regionName = regions.find(r => r.id === dc.region)?.name || dc.region.toUpperCase();
        const worldCount = dc.worlds.length;
        return new StringSelectMenuOptionBuilder()
            .setLabel(dc.name)
            .setDescription(`${regionName} — ${worldCount} worlds`)
            .setValue(dc.name);
    });

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('go_select_dc')
            .setPlaceholder('Pick a data center...')
            .addOptions(options)
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('go_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [selectRow, backRow] };
}

/**
 * Build a world selection dropdown for a specific DC.
 */
export function buildGoWorldSelectEmbed(dcName, dcWorlds, currentWorld) {
    const embed = new EmbedBuilder()
        .setTitle(`Select World — ${dcName}`)
        .setColor(Colors.Travel)
        .setDescription(`Current: **${currentWorld || '?'}**\nPick a world on **${dcName}** to travel to.`)
        .setTimestamp();

    const options = dcWorlds
        .filter(w => w.toLowerCase() !== (currentWorld || '').toLowerCase())
        .map(world =>
            new StringSelectMenuOptionBuilder()
                .setLabel(world)
                .setDescription(dcName)
                .setValue(world.toLowerCase())
        );

    if (options.length === 0) {
        embed.setDescription(`No other worlds available on ${dcName}.`);
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('go_pick_world')
                .setLabel('Other DCs')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('go_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary),
        );
        return { embeds: [embed], components: [backRow] };
    }

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('go_select_world')
            .setPlaceholder('Select a world...')
            .addOptions(options)
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('go_pick_world')
            .setLabel('Other DCs')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('go_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [selectRow, backRow] };
}

/**
 * Build an aetheryte selection dropdown with pagination.
 * @param {Array} aetherytes - Full list of aetherytes
 * @param {number} page - Page number (0-based)
 */
export function buildGoAetheryteSelectEmbed(aetherytes, page = 0) {
    const embed = new EmbedBuilder()
        .setTitle('Select Aetheryte')
        .setColor(Colors.Info)
        .setTimestamp();

    if (!aetherytes || aetherytes.length === 0) {
        embed.setDescription('No aetherytes available.');
        return { embeds: [embed], components: [] };
    }

    // Prioritize favourites, then sort by name
    const sorted = [...aetherytes].sort((a, b) => {
        if (a.isFavourite !== b.isFavourite) return a.isFavourite ? -1 : 1;
        return a.name.localeCompare(b.name);
    });

    const pageSize = 25;
    const totalPages = Math.ceil(sorted.length / pageSize);
    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * pageSize;
    const pageItems = sorted.slice(start, start + pageSize);

    embed.setDescription(
        `Pick an aetheryte to add to your journey plan.\n` +
        `Showing ${start + 1}–${start + pageItems.length} of ${sorted.length}` +
        (totalPages > 1 ? ` (page ${safePage + 1}/${totalPages})` : '')
    );

    const options = pageItems.map(a =>
        new StringSelectMenuOptionBuilder()
            .setLabel(`${a.isFavourite ? '★ ' : ''}${a.name}`)
            .setDescription(`${a.gilCost}g`)
            .setValue(`${a.id}_${a.subIndex}`)
    );

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('go_select_aetheryte')
            .setPlaceholder('Select an aetheryte...')
            .addOptions(options)
    );

    const navButtons = [];
    if (safePage > 0) {
        navButtons.push(
            new ButtonBuilder()
                .setCustomId(`go_aetheryte_page_${safePage - 1}`)
                .setLabel('◀ Prev')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (safePage < totalPages - 1) {
        navButtons.push(
            new ButtonBuilder()
                .setCustomId(`go_aetheryte_page_${safePage + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Primary)
        );
    }
    navButtons.push(
        new ButtonBuilder()
            .setCustomId('go_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
    );

    const navRow = new ActionRowBuilder().addComponents(navButtons);

    return { embeds: [embed], components: [selectRow, navRow] };
}

/**
 * Build a bookmark selection dropdown.
 */
export function buildGoBookmarkSelectEmbed(bookmarks) {
    const embed = new EmbedBuilder()
        .setTitle('Select Bookmark')
        .setColor(Colors.Info)
        .setTimestamp();

    if (!bookmarks || bookmarks.length === 0) {
        embed.setDescription('No bookmarks saved. Use `/bookmark save` to save your current position.');
        const backRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('go_back')
                .setLabel('Back')
                .setStyle(ButtonStyle.Secondary),
        );
        return { embeds: [embed], components: [backRow] };
    }

    const description = bookmarks
        .map((bm, i) => `**${i + 1}.** ${bm.name} \`(${bm.x?.toFixed(1)}, ${bm.y?.toFixed(1)}, ${bm.z?.toFixed(1)})\``)
        .join('\n');

    embed.setDescription(description);

    const options = bookmarks.slice(0, 25).map((bm, i) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(bm.name)
            .setDescription(`(${bm.x?.toFixed(1)}, ${bm.y?.toFixed(1)}, ${bm.z?.toFixed(1)})`)
            .setValue(String(i))
    );

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('go_select_bookmark')
            .setPlaceholder('Select a bookmark...')
            .addOptions(options)
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('go_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [selectRow, backRow] };
}

/**
 * Build an instance picker dropdown (1-9).
 */
export function buildGoInstanceSelectEmbed() {
    const embed = new EmbedBuilder()
        .setTitle('Select Instance')
        .setColor(Colors.Info)
        .setDescription('Pick the zone instance number for your destination.\nUseful for hunt trains and FATEs.')
        .setTimestamp();

    const options = [];
    for (let i = 1; i <= 9; i++) {
        options.push(
            new StringSelectMenuOptionBuilder()
                .setLabel(`Instance ${i}`)
                .setDescription(`Zone instance #${i}`)
                .setValue(String(i))
        );
    }

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('go_select_instance')
            .setPlaceholder('Select an instance...')
            .addOptions(options)
    );

    const backRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('go_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [selectRow, backRow] };
}

/**
 * Build a journey confirmation embed (used when /go has direct args).
 */
export function buildGoConfirmEmbed(plan, steps) {
    const embed = new EmbedBuilder()
        .setTitle('Confirm Journey')
        .setColor(Colors.Warning)
        .setDescription(steps.join('\n'))
        .setTimestamp();

    // Encode the plan into the button custom ID (JSON-safe)
    const planData = Buffer.from(JSON.stringify(plan)).toString('base64').slice(0, 80);

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`go_confirm_${planData}`)
            .setLabel('Go!')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('go_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [row] };
}

/**
 * Build a journey progress embed.
 */
export function buildGoProgressEmbed(step) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('Journey In Progress')
                .setColor(Colors.Travel)
                .setDescription(step || 'Starting journey...')
                .setTimestamp()
        ],
        components: [],
    };
}

/**
 * Build a journey result embed.
 */
export function buildGoResultEmbed(message, success = true) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(success ? 'Journey Complete' : 'Journey Failed')
                .setDescription(message)
                .setColor(success ? Colors.Success : Colors.Error)
                .setTimestamp()
        ],
        components: [],
    };
}

// ========== Status Embed ==========

/**
 * Build a status embed showing current character info.
 */
export function buildStatusEmbed(status, isOnline) {
    const embed = new EmbedBuilder()
        .setTitle('MoveMeXiv - Status')
        .setColor(isOnline ? Colors.Info : Colors.Error)
        .setTimestamp();

    if (!isOnline || !status) {
        embed.setDescription('Plugin is **offline**. Make sure FFXIV is running with MoveMeXiv enabled.');
        return { embeds: [embed], components: [] };
    }

    const pos = status.position || { x: 0, y: 0, z: 0 };

    embed.addFields(
        { name: 'Position', value: `\`X: ${pos.x?.toFixed(2) ?? '?'}  Y: ${pos.y?.toFixed(2) ?? '?'}  Z: ${pos.z?.toFixed(2) ?? '?'}\``, inline: false },
        { name: 'World', value: status.world || 'Unknown', inline: true },
        { name: 'Home World', value: status.homeWorld || 'Unknown', inline: true },
        { name: 'Data Center', value: status.dataCenter || 'Unknown', inline: true },
    );

    if (status.journeyActive) {
        embed.addFields({ name: 'Journey', value: status.journeyStep || 'In progress...', inline: false });
    }

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('status_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
}

// ========== Bookmark Embed ==========

/**
 * Build a bookmark list embed.
 */
export function buildBookmarkListEmbed(bookmarks) {
    const embed = new EmbedBuilder()
        .setTitle('MoveMeXiv - Bookmarks')
        .setColor(Colors.Info)
        .setTimestamp();

    if (!bookmarks || bookmarks.length === 0) {
        embed.setDescription('No bookmarks saved. Use `/bookmark save` to save your current position.');
        return { embeds: [embed], components: [] };
    }

    const description = bookmarks
        .map((bm, i) => `**${i + 1}.** ${bm.name} \`(${bm.x?.toFixed(1)}, ${bm.y?.toFixed(1)}, ${bm.z?.toFixed(1)})\` Zone ${bm.territoryId}`)
        .join('\n');

    embed.setDescription(description);

    const options = bookmarks.slice(0, 25).map((bm, i) =>
        new StringSelectMenuOptionBuilder()
            .setLabel(bm.name)
            .setDescription(`(${bm.x?.toFixed(1)}, ${bm.y?.toFixed(1)}, ${bm.z?.toFixed(1)})`)
            .setValue(String(i))
    );

    const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('bookmark_select')
            .setPlaceholder('Select a bookmark to teleport...')
            .addOptions(options)
    );

    return { embeds: [embed], components: [row] };
}

// ========== Utility Embeds ==========

/**
 * Build a simple result embed.
 */
export function buildResultEmbed(title, message, success = true) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle(title)
                .setDescription(message)
                .setColor(success ? Colors.Success : Colors.Error)
                .setTimestamp()
        ],
        components: [],
    };
}

/**
 * Build an offline/error embed.
 */
export function buildOfflineEmbed() {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('MoveMeXiv - Offline')
                .setDescription('Your FFXIV plugin is not connected.\n\nMake sure:\n1. FFXIV is running\n2. MoveMeXiv plugin is enabled\n3. Plugin is paired (use `/setup` if needed)')
                .setColor(Colors.Error)
                .setTimestamp()
        ],
        components: [],
    };
}

// ========== QuickSwitch Embeds ==========

/**
 * Build the character switch embed showing saved characters with switch buttons.
 * @param {Array} characters - Array of saved character objects from the plugin
 * @param {object} status - Current plugin status
 */
export function buildSwitchEmbed(characters, status) {
    const embed = new EmbedBuilder()
        .setTitle('QuickSwitch - Characters')
        .setColor(0x9B59B6) // Purple theme for QuickSwitch
        .setTimestamp();

    if (status) {
        const currentName = status.characterName || 'Unknown';
        const currentWorld = status.homeWorld || status.currentWorld || 'Unknown';
        embed.setDescription(`**Current:** ${currentName} @ ${currentWorld}`);

        if (status.switching) {
            embed.addFields({
                name: 'Switch In Progress',
                value: `${status.switchStatus || status.switchState || 'Working...'}`,
                inline: false,
            });
        }
    }

    if (!characters || characters.length === 0) {
        embed.addFields({
            name: 'No Characters',
            value: 'No characters saved yet. Log into your characters in FFXIV and they\'ll be auto-detected by the QuickSwitch plugin.',
            inline: false,
        });
        return { embeds: [embed], components: [] };
    }

    // Build character list fields
    const charLines = characters.map((c, i) => {
        const current = c.isCurrent ? ' **[CURRENT]**' : '';
        const slotInfo = c.slot >= 0 ? `Slot ${c.slot + 1}` : 'No slot';
        const lastLogin = c.lastLogin ? formatRelativeTime(c.lastLogin) : '';
        return `**${i + 1}.** ${c.name} — ${c.homeWorld} (${slotInfo})${current}${lastLogin ? ` • ${lastLogin}` : ''}`;
    });

    embed.addFields({
        name: `Characters (${characters.length})`,
        value: charLines.join('\n') || 'None',
        inline: false,
    });

    // Build select menu for switching (only characters with valid slots that aren't current)
    const switchable = characters.filter(c => !c.isCurrent && c.slot >= 0);
    const components = [];

    if (switchable.length > 0) {
        const options = switchable.slice(0, 25).map(c =>
            new StringSelectMenuOptionBuilder()
                .setLabel(c.name)
                .setDescription(`${c.homeWorld} — Slot ${c.slot + 1}`)
                .setValue(c.name)
        );

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('qs_select_character')
                .setPlaceholder('Switch to a character...')
                .addOptions(options)
        );
        components.push(selectRow);
    }

    // Action buttons row
    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('qs_logout')
            .setLabel('Quick Logout')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('qs_refresh')
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Secondary),
    );

    // Add abort button if currently switching
    if (status?.switching) {
        buttonRow.addComponents(
            new ButtonBuilder()
                .setCustomId('qs_abort')
                .setLabel('Abort Switch')
                .setStyle(ButtonStyle.Danger),
        );
    }

    components.push(buttonRow);

    return { embeds: [embed], components };
}

/**
 * Build a switch progress embed.
 */
export function buildSwitchProgressEmbed(message, characterName) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('QuickSwitch - Switching Character')
                .setColor(Colors.Warning)
                .setDescription(`Switching to **${characterName || 'character'}**...\n\n${message || 'Starting...'}`)
                .setTimestamp()
        ],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('qs_abort')
                    .setLabel('Abort')
                    .setStyle(ButtonStyle.Danger),
            ),
        ],
    };
}

/**
 * Format ISO timestamp as relative time string.
 */
function formatRelativeTime(isoString) {
    try {
        const date = new Date(isoString);
        const elapsed = Date.now() - date.getTime();
        const minutes = Math.floor(elapsed / 60_000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d ago`;
        return date.toLocaleDateString();
    } catch {
        return '';
    }
}

/**
 * Build a setup/pairing embed.
 */
export function buildSetupEmbed(pairingCode) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('MoveMeXiv - Plugin Setup')
                .setColor(Colors.Info)
                .setDescription('Enter this pairing code in your MoveMeXiv plugin settings to link your account.')
                .addFields(
                    { name: 'Pairing Code', value: `\`\`\`${pairingCode}\`\`\``, inline: false },
                    { name: 'Expires', value: 'In 5 minutes', inline: true },
                )
                .addFields({
                    name: 'Instructions',
                    value: '1. Open FFXIV and type `/mmx` to open MoveMeXiv\n2. Go to the **Settings** tab\n3. Paste the pairing code and click **Pair**\n4. You should see "Connected" status',
                })
                .setTimestamp()
        ],
        components: [],
    };
}
