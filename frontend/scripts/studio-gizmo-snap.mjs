// Place a decor box in our editor, select it, then screenshot for gizmo
// inspection. Uses CDP-controlled Chrome to drive the live tab.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = path.resolve('dev-snapshots');
await fs.mkdir(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('127.0.0.1:5173/editor.html'));
if (!page) {
  page = await ctx.newPage();
  await page.goto('http://127.0.0.1:5173/editor.html');
}
await page.bringToFront();
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);

// Place a Box decor near origin and select it.
const placed = await page.evaluate(() => {
  const s = window.__studio;
  if (!s) return { error: 'no __studio' };
  // Try API: decor.add({type:'box', x,y,z,rx,ry,rz,sx,sy,sz})
  let inst = null;
  try {
    inst = s.decor.add({ type: 'box', x: 0, y: 0, z: 0 });
  } catch (e) { return { error: 'add: ' + e.message }; }
  if (!inst) {
    // Fall back: click the Box thumbnail in the right panel.
    const boxBtn = document.querySelector('[data-decor-type="box"], [data-shape="box"], button[title="Box"]');
    if (boxBtn) boxBtn.click();
  }
  s.rebuildAllDecor?.();
  // Select it
  if (inst && s.selectDecor) {
    try { s.selectDecor(inst.id); } catch {}
  }
  return { ok: true, id: inst?.id, type: inst?.type };
});
console.log('[place] result =', placed);
await page.waitForTimeout(700);

const shotPath = path.join(OUT_DIR, `gloglow-gizmo-${ts}.png`);
await page.screenshot({ path: shotPath });
console.log('[place] shot =', shotPath);
await browser.close();
