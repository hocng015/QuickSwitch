import { createServer } from 'http';
import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { pluginSocket } from './websocket.js';
import { loadCommands, deployCommands } from './handlers/commandHandler.js';
import { handleComponent, handleModalSubmit } from './handlers/componentHandler.js';
import { initDatabase, closeDatabase } from './db.js';
import { preCheck, postLog, buildCommandDetails, isAdmin } from './middleware.js';

const PORT = process.env.PORT || 3000;

// --- Initialize database ---
await initDatabase();

// --- HTTP server (base for WebSocket upgrade + health check) ---
const httpServer = createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            connections: pluginSocket.connections.size,
            uptime: process.uptime(),
        }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('QuickSwitch Bot Server');
});

// --- Attach WebSocket server ---
pluginSocket.attach(httpServer);

// --- Discord bot ---
const discord = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

let commands;

discord.once(Events.ClientReady, async (client) => {
    console.log(`[Discord] Logged in as ${client.user.tag}`);

    // Load and deploy commands
    commands = await loadCommands();
    await deployCommands(commands);
});

// Handle all interactions
discord.on(Events.InteractionCreate, async (interaction) => {
    // Slash commands
    if (interaction.isChatInputCommand()) {
        const command = commands?.get(interaction.commandName);
        if (!command) return;

        const actionType = `command:${interaction.commandName}`;

        // Pre-checks (ban + rate limit) — skip for /admin from admins
        const skipPreCheck = interaction.commandName === 'admin' && isAdmin(interaction.user.id);
        if (!skipPreCheck) {
            const check = await preCheck(interaction, actionType);
            if (!check.allowed) {
                await interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
                return;
            }
        }

        try {
            await command.execute(interaction);
            const details = buildCommandDetails(interaction);
            postLog(interaction, actionType, details, true);
        } catch (err) {
            console.error(`[Discord] Error executing /${interaction.commandName}:`, err);
            postLog(interaction, actionType, { error: err.message }, false);

            const reply = {
                content: 'An error occurred while executing this command.',
                flags: MessageFlags.Ephemeral,
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply).catch(() => {});
            } else {
                await interaction.reply(reply).catch(() => {});
            }
        }
        return;
    }

    // Autocomplete
    if (interaction.isAutocomplete()) {
        const command = commands?.get(interaction.commandName);
        if (command?.autocomplete) {
            try {
                await command.autocomplete(interaction);
            } catch (err) {
                console.error(`[Discord] Error in autocomplete for /${interaction.commandName}:`, err);
            }
        }
        return;
    }

    // Button and select menu interactions
    if (interaction.isButton() || interaction.isStringSelectMenu()) {
        const customId = interaction.customId;
        // Derive a category from the customId for rate limiting/logging
        const actionType = `component:${customId.replace(/_\d+$/, '')}`;

        const check = await preCheck(interaction, actionType);
        if (!check.allowed) {
            try {
                await interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
            } catch {
                // Interaction may have expired
            }
            return;
        }

        try {
            await handleComponent(interaction);
            postLog(interaction, actionType, { customId }, true);
        } catch (err) {
            console.error(`[Discord] Error handling component ${customId}:`, err);
            postLog(interaction, actionType, { customId, error: err.message }, false);

            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({
                        content: 'An error occurred.',
                        flags: MessageFlags.Ephemeral,
                    });
                } else {
                    await interaction.reply({
                        content: 'An error occurred.',
                        flags: MessageFlags.Ephemeral,
                    });
                }
            } catch {
                // Interaction may have expired
            }
        }
        return;
    }

    // Modal submissions
    if (interaction.isModalSubmit()) {
        const actionType = `modal:${interaction.customId}`;

        const check = await preCheck(interaction, actionType);
        if (!check.allowed) {
            try {
                await interaction.reply({ content: check.reason, flags: MessageFlags.Ephemeral });
            } catch {}
            return;
        }

        try {
            await handleModalSubmit(interaction);
            postLog(interaction, actionType, { customId: interaction.customId }, true);
        } catch (err) {
            console.error(`[Discord] Error handling modal ${interaction.customId}:`, err);
            postLog(interaction, actionType, { customId: interaction.customId, error: err.message }, false);

            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ content: 'An error occurred.', flags: MessageFlags.Ephemeral });
                }
            } catch {}
        }
    }
});

// --- Start everything ---
httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] HTTP + WebSocket server listening on port ${PORT}`);
});

discord.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('[Discord] Failed to login:', err.message);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[Server] Shutting down...');
    discord.destroy();
    httpServer.close();
    await closeDatabase();
    process.exit(0);
});
