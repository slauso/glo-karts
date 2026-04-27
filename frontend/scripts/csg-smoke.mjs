// CSG smoke: place a box + smaller box (as Hole) overlapping, group, screenshot.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve('dev-snapshots');
await fs.mkdir(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

let browser, ctx;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  ctx = browser.contexts()[0];
} catch {
  browser = await chromium.launch();
  ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
}
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 10000 });
await page.waitForTimeout(400);

const result = await page.evaluate(() => {
  const s = window.__studio;
  s.decor.clear();
  // Big solid box
  const solid = s.decor.add({ type: 'box', x: 0, y: 0, z: 0, sx: 8000, sy: 4000, sz: 8000, color: 0xee8b1a });
  // Smaller cylinder marked as hole, overlapping
  const hole = s.decor.add({ type: 'cylinder', x: 0, y: -500, z: 0, sx: 4000, sy: 6000, sz: 4000, isHole: true });
  // Group them and rebuild CSG
  for (const id of [solid.id, hole.id]) s.decor.getById(id).groupId = 'g-test';
  s.rebuildAllDecor();
  s.rebuildCSGForGroup('g-test');
  return {
    solidId: solid.id, holeId: hole.id,
    csgPresent: s.csgMeshByGid.has('g-test'),
    csgVertCount: s.csgMeshByGid.get('g-test')?.geometry?.attributes?.position?.count || 0,
    solidVisible: s.decorMeshById.get(solid.id)?.visible,
    holeVisible: s.decorMeshById.get(hole.id)?.visible,
  };
});
console.log('[csg]', JSON.stringify(result));

// Frame the box: aim camera at origin from above-front.
await page.evaluate(() => {
  const s = window.__studio;
  s.camera.position.set(15000, 10000, 15000);
  s.camera.lookAt(0, 2000, 0);
});
await page.waitForTimeout(200);

const shot = path.join(OUT, `csg-${ts}-cyl-hole.png`);
await page.screenshot({ path: shot });
console.log('[shot]', shot);

await browser.close();
console.log('[done]');
