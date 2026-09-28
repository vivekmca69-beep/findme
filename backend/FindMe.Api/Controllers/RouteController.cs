using System.Globalization;
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
    [HttpGet("walking")]
    public async Task<IActionResult> GetPreferredRoute(
        [FromQuery] double fromLat,
        [FromQuery] double fromLng,
        [FromQuery] double toLat,
        [FromQuery] double toLng,
        [FromQuery] string mode = "car",
        CancellationToken cancellationToken = default)
    {
        if (!IsValidCoordinate(fromLat, fromLng) || !IsValidCoordinate(toLat, toLng))
            return BadRequest(new { message = "Invalid coordinates." });

        var apiKey = _configuration["GoogleRoutes:ApiKey"]
                     ?? _configuration["GOOGLE_ROUTES_API_KEY"]
                     ?? Environment.GetEnvironmentVariable("GOOGLE_ROUTES_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey))
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { message = "Google Routes API key is not configured on the server." });

        var normalizedMode = mode.Trim().ToLowerInvariant() switch
        {
            "two_wheeler" or "two-wheeler" or "motorcycle" => "two_wheeler",
            "bicycle" or "bike" => "bicycle",
            "walking" or "walk" => "walking",
            _ => "car"
        };

        var googleTravelMode = normalizedMode switch
        {
            "two_wheeler" => "TWO_WHEELER",
            "bicycle" => "BICYCLE",
            "walking" => "WALK",
            _ => "DRIVE"
        };

        var requestBody = new Dictionary<string, object?>
        {
            ["origin"] = new
            {
                location = new { latLng = new { latitude = fromLat, longitude = fromLng } }
            },
            ["destination"] = new
            {
                location = new { latLng = new { latitude = toLat, longitude = toLng } }
            },
            ["travelMode"] = googleTravelMode,
            ["computeAlternativeRoutes"] = false,
            ["languageCode"] = "en-US",
            ["units"] = "METRIC",
            ["polylineQuality"] = "HIGH_QUALITY",
            ["polylineEncoding"] = "ENCODED_POLYLINE"
        };

        // Explicitly avoid traffic-aware routing, as requested. This stays in the
        // standard non-traffic route path for motorized modes.
        if (googleTravelMode is "DRIVE" or "TWO_WHEELER")
        {
            requestBody["routingPreference"] = "TRAFFIC_UNAWARE";
            requestBody["routeModifiers"] = new
            {
                avoidTolls = false,
                avoidHighways = false,
                avoidFerries = false
            };
        }

        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://routes.googleapis.com/directions/v2:computeRoutes");
        request.Headers.TryAddWithoutValidation("X-Goog-Api-Key", apiKey);
        request.Headers.TryAddWithoutValidation(
            "X-Goog-FieldMask",
            "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline," +
            "routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration");
        request.Content = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");

        using var response = await client.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            return StatusCode((int)response.StatusCode, new
            {
                message = "Google Routes API returned an error.",
                details = json
            });
        }

        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("routes", out var routes) || routes.GetArrayLength() == 0)
            return NotFound(new { message = "No route was returned for these locations." });

        var route = routes[0];
        var encodedPolyline = route.GetProperty("polyline").GetProperty("encodedPolyline").GetString() ?? string.Empty;
        var points = DecodePolyline(encodedPolyline)
            .Select(p => new RoutePoint { Latitude = p.Latitude, Longitude = p.Longitude })
            .ToList();

        var steps = new List<RouteStep>();
        if (route.TryGetProperty("legs", out var legs))
        {
            foreach (var leg in legs.EnumerateArray())
            {
                if (!leg.TryGetProperty("steps", out var rawSteps)) continue;
                foreach (var rawStep in rawSteps.EnumerateArray())
                {
                    var instruction = string.Empty;
                    var maneuver = string.Empty;
                    if (rawStep.TryGetProperty("navigationInstruction", out var nav))
                    {
                        if (nav.TryGetProperty("instructions", out var instructions)) instruction = instructions.GetString() ?? string.Empty;
                        if (nav.TryGetProperty("maneuver", out var maneuverElement)) maneuver = maneuverElement.GetString() ?? string.Empty;
                    }

                    steps.Add(new RouteStep
                    {
                        Instruction = instruction,
                        Maneuver = maneuver,
                        DistanceMeters = rawStep.TryGetProperty("distanceMeters", out var distance) ? distance.GetDouble() : 0,
                        DurationSeconds = rawStep.TryGetProperty("staticDuration", out var duration)
                            ? ParseGoogleDurationSeconds(duration.GetString())
                            : 0
                    });
                }
            }
        }

        return Ok(new WalkingRouteResponse
        {
            Mode = normalizedMode,
            Profile = googleTravelMode,
            Provider = "google",
            DistanceMeters = route.TryGetProperty("distanceMeters", out var distanceMeters) ? distanceMeters.GetDouble() : 0,
            DurationSeconds = route.TryGetProperty("duration", out var durationElement)
                ? ParseGoogleDurationSeconds(durationElement.GetString())
                : 0,
            Points = points,
            Steps = steps
        });
    }

    private static double ParseGoogleDurationSeconds(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.EndsWith('s')) return 0;
        return double.TryParse(value[..^1], NumberStyles.Float, CultureInfo.InvariantCulture, out var seconds) ? seconds : 0;
    }

    private static List<(double Latitude, double Longitude)> DecodePolyline(string encoded)
    {
        var points = new List<(double Latitude, double Longitude)>();
        var index = 0;
        var latitude = 0;
        var longitude = 0;

        while (index < encoded.Length)
        {
            latitude += DecodeNextValue(encoded, ref index);
            longitude += DecodeNextValue(encoded, ref index);
            points.Add((latitude / 1e5, longitude / 1e5));
        }

        return points;
    }

    private static int DecodeNextValue(string encoded, ref int index)
    {
        var result = 0;
        var shift = 0;
        int b;
        do
        {
            b = encoded[index++] - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20 && index < encoded.Length);

        return (result & 1) != 0 ? ~(result >> 1) : result >> 1;
    }

    private static bool IsValidCoordinate(double latitude, double longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}

public class WalkingRouteResponse
{
    public string Mode { get; set; } = "car";
    public string Profile { get; set; } = "DRIVE";
    public string Provider { get; set; } = "google";
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
    public string Maneuver { get; set; } = string.Empty;
    public double DistanceMeters { get; set; }
    public double DurationSeconds { get; set; }
    public int Type { get; set; }
}
