using System;
using System.Collections.Generic;
using System.Linq;
using Dalamud.Configuration;

namespace QuickSwitch;

[Serializable]
public class Configuration : IPluginConfiguration
{
    public int Version { get; set; } = 0;

    /// <summary>Known characters, built up over time via auto-detection on login.</summary>
    public List<SavedCharacter> Characters { get; set; } = new();

    /// <summary>Whether to auto-detect the current character on login and add/update it.</summary>
    public bool AutoDetectOnLogin { get; set; } = true;

    /// <summary>Timeout in seconds for each state in the switch state machine.</summary>
    public int StateTimeoutSeconds { get; set; } = 30;

    /// <summary>Minimum seconds between character switches (cooldown).</summary>
    public int SwitchCooldownSeconds { get; set; } = 30;

    /// <summary>Whether to show a confirmation dialog before switching characters.</summary>
    public bool RequireConfirmation { get; set; } = true;

    /// <summary>WebSocket server URL (Railway app URL).</summary>
    public string WebSocketServerUrl { get; set; } = "https://quickswitch-production.up.railway.app";

    /// <summary>JWT auth token from pairing flow.</summary>
    public string AuthToken { get; set; } = string.Empty;

    /// <summary>Automatically connect to the server when the plugin loads.</summary>
    public bool AutoConnect { get; set; } = true;

    public void Save()
    {
        Plugin.PluginInterface.SavePluginConfig(this);
    }

    public SavedCharacter? FindCharacterByName(string partialName)
    {
        return Characters.FirstOrDefault(c =>
            c.Name.Contains(partialName, StringComparison.OrdinalIgnoreCase));
    }

    public SavedCharacter? FindCharacterByContentId(ulong contentId)
    {
        return Characters.FirstOrDefault(c => c.ContentId == contentId);
    }
}

[Serializable]
public class SavedCharacter
{
    /// <summary>Unique content ID for this character.</summary>
    public ulong ContentId { get; set; }

    /// <summary>Character display name (e.g., "Firstname Lastname").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Home world name (e.g., "Lamia").</summary>
    public string HomeWorld { get; set; } = string.Empty;

    /// <summary>Home world row ID from the World Lumina sheet.</summary>
    public uint HomeWorldId { get; set; }

    /// <summary>Character slot index on the character select screen (0-based).
    /// -1 means unknown/not configured.</summary>
    public int CharacterSlot { get; set; } = -1;

    /// <summary>Service account index (0-based). Most players only have 1 (index 0).</summary>
    public int ServiceAccountIndex { get; set; } = 0;

    /// <summary>Last time this character was logged into (UTC).</summary>
    public DateTime LastLogin { get; set; }

    /// <summary>User-assigned notes (optional).</summary>
    public string Notes { get; set; } = string.Empty;
}
