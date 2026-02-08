import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { buildStatusEmbed, buildOfflineEmbed } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show your current FFXIV character status.');

export async function execute(interaction) {
    const userId = interaction.user.id;
    const isOnline = pluginSocket.isOnline(userId);

    if (!isOnline) {
        await interaction.reply({ ...buildOfflineEmbed(), flags: MessageFlags.Ephemeral });
        return;
    }

    // Request fresh status from plugin
    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'get_status' });
        const status = result.data || result;
        const embed = buildStatusEmbed(status, true);
        await interaction.reply(embed);
    } catch (err) {
        // Fallback to cached status
        const cached = pluginSocket.getStatus(userId);
        const embed = buildStatusEmbed(cached, isOnline);
        await interaction.reply(embed);
    }
}
