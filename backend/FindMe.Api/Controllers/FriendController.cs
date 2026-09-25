using FindMe.Api;
using Microsoft.AspNetCore.Mvc;

namespace FindMe.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FriendController : ControllerBase
{
    private readonly FriendSessionStore _store;

    public FriendController(FriendSessionStore store)
    {
        _store = store;
    }

    [HttpPost("create")]
    public IActionResult Create([FromBody] FriendSessionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId))
            return BadRequest(new { message = "DeviceId is required." });

        var session = _store.Create(request.DeviceId, request.DisplayName);
        return Ok(new { sessionCode = session.Code, hostDeviceId = session.HostDeviceId, maxParticipants = FriendSessionStore.MaxParticipants });
    }

    [HttpPost("join")]
    public IActionResult Join([FromBody] JoinFriendSessionRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.SessionCode))
            return BadRequest(new { message = "DeviceId and session code are required." });

        var code = request.SessionCode.Trim();
        if (!_store.TryJoin(code, request.DeviceId, request.DisplayName, out var session, out var error))
            return BadRequest(new { message = error });

        return Ok(new { sessionCode = code, hostDeviceId = session!.HostDeviceId, maxParticipants = FriendSessionStore.MaxParticipants });
    }

    [HttpGet("{sessionCode}")]
    public IActionResult Get(string sessionCode)
    {
        if (!_store.TryGet(sessionCode, out var session) || session is null)
            return NotFound(new { message = "Session not found." });

        return Ok(new
        {
            sessionCode = session.Code,
            hostDeviceId = session.HostDeviceId,
            maxParticipants = FriendSessionStore.MaxParticipants,
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
