# FindMe V16 – Premium Group Navigation

This update extends the existing V14/V15 premium saved-vehicle navigation behavior to the Group Meet-up flow without changing the Google Maps / Google Routes / SignalR / Redis architecture.

## Group navigation behavior

When a guest taps **Navigate to host**:

1. The live host GPS becomes the navigation destination.
2. Google road-route alternatives are requested for the initial route preview (up to the backend's existing limit of three).
3. The user selects a route and taps **Start**.
4. Navigation mode uses the existing premium guidance UI.
5. Remaining distance, duration and arrival time update locally from route progress.
6. Manual map pan/zoom disables follow-camera; **Re-centre** enables it again.
7. Consecutive off-route fixes trigger rate-limited rerouting.
8. Host movement updates the destination. A new Google route is requested only after meaningful target movement and a cooldown, rather than on every SignalR/GPS update.

## API/cost safeguards

- Existing `Google Routes API` endpoints are reused; no new backend API is required.
- Group-session GPS watcher is reused during group navigation, avoiding a second geolocation watcher.
- Moving-host route refresh: minimum ~20 m target/origin movement and 15 s cooldown.
- Off-route rerouting keeps the existing consecutive-fix and cooldown protections.
- Live ETA/distance is still calculated locally between route API refreshes.

## Files changed

- `frontend/src/app/app.component.ts`
- `frontend/src/app/app.component.html`
- `V16_GROUP_PREMIUM_NAVIGATION.md`

No backend source changes were required.
