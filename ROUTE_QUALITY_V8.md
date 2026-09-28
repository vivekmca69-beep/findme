# FindMe V8 route-quality update

- Group and vehicle route lines use Google-style blue (#4285F4) with a darker blue halo instead of white/purple.
- Default route mode is **Main roads**. It uses OpenRouteService `driving-car` + `fastest` weighting, which tends to favour faster/higher-class roads and avoids pedestrian-only shortcuts.
- Users can switch to **Walking** mode when they actually want pedestrian paths. Walking uses `foot-walking` + `recommended`.
- The host still calculates shared group routes once and broadcasts them to everyone, so switching the host to Main roads updates the shared road network without multiplying API usage on every phone.
- Existing `/api/route/walking` remains as a backward-compatible alias; the new frontend calls `/api/route/preferred`.
