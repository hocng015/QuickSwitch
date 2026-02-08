import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { generatePairingCode } from '../auth.js';
import { buildSetupEmbed } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Generate a pairing code to link your FFXIV plugin.');

export async function execute(interaction) {
    const code = generatePairingCode(interaction.user.id);
    const embed = buildSetupEmbed(code);

    await interaction.reply({
        ...embed,
        flags: MessageFlags.Ephemeral,
    });
}
