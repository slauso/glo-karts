/**
 * physics-diagnose.spec.mjs — Holds W for 3s on a long straight and
 * prints a per-frame trace of chassis state. Used to root-cause the
 * "kart won't move" regression. Always passes; output is the artifact.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

test('physics diagnostic trace under W', async ({ page }) => {
  const consoleLines = [];
  page.on('pageerror', (e) => consoleLines.push(`PAGEERROR ${e.message}`));
  page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));

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

  // Watch physics settle BEFORE any input to see if wheels touch ground.
  console.log('SETTLE TRACE');
  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 100)));
    const s = await page.evaluate(() => {
      const cb = window.__play.chassisBody;
      const v = window.__play.vehicle;
      return {
        t: performance.now() | 0,
        y: cb.position.y | 0,
        vy: cb.velocity.y | 0,
        wheels: v.wheelInfos.map((w) => w.isInContact ? 1 : 0).join(''),
      };
    });
    console.log(JSON.stringify(s));
  }

  const initial = await page.evaluate(() => {
    const cb = window.__play.chassisBody;
    const v = window.__play.vehicle;
    return {
      pos: { x: cb.position.x, y: cb.position.y, z: cb.position.z },
      vel: { x: cb.velocity.x, y: cb.velocity.y, z: cb.velocity.z },
      quat: { x: cb.quaternion.x, y: cb.quaternion.y, z: cb.quaternion.z, w: cb.quaternion.w },
      mass: cb.mass,
      angDamping: cb.angularDamping,
      linDamping: cb.linearDamping,
      wheels: v.wheelInfos.map((w, i) => ({
        i,
        contact: w.isInContact,
        suspensionLength: w.suspensionLength,
        engineForce: w.engineForce,
        brake: w.brake,
        steering: w.steering,
        slipInfo: w.slipInfo,
      })),
      controlState: { ...window.__play.controlState },
      keys: { ...window.__play.keys },
    };
  });
  console.log('INITIAL', JSON.stringify(initial, null, 2));

  // Hold W and sample every 250ms.
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' })));

  const samples = [];
  for (let i = 0; i < 12; i++) {
    await page.evaluate(() => new Promise((r) => setTimeout(r, 250)));
    const s = await page.evaluate(() => {
      const cb = window.__play.chassisBody;
      const v = window.__play.vehicle;
      return {
        t: performance.now() | 0,
        pos: [cb.position.x | 0, cb.position.y | 0, cb.position.z | 0],
        vel: [cb.velocity.x | 0, cb.velocity.y | 0, cb.velocity.z | 0],
        speed: Math.hypot(cb.velocity.x, cb.velocity.z) | 0,
        throttle: window.__play.controlState.throttle.toFixed(3),
        wheelsInContact: v.wheelInfos.filter((w) => w.isInContact).length,
        engineFwd: v.wheelInfos[0].engineForce | 0,
        keysW: window.__play.keys.w,
      };
    });
    samples.push(s);
  }
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' })));

  console.log('TRACE');
  for (const s of samples) console.log(JSON.stringify(s));
  console.log('CONSOLE LINES', consoleLines.length);
  for (const l of consoleLines.slice(0, 30)) console.log(l);
  expect(true).toBe(true);
});
