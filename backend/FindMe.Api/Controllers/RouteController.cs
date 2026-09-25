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

    [HttpGet("walking")]
    public async Task<IActionResult> GetWalkingRoute(
        [FromQuery] double fromLat,
        [FromQuery] double fromLng,
        [FromQuery] double toLat,
        [FromQuery] double toLng,
        CancellationToken cancellationToken)
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

        var client = _httpClientFactory.CreateClient();
        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.openrouteservice.org/v2/directions/foot-walking/geojson");

        request.Headers.TryAddWithoutValidation("Authorization", apiKey);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/geo+json"));

        var payload = JsonSerializer.Serialize(new
        {
            coordinates = new[]
            {
                new[] { fromLng, fromLat },
                new[] { toLng, toLat }
            }
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
        var summary = feature.GetProperty("properties").GetProperty("summary");

        var points = new List<RoutePoint>();
        foreach (var coordinate in coordinates.EnumerateArray())
        {
            points.Add(new RoutePoint
            {
                Longitude = coordinate[0].GetDouble(),
                Latitude = coordinate[1].GetDouble()
            });
        }

        return Ok(new WalkingRouteResponse
        {
            DistanceMeters = summary.GetProperty("distance").GetDouble(),
            DurationSeconds = summary.GetProperty("duration").GetDouble(),
            Points = points
        });
    }

    private static bool IsValidCoordinate(double latitude, double longitude) =>
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;
}

public class WalkingRouteResponse
{
    public double DistanceMeters { get; set; }
    public double DurationSeconds { get; set; }
    public List<RoutePoint> Points { get; set; } = new();
}

public class RoutePoint
{
    public double Latitude { get; set; }
    public double Longitude { get; set; }
}
