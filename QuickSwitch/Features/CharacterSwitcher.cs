using System;
using Dalamud.Game.ClientState.Conditions;
using Dalamud.Plugin.Services;
using FFXIVClientStructs.FFXIV.Component.GUI;

namespace QuickSwitch.Features;

public enum SwitchState
{
    Idle,
    InitiatingLogout,
    WaitingForLogoutDialog,
    ConfirmingLogout,
    WaitingForCharSelect,
    SelectingCharacter,
    WaitingForLoginConfirm,
    ConfirmingLogin,
    WaitingForLogin,
    Done,
    Error,
}

/// <summary>
/// State machine that automates character switching:
/// logout -> character select -> select character -> confirm login.
/// </summary>
public class CharacterSwitcher : IDisposable
{
    private readonly IFramework framework;
    private readonly IGameGui gameGui;
    private readonly IClientState clientState;
    private readonly ICommandManager commandManager;
    private readonly ICondition condition;
    private readonly IPluginLog log;
    private readonly IChatGui chatGui;
    private readonly Configuration config;

    private SwitchState state = SwitchState.Idle;
    private SavedCharacter? targetCharacter;
    private bool logoutOnly;
    private DateTime stateEnteredTime;
    private bool loginDetected;

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
        ICommandManager commandManager,
        ICondition condition,
        IPluginLog log,
        IChatGui chatGui,
        Configuration config)
    {
        this.framework = framework;
        this.gameGui = gameGui;
        this.clientState = clientState;
        this.commandManager = commandManager;
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

        if (target.CharacterSlot < 0)
        {
            chatGui.Print($"[QuickSwitch] Character slot not set for {target.Name}. Please configure it in the QuickSwitch settings.");
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
        lastSwitchTime = DateTime.UtcNow;
        clientState.Login += OnLoginDetected;

        SetState(SwitchState.InitiatingLogout);
        framework.Update += OnFrameworkUpdate;

        chatGui.Print($"[QuickSwitch] Switching to {target.Name} @ {target.HomeWorld}...");
        return true;
    }

    /// <summary>
    /// Quick logout to character select screen (no auto-login).
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
                case SwitchState.WaitingForCharSelect:
                    HandleWaitingForCharSelect();
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

        commandManager.ProcessCommand("/logout");
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

            if (logoutOnly)
            {
                Complete("Logged out to character select.");
            }
            else
            {
                SetState(SwitchState.WaitingForCharSelect);
                UpdateStatus("Confirmed logout. Waiting for character select...");
            }
        }
    }

    private void HandleWaitingForCharSelect()
    {
        unsafe
        {
            var addon = GetAddon("_CharaSelectListMenu");
            if (addon != null)
            {
                SetState(SwitchState.SelectingCharacter);
                UpdateStatus("Character select loaded. Selecting character...");
            }
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

            // FireCallback with command 29 to select a character by slot index
            var values = stackalloc AtkValue[3];
            values[0].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[0].Int = 29;
            values[1].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[1].Int = 0;
            values[2].Type = FFXIVClientStructs.FFXIV.Component.GUI.ValueType.Int;
            values[2].Int = targetCharacter.CharacterSlot;
            addon->FireCallback(3, values);

            SetState(SwitchState.WaitingForLoginConfirm);
            UpdateStatus($"Selected slot {targetCharacter.CharacterSlot + 1}. Waiting for login confirmation...");
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
        SwitchState.WaitingForCharSelect => config.StateTimeoutSeconds,
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
