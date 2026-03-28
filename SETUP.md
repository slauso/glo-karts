# GLO KARTS — Full Project Setup Guide

> **Branch**: `glokarts-beta`
> **Purpose**: Clean, self-contained snapshot with all frontend, backend, and realtime server code. This is the canonical branch for ongoing development.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ (LTS recommended) | Frontend dev server, realtime server |
| **npm** | 9+ (ships with Node) | Package management |
| **Python** | 3.11.x | Django backend |
| **Git** | 2.30+ | Version control |
| **Git LFS** | 3.x (optional) | Large binary assets (`.glb`, `.ogg`, `.mp3`) — only needed if LFS was configured |

---

## 1. Clone the Repository

```bash
git clone -b glokarts-beta https://github.com/slauso/glo-karts.git
cd glo-karts
```

---

## 2. Frontend Setup

The frontend is a Vite-powered vanilla JS app using Three.js and Babylon.js.

```bash
cd frontend
npm install
```

### Run Development Server

```bash
npm run dev
```

Opens at `http://localhost:5173` by default.

### Build for Production

```bash
npm run build
npm run preview   # preview the production build locally
```

### Key Entry Points

| Page | File | Description |
|------|------|-------------|
| Lobby | `index.html` | Main menu — kart select, mode select, GLO picker |
| Race | `game.html` | Single-player / local race |
| Battle | `battle.html` | Battle mode game |
| Realtime | `realtime.html` | Online multiplayer (Colyseus) |

### Frontend Dependencies (auto-installed via `npm install`)

- `vite` — build tool and dev server
- `three` — 3D rendering (lobby kart preview)
- `@babylonjs/core`, `@babylonjs/gui`, `@babylonjs/loaders`, `@babylonjs/havok` — 3D game engine
- `cannon-es` — physics
- `colyseus.js` — multiplayer client
- `@vercel/analytics` — analytics (optional)

---

## 3. Realtime Server Setup (Colyseus Multiplayer)

```bash
cd realtime
npm install
```

### Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```
COLYSEUS_PORT=2567
CORS_ORIGIN=http://localhost:5173
```

### Run Realtime Server

```bash
npm run dev          # development (auto-restart on changes)
# or
npm start            # production
```

The Colyseus WebSocket server runs on `http://localhost:2567`.

### Realtime Dependencies

- `@colyseus/core`, `@colyseus/schema`, `@colyseus/ws-transport`, `@colyseus/monitor`
- `express`, `cors`, `zod`

---

## 4. Backend Setup (Django API)

```bash
cd backend
python -m venv venv

# Activate virtual environment:
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### Run Django Server

```bash
python manage.py migrate
python manage.py runserver
```

Runs at `http://localhost:8000`.

### Backend Stack

- Django 4.2 + Django REST Framework
- PostgreSQL (via `psycopg2-binary` + `dj-database-url`)
- Gunicorn (production WSGI)
- WhiteNoise (static files)
- CORS headers configured

### Environment Variables (Backend)

Create `backend/.env` if needed:

```
DATABASE_URL=sqlite:///db.sqlite3    # default for local dev
SECRET_KEY=your-secret-key
DEBUG=True
```

---

## 5. Project Structure

```
glo-karts/
├── frontend/               # Vite + Three.js + Babylon.js game client
│   ├── index.html          # Lobby / main menu
│   ├── battle.html         # Battle mode
│   ├── game.html           # Race mode
│   ├── realtime.html       # Online multiplayer
│   ├── src/                # Source code
│   │   ├── lobby.js        # Main lobby controller
│   │   ├── lobby-style.css # All lobby/UI styling
│   │   ├── lobby-car.js    # 3D kart preview
│   │   ├── lobby-track-preview.js  # Track carousel
│   │   ├── game-modes.js   # Mode definitions
│   │   ├── main.js         # Race entry point
│   │   ├── battle-main.js  # Battle entry point
│   │   └── modules/        # Game modules
│   │       ├── battle/     # Battle mode logic
│   │       ├── realtime/   # Multiplayer client modules
│   │       ├── gloflux/    # GLO Flux mode
│   │       ├── fps/        # FPS mode experiments
│   │       └── ...
│   ├── public/             # Static assets (served as-is)
│   │   ├── audio/          # Music & SFX (.ogg, .mp3)
│   │   └── models/         # 3D models (.glb), track data
│   ├── package.json
│   └── vite.config.js
├── backend/                # Django REST API
│   ├── manage.py
│   ├── requirements.txt
│   ├── webracing_backend/  # Django project settings
│   └── Procfile            # Heroku/Render deploy
├── realtime/               # Colyseus multiplayer server
│   ├── src/
│   │   ├── index.js        # Server entry
│   │   ├── rooms/          # Game rooms (Battle, Race, Lobby, etc.)
│   │   └── schema/         # Colyseus state schemas
│   ├── package.json
│   ├── .env.example
│   └── Dockerfile
├── Twisted Kart.code-workspace   # VS Code multi-root workspace
├── SETUP.md                # ← This file
└── README.md
```

---

## 6. Running Everything Together (Local Development)

Open three terminals:

```bash
# Terminal 1 — Frontend
cd frontend && npm run dev

# Terminal 2 — Realtime Server
cd realtime && npm run dev

# Terminal 3 — Backend API
cd backend && .\venv\Scripts\Activate.ps1 && python manage.py runserver
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Realtime (WebSocket) | http://localhost:2567 |
| Backend API | http://localhost:8000 |

---

## 7. VS Code Workspace

Open the multi-root workspace file for the best editor experience:

```
File → Open Workspace from File → "Twisted Kart.code-workspace"
```

---

## 8. Deployment

- **Frontend**: Vercel (see `VERCEL_DEPLOY.md` and `frontend/vercel.json`)
- **Backend**: Heroku/Render (see `DEPLOY.md` and `backend/Procfile`)
- **Realtime**: Docker or any Node.js host (see `realtime/Dockerfile` and `realtime/Procfile`)

---

## 9. Notes

- Font Awesome icons are loaded via CDN (`cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css`)
- 3D assets are from SuperTuxKart (GPL v3 / CC licenses — see `LICENSE`)
- Binary assets (`.glb`, `.ogg`, `.mp3`) are committed directly to the repo
- The `.gitignore` excludes `node_modules/`, `venv/`, `dist/`, `.env`, and editor configs
