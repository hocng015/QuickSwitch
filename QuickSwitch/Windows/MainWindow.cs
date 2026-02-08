using System;
using System.Linq;
using System.Numerics;
using Dalamud.Bindings.ImGui;
using Dalamud.Interface.Windowing;
using QuickSwitch.Features;

namespace QuickSwitch.Windows;

public class MainWindow : Window, IDisposable
{
    private readonly CharacterTracker tracker;
    private readonly CharacterSwitcher switcher;
    private readonly WebSocketClient? wsClient;
    private readonly Configuration config;

    // Edit dialog state
    private bool showEditDialog;
    private int editIndex = -1; // -1 = adding new
    private string editName = string.Empty;
    private string editWorld = string.Empty;
    private int editSlot;
    private int editServiceAccount = 1;
    private string editNotes = string.Empty;

    // Status
    private string statusMessage = string.Empty;
    private DateTime statusTime;

    // Pairing
    private string pairingCodeInput = string.Empty;
    private string pairingStatus = string.Empty;

    // Delete confirmation
    private int pendingDeleteIndex = -1;

    // Switch confirmation
    private SavedCharacter? pendingSwitchTarget;
    private bool showSwitchConfirm;

    public MainWindow(
        CharacterTracker tracker,
        CharacterSwitcher switcher,
        WebSocketClient? wsClient,
        Configuration config)
        : base("QuickSwitch###QuickSwitchMain")
    {
        SizeConstraints = new WindowSizeConstraints
        {
            MinimumSize = new Vector2(420, 350),
            MaximumSize = new Vector2(600, 800),
        };

        this.tracker = tracker;
        this.switcher = switcher;
        this.wsClient = wsClient;
        this.config = config;

        switcher.OnStatusUpdate += msg => statusMessage = msg;
        switcher.OnSwitchComplete += (success, msg) => SetStatus(msg);
    }

    public void Dispose() { }

    public override void Draw()
    {
        DrawHeader();

        if (switcher.IsSwitching)
            DrawSwitchingStatus();

        ImGui.Separator();

        if (ImGui.BeginTabBar("QuickSwitchTabs"))
        {
            if (ImGui.BeginTabItem("Characters"))
            {
                DrawCharactersTab();
                ImGui.EndTabItem();
            }

            if (ImGui.BeginTabItem("Settings"))
            {
                DrawSettingsTab();
                ImGui.EndTabItem();
            }

            ImGui.EndTabBar();
        }

        if (showEditDialog)
            DrawEditDialog();

        if (showSwitchConfirm)
            DrawSwitchConfirmDialog();

        DrawStatusBar();
    }

    private void DrawHeader()
    {
        var player = Plugin.ObjectTable.LocalPlayer;
        if (player != null)
        {
            var name = player.Name.TextValue;
            var worldId = player.HomeWorld.RowId;
            var worldName = tracker.ResolveWorldName(worldId);
            ImGui.Text($"Current: {name} @ {worldName}");
        }
        else
        {
            ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1f), "Not logged in");
        }
    }

    private void DrawSwitchingStatus()
    {
        ImGui.Separator();
        ImGui.TextColored(new Vector4(1f, 1f, 0.3f, 1f), $"Switching: {statusMessage}");
        ImGui.SameLine();
        ImGui.PushStyleColor(ImGuiCol.Button, new Vector4(0.8f, 0.1f, 0.1f, 1f));
        if (ImGui.Button("Abort"))
            switcher.Abort();
        ImGui.PopStyleColor();
    }

    private void DrawCharactersTab()
    {
        var characters = config.Characters;

        if (characters.Count == 0)
        {
            ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1f),
                "No characters saved yet. Log into your characters and they'll be auto-detected.");
            ImGui.Spacing();
        }
        else
        {
            for (var i = 0; i < characters.Count; i++)
            {
                var ch = characters[i];
                var isCurrent = Plugin.ClientState.IsLoggedIn &&
                                Plugin.PlayerState.ContentId == ch.ContentId;

                ImGui.PushID(i);

                // Character name (bold if current)
                if (isCurrent)
                    ImGui.TextColored(new Vector4(0.3f, 1f, 0.3f, 1f), $"> {ch.Name}");
                else
                    ImGui.Text(ch.Name);

                ImGui.SameLine(220);
                ImGui.TextColored(new Vector4(0.7f, 0.7f, 0.7f, 1f), ch.HomeWorld);

                ImGui.SameLine(320);
                if (ch.CharacterSlot >= 0)
                    ImGui.Text($"Slot {ch.CharacterSlot + 1}");
                else
                    ImGui.TextColored(new Vector4(0.5f, 0.8f, 1f, 1f), "Auto");

                // Time since last login
                ImGui.SameLine(380);
                ImGui.TextColored(new Vector4(0.5f, 0.5f, 0.5f, 1f), FormatTimeSince(ch.LastLogin));

                // Action buttons
                var canSwitch = !switcher.IsSwitching && !isCurrent
                    && Plugin.ClientState.IsLoggedIn;

                // Show cooldown remaining if applicable
                var cooldown = switcher.GetCooldownRemaining();
                if (!canSwitch) ImGui.BeginDisabled();
                if (cooldown > 0 && !switcher.IsSwitching)
                {
                    if (ImGui.Button($"Switch ({cooldown}s)"))
                    { }
                }
                else if (ImGui.Button("Switch To"))
                {
                    if (config.RequireConfirmation)
                    {
                        pendingSwitchTarget = ch;
                        showSwitchConfirm = true;
                    }
                    else
                    {
                        switcher.SwitchToCharacter(ch);
                    }
                }
                if (!canSwitch) ImGui.EndDisabled();

                ImGui.SameLine();
                if (ImGui.Button("Edit"))
                {
                    editIndex = i;
                    editName = ch.Name;
                    editWorld = ch.HomeWorld;
                    editSlot = ch.CharacterSlot >= 0 ? ch.CharacterSlot + 1 : 0;
                    editServiceAccount = ch.ServiceAccountIndex + 1;
                    editNotes = ch.Notes;
                    showEditDialog = true;
                }

                ImGui.SameLine();
                if (pendingDeleteIndex == i)
                {
                    ImGui.TextColored(new Vector4(1f, 0.3f, 0.3f, 1f), "Confirm?");
                    ImGui.SameLine();
                    if (ImGui.Button("Yes"))
                    {
                        characters.RemoveAt(i);
                        config.Save();
                        pendingDeleteIndex = -1;
                        i--;
                    }
                    ImGui.SameLine();
                    if (ImGui.Button("No"))
                        pendingDeleteIndex = -1;
                }
                else
                {
                    if (ImGui.Button("Remove"))
                        pendingDeleteIndex = i;
                }

                ImGui.PopID();
                ImGui.Separator();
            }
        }

        ImGui.Spacing();

        if (ImGui.Button("+ Add Character Manually"))
        {
            editIndex = -1;
            editName = string.Empty;
            editWorld = string.Empty;
            editSlot = 0;
            editServiceAccount = 1;
            editNotes = string.Empty;
            showEditDialog = true;
        }

        ImGui.SameLine();

        var canLogout = Plugin.ClientState.IsLoggedIn && !switcher.IsSwitching
            && switcher.GetCooldownRemaining() == 0;
        if (!canLogout) ImGui.BeginDisabled();
        if (ImGui.Button("Quick Logout"))
        {
            if (config.RequireConfirmation)
            {
                pendingSwitchTarget = null;
                showSwitchConfirm = true;
            }
            else
            {
                switcher.InitiateLogout();
            }
        }
        if (!canLogout) ImGui.EndDisabled();
    }

    private void DrawSettingsTab()
    {
        ImGui.Spacing();

        var autoDetect = config.AutoDetectOnLogin;
        if (ImGui.Checkbox("Auto-detect characters on login", ref autoDetect))
        {
            config.AutoDetectOnLogin = autoDetect;
            config.Save();
        }

        var requireConfirm = config.RequireConfirmation;
        if (ImGui.Checkbox("Confirm before switching", ref requireConfirm))
        {
            config.RequireConfirmation = requireConfirm;
            config.Save();
        }

        var cooldown = config.SwitchCooldownSeconds;
        if (ImGui.SliderInt("Switch cooldown (seconds)", ref cooldown, 0, 120))
        {
            config.SwitchCooldownSeconds = cooldown;
            config.Save();
        }

        var timeout = config.StateTimeoutSeconds;
        if (ImGui.SliderInt("State timeout (seconds)", ref timeout, 10, 120))
        {
            config.StateTimeoutSeconds = timeout;
            config.Save();
        }

        ImGui.Spacing();
        ImGui.Separator();
        ImGui.Spacing();

        // Discord bot connection
        ImGui.Text("Discord Bot Connection");
        ImGui.Spacing();

        if (wsClient != null)
        {
            var statusColor = wsClient.IsConnected
                ? new Vector4(0.3f, 1f, 0.3f, 1f)
                : new Vector4(1f, 0.5f, 0.2f, 1f);
            ImGui.TextColored(statusColor, $"Status: {wsClient.ConnectionStatus}");

            ImGui.Spacing();

            var serverUrl = config.WebSocketServerUrl;
            if (ImGui.InputText("Server URL", ref serverUrl, 256))
            {
                config.WebSocketServerUrl = serverUrl;
                config.Save();
            }

            ImGui.Spacing();

            // Pairing
            ImGui.InputText("Pairing Code", ref pairingCodeInput, 32);
            ImGui.SameLine();
            if (ImGui.Button("Pair"))
            {
                var code = pairingCodeInput.Trim();
                if (!string.IsNullOrEmpty(code))
                {
                    pairingStatus = "Pairing...";
                    _ = DoPairAsync(code);
                }
            }

            if (!string.IsNullOrEmpty(pairingStatus))
                ImGui.Text(pairingStatus);

            ImGui.Spacing();

            if (wsClient.IsConnected)
            {
                if (ImGui.Button("Disconnect"))
                    _ = wsClient.DisconnectAsync();
            }
            else
            {
                if (ImGui.Button("Connect"))
                    _ = wsClient.ConnectAsync();
            }

            var autoConnect = config.AutoConnect;
            if (ImGui.Checkbox("Auto-connect on plugin load", ref autoConnect))
            {
                config.AutoConnect = autoConnect;
                config.Save();
            }
        }
        else
        {
            ImGui.TextColored(new Vector4(0.6f, 0.6f, 0.6f, 1f), "WebSocket client not initialized.");
        }

        ImGui.Spacing();
        ImGui.Separator();
        ImGui.Spacing();

        ImGui.TextWrapped("Character Slot: The position (1-8) of the character on your character select screen. " +
            "Slots are auto-detected when the character select screen loads. You can also set them manually via Edit.");
    }

    private async System.Threading.Tasks.Task DoPairAsync(string code)
    {
        if (wsClient == null) return;

        var token = await wsClient.PairAsync(code);
        if (token != null)
        {
            config.AuthToken = token;
            config.Save();
            pairingStatus = "Paired successfully!";
            _ = wsClient.ConnectAsync();
        }
        else
        {
            pairingStatus = "Pairing failed. Check code and try again.";
        }
    }

    private void DrawEditDialog()
    {
        ImGui.SetNextWindowSize(new Vector2(350, 250), ImGuiCond.FirstUseEver);
        var title = editIndex >= 0 ? "Edit Character" : "Add Character";
        var open = true;

        if (ImGui.Begin($"{title}###QuickSwitchEdit", ref open))
        {
            ImGui.InputText("Name", ref editName, 64);
            ImGui.InputText("Home World", ref editWorld, 32);
            ImGui.InputInt("Character Slot (1-8)", ref editSlot);
            if (editSlot < 0) editSlot = 0;
            if (editSlot > 8) editSlot = 8;
            ImGui.InputInt("Service Account", ref editServiceAccount);
            if (editServiceAccount < 1) editServiceAccount = 1;
            ImGui.InputText("Notes", ref editNotes, 128);

            ImGui.Spacing();

            if (ImGui.Button("Save"))
            {
                if (editIndex >= 0 && editIndex < config.Characters.Count)
                {
                    // Edit existing
                    var ch = config.Characters[editIndex];
                    ch.Name = editName;
                    ch.HomeWorld = editWorld;
                    ch.CharacterSlot = editSlot > 0 ? editSlot - 1 : -1;
                    ch.ServiceAccountIndex = editServiceAccount - 1;
                    ch.Notes = editNotes;
                }
                else
                {
                    // Add new
                    config.Characters.Add(new SavedCharacter
                    {
                        Name = editName,
                        HomeWorld = editWorld,
                        CharacterSlot = editSlot > 0 ? editSlot - 1 : -1,
                        ServiceAccountIndex = editServiceAccount - 1,
                        Notes = editNotes,
                    });
                }

                config.Save();
                showEditDialog = false;
                SetStatus(editIndex >= 0 ? "Character updated." : "Character added.");
            }

            ImGui.SameLine();
            if (ImGui.Button("Cancel"))
                showEditDialog = false;

            ImGui.End();
        }

        if (!open)
            showEditDialog = false;
    }

    private void DrawSwitchConfirmDialog()
    {
        var windowSize = new Vector2(300, 120);
        ImGui.SetNextWindowSize(windowSize, ImGuiCond.Always);

        // Center on screen
        var viewport = ImGui.GetMainViewport();
        var centerPos = new Vector2(
            viewport.Pos.X + (viewport.Size.X - windowSize.X) * 0.5f,
            viewport.Pos.Y + (viewport.Size.Y - windowSize.Y) * 0.5f);
        ImGui.SetNextWindowPos(centerPos, ImGuiCond.Always);
        ImGui.SetNextWindowFocus();

        var open = true;

        if (ImGui.Begin("Confirm###QuickSwitchConfirm", ref open, ImGuiWindowFlags.NoCollapse | ImGuiWindowFlags.NoMove))
        {
            if (pendingSwitchTarget != null)
                ImGui.Text($"Switch to {pendingSwitchTarget.Name} @ {pendingSwitchTarget.HomeWorld}?");
            else
                ImGui.Text("Log out to character select?");

            ImGui.Spacing();

            ImGui.PushStyleColor(ImGuiCol.Button, new Vector4(0.2f, 0.7f, 0.2f, 1f));
            if (ImGui.Button("Yes"))
            {
                if (pendingSwitchTarget != null)
                    switcher.SwitchToCharacter(pendingSwitchTarget);
                else
                    switcher.InitiateLogout();
                showSwitchConfirm = false;
                pendingSwitchTarget = null;
            }
            ImGui.PopStyleColor();

            ImGui.SameLine();

            if (ImGui.Button("Cancel"))
            {
                showSwitchConfirm = false;
                pendingSwitchTarget = null;
            }

            ImGui.End();
        }

        if (!open)
        {
            showSwitchConfirm = false;
            pendingSwitchTarget = null;
        }
    }

    private void DrawStatusBar()
    {
        if (!string.IsNullOrEmpty(statusMessage) && (DateTime.UtcNow - statusTime).TotalSeconds < 10)
        {
            ImGui.Separator();
            ImGui.TextColored(new Vector4(0.3f, 0.8f, 1f, 1f), statusMessage);
        }
    }

    private void SetStatus(string message)
    {
        statusMessage = message;
        statusTime = DateTime.UtcNow;
    }

    private static string FormatTimeSince(DateTime utcTime)
    {
        if (utcTime == default) return "";
        var elapsed = DateTime.UtcNow - utcTime;
        if (elapsed.TotalMinutes < 1) return "just now";
        if (elapsed.TotalHours < 1) return $"{(int)elapsed.TotalMinutes}m ago";
        if (elapsed.TotalDays < 1) return $"{(int)elapsed.TotalHours}h ago";
        if (elapsed.TotalDays < 30) return $"{(int)elapsed.TotalDays}d ago";
        return utcTime.ToString("yyyy-MM-dd");
    }
}
