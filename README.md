# TwistedKart

TwistedKart is a browser multiplayer vehicle-combat project built around a multi-page Vite frontend and an authoritative Colyseus realtime server. The current surfaced product is a battle-first lobby flow; race, Glo Flux, FPS arena, and builder surfaces still exist in the repo but are hidden from the main lobby or entered directly.

## Current Product Reality

- Visible lobby mode: `battle_online` only
- Main surfaced pages: `frontend/index.html` -> `frontend/realtime.html`
- Hidden or direct-entry surfaces:
  - `frontend/gloflux.html`
  - `frontend/fps.html`
  - `frontend/builder.html`
- Core runtime authority lives in:
  - `frontend/src/`
  - `realtime/src/`
- Django is currently thin support infrastructure, not the gameplay center of gravity

## Active Architecture Map

Use this starting path when picking up future work:

1. Frontend entry surface
   - `frontend/vite.config.js`
   - `frontend/index.html`
   - `frontend/realtime.html`
   - `frontend/gloflux.html`
   - `frontend/fps.html`
   - `frontend/builder.html`

2. Lobby, mode exposure, and handoff
   - `frontend/src/game-modes.js`
   - `frontend/src/lobby.js`
   - `frontend/src/lobby-style.css`
   - `realtime/src/rooms/LobbyRoom.js`
   - `realtime/src/schema/LobbyState.js`
   - `realtime/src/schema/LobbyPlayerState.js`

3. Online battle shell
   - `frontend/src/realtime-main.js`
   - `frontend/src/modules/realtime/colyseus-babylon-client.js`
   - `frontend/src/modules/battle-hud.js`
   - `frontend/src/modules/battle-gui-hud.js`
   - `frontend/src/modules/battle/`
   - `frontend/src/modules/babylon-renderer.js`
   - `frontend/src/modules/babylon-track.js`
   - `frontend/src/modules/kart-physics.js`
   - `realtime/src/rooms/BattleRoom.js`
   - `realtime/src/combat.js`
   - `realtime/src/realtime-sync.js`
   - `realtime/src/server-guard.js`
   - `realtime/src/schema/BattleState.js`
   - `realtime/src/schema/PlayerState.js`
   - `realtime/src/schema/EntityState.js`

4. Hidden but live race shell
   - `realtime/src/rooms/RaceRoom.js`
   - `realtime/src/schema/RaceState.js`

5. Experimental branches
   - Glo Flux: `frontend/src/modules/gloflux/`, `realtime/src/rooms/GloFluxRoom.js`
   - FPS arena: `frontend/src/modules/fps/`, `realtime/src/rooms/FpsArenaRoom.js`
   - Builder: `frontend/src/builder-main.js`

6. Verification
   - `frontend/playwright.config.js`
   - `frontend/tests/`
   - `frontend/tests/reports/playwright-results.json`
   - `realtime/reports/load-sync-latest.json`
   - `QA_CHECKLIST.md`

## Current Mode Matrix

| Surface | Exposure | Entry |
| --- | --- | --- |
| Online Battle | Surfaced | `index.html` |
| Online Race | Hidden | direct config / `realtime.html` |
| Glo Flux | Hidden | `gloflux.html` |
| FPS Arena | Hidden | `fps.html` |
| Track Builder | Hidden tool | `builder.html` |

The active product decision in the current repo is to keep battle as the only visible lobby mode until race and the experimental branches are intentionally reintroduced.

## Stack

- Frontend: Vite, Babylon.js, Havok, Colyseus client, vanilla JS/CSS
- Realtime: Colyseus, Express, Zod
- Support backend: Django
- Testing: Playwright for browser flows, load-sync harnesses in `realtime/scripts/`

## Local Development

Prerequisites:

- Node.js 18+
- Python 3.11+ for the optional Django support backend

Start the active battle shell locally:

```powershell
cd frontend
npm install
npm run dev

cd ../realtime
npm install
npm run start
```

Optional support backend:

```powershell
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 8002
```

Default local endpoints:

- Frontend: `http://localhost:5173`
- Realtime: `ws://localhost:2567`
- Django: `http://localhost:8002`

## Verification Baseline

Current minimum must-pass checks for the surfaced battle shell:

- `frontend/tests/03-pvp-session.spec.js`
- `frontend/tests/05-prematch-lobby.spec.js`
- `frontend/tests/30-anomaly-weapons.spec.js`
- `realtime/reports/load-sync-latest.json`

Current checked-in evidence:

- `frontend/tests/reports/playwright-results.json` contains the latest targeted anomaly regression run
- `realtime/reports/load-sync-latest.json` remains the battle scale/load anchor

## Repo Shape

```text
twistedkart/
|- frontend/
|  |- src/
|  |- public/
|  `- tests/
|- realtime/
|  |- src/
|  |- scripts/
|  `- reports/
|- backend/
`- third_party/
```

## Notes

- Treat deleted legacy pages like `game.html`, `battle.html`, `garage.html`, and `splitscreen.html` as historical unless they are reintroduced intentionally.
- When repo reality changes, update `DEVELOPMENT_TASK_LIST.txt` first so future iterations start from the live surface, not historical assumptions.
