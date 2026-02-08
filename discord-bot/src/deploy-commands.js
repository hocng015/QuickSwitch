/**
 * Standalone script to register slash commands with Discord.
 * Run: node src/deploy-commands.js
 *
 * Set environment variables before running:
 *   DISCORD_TOKEN, DISCORD_CLIENT_ID, GUILD_ID (optional)
 */

import { loadCommands, deployCommands } from './handlers/commandHandler.js';

async function main() {
    console.log('Loading commands...');
    const commands = await loadCommands();
    console.log('Deploying commands to Discord...');
    await deployCommands(commands);
    console.log('Done.');
}

main().catch(console.error);
