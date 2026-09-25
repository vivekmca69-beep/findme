using FindMe.Api;
using FindMe.Api.Hubs;

var builder = WebApplication.CreateBuilder(args);

// Render injects PORT. Local development falls back to 5000.
var port = Environment.GetEnvironmentVariable("PORT") ?? "5000";
builder.WebHost.UseUrls($"http://0.0.0.0:{port}");

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<FriendSessionStore>();

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

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    utc = DateTime.UtcNow
}));

app.MapControllers();
app.MapHub<FriendHub>("/hubs/friend");

app.Run();
