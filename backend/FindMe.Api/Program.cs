using FindMe.Api;
using FindMe.Api.Hubs;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();

var redisUrl = Environment.GetEnvironmentVariable("REDIS_URL");
if (!string.IsNullOrWhiteSpace(redisUrl))
{
    var redisOptions = RedisConnectionOptions.FromUrl(redisUrl);
    builder.Services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisOptions));
    builder.Services.AddSingleton<IFriendSessionStore, RedisFriendSessionStore>();
}
else
{
    builder.Services.AddSingleton<IFriendSessionStore, InMemoryFriendSessionStore>();
}

var allowedOrigins = (Environment.GetEnvironmentVariable("FRONTEND_ORIGINS")
                      ?? "http://localhost:4200,http://127.0.0.1:4200")
    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
    .Select(origin => origin.TrimEnd('/'))
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .ToArray();

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

var app = builder.Build();
app.UseCors("Frontend");

app.MapGet("/health", async (IFriendSessionStore store) => Results.Ok(new
{
    status = "ok",
    sessionStore = store is RedisFriendSessionStore ? "redis" : "memory",
    utc = DateTime.UtcNow
}));

app.MapControllers();
app.MapHub<FriendHub>("/hubs/friend");
app.Run();

internal static class RedisConnectionOptions
{
    public static ConfigurationOptions FromUrl(string redisUrl)
    {
        var uri = new Uri(redisUrl);
        var options = new ConfigurationOptions
        {
            EndPoints = { { uri.Host, uri.Port > 0 ? uri.Port : 6379 } },
            Ssl = uri.Scheme.Equals("rediss", StringComparison.OrdinalIgnoreCase),
            AbortOnConnectFail = false,
            ConnectRetry = 3,
            ConnectTimeout = 10000
        };

        if (!string.IsNullOrEmpty(uri.UserInfo))
        {
            var parts = uri.UserInfo.Split(':', 2);
            if (parts.Length == 2)
            {
                if (!string.IsNullOrWhiteSpace(parts[0]) && !parts[0].Equals("default", StringComparison.OrdinalIgnoreCase))
                    options.User = Uri.UnescapeDataString(parts[0]);
                options.Password = Uri.UnescapeDataString(parts[1]);
            }
        }

        return options;
    }
}
