# FindMe

Mobile-first web MVP for:
- Saving and finding a parked vehicle
- Creating a hosted group location-sharing session
- Showing all connected participants on a map
- Showing each guest a walking route to the host

## Stack
Angular 18, Leaflet/OpenStreetMap, ASP.NET Core .NET 8, SignalR, OpenRouteService.

See `DEPLOYMENT.md` for free deployment to Cloudflare Pages + Render.

## V11 Google Maps migration

FindMe now uses Google Maps JavaScript API for the map and Google Routes API for route calculation.
Travel modes: Car, motorized Two-wheeler, Bicycle, and Walk. DRIVE and TWO_WHEELER use `TRAFFIC_UNAWARE`; live traffic routing is not enabled.
See `GOOGLE_MAPS_MIGRATION_V11.md` for environment variables and local/deployment notes.
