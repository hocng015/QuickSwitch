using System;
using Dalamud.Game.ClientState.Conditions;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Client.System.String;
using FFXIVClientStructs.FFXIV.Client.UI;
using FFXIVClientStructs.FFXIV.Client.UI.Agent;
using FFXIVClientStructs.FFXIV.Component.GUI;

namespace QuickSwitch.Features;

public enum SwitchState
{
    Idle,
    InitiatingLogout,
    WaitingForLogoutDialog,
    ConfirmingLogout,
    WaitingForTitleScreen,
    ClickingStart,
    WaitingForCharSelect,
    SwitchingWorld,
    WaitingForWorldSwitch,
    SelectingCharacter,
    WaitingForLoginConfirm,
    ConfirmingLogin,
    WaitingForLogin,
    Done,
    Error,
}

/// <summary>
/// State machine that automates character switching:
/// logout -> title screen -> click start -> character select -> [switch world] -> select character -> confirm login.
/// </summary>
public class CharacterSwitcher : IDisposable
{
    private readonly IFramework framework;
    private readonly IGameGui gameGui;
    private readonly IClientState clientState;
    private readonly ICondition condition;
    private readonly IPluginLog log;
    private readonly IChatGui chatGui;
    private readonly Configuration config;

    private SwitchState state = SwitchState.Idle;
    private SavedCharacter? targetCharacter;
    private bool logoutOnly;
    private DateTime stateEnteredTime;
    private bool loginDetected;
    private bool worldSwitchAttempted;

    private const float ThrottleSeconds = 1.0f;
    private DateTime lastTickTime;
    private DateTime lastSwitchTime;

    public bool IsSwitching => state != SwitchState.Idle && state != SwitchState.Done && state != SwitchState.Error;
    public SwitchState CurrentState => state;
    public string StatusMessage { get; private set; } = string.Empty;

    public event Action<string>? OnStatusUpdate;
    public event Action<bool, string>? OnSwitchComplete;

    public CharacterSwitcher(
        IFramework framework,
        IGameGui gameGui,
        IClientState clientState,
        ICondition condition,
        IPluginLog log,
        IChatGui chatGui,
        Configuration config)
    {
        this.framework = framework;
        this.gameGui = gameGui;
        this.clientState = clientState;
        this.condition = condition;
        this.log = log;
        this.chatGui = chatGui;
        this.config = config;
    }

    /// <summary>
    /// Initiate a full character switch: logout, select character, login.
    /// </summary>
    public bool SwitchToCharacter(SavedCharacter target)
    {
        if (IsSwitching)
        {
            chatGui.Print("[QuickSwitch] Already switching. Use /qs abort to cancel.");
            return false;
        }

        if (!clientState.IsLoggedIn)
        {
            chatGui.Print("[QuickSwitch] Not logged in.");
            return false;
        }

        var guardResult = CheckSafetyGuards();
        if (guardResult != null)
        {
            chatGui.Print($"[QuickSwitch] {guardResult}");
            return false;
        }

        targetCharacter = target;
        logoutOnly = false;
        loginDetected = false;
        worldSwitchAttempted = false;
        lastSwitchTime = DateTime.UtcNow;
        clientState.Login += OnLoginDetected;

        SetState(SwitchState.InitiatingLogout);
        framework.Update += OnFrameworkUpdate;

        chatGui.Print($"[QuickSwitch] Switching to {target.Name} @ {target.HomeWorld}...");
        return true;
    }

    /// <summary>
    /// Quick logout to character select screen.
    /// Note: FFXIV always goes to title screen first, so we automate clicking Start
    /// to reach the character select screen.
    /// </summary>
    public bool InitiateLogout()
    {
        if (IsSwitching)
        {
            chatGui.Print("[QuickSwitch] Already switching. Use /qs abort to cancel.");
            return false;
        }

        if (!clientState.IsLoggedIn)
        {
            chatGui.Print("[QuickSwitch] Not logged in.");
            return false;
        }

        var guardResult = CheckSafetyGuards();
        if (guardResult != null)
        {
            chatGui.Print($"[QuickSwitch] {guardResult}");
            return false;
        }

        targetCharacter = null;
        logoutOnly = true;
        loginDetected = false;
        worldSwitchAttempted = false;
        lastSwitchTime = DateTime.UtcNow;

        SetState(SwitchState.InitiatingLogout);
        framework.Update += OnFrameworkUpdate;

        chatGui.Print("[QuickSwitch] Logging out to character select...");
        return true;
    }

    /// <summary>
    /// Get the remaining cooldown in seconds, or 0 if ready.
    /// </summary>
    public int GetCooldownRemaining()
    {
        if (lastSwitchTime == default) return 0;
        var elapsed = (DateTime.UtcNow - lastSwitchTime).TotalSeconds;
        var remaining = config.SwitchCooldownSeconds - elapsed;
        return remaining > 0 ? (int)Math.Ceiling(remaining) : 0;
    }

    /// <summary>
    /// Check all safety conditions. Returns null if safe, or a reason string if blocked.
    /// </summary>
    private string? CheckSafetyGuards()
    {
        // Duty check
        if (condition[ConditionFlag.BoundByDuty] || condition[ConditionFlag.BoundByDuty56] || condition[ConditionFlag.BoundByDuty95])
            return "Cannot switch while in a duty. Leave the duty first.";

        // Combat check
        if (condition[ConditionFlag.InCombat])
            return "Cannot switch while in combat.";

        // Cutscene check
        if (condition[ConditionFlag.WatchingCutscene] || condition[ConditionFlag.WatchingCutscene78] || condition[ConditionFlag.OccupiedInCutSceneEvent])
            return "Cannot switch during a cutscene.";

        // Crafting check
        if (condition[ConditionFlag.Crafting] || condition[ConditionFlag.ExecutingCraftingAction] || condition[ConditionFlag.PreparingToCraft])
            return "Cannot switch while crafting.";

        // Gathering check
        if (condition[ConditionFlag.Gathering] || condition[ConditionFlag.ExecutingGatheringAction] || condition[ConditionFlag.Fishing])
            return "Cannot switch while gathering.";

        // Performing (bard performance) check
        if (condition[ConditionFlag.Performing])
            return "Cannot switch while performing.";

        // Occupied / casting / between areas
        if (IsOccupied())
            return "Cannot switch right now. Wait until you're idle.";

        // Cooldown check
        var cooldownRemaining = GetCooldownRemaining();
        if (cooldownRemaining > 0)
            return $"Switch on cooldown. Try again in {cooldownRemaining}s.";

        return null;
    }

    /// <summary>
    /// Abort the current switch operation.
    /// </summary>
    public void Abort()
    {
        if (!IsSwitching) return;

        framework.Update -= OnFrameworkUpdate;
        clientState.Login -= OnLoginDetected;
        state = SwitchState.Idle;
        UpdateStatus("Switch cancelled.");
        OnSwitchComplete?.Invoke(false, "Cancelled by user.");
        chatGui.Print("[QuickSwitch] Switch aborted.");
        log.Info("[QuickSwitch] Switch aborted by user.");
    }

    private void OnLoginDetected()
    {
        loginDetected = true;
    }

    private void OnFrameworkUpdate(IFramework fw)
    {
        if (state == SwitchState.Idle || state == SwitchState.Done || state == SwitchState.Error)
            return;

        // Throttle ticks
        if ((DateTime.UtcNow - lastTickTime).TotalSeconds < ThrottleSeconds)
            return;
        lastTickTime = DateTime.UtcNow;

        // Check timeout
        var elapsed = (DateTime.UtcNow - stateEnteredTime).TotalSeconds;
        var timeout = GetTimeoutForState(state);
        if (elapsed > timeout)
        {
            Fail($"Timed out in state {state} after {timeout}s.");
            return;
        }

        try
        {
            switch (state)
            {
                case SwitchState.InitiatingLogout:
                    HandleInitiatingLogout();
                    break;
                case SwitchState.WaitingForLogoutDialog:
                    HandleWaitingForLogoutDialog();
                    break;
                case SwitchState.ConfirmingLogout:
                    HandleConfirmingLogout();
                    break;
                case SwitchState.WaitingForTitleScreen:
                    HandleWaitingForTitleScreen();
                    break;
                case SwitchState.ClickingStart:
                    HandleClickingStart();
                    break;
                case SwitchState.WaitingForCharSelect:
                    HandleWaitingForCharSelect();
                    break;
                case SwitchState.SwitchingWorld:
                    HandleSwitchingWorld();
                    break;
                case SwitchState.WaitingForWorldSwitch:
                    HandleWaitingForWorldSwitch();
                    break;
                case SwitchState.SelectingCharacter:
                    HandleSelectingCharacter();
                    break;
                case SwitchState.WaitingForLoginConfirm:
                    HandleWaitingForLoginConfirm();
                    break;
                case SwitchState.ConfirmingLogin:
                    HandleConfirmingLogin();
                    break;
                case SwitchState.WaitingForLogin:
                    HandleWaitingForLogin();
                    break;
            }
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Error in state {state}: {ex.Message}");
            Fail($"Exception in state {state}: {ex.Message}");
        }
    }

    private void HandleInitiatingLogout()
    {
        if (IsOccupied())
        {
            UpdateStatus("Waiting for player to be ready...");
            return;
        }

        // Send /logout via the game's native chat processor
        unsafe
        {
            SendChatCommand("/logout");
        }

        SetState(SwitchState.WaitingForLogoutDialog);
        UpdateStatus("Issued /logout, waiting for confirmation dialog...");
    }

    private void HandleWaitingForLogoutDialog()
    {
        unsafe
        {
            var addon = GetAddon("SelectYesno");
            if (addon != null)
            {
                SetState(SwitchState.ConfirmingLogout);
                UpdateStatus("Logout dialog appeared. Confirming...");
            }
        }
    }

    private void HandleConfirmingLogout()
    {
        unsafe
        {
            var addon = GetAddon("SelectYesno");
            if (addon == null) return;

            var values = stackalloc AtkValue[1];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 0; // Yes
            addon->FireCallback(1, values);

            // /logout always goes to the title screen first
            SetState(SwitchState.WaitingForTitleScreen);
            UpdateStatus("Confirmed logout. Waiting for title screen...");
        }
    }

    private void HandleWaitingForTitleScreen()
    {
        unsafe
        {
            var addon = GetAddon("_TitleMenu");
            if (addon != null)
            {
                SetState(SwitchState.ClickingStart);
                UpdateStatus("Title screen loaded. Clicking Start...");
            }
        }
    }

    private void HandleClickingStart()
    {
        unsafe
        {
            var addon = GetAddon("_TitleMenu");
            if (addon == null) return;

            // FireCallback with value 4 clicks "Start" on the title menu
            var values = stackalloc AtkValue[1];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 4;
            addon->FireCallback(1, values, true);

            SetState(SwitchState.WaitingForCharSelect);
            UpdateStatus("Clicked Start. Waiting for character select...");
        }
    }

    private void HandleWaitingForCharSelect()
    {
        unsafe
        {
            var addon = GetAddon("_CharaSelectListMenu");
            if (addon != null)
            {
                // Auto-detect character slots from AgentLobby (for the currently displayed world)
                ScanAndUpdateCharacterSlots();

                if (logoutOnly)
                {
                    Complete("Reached character select screen.");
                }
                else
                {
                    // Check if the target character is on the currently displayed world
                    var slotIndex = FindCharacterIndexInLobby(targetCharacter!.ContentId);
                    if (slotIndex >= 0)
                    {
                        // Target is on the current world, go straight to selecting
                        SetState(SwitchState.SelectingCharacter);
                        UpdateStatus("Character select loaded. Selecting character...");
                    }
                    else
                    {
                        // Target not on current world, need to switch worlds
                        SetState(SwitchState.SwitchingWorld);
                        UpdateStatus($"Character not on current world. Switching to {targetCharacter.HomeWorld}...");
                    }
                }
            }
        }
    }

    private void HandleSwitchingWorld()
    {
        if (targetCharacter == null)
        {
            Fail("No target character set.");
            return;
        }

        if (worldSwitchAttempted)
        {
            Fail($"Already tried switching worlds but character '{targetCharacter.Name}' still not found on {targetCharacter.HomeWorld}.");
            return;
        }

        unsafe
        {
            var worldAddon = GetAddon("_CharaSelectWorldServer");
            if (worldAddon == null)
            {
                // World server addon might not be visible yet, wait
                UpdateStatus($"Waiting for world list to load...");
                return;
            }

            // Find the target world in the world list and click it
            var worldIndex = FindWorldIndexInAddon(targetCharacter.HomeWorld);
            if (worldIndex < 0)
            {
                Fail($"World '{targetCharacter.HomeWorld}' not found in the world list. Is it in a different data center?");
                return;
            }

            log.Info($"[QuickSwitch] Selecting world {targetCharacter.HomeWorld} at index {worldIndex}");

            // Fire callback (25, 0, index) on _CharaSelectWorldServer to select the world
            var values = stackalloc AtkValue[3];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 25;
            values[1].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[1].Int = 0;
            values[2].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[2].Int = worldIndex;
            worldAddon->FireCallback(3, values);

            worldSwitchAttempted = true;
            SetState(SwitchState.WaitingForWorldSwitch);
            UpdateStatus($"Switched to {targetCharacter.HomeWorld}. Waiting for character list to update...");
        }
    }

    private void HandleWaitingForWorldSwitch()
    {
        if (targetCharacter == null)
        {
            Fail("No target character set.");
            return;
        }

        unsafe
        {
            // Wait for CharaSelectEntries to be repopulated with the target character
            var slotIndex = FindCharacterIndexInLobby(targetCharacter.ContentId);
            if (slotIndex >= 0)
            {
                // Found the target on the new world! Scan and update slots, then select
                ScanAndUpdateCharacterSlots();
                SetState(SwitchState.SelectingCharacter);
                UpdateStatus($"Found {targetCharacter.Name} on {targetCharacter.HomeWorld}. Selecting...");
            }
            // Otherwise keep waiting (throttled by the 1s tick)
        }
    }

    private void HandleSelectingCharacter()
    {
        if (targetCharacter == null)
        {
            Fail("No target character set.");
            return;
        }

        unsafe
        {
            var addon = GetAddon("_CharaSelectListMenu");
            if (addon == null) return;

            // Find the target character's index in the live AgentLobby entries by ContentId
            var slotIndex = FindCharacterIndexInLobby(targetCharacter.ContentId);
            if (slotIndex < 0)
            {
                Fail($"Character '{targetCharacter.Name}' not found on character select screen.");
                return;
            }

            // FireCallback with command 29 to select a character by slot index
            var values = stackalloc AtkValue[3];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 29;
            values[1].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[1].Int = 0;
            values[2].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[2].Int = slotIndex;
            addon->FireCallback(3, values);

            SetState(SwitchState.WaitingForLoginConfirm);
            UpdateStatus($"Selected {targetCharacter.Name} (slot {slotIndex + 1}). Waiting for login confirmation...");
        }
    }

    private void HandleWaitingForLoginConfirm()
    {
        // Check if login already fired (dialog might be skipped)
        if (loginDetected)
        {
            Complete($"Logged in as {targetCharacter?.Name ?? "character"}!");
            return;
        }

        unsafe
        {
            var addon = GetAddon("SelectYesno");
            if (addon != null)
            {
                SetState(SwitchState.ConfirmingLogin);
                UpdateStatus("Login confirmation dialog appeared. Confirming...");
            }
        }
    }

    private void HandleConfirmingLogin()
    {
        unsafe
        {
            var addon = GetAddon("SelectYesno");
            if (addon == null) return;

            var values = stackalloc AtkValue[1];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 0; // Yes
            addon->FireCallback(1, values);

            SetState(SwitchState.WaitingForLogin);
            UpdateStatus("Confirmed login. Loading character...");
        }
    }

    private void HandleWaitingForLogin()
    {
        if (loginDetected)
        {
            Complete($"Switched to {targetCharacter?.Name ?? "character"}!");
        }
    }

    /// <summary>
    /// Scan the character select screen via AgentLobby and update stored slot indices
    /// for all known characters on the currently displayed world.
    /// </summary>
    private unsafe void ScanAndUpdateCharacterSlots()
    {
        try
        {
            var agent = AgentLobby.Instance();
            if (agent == null)
            {
                log.Warning("[QuickSwitch] AgentLobby is null, cannot scan character slots.");
                return;
            }

            var entries = agent->LobbyData.CharaSelectEntries;
            if (entries.Count == 0)
            {
                log.Warning("[QuickSwitch] No character entries in AgentLobby.");
                return;
            }

            var updated = 0;
            for (var i = 0; i < (int)entries.Count; i++)
            {
                var entryPtr = entries[i];
                if (entryPtr.Value == null) continue;

                var entry = entryPtr.Value;
                var contentId = entry->ContentId;
                if (contentId == 0) continue;

                var saved = config.FindCharacterByContentId(contentId);
                if (saved != null && saved.CharacterSlot != i)
                {
                    var oldSlot = saved.CharacterSlot;
                    saved.CharacterSlot = i;
                    updated++;
                    log.Info($"[QuickSwitch] Auto-detected slot for {saved.Name}: {(oldSlot >= 0 ? $"slot {oldSlot + 1}" : "No slot")} -> slot {i + 1}");
                }
            }

            if (updated > 0)
            {
                config.Save();
                log.Info($"[QuickSwitch] Updated {updated} character slot(s) from lobby data.");
            }
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Error scanning character slots: {ex.Message}");
        }
    }

    /// <summary>
    /// Find a character's index in the live AgentLobby entries by ContentId.
    /// Returns the 0-based index, or -1 if not found.
    /// </summary>
    private unsafe int FindCharacterIndexInLobby(ulong contentId)
    {
        try
        {
            var agent = AgentLobby.Instance();
            if (agent == null) return -1;

            var entries = agent->LobbyData.CharaSelectEntries;
            for (var i = 0; i < (int)entries.Count; i++)
            {
                var entryPtr = entries[i];
                if (entryPtr.Value == null) continue;
                if (entryPtr.Value->ContentId == contentId)
                    return i;
            }
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Error finding character in lobby: {ex.Message}");
        }

        return -1;
    }

    /// <summary>
    /// Find a world's index in the _CharaSelectWorldServer addon's world list.
    /// The world list is read from the StringArrayData at index 1 in AtkArrayDataHolder.
    /// Returns the 0-based index, or -1 if not found.
    /// </summary>
    private unsafe int FindWorldIndexInAddon(string worldName)
    {
        try
        {
            var raptureModule = RaptureAtkModule.Instance();
            if (raptureModule == null) return -1;

            var stringArrayData = raptureModule->AtkArrayDataHolder.StringArrays[1];
            if (stringArrayData == null) return -1;

            // The string array contains world names; iterate to find the target
            for (var i = 0; i < stringArrayData->Size; i++)
            {
                var str = stringArrayData->StringArray[i].ToString();
                if (string.IsNullOrEmpty(str)) continue;

                if (str.Equals(worldName, StringComparison.OrdinalIgnoreCase))
                {
                    log.Info($"[QuickSwitch] Found world '{worldName}' at index {i}");
                    return i;
                }
            }

            log.Warning($"[QuickSwitch] World '{worldName}' not found in world list.");
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Error finding world index: {ex.Message}");
        }

        return -1;
    }

    /// <summary>
    /// Send a chat command to the game's native chat processor.
    /// This works for game-native commands like /logout, /return, etc.
    /// </summary>
    private unsafe void SendChatCommand(string command)
    {
        var uiModule = UIModule.Instance();
        if (uiModule == null)
        {
            log.Error("[QuickSwitch] UIModule is null, cannot send chat command.");
            return;
        }

        var utf8Str = Utf8String.FromString(command);
        if (utf8Str == null)
        {
            log.Error("[QuickSwitch] Failed to create Utf8String for chat command.");
            return;
        }

        try
        {
            uiModule->ProcessChatBoxEntry(utf8Str);
            log.Info($"[QuickSwitch] Sent chat command: {command}");
        }
        finally
        {
            utf8Str->Dtor(true);
        }
    }

    private void SetState(SwitchState newState)
    {
        log.Info($"[QuickSwitch] State: {state} -> {newState}");
        state = newState;
        stateEnteredTime = DateTime.UtcNow;
    }

    private void UpdateStatus(string message)
    {
        StatusMessage = message;
        OnStatusUpdate?.Invoke(message);
    }

    private void Complete(string message)
    {
        framework.Update -= OnFrameworkUpdate;
        clientState.Login -= OnLoginDetected;
        state = SwitchState.Done;
        UpdateStatus(message);
        OnSwitchComplete?.Invoke(true, message);
        chatGui.Print($"[QuickSwitch] {message}");
        log.Info($"[QuickSwitch] {message}");
    }

    private void Fail(string reason)
    {
        framework.Update -= OnFrameworkUpdate;
        clientState.Login -= OnLoginDetected;
        state = SwitchState.Error;
        UpdateStatus($"Failed: {reason}");
        OnSwitchComplete?.Invoke(false, reason);
        chatGui.Print($"[QuickSwitch] Switch failed: {reason}");
        log.Error($"[QuickSwitch] Switch failed: {reason}");
    }

    private unsafe AtkUnitBase* GetAddon(string name)
    {
        var addonPtr = gameGui.GetAddonByName(name);
        if (addonPtr.Address == nint.Zero) return null;

        var addon = (AtkUnitBase*)addonPtr.Address;
        if (!addon->IsVisible) return null;

        return addon;
    }

    private bool IsOccupied()
    {
        return condition[ConditionFlag.Occupied]
            || condition[ConditionFlag.Occupied30]
            || condition[ConditionFlag.Occupied33]
            || condition[ConditionFlag.Occupied38]
            || condition[ConditionFlag.Occupied39]
            || condition[ConditionFlag.Casting]
            || condition[ConditionFlag.BetweenAreas]
            || condition[ConditionFlag.BetweenAreas51];
    }

    private double GetTimeoutForState(SwitchState s) => s switch
    {
        SwitchState.InitiatingLogout => 5,
        SwitchState.WaitingForLogoutDialog => 10,
        SwitchState.ConfirmingLogout => 5,
        SwitchState.WaitingForTitleScreen => 30,
        SwitchState.ClickingStart => 10,
        SwitchState.WaitingForCharSelect => config.StateTimeoutSeconds,
        SwitchState.SwitchingWorld => 10,
        SwitchState.WaitingForWorldSwitch => 15,
        SwitchState.SelectingCharacter => 10,
        SwitchState.WaitingForLoginConfirm => 15,
        SwitchState.ConfirmingLogin => 5,
        SwitchState.WaitingForLogin => 60,
        _ => config.StateTimeoutSeconds,
    };

    public void Dispose()
    {
        if (IsSwitching)
        {
            framework.Update -= OnFrameworkUpdate;
            clientState.Login -= OnLoginDetected;
            state = SwitchState.Idle;
        }
    }
}
