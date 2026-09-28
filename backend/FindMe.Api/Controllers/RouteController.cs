using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;

namespace FindMe.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class RouteController : ControllerBase
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;

    public RouteController(IHttpClientFactory httpClientFactory, IConfiguration configuration)
    {
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
    }

    [HttpGet("preferred")]
    [HttpGet("walking")] // Backward-compatible alias for older frontends.
    public async Task<IActionResult> GetPreferredRoute(
        [FromQuery] double fromLat,
        [FromQuery] double fromLng,
        [FromQuery] double toLat,
        [FromQuery] double toLng,
        [FromQuery] string mode = "main-roads",
        CancellationToken cancellationToken = default)
    {
        if (!IsValidCoordinate(fromLat, fromLng) || !IsValidCoordinate(toLat, toLng))
            return BadRequest(new { message = "Invalid coordinates." });

        var apiKey = _configuration["OpenRouteService:ApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey) || apiKey == "PUT_YOUR_ORS_API_KEY_HERE")
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                message = "OpenRouteService API key is not configured on the server."
            });
        }

        // "main-roads" intentionally uses the driving-car graph with fastest
        // weighting. The previous foot-walking profile naturally favours
        // footways/paths/residential ways and can therefore look like a
        // shortcut through narrow lanes. Main-roads mode behaves much closer
        // to familiar road navigation by preferring faster, higher-class roads.
        var normalizedMode = string.Equals(mode, "walking", StringComparison.OrdinalIgnoreCase)
            ? "walking"
            : "main-roads";
        var profile = normalizedMode == "walking" ? "foot-walking" : "driving-car";
        var preference = normalizedMode == "walking" ? "recommended" : "fastest";

        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"https://api.heigit.org/openrouteservice/v2/directions/{profile}/geojson");

        request.Headers.TryAddWithoutValidation("Authorization", apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/geo+json"));

        var payload = JsonSerializer.Serialize(new
        {
            coordinates = new[]
            {
                new[] { fromLng, fromLat },
                new[] { toLng, toLat }
            },
            preference,
            instructions = true,
            language = "en"
        });

        request.Content = new StringContent(payload, Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            return StatusCode((int)response.StatusCode, new
            {
                message = "Walking route service returned an error.",
                details = json
            });
        }

        using var document = JsonDocument.Parse(json);
        var feature = document.RootElement.GetProperty("features")[0];
        var coordinates = feature.GetProperty("geometry").GetProperty("coordinates");
        var properties = feature.GetProperty("properties");
        var summary = properties.GetProperty("summary");

        var points = new List<RoutePoint>();
        foreach (var coordinate in coordinates.EnumerateArray())
        {
            points.Add(new RoutePoint
            {
                Longitude = coordinate[0].GetDouble(),
                Latitude = coordinate[1].GetDouble()
            });
        }

        var steps = new List<RouteStep>();
        if (properties.TryGetProperty("segments", out var segments) && segments.GetArrayLength() > 0)
        {
            var segment = segments[0];
            if (segment.TryGetProperty("steps", out var rawSteps))
            {
                foreach (var rawStep in rawSteps.EnumerateArray())
                {
                    steps.Add(new RouteStep
                    {
                        Instruction = rawStep.TryGetProperty("instruction", out var instruction) ? instruction.GetString() ?? string.Empty : string.Empty,
                        DistanceMeters = rawStep.TryGetProperty("distance", out var distance) ? distance.GetDouble() : 0,
                        DurationSeconds = rawStep.TryGetProperty("duration", out var duration) ? duration.GetDouble() : 0,
                        Type = rawStep.TryGetProperty("type", out var type) ? type.GetInt32() : 0
                    });
                }
            }
        }

        return Ok(new WalkingRouteResponse
        {
            Mode = normalizedMode,
            Profile = profile,
            DistanceMeters = summary.GetProperty("distance").GetDouble(),
            DurationSeconds = summary.GetProperty("duration").GetDouble(),
            Points = points,
            Steps = steps
        });
    }

    private static bool IsValidCoordinate(double latitude, double longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}

public class WalkingRouteResponse
{
    public string Mode { get; set; } = "main-roads";
    public string Profile { get; set; } = "driving-car";
    public double DistanceMeters { get; set; }
    public double DurationSeconds { get; set; }
    public List<RoutePoint> Points { get; set; } = new();
    public List<RouteStep> Steps { get; set; } = new();
}

public class RoutePoint
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}

public class RouteStep
{
    public string Instruction { get; set; } = string.Empty;
    public double DistanceMeters { get; set; }
    public double DurationSeconds { get; set; }
    public int Type { get; set; }
}
