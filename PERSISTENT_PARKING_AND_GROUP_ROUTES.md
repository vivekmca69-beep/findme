# FindMe – Persistent Parking & Shared Road Routes

This release fixes four production issues found during real mobile testing.

## 1. Parking is persistent

Parking was previously held in ASP.NET process memory, so a Render sleep/restart could erase it.

Production now stores the parking pin in Redis under the device ID with **no TTL/expiry**. It remains until the user:

- saves a new parking location, which replaces the previous location, or
- clicks **Clear saved vehicle**.

The browser also keeps a localStorage backup on the same device/browser.

After deployment, `/health` should show both stores as Redis:

```json
{
  "status": "ok",
  "sessionStore": "redis",
  "parkingStore": "redis"
}
```

## 2. Vehicle mode is live road navigation

**Find vehicle** now:

1. loads the persisted vehicle coordinate;
2. gets current GPS;
3. requests the walking route from the backend/OpenRouteService;
4. draws a white-cased blue road route;
5. starts `watchPosition()`;
6. moves the same **You** marker as GPS changes; and
7. recalculates the road route after meaningful movement.

Repeated taps do not create old/duplicate current-location markers.

## 3. Group connection is a shared road network

The group uses a host-centred road network:

```text
Person B ── road route ──┐
                         │
Person C ── road route ── HOST ── road route ── Person D
                         │
Person E ── road route ──┘
```

This connects every participant while avoiding a wasteful full mesh of all person-to-person combinations.

## 4. Everyone sees the same routes

Only the host calculates the host-to-participant road route. The resulting geometry is:

- published over SignalR;
- saved in the Redis session; and
- rendered by every connected client.

This avoids every phone making duplicate OpenRouteService requests.

The host refreshes a participant route when enough time/movement has occurred. Participant GPS markers themselves continue to update live through SignalR.

## Production test

1. Deploy backend and frontend.
2. Verify `/health` reports `parkingStore: redis`.
3. Save a vehicle location once using the new build.
4. Wait/reload/restart the browser and verify **Find vehicle** still finds it.
5. Create a group with 3+ phones.
6. Confirm every phone sees all people and host-to-person road routes.
7. Refresh a guest phone and confirm the cached road network restores from Redis.
8. Move one participant far enough and verify the shared road route refreshes.
