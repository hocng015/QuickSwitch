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
    internal readonly WebSocketClient WebSocketClient;
    private readonly CommandDispatcher commandDispatcher;

    // Windows
    private readonly MainWindow mainWindow;

    public Plugin()
    {
        Configuration = PluginInterface.GetPluginConfig() as Configuration ?? new Configuration();

        // Initialize feature managers
        characterTracker = new CharacterTracker(ClientState, PlayerState, ObjectTable, DataManager, Log, Configuration);
        characterSwitcher = new CharacterSwitcher(
            Framework, GameGui, ClientState, Condition, Log, ChatGui, Configuration);

        // Initialize WebSocket client for Discord bot communication
        WebSocketClient = new WebSocketClient(Log, Framework, Configuration);
        commandDispatcher = new CommandDispatcher(
            WebSocketClient, characterSwitcher, Configuration, Log, ClientState, ObjectTable);

        // Initialize windows
        mainWindow = new MainWindow(characterTracker, characterSwitcher, WebSocketClient, Configuration);
        WindowSystem.AddWindow(mainWindow);

        // Register commands
        CommandManager.AddHandler(MainCommand, new CommandInfo(OnCommand)
        {
            HelpMessage = "QuickSwitch — toggle UI, or /qs <name> to switch, /qs logout, /qs abort",
        });

        // Hook UI
        PluginInterface.UiBuilder.Draw += WindowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi += ToggleMainUi;

        // Auto-connect to Discord bot server if configured
        if (Configuration.AutoConnect && !string.IsNullOrEmpty(Configuration.WebSocketServerUrl)
            && !string.IsNullOrEmpty(Configuration.AuthToken))
        {
            _ = WebSocketClient.ConnectAsync();
        }
    }

    public void Dispose()
    {
        PluginInterface.UiBuilder.Draw -= WindowSystem.Draw;
        PluginInterface.UiBuilder.OpenMainUi -= ToggleMainUi;

        WindowSystem.RemoveAllWindows();
        mainWindow.Dispose();
        characterSwitcher.Dispose();
        characterTracker.Dispose();
        commandDispatcher.Dispose();
        WebSocketClient.Dispose();

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

        // Treat as character name search
        var match = Configuration.FindCharacterByName(trimmed);
        if (match != null)
        {
            characterSwitcher.SwitchToCharacter(match);
        }
        else
        {
            ChatGui.Print($"[QuickSwitch] No character found matching '{trimmed}'.");
        }
    }

    public void ToggleMainUi() => mainWindow.Toggle();
}
