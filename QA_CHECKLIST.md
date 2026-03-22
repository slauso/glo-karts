# TwistedKart QA Checklist

This checklist tracks the current active runtime, not historical solo pages.

## Surfaced Product Smoke

### Lobby (`frontend/index.html`)

- [ ] Page loads without blocking console errors
- [ ] Only `Online Battle` is visibly exposed in the mode picker
- [ ] Lobby selections route into `realtime.html`
- [ ] Ready/start flow works for a fresh private battle room
- [ ] Arena selection, score limit, and max-player settings persist into the match launch config

### Online Battle (`frontend/realtime.html` -> `battle_room`)

- [ ] Prematch lobby appears and match starts cleanly
- [ ] Both players join the same room and see `matchLive`
- [ ] Arena loads and both karts spawn in valid positions
- [ ] Pickup acquisition updates the active/reserve weapon HUD correctly
- [ ] Primary and secondary fire both work
- [ ] Anomaly weapons behave correctly:
  - [ ] `gravity_well`
  - [ ] `mirror_realm`
  - [ ] `phase_shift`
  - [ ] `memory_leak`
  - [ ] `weather_dominion`
- [ ] Projectile hits, shields, and phase/mirror effects stay authoritative
- [ ] Kill, respawn, and health flows remain stable
- [ ] Match-end/results flow completes without soft-locking

## Hidden / Direct-Entry Smoke

Run these only when work touches the hidden branches.

### Online Race (`frontend/realtime.html` -> `race_room`)

- [ ] Room boots with race config
- [ ] Countdown and lap flow work
- [ ] Remote kart sync stays stable

### Glo Flux (`frontend/gloflux.html`)

- [ ] Page boots without fatal runtime errors
- [ ] Telemetry and anomaly state surface in the client
- [ ] Room lifecycle completes for a multiplayer join

### FPS Arena (`frontend/fps.html`)

- [ ] Page boots without fatal runtime errors
- [ ] Room join succeeds
- [ ] Player movement and weapon loop initialize

### Track Builder (`frontend/builder.html`)

- [ ] Page boots without fatal runtime errors
- [ ] Builder UI loads the current editor state
- [ ] Export/import path still works

## Automated Baseline

Minimum must-pass automated checks for the current surfaced battle shell:

- [ ] `frontend/tests/03-pvp-session.spec.js`
- [ ] `frontend/tests/05-prematch-lobby.spec.js`
- [ ] `frontend/tests/30-anomaly-weapons.spec.js`
- [ ] `realtime/reports/load-sync-latest.json` reviewed as the current battle scale anchor

## Performance / Stability

- [ ] Frontend dev server boots cleanly
- [ ] Realtime server boots cleanly on `:2567`
- [ ] No obvious memory growth during a 10+ minute battle session
- [ ] Sync monitor remains readable under a 2-player local run
- [ ] No repeated reconnect loop or room split under two-client Playwright coverage

## Security / Hygiene

- [ ] Rate limiting still guards weapon-fire and room messages
- [ ] Realtime projectile origin validation still blocks abusive offsets
- [ ] No ROMs or other legally risky binaries are back in the shipping frontend
- [ ] Production monitor/CORS assumptions remain documented before deploy
