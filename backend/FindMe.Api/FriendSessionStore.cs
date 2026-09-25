using System.Collections.Concurrent;

namespace FindMe.Api;

public class FriendSessionStore
{
    public const int MaxParticipants = 10;
    private readonly ConcurrentDictionary<string, FriendSession> _sessions = new();
    private static readonly char[] CodeChars = "0123456789".ToCharArray();

    public FriendSession Create(string deviceId, string displayName)
    {
        while (true)
        {
            var code = string.Create(6, Random.Shared, static (span, random) =>
            {
                for (var i = 0; i < span.Length; i++)
                    span[i] = CodeChars[random.Next(CodeChars.Length)];
            });

            var session = new FriendSession
            {
                Code = code,
                HostDeviceId = deviceId,
                CreatedAtUtc = DateTime.UtcNow
            };

            session.Participants[deviceId] = new FriendParticipant
            {
                DeviceId = deviceId,
                DisplayName = string.IsNullOrWhiteSpace(displayName) ? "Host" : displayName.Trim(),
                JoinedAtUtc = DateTime.UtcNow
            };

            if (_sessions.TryAdd(code, session))
                return session;
        }
    }

    public bool TryJoin(string code, string deviceId, string displayName, out FriendSession? session, out string? error)
    {
        error = null;
        session = null;

        if (!_sessions.TryGetValue(code, out var existing))
        {
            error = "Session not found.";
            return false;
        }

        if (existing.Participants.ContainsKey(deviceId))
        {
            session = existing;
            return true;
        }

        if (existing.Participants.Count >= MaxParticipants)
        {
            error = $"This session already has {MaxParticipants} people.";
            return false;
        }

        existing.Participants[deviceId] = new FriendParticipant
        {
            DeviceId = deviceId,
            DisplayName = string.IsNullOrWhiteSpace(displayName) ? $"Person {existing.Participants.Count + 1}" : displayName.Trim(),
            JoinedAtUtc = DateTime.UtcNow
        };

        session = existing;
        return true;
    }

    public bool TryGet(string code, out FriendSession? session) => _sessions.TryGetValue(code, out session);

    public void UpdateLocation(string code, string deviceId, double latitude, double longitude)
    {
        if (!_sessions.TryGetValue(code, out var session)) return;
        if (!session.Participants.TryGetValue(deviceId, out var participant)) return;

        participant.Latitude = latitude;
        participant.Longitude = longitude;
        participant.LocationUpdatedAtUtc = DateTime.UtcNow;
    }

    public void Leave(string code, string deviceId)
    {
        if (!_sessions.TryGetValue(code, out var session)) return;

        // The host owns the room. If the host leaves, close it for everyone.
        if (session.HostDeviceId == deviceId)
        {
            _sessions.TryRemove(code, out _);
            return;
        }

        session.Participants.TryRemove(deviceId, out _);
        if (session.Participants.IsEmpty)
            _sessions.TryRemove(code, out _);
    }
}

public class FriendSession
{
    public string Code { get; set; } = string.Empty;
    public string HostDeviceId { get; set; } = string.Empty;
    public DateTime CreatedAtUtc { get; set; }
    public ConcurrentDictionary<string, FriendParticipant> Participants { get; } = new();
}

public class FriendParticipant
{
    public string DeviceId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public DateTime JoinedAtUtc { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public DateTime? LocationUpdatedAtUtc { get; set; }
}
