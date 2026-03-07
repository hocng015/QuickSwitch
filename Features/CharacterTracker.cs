using System;
using Dalamud.Plugin.Services;
using Lumina.Excel.Sheets;

namespace QuickSwitch.Features;

/// <summary>
/// Auto-detects characters on login and maintains the saved character list.
/// </summary>
public class CharacterTracker : IDisposable
{
    private readonly IClientState clientState;
    private readonly IPlayerState playerState;
    private readonly IObjectTable objectTable;
    private readonly IDataManager dataManager;
    private readonly IPluginLog log;
    private readonly Configuration config;

    public CharacterTracker(
        IClientState clientState,
        IPlayerState playerState,
        IObjectTable objectTable,
        IDataManager dataManager,
        IPluginLog log,
        Configuration config)
    {
        this.clientState = clientState;
        this.playerState = playerState;
        this.objectTable = objectTable;
        this.dataManager = dataManager;
        this.log = log;
        this.config = config;

        clientState.Login += OnLogin;
    }

    private void OnLogin()
    {
        if (!config.AutoDetectOnLogin)
            return;

        try
        {
            var player = objectTable.LocalPlayer;
            if (player == null)
                return;

            var contentId = playerState.ContentId;
            if (contentId == 0)
                return;

            var name = player.Name.TextValue;
            var homeWorldId = player.HomeWorld.RowId;
            var homeWorldName = ResolveWorldName(homeWorldId);

            var existing = config.FindCharacterByContentId(contentId);
            if (existing != null)
            {
                existing.Name = name;
                existing.HomeWorld = homeWorldName;
                existing.HomeWorldId = homeWorldId;
                existing.LastLogin = DateTime.UtcNow;
                log.Info($"[QuickSwitch] Updated character: {name} @ {homeWorldName}");
            }
            else
            {
                config.Characters.Add(new SavedCharacter
                {
                    ContentId = contentId,
                    Name = name,
                    HomeWorld = homeWorldName,
                    HomeWorldId = homeWorldId,
                    LastLogin = DateTime.UtcNow,
                    CharacterSlot = -1,
                });
                log.Info($"[QuickSwitch] New character detected: {name} @ {homeWorldName}");
            }

            config.Save();
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Error tracking character on login: {ex.Message}");
        }
    }

    public string ResolveWorldName(uint worldId)
    {
        var worldSheet = dataManager.GetExcelSheet<World>();
        var row = worldSheet?.GetRowOrDefault(worldId);
        return row?.Name.ExtractText() ?? $"World #{worldId}";
    }

    public void Dispose()
    {
        clientState.Login -= OnLogin;
    }
}
