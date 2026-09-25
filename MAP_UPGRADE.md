# FindMe map upgrade

This build uses **Leaflet + OpenStreetMap standard tiles** for the basemap.

- No Google Maps API key is required.
- No Mapbox/CARTO API key is required.
- Full-screen map mode is retained.
- Participant auto-fit/zoom is retained.
- Guest-to-host walking route auto-display is retained.
- Live navigation, meeting point, compass and participant status are retained.

## Important

The **map tiles** are keyless. Walking-route/navigation calculations still use the backend OpenRouteService integration, so `OpenRouteService__ApiKey` must remain configured on Render for production routing.

For local development without an OpenRouteService key, the map itself still loads normally.
