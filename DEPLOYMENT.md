# FindMe Free Deployment

## Architecture
- Frontend: Cloudflare Pages
- Backend: Render Free Web Service (Docker)
- Routing: OpenRouteService
- Realtime: ASP.NET Core SignalR / WebSockets
- Session persistence: Redis (Upstash recommended)

## 1. Push this folder to GitHub
Do not commit a real OpenRouteService API key. `appsettings.Development.json` is ignored.

## 2. Deploy backend on Render
Create a new Blueprint from the GitHub repository using `render.yaml`, or create a Web Service manually with:
- Runtime: Docker
- Root directory: `backend/FindMe.Api`
- Dockerfile: `Dockerfile`
- Plan: Free
- Health check: `/health`

Set environment variables:
- `OpenRouteService__ApiKey` = your OpenRouteService key
- `FRONTEND_ORIGINS` = temporary value `http://localhost:4200` until Cloudflare is deployed
- `REDIS_URL` = your Upstash Redis TLS connection URL (normally starts with `rediss://`)

After deployment note the URL, for example:
`https://findme-api.onrender.com`

Verify:
`https://findme-api.onrender.com/health`

## 3. Deploy frontend on Cloudflare Pages
Connect the same GitHub repository.

Settings:
- Root directory: `frontend`
- Build command: `npm run build`
- Build output directory: `dist/findme-web/browser`

Add build environment variable:
- `API_BASE_URL` = your Render URL, e.g. `https://findme-api.onrender.com`

Deploy. Cloudflare gives a URL such as:
`https://findme-web.pages.dev`

## 4. Update Render CORS
Set Render environment variable:
- `FRONTEND_ORIGINS` = `https://findme-web.pages.dev`

For multiple allowed origins, separate them with commas, e.g.:
`https://findme-web.pages.dev,http://localhost:4200`

Render restarts after the environment variable change.

## 5. Test
Open the Cloudflare URL on two or more phones using mobile data.
- Allow location access.
- Person A creates a group.
- Other people join with the six-digit code.
- Everyone should see all connected participants.
- Guests should see their walking route to the host.

## Local development
Backend:
```bash
cd backend/FindMe.Api
dotnet run
```

Frontend:
```bash
cd frontend
npm install
npm start
```

The committed frontend development config points to `http://localhost:5000`.
For LAN testing, either temporarily set the generated environment file to your LAN backend URL or run a local build with:
```bash
API_BASE_URL=http://192.168.1.5:5000 npm run build
```

## Persistence behavior
Friend/group sessions are stored in Redis when `REDIS_URL` is configured, so they survive Render restarts and browser refreshes. The frontend stores the active session code/name locally and automatically restores the room after reload.

Parked vehicle state is still stored in backend memory in this version and can be moved to Redis/database later.
