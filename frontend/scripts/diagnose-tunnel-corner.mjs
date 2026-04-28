// Headless render of a small track using tunnel + corner + adjacent straights
// to capture the alignment + tunnel-roof bugs the user reported.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
const OUT = path.resolve('dev-snapshots/tunnel-corner-diag');
fs.mkdirSync(OUT, { recursive: true });

let browser;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { browser = await chromium.launch({ headless: true }); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

await page.evaluate(() => {
  const { track, rebuildAll, scene, camera, THREE } = window.__studio;
  track.clear();
  // Lay a straight + corner-L + straight rotated, plus a tunnel further over.
  // Layout (cell coords, [x, z, rotY]):
  //   straight at (0,0)
  //   straight at (0,1)
  //   corner L at (0,2)  (enters -Z, exits -X)
  //   straight (rot 90°) at (-1, 2)
  //   tunnel at (3, 0)  isolated for visual inspection
  const place = (key, cx, cz, rotY = 0) => track.place(key, cx, cz, rotY);
  place('straight', 0, 0);
  place('straight', 0, 1);
  place('corner', 0, 2);
  place('straight', -1, 2, Math.PI / 2);
  place('straight', -2, 2, Math.PI / 2);
  place('tunnel', 4, 0);
  rebuildAll();
  // Frame the corner joint
  const TILE = 12 * 1000;
  camera.position.set(-1.5 * TILE, 1.5 * TILE, -0.5 * TILE);
  camera.lookAt(-0.5 * TILE, 0, 1.0 * TILE);
});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'corner-joint.png') });

// Now frame the tunnel from the side
await page.evaluate(() => {
  const { camera } = window.__studio;
  const TILE = 12 * 1000;
  camera.position.set(4 * TILE + 2*TILE, 1.5 * TILE, 1.5 * TILE);
  camera.lookAt(4 * TILE, 0, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'tunnel-side.png') });

// Tunnel from above
await page.evaluate(() => {
  const { camera } = window.__studio;
  const TILE = 12 * 1000;
  camera.position.set(4 * TILE, 4 * TILE, 0);
  camera.lookAt(4 * TILE, 0, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'tunnel-top.png') });

// Frame the entrance straight-on
await page.evaluate(() => {
  const { camera } = window.__studio;
  const TILE = 12 * 1000;
  camera.position.set(4 * TILE, 0.6 * TILE, -2 * TILE);
  camera.lookAt(4 * TILE, 0.6 * TILE, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'tunnel-entrance.png') });

// Rotate tunnel 90° and re-render
await page.evaluate(() => {
  const { track, rebuildAll, camera } = window.__studio;
  track.clear();
  track.place('tunnel', 4, 0, Math.PI / 2);
  rebuildAll();
  const TILE = 12 * 1000;
  camera.position.set(4 * TILE, 1.5 * TILE, -2 * TILE);
  camera.lookAt(4 * TILE, 0, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'tunnel-rot90.png') });

await page.evaluate(() => {
  const { track, rebuildAll, camera } = window.__studio;
  track.clear();
  track.place('tunnel', 4, 0, Math.PI);
  rebuildAll();
  const TILE = 12 * 1000;
  camera.position.set(4 * TILE, 1.5 * TILE, 2 * TILE);
  camera.lookAt(4 * TILE, 0, 0);
});
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, 'tunnel-rot180.png') });

console.log('[diag] screenshots in', OUT);
await page.close();
if (browser.isConnected()) await browser.close();
