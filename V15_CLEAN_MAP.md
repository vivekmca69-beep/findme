# FindMe V15 — Clean Vehicle-Only Map

## Changes
- Removed destination/location search UI completely.
- Removed Google Places autocomplete code and Places-library dependency from the frontend compatibility layer.
- Kept Google Maps + Google Routes vehicle navigation, route alternatives, off-route rerouting, live ETA, camera-follow mode, Redis parking persistence, SignalR groups, and transport modes.
- Reworked fullscreen map controls so the left control stack always reserves space for the right-side fullscreen/recenter controls.
- In fullscreen mode, transport modes use an even 4-column grid instead of an awkward/overflowing row.
- Added safe-area-aware spacing for mobile browsers.
- Hid the passive "Map ready" pill while the map is fullscreen to reduce clutter.
- Saved-parking delete remains separated from Find Vehicle and still requires confirmation.

## Google Cloud
Places API (New) is no longer required by FindMe V15. If you enabled it only for V14 destination search, you can remove it from the browser key's API restrictions / disable it for this app.

The frontend browser key still needs Maps JavaScript API.
The backend server key still needs Routes API.
