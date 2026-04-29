// Snapshot the new banked turn from multiple angles so we can visually
// verify the redesign aligns edge-to-edge with neighbours.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';
const OUT_DIR = 'dev-snapshots/banked-turn';
fs.mkdirSync(OUT_DIR, { recursive: true });

let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.rebuildAll, null, { timeout: 15000 });

await p.evaluate(() => {
  const { track, rebuildAll } = window.__studio;
  track.clear();
  // South straight → banked L → West straight (rot=1 to align E-W)
  track.place('straight', 0, -1, 0);
  track.place('banked_turn', 0, 0, 0);
  track.place('straight', -1, 0, 1);
  rebuildAll();
});

async function shot(name, frame) {
  await p.evaluate((cam) => {
    const { THREE, scene, camera } = window.__studio;
    if (cam) {
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.lx, cam.ly, cam.lz);
      camera.updateProjectionMatrix();
    }
    // Force render
    if (window.__studio.renderer && scene && camera) {
      window.__studio.renderer.render(scene, camera);
    }
  }, frame);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(`wrote ${OUT_DIR}/${name}.png`);
}

await shot('overhead', { x: 0, y: 28000, z: 0, lx: 0, ly: 0, lz: 0 });
await shot('iso-front', { x: 14000, y: 9000, z: 18000, lx: -2000, ly: 1000, lz: -2000 });
await shot('side-low', { x: 22000, y: 2500, z: 0, lx: 0, ly: 1000, lz: 0 });
await shot('seam-south', { x: -3000, y: 1500, z: -16000, lx: 0, ly: 500, lz: -6000 });
await shot('seam-west', { x: -16000, y: 1500, z: -3000, lx: -6000, ly: 500, lz: 0 });

await b.close();
