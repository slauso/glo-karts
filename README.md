# Twisted Kart
*GLO EDITION*

![Twisted Kart](frontend/public/favicon.png)

A real-time multiplayer 3D racing game built with JavaScript and modern web technologies. Race with friends through various tracks, compete for the best time, and enjoy physics-based driving mechanics.

## Play Now

[Play Twisted Kart Online](https://racez.io)

## Features

- **Multiplayer Racing**: Race against friends in real-time using WebRTC peer-to-peer connections
- **Physics-Based Driving**: Realistic car physics with speed-dependent steering, suspension, and collision detection
- **Multiple Tracks**: Different race tracks with unique layouts and obstacles
- **Checkpoint System**: Race through gates to progress and track your lap time
- **Leaderboard**: Compete for the best times and see rankings
- **Party System**: Create or join racing parties with simple code sharing
- **Mobile Support**: Optimized for desktop and mobile with touch controls
- **Car Customization**: Choose from various car colors

## How to Play

### Creating a Game

1. Visit the Twisted Kart website
2. Enter your name
3. Choose your car color
4. Click "Create Party"
5. Share the generated party code with friends
6. Select a track from the dropdown menu
7. Click "Start Race" when everyone is ready

### Joining a Game

1. Visit the Twisted Kart website
2. Enter your name
3. Choose your car color
4. Enter the party code provided by the host
5. Click "Join Party"
6. Wait for the host to start the race

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
- **PeerJS**: WebRTC peer-to-peer connections
- **JavaScript**: Core programming language
- **HTML5/CSS3**: Frontend structure and styling
- **Python/Django**: Backend server for matchmaking and party code management

## 🚀 Deployment Guide

### 1. Prepare Environment Variables

- Frontend (Vite): copy `frontend/.env.example` to `.env.development` and `.env.production`. Set `VITE_API_URL=https://api.twistedkart.com` (replace with your backend URL). The lobby now reads this value automatically and falls back to `window.location.origin` during local dev.
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
8. **Test endpoint**: `curl https://twistedkart-backend.onrender.com/api/party-codes/health/` (create a simple view) or hit the create/lookup endpoints from the lobby.

### 3. Deploy the Frontend (Netlify or Vercel)

1. **Local smoke test**: `cd frontend && npm install && npm run build`.
2. **Netlify setup**:
	- Import Git repo or use `netlify deploy --prod` with root `frontend`.
	- Build command: `npm run build`
	- Publish directory: `frontend/dist`
	- Environment → add `VITE_API_URL=https://twistedkart-backend.onrender.com`
	- Hit _Deploy site_ and verify at the Netlify preview URL.
3. **Vercel alternative**:
	- Vercel dashboard → **Add New Project**, select repo, set Framework = Vite.
	- Root directory: `frontend`
	- Build command: `npm run build`
	- Output directory: `dist`
	- Environment variable: `VITE_API_URL=https://twistedkart-backend.onrender.com`
	- Deploy and check preview at `https://twistedkart.vercel.app` (example).
4. **Custom domain**: point `play.twistedkart.com` (A/ALIAS or CNAME) at Netlify/Vercel; add the domain in hosting dashboard to enable managed TLS.

### 4. Configure Networking

- Keep the default PeerJS Cloud signalling server or host your own for more control.
- Ensure HTTPS on both frontend and backend (required for WebRTC).
- Add a DNS record (e.g., `play.twistedkart.com`) pointing to your hosting provider and connect it via Netlify/Vercel dashboard.
- If launching at scale, provision a TURN server (e.g., [coturn](https://github.com/coturn/coturn) or a managed provider) and pass its credentials through PeerJS options.

### 4. Configure Networking

- Keep the default PeerJS Cloud signalling server or host your own for more control.
- Ensure HTTPS on both frontend and backend (required for WebRTC).
- Add a DNS record (e.g., `play.twistedkart.com`) pointing to your hosting provider and connect it via Netlify/Vercel dashboard.

With these steps the lobby will create and join parties using your own Twisted Kart infrastructure.
