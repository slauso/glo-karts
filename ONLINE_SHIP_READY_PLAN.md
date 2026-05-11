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
- ⬜ **A1**: Hard-fail (don't truncate) above 64 KB. Compress with `pako` (or drop `decor` from wire payload — not used by physics) and bump cap to 256 KB. Log server-side warning + propagate `matchError` to client.
- ⬜ **A2**: Strict segment-registry parity check at room boot. Server logs diff of `Object.keys(SEGMENTS)` between client-encoded and server-decodable. Probe asserts diff is empty for every shipped + saved track.
- ⬜ **A3**: Pre-flight track validator: ≥1 spawn segment + ≥1 finish/lap-trigger; reject `matchStart` otherwise with explicit `matchError`.
- ⬜ **A4**: Save/load round-trip probe ([frontend/scripts/track-roundtrip-parity.mjs](frontend/scripts/track-roundtrip-parity.mjs)): for each shipped template + 3 saved tracks, encode → POST Django → fetch → rebuild physics on client and Node server module → assert positions differ < 0.01 mm and quaternions < 1e-6.

**Gate:** A4 probe green for templates + user saves; loading any of them online matches playtest layout (visual diff < 1 px in screenshot).

---

## Phase B — Race-loop feel (client prediction + adaptive interp)
*Fixes "doesn't feel like playtest"*

Audit: local kart currently animated by server snapshots (110 ms interp + RTT + 33 ms snapshot = 190–300 ms end-to-end). Playtest is 0 ms. That gap is the entire perception delta.

### Tasks
- ⬜ **B1**: Local-authoritative prediction for the local kart. Run cannon-es locally for own car using same code path as playtest; send inputs at 60 Hz; reconcile only on divergence > threshold (snap-to-server with 100–150 ms smoothing). Touch: [frontend/src/multiplayer-editor3-main.js](frontend/src/multiplayer-editor3-main.js), [frontend/src/modules/realtime/colyseus-babylon-client.js](frontend/src/modules/realtime/colyseus-babylon-client.js).
- ⬜ **B2**: Adaptive interpolation delay for ghost karts. Currently fixed 110 ms. Use jitter EWMA from [realtime/src/realtime-sync.js](realtime/src/realtime-sync.js); scale to `clamp(rtt/2 + 2σjitter, 60, 200)` ms.
- ⬜ **B3**: Reconciliation buffer + small input replay for remote karts: keep last 4 snapshots, lerp with tangents (catmull-rom) instead of linear; only extrapolate ≤ 1 frame.
- ⬜ **B4**: Decouple FX rig from network for the local kart. Ghosts continue using broadcast `throttleIn / driftActive / boostTimer`; local kart drives FX from local physics so wheels/exhaust are instant.
- ⬜ **B5**: Latency probe ([frontend/scripts/online-feel-probe.mjs](frontend/scripts/online-feel-probe.mjs)): 2-client run with simulated latency 0/50/100/150 ms + 5 % loss using Chromium's `Network.emulateNetworkConditions`. Assert: (a) local input-to-pixel < 33 ms regardless of RTT, (b) ghost teleport count = 0 across 60 s lap, (c) avg reconcile correction < 0.5 m.

**Gate:** B5 probe green at 100 ms + 5 % loss; manual user test reports parity with single-player feel for the local car.

---

## Phase C — Server authority on combat & laps

Today client locally tracks weapon cooldowns ([Editor3RaceRoom.js](realtime/src/rooms/Editor3RaceRoom.js)), no impact-VFX sync, lap detection only via spawn/finish geometry (can be missed at high speed).

### Tasks
- ⬜ **C1**: Server-authoritative weapon cooldowns. Per-weapon `nextFireMs` in `KartState`; client uses for HUD only.
- ⬜ **C2**: Server-issued `kartImpact` event (projectile hit, spin-out, knockback) so all clients see consistent VFX.
- ⬜ **C3**: Robust lap detection. Server casts checkpoint segments (start/finish + 2–4 mid-track checkpoints derivable from track centerline); reject laps that skip checkpoints. Wire format: bump `meta.checkpoints` in saved track payload (Phase A's compression budget covers it).
- ⬜ **C4**: Combat probe ([frontend/scripts/online-arena-2p-combat-probe.mjs](frontend/scripts/online-arena-2p-combat-probe.mjs)): two clients fire across 30 s, assert no ghost-ammo desync, no missed impacts.

**Gate:** existing [online-arena-2p-probe.mjs](frontend/scripts/online-arena-2p-probe.mjs) + C4 + 30-min soak with 4 simulated clients all green.

---

## Phase D — Lobby-to-race handoff polish

`matchStart` carries unvalidated `gameConfig`; truncation was the worst symptom. Tighten the handshake.

### Tasks
- ⬜ **D1**: JSON-schema validate `gameConfig` on both sides (Zod or hand-rolled). Reject early with explicit `matchError`.
- ⬜ **D2**: Add `trackVersion` and `engineVersion`; race room aborts with clear message if incompatible.
- ⬜ **D3**: Reconnect/rejoin: server keeps slot warm ~15 s after disconnect; client auto-reconnects with previous `sessionId` and resumes interpolation. Currently a refresh = lost slot.
- ⬜ **D4**: Probe: reload one of two clients mid-race; assert it rejoins with the same kart and finishes the lap.

---

## Phase E — Observability & shippable QA gate

### Tasks
- ⬜ **E1**: `realtime` server `/metrics` endpoint (Prom format) emitting per-room metrics (tickDriftMs, snapshotBytes, clientCount, jitter EWMA). Already partially collected at [realtime/src/realtime-sync.js](realtime/src/realtime-sync.js).
- ⬜ **E2**: Client overlay (toggleable hotkey, default off) showing RTT / jitter / interp delay / reconcile corrections / local prediction error.
- ⬜ **E3**: CI smoke pipeline running A4, B5, C4, D4 on every PR; block merge on regression.
- ⬜ **E4**: Performance budget: 8 karts × 60 Hz tick under 8 ms server tick time on a single core. Capture baseline + alert.

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

