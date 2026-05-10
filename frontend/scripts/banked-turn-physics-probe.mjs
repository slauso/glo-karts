// banked-turn-physics-probe.mjs — drive a kart into a banked-turn loop
// and report whether it traverses the bowl or clips/stalls.
//
// Track layout: the banked_turn (2×2) anchors at cell (0,1) so it
// occupies global cells (0,1),(1,1),(0,2),(1,2). Its connectors are the
// S edge of segment-local cell (1,0) → global cell (1,1) — south edge
// world (TILE, TILE/2) — and the W edge of segment-local cell (0,1) →
// global cell (0,2) — west edge world (-TILE/2, 2·TILE).
// So we feed the entry from a straight column at x=1 (heading north)
// and catch the exit with a straight row at z=3 heading west.

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.EDITOR_BASE || 'http://127.0.0.1:5173';
const OUT  = path.resolve('dev-snapshots/banked-physics');

const TRACK = {
  v: 1,
  name: 'Banked turn probe',
  placements: [
    { k: 'spawn',       x: 1, z: -1, r: 0 },
    { k: 'straight',    x: 1, z:  0, r: 0 },
    { k: 'banked_turn', x: 0, z:  1, r: 0 },     // 2x2 footprint
    { k: 'straight',    x: -1, z: 2, r: 1 },
    { k: 'straight',    x: -2, z: 2, r: 1 },
    { k: 'finish',      x: -3, z: 2, r: 1 },
  ],
};

function encodeTrack(json) {
  return Buffer.from(JSON.stringify(json), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getBrowser() {
  try { return await chromium.connectOverCDP('http://127.0.0.1:9222'); }
  catch { return await chromium.launch({ headless: true }); }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await getBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });

  const code = encodeTrack(TRACK);
  await page.goto(`${BASE}/play.html?track=${code}&from=editor`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__play && !!window.__play.chassisBody, { timeout: 15000 });
  await page.waitForTimeout(800);                 // let physics settle

  // Top-down screenshot of the bowl before we start driving so we can
  // sanity-check the geometry. Park the camera 90 m above the bowl
  // centre and aim straight down. The render loop overwrites this on
  // the next chase-cam frame, so we capture immediately.
  await page.evaluate(() => {
    const c = window.__play.camera;
    // Bowl segment is placed at (gx=0, gz=1) with span 2x2; centroid
    // sits roughly at world (18000, 0, 54000) mm.
    c.position.set(18000, 90000, 54000);
    c.lookAt(18000, 0, 54000);
    c.updateProjectionMatrix();
    window.__play.renderer.render(window.__play.scene, c);
  });
  await page.screenshot({ path: path.join(OUT, 'bowl-topdown.png'), fullPage: false });
  // Side view across the entry (look north along +z from south of the bowl)
  await page.evaluate(() => {
    const c = window.__play.camera;
    c.position.set(18000, 30000, -10000);
    c.lookAt(0, 5000, 54000);
    c.updateProjectionMatrix();
    window.__play.renderer.render(window.__play.scene, c);
  });
  await page.screenshot({ path: path.join(OUT, 'bowl-side.png'), fullPage: false });

  // Hold throttle. Steering is engaged BEFORE the entry seam so the
  // kart is already arcing left when it meets the bowl — otherwise a
  // straight-line entry rams the rising bank and gets launched.
  await page.evaluate(() => {
    const fire = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
    const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true }));
    window.__bp = { fire, release };
    fire('ArrowUp');
  });

  const samples = [];
  const SAMPLES = 100;       // 20 seconds @ 0.2 s
  // Speed plan:
  //   * full throttle on the short straight
  //   * release throttle + tap brake when within 8 m of the bowl
  //     (bank radius = 54 m; safe speed with help from bank ≈ 30 m/s)
  //   * arc steer-left from the moment we lift, through the bowl
  //   * resume throttle once heading west on the exit straights
  let phase = 'accel';
  let arcStartYaw = 0;
  for (let i = 0; i < SAMPLES; i++) {
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const c = window.__play.chassisBody;
      const q = c.quaternion;
      // Yaw from quaternion (Y-axis rotation): atan2(2(wy+xz), 1-2(yy+xx)).
      const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
      return {
        t: performance.now() / 1000,
        x: c.position.x, y: c.position.y, z: c.position.z,
        vx: c.velocity.x, vy: c.velocity.y, vz: c.velocity.z,
        speed: Math.hypot(c.velocity.x, c.velocity.z),
        yaw,
      };
    });
    samples.push(s);

    if (phase === 'accel' && s.z >= -20000) {
      // Approaching bowl entry (z=18000 mm). Lift throttle and brake
      // to bleed off the wild straight-line top speed.
      await page.evaluate(() => {
        window.__bp.release('ArrowUp');
        window.__bp.fire('ArrowDown');
      });
      phase = 'brake';
    } else if (phase === 'brake' && s.speed <= 26000) {
      // Drop brake, hold steady throttle through the arc, steer left.
      await page.evaluate(() => {
        window.__bp.release('ArrowDown');
        window.__bp.fire('ArrowLeft');
        window.__bp.fire('ArrowUp');
      });
      phase = 'arc';
      arcStartYaw = s.yaw;
    } else if (phase === 'arc' && Math.abs(((s.yaw - arcStartYaw + Math.PI) % (2 * Math.PI)) - Math.PI) >= Math.PI * 0.45) {
      // Yawed ~80° from the entry heading — release steering to coast
      // out of the bowl onto the exit straight.
      await page.evaluate(() => {
        window.__bp.release('ArrowLeft');
      });
      phase = 'exit';
    }
  }
  await page.evaluate(() => { window.__bp.release('ArrowUp'); window.__bp.release('ArrowLeft'); });
  await page.screenshot({ path: path.join(OUT, 'final.png'), fullPage: false });

  await writeFile(path.join(OUT, 'samples.json'), JSON.stringify(samples, null, 2));

  // Report
  const yMin = Math.min(...samples.map(s => s.y));
  const yMax = Math.max(...samples.map(s => s.y));
  const speedMax = Math.max(...samples.map(s => s.speed));
  const speedMin = Math.min(...samples.map(s => s.speed));
  const speedFinal = samples.at(-1).speed;
  const xFinal = samples.at(-1).x;
  const zFinal = samples.at(-1).z;
  const traveled = Math.hypot(xFinal - 0, zFinal - (-3*36000));   // very rough

  console.log('--- Banked turn physics probe ---');
  console.log(`samples=${samples.length}`);
  console.log(`y range: ${yMin.toFixed(0)} … ${yMax.toFixed(0)} mm`);
  console.log(`speed:   min=${speedMin.toFixed(0)} max=${speedMax.toFixed(0)} final=${speedFinal.toFixed(0)} mm/s`);
  console.log(`final pos: x=${xFinal.toFixed(0)} z=${zFinal.toFixed(0)}`);
  console.log('samples (every 0.4 s):');
  for (let i = 0; i < samples.length; i += 2) {
    const s = samples[i];
    console.log(`  t=${s.t.toFixed(2)} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}) v=(${s.vx.toFixed(0)},${s.vy.toFixed(0)},${s.vz.toFixed(0)}) sp=${s.speed.toFixed(0)}`);
  }
  if (errs.length) {
    console.log('errors:');
    for (const e of errs.slice(0, 8)) console.log(`  ${e}`);
  }

  await ctx.close();
  await browser.close().catch(()=>{});
  // Pass if kart is moving at the end and never went underground.
  const ok = yMin > -500 && speedFinal > 1000;
  process.exitCode = ok ? 0 : 1;
}

main().catch(err => { console.error(err); process.exit(2); });
