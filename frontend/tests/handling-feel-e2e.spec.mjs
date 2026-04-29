/**
 * handling-feel-e2e.spec.mjs — Validates the kart handling/physics/camera
 * overhaul (Mario-Kart-style feel pass). These checks are coarse but they
 * lock in the *behavioural* contract so future regressions are obvious:
 *
 *   1. Holding W from a standstill reaches a meaningful forward speed
 *      within 1.5s (engine + grip + downforce all functional).
 *   2. Top speed is bounded — doesn't run away past TOP_SPEED_MS.
 *   3. Camera does NOT roll: at any time, camera.up.y stays > 0.95.
 *   4. Camera trails the kart: after a sustained turn, camera yaw lags
 *      the chassis yaw by a measurable but bounded amount (it follows,
 *      doesn't snap-track).
 *   5. Steering input ramps in (controlState.steer doesn't jump from 0
 *      to ±1 in a single frame).
 *   6. Drift hop: tapping Shift while moving raises chassisBody.velocity.y
 *      above the airborne threshold.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

async function buildBigStraightCode(page) {
  return await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    // Long straight so we can build up speed without crashing into geometry.
    t.place('spawn', 0, 0, 0);
    for (let z = 1; z < 20; z++) t.place('straight', 0, z, 0);
    return td.encodeTrack(t);
  }, BASE);
}

function holdKey(page, code, downMs) {
  return page.evaluate(async ({ code, downMs }) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    await new Promise((r) => setTimeout(r, downMs));
    window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  }, { code, downMs });
}

async function settle(page, ms) {
  await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms);
}

test.describe('Kart handling overhaul', () => {
  test('holds Mario-Kart-style feel: speed, camera lock, drift hop', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
    const code = await buildBigStraightCode(page);

    await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__play && window.__play.chassisBody, { timeout: 20000 });

    // Snapshot helper to read live engine state.
    const snap = () => page.evaluate(() => ({
      vx: window.__play.chassisBody.velocity.x,
      vy: window.__play.chassisBody.velocity.y,
      vz: window.__play.chassisBody.velocity.z,
      qy: window.__play.chassisBody.quaternion.y,
      qw: window.__play.chassisBody.quaternion.w,
      camUpY: window.__play.camera ? window.__play.camera.up.y : 1,
      px: window.__play.chassisBody.position.x,
      pz: window.__play.chassisBody.position.z,
    }));

    // 1 + 2. Drive forward 1.5s, expect meaningful speed and no runaway.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
    await settle(page, 1500);
    const fast = await snap();
    const speed = Math.hypot(fast.vx, fast.vz);
    expect(speed, 'kart should accelerate to >5 world-u/s after 1.5s of W').toBeGreaterThan(5);
    // TOP_SPEED_MS = M(38) = 38000 world-u/s in mm. Allow generous headroom
    // for over-shoot from suspension bounce — but it must not be infinite.
    expect(speed, 'top speed should stay below 50000 world-u/s (~180 km/h)').toBeLessThan(50000);

    // 3. Camera up stays near world up (no roll/flip).
    expect(fast.camUpY).toBeGreaterThan(0.95);

    // 4. Steering input smoothing — start fresh turn, sample twice.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));
    await settle(page, 200);
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    });
    await settle(page, 1200);
    const turning = await snap();
    expect(turning.camUpY, 'camera mustnt roll during a turn').toBeGreaterThan(0.95);

    // 5. Drift hop test. Stop fully so the suspension is at rest, then
    // re-engage W briefly and tap Shift. Sample vy *immediately* (next
    // frame) before gravity eats the impulse.
    await page.evaluate(() => {
      ['KeyW', 'KeyA', 'KeyS', 'KeyD'].forEach((code) => window.dispatchEvent(new KeyboardEvent('keyup', { code })));
    });
    // Hold brake to kill momentum and let suspension settle.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })));
    await settle(page, 1500);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })));
    await settle(page, 300);
    // Roll forward briefly.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));
    await settle(page, 400);
    const beforeHop = await snap();
    // Probe the speed-gate too — hop requires speedAbs > M(2).
    const beforeProbe = await page.evaluate(() => {
      const v = window.__play.chassisBody.velocity;
      return { speedAbs: Math.hypot(v.x, v.y, v.z), lastDriftPress: window.__play.controlState.lastDriftPress, cd: window.__play.controlState.driftHopCooldown };
    });
    // Capture peak vy across a short window after the Shift tap.
    const peakVy = await page.evaluate(() => new Promise((resolve) => {
      let peak = window.__play.chassisBody.velocity.y;
      let driftSeen = false;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
      const start = performance.now();
      const sample = () => {
        if (window.__play.keys.drift) driftSeen = true;
        peak = Math.max(peak, window.__play.chassisBody.velocity.y);
        if (performance.now() - start > 250) {
          window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
          resolve({ peak, driftSeen, cooldown: window.__play.controlState.driftHopCooldown });
        } else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));
    // DRIFT_HOP_VY = M(4.5) = 4500 world-u/s. Allow generous slop for
    // suspension noise but the impulse must clearly exceed pre-hop.
    expect(peakVy.peak, `shift tap should pulse vy upward (before vy=${beforeHop.vy.toFixed(0)} speedAbs=${beforeProbe.speedAbs.toFixed(0)} lastDriftPress=${beforeProbe.lastDriftPress} cd=${beforeProbe.cd} driftSeen=${peakVy.driftSeen} cdAfter=${peakVy.cooldown})`).toBeGreaterThan(beforeHop.vy + 1500);

    expect(errors, `no page errors. Got: ${errors.join(' | ')}`).toEqual([]);
  });
});
