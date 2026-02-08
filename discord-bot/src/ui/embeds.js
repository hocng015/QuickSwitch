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
};

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
                .setTitle('QuickSwitch - Offline')
                .setDescription('Your FFXIV plugin is not connected.\n\nMake sure:\n1. FFXIV is running\n2. QuickSwitch plugin is enabled\n3. Plugin is paired (use `/setup` if needed)')
                .setColor(Colors.Error)
                .setTimestamp()
        ],
        components: [],
    };
}

/**
 * Build a setup/pairing embed.
 */
export function buildSetupEmbed(pairingCode) {
    return {
        embeds: [
            new EmbedBuilder()
                .setTitle('QuickSwitch - Plugin Setup')
                .setColor(Colors.Info)
                .setDescription('Enter this pairing code in your QuickSwitch plugin settings to link your account.')
                .addFields(
                    { name: 'Pairing Code', value: `\`\`\`${pairingCode}\`\`\``, inline: false },
                    { name: 'Expires', value: 'In 5 minutes', inline: true },
                )
                .addFields({
                    name: 'Instructions',
                    value: '1. Open FFXIV and type `/qs` to open QuickSwitch\n2. Go to the **Settings** tab\n3. Paste the pairing code and click **Pair**\n4. You should see "Connected" status',
                })
                .setTimestamp()
        ],
        components: [],
    };
}
