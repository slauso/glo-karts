// banked-turn-static-probe.mjs — place the chassis at multiple points on
// the bowl with an appropriate tangent velocity and observe whether the
// kart stays on the bank (good) or launches up / falls off (bad).

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.EDITOR_BASE || 'http://127.0.0.1:5173';
const OUT  = path.resolve('dev-snapshots/banked-physics');

const TRACK = {
  v: 1, name: 'Banked turn static probe',
  placements: [
    { k: 'spawn',       x: 1, z: -1, r: 0 },
    { k: 'banked_turn', x: 0, z:  1, r: 0 },
    { k: 'finish',      x: -2, z: 2, r: 1 },
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

async function probeAt({ a, speed, label }) {
  const browser = await getBrowser();
  const page = (await browser.contexts())[0]?.pages()[0] ?? await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text()); });

  const code = encodeTrack(TRACK);
  await page.goto(`${BASE}/play.html?track=${code}&from=editor`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__play && !!window.__play.chassisBody, { timeout: 15000 });
  await page.waitForTimeout(800);

  // Compute the world position on the centerline at arc angle `a`,
  // with the bowl's bank tangent direction. The bowl in segments.js
  // uses center cx=cz=-TILE/2, r=1.5*TILE (segment-local mm).
  const TILE = 36 * 1000;        // mm
  const ROAD_THICK = 0.5 * 1000;
  const LIFT_MAX = 32.4 * 1000 * 0.20;   // ROAD_WIDTH=32.4 → lift apex
  const cx = -TILE / 2;
  const cz = -TILE / 2;
  const r  = 1.5 * TILE;
  // Segment placement origin at world (gx*TILE, 0, gz*TILE) = (0, 0, 36000).
  const segOriginX = 0, segOriginZ = TILE;
  const segLocalX = cx + r * Math.cos(a);
  const segLocalZ = cz + r * Math.sin(a);
  const t = a / (Math.PI / 2);
  const lift = Math.sin(t * Math.PI) * LIFT_MAX;
  const surfaceY = ROAD_THICK + lift * 0;     // u=0 → centerline → no extra lift
  const wx = segOriginX + segLocalX;
  const wz = segOriginZ + segLocalZ;
  // Tangent direction: derivative of (cos a, sin a) is (-sin a, cos a)
  // (going CCW). Velocity points along the centerline in CCW direction.
  const tx = -Math.sin(a);
  const tz =  Math.cos(a);
  const chassisH = 800;          // sit chassis ~ 1.3 m above road top so wheels touch

  const result = await page.evaluate(({ wx, wy, wz, tx, tz, speed, yaw }) => {
    const c = window.__play.chassisBody;
    const set = (obj, x, y, z, w) => {
      if (!obj) return;
      obj.x = x; obj.y = y; obj.z = z;
      if (w !== undefined && 'w' in obj) obj.w = w;
    };
    set(c.position, wx, wy, wz);
    set(c.interpolatedPosition, wx, wy, wz);
    set(c.velocity, tx * speed, 0, tz * speed);
    set(c.angularVelocity, 0, 0, 0);
    const hy = yaw / 2;
    set(c.quaternion, 0, Math.sin(hy), 0, Math.cos(hy));
    set(c.interpolatedQuaternion, 0, Math.sin(hy), 0, Math.cos(hy));
    return null;
  }, { wx, wy: surfaceY + chassisH, wz, tx, tz, speed, yaw: Math.atan2(tx, tz) });

  const samples = [];
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
      const c = window.__play.chassisBody;
      return {
        t: performance.now() / 1000,
        x: c.position.x, y: c.position.y, z: c.position.z,
        vx: c.velocity.x, vy: c.velocity.y, vz: c.velocity.z,
        speed: Math.hypot(c.velocity.x, c.velocity.z),
      };
    });
    samples.push(s);
  }
  const yMax = Math.max(...samples.map(s => s.y));
  const yMin = Math.min(...samples.map(s => s.y));
  const speedFinal = samples.at(-1).speed;
  const speedMax = Math.max(...samples.map(s => s.speed));
  console.log(`[${label}] a=${a.toFixed(2)} v0=${speed} → y[${yMin.toFixed(0)}…${yMax.toFixed(0)}] sp_final=${speedFinal.toFixed(0)} sp_max=${speedMax.toFixed(0)}`);
  for (let i = 0; i < samples.length; i += 5) {
    const s = samples[i];
    console.log(`  t=${s.t.toFixed(2)} pos=(${s.x.toFixed(0)},${s.y.toFixed(0)},${s.z.toFixed(0)}) v=(${s.vx.toFixed(0)},${s.vy.toFixed(0)},${s.vz.toFixed(0)}) sp=${s.speed.toFixed(0)}`);
  }
  await page.screenshot({ path: path.join(OUT, `static-${label}.png`), fullPage: false });
  await browser.close();
  return { yMax, yMin, speedFinal };
}

await mkdir(OUT, { recursive: true });

console.log('--- Static placement probe ---');
// Probe centerline at three angles, low speed first
for (const speed of [10000, 25000, 40000]) {
  for (const a of [0.05, Math.PI / 4, Math.PI / 2 - 0.05]) {
    await probeAt({ a, speed, label: `a${(a*100).toFixed(0)}-v${speed}` });
  }
}
