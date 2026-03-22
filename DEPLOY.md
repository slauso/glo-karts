# GLO KARTS — Full-Stack Deployment Guide

GLO KARTS consists of three services that must be deployed and configured together:

| Service | Technology | Default Port | Recommended Host |
|---------|-----------|-------------|-----------------|
| **Frontend** | Vite (static) | 5173 (dev) | Vercel |
| **Backend** | Django + DRF | 8002 (dev) | Koyeb / Railway |
| **Realtime** | Colyseus + Express | 2567 | Fly.io / Railway / Render |

## Deployment Order

1. **Backend** (Django) — deploy first; no external dependencies
2. **Realtime** (Colyseus) — deploy second; needs CORS_ORIGIN pointing to frontend
3. **Frontend** (Vite) — deploy last; needs `VITE_COLYSEUS_URL` pointing to realtime

## Render Blueprint

The repo root includes a `render.yaml` Blueprint that provisions:

- `glo-karts-frontend` as a static site from `frontend/`
- `glo-karts-realtime` as a Node web service from `realtime/`
- `glo-karts-backend` as a Python web service from `backend/`
- `glo-karts-db` as a managed PostgreSQL instance

For production, the Blueprint intentionally leaves the following values as Render prompts so you can supply your final public domains during the first sync:

- `VITE_COLYSEUS_URL`
- `CORS_ORIGIN`
- `CORS_ALLOWED_ORIGINS`
- `ALLOWED_HOSTS`
- `REALTIME_HEALTH_URL`

If you deploy first on temporary Render subdomains and later add custom domains, update those environment variables in the Render dashboard and redeploy the affected services.

---

## 1. Frontend (Vercel)

See also: [QUICKSTART_VERCEL.md](QUICKSTART_VERCEL.md), [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md)

### Setup
- **Root directory**: `frontend`
- **Framework preset**: Vite
- **Build command**: `npm run build`
- **Output directory**: `dist`

### Environment Variables

```bash
VITE_COLYSEUS_URL=wss://your-realtime-server.fly.dev
```

### Verification
- Visit `/` → lobby loads with kart selector
- Visit `/game` → solo race starts
- Visit `/battle` → solo battle starts
- Visit `/realtime` → multiplayer lobby (requires realtime server)
- Visit `/builder` → Track Builder opens

---

## 2. Backend / Django API (Koyeb)

### Repository Setup
- **Work Directory**: `backend`
- **Build Command**: Leave empty (buildpack handles pip install + collectstatic automatically)
- **Run Command**: Leave empty (uses `Procfile`)

### Environment Variables

Required for production:

```bash
# Security
SECRET_KEY=your-long-random-secret-key-here
DEBUG=False

# Allowed Hosts (optional - defaults to .koyeb.app)
ALLOWED_HOSTS=glo-karts.koyeb.app,www.glo-karts.koyeb.app

# CORS (if frontend is on different domain)
CORS_ALLOWED_ORIGINS=https://your-frontend.com
# Or allow all origins for development (not recommended for production)
CORS_ALLOW_ALL_ORIGINS=True
```

### Default Configuration

If environment variables are not set:
- `DEBUG` defaults to `False`
- `ALLOWED_HOSTS` defaults to `[".koyeb.app", "localhost", "127.0.0.1"]`
- Database defaults to SQLite (will be ephemeral on Koyeb)

### Production Database

For persistent data, add a PostgreSQL database:

1. Add PostgreSQL service in Koyeb
2. Set `DATABASE_URL` environment variable (dj-database-url will parse it automatically)

Example:
```bash
DATABASE_URL=postgres://user:password@host:5432/dbname
```

### Static Files

Static files are served via WhiteNoise middleware. Collectstatic runs automatically during build.

### Post-Deploy

After deployment, your app will be available at:
- `https://[your-app-name].koyeb.app/`

Test endpoints:
- Admin: `https://[your-app-name].koyeb.app/admin/`
- API: `https://[your-app-name].koyeb.app/api/` (check your `urls.py`)

### Troubleshooting

**400 Bad Request**: Check `ALLOWED_HOSTS` environment variable includes your domain
**500 Server Error**: Check Koyeb logs and ensure `SECRET_KEY` is set
**Static files not loading**: Verify WhiteNoise is in `MIDDLEWARE` and `collectstatic` ran during build

### Local Development

```bash
cd backend
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux

pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8002
```

---

## 3. Realtime / Colyseus WebSocket Server

### Docker Deployment (Recommended)

```bash
cd realtime
docker build -t glo-karts-realtime .
docker run -d -p 2567:2567 \
  -e NODE_ENV=production \
  -e CORS_ORIGIN=https://your-frontend.vercel.app \
  glo-karts-realtime
```

### Platform Deployment

**Fly.io:**
```bash
cd realtime
fly launch --no-deploy
# Set env vars
fly secrets set CORS_ORIGIN=https://your-frontend.vercel.app NODE_ENV=production
fly deploy
```

**Render / Railway / Heroku:**
- Use the `Procfile` in `realtime/`
- Set root/build directory to `realtime`
- Set env vars: `CORS_ORIGIN`, `NODE_ENV=production`

### Environment Variables

```bash
COLYSEUS_PORT=2567        # WebSocket port (default: 2567)
CORS_ORIGIN=https://...   # Frontend URL for CORS (leave empty for open CORS in dev)
NODE_ENV=production        # Disables /colyseus monitor endpoint
```

### Health Check

```
GET /health → { "ok": true, "rooms": <count>, "uptime": <seconds> }
```

### Verification

After deployment:
1. `curl https://your-realtime-server/health` → `{"ok":true, ...}`
2. In browser, visit frontend `/realtime` → multiplayer lobby should connect

### Local Development

```bash
cd realtime
npm install
node src/index.js
# Server starts on http://localhost:2567
```

---

## 4. Django Backend Role (v1.0)

For v1.0, the Django backend is **optional**. The game runs fully with just Frontend + Realtime. The backend provides:
- Admin panel (Django admin)
- Future: player profiles, leaderboards, match history

If not using the backend, you only need to deploy Frontend and Realtime.

---

## Local Development (All Services)

Start all three services for local development:

```bash
# Terminal 1: Frontend
cd frontend && npm run dev
# → http://localhost:5173

# Terminal 2: Realtime
cd realtime && node src/index.js
# → http://localhost:2567

# Terminal 3: Backend (optional)
cd backend && python manage.py runserver 8002
# → http://localhost:8002
```

Or use VS Code tasks: "Start Backend (Django :8002)" is pre-configured.

---

## Post-Deploy Smoke Checks

1. **Frontend**: Visit `/` — lobby loads, kart selector works
2. **Frontend**: Visit `/game` — solo race starts with countdown
3. **Realtime**: `GET /health` → `200 OK`
4. **Frontend**: Visit `/realtime` — connects to WebSocket, prematch lobby shows
5. **Backend** (if deployed): Visit `/admin/` — Django admin loads
