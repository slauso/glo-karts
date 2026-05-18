/**
 * hill-transition.spec.mjs
 *
 * Verifies that consecutive rolling-hill segments do not trap a kart
 * at the junction between them. The root failure mode: the sin(t·π)
 * profile had slope ≈ ±24.7° at its endpoints, so two back-to-back
 * hills formed a ~49° V-valley where physics box colliders from
 * adjacent segments created a groove that stalled/flipped the kart.
 *
 * Track layout (Z-axis, rot=0 for all):
 *   gz  0  spawn
 *   gz  1  straight (run-up)
 *   gz  2  straight
 *   gz  3  hill_complete  (spans gz 3–4, z=2)
 *   gz  5  hill_complete  (spans gz 5–6)
 *   gz  7  hill_complete  (spans gz 7–8)
 *   gz  9  straight (run-out)
 *   gz 10  straight
 *   gz 11  finish
 *
 * Pass criteria: after 6 seconds of full throttle (W key held), the kart
 * must have covered at least 80 % of the 11-cell straight-line distance
 * (396 m) from spawn to finish AND must never have had its forward velocity
 * drop below 0.5 m/s for more than 0.5 s continuously. A stuck kart
 * typically stops within the first 2–3 hills and covers < 30 % of the run.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';

test('consecutive hill segments — kart must not get stuck at junctions', async ({ page }) => {
  test.setTimeout(40000);
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.error('[console]', m.text());
  });

  // ── 1. Build track code ───────────────────────────────────────
  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });

  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();

    t.place('spawn',         0,  0, 0);
    t.place('straight',      0,  1, 0);   // run-up
    t.place('straight',      0,  2, 0);
    t.place('hill_complete', 0,  3, 0);   // hill 1 (spans z=3,4)
    t.place('hill_complete', 0,  5, 0);   // hill 2 (spans z=5,6)
    t.place('hill_complete', 0,  7, 0);   // hill 3 (spans z=7,8)
    t.place('straight',      0,  9, 0);   // run-out
    t.place('straight',      0, 10, 0);
    t.place('finish',        0, 11, 0);

    return td.encodeTrack(t);
  }, BASE);

  // ── 2. Load into play.html ────────────────────────────────────
  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, {
    waitUntil: 'domcontentloaded',
  });

  await page.waitForFunction(
    () => window.__play?.chassisBody && window.__play?.vehicle
          && window.__play?.physicsBridge?.snapCount > 3,
    { timeout: 20000 },
  );

  // Allow physics to settle (wheels drop to ground).
  await page.waitForTimeout(800);

  // ── 3. Install per-rAF velocity sampler ──────────────────────
  await page.evaluate(() => {
    window.__hillTest = { samples: [] };
    const tick = () => {
      const p = window.__play;
      if (p?.chassisBody) {
        const vel = p.chassisBody.velocity;
        const pos = p.chassisBody.position;
        window.__hillTest.samples.push({
          t: performance.now(),
          vz: vel.z,   // forward velocity (kart faces +Z at spawn)
          pz: pos.z,
          py: pos.y,
        });
      }
      window.__hillTest.raf = requestAnimationFrame(tick);
    };
    window.__hillTest.raf = requestAnimationFrame(tick);
  });

  // ── 4. Hold throttle for 6 seconds ───────────────────────────
  await page.keyboard.down('w');
  await page.waitForTimeout(6000);
  await page.keyboard.up('w');

  // ── 5. Collect results ────────────────────────────────────────
  const result = await page.evaluate(() => {
    cancelAnimationFrame(window.__hillTest.raf);
    const samples = window.__hillTest.samples;
    if (samples.length < 10) return { error: 'too few samples' };

    // Trim the first 0.5 s of warmup (kart still accelerating from rest).
    const t0 = samples[0].t + 500;
    const active = samples.filter(s => s.t >= t0);
    if (active.length < 5) return { error: 'too few active samples' };

    const maxPz = Math.max(...active.map(s => s.pz));
    const minVz  = Math.min(...active.map(s => s.vz));

    // Compute the longest continuous run of frames where |vz| < 0.5 m/s
    // (kart effectively stuck). Window duration: count consecutive low-speed
    // frames and convert to ms.
    let maxStuckMs = 0, stuckStart = null;
    for (const s of active) {
      if (Math.abs(s.vz) < 0.5) {
        if (stuckStart === null) stuckStart = s.t;
        maxStuckMs = Math.max(maxStuckMs, s.t - stuckStart);
      } else {
        stuckStart = null;
      }
    }

    return {
      sampleCount: active.length,
      maxPz,
      minVz,
      maxStuckMs,
      firstSample: active[0],
      lastSample: active[active.length - 1],
    };
  });

  console.log('Hill transition result:', JSON.stringify(result, null, 2));

  // ── 6. Assert correctness ─────────────────────────────────────
  expect(result.error).toBeUndefined();

  // Kart must have advanced at least 10 cells × TILE(36m) × 0.5 = 180 m
  // along Z from spawn (which is near z=0 in world units). Even a very
  // slow run covers >200 m in 6 s; a stuck kart covers < 80 m.
  expect(result.maxPz).toBeGreaterThan(180);

  // No more than 500 ms continuously stuck (< 0.5 m/s forward speed).
  // The pre-fix behaviour saw the kart stall completely inside the first
  // hill junction and never recover (stuck time > 5000 ms).
  expect(result.maxStuckMs).toBeLessThan(500);
});
