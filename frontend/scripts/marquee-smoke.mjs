// Smoke test: drag a marquee rectangle in the editor and confirm multiple
// placements get selected. Talks to a running vite dev server.
import { chromium } from '@playwright/test';

const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';

let browser;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { browser = await chromium.launch({ headless: true }); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 1000 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

// Lay out a 3x3 grid of straights.
const setup = await page.evaluate(() => {
  const { track, rebuildAll } = window.__studio;
  track.clear();
  for (let x = -1; x <= 1; x++) {
    for (let z = -1; z <= 1; z++) {
      track.place('straight', x, z, 0);
    }
  }
  rebuildAll();
  return track.all().length;
});
console.log('placed:', setup);

// Aim the camera straight down so all 9 tiles are visible and centred.
await page.evaluate(() => {
  const { camera, scene } = window.__studio;
  const TILE = 12 * 1000;
  camera.position.set(0, 6 * TILE, 0.0001);
  camera.lookAt(0, 0, 0);
  // The editor uses an OrthographicCamera helper too; make sure projection
  // matrix is updated on whichever is active.
  if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
});
await page.waitForTimeout(400);

// Make sure pointer tool is active (no segment selected to place).
await page.evaluate(() => {
  if (typeof window.__studio.setActiveTool === 'function') {
    window.__studio.setActiveTool(null);
  }
});

// Drag a big rectangle covering the canvas centre.
const box = await page.evaluate(() => {
  const c = document.getElementById('canvas');
  const r = c.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
});
const cx = box.x + box.w / 2;
const cy = box.y + box.h / 2;
const half = Math.min(box.w, box.h) * 0.40;

await page.mouse.move(cx - half, cy - half);
await page.mouse.down({ button: 'left' });
// Move in a few steps so mousemove fires.
for (let i = 1; i <= 5; i++) {
  await page.mouse.move(cx - half + (2 * half * i / 5), cy - half + (2 * half * i / 5));
}
await page.mouse.up({ button: 'left' });

await page.waitForTimeout(300);

const selectedCount = await page.evaluate(() => {
  return {
    placements: window.__studio.selectedIds.size,
    decor: window.__studio.selectedDecorIds.size,
    total: window.__studio.track.all().length,
  };
});

console.log('selectedCount:', selectedCount);
if (selectedCount.placements < 4) {
  console.error('FAIL: marquee did not select multiple placements');
  process.exit(1);
}
console.log('OK: marquee selected', selectedCount.placements, 'placements');

await browser.close();
