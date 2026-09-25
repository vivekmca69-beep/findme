# Group Session Update

The friend session is now a host-based group session.

- The person who creates the 6-digit code is the host.
- Up to 10 people can be in one in-memory session.
- Every connected client receives the complete participant list and each participant's live GPS updates.
- Every participant appears as an individual marker on the map.
- Dashed connector lines are drawn from every participant to the host.
- Non-host users also calculate their own walking route to the host using the existing routing API.
- The participant panel shows all connected names, host status, GPS readiness, and direct distance from the current user.
- If a guest leaves, the room continues.
- If the host ends/leaves the room, the backend closes the session and notifies the remaining clients.

## Test

1. Run backend on port 5000.
2. Run Angular on port 4200.
3. Device A enters a name and creates a group.
4. Devices B/C/etc. enter their names and the same 6-digit code.
5. Allow location access on every device.
6. Each device should display all participants, with the creator marked as HOST.
7. The map should show all markers and host connector lines.
8. A guest should additionally see a walking route to the host when routing is available.
