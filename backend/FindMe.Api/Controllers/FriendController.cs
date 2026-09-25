using Microsoft.AspNetCore.Mvc;

namespace FindMe.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FriendController : ControllerBase
{
    private readonly IFriendSessionStore _store;

    public FriendController(IFriendSessionStore store) => _store = store;

    [HttpPost("create")]
    public async Task<IActionResult> Create([FromBody] FriendSessionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId))
            return BadRequest(new { message = "DeviceId is required." });

        var session = await _store.CreateAsync(request.DeviceId, request.DisplayName);
        return Ok(SessionIdentity(session));
    }

    [HttpPost("join")]
    public async Task<IActionResult> Join([FromBody] JoinFriendSessionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.SessionCode))
            return BadRequest(new { message = "DeviceId and session code are required." });

        var code = request.SessionCode.Trim();
        var result = await _store.TryJoinAsync(code, request.DeviceId, request.DisplayName);
        if (!result.Success || result.Session is null)
            return BadRequest(new { message = result.Error });

        return Ok(SessionIdentity(result.Session));
    }

    [HttpPost("restore")]
    public async Task<IActionResult> Restore([FromBody] RestoreFriendSessionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.SessionCode))
            return BadRequest(new { message = "DeviceId and session code are required." });

        var session = await _store.GetAsync(request.SessionCode.Trim());
        if (session is null)
            return NotFound(new { message = "Session not found." });

        if (!session.Participants.TryGetValue(request.DeviceId, out var participant))
            return NotFound(new { message = "This device is no longer part of the session." });

        return Ok(new
        {
            sessionCode = session.Code,
            hostDeviceId = session.HostDeviceId,
            maxParticipants = InMemoryFriendSessionStore.MaxParticipants,
            displayName = participant.DisplayName
        });
    }

    [HttpGet("{sessionCode}")]
    public async Task<IActionResult> Get(string sessionCode)
    {
        var session = await _store.GetAsync(sessionCode);
        if (session is null)
            return NotFound(new { message = "Session not found." });

        return Ok(new
        {
            sessionCode = session.Code,
            hostDeviceId = session.HostDeviceId,
            maxParticipants = InMemoryFriendSessionStore.MaxParticipants,
            participants = session.Participants.Values.Select(p => new
            {
                p.DeviceId,
                p.DisplayName,
                p.Latitude,
                p.Longitude,
                p.LocationUpdatedAtUtc
            })
        });
    }

    private static object SessionIdentity(FriendSession session) => new
    {
        sessionCode = session.Code,
        hostDeviceId = session.HostDeviceId,
        maxParticipants = InMemoryFriendSessionStore.MaxParticipants
    };
}

public class FriendSessionRequest
{
    public string DeviceId { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
}

public class JoinFriendSessionRequest : FriendSessionRequest
{
    public string SessionCode { get; set; } = string.Empty;
}

public class RestoreFriendSessionRequest
{
    public string SessionCode { get; set; } = string.Empty;
    public string DeviceId { get; set; } = string.Empty;
}
