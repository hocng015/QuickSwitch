import { Collection, REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load all command modules from the commands directory.
 * Returns a Collection<commandName, commandModule>.
 */
export async function loadCommands() {
    const commands = new Collection();
    const commandsPath = join(__dirname, '..', 'commands');
    const commandFiles = readdirSync(commandsPath).filter(f => f.endsWith('.js'));

    for (const file of commandFiles) {
        const filePath = join(commandsPath, file);
        const fileUrl = pathToFileURL(filePath).href;
        const command = await import(fileUrl);

        if (command.data && command.execute) {
            commands.set(command.data.name, command);
        } else {
            console.warn(`[Commands] Skipping ${file}: missing data or execute.`);
        }
    }

    console.log(`[Commands] Loaded ${commands.size} commands.`);
    return commands;
}

/**
 * Register slash commands with Discord API.
 * Uses guild commands for faster updates during development.
 */
export async function deployCommands(commands) {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    const guildId = process.env.GUILD_ID;

    const rest = new REST().setToken(token);
    const commandData = commands.map(cmd => cmd.data.toJSON());

    try {
        if (guildId) {
            // Guild-specific (instant, for development)
            await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
                body: commandData,
            });
            console.log(`[Commands] Registered ${commandData.length} guild commands.`);
        } else {
            // Global (takes up to 1 hour to propagate)
            await rest.put(Routes.applicationCommands(clientId), {
                body: commandData,
            });
            console.log(`[Commands] Registered ${commandData.length} global commands.`);
        }
    } catch (err) {
        console.error('[Commands] Failed to register commands:', err);
    }
}
