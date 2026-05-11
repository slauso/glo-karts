

# GLO-KARTS + CADKarts

GLO-KARTS is a next-generation real-time multiplayer 3D kart racing platform and track design studio. It combines a powerful CAD-style track builder, instant playtesting, online sharing, and competitive multiplayer racing—all in the browser. Design, test, share, and race on custom tracks with friends or the global community.

## 🚦 Core Scope & Vision

- **Design:** Snap-together track construction kit (inspired by Trackmania/Polytrack) with a 3D editor. Build custom racing circuits or battle arenas from interlocking segments, including curves, straights, banks, jumps, and more.
- **Test:** One-click playtest—instantly drive your creation solo or with friends. Physics and visuals match the final online experience.
- **Share:** Publish a share code or link. Friends can paste it to race the same track, or browse a gallery of community creations.
- **Play Online:** Host or join multiplayer lobbies on any track (official or user-created). Compete in real-time with authoritative physics, leaderboards, and matchmaking.

## ✨ Features

- **CAD-Style Track Builder:** Full 3D editor for snapping, rotating, and customizing track segments. Supports elevation, banking, surface types, and decorative props.
- **Instant Playtest:** Seamless transition from editing to driving—no reloads or exports needed.
- **Track Sharing:** Generate share codes or links for any track. Import and play tracks from the community instantly.
- **Online Multiplayer:** Real-time racing with friends or public lobbies. Authoritative Colyseus backend ensures fair, synchronized gameplay.
- **Physics-Based Driving:** Realistic kart physics (Cannon-es/Ammo.js) with speed-dependent steering, suspension, drifting, and collisions.
- **Custom Karts & Effects:** Choose karts, colors, GLO underglow, and visual FX. All effects and handling are parity-matched between single and multiplayer.
- **Leaderboards & Stats:** Track best times, wins, and global rankings per track.
- **Mobile & Desktop:** Fully playable on desktop and mobile, with touch and keyboard controls.
- **Battle Modes:** Race, battle, and custom game modes supported.
- **Lobby Matchmaking:** Create open/private lobbies, share join codes, or quick-match into open queues.
- **Backend Integration:** Optional Python/Django backend for admin, stats, and moderation.

## 🛠️ Design, Test, Share, Play Workflow

1. **Design:** Use the in-browser CAD editor (`editor.html`) to build tracks from modular segments. Snap, rotate, and elevate pieces. Add props and surface types.
2. **Test:** Click "Playtest" to instantly drive your track in the same physics/visuals as online play. Tweak and iterate without leaving the editor.
3. **Share:** Save your track to a share code or link. Friends can paste this code to load your track, or you can submit it to the community gallery.
4. **Play Online:** Host or join a multiplayer lobby on any track. All players sync to the same layout and compete in real-time.

## Controls

### Desktop
- **W**: Accelerate
- **S**: Brake/Reverse
- **A**: Turn left
- **D**: Turn right
- **Space**: Handbrake/Drift
- **R**: Reset to last checkpoint

### Mobile
- **Virtual Joystick**: Steer, accelerate, brake

## 🧰 Technologies Used

- **Three.js**: 3D rendering engine
- **Cannon-es/Ammo.js**: Physics engine
- **Colyseus**: Authoritative multiplayer backend
- **JavaScript/HTML5/CSS3**: Core frontend
- **Python/Django**: Optional backend/admin

## 📐 Track Builder & CADKarts

- **Snap-together segments**: Build tracks from a library of modular pieces (straights, curves, banks, jumps, etc.)
- **Elevation & Banking**: Create overpasses, tunnels, and banked turns
- **Surface Types**: Asphalt, dirt, ice, boost pads, and more
- **Decorative Props**: Add scenery and obstacles
- **Validation**: Built-in checks for connectivity, lap path, and playability
- **Instant Playtest**: No export or reload—test your track live
- **Share Codes**: Export/import tracks with a simple code or link

## 🏁 Multiplayer & Online Play

- **Authoritative Physics**: All players sync to the same simulation
- **Lobby System**: Open/public and private lobbies, join codes, matchmaking
- **Custom Tracks**: Race on any user-created or official track
- **Leaderboards**: Track best times and wins per track
- **Battle Modes**: Support for race, battle, and custom game types

## 🗂️ Project Structure

- `frontend/` — Main web client, CAD editor, and game UI
- `backend/` — Optional Django backend for stats/admin
- `realtime/` — Node.js Colyseus server for multiplayer
- `tracks/` — Track segment definitions, fixtures, and assets
- `public/` — Audio, models, textures, and static assets

## 🚀 Quick Start

1. `npm install` in `frontend/` and `realtime/`
2. `npm run dev` in both to start the client and multiplayer server
3. Open `index.html` (lobby), `editor.html` (track builder), or `play.html` (playtest)
4. (Optional) Set up `backend/` for admin/stats

## 📝 Credits & License

GLO-KARTS + CADKarts is open source and welcomes contributions. See LICENSE for details.

---




## Features

- **Multiplayer Racing**: Race against friends in real-time using an authoritative Colyseus backend
- **Physics-Based Driving**: Realistic car physics with speed-dependent steering, suspension, and collision detection
- **Multiple Tracks**: Different race tracks with unique layouts and obstacles
- **Checkpoint System**: Race through gates to progress and track your lap time
- **Leaderboard**: Compete for the best times and see rankings
- **Lobby Matchmaking**: Create open/private lobbies, share join codes, or quick-match into open queues
- **Mobile Support**: Optimized for desktop and mobile with touch controls
- **Car Customization**: Choose from various car colors


## Controls

### Desktop
- **W**: Accelerate
- **S**: Brake/Reverse
- **A**: Turn left
- **D**: Turn right
- **R**: Reset car to last checkpoint

### Mobile
- **Virtual Joystick**: Steer the car (left side of screen)
- **Joystick Up**: Accelerate
- **Joystick Down**: Brake/Reverse
- **Joystick Left/Right**: Turn

## 🧰 Technologies Used

- **Three.js**: 3D rendering engine
- **Ammo.js**: Physics engine (WebAssembly port of Bullet Physics)
- **Colyseus**: Authoritative realtime multiplayer rooms (`race_room`, `battle_room`)
- **JavaScript**: Core programming language
- **HTML5/CSS3**: Frontend structure and styling
- **Python/Django**: Optional backend/admin services

## Realtime Migration (Colyseus + Babylon.js)

The default multiplayer path now uses authoritative Colyseus rooms.

- **Authoritative server**: `realtime/` (Node.js + Colyseus)
- **Room types**: `race_room`, `battle_room`
- **Lobby room**: `lobby_room` for open/private party signaling and pre-match settings
- **Schema sync**: position, velocity, rotation, health/score, and input acknowledgements (`lastProcessedInput`)
- **Prediction/reconciliation client**: `frontend/src/modules/realtime/colyseus-babylon-client.js`
- **Customization sync**: `kartId`, `playerColor`, `gloEffect`, `gloColor`, `gloColor2`

The matchmaking flow supports race and battle modes with open/public quick-match queues and private code-based lobbies. Room isolation uses `partyCode` filters so multiple lobbies can run concurrently (targeting 100+ concurrent users across rooms, with per-match caps configured in lobby settings).

### Run realtime server

```powershell
./start-realtime.ps1
```

or manually:

```powershell
cd realtime
npm install
npm run dev
```

### Colyseus frontend configuration

Set the following in your active Vite env file:

- `VITE_USE_COLYSEUS=true`
- `VITE_COLYSEUS_URL=ws://localhost:2567`

`VITE_USE_COLYSEUS` now defaults to `true` if unset.

### Lobby UX regression (Playwright)

Run the focused lobby flow regression (private race, private battle, open quick-match):

```powershell
cd frontend
npm run test:lobby:regression
```

The script validates create/join/start routing to `realtime.html`, race/battle mode settings propagation, and core customization selections across host/guest clients.

## 🚀 Deployment Guide

### 1. Prepare Environment Variables

- Frontend (Vite): set `VITE_COLYSEUS_URL=wss://realtime.your-domain.com` in your production env (or `ws://localhost:2567` for local).
- Backend (Django): configure `DJANGO_SECRET_KEY`, `ALLOWED_HOSTS`, and `CORS_ALLOWED_ORIGINS`. Example for Render: `ALLOWED_HOSTS=twistedkart-backend.onrender.com` and `CORS_ALLOWED_ORIGINS=https://play.twistedkart.com`.

### 2. Deploy the Backend (Render Free Tier)

1. **Push code**: publish the `backend/` folder to a GitHub repo (monorepo works fine).
2. **Create service**: in Render select **New → Web Service** and connect that repo.
3. **Configure build**:
	- Root directory: `backend`
	- Build command: `pip install -r requirements.txt`
	- Start command: `gunicorn webracing_backend.wsgi`
4. **Environment variables** (Render dashboard → Environment):
	- `DJANGO_SECRET_KEY=generate-a-strong-secret`
	- `ALLOWED_HOSTS=twistedkart-backend.onrender.com`
	- `CORS_ALLOWED_ORIGINS=https://play.twistedkart.com`
	- Optional: `CORS_ALLOW_ALL_ORIGINS=True` during early testing only.
5. **Persistent storage**: add a disk (1 GB free) at path `/opt/render/project/src/backend/db.sqlite3` to keep SQLite data.
6. **Migrations**: open Render shell → `python manage.py migrate`; add an admin user if desired with `python manage.py createsuperuser`.
7. **Static files**: run `python manage.py collectstatic --noinput` if you enable DJANGO static hosting later (WhiteNoise already configured).
8. **Test endpoint**: `curl https://twistedkart-backend.onrender.com/` should return API metadata.

### 3. Deploy the Frontend (Netlify or Vercel)

1. **Local smoke test**: `cd frontend && npm install && npm run build`.
2. **Netlify setup**:
	- Import Git repo or use `netlify deploy --prod` with root `frontend`.
	- Build command: `npm run build`
	- Publish directory: `frontend/dist`
	- Environment → add `VITE_COLYSEUS_URL=wss://realtime.your-domain.com`
	- Hit _Deploy site_ and verify at the Netlify preview URL.
3. **Vercel alternative**:
	- Vercel dashboard → **Add New Project**, select repo, set Framework = Vite.
	- Root directory: `frontend`
	- Build command: `npm run build`
	- Output directory: `dist`
	- Environment variable: `VITE_COLYSEUS_URL=wss://realtime.your-domain.com`
	- Deploy and check preview at `https://twistedkart.vercel.app` (example).
4. **Custom domain**: point `play.twistedkart.com` (A/ALIAS or CNAME) at Netlify/Vercel; add the domain in hosting dashboard to enable managed TLS.

### 4. Configure Networking

- Ensure HTTPS/WSS on frontend, API backend, and realtime backend.
- Configure `VITE_COLYSEUS_URL` to your realtime endpoint (for example `wss://realtime.twistedkart.com`).
- Add a DNS record (e.g., `play.twistedkart.com`) pointing to your hosting provider and connect it via Netlify/Vercel dashboard.

With these steps the lobby will create and join parties using your own Twisted Kart infrastructure.
