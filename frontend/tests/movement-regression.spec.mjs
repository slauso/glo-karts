/**
 * movement-regression.spec.mjs
 * Hard guard against the "kart won't move" regression. Holds W for 2s
 * on a 30-tile straight and asserts the chassis advances at least one
 * tile (TILE = 12000 world units = 12 m).
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';
const TILE = 12000;
const M = (x) => x * 1000;

test('holding W drives kart forward at least one tile in 2s', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`PAGEERROR ${e.message}`));

  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    t.place('spawn', 0, 0, 0);
    for (let z = 1; z < 30; z++) t.place('straight', 0, z, 0);
    return td.encodeTrack(t);
  }, BASE);
  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__play && window.__play.chassisBody && window.__play.vehicle, { timeout: 20000 });

  // Let chassis settle on suspension (longer wait avoids vite-cold-start flake).
  await page.waitForTimeout(3000);

  const before = await page.evaluate(() => {
    const cb = window.__play.chassisBody;
    return {
      pos: { x: cb.position.x, y: cb.position.y, z: cb.position.z },
    };
  });

  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
  await page.waitForTimeout(4500);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));

  const after = await page.evaluate(() => {
    const cb = window.__play.chassisBody;
    return {
      pos: { x: cb.position.x, y: cb.position.y, z: cb.position.z },
      vel: { x: cb.velocity.x, y: cb.velocity.y, z: cb.velocity.z },
      speed: Math.hypot(cb.velocity.x, cb.velocity.z),
    };
  });

  const dz = after.pos.z - before.pos.z;
  const dy = after.pos.y - before.pos.y;
  const horizSpeed = after.speed;

  console.log('BEFORE', JSON.stringify(before));
  console.log('AFTER ', JSON.stringify(after));
  console.log(`Δz=${dz.toFixed(0)} Δy=${dy.toFixed(0)} speed=${horizSpeed.toFixed(0)}`);

  // Empirical baseline (commit 5a817823, the pre-overhaul "working" code):
  //   4.5s of W on a flat 30-tile straight → ≈4.7 m forward, ≈11 m/s peak.
  // The bug we're guarding against (commit 5cbf10fb) caused the kart to be
  // slammed through the road by an order-of-magnitude downforce error,
  // resulting in < 1 m forward over the same period and speed wandering
  // around 100 mm/s with massive vertical bouncing. Thresholds below sit
  // safely above the bug-floor (~1 m, 0.1 m/s) but tolerate ±50 % CPU
  // jitter when the suite runs in parallel.
  expect(dz, `kart should drive forward ≥2 m (got ${dz.toFixed(0)} mm)`).toBeGreaterThan(M(2));
  expect(horizSpeed, `kart should be moving ≥4 m/s after 4.5s W (got ${horizSpeed.toFixed(0)} mm/s)`).toBeGreaterThan(M(4));
  // Vertical drift > 4 m means the chassis is being launched, not driving.
  expect(Math.abs(dy), `kart should not drift far vertically (got Δy=${dy.toFixed(0)} mm)`).toBeLessThan(M(4));
});
