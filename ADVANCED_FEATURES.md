# FindMe advanced features

This build adds four requested capabilities on top of the Redis-persistent group session version.

## 1. Map renders immediately
Leaflet is initialized in `ngAfterViewInit()` at a neutral India-wide view. GPS permission is not requested just to render the map. The map recenters when the user starts a GPS action.

## 2. Live navigation mode
Guests can navigate to the host and every participant can navigate to the shared meeting point. The backend now returns OpenRouteService/HeiGIT walking instructions as well as route geometry, distance and duration. While navigation is active, the route is recalculated as the user/target moves and the map follows the user's live position.

## 3. Smart meeting point
The host can create a shared balanced meeting point from the average of all participants that currently have a live GPS position. The point is persisted with the session in Redis and broadcast to the whole group. Everyone can navigate or use compass mode to reach it.

This is a balanced geographic center, not a traffic-aware or venue-aware optimization. A future version can use a routing matrix or POI search to choose the fairest reachable venue.

## 4. Compass mode
Compass mode points directly toward the host or meeting point and shows straight-line distance. iOS may request motion/orientation permission on the button tap. Compass accuracy depends on the phone's sensors and calibration.

## 5. Participant status
Participant rows now show:
- Live: location updated within 15 seconds
- Recent: location updated within 60 seconds
- Offline: no location update for more than 60 seconds
- Waiting for GPS: no location has been received yet

## Deployment note
Both backend and frontend changed. Push the entire project so Render redeploys the backend and Cloudflare Pages rebuilds the frontend.
