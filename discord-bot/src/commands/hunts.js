/**
 * /hunts command — Admin hunt listener configuration.
 * Subcommands: setup, watch, unwatch, config, test
 */

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder, MessageFlags } from 'discord.js';
import { isAdmin } from '../middleware.js';
import { getHuntConfig, setHuntConfig } from '../db.js';
import { reloadConfig } from '../hunts/huntListener.js';
import { parseHuntText } from '../hunts/huntParser.js';
import { Colors } from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('hunts')
    .setDescription('Configure the hunt notification listener.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub =>
        sub.setName('setup')
            .setDescription('Set the output channel for hunt alerts.')
            .addChannelOption(opt =>
                opt.setName('channel')
                    .setDescription('Channel to post hunt alerts in')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
    )
    .addSubcommand(sub =>
        sub.setName('watch')
            .setDescription('Add a channel to the hunt watch list.')
            .addChannelOption(opt =>
                opt.setName('channel')
                    .setDescription('Channel to monitor for hunt notifications')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
    )
    .addSubcommand(sub =>
        sub.setName('unwatch')
            .setDescription('Remove a channel from the hunt watch list.')
            .addChannelOption(opt =>
                opt.setName('channel')
                    .setDescription('Channel to stop monitoring')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            )
    )
    .addSubcommand(sub =>
        sub.setName('config')
            .setDescription('Show current hunt listener configuration.')
    )
    .addSubcommand(sub =>
        sub.setName('test')
            .setDescription('Test the hunt parser on a message string.')
            .addStringOption(opt =>
                opt.setName('message')
                    .setDescription('Sample hunt message to parse')
                    .setRequired(true)
            )
    );

export async function execute(interaction) {
    if (!isAdmin(interaction.user.id)) {
        await interaction.reply({ content: 'This command is restricted to admins.', flags: MessageFlags.Ephemeral });
        return;
    }

    const sub = interaction.options.getSubcommand();
    const guildId = process.env.GUILD_ID || interaction.guildId;

    if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        await setHuntConfig(guildId, 'output_channel', channel.id);
        await reloadConfig();

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Hunt Output Channel Set')
                .setDescription(`Hunt alerts will be posted in <#${channel.id}>.`)
                .setColor(Colors.Success)
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'watch') {
        const channel = interaction.options.getChannel('channel');
        const config = await getHuntConfig(guildId);
        const channels = config.watchChannels || [];

        if (channels.includes(channel.id)) {
            await interaction.reply({
                content: `<#${channel.id}> is already being watched.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        channels.push(channel.id);
        await setHuntConfig(guildId, 'watch_channels', JSON.stringify(channels));
        await reloadConfig();

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Channel Added to Watch List')
                .setDescription(`Now monitoring <#${channel.id}> for hunt notifications.`)
                .setColor(Colors.Success)
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'unwatch') {
        const channel = interaction.options.getChannel('channel');
        const config = await getHuntConfig(guildId);
        const channels = (config.watchChannels || []).filter(id => id !== channel.id);

        await setHuntConfig(guildId, 'watch_channels', JSON.stringify(channels));
        await reloadConfig();

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Channel Removed from Watch List')
                .setDescription(`Stopped monitoring <#${channel.id}>.`)
                .setColor(Colors.Success)
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'config') {
        const config = await getHuntConfig(guildId);

        const outputStr = config.outputChannel ? `<#${config.outputChannel}>` : 'Not set';
        const watchStr = config.watchChannels.length > 0
            ? config.watchChannels.map(id => `<#${id}>`).join('\n')
            : 'None';

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Hunt Listener Configuration')
                .setColor(Colors.Info)
                .addFields(
                    { name: 'Output Channel', value: outputStr, inline: false },
                    { name: 'Watched Channels', value: watchStr, inline: false },
                )
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'test') {
        const text = interaction.options.getString('message');
        const result = parseHuntText(text);

        if (!result) {
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Parser Result: No Match')
                    .setDescription('Could not extract hunt info from the provided text. Needs at minimum a world name and either coordinates or a zone name.')
                    .setColor(Colors.Warning)
                    .addFields({ name: 'Input', value: `\`\`\`${text.substring(0, 500)}\`\`\`` })
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const fields = [
            { name: 'Mob Name', value: result.mobName || 'Unknown', inline: true },
            { name: 'Rank', value: result.rank || 'Unknown', inline: true },
            { name: 'World', value: result.world, inline: true },
            { name: 'Zone', value: result.zone || 'Unknown', inline: true },
        ];
        if (result.x != null && result.y != null) {
            fields.push({ name: 'Coordinates', value: `X: ${result.x}, Y: ${result.y}`, inline: true });
        }
        if (result.instance) {
            fields.push({ name: 'Instance', value: `${result.instance}`, inline: true });
        }

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Parser Result: Match Found')
                .setColor(Colors.Success)
                .addFields(fields)
                .addFields({ name: 'Input', value: `\`\`\`${text.substring(0, 300)}\`\`\`` })
            ],
            flags: MessageFlags.Ephemeral,
        });
    }
}
