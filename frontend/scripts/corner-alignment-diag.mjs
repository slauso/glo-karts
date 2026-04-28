// Render a corner-to-straight joint at extreme close-up so we can see any
// geometry gap or misalignment between the corner's curb and the next
// straight's curb.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
const OUT = path.resolve('dev-snapshots/corner-align');
fs.mkdirSync(OUT, { recursive: true });

let browser;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { browser = await chromium.launch({ headless: true }); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1800, height: 1200 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

await page.evaluate(() => {
  const { track, rebuildAll } = window.__studio;
  track.clear();
  // straight running along +Z, then a corner at (0,2), then a rotated straight
  // heading -X.
  track.place('straight', 0, 0);
  track.place('straight', 0, 1);
  track.place('corner', 0, 2);
  track.place('straight', -1, 2, 1);
  track.place('straight', -2, 2, 1);
  rebuildAll();
});

// Top-down close-up of both joints
async function shot(name, camFn) {
  await page.evaluate(camFn);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
}

const TILE = 12 * 1000;

// Top-down — entry joint (corner cell south edge meets straight north edge)
await shot('joint-entry-top', () => {
  const T = 12000;
  const { camera } = window.__studio;
  camera.position.set(0, 50000, 18000);
  camera.lookAt(0, 0, 18000);
});

// Top-down — exit joint (corner cell west edge meets rotated straight east edge)
await shot('joint-exit-top', () => {
  const T = 12000;
  const { camera } = window.__studio;
  camera.position.set(-6000, 50000, 24000);
  camera.lookAt(-6000, 0, 24000);
});

// Pure orthographic-ish overhead of the whole layout (centred on layout)
await shot('overhead', () => {
  const { camera } = window.__studio;
  // Layout centre: x ranges roughly -24000..+6000 → -9000; z ranges 0..24000 → 12000
  camera.position.set(-9000, 100000, 12000);
  camera.lookAt(-9000, 0, 12000);
});

// And dump the actual mesh bounding boxes for the corner + adjacent straights
const data = await page.evaluate(() => {
  const { track, scene, THREE } = window.__studio;
  const out = [];
  scene.traverse(o => {
    if (o.userData?.placementId == null) return;
    const id = o.userData.placementId;
    const p = track.getById(id);
    if (!p) return;
    const box = new THREE.Box3().setFromObject(o);
    out.push({
      id, key: p.key, gx: p.gx, gz: p.gz, rot: p.rot,
      min: { x: box.min.x.toFixed(2), y: box.min.y.toFixed(2), z: box.min.z.toFixed(2) },
      max: { x: box.max.x.toFixed(2), y: box.max.y.toFixed(2), z: box.max.z.toFixed(2) },
    });
  });
  return out;
});
console.log(JSON.stringify(data, null, 2));

await browser.close();
