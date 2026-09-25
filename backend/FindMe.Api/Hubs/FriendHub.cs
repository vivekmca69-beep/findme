using FindMe.Api;
using Microsoft.AspNetCore.SignalR;

namespace FindMe.Api.Hubs;

public class FriendHub : Hub
{
    private readonly FriendSessionStore _store;

    public FriendHub(FriendSessionStore store) => _store = store;

    public async Task ConnectToSession(string sessionCode, string deviceId)
    {
        if (!_store.TryGet(sessionCode, out var session) || session is null)
            throw new HubException("Session not found.");

        if (!session.Participants.ContainsKey(deviceId))
            throw new HubException("This device has not joined the session.");

        await Groups.AddToGroupAsync(Context.ConnectionId, sessionCode);
        await Clients.Caller.SendAsync("SessionState", BuildSessionState(session));
        await Clients.Group(sessionCode).SendAsync("ParticipantChanged", BuildSessionState(session));
    }

    public async Task UpdateLocation(string sessionCode, string deviceId, double latitude, double longitude)
    {
        if (latitude is < -90 or > 90 || longitude is < -180 or > 180)
            throw new HubException("Invalid coordinates.");

        if (!_store.TryGet(sessionCode, out var session) || session is null ||
            !session.Participants.TryGetValue(deviceId, out var participant))
            throw new HubException("Session or participant not found.");

        _store.UpdateLocation(sessionCode, deviceId, latitude, longitude);

        await Clients.Group(sessionCode).SendAsync("LocationUpdated", new
        {
            participant.DeviceId,
            participant.DisplayName,
            isHost = session.HostDeviceId == participant.DeviceId,
            Latitude = latitude,
            Longitude = longitude,
            LocationUpdatedAtUtc = DateTime.UtcNow
        });
    }

    public async Task LeaveSession(string sessionCode, string deviceId)
    {
        var wasHost = _store.TryGet(sessionCode, out var before) && before is not null && before.HostDeviceId == deviceId;
        _store.Leave(sessionCode, deviceId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, sessionCode);

        if (wasHost)
        {
            await Clients.Group(sessionCode).SendAsync("SessionClosed", new { sessionCode });
            return;
        }

        if (_store.TryGet(sessionCode, out var session) && session is not null)
            await Clients.Group(sessionCode).SendAsync("ParticipantChanged", BuildSessionState(session));
    }

    private static object BuildSessionState(FriendSession session) => new
    {
        sessionCode = session.Code,
        hostDeviceId = session.HostDeviceId,
        participantCount = session.Participants.Count,
        maxParticipants = FriendSessionStore.MaxParticipants,
        participants = session.Participants.Values
            .OrderBy(p => p.JoinedAtUtc)
            .Select(p => new
            {
                p.DeviceId,
                p.DisplayName,
                isHost = session.HostDeviceId == p.DeviceId,
                p.Latitude,
                p.Longitude,
                p.LocationUpdatedAtUtc
            })
            .ToArray()
    };
}
