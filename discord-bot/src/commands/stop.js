import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { buildOfflineEmbed } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Emergency stop — immediately halt all movement and travel.');

export async function execute(interaction) {
    const userId = interaction.user.id;
    const isOnline = pluginSocket.isOnline(userId);

    if (!isOnline) {
        await interaction.reply({ ...buildOfflineEmbed(), flags: MessageFlags.Ephemeral });
        return;
    }

    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'stop' });
        const data = result.data || result;
        await interaction.reply({
            content: `🛑 **Emergency Stop** — ${data.message || result.message || 'All movement halted.'}`,
        });
    } catch (err) {
        await interaction.reply({
            content: `❌ Failed to send stop command: ${err.message}`,
            flags: MessageFlags.Ephemeral,
        });
    }
}
