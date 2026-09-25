using System.Collections.Concurrent;
using System.Text.Json;
using StackExchange.Redis;

namespace FindMe.Api;

public interface IFriendSessionStore
{
    Task<FriendSession> CreateAsync(string deviceId, string displayName);
    Task<JoinSessionResult> TryJoinAsync(string code, string deviceId, string displayName);
    Task<FriendSession?> GetAsync(string code);
    Task<bool> UpdateLocationAsync(string code, string deviceId, double latitude, double longitude);
    Task<LeaveSessionResult> LeaveAsync(string code, string deviceId);
}

public record JoinSessionResult(bool Success, FriendSession? Session, string? Error);
public record LeaveSessionResult(bool SessionExisted, bool WasHost, FriendSession? RemainingSession);

public class InMemoryFriendSessionStore : IFriendSessionStore
{
    public const int MaxParticipants = 10;
    private readonly ConcurrentDictionary<string, FriendSession> _sessions = new();
    private static readonly char[] CodeChars = "0123456789".ToCharArray();

    public Task<FriendSession> CreateAsync(string deviceId, string displayName)
    {
        while (true)
        {
            var code = GenerateCode();
            var session = FriendSession.Create(code, deviceId, displayName);
            if (_sessions.TryAdd(code, session))
                return Task.FromResult(session);
        }
    }

    public Task<JoinSessionResult> TryJoinAsync(string code, string deviceId, string displayName)
    {
        if (!_sessions.TryGetValue(code, out var session))
            return Task.FromResult(new JoinSessionResult(false, null, "Session not found."));

        lock (session.SyncRoot)
        {
            if (session.Participants.ContainsKey(deviceId))
                return Task.FromResult(new JoinSessionResult(true, session, null));

            if (session.Participants.Count >= MaxParticipants)
                return Task.FromResult(new JoinSessionResult(false, null, $"This session already has {MaxParticipants} people."));

            session.Participants[deviceId] = FriendParticipant.Create(deviceId, displayName, session.Participants.Count + 1);
        }

        return Task.FromResult(new JoinSessionResult(true, session, null));
    }

    public Task<FriendSession?> GetAsync(string code)
    {
        _sessions.TryGetValue(code, out var session);
        return Task.FromResult(session);
    }

    public Task<bool> UpdateLocationAsync(string code, string deviceId, double latitude, double longitude)
    {
        if (!_sessions.TryGetValue(code, out var session) || !session.Participants.TryGetValue(deviceId, out var participant))
            return Task.FromResult(false);

        participant.Latitude = latitude;
        participant.Longitude = longitude;
        participant.LocationUpdatedAtUtc = DateTime.UtcNow;
        return Task.FromResult(true);
    }

    public Task<LeaveSessionResult> LeaveAsync(string code, string deviceId)
    {
        if (!_sessions.TryGetValue(code, out var session))
            return Task.FromResult(new LeaveSessionResult(false, false, null));

        if (session.HostDeviceId == deviceId)
        {
            _sessions.TryRemove(code, out _);
            return Task.FromResult(new LeaveSessionResult(true, true, null));
        }

        session.Participants.TryRemove(deviceId, out _);
        if (session.Participants.IsEmpty)
        {
            _sessions.TryRemove(code, out _);
            return Task.FromResult(new LeaveSessionResult(true, false, null));
        }

        return Task.FromResult(new LeaveSessionResult(true, false, session));
    }

    internal static string GenerateCode() => string.Create(6, Random.Shared, static (span, random) =>
    {
        for (var i = 0; i < span.Length; i++)
            span[i] = CodeChars[random.Next(CodeChars.Length)];
    });
}

public class RedisFriendSessionStore : IFriendSessionStore
{
    public const int MaxParticipants = 10;
    private const string SessionPrefix = "findme:session:";
    private const string LockPrefix = "findme:lock:";
    private readonly IDatabase _db;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public RedisFriendSessionStore(IConnectionMultiplexer redis)
    {
        _db = redis.GetDatabase();
    }

    public async Task<FriendSession> CreateAsync(string deviceId, string displayName)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var code = InMemoryFriendSessionStore.GenerateCode();
            var session = FriendSession.Create(code, deviceId, displayName);
            var added = await _db.StringSetAsync(SessionKey(code), Serialize(session), when: When.NotExists);
            if (added) return session;
        }

        throw new InvalidOperationException("Could not allocate a unique session code. Please try again.");
    }

    public async Task<JoinSessionResult> TryJoinAsync(string code, string deviceId, string displayName)
    {
        return await WithSessionLockAsync(code, async () =>
        {
            var session = await ReadAsync(code);
            if (session is null)
                return new JoinSessionResult(false, null, "Session not found.");

            if (session.Participants.ContainsKey(deviceId))
                return new JoinSessionResult(true, session, null);

            if (session.Participants.Count >= MaxParticipants)
                return new JoinSessionResult(false, null, $"This session already has {MaxParticipants} people.");

            session.Participants[deviceId] = FriendParticipant.Create(deviceId, displayName, session.Participants.Count + 1);
            await WriteAsync(session);
            return new JoinSessionResult(true, session, null);
        });
    }

    public Task<FriendSession?> GetAsync(string code) => ReadAsync(code);

    public async Task<bool> UpdateLocationAsync(string code, string deviceId, double latitude, double longitude)
    {
        return await WithSessionLockAsync(code, async () =>
        {
            var session = await ReadAsync(code);
            if (session is null || !session.Participants.TryGetValue(deviceId, out var participant))
                return false;

            participant.Latitude = latitude;
            participant.Longitude = longitude;
            participant.LocationUpdatedAtUtc = DateTime.UtcNow;
            await WriteAsync(session);
            return true;
        });
    }

    public async Task<LeaveSessionResult> LeaveAsync(string code, string deviceId)
    {
        return await WithSessionLockAsync(code, async () =>
        {
            var session = await ReadAsync(code);
            if (session is null)
                return new LeaveSessionResult(false, false, null);

            if (session.HostDeviceId == deviceId)
            {
                await _db.KeyDeleteAsync(SessionKey(code));
                return new LeaveSessionResult(true, true, null);
            }

            session.Participants.TryRemove(deviceId, out _);
            if (session.Participants.IsEmpty)
            {
                await _db.KeyDeleteAsync(SessionKey(code));
                return new LeaveSessionResult(true, false, null);
            }

            await WriteAsync(session);
            return new LeaveSessionResult(true, false, session);
        });
    }

    private async Task<T> WithSessionLockAsync<T>(string code, Func<Task<T>> action)
    {
        var lockKey = LockPrefix + code;
        var token = Guid.NewGuid().ToString("N");
        for (var attempt = 0; attempt < 25; attempt++)
        {
            if (await _db.LockTakeAsync(lockKey, token, TimeSpan.FromSeconds(5)))
            {
                try { return await action(); }
                finally { await _db.LockReleaseAsync(lockKey, token); }
            }
            await Task.Delay(40 + attempt * 10);
        }
        throw new TimeoutException("The session is busy. Please try again.");
    }

    private async Task<FriendSession?> ReadAsync(string code)
    {
        var value = await _db.StringGetAsync(SessionKey(code));
        return value.IsNullOrEmpty ? null : JsonSerializer.Deserialize<FriendSession>(value.ToString(), _jsonOptions);
    }

    private async Task WriteAsync(FriendSession session)
    {
        await _db.StringSetAsync(SessionKey(session.Code), Serialize(session));
    }

    private string Serialize(FriendSession session) => JsonSerializer.Serialize(session, _jsonOptions);
    private static string SessionKey(string code) => SessionPrefix + code;
}

public class FriendSession
{
    public string Code { get; set; } = string.Empty;
    public string HostDeviceId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public ConcurrentDictionary<string, FriendParticipant> Participants { get; set; } = new();

    [System.Text.Json.Serialization.JsonIgnore]
    public object SyncRoot { get; } = new();

    public static FriendSession Create(string code, string deviceId, string displayName)
    {
        var session = new FriendSession
        {
            Code = code,
            HostDeviceId = deviceId,
            CreatedAtUtc = DateTime.UtcNow
        };
        session.Participants[deviceId] = FriendParticipant.Create(deviceId, displayName, 1, true);
        return session;
    }
}

public class FriendParticipant
{
    public string DeviceId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public DateTime JoinedAtUtc { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime? LocationUpdatedAtUtc { get; set; }

    public static FriendParticipant Create(string deviceId, string displayName, int number, bool host = false) => new()
    {
        DeviceId = deviceId,
        DisplayName = string.IsNullOrWhiteSpace(displayName) ? (host ? "Host" : $"Person {number}") : displayName.Trim(),
        JoinedAtUtc = DateTime.UtcNow
    };
}
