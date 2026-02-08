import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { pluginSocket } from '../websocket.js';
import { isQsAllowed } from '../db.js';
import { postLog } from '../middleware.js';
import {
    buildSwitchEmbed,
    buildOfflineEmbed,
    buildResultEmbed,
} from '../ui/embeds.js';

export const data = new SlashCommandBuilder()
    .setName('switch')
    .setDescription('Switch between your FFXIV characters.')
    .addSubcommand(sub =>
        sub.setName('list')
            .setDescription('Show your saved characters and switch between them.'))
    .addSubcommand(sub =>
        sub.setName('to')
            .setDescription('Switch to a character by name.')
            .addStringOption(opt =>
                opt.setName('character')
                    .setDescription('Character name (partial match)')
                    .setRequired(true)
                    .setAutocomplete(true)))
    .addSubcommand(sub =>
        sub.setName('logout')
            .setDescription('Quick logout to character select screen.'));

export async function autocomplete(interaction) {
    const userId = interaction.user.id;
    const focused = interaction.options.getFocused().toLowerCase();

    // Try to get character list from cached status or live request
    let characters = [];
    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'get_characters' }, 5000);
        characters = result.data?.characters ?? result.characters ?? [];
    } catch {
        // If plugin is offline, return empty suggestions
    }

    const filtered = characters
        .filter(c => c.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map(c => ({
            name: `${c.name} @ ${c.homeWorld}${c.isCurrent ? ' (current)' : ''}`,
            value: c.name,
        }));

    await interaction.respond(filtered);
}

export async function execute(interaction) {
    const userId = interaction.user.id;
    const subcommand = interaction.options.getSubcommand();

    // Check QuickSwitch access control
    const access = await isQsAllowed(userId);
    if (!access.allowed) {
        const reason = access.reason ? `: ${access.reason}` : '.';
        await interaction.reply({
            ...buildResultEmbed('QuickSwitch', `You are blocked from using QuickSwitch${reason}`, false),
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (!pluginSocket.isOnline(userId)) {
        await interaction.reply({ ...buildOfflineEmbed(), flags: MessageFlags.Ephemeral });
        return;
    }

    switch (subcommand) {
        case 'list':
            await handleList(interaction, userId);
            break;
        case 'to':
            await handleSwitchTo(interaction, userId);
            break;
        case 'logout':
            await handleLogout(interaction, userId);
            break;
    }
}

async function handleList(interaction, userId) {
    await interaction.deferReply();

    try {
        // Fetch characters and current status in parallel
        const [charResult, statusResult] = await Promise.all([
            pluginSocket.sendCommand(userId, { action: 'get_characters' }, 10_000),
            pluginSocket.sendCommand(userId, { action: 'get_status' }, 10_000),
        ]);

        const characters = charResult.data?.characters ?? charResult.characters ?? [];
        const status = statusResult.data || statusResult;

        await interaction.editReply(buildSwitchEmbed(characters, status));
    } catch (err) {
        await interaction.editReply(
            buildResultEmbed('QuickSwitch', `Failed to load characters: ${err.message}`, false));
    }
}

async function handleSwitchTo(interaction, userId) {
    const characterName = interaction.options.getString('character');

    await interaction.deferReply();

    try {
        const result = await pluginSocket.sendCommand(userId, {
            action: 'switch_character',
            name: characterName,
        }, 30_000);

        const success = result.success !== false;
        postLog(interaction, 'qs:switch', { character: characterName, result: result.message }, success);
        await interaction.editReply(
            buildResultEmbed(
                'QuickSwitch',
                result.message || (success ? `Switching to ${characterName}...` : 'Switch failed.'),
                success,
            ));
    } catch (err) {
        postLog(interaction, 'qs:switch', { character: characterName, error: err.message }, false);
        await interaction.editReply(
            buildResultEmbed('QuickSwitch', `Failed: ${err.message}`, false));
    }
}

async function handleLogout(interaction, userId) {
    await interaction.deferReply();

    try {
        const result = await pluginSocket.sendCommand(userId, { action: 'logout' }, 15_000);

        const success = result.success !== false;
        postLog(interaction, 'qs:logout', { result: result.message }, success);
        await interaction.editReply(
            buildResultEmbed(
                'QuickSwitch',
                result.message || (success ? 'Logging out to character select...' : 'Logout failed.'),
                success,
            ));
    } catch (err) {
        postLog(interaction, 'qs:logout', { error: err.message }, false);
        await interaction.editReply(
            buildResultEmbed('QuickSwitch', `Failed: ${err.message}`, false));
    }
}
