# Spike Results — Editor3 → Multiplayer Bridge

**Date:** 2026-05-10
**Branch:** `supertuxkart-web-edition`
**Verdict:** ✅ **PASS** — bridge architecture is viable.

## Setup

- Node v25.6.1, Windows 11
- Colyseus 0.16.24 + @colyseus/schema 3.0.76
- cannon-es 0.20.0
- Localhost loopback (no real network conditions)
- Server tick: 60 Hz, snapshot write: 20 Hz, client input: 30 Hz

## Runs

### 2 clients × 5 s

```
clients moved: 2/2
clients with input ack:  2/2
avg snapshots/client:    82
final velocity: ~14.7 m/s
```

Server-side perf (room dispose log):
```
ticks=212, p50=0.42ms, p95=1.55ms, p99=3.59ms
```

### 8 clients × 10 s

```
clients moved: 8/8
clients with input ack:  8/8
avg snapshots/client:    165
```

Server-side perf:
```
ticks=436, p50=1.06ms, p95=2.23ms, p99=3.86ms
```

At 60 Hz the per-tick budget is **16.67 ms**. We consumed **23%** at P99
with 8 karts — plenty of headroom for combat physics, raycast queries,
and snapshot serialization. This matches spike A's projection.

## What this proves

1. **Schema replication works.** Clients receive ~16.5 snapshots/s
   (≈ the configured 20 Hz; minor pacing slack from `setInterval`).
2. **Input round-trip works.** `lastSeq` echoed back in state reflects
   the most recent input the server processed (220-of-231 lag = ~50 ms,
   consistent with one tick + serialization on loopback).
3. **Concurrent karts share a world without crashing.** No NaNs, no
   physics divergence; karts collide and pile up realistically (some
   stuck-against-wall cases observed in the 8-client run).
4. **Production loop pattern is correct.** Server uses
   `process.hrtime.bigint()` for measurement (per spike A's lesson)
   and `setInterval` only as the scheduler — fine at this scale; can be
   upgraded to a self-correcting `setImmediate` loop if drift shows up
   under real network conditions.

## Gaps to production

| # | Gap | Severity | Notes |
|---|-----|---|-------|
| 1 | **No client-side prediction** | HIGH | Smoke client is "dumb"; a real browser client must integrate inputs locally and reconcile with snapshots, otherwise input feels laggy at any RTT > 30 ms. |
| 2 | **No interpolation buffer** for remote karts | HIGH | Need 100-150 ms render-delay buffer per remote entity to mask jitter. |
| 3 | **No input compression** | MED | Currently sending JSON; should bit-pack inputs (1 byte for steer + brake/throttle bits) to reduce upstream cost at scale. |
| 4 | **No cheat / sanity guards on inputs** | HIGH | Server trusts client-supplied throttle/brake/steer ranges only via `clamp01`/`clampSym`. Need rate limiting + sequence-number monotonicity check (see `realtime/src/server-guard.js` for existing pattern). |
| 5 | **Track loading** | HIGH | Uses static 6×6 tile floor; production must ingest editor3 Track JSON v1 (per `docs/PIPELINE_CONTRACT.md`) and rebuild the cannon-es world per match. |
| 6 | **Single-room limit** | LOW | One room class registered; production needs RaceRoom / BattleRoom variants on top of the bridge. |
| 7 | **Weapons** | HIGH | Phase 2 work; existing `realtime/src/combat-runtime.js` runs against player-position state — needs adapter to read from `WorldState.karts` instead. |
| 8 | **Disconnect handling** | LOW | Implemented (`onLeave` removes vehicle and body); needs auto-reconnect grace window (Colyseus `allowReconnection`) for production. |
| 9 | **Production host re-test** | MED | All numbers above are localhost on a developer laptop. Need a Koyeb-tier free-instance run before locking architecture in. |
| 10 | **Snapshot pacing** | LOW | Schema deltas already coalesce; explicit 20 Hz snapshot interval may be redundant — Colyseus' `patchRate` (default 50 ms = 20 Hz) achieves the same. Could simplify. |

## Recommendation

**Adopt this architecture for the new multiplayer stack.** Specifically:

1. Promote `Editor3BridgeRoom` into `realtime/src/rooms/Editor3RaceRoom.js`
   once track-JSON ingestion is wired (Gap #5).
2. Build a Three.js client renderer that consumes `WorldState.karts` —
   reuse the editor3 playtest renderer (the chassis/wheel meshes already
   exist in `frontend/src/editor3/kart-loader.js`).
3. Move `combat-runtime.js` to read from this new state shape (Gap #7).
4. Re-run this spike on Koyeb (Gap #9) before deprecating the Babylon
   stack.

## Files

- [server.mjs](./server.mjs) — 200 lines, room + boot
- [smoke-client.mjs](./smoke-client.mjs) — 80 lines, synthetic clients
- [README.md](./README.md) — usage
