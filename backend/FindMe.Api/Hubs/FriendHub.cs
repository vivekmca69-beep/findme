using Microsoft.AspNetCore.SignalR;

namespace FindMe.Api.Hubs;

public class FriendHub : Hub
{
    private readonly IFriendSessionStore _store;

    public FriendHub(IFriendSessionStore store) => _store = store;

    public async Task ConnectToSession(string sessionCode, string deviceId)
    {
        var session = await _store.GetAsync(sessionCode);
        if (session is null)
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

        var session = await _store.GetAsync(sessionCode);
        if (session is null || !session.Participants.TryGetValue(deviceId, out var participant))
            throw new HubException("Session or participant not found.");

        if (!await _store.UpdateLocationAsync(sessionCode, deviceId, latitude, longitude))
            throw new HubException("Could not update participant location.");

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

    public async Task PublishGroupRoute(
        string sessionCode,
        string deviceId,
        string targetDeviceId,
        SharedGroupRouteRequest route)
    {
        var session = await _store.GetAsync(sessionCode);
        if (session is null)
            throw new HubException("Session not found.");
        if (session.HostDeviceId != deviceId)
            throw new HubException("Only the host can publish shared group routes.");
        if (!session.Participants.ContainsKey(targetDeviceId) || targetDeviceId == deviceId)
            throw new HubException("Invalid route target.");
        if (route.Points is null || route.Points.Count < 2 || route.Points.Count > 5000)
            throw new HubException("Invalid route geometry.");
        if (route.Points.Any(p => p.Latitude is < -90 or > 90 || p.Longitude is < -180 or > 180))
            throw new HubException("Invalid route coordinates.");

        var saved = await _store.SetGroupRouteAsync(sessionCode, deviceId, targetDeviceId, new FriendGroupRoute
        {
            HostDeviceId = deviceId,
            TargetDeviceId = targetDeviceId,
            FromLatitude = route.FromLatitude,
            FromLongitude = route.FromLongitude,
            ToLatitude = route.ToLatitude,
            ToLongitude = route.ToLongitude,
            DistanceMeters = route.DistanceMeters,
            DurationSeconds = route.DurationSeconds,
            Points = route.Points.Select(p => new FriendGroupRoutePoint
            {
                Latitude = p.Latitude,
                Longitude = p.Longitude
            }).ToList()
        });

        if (saved is null)
            throw new HubException("Could not save shared group route.");

        await Clients.Group(sessionCode).SendAsync("GroupRouteUpdated", saved);
    }

    public async Task SetMeetingPoint(string sessionCode, string deviceId, double latitude, double longitude)
    {
        if (latitude is < -90 or > 90 || longitude is < -180 or > 180)
            throw new HubException("Invalid meeting point coordinates.");

        var session = await _store.GetAsync(sessionCode);
        if (session is null)
            throw new HubException("Session not found.");
        if (session.HostDeviceId != deviceId)
            throw new HubException("Only the host can set the meeting point.");

        var updated = await _store.SetMeetingPointAsync(sessionCode, deviceId, latitude, longitude);
        if (updated is null)
            throw new HubException("Could not set meeting point.");

        await Clients.Group(sessionCode).SendAsync("SessionState", BuildSessionState(updated));
    }

    public async Task LeaveSession(string sessionCode, string deviceId)
    {
        var result = await _store.LeaveAsync(sessionCode, deviceId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, sessionCode);

        if (result.WasHost)
        {
            await Clients.Group(sessionCode).SendAsync("SessionClosed", new { sessionCode });
            return;
        }

        if (result.RemainingSession is not null)
            await Clients.Group(sessionCode).SendAsync("ParticipantChanged", BuildSessionState(result.RemainingSession));
    }

    private static object BuildSessionState(FriendSession session) => new
    {
        sessionCode = session.Code,
        hostDeviceId = session.HostDeviceId,
        participantCount = session.Participants.Count,
        maxParticipants = InMemoryFriendSessionStore.MaxParticipants,
        meetingLatitude = session.MeetingLatitude,
        meetingLongitude = session.MeetingLongitude,
        meetingUpdatedAtUtc = session.MeetingUpdatedAtUtc,
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
            .ToArray(),
        groupRoutes = session.GroupRoutes.Values
            .OrderBy(r => r.TargetDeviceId)
            .ToArray()
    };
}

public class SharedGroupRouteRequest
{
    public double FromLatitude { get; set; }
    public double FromLongitude { get; set; }
    public double ToLatitude { get; set; }
    public double ToLongitude { get; set; }
    public double DistanceMeters { get; set; }
    public double DurationSeconds { get; set; }
    public List<SharedGroupRoutePointRequest> Points { get; set; } = new();
}

public class SharedGroupRoutePointRequest
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
