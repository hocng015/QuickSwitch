using System;
using System.Linq;
using System.Text.Json;
using Dalamud.Plugin.Services;

namespace QuickSwitch.Features;

/// <summary>
/// Routes incoming WebSocket commands from the Discord bot to QuickSwitch features.
/// Supports: get_characters, switch_character, logout, get_status, abort.
/// </summary>
public class CommandDispatcher : IDisposable
{
    private readonly WebSocketClient wsClient;
    private readonly CharacterSwitcher switcher;
    private readonly Configuration config;
    private readonly IPluginLog log;
    private readonly IClientState clientState;
    private readonly IObjectTable objectTable;

    public CommandDispatcher(
        WebSocketClient wsClient,
        CharacterSwitcher switcher,
        Configuration config,
        IPluginLog log,
        IClientState clientState,
        IObjectTable objectTable)
    {
        this.wsClient = wsClient;
        this.switcher = switcher;
        this.config = config;
        this.log = log;
        this.clientState = clientState;
        this.objectTable = objectTable;

        wsClient.OnCommandReceived += HandleCommand;

        // Forward switcher status updates to the bot
        switcher.OnStatusUpdate += OnSwitcherStatus;
        switcher.OnSwitchComplete += OnSwitcherComplete;
    }

    private void OnSwitcherStatus(string message)
    {
        _ = wsClient.SendStatusUpdateAsync(new
        {
            plugin = "quickswitch",
            switching = switcher.IsSwitching,
            state = switcher.CurrentState.ToString(),
            message,
        });
    }

    private void OnSwitcherComplete(bool success, string message)
    {
        _ = wsClient.SendStatusUpdateAsync(new
        {
            plugin = "quickswitch",
            switching = false,
            state = switcher.CurrentState.ToString(),
            success,
            message,
        });
    }

    private void HandleCommand(string requestId, JsonElement payload)
    {
        try
        {
            var action = payload.GetProperty("action").GetString();
            log.Info($"[QuickSwitch/Discord] Received command: {action} (requestId: {requestId})");

            switch (action)
            {
                case "get_status":
                    HandleGetStatus(requestId);
                    break;

                case "get_characters":
                    HandleGetCharacters(requestId);
                    break;

                case "switch_character":
                    HandleSwitchCharacter(requestId, payload);
                    break;

                case "logout":
                    HandleLogout(requestId);
                    break;

                case "abort":
                    HandleAbort(requestId);
                    break;

                default:
                    _ = wsClient.SendCommandResultAsync(requestId, false, $"Unknown action: {action}");
                    break;
            }
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch/Discord] Error handling command: {ex.Message}");
            _ = wsClient.SendCommandResultAsync(requestId, false, $"Error: {ex.Message}");
        }
    }

    private void HandleGetStatus(string requestId)
    {
        var player = objectTable.LocalPlayer;
        var result = new
        {
            isLoggedIn = clientState.IsLoggedIn,
            characterName = player?.Name.TextValue ?? "N/A",
            homeWorld = player != null ? GetWorldName(player.HomeWorld.RowId) : "N/A",
            currentWorld = player != null ? GetWorldName(player.CurrentWorld.RowId) : "N/A",
            switching = switcher.IsSwitching,
            switchState = switcher.CurrentState.ToString(),
            switchStatus = switcher.StatusMessage,
            characterCount = config.Characters.Count,
        };

        _ = wsClient.SendCommandResultAsync(requestId, true, "Status retrieved.", result);
    }

    private void HandleGetCharacters(string requestId)
    {
        var characters = config.Characters.Select(c => new
        {
            name = c.Name,
            homeWorld = c.HomeWorld,
            slot = c.CharacterSlot,
            serviceAccount = c.ServiceAccountIndex,
            lastLogin = c.LastLogin.ToString("o"),
            notes = c.Notes,
            isCurrent = clientState.IsLoggedIn && Plugin.PlayerState.ContentId == c.ContentId,
        }).ToList();

        _ = wsClient.SendCommandResultAsync(requestId, true, "Characters retrieved.", new { characters });
    }

    private void HandleSwitchCharacter(string requestId, JsonElement payload)
    {
        SavedCharacter? target = null;

        if (payload.TryGetProperty("name", out var nameProp))
        {
            var name = nameProp.GetString()!;
            target = config.FindCharacterByName(name);
            if (target == null)
            {
                _ = wsClient.SendCommandResultAsync(requestId, false, $"No character found matching '{name}'.");
                return;
            }
        }
        else if (payload.TryGetProperty("slot", out var slotProp))
        {
            var slot = slotProp.GetInt32() - 1; // User provides 1-based, we store 0-based
            target = config.Characters.FirstOrDefault(c => c.CharacterSlot == slot);
            if (target == null)
            {
                _ = wsClient.SendCommandResultAsync(requestId, false, $"No character configured for slot {slot + 1}.");
                return;
            }
        }

        if (target == null)
        {
            _ = wsClient.SendCommandResultAsync(requestId, false, "Specify 'name' or 'slot' to switch to.");
            return;
        }

        var success = switcher.SwitchToCharacter(target);
        _ = wsClient.SendCommandResultAsync(requestId, success,
            success ? $"Switching to {target.Name} @ {target.HomeWorld}..."
                    : "Cannot switch right now. Check in-game chat for details.");
    }

    private void HandleLogout(string requestId)
    {
        var success = switcher.InitiateLogout();
        _ = wsClient.SendCommandResultAsync(requestId, success,
            success ? "Logging out to character select..."
                    : "Cannot logout right now. Check in-game chat for details.");
    }

    private void HandleAbort(string requestId)
    {
        if (!switcher.IsSwitching)
        {
            _ = wsClient.SendCommandResultAsync(requestId, false, "No switch operation in progress.");
            return;
        }

        switcher.Abort();
        _ = wsClient.SendCommandResultAsync(requestId, true, "Switch operation aborted.");
    }

    private string GetWorldName(uint worldId)
    {
        var worldSheet = Plugin.DataManager.GetExcelSheet<Lumina.Excel.Sheets.World>();
        var row = worldSheet?.GetRowOrDefault(worldId);
        return row?.Name.ExtractText() ?? $"World #{worldId}";
    }

    public void Dispose()
    {
        wsClient.OnCommandReceived -= HandleCommand;
        switcher.OnStatusUpdate -= OnSwitcherStatus;
        switcher.OnSwitchComplete -= OnSwitcherComplete;
    }
}
