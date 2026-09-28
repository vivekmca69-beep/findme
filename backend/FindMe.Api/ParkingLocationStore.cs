using System.Collections.Concurrent;
using System.Text.Json;
using StackExchange.Redis;

namespace FindMe.Api;

public interface IParkingLocationStore
{
    Task<SavedParkingLocation> SaveAsync(string deviceId, double latitude, double longitude);
    Task<SavedParkingLocation?> GetAsync(string deviceId);
    Task<bool> DeleteAsync(string deviceId);
}

public class SavedParkingLocation
{
    public string DeviceId { get; set; } = string.Empty;
    public double Latitude { get; set; }
    public double Longitude { get; set; }
    public DateTime SavedAtUtc { get; set; }
}

public class InMemoryParkingLocationStore : IParkingLocationStore
{
    private readonly ConcurrentDictionary<string, SavedParkingLocation> _store = new();

    public Task<SavedParkingLocation> SaveAsync(string deviceId, double latitude, double longitude)
    {
        var location = new SavedParkingLocation
        {
            DeviceId = deviceId,
            Latitude = latitude,
            Longitude = longitude,
            SavedAtUtc = DateTime.UtcNow
        };
        _store[deviceId] = location;
        return Task.FromResult(location);
    }

    public Task<SavedParkingLocation?> GetAsync(string deviceId)
    {
        _store.TryGetValue(deviceId, out var location);
        return Task.FromResult(location);
    }

    public Task<bool> DeleteAsync(string deviceId) => Task.FromResult(_store.TryRemove(deviceId, out _));
}

public class RedisParkingLocationStore : IParkingLocationStore
{
    private const string Prefix = "findme:parking:";
    private readonly IDatabase _db;
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web);

    public RedisParkingLocationStore(IConnectionMultiplexer redis) => _db = redis.GetDatabase();

    public async Task<SavedParkingLocation> SaveAsync(string deviceId, double latitude, double longitude)
    {
        var location = new SavedParkingLocation
        {
            DeviceId = deviceId,
            Latitude = latitude,
            Longitude = longitude,
            SavedAtUtc = DateTime.UtcNow
        };

        // Deliberately no expiry. The parking pin remains until the user replaces
        // it with another Save action or explicitly clears it.
        await _db.StringSetAsync(Key(deviceId), JsonSerializer.Serialize(location, _jsonOptions), expiry: null);
        return location;
    }

    public async Task<SavedParkingLocation?> GetAsync(string deviceId)
    {
        var value = await _db.StringGetAsync(Key(deviceId));
        return value.IsNullOrEmpty
            ? null
            : JsonSerializer.Deserialize<SavedParkingLocation>(value.ToString(), _jsonOptions);
    }

    public Task<bool> DeleteAsync(string deviceId) => _db.KeyDeleteAsync(Key(deviceId));

    private static string Key(string deviceId) => Prefix + deviceId;
}
