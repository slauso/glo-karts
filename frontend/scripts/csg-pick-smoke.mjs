// Verify clicking a CSG (hole-bearing) group mesh selects the group.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const OUT = path.resolve('dev-snapshots');
await fs.mkdir(OUT, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
let browser, ctx;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); ctx = browser.contexts()[0]; }
catch { browser = await chromium.launch(); ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } }); }
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) page = await ctx.newPage();
await page.goto('http://127.0.0.1:5173/editor.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 10000 });
await page.waitForTimeout(400);

// Build: a solid box + cylinder hole, group them, force CSG.
const setup = await page.evaluate(() => {
  const s = window.__studio;
  s.decor.clear();
  const a = s.decor.add({ type: 'box', sx: 8000, sy: 4000, sz: 8000, color: 0xee8b1a });
  const b = s.decor.add({ type: 'cylinder', sx: 4000, sy: 6000, sz: 4000, isHole: true, y: -500 });
  a.groupId = 'g-pick'; b.groupId = 'g-pick';
  s.rebuildAllDecor();
  s.rebuildCSGForGroup('g-pick');
  s.camera.position.set(15000, 10000, 15000);
  s.camera.lookAt(0, 2000, 0);
  return { a: a.id, b: b.id, csgPresent: !!s.csgMeshByGid.get('g-pick') };
});
console.log('[setup]', setup);

// Project the merged CSG mesh's center to screen and click.
const click = await page.evaluate(() => {
  const s = window.__studio;
  const m = s.csgMeshByGid.get('g-pick');
  if (!m) return { ok: false, reason: 'no-csg-mesh' };
  const canvas = document.querySelector('canvas');
  const rect = canvas.getBoundingClientRect();
  // Use the mesh's geometry bounding box center -> world -> NDC via camera.
  m.geometry.computeBoundingBox();
  const bb = m.geometry.boundingBox;
  const cx3 = (bb.min.x + bb.max.x) / 2;
  const cy3 = (bb.min.y + bb.max.y) / 2;
  const cz3 = (bb.min.z + bb.max.z) / 2;
  // Apply matrixWorld then projection (replicating Vector3.project manually).
  const e = m.matrixWorld.elements;
  let x = e[0]*cx3 + e[4]*cy3 + e[8]*cz3 + e[12];
  let y = e[1]*cx3 + e[5]*cy3 + e[9]*cz3 + e[13];
  let z = e[2]*cx3 + e[6]*cy3 + e[10]*cz3 + e[14];
  let w = e[3]*cx3 + e[7]*cy3 + e[11]*cz3 + e[15];
  // camera.matrixWorldInverse * projectionMatrix
  s.camera.updateMatrixWorld();
  const inv = s.camera.matrixWorldInverse.elements;
  const x1 = inv[0]*x + inv[4]*y + inv[8]*z + inv[12]*w;
  const y1 = inv[1]*x + inv[5]*y + inv[9]*z + inv[13]*w;
  const z1 = inv[2]*x + inv[6]*y + inv[10]*z + inv[14]*w;
  const w1 = inv[3]*x + inv[7]*y + inv[11]*z + inv[15]*w;
  const p = s.camera.projectionMatrix.elements;
  const x2 = p[0]*x1 + p[4]*y1 + p[8]*z1 + p[12]*w1;
  const y2 = p[1]*x1 + p[5]*y1 + p[9]*z1 + p[13]*w1;
  const w2 = p[3]*x1 + p[7]*y1 + p[11]*z1 + p[15]*w1;
  const ndcX = x2 / w2;
  const ndcY = y2 / w2;
  return { ok: true, cx: rect.left + (ndcX * 0.5 + 0.5) * rect.width, cy: rect.top + (-ndcY * 0.5 + 0.5) * rect.height };
});
console.log('[click-target]', click);

if (click.ok) {
  await page.mouse.click(click.cx, click.cy);
  await page.waitForTimeout(200);
}

const sel = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('#inspectorPopup'))
    .map(el => ({ hidden: el.hidden, title: el.querySelector('.ip-title')?.textContent }));
});
console.log('[inspector]', JSON.stringify(sel));

const shot = path.join(OUT, `csg-pick-${ts}.png`);
await page.screenshot({ path: shot });
console.log('[shot]', shot);

await browser.close();
console.log('[done]');
