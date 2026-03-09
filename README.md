# GLO KARTS

![GLO KARTS](frontend/public/favicon.png)

**A browser-native, multiplayer 3D kart racing and battle game** — featuring 19 playable characters, 20 race tracks, 10 battle arenas, 28 animated underglow effects, and an authoritative Colyseus netcode backend. Built entirely with modern web technologies, no plugins or installs required.

> [Play GLO KARTS Online](https://racez.io)

---

## Project Overview

GLO KARTS is a full-stack multiplayer game running in the browser. Players pick a kart, customise their GLO underglow, create or join lobbies, and race or battle across dozens of tracks converted from the open-source SuperTuxKart project. The game handles physics, rendering, matchmaking, and state synchronisation across clients in real time.

### Scale

| Dimension | Count |
|-----------|-------|
| Playable karts | **19** (18 in lobby picker) |
| Race tracks | **20** (2 custom + 18 STK conversions) |
| Battle arenas | **10** |
| GLO underglow effects | **28** across 4 themed categories |
| Game modes | **8** (5 solo, 2 online, 1 tool — race, battle, free roam, track builder) |
| Concurrent lobby capacity | **100** connections per room; **12** players per match |

---

## Game Modes

| Category | Mode | Status |
|----------|------|--------|
| Solo | Quick Race | Ready |
| Solo | Time Trial | Planned |
| Solo | Grand Prix | Planned |
| Solo | Free Roam | Planned |
| Solo | Battle (Deathmatch / CTF) | Ready |
| Online | Online Race | Ready |
| Online | Online Battle | Ready |
| Tools | Track Builder | Ready |

Battle mode supports **Deathmatch** and **Capture the Flag** sub-types with configurable max players, bot count, score limit, collision damage, and weapon loadout.

The **Track Builder** lets players design custom tracks with drag-and-place segments, obstacles, checkpoints, and start positions. Tracks can be exported as JSON, shared via encoded share codes (`TK1:` prefix), and test-driven in solo race or battle mode.

---

## Features

- **Multiplayer Racing & Battle** — real-time authoritative Colyseus rooms with client-side prediction and server reconciliation
- **Physics-Based Driving** — Ammo.js (Bullet Physics WASM) with speed-dependent steering, suspension, and collision
- **Lobby Matchmaking** — create private parties with share codes, join by code, or quick-match into open queues
- **GLO Underglow System** — 28 animated effects (Solid, Pulse, Strobe, Rainbow, Aurora, Firefly, Ocean, and more), dual-colour support, synced across multiplayer
- **Liquid Glass UI** — Apple-inspired frosted-glass design system with conic-gradient halos, animated spotlights, and `@property` Houdini-powered CSS animations
- **19 Kart Characters** — full 3D `.glb` models converted from SuperTuxKart with recomputed normals and double-sided materials
- **30 Playable Maps** — 20 race tracks + 10 battle arenas with device-aware quality tiers (lite / balanced / full)
- **Mobile Touch Controls** — virtual joystick optimised for phones and tablets
- **Track Thumbnail Previews** — animated GIF + static JPG thumbnails for every map
- **Background Music** — STK-sourced soundtrack with per-scene tracks and mute toggle
- **Track Builder** — in-browser 3D track editor with segment palette, obstacle placement, validation, share codes, and test-race/battle integration

---

## Tech Stack

### Frontend

| Technology | Role |
|------------|------|
| **Three.js** | 3D rendering engine (lobby kart preview, solo race, solo battle) |
| **Babylon.js** | 3D rendering for online multiplayer rooms |
| **Ammo.js** | Physics engine (WebAssembly port of Bullet Physics) |
| **Havok** | Physics engine alternative (Babylon.js integration) |
| **Colyseus.js** | Client SDK for authoritative multiplayer |
| **Vite** | Build toolchain and dev server |
| **Playwright** | End-to-end testing (lobby regression, map viability, PvP, spawn) |
| **Vanilla JS + CSS3** | No framework — hand-written modules, CSS custom properties, Houdini `@property` |

### Backend

| Technology | Role |
|------------|------|
| **Django 4.2** | REST API, admin panel, user services |
| **Django REST Framework** | API serialisation |
| **Gunicorn** | Production WSGI server |
| **WhiteNoise** | Static file serving |
| **PostgreSQL** (optional) | Production database via `dj-database-url` |
| **SQLite** | Default local development database |

### Realtime Server

| Technology | Role |
|------------|------|
| **Colyseus 0.16** | Authoritative game server with schema-based state sync |
| **Express 4** | HTTP layer for health checks and Colyseus monitor |
| **Zod** | Runtime validation for room messages |
| **3 Room Types** | `lobby_room`, `race_room`, `battle_room` |
| **6 Schema Files** | BattleState, EntityState, LobbyPlayerState, LobbyState, PlayerState, RaceState |

### Deployment Targets

| Service | Component |
|---------|-----------|
| **Vercel** | Frontend SPA |
| **Koyeb / Render** | Django backend |
| **Any Node.js Host** | Colyseus realtime server (port 2567) |

---

## GLO Underglow System

The signature visual customisation feature. Every kart has a dynamic underglow rendered as a dual-mesh radial gradient (outer halo + inner disc) with additive blending.

**28 effects across 4 categories:**

| Classic | Warm & Sky | Nature | Water & Weather |
|---------|-----------|--------|-----------------|
| Solid | Sunrise | Spring | Ocean |
| Pulse | Sunset | Rainbow | Waterfall |
| Strobe | Sunset Glow | Aurora | River |
| Rainbow Cycle | Fire | Forest | Wave |
| Two-Color | Falling Leaves | Spring Wind | Raining |
| Chase | | Falling Petals | Snowing |
| | | Firefly | Cloudy |
| | | | Water Drop |

- **Dual-colour support** — primary + secondary for blended/gradient effects
- **Lobby sync** — `gloEffect`, `gloColor`, `gloColor2` synced via Colyseus schema
- **Reactive UI** — lobby background, panel borders, button tints, and title glow all track the active GLO colour in real time via CSS custom properties (`--glo-rgb`)

---

## UI Design System — Liquid Glass v3

An Apple-inspired frosted-glass design language built entirely in CSS:

- **Frosted panels** — `backdrop-filter: blur() saturate()` with multi-layer box shadows and specular inset rims
- **Animated halos** — `@property`-powered conic-gradient rings around the kart preview
- **Rotating spotlight** — slow conic-gradient sweep under the 3D kart, tinted by GLO colour
- **Shimmer animation** — travelling light streaks across panels with staggered timing
- **Spring-physics entry** — `cubic-bezier(0.16,1,0.3,1)` panel entrance animations
- **Fully `prefers-reduced-motion` aware** — all decorative animation stripped for accessibility

---

## Attributions

### SuperTuxKart

GLO KARTS uses converted 3D models (tracks, arenas, karts) and music from **[SuperTuxKart](https://supertuxkart.net/)**, an open-source kart racing game licensed under **GPL v3**. All STK assets are stored as `.glb` conversions under `frontend/public/models/stk/` and audio under `frontend/public/audio/music/`.

- **SuperTuxKart Project** — https://supertuxkart.net/
- **SuperTuxKart Source** — https://github.com/supertuxkart/stk-code
- **License** — GNU General Public License v3.0

### Open-Source Libraries

| Library | License |
|---------|---------|
| Three.js | MIT |
| Babylon.js | Apache-2.0 |
| Ammo.js | zlib |
| Colyseus | MIT |
| Django | BSD-3-Clause |
| Vite | MIT |
| Playwright | Apache-2.0 |

---

## Controls

### Desktop
| Key | Action |
|-----|--------|
| **W** | Accelerate |
| **S** | Brake / Reverse |
| **A** | Turn left |
| **D** | Turn right |
| **R** | Reset to last checkpoint |

### Mobile
- **Virtual Joystick** (left side) — steer, accelerate, brake

---

## Development Ambitions & Goals

- **Scalable multiplayer** — target 100+ concurrent users across isolated rooms with authoritative server-side physics
- **Cross-platform browser play** — desktop and mobile with zero installs, optimised for low-end devices via device-aware asset tiers
- **Complete competitive experience** — ranked matchmaking, Grand Prix tournament mode, Time Trial leaderboards
- **Community content pipeline** — tooling to import and convert new STK tracks and karts (`npm run import:stk`, `npm run scan:stk`)
- **Production deployment** — Vercel (frontend) + managed Node.js (Colyseus) + Koyeb/Render (Django API) with TLS everywhere
- **Comprehensive test coverage** — Playwright E2E suites for lobby UX, spawn sequences, map viability, PvP sessions, and kart scaling
- **Polished visual identity** — Liquid Glass UI system, GLO underglow as the signature brand element, animated CSS flourishes using cutting-edge Houdini features
---

## Local Development

### Prerequisites

- Node.js 18+
- Python 3.11+
- Git LFS (for binary assets: `.glb`, `.mp3`, `.ogg`, `.zip`)

### Quick Start

```powershell
# Clone and pull LFS assets
git clone https://github.com/slauso/glo-karts.git
cd glo-karts
git lfs pull

# Frontend
cd frontend
npm install
npm run dev          # → http://localhost:5173

# Realtime server (new terminal)
cd realtime
npm install
npm run dev          # → ws://localhost:2567

# Django backend (new terminal)
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8002   # → http://localhost:8002
```

### VS Code Task

The workspace includes a pre-configured task **"Start Backend (Django :8002)"** that sets `DEBUG=True` and `CORS_ALLOW_ALL_ORIGINS=True` automatically.

### Multiplayer Testing

With all three servers running, open **two browser windows** at `http://localhost:5173/` to test multiplayer locally.

### Test Suites

```powershell
cd frontend
npm test                      # All Playwright tests
npm run test:lobby:regression # Lobby UX flow regression
npm run test:spawn            # Spawn sequence
npm run test:maps             # Map viability audit
npm run test:pvp              # PvP session
npm run test:scaling          # Kart scaling
```

---

## Deployment

| Component | Target | Docs |
|-----------|--------|------|
| Frontend (Vite SPA) | Vercel | [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md), [QUICKSTART_VERCEL.md](QUICKSTART_VERCEL.md) |
| Django Backend | Koyeb / Render | [DEPLOY.md](DEPLOY.md) |
| Colyseus Realtime | Any Node.js host | Port 2567 |

### Environment Variables

| Variable | Where | Example |
|----------|-------|---------|
| `VITE_COLYSEUS_URL` | Frontend | `wss://realtime.your-domain.com` |
| `DJANGO_SECRET_KEY` | Backend | (generate a strong secret) |
| `ALLOWED_HOSTS` | Backend | `api.your-domain.com` |
| `CORS_ALLOWED_ORIGINS` | Backend | `https://play.your-domain.com` |
| `COLYSEUS_PORT` | Realtime | `2567` |

---

## Project Structure

```
glo-karts/
├── frontend/          # Vite SPA — game client, lobby, assets
│   ├── src/           # JS modules, CSS, game logic
│   ├── public/        # Static assets (models, audio, thumbs)
│   └── tests/         # Playwright E2E test suites
├── backend/           # Django REST API + admin
│   ├── source_engine/ # Django app
│   └── webracing_backend/  # Django project settings
├── realtime/          # Colyseus authoritative game server
│   └── src/           # Rooms, schemas, index
├── tools/             # Import/conversion utilities
└── third_party/       # External dependencies
```

---

## License

This project incorporates assets from [SuperTuxKart](https://supertuxkart.net/) under the **GNU General Public License v3.0**. See [LICENSE](LICENSE) for details.
