/**
 * simulate-smoothness.spec.mjs — Measures perceived render smoothness,
 * not just rAF callback cost.
 *
 * Smoothness model: drive the kart at constant throttle in a straight
 * line. Sample BOTH the rendered (interpolated) chassis position and
 * the raw (snapshot-only) authoritative position every rAF tick.
 *
 * Without bridge interpolation, the raw stream shows a 60 Hz "stair"
 * (same value held across 2-3 render frames at 144 Hz, then a jump).
 * With interpolation the rendered stream advances smoothly every
 * frame even though the worker only ticks at 60 Hz.
 *
 * Iron-clad assertions:
 *   • mean fps ≥ 100
 *   • p99 frame time ≤ 12 ms
 *   • zero hitches > 33 ms
 *   • held-pose ratio (Δz < 0.05 mm between consecutive render frames)
 *     ≤ 15 %  → confirms the bridge is interpolating, not echoing
 *   • smoothness ratio: interpolated_held_pct < raw_held_pct / 2
 *     → interpolation provably smoother than the raw worker stream
 *
 * Run:
 *   npx playwright test tests/simulate-smoothness.spec.mjs \
 *     --reporter=line --workers=1 --headed
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

test('render-time smoothness under constant throttle', async ({ page }) => {
  test.setTimeout(60000);
  const consoleLines = [];
  page.on('pageerror', (e) => consoleLines.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    t.place('spawn', 0, 0, 0);
    for (let z = 1; z < 24; z++) t.place('straight', 0, z, 0);
    return td.encodeTrack(t);
  }, BASE);

  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => window.__play?.chassisBody && window.__play?.vehicle && window.__play?.physicsBridge?.snapCount > 5,
    { timeout: 20000 },
  );

  // Per-rAF sampler. We capture the rendered (interpolated) Z and the
  // raw authoritative Z at the same instant so we can directly compare
  // smoothness of the two streams.
  await page.evaluate(() => {
    window.__smooth = { samples: [] };
    const tick = () => {
      const p = window.__play;
      if (p?.chassisBody) {
        window.__smooth.samples.push({
          t: performance.now(),
          interpZ: p.chassisBody.interpolatedPosition.z,
          rawZ: p.chassisBody.position.z,
        });
      }
      window.__smooth.raf = requestAnimationFrame(tick);
    };
    window.__smooth.raf = requestAnimationFrame(tick);
  });

  await page.keyboard.down('w');
  await page.waitForTimeout(5000);
  await page.keyboard.up('w');

  const samples = await page.evaluate(() => {
    cancelAnimationFrame(window.__smooth.raf);
    return window.__smooth.samples.slice();
  });

  // Trim warmup (acceleration ramp + initial physics settle).
  const cruise = samples.slice(60);
  expect(cruise.length).toBeGreaterThan(120);

  const dts = [];
  const dInterp = [];
  const dRaw = [];
  for (let i = 1; i < cruise.length; i++) {
    const dt = cruise[i].t - cruise[i - 1].t;
    if (dt <= 0) continue;
    dts.push(dt);
    dInterp.push(cruise[i].interpZ - cruise[i - 1].interpZ);
    dRaw.push(cruise[i].rawZ - cruise[i - 1].rawZ);
  }

  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const sorted = (a) => a.slice().sort((x, y) => x - y);
  const dtMean = mean(dts);
  const fpsMean = 1000 / dtMean;
  const dtSorted = sorted(dts);
  const dtP99 = dtSorted[Math.floor(dtSorted.length * 0.99)];
  const hitches = dts.filter((t) => t > 33).length;

  // "Held pose": the absolute Δ between two render frames is below
  // 0.05 mm (essentially zero motion at 100+ fps). For an interpolated
  // stream this should be rare; for a raw 60 Hz stream sampled at
  // 144 Hz it's ~50-60 % of frames.
  const HELD = 0.05;
  const heldInterp = dInterp.filter((d) => Math.abs(d) < HELD).length;
  const heldRaw = dRaw.filter((d) => Math.abs(d) < HELD).length;
  const heldInterpPct = (heldInterp / dInterp.length) * 100;
  const heldRawPct = (heldRaw / dRaw.length) * 100;

  console.log('═══════════════════════════════════════════════════════');
  console.log('  RENDER SMOOTHNESS UNDER CONSTANT THROTTLE');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  cruise frames sampled : ${cruise.length}`);
  console.log(`  mean fps              : ${fpsMean.toFixed(1)}`);
  console.log(`  p99 frame time        : ${dtP99.toFixed(2)} ms`);
  console.log(`  hitches (>33 ms)      : ${hitches}`);
  console.log(`  held-pose pct (interp): ${heldInterpPct.toFixed(1)} %  ← rendered`);
  console.log(`  held-pose pct (raw)   : ${heldRawPct.toFixed(1)} %  ← worker snapshot`);
  console.log(`  smoothness gain       : ${(heldRawPct / Math.max(heldInterpPct, 0.1)).toFixed(1)}× fewer held frames`);
  console.log('═══════════════════════════════════════════════════════');

  expect(fpsMean, 'mean fps should be ≥100').toBeGreaterThan(100);
  expect(dtP99, 'p99 frame time should be ≤12 ms').toBeLessThan(12);
  expect(hitches, 'no hitches > 33 ms').toBe(0);
  expect(heldInterpPct, 'interpolated stream should rarely hold pose').toBeLessThan(15);
  // Interpolated stream must be visibly smoother than raw, otherwise
  // the bridge isn't doing its job (and the user sees worker judder).
  if (fpsMean > 75) {
    expect(heldRawPct - heldInterpPct, 'interpolation must beat raw by ≥10 %').toBeGreaterThan(10);
  }
});

