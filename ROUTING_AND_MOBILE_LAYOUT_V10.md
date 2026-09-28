# FindMe V10 — routing modes and mobile map layout

## Route modes

The free OpenRouteService integration now exposes three safe transport profiles:

- **Car** → `driving-car`, `fastest`
- **Bike** → `cycling-regular`, `recommended` (human-powered bicycle)
- **Walk** → `foot-walking`, `recommended`

The Bike mode is a bicycle profile. It is **not** a motorcycle/two-wheeler profile. Google Routes has a distinct `TWO_WHEELER` mode, while OpenRouteService does not provide an equivalent motorized-two-wheeler profile.

## Mobile layout

Map overlays are now grouped into one left-side stack so they cannot overlap each other:

1. Map / Satellite
2. Car / Bike / Walk
3. Compact group code and participant count

Full-screen/recenter controls remain in a dedicated right-side rail. Map status stays bottom-left and MapLibre controls stay bottom-right, with safe-area spacing for mobile browsers.

## Route quality

Car mode requests a fastest `driving-car` route, which generally prefers faster/higher-class roads. It does not use Google Maps traffic or Google road-ranking data, so it should not be expected to reproduce Google Maps route choices exactly.
