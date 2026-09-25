using Microsoft.AspNetCore.Mvc;

namespace FindMe.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ParkingController : ControllerBase
{
    // MVP only: in-memory storage. Replace with MySQL/Redis later.
    private static readonly Dictionary<string, ParkingLocation> Store = new();

    [HttpPost("save")]
    public IActionResult Save([FromBody] ParkingLocation location)
    {
        if (string.IsNullOrWhiteSpace(location.DeviceId))
            return BadRequest("DeviceId is required.");

        location.SavedAtUtc = DateTime.UtcNow;
        Store[location.DeviceId] = location;
        return Ok(location);
    }

    [HttpGet("{deviceId}")]
    public IActionResult Get(string deviceId)
    {
        return Store.TryGetValue(deviceId, out var location)
            ? Ok(location)
            : NotFound(new { message = "No saved vehicle location found." });
    }
}

public class ParkingLocation
{
    public string DeviceId { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime SavedAtUtc { get; set; }
}
