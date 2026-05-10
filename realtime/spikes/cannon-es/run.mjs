/**
 * Cannon-es server-side physics spike.
 *
 * Measures whether running editor3's cannon-es kart physics on a Node.js
 * server is viable for live PvP at 60 Hz with 4–8 karts on commodity
 * hosting. See README.md for context and verdict criteria.
 *
 * Usage:
 *   node spikes/cannon-es/run.mjs
 *   node spikes/cannon-es/run.mjs --karts=12 --duration=30 --hz=60
 */
import * as CANNON from 'cannon-es';
import { performance, PerformanceObserver } from 'node:perf_hooks';

// ── Args ────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const KARTS = parseInt(args.karts ?? 8, 10);
const DURATION_S = parseInt(args.duration ?? 60, 10);
const HZ = parseInt(args.hz ?? 60, 10);
const SUBSTEPS = parseInt(args.substeps ?? 3, 10);

const FIXED_DT = 1 / HZ;
const TOTAL_TICKS = HZ * DURATION_S;

// ── Editor3-equivalent constants (mirrors physics-worker.js) ────────
const TILE = 36;                 // world units per cell (m)
const M = (n) => n;              // editor3 uses identity for now
const KART_MASS = 150;
const CHASSIS_HX = M(0.6), CHASSIS_HY = M(0.3), CHASSIS_HZ = M(1.0);
const WHEEL_RADIUS = M(0.4);
const MAX_ENGINE = M(1700);
const MAX_BRAKE = M(28);

// ── Build representative world ──────────────────────────────────────
function buildWorld() {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0),
  });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.4;

  // Ground plane
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
  ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(ground);

  // ~50 static segment bodies (8×6 grid of road cells, each 1 box ≈ TILE/2)
  // Mirrors what segment-builder.js generates for 'straight' / 'corner'.
  const COLS = 8, ROWS = 6;
  for (let i = 0; i < COLS; i++) {
    for (let j = 0; j < ROWS; j++) {
      const body = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(TILE / 2, 0.25, TILE / 2)),
      });
      body.position.set(i * TILE, 0, j * TILE);
      world.addBody(body);
    }
  }

  // Wall perimeter (~28 boxes) — additive collision detail
  for (let i = 0; i < COLS; i++) {
    for (const z of [-TILE / 2, ROWS * TILE - TILE / 2]) {
      const wall = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(TILE / 2, 2, 0.5)),
      });
      wall.position.set(i * TILE, 2, z);
      world.addBody(wall);
    }
  }

  return world;
}

// ── Build one RaycastVehicle (mirrors editor3 setup) ────────────────
function spawnKart(world, x, z) {
  const chassisShape = new CANNON.Box(new CANNON.Vec3(CHASSIS_HX, CHASSIS_HY, CHASSIS_HZ));
  const chassis = new CANNON.Body({ mass: KART_MASS });
  chassis.addShape(chassisShape);
  chassis.position.set(x, 1.5, z);
  chassis.angularDamping = 0.2;
  world.addBody(chassis);

  const vehicle = new CANNON.RaycastVehicle({
    chassisBody: chassis,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2,
  });

  const wheelOpts = {
    radius: WHEEL_RADIUS,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 30,
    suspensionRestLength: 0.3,
    frictionSlip: 1.5,
    dampingRelaxation: 2.3,
    dampingCompression: 4.4,
    maxSuspensionForce: 100000,
    rollInfluence: 0.01,
    axleLocal: new CANNON.Vec3(-1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true,
  };
  // Four wheels
  const dx = CHASSIS_HX, dz = CHASSIS_HZ - 0.2;
  for (const [px, pz] of [[-dx, dz], [dx, dz], [-dx, -dz], [dx, -dz]]) {
    wheelOpts.chassisConnectionPointLocal = new CANNON.Vec3(px, 0, pz);
    vehicle.addWheel({ ...wheelOpts });
  }
  vehicle.addToWorld(world);

  return { chassis, vehicle, throttle: 0, steer: 0, nextChange: 0 };
}

// ── Simulate input variation each second so karts move/turn ─────────
function maybeRandomizeInput(kart, t) {
  if (t < kart.nextChange) return;
  kart.throttle = Math.random() < 0.85 ? 1 : 0;
  kart.steer = (Math.random() - 0.5) * 0.6;
  kart.nextChange = t + 0.5 + Math.random();
}

function applyInput(kart) {
  const eng = kart.throttle * MAX_ENGINE;
  // rear wheel drive
  kart.vehicle.applyEngineForce(eng, 2);
  kart.vehicle.applyEngineForce(eng, 3);
  kart.vehicle.setSteeringValue(kart.steer, 0);
  kart.vehicle.setSteeringValue(kart.steer, 1);
}

// ── GC pause detector ───────────────────────────────────────────────
let gcPauses = 0;
const obs = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    if (e.duration > 5) gcPauses++;
  }
});
obs.observe({ entryTypes: ['gc'] });

// ── Run ─────────────────────────────────────────────────────────────
function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)] ?? 0;
}

async function main() {
  console.log(`spike: cannon-es server-side`);
  console.log(`config: ${KARTS} karts, ${DURATION_S}s, ${HZ}Hz, substeps=${SUBSTEPS}`);
  console.log('');

  const world = buildWorld();
  const karts = [];
  for (let i = 0; i < KARTS; i++) {
    const x = (i % 4) * (TILE * 0.5) + TILE * 1.5;
    const z = Math.floor(i / 4) * TILE + TILE * 1.5;
    karts.push(spawnKart(world, x, z));
  }

  const tickDurations = new Float32Array(TOTAL_TICKS);
  const startWall = performance.now();
  let scheduled = startWall;
  let driftTotal = 0;
  let secondTickCount = 0;
  let secondTickSum = 0;

  for (let i = 0; i < TOTAL_TICKS; i++) {
    const t = i * FIXED_DT;
    for (const k of karts) {
      maybeRandomizeInput(k, t);
      applyInput(k);
    }

    const tickStart = performance.now();
    world.step(FIXED_DT, FIXED_DT, SUBSTEPS);
    const dur = performance.now() - tickStart;
    tickDurations[i] = dur;
    secondTickCount++;
    secondTickSum += dur;

    // Sleep until next scheduled tick (real-time pacing)
    scheduled += FIXED_DT * 1000;
    const sleep = scheduled - performance.now();
    if (sleep > 0) {
      await new Promise((r) => setTimeout(r, sleep));
    } else {
      driftTotal += -sleep;
    }

    if ((i + 1) % HZ === 0) {
      const avg = secondTickSum / secondTickCount;
      process.stdout.write(`  t=${((i + 1) / HZ).toString().padStart(2)}s  avg tick=${avg.toFixed(2)}ms  drift=${driftTotal.toFixed(0)}ms\r`);
      secondTickCount = 0;
      secondTickSum = 0;
    }
  }
  console.log('');
  console.log('');

  const all = Array.from(tickDurations);
  const p50 = pct(all, 0.5);
  const p95 = pct(all, 0.95);
  const p99 = pct(all, 0.99);
  const max = Math.max(...all);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;

  const budget = (1000 / HZ) * 0.5; // 50% of frame = "low latency safe"
  const hardBudget = 1000 / HZ;     // 100% = frame-skip starts

  console.log('── Results ──────────────────────────────────────');
  console.log(`ticks executed:   ${all.length}`);
  console.log(`mean tick:        ${mean.toFixed(2)} ms`);
  console.log(`P50 tick:         ${p50.toFixed(2)} ms`);
  console.log(`P95 tick:         ${p95.toFixed(2)} ms`);
  console.log(`P99 tick:         ${p99.toFixed(2)} ms`);
  console.log(`max tick:         ${max.toFixed(2)} ms`);
  console.log(`total drift:      ${driftTotal.toFixed(1)} ms over ${DURATION_S}s`);
  console.log(`GC pauses >5ms:   ${gcPauses}`);
  console.log(`budget (50%):     ${budget.toFixed(2)} ms`);
  console.log(`hard budget:      ${hardBudget.toFixed(2)} ms`);
  console.log('');

  let verdict;
  if (p95 <= budget && p99 <= hardBudget * 0.85 && max <= hardBudget * 2 && driftTotal < DURATION_S * 100 / 60) {
    verdict = 'PASS — viable for production';
  } else if (p95 <= hardBudget * 0.75 && max <= hardBudget * 2) {
    verdict = 'CONDITIONAL — usable with optimization (reduce substeps, simpler collision, or consider c++ port)';
  } else {
    verdict = 'FAIL — cannon-es not viable at this scale; revisit architecture';
  }
  console.log(`Verdict: ${verdict}`);

  // Machine-readable summary for CI / archival
  const summary = {
    config: { karts: KARTS, duration_s: DURATION_S, hz: HZ, substeps: SUBSTEPS },
    metrics: { mean_ms: +mean.toFixed(3), p50_ms: +p50.toFixed(3), p95_ms: +p95.toFixed(3), p99_ms: +p99.toFixed(3), max_ms: +max.toFixed(3), drift_ms: +driftTotal.toFixed(1), gc_pauses_5ms: gcPauses },
    budget: { soft_ms: +budget.toFixed(2), hard_ms: +hardBudget.toFixed(2) },
    verdict,
    node_version: process.version,
    timestamp: new Date().toISOString(),
  };
  console.log('');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
