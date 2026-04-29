// Snapshot bump + rolling hill from the side to verify curbs follow the curve.
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
const OUT_DIR = 'dev-snapshots/bump-hill-curbs';
fs.mkdirSync(OUT_DIR, { recursive: true });

let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.rebuildAll, null, { timeout: 15000 });

async function shot(name, frame, place) {
  await p.evaluate(({ cam, places }) => {
    const { track, rebuildAll, scene, camera } = window.__studio;
    track.clear();
    for (const pl of places) track.place(pl.k, pl.x, pl.z, pl.r ?? 0);
    rebuildAll();
    camera.position.set(cam.x, cam.y, cam.z);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    camera.updateProjectionMatrix();
    if (window.__studio.renderer) window.__studio.renderer.render(scene, camera);
  }, { cam: frame, places: place });
  await p.waitForTimeout(200);
  await p.screenshot({ path: `${OUT_DIR}/${name}.png` });
  console.log(`wrote ${OUT_DIR}/${name}.png`);
}

await shot('bump-side', { x: 14000, y: 1500, z: 0, lx: 0, ly: 800, lz: 0 }, [{ k: 'bump_up', x: 0, z: 0 }]);
await shot('bump-iso',  { x: 9000, y: 4500, z: 9000, lx: 0, ly: 500, lz: 0 }, [{ k: 'bump_up', x: 0, z: 0 }]);
await shot('hill-side', { x: 22000, y: 4000, z: 0, lx: 0, ly: 2500, lz: 0 }, [{ k: 'hill_complete', x: 0, z: 0 }]);
await shot('hill-iso',  { x: 14000, y: 7000, z: 14000, lx: 0, ly: 1500, lz: 0 }, [{ k: 'hill_complete', x: 0, z: 0 }]);

await b.close();
