using Microsoft.AspNetCore.Mvc;

namespace FindMe.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ParkingController : ControllerBase
{
    private readonly IParkingLocationStore _store;

    public ParkingController(IParkingLocationStore store) => _store = store;

    [HttpPost("save")]
    public async Task<IActionResult> Save([FromBody] ParkingLocationRequest location)
    {
        if (string.IsNullOrWhiteSpace(location.DeviceId))
            return BadRequest(new { message = "DeviceId is required." });

        if (location.Latitude is < -90 or > 90 || location.Longitude is < -180 or > 180)
            return BadRequest(new { message = "Invalid coordinates." });

        var saved = await _store.SaveAsync(location.DeviceId.Trim(), location.Latitude, location.Longitude);
        return Ok(saved);
    }

    [HttpGet("{deviceId}")]
    public async Task<IActionResult> Get(string deviceId)
    {
        var location = await _store.GetAsync(deviceId);
        return location is not null
            ? Ok(location)
            : NotFound(new { message = "No saved vehicle location found." });
    }

    [HttpDelete("{deviceId}")]
    public async Task<IActionResult> Delete(string deviceId)
    {
        await _store.DeleteAsync(deviceId);
        return NoContent();
    }
}

public class ParkingLocationRequest
{
    public string DeviceId { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
