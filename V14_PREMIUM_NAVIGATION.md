# FindMe V14 — Premium Navigation

This version continues from V13 and preserves the existing Google Maps + Google Routes + SignalR + Redis architecture.

## Added in V14

### 1. Off-route detection + automatic rerouting
- GPS updates remain frequent.
- FindMe measures the user's distance from the selected route locally.
- A reroute is triggered only after two consecutive clearly off-route fixes.
- The threshold starts at 35 m and automatically expands when GPS accuracy is poor.
- Forced reroutes are rate-limited to protect Google Routes usage.
- A visible `Rerouting…` state appears in navigation mode.

### 2. Live ETA + remaining distance
- Remaining distance and ETA update on every GPS fix using local progress along the current Google route polyline.
- Google Routes is not called on every GPS callback.
- Arrival time is updated from the locally estimated remaining duration.

### 3. Navigation camera mode
- Start navigation enables a Google-style follow camera.
- The camera uses heading + tilt and looks slightly ahead of the user.
- Car/Two-wheeler use a wider camera than Walk/Bike.
- Dragging/zooming the map pauses follow mode.
- Tapping `Re-centre` resumes camera follow.

### 4. Route alternatives
- New backend endpoint: `GET /api/route/alternatives`.
- Google Routes is requested with `computeAlternativeRoutes=true`.
- The mobile preview shows up to three route choices for a clean UI.
- Unselected alternatives appear in grey; the selected route remains Google blue.
- Once navigation starts, alternative lines are hidden to reduce clutter.

### 5. Destination search
- Added Google Place Autocomplete (new widget) above the map.
- Selecting a result immediately calculates routes to that location.
- Destination routes use the same Car / Two-wheeler / Bike / Walk selector.
- Parking persistence remains independent from searched destinations.

### 6. Parking deletion safety
- `Find vehicle` and `Remove parking` are no longer adjacent.
- Remove is placed in a separate Saved Parking management area.
- Removal requires a second confirmation in a modal/bottom sheet.
- Clearing parking does not cancel navigation to an unrelated searched destination.

### 7. Premium UI
- Cleaner map search surface.
- More polished route preview and route option cards.
- Safer vehicle action hierarchy.
- Full-screen navigation with follow-camera indicator.
- Rerouting feedback and compact live navigation footer.

## Google Cloud requirement for Destination Search

The existing browser key currently used for Google Maps must also be permitted to use Place Autocomplete.

In Google Cloud:
1. Enable **Places API (New)** for the existing `FindMe` project.
2. Open the browser key `FindMe-Web-Maps-Key`.
3. Keep the existing website/referrer restrictions.
4. Under API restrictions, keep **Maps JavaScript API** and add **Places API (New)**.
5. Save the key settings.

No new browser environment variable is required. Continue using:

`GOOGLE_MAPS_API_KEY=<existing browser key>`

The backend continues using:

`GoogleRoutes__ApiKey=<existing server Routes key>`

No new backend secret is required.

## Files changed

Frontend:
- `frontend/src/app/app.component.ts`
- `frontend/src/app/app.component.html`
- `frontend/src/app/app.component.css`
- `frontend/src/app/services/route.service.ts`
- `frontend/src/app/map/google-maps-compat.ts`

Backend:
- `backend/FindMe.Api/Controllers/RouteController.cs`

## Deployment

Frontend and backend both changed, so push the whole project/repository.

```bash
git status
git add .
git commit -m "Add premium navigation, rerouting, route alternatives and destination search"
git push
```

Render should redeploy the backend and Cloudflare Pages should rebuild the frontend.
