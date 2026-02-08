/**
 * /hunt command — User-facing hunt features.
 * Subcommands: report, subscribe, unsubscribe, status
 */

import {
    SlashCommandBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    EmbedBuilder,
    MessageFlags,
} from 'discord.js';
import { Colors } from '../ui/embeds.js';
import { subscribeHunts, unsubscribeHunts, getHuntPrefs } from '../db.js';
import { dataCenters } from '../data/worlds.js';
import { postManualHuntAlert } from '../hunts/huntListener.js';

export const data = new SlashCommandBuilder()
    .setName('hunt')
    .setDescription('Hunt tools — report sightings and subscribe to alerts.')
    .addSubcommand(sub =>
        sub.setName('report')
            .setDescription('Report a hunt sighting for the server.')
    )
    .addSubcommand(sub =>
        sub.setName('subscribe')
            .setDescription('Subscribe to hunt alert pings for your data center.')
            .addStringOption(opt =>
                opt.setName('datacenter')
                    .setDescription('Your data center')
                    .setRequired(true)
                    .addChoices(
                        ...dataCenters.map(dc => ({ name: `${dc.name} (${dc.region.toUpperCase()})`, value: dc.name }))
                    )
            )
    )
    .addSubcommand(sub =>
        sub.setName('unsubscribe')
            .setDescription('Stop receiving hunt alert pings.')
    )
    .addSubcommand(sub =>
        sub.setName('status')
            .setDescription('Check your hunt subscription status.')
    );

export async function execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'report') {
        // Show modal for manual hunt report
        const modal = new ModalBuilder()
            .setCustomId('hunt_report_modal')
            .setTitle('Report a Hunt');

        const worldInput = new TextInputBuilder()
            .setCustomId('hunt_world')
            .setLabel('World (server name)')
            .setPlaceholder('e.g. Gilgamesh')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(30);

        const zoneInput = new TextInputBuilder()
            .setCustomId('hunt_zone')
            .setLabel('Zone / Map name')
            .setPlaceholder('e.g. The Lochs')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(60);

        const coordsInput = new TextInputBuilder()
            .setCustomId('hunt_coords')
            .setLabel('Coordinates (X, Y)')
            .setPlaceholder('e.g. 24.5, 23.8')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(20);

        const detailsInput = new TextInputBuilder()
            .setCustomId('hunt_details')
            .setLabel('Mob name, rank, instance (optional)')
            .setPlaceholder('e.g. Ixion S Rank i3')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(100);

        modal.addComponents(
            new ActionRowBuilder().addComponents(worldInput),
            new ActionRowBuilder().addComponents(zoneInput),
            new ActionRowBuilder().addComponents(coordsInput),
            new ActionRowBuilder().addComponents(detailsInput),
        );

        await interaction.showModal(modal);
    }

    else if (sub === 'subscribe') {
        const dc = interaction.options.getString('datacenter');
        await subscribeHunts(interaction.user.id, dc);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Hunt Alerts Subscribed')
                .setDescription(`You will be pinged when hunts are spotted on **${dc}**. Your consent to receive these pings has been recorded.\n\nUse \`/hunt unsubscribe\` to opt out at any time.`)
                .setColor(Colors.Success)
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'unsubscribe') {
        await unsubscribeHunts(interaction.user.id);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setTitle('Hunt Alerts Unsubscribed')
                .setDescription('You will no longer be pinged for hunt alerts.')
                .setColor(Colors.Success)
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    else if (sub === 'status') {
        const prefs = await getHuntPrefs(interaction.user.id);

        if (!prefs || !prefs.subscribed) {
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Hunt Subscription Status')
                    .setDescription('You are **not subscribed** to hunt alerts.\n\nUse `/hunt subscribe` to opt in and receive pings when hunts are spotted on your data center.')
                    .setColor(Colors.Info)
                ],
                flags: MessageFlags.Ephemeral,
            });
        } else {
            await interaction.reply({
                embeds: [new EmbedBuilder()
                    .setTitle('Hunt Subscription Status')
                    .setDescription(`You are **subscribed** to hunt alerts for **${prefs.dataCenter}**.\n\nUse \`/hunt unsubscribe\` to opt out.`)
                    .setColor(Colors.Success)
                ],
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}
