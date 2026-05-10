# Cannon-es Server-Side Physics Spike

**Question:** Can we run editor3's cannon-es physics authoritatively on a Node.js server at low enough latency to support live PvP across 4–8 players, on commodity hosting (Koyeb free tier class)?

**Targets (sensible defaults, low-latency / wide-device focus):**
- Tick rate: **60 Hz** (16.67 ms budget per tick)
- Player count: **8** karts per room
- Per-tick wall-time budget: **<8 ms P95** (leaves headroom for net I/O, schema serialization, AI, weapon sim)
- Determinism: **not required** — client predicts, server reconciles via Colyseus deltas

**What this spike does NOT prove:**
- Network jitter handling (separate concern)
- Reconciliation correctness (Phase 2 work)
- Weapon/projectile cost (additive on top — measured separately)

## Run

```bash
cd realtime
node spikes/cannon-es/run.mjs              # default: 8 karts, 60s, 60Hz
node spikes/cannon-es/run.mjs --karts=4    # 4 karts
node spikes/cannon-es/run.mjs --karts=12   # stress test
node spikes/cannon-es/run.mjs --hz=30      # half tick rate
```

## What's simulated

- Single CANNON.World, gravity -9.82 m/s², SAPBroadphase
- ~50 static box bodies (representative small track ≈ 8×6 cells of `straight`+`corner`)
- N RaycastVehicle karts spawned at random track cells, given randomized throttle/steer per second
- Default 3 substeps per fixed step (matches editor3 worker)
- World scaled with TILE=36 to match editor3 `units.js`

## Output

Console table per second, plus end-of-run summary:

```
ticks=3600  drift=+0.4ms  P50=2.1ms  P95=4.8ms  P99=6.3ms  max=11.2ms
GC pauses (>5ms): 3
Verdict: PASS (P95 4.8ms ≤ 8ms budget, drift acceptable)
```

## Verdict criteria

- **PASS**: P95 ≤ 8 ms AND P99 ≤ 14 ms AND no tick > 33 ms AND drift < 100 ms over the run.
- **CONDITIONAL**: P95 ≤ 12 ms — usable but needs optimization (reduced substeps, simplified collision, etc.)
- **FAIL**: P95 > 12 ms or any tick > 33 ms (frame-skip territory) — cannon-es server-side not viable at target scale; revisit architecture.
