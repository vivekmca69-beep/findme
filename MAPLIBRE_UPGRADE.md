# FindMe MapLibre GL upgrade

The frontend map engine now uses MapLibre GL JS instead of Leaflet while preserving the existing FindMe application logic.

## Why

- Smooth vector street map instead of raster OpenStreetMap tiles.
- Two-finger pinch + rotate on mobile.
- Two-finger pitch/tilt.
- Mouse/right-drag rotation on desktop.
- Bearing/compass control.
- Smooth camera transitions and vector rendering.
- No Google Maps API key required.

## Street map

OpenFreeMap Bright vector style:

`https://tiles.openfreemap.org/styles/bright`

OpenFreeMap's public instance requires no API key.

## Satellite

The existing Esri World Imagery and reference-label raster sources are retained for the Satellite toggle.

## Route rendering

Existing vehicle, host, meeting-point, and navigation routes continue using the backend OpenRouteService route coordinates, but are rendered as MapLibre GL line layers.
