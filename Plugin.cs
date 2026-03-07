using System;
using System.Linq;
using Dalamud.Game.Command;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;
using Dalamud.Interface.Windowing;
using QuickSwitch.Features;
using QuickSwitch.Windows;

namespace QuickSwitch;

public sealed class Plugin : IDalamudPlugin
{
    [PluginService] internal static IDalamudPluginInterface PluginInterface { get; private set; } = null!;
    [PluginService] internal static ICommandManager CommandManager { get; private set; } = null!;
    [PluginService] internal static IClientState ClientState { get; private set; } = null!;
    [PluginService] internal static IObjectTable ObjectTable { get; private set; } = null!;
    [PluginService] internal static ICondition Condition { get; private set; } = null!;
    [PluginService] internal static IFramework Framework { get; private set; } = null!;
    [PluginService] internal static IDataManager DataManager { get; private set; } = null!;
    [PluginService] internal static IPluginLog Log { get; private set; } = null!;
    [PluginService] internal static IChatGui ChatGui { get; private set; } = null!;
    [PluginService] internal static IGameGui GameGui { get; private set; } = null!;
    [PluginService] internal static IPlayerState PlayerState { get; private set; } = null!;

    private const string MainCommand = "/qs";

    public Configuration Configuration { get; init; }
    public readonly WindowSystem WindowSystem = new("QuickSwitch");

    // Feature managers
    private readonly CharacterTracker characterTracker;
    private readonly CharacterSwitcher characterSwitcher;

    // Windows
    private readonly MainWindow mainWindow;

    public Plugin()
    {
        Configuration = PluginInterface.GetPluginConfig() as Configuration ?? new Configuration();

        // Initialize feature managers
        characterTracker = new CharacterTracker(ClientState, PlayerState, ObjectTable, DataManager, Log, Configuration);
        characterSwitcher = new CharacterSwitcher(
            Framework, GameGui, ClientState, Condition, DataManager, Log, ChatGui, Configuration);

        // Initialize windows
        mainWindow = new MainWindow(characterTracker, characterSwitcher, Configuration);
        WindowSystem.AddWindow(mainWindow);

        // Register commands
        CommandManager.AddHandler(MainCommand, new CommandInfo(OnCommand)
        {
            HelpMessage = "QuickSwitch — /qs to toggle UI, /qs <number> or /qs <name> to switch, /qs list, /qs logout, /qs abort",
        });

        // Hook UI
        PluginInterface.UiBuilder.Draw += WindowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi += ToggleMainUi;
    }

    public void Dispose()
    {
        PluginInterface.UiBuilder.Draw -= WindowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi -= ToggleMainUi;

        WindowSystem.RemoveAllWindows();
        mainWindow.Dispose();
        characterSwitcher.Dispose();
        characterTracker.Dispose();

        CommandManager.RemoveHandler(MainCommand);
    }

    private void OnCommand(string command, string args)
    {
        var trimmed = args.Trim();

        if (string.IsNullOrEmpty(trimmed))
        {
            mainWindow.Toggle();
            return;
        }

        if (trimmed.Equals("logout", StringComparison.OrdinalIgnoreCase))
        {
            characterSwitcher.InitiateLogout();
            return;
        }

        if (trimmed.Equals("abort", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("stop", StringComparison.OrdinalIgnoreCase))
        {
            characterSwitcher.Abort();
            return;
        }

        // List command
        if (trimmed.Equals("list", StringComparison.OrdinalIgnoreCase))
        {
            if (Configuration.Characters.Count == 0)
            {
                ChatGui.Print("[QuickSwitch] No characters saved. Log into your characters to auto-detect them.");
            }
            else
            {
                ChatGui.Print("[QuickSwitch] Characters:");
                for (var i = 0; i < Configuration.Characters.Count; i++)
                {
                    var ch = Configuration.Characters[i];
                    ChatGui.Print($"  {i + 1}. {ch.Name} @ {ch.HomeWorld}");
                }
            }
            return;
        }

        // Number-based switch (e.g., /qs 2)
        if (int.TryParse(trimmed, out var listIndex))
        {
            if (listIndex < 1 || listIndex > Configuration.Characters.Count)
            {
                ChatGui.Print($"[QuickSwitch] Invalid number. Use 1-{Configuration.Characters.Count}. See /qs list.");
            }
            else
            {
                characterSwitcher.SwitchToCharacter(Configuration.Characters[listIndex - 1]);
            }
            return;
        }

        // Treat as character name search (supports "Name@World" for disambiguation)
        var ambiguous = new System.Collections.Generic.List<SavedCharacter>();
        var match = Configuration.FindCharacterByName(trimmed, ambiguous);
        if (match != null)
        {
            characterSwitcher.SwitchToCharacter(match);
        }
        else if (ambiguous.Count > 0)
        {
            ChatGui.Print($"[QuickSwitch] Multiple characters match '{trimmed}'. Use Name@World or number:");
            for (var i = 0; i < ambiguous.Count; i++)
            {
                var idx = Configuration.Characters.IndexOf(ambiguous[i]) + 1;
                ChatGui.Print($"  /qs {idx}  —  {ambiguous[i].Name} @ {ambiguous[i].HomeWorld}");
            }
        }
        else
        {
            ChatGui.Print($"[QuickSwitch] No character found matching '{trimmed}'.");
        }
    }

    public void ToggleMainUi() => mainWindow.Toggle();
}
