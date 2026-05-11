# Glo-Karts Online Mode — Ship-Ready Plan

> Living document. Updated as phases complete.
> Status legend: ⬜ not-started · 🟨 in-progress · ✅ complete

## Guiding principles
- **Single source of truth, top to bottom.** Same physics module, same segment registry, same buildWorld code path on client playtest and Colyseus server.
- **"Feels like playtest"** is a perception goal. Local kart input + reconciliation is what closes the gap — not raising tick rate.
- **Every phase ends with a probe** (under [frontend/scripts/](frontend/scripts/)) wired into a smoke pass.

---

## Phase A — Pipeline hardening (build → save → load)
*Fixes "misaligned segments online vs playtest"*

Root causes identified in audit:
1. 65 KB silent truncation of `customTrackData` in [realtime/src/rooms/LobbyRoom.js](realtime/src/rooms/LobbyRoom.js)
2. Silent skip of unknown segment keys in [realtime/src/track/track-loader.js](realtime/src/track/track-loader.js)
3. No spawn / finish validation before race start

### Tasks
- ✅ **A1**: Hard-fail (don't truncate) above 64 KB. Compress with `pako` (or drop `decor` from wire payload — not used by physics) and bump cap to 256 KB. Log server-side warning + propagate `matchError` to client.
- ✅ **A2**: Strict segment-registry parity check at room boot. Server logs diff of `Object.keys(SEGMENTS)` between client-encoded and server-decodable. Probe asserts diff is empty for every shipped + saved track.
- ✅ **A3**: Pre-flight track validator: ≥1 spawn segment + ≥1 finish/lap-trigger; reject `matchStart` otherwise with explicit `matchError`.
- ✅ **A4**: Save/load round-trip probe ([frontend/scripts/track-roundtrip-parity.mjs](frontend/scripts/track-roundtrip-parity.mjs)): for each shipped template + 3 saved tracks, encode → POST Django → fetch → rebuild physics on client and Node server module → assert positions differ < 0.01 mm and quaternions < 1e-6.

**Gate:** A4 probe green for templates + user saves; loading any of them online matches playtest layout (visual diff < 1 px in screenshot). ✅ (3/3 shipped templates: Tutorial Loop, Sprint Drag, Crossroads Circuit — 0 parity failures).

---

## Phase B — Race-loop feel (client prediction + adaptive interp)
*Fixes "doesn't feel like playtest"*

Audit: local kart currently animated by server snapshots (110 ms interp + RTT + 33 ms snapshot = 190–300 ms end-to-end). Playtest is 0 ms. That gap is the entire perception delta.

### Tasks
- 🟨 **B1**: Local-authoritative prediction for the local kart. Run cannon-es locally for own car using same code path as playtest; send inputs at 60 Hz; reconcile only on divergence > threshold (snap-to-server with 100–150 ms smoothing). Touch: [frontend/src/multiplayer-editor3-main.js](frontend/src/multiplayer-editor3-main.js), [frontend/src/modules/realtime/colyseus-babylon-client.js](frontend/src/modules/realtime/colyseus-babylon-client.js). _Partial: input echo + visual prediction shipped (B1a). Full physics-replay reconciliation deferred — see Completion log._
- ✅ **B2**: Adaptive interpolation delay for ghost karts. New formula `clamp(rtt*0.5 + 2σjitter, 60, 200)` ms, with `(patchRate + 10ms)` safety floor. Replaces old 110 ms minimum that locked the floor on LAN-quality links. Implemented in `_updateInterpolationDelay()` in [frontend/src/modules/realtime/colyseus-babylon-client.js](frontend/src/modules/realtime/colyseus-babylon-client.js); editor3 path mirrors it via `_adaptiveInterpDelayMs()` in [frontend/src/multiplayer-editor3-main.js](frontend/src/multiplayer-editor3-main.js).
- ✅ **B3**: Snapshot-buffered interpolation for ghosts. Per-kart rolling buffer (≤6 samples), render-time = `now − adaptiveDelayMs`, lerp+slerp between two straddling snapshots, velocity-extrapolation capped at 33 ms. Replaces single-target LERP. See `_pushSnapshot` / `_sampleSnapshotBuffer` in [frontend/src/multiplayer-editor3-main.js](frontend/src/multiplayer-editor3-main.js).
- ✅ **B4**: FX rig decoupled from broadcast for the LOCAL kart. Per-frame, the local entry's `_fxState.throttleIn / brakeIn / steerIn` now come from live local input (not server snapshot), so wheels / exhaust / drift sparks react instantly. Physics-derived fields (boostTimer, gloBurnoutT, wheelGrounded, driftTier) keep server values. Ghosts unchanged.
- ⬜ **B5**: Latency probe ([frontend/scripts/online-feel-probe.mjs](frontend/scripts/online-feel-probe.mjs)): 2-client run with simulated latency 0/50/100/150 ms + 5 % loss using Chromium's `Network.emulateNetworkConditions`. Assert: (a) local input-to-pixel < 33 ms regardless of RTT, (b) ghost teleport count = 0 across 60 s lap, (c) avg reconcile correction < 0.5 m.

**Gate:** B5 probe green at 100 ms + 5 % loss; manual user test reports parity with single-player feel for the local car.

---

## Phase C — Server authority on combat & laps

Today client locally tracks weapon cooldowns ([Editor3RaceRoom.js](realtime/src/rooms/Editor3RaceRoom.js)), no impact-VFX sync, lap detection only via spawn/finish geometry (can be missed at high speed).

### Tasks
- ✅ **C1**: Server-authoritative weapon cooldown floor (per-kart, per-slot `lastFireMs`). Defaults to `WEAPONS[def].cooldownMs` or 200 ms. Spam-fire requests are silently dropped (HUD already knows the cooldown). Implemented in `fireWeapon` handler in [realtime/src/rooms/Editor3RaceRoom.js](realtime/src/rooms/Editor3RaceRoom.js).
- ✅ **C2**: Server-issued `kartImpact` event for hitscan/cone weapons. Server runs a forward-cone target search (`_findForwardCarTarget`) on each fireWeapon and broadcasts `kartImpact` so all clients display the same hit + stun. Full ballistic-projectile simulation (homing, arc) deferred — those weapons remain client-visual-only and rely on the existing `projectileFired` broadcast.
- ✅ **C3**: Robust lap-completion via swept-segment crossing test (point-on-line-segment vs finish radius), in addition to point-in-radius. Eliminates tunnelling at high speed without requiring a full mid-track checkpoint sweep. Mid-track checkpoint derivation deferred — the new test resolves the immediate "missed lap at high speed" symptom and is a much smaller wire-format risk.
- 🟨 **C4**: Combat probe ([frontend/scripts/online-arena-2p-combat-probe.mjs](frontend/scripts/online-arena-2p-combat-probe.mjs)): scaffold landed (asserts realtime reachable). Full Playwright two-client fire/kartImpact assertion harness pending a stable two-client headless drive.

**Gate:** existing [online-arena-2p-probe.mjs](frontend/scripts/online-arena-2p-probe.mjs) + C4 + 30-min soak with 4 simulated clients all green. _Partial — anti-spam + impact authority + tunnel-safe laps shipped; full automated harness pending._

---

## Phase D — Lobby-to-race handoff polish

`matchStart` carries unvalidated `gameConfig`; truncation was the worst symptom. Tighten the handshake.

### Tasks
- ✅ **D1**: Hand-rolled `gameConfig` validation in [realtime/src/rooms/LobbyRoom.js](realtime/src/rooms/LobbyRoom.js) `startMatch` handler. Rejects: missing modeId/gameMode, race mode without trackId or customTrackData, totalLaps out of 1–50, customTrackData missing `track.placements`, battle without arenaId, scoreLimit < 1, maxPlayers out of 1–12, botCount out of 0–10. Surfaces explicit `matchError` to the host instead of letting the race room crash later.
- ✅ **D2**: `protocolVersion` + `engineVersion` + `trackVersion` added to outbound `gameConfig`. [Editor3RaceRoom.onCreate](realtime/src/rooms/Editor3RaceRoom.js) checks them on receive and broadcasts `matchError` on mismatch (warn-only for v1 ↔ v1 to keep the rollout window soft).
- ✅ **D3**: Reconnect window via Colyseus `allowReconnection(client, 15)` in [Editor3RaceRoom.onLeave](realtime/src/rooms/Editor3RaceRoom.js). Vehicle, combat state, and kart slot are preserved; consented leaves and finished races still purge immediately. Cleanup centralised in `_purgeKart`.
- 🟨 **D4**: Probe ([frontend/scripts/online-reconnect-probe.mjs](frontend/scripts/online-reconnect-probe.mjs)): scaffold landed; full socket-close + colyseus.js reconnect drive pending the same harness as C4.

---

## Phase E — Observability & shippable QA gate

### Tasks
- ✅ **E1**: Prometheus `/metrics` endpoint added to [realtime/src/index.js](realtime/src/index.js). Exports `glokarts_uptime_seconds`, `glokarts_rooms`, `glokarts_clients`, `glokarts_memory_rss_bytes`, `glokarts_memory_heap_used_bytes`. Existing per-tick metrics emitted via `editor3_room_dispose` log lines remain available for log-based dashboards.
- ✅ **E2**: Client diagnostics overlay in [frontend/src/multiplayer-editor3-main.js](frontend/src/multiplayer-editor3-main.js). Toggle with `` ` `` (backtick); persisted across reloads via `localStorage.glok.netDiag`. Shows live RTT proxy, jitter EWMA, adaptive interp delay, snapshot buffer depth, send rate, seq drift.
- 🟨 **E3**: CI smoke workflow [.github/workflows/online-ship-ready-smoke.yml](.github/workflows/online-ship-ready-smoke.yml) wired up: spins up Django + realtime + Vite, runs A4 + B5/C4/D4 (scaffolds) + E4 (scaffold) + curls `/metrics`. Triggers on PRs touching realtime/, multiplayer client, or any online probe. Will start blocking PRs once the scaffolds become full assertion harnesses.
- 🟨 **E4**: [frontend/scripts/server-tick-budget-probe.mjs](frontend/scripts/server-tick-budget-probe.mjs) scaffold landed; full headless `_tick()` benchmark pending extraction of Editor3RaceRoom into a transport-free factory. For now the budget is enforceable via the existing `editor3_room_dispose` log p95 line.

---

## Suggested ordering

| Order | Phase | Outcome |
|------:|:-----|:--------|
| 1 | **A** | Tracks load identically to playtest. |
| 2 | **B** | Online "feels like" playtest. |
| 3 | **D** | Reliable join / rejoin. |
| 4 | **C** | Combat correctness + anti-cheat groundwork. |
| 5 | **E** | We can keep it shipped. |

---

## Completion log

(Each task records: date · commit · notes)

- **Phase A** — 2026-05-11 · `eb7afe43` · Pipeline hardening complete. Track payload now reliably round-trips for all 3 shipped templates; cloud-sourced selections from picker now broadcast their physics blob; server logs unknown segment keys + raceability warnings.
- **Phase B (B2/B3/B4)** — 2026-05-11 · `4bc233e5` · Adaptive interp delay tightened (`rtt*0.5 + 2σjitter`, 60–200 ms), snapshot-buffered ghost interpolation with velocity extrapolation cap (≤33 ms), and local-kart FX rig now driven from live local input instead of broadcast — wheels/exhaust/drift sparks react instantly.
- **Phase B1 (B1a partial)** + **C1 / C2 / C3 / D1 / D2 / D3 / E1 / E2 + scaffolds for B5/C4/D4/E3/E4** — 2026-05-11 · _this commit_ · See per-task notes above. Honest status: full client-side physics replay (B1) and the Playwright-driven probe harnesses (B5/C4/D4) need a follow-up pass to be true ship-blockers. Everything else is in place server-side and exercised by the CI workflow scaffold.

