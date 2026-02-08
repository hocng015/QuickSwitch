import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { buildBookmarkListEmbed, buildResultEmbed, buildOfflineEmbed } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('bookmark')
    .setDescription('Manage coordinate bookmarks.')
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('List all saved bookmarks.')
    )
    .addSubcommand(sub =>
        sub.setName('save')
            .setDescription('Save your current position as a bookmark.')
            .addStringOption(opt =>
                opt.setName('name')
                    .setDescription('Name for this bookmark')
                    .setRequired(true)
            )
    );

export async function execute(interaction) {
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    if (!pluginSocket.isOnline(userId)) {
        await interaction.reply({ ...buildOfflineEmbed(), flags: MessageFlags.Ephemeral });
        return;
    }

    if (subcommand === 'list') {
        try {
            const result = await pluginSocket.sendCommand(userId, { action: 'get_bookmarks' });
            const bookmarks = result.data?.bookmarks ?? result.bookmarks;
            const embed = buildBookmarkListEmbed(bookmarks);
            await interaction.reply(embed);
        } catch (err) {
            await interaction.reply({
                ...buildResultEmbed('Bookmarks', `Failed to load bookmarks: ${err.message}`, false),
                flags: MessageFlags.Ephemeral,
            });
        }
    } else if (subcommand === 'save') {
        const name = interaction.options.getString('name');

        if (name.length > 50) {
            await interaction.reply({
                ...buildResultEmbed('Invalid Name', 'Bookmark name must be 50 characters or fewer.', false),
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply();

        try {
            const result = await pluginSocket.sendCommand(userId, {
                action: 'save_bookmark',
                name,
            });

            await interaction.editReply(
                buildResultEmbed('Bookmark Saved', result.message || `Saved bookmark "${name}".`)
            );
        } catch (err) {
            await interaction.editReply(
                buildResultEmbed('Bookmark', `Failed: ${err.message}`, false)
            );
        }
    }
}
