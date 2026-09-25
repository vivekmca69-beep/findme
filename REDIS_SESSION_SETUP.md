# Redis session persistence (Upstash + Render)

This version persists **friend/group sessions** in Redis when `REDIS_URL` is configured.
If `REDIS_URL` is missing, it automatically falls back to the in-memory store for local development.

## 1. Create a free Upstash Redis database

1. Sign in to Upstash.
2. Create a Redis database on the free plan.
3. Open the database details / Connect section.
4. Copy the **Redis connection URL** (TLS URL, normally starts with `rediss://`).

Example format only:

`rediss://default:YOUR_PASSWORD@YOUR_HOST:6379`

Do not commit this value to GitHub.

## 2. Add the Redis URL to Render

Render -> findme-api -> Environment -> Edit -> Add environment variable:

- Key: `REDIS_URL`
- Value: paste the full Upstash Redis URL

Keep your existing variables:

- `OpenRouteService__ApiKey`
- `FRONTEND_ORIGINS`

Save changes. Render will redeploy.

## 3. Verify Redis is active

Open:

`https://YOUR-RENDER-SERVICE.onrender.com/health`

Expected response contains:

`"sessionStore":"redis"`

If it says `memory`, `REDIS_URL` is not configured or the service has not redeployed with the updated code.

## 4. What now survives a browser refresh

The browser stores only the active session identity in localStorage:

- session code
- display name
- existing stable device ID

On reload, Angular calls `/api/friend/restore`, reconnects SignalR, rejoins the room, gets the current participant state, restarts GPS sharing, and redraws the map.

## 5. End/leave behavior

- Host clicks **End Session** -> Redis room is deleted and connected participants receive `SessionClosed`.
- Guest clicks **Leave Session** -> only that guest is removed from Redis.
- Page refresh -> does NOT leave the room; the browser reconnects automatically.
- Render restart/spin-down -> room remains in Redis and can be restored after the backend wakes up.

## Note

Parking storage is still in-memory in this version. The Redis change covers the live group/friend session requested here.
