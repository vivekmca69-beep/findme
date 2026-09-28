# FindMe V11 — Google Maps + Google Routes

This version replaces the previous MapLibre/OpenFreeMap and OpenRouteService layers with:

- Google Maps JavaScript API for the web map
- Google Routes API for route calculation
- DRIVE, TWO_WHEELER, BICYCLE and WALK travel modes
- `TRAFFIC_UNAWARE` for DRIVE and TWO_WHEELER (no traffic-aware billing/features)

Existing FindMe functionality is retained:

- Redis-backed group sessions and parked-vehicle persistence
- SignalR live participant tracking
- refresh/session restore
- group route sharing
- smart meeting point
- compass mode
- button spinners / duplicate-tap protection
- full-screen map and satellite/hybrid view

## Environment variables

### Cloudflare Pages frontend

- `API_BASE_URL=https://findme-api-psax.onrender.com`
- `GOOGLE_MAPS_API_KEY=<browser key restricted to Maps JavaScript API + allowed websites>`

### Render backend

- `GOOGLE_ROUTES_API_KEY=<server key restricted to Routes API>`
- `REDIS_URL=...`
- `FRONTEND_ORIGINS=...`

The old `OpenRouteService__ApiKey` is no longer used by V11 and may be removed from Render after V11 is verified.

## Local development

PowerShell:

```powershell
$env:GOOGLE_MAPS_API_KEY="YOUR_BROWSER_KEY"
$env:API_BASE_URL="http://localhost:5000"
npm start
```

Windows CMD:

```bat
set GOOGLE_MAPS_API_KEY=YOUR_BROWSER_KEY
set API_BASE_URL=http://localhost:5000
npm start
```

Backend locally requires `GOOGLE_ROUTES_API_KEY` in the environment or launch profile.

## Google-required route warning

Google documents WALK, BICYCLE and TWO_WHEELER as beta route modes and requires a warning to users. The frontend displays that warning whenever one of these modes is selected.

## Route attribution

The UI includes `Powered by Google, ©2026 Google` for Google Routes output. The Google basemap also renders Google's own map attribution automatically.
