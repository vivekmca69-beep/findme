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
        var result = await ComputeRoutesAsync(
            fromLat, fromLng, toLat, toLng, mode,
            computeAlternativeRoutes: false,
            cancellationToken);

        if (result.ErrorResult is not null) return result.ErrorResult;
        return Ok(result.Routes![0]);
    }

    [HttpGet("alternatives")]
    public async Task<IActionResult> GetAlternativeRoutes(
        [FromQuery] double fromLat,
        [FromQuery] double fromLng,
        [FromQuery] double toLat,
        [FromQuery] double toLng,
        [FromQuery] string mode = "car",
        CancellationToken cancellationToken = default)
    {
        var result = await ComputeRoutesAsync(
            fromLat, fromLng, toLat, toLng, mode,
            computeAlternativeRoutes: true,
            cancellationToken);

        if (result.ErrorResult is not null) return result.ErrorResult;

        // A compact mobile preview is clearer with at most three visible choices.
        // Google may return the default route plus several alternatives.
        return Ok(result.Routes!.Take(3).ToList());
    }

    private async Task<RouteComputationResult> ComputeRoutesAsync(
        double fromLat,
        double fromLng,
        double toLat,
        double toLng,
        string mode,
        bool computeAlternativeRoutes,
        CancellationToken cancellationToken)
    {
        if (!IsValidCoordinate(fromLat, fromLng) || !IsValidCoordinate(toLat, toLng))
        {
            return RouteComputationResult.Error(BadRequest(new { message = "Invalid coordinates." }));
        }

        var apiKey = _configuration["GoogleRoutes:ApiKey"]
                     ?? _configuration["GOOGLE_ROUTES_API_KEY"]
                     ?? Environment.GetEnvironmentVariable("GOOGLE_ROUTES_API_KEY");

        if (string.IsNullOrWhiteSpace(apiKey))
        {
            return RouteComputationResult.Error(StatusCode(
                StatusCodes.Status503ServiceUnavailable,
                new { message = "Google Routes API key is not configured on the server." }));
        }

        var normalizedMode = NormalizeMode(mode);
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
            ["computeAlternativeRoutes"] = computeAlternativeRoutes,
            ["languageCode"] = "en-US",
            ["units"] = "METRIC",
            ["polylineQuality"] = "HIGH_QUALITY",
            ["polylineEncoding"] = "ENCODED_POLYLINE"
        };

        // Preserve the existing cost/behavior choice: no traffic-aware routing.
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
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://routes.googleapis.com/directions/v2:computeRoutes");

        request.Headers.TryAddWithoutValidation("X-Goog-Api-Key", apiKey);
        request.Headers.TryAddWithoutValidation(
            "X-Goog-FieldMask",
            "routes.routeLabels,routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline," +
            "routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration");
        request.Content = new StringContent(
            JsonSerializer.Serialize(requestBody),
            Encoding.UTF8,
            "application/json");

        using var response = await client.SendAsync(request, cancellationToken);
        var json = await response.Content.ReadAsStringAsync(cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            return RouteComputationResult.Error(StatusCode(
                (int)response.StatusCode,
                new
                {
                    message = "Google Routes API returned an error.",
                    details = json
                }));
        }

        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("routes", out var rawRoutes) || rawRoutes.GetArrayLength() == 0)
        {
            return RouteComputationResult.Error(NotFound(
                new { message = "No route was returned for these locations." }));
        }

        var routes = rawRoutes
            .EnumerateArray()
            .Select((route, index) => ParseRoute(route, normalizedMode, googleTravelMode, index))
            .Where(route => route.Points.Count >= 2)
            .ToList();

        if (routes.Count == 0)
        {
            return RouteComputationResult.Error(NotFound(
                new { message = "No usable road route was returned for these locations." }));
        }

        return RouteComputationResult.Success(routes);
    }

    private static WalkingRouteResponse ParseRoute(
        JsonElement route,
        string normalizedMode,
        string googleTravelMode,
        int index)
    {
        var encodedPolyline = route
            .GetProperty("polyline")
            .GetProperty("encodedPolyline")
            .GetString() ?? string.Empty;

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
                        if (nav.TryGetProperty("instructions", out var instructions))
                            instruction = instructions.GetString() ?? string.Empty;
                        if (nav.TryGetProperty("maneuver", out var maneuverElement))
                            maneuver = maneuverElement.GetString() ?? string.Empty;
                    }

                    steps.Add(new RouteStep
                    {
                        Instruction = instruction,
                        Maneuver = maneuver,
                        DistanceMeters = rawStep.TryGetProperty("distanceMeters", out var distance)
                            ? distance.GetDouble()
                            : 0,
                        DurationSeconds = rawStep.TryGetProperty("staticDuration", out var duration)
                            ? ParseGoogleDurationSeconds(duration.GetString())
                            : 0
                    });
                }
            }
        }

        var labels = new List<string>();
        if (route.TryGetProperty("routeLabels", out var rawLabels))
        {
            labels = rawLabels
                .EnumerateArray()
                .Select(label => label.GetString() ?? string.Empty)
                .Where(label => !string.IsNullOrWhiteSpace(label))
                .ToList();
        }

        return new WalkingRouteResponse
        {
            Mode = normalizedMode,
            Profile = googleTravelMode,
            Provider = "google",
            RouteIndex = index,
            RouteLabels = labels,
            DistanceMeters = route.TryGetProperty("distanceMeters", out var distanceMeters)
                ? distanceMeters.GetDouble()
                : 0,
            DurationSeconds = route.TryGetProperty("duration", out var durationElement)
                ? ParseGoogleDurationSeconds(durationElement.GetString())
                : 0,
            Points = points,
            Steps = steps
        };
    }

    private static string NormalizeMode(string mode) => mode.Trim().ToLowerInvariant() switch
    {
        "two_wheeler" or "two-wheeler" or "motorcycle" => "two_wheeler",
        "bicycle" or "bike" => "bicycle",
        "walking" or "walk" => "walking",
        _ => "car"
    };

    private static double ParseGoogleDurationSeconds(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.EndsWith('s')) return 0;
        return double.TryParse(
            value[..^1],
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out var seconds)
            ? seconds
            : 0;
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

    private sealed class RouteComputationResult
    {
        public List<WalkingRouteResponse>? Routes { get; init; }
        public IActionResult? ErrorResult { get; init; }

        public static RouteComputationResult Success(List<WalkingRouteResponse> routes) =>
            new() { Routes = routes };

        public static RouteComputationResult Error(IActionResult result) =>
            new() { ErrorResult = result };
    }
}

public class WalkingRouteResponse
{
    public string Mode { get; set; } = "car";
    public string Profile { get; set; } = "DRIVE";
    public string Provider { get; set; } = "google";
    public int RouteIndex { get; set; }
    public List<string> RouteLabels { get; set; } = new();
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
