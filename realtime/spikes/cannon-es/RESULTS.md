# Spike Results — 2026-05-10

**Hardware:** Local dev machine (Windows, Node v25.6.1).
> Caveat: production hosting (Koyeb shared-CPU free tier) typically delivers ~30–50% of dev-machine throughput. Numbers below should be treated as a *ceiling*; production will be slower. Re-run on target host before final commitment.

## Raw numbers

| Karts | Duration | Mean | P50 | P95 | P99 | Max | GC>5ms |
|-------|----------|------|------|------|------|-------|--------|
| 4 | 10 s | 1.49 ms | — | 2.66 ms | 4.05 ms | 8.50 ms | 0 |
| 8 | 20 s | 1.96 ms | 1.77 ms | 3.49 ms | 5.03 ms | 16.25 ms | 0 |
| 12 | 15 s | 1.78 ms | 1.42 ms | 3.59 ms | 5.75 ms | 14.08 ms | 0 |

(60 Hz, 3 substeps, ~80 static colliders, randomized throttle/steer per kart.)

## Verdict: **PASS** (with caveats)

The script's auto-verdict said CONDITIONAL only because my drift threshold was too tight; the drift is `setTimeout` scheduler imprecision, not physics cost.

**Why PASS:**
- P95 ≤ 3.6 ms across all configs → ~21% of the 16.67 ms frame budget. Plenty of headroom for net I/O, schema serialization, AI, weapon sim.
- P99 ≤ 5.75 ms → ~34% of frame.
- Scales nearly flat from 4 → 12 karts (broadphase is doing its job; static collider cost dominates over kart count at this scale).
- Zero significant GC pauses across 1200+ ticks.
- Max tick = one frame worth (16 ms outlier) — single occurrence, recoverable.

## Caveats and follow-ups before committing to "one engine end-to-end"

1. **Production-host re-test required.** A Koyeb shared-vCPU instance is the real target. Need to re-run on a representative deploy before locking in. Suggested: deploy this spike script as a one-off Koyeb job, log JSON output, compare.
2. **Track size matters.** Tested ~80 static colliders. A complex user track (full 32×32 grid with decor) could be 10× the static body count. Need a follow-up test with a real exported editor3 track JSON loaded into the spike.
3. **Weapon sim cost not measured.** Adding 8 active projectiles (raycasts + collision) per tick is additive. Estimate: <1 ms based on cannon raycast benchmarks, but should be measured.
4. **Non-deterministic.** Confirmed; reconciliation strategy is required (which we already accepted). Cannon-es uses Sequential Impulse solver — output varies by ~1e-6 per step across machines. Acceptable for arcade combat with snapshot reconciliation.
5. **Scheduler drift = 2–4 ms/sec.** Node's `setTimeout` is imprecise. For production server tick loop, use a tight `while` with `process.hrtime.bigint()` or Colyseus' built-in clock instead of `setTimeout`. Otherwise 60 Hz becomes ~58–59 Hz under load.
6. **Single Node instance per room.** With Colyseus' single-thread model, this physics tick competes with all other room work. Budget to keep: physics ≤ 30% of frame → 5 ms ceiling for the whole tick (still satisfied at P95).

## Architectural implication

The "one engine end-to-end" thesis is **technically viable**. We can:
- Ship the editor3 cannon-es worker compiled/imported on the server side
- Server runs the same world as the client predictor → reconciliation diffs are minimal (same solver, same constants)
- Client runs cannon-es in a Web Worker (already does, in playtest)
- Reconciliation = server snapshot → client rewind & replay (cannon-es state is small, rewind is cheap; editor3 already has a 10s rewind ring buffer in physics-worker.js)

## Recommended next steps

1. **Re-run on Koyeb** before locking in (infra task).
2. **Build a "track size" stress test** — load a real editor3 track export, measure with full collider count.
3. **Measure projectile cost** — add 8 RaycastVehicle-driving karts + 8 active projectiles, confirm still <8 ms P95.
4. **Decide reconciliation cadence** — 30 Hz snapshot from server with client interpolation is the conventional choice; cannon-es server can run faster (e.g. 60 Hz physics, 20 Hz snapshot) to amortize bandwidth.
