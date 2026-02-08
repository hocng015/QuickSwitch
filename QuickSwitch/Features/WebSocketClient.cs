using System;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Dalamud.Plugin.Services;

namespace QuickSwitch.Features;

/// <summary>
/// WebSocket client that connects to the Railway-hosted Discord bot server.
/// Handles authentication, reconnection, heartbeat, and message routing.
/// </summary>
public class WebSocketClient : IDisposable
{
    private readonly IPluginLog log;
    private readonly IFramework framework;
    private readonly Configuration config;

    private ClientWebSocket? ws;
    private CancellationTokenSource? cts;
    private Task? receiveTask;
    private Task? heartbeatTask;
    private bool disposed;
    private int reconnectDelay = 1000;

    public bool IsConnected => ws?.State == WebSocketState.Open;
    public string ConnectionStatus { get; private set; } = "Disconnected";

    /// <summary>Raised when a command message is received from the server.</summary>
    public event Action<string, JsonElement>? OnCommandReceived;

    /// <summary>Raised when connection state changes.</summary>
    public event Action<bool>? OnConnectionChanged;

    public WebSocketClient(IPluginLog log, IFramework framework, Configuration config)
    {
        this.log = log;
        this.framework = framework;
        this.config = config;
    }

    public async Task ConnectAsync()
    {
        if (string.IsNullOrEmpty(config.WebSocketServerUrl))
        {
            ConnectionStatus = "No server URL configured";
            return;
        }

        if (string.IsNullOrEmpty(config.AuthToken))
        {
            ConnectionStatus = "Not paired (no auth token)";
            return;
        }

        await DisconnectAsync();

        cts = new CancellationTokenSource();
        ws = new ClientWebSocket();

        try
        {
            var serverUrl = config.WebSocketServerUrl.TrimEnd('/');
            if (serverUrl.StartsWith("http://"))
                serverUrl = "ws://" + serverUrl[7..];
            else if (serverUrl.StartsWith("https://"))
                serverUrl = "wss://" + serverUrl[8..];
            else if (!serverUrl.StartsWith("ws://") && !serverUrl.StartsWith("wss://"))
                serverUrl = "wss://" + serverUrl;

            var uri = new Uri($"{serverUrl}?token={config.AuthToken}&plugin=quickswitch");

            ConnectionStatus = "Connecting...";
            log.Info($"[QuickSwitch] Connecting to {serverUrl}...");

            await ws.ConnectAsync(uri, cts.Token);

            ConnectionStatus = "Connected";
            reconnectDelay = 1000;
            log.Info("[QuickSwitch] WebSocket connected.");
            OnConnectionChanged?.Invoke(true);

            receiveTask = Task.Run(() => ReceiveLoop(cts.Token));
            heartbeatTask = Task.Run(() => HeartbeatLoop(cts.Token));
        }
        catch (Exception ex)
        {
            ConnectionStatus = $"Connection failed: {ex.Message}";
            log.Error($"[QuickSwitch] WebSocket connection failed: {ex.Message}");
            OnConnectionChanged?.Invoke(false);

            _ = Task.Run(() => ReconnectLoop());
        }
    }

    public async Task DisconnectAsync()
    {
        cts?.Cancel();

        if (ws != null && ws.State == WebSocketState.Open)
        {
            try
            {
                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disconnecting", CancellationToken.None);
            }
            catch { }
        }

        ws?.Dispose();
        ws = null;

        ConnectionStatus = "Disconnected";
        OnConnectionChanged?.Invoke(false);
    }

    public async Task<string?> PairAsync(string pairingCode)
    {
        if (string.IsNullOrEmpty(config.WebSocketServerUrl))
        {
            log.Error("[QuickSwitch] Cannot pair: no server URL configured.");
            return null;
        }

        using var pairWs = new ClientWebSocket();
        using var pairCts = new CancellationTokenSource(TimeSpan.FromSeconds(10));

        try
        {
            var serverUrl = config.WebSocketServerUrl.TrimEnd('/');
            if (serverUrl.StartsWith("http://"))
                serverUrl = "ws://" + serverUrl[7..];
            else if (serverUrl.StartsWith("https://"))
                serverUrl = "wss://" + serverUrl[8..];
            else if (!serverUrl.StartsWith("ws://") && !serverUrl.StartsWith("wss://"))
                serverUrl = "wss://" + serverUrl;

            var uri = new Uri($"{serverUrl}?pair={pairingCode}");
            await pairWs.ConnectAsync(uri, pairCts.Token);

            var buffer = new byte[4096];
            var result = await pairWs.ReceiveAsync(new ArraySegment<byte>(buffer), pairCts.Token);
            var message = Encoding.UTF8.GetString(buffer, 0, result.Count);

            var json = JsonDocument.Parse(message);
            var root = json.RootElement;

            if (root.GetProperty("type").GetString() == "auth_result")
            {
                var payload = root.GetProperty("payload");
                if (payload.GetProperty("success").GetBoolean())
                {
                    var token = payload.GetProperty("token").GetString();
                    log.Info("[QuickSwitch] Pairing successful.");
                    return token;
                }
                else
                {
                    var error = payload.GetProperty("error").GetString();
                    log.Warning($"[QuickSwitch] Pairing failed: {error}");
                }
            }
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Pairing error: {ex.Message}");
        }

        return null;
    }

    public async Task SendAsync(string type, object? payload = null, string? requestId = null)
    {
        if (ws == null || ws.State != WebSocketState.Open) return;

        try
        {
            var msg = new { type, payload, requestId };
            var json = JsonSerializer.Serialize(msg);
            var bytes = Encoding.UTF8.GetBytes(json);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true,
                cts?.Token ?? CancellationToken.None);
        }
        catch (Exception ex)
        {
            log.Error($"[QuickSwitch] Failed to send message: {ex.Message}");
        }
    }

    public async Task SendCommandResultAsync(string requestId, bool success, string message, object? data = null)
    {
        await SendAsync("command_result", new { success, message, data }, requestId);
    }

    public async Task SendStatusUpdateAsync(object status)
    {
        await SendAsync("status_update", status);
    }

    private async Task ReceiveLoop(CancellationToken ct)
    {
        var buffer = new byte[8192];

        while (!ct.IsCancellationRequested && ws?.State == WebSocketState.Open)
        {
            try
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    log.Info("[QuickSwitch] Server closed connection.");
                    break;
                }

                var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                HandleMessage(message);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (WebSocketException ex)
            {
                log.Warning($"[QuickSwitch] WebSocket error: {ex.Message}");
                break;
            }
            catch (Exception ex)
            {
                log.Error($"[QuickSwitch] Receive error: {ex.Message}");
                break;
            }
        }

        if (!ct.IsCancellationRequested && !disposed)
        {
            ConnectionStatus = "Disconnected (reconnecting...)";
            OnConnectionChanged?.Invoke(false);
            _ = Task.Run(() => ReconnectLoop());
        }
    }

    private async Task HeartbeatLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(20_000, ct);

                if (ws?.State == WebSocketState.Open)
                    await SendAsync("ping", new { timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds() });
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                log.Warning($"[QuickSwitch] Heartbeat error: {ex.Message}");
            }
        }
    }

    private async Task ReconnectLoop()
    {
        while (!disposed)
        {
            try
            {
                ConnectionStatus = $"Reconnecting in {reconnectDelay / 1000}s...";
                await Task.Delay(reconnectDelay);

                if (disposed) break;

                reconnectDelay = Math.Min(reconnectDelay * 2, 30_000);

                await ConnectAsync();

                if (IsConnected)
                    break;
            }
            catch (Exception ex)
            {
                log.Warning($"[QuickSwitch] Reconnect failed: {ex.Message}");
            }
        }
    }

    private void HandleMessage(string raw)
    {
        try
        {
            var json = JsonDocument.Parse(raw);
            var root = json.RootElement;
            var type = root.GetProperty("type").GetString();

            switch (type)
            {
                case "pong":
                    break;

                case "connected":
                    log.Info("[QuickSwitch] Server acknowledged connection.");
                    break;

                case "command":
                    var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() : null;
                    var payload = root.GetProperty("payload");

                    framework.RunOnFrameworkThread(() =>
                    {
                        OnCommandReceived?.Invoke(requestId ?? string.Empty, payload);
                    });
                    break;

                default:
                    log.Debug($"[QuickSwitch] Unknown message type: {type}");
                    break;
            }
        }
        catch (Exception ex)
        {
            log.Warning($"[QuickSwitch] Failed to parse message: {ex.Message}");
        }
    }

    public void Dispose()
    {
        disposed = true;
        cts?.Cancel();

        try
        {
            ws?.Dispose();
        }
        catch { }

        ConnectionStatus = "Disposed";
    }
}
