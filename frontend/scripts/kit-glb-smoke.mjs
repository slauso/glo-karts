// Quick smoke: open editor, wait for Kenney GLB preload, drop a kit prop,
// confirm it renders, screenshot it. Falls back to launch when CDP unavailable.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = 'http://127.0.0.1:5173/editor.html';
const OUT = path.resolve('dev-snapshots/kit-glb-smoke');
fs.mkdirSync(OUT, { recursive: true });

let browser;
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
} catch {
  browser = await chromium.launch({ headless: true });
}
const context = await browser.contexts()[0] ?? await browser.newContext();
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log('[page]', msg.type(), msg.text());
  }
});
await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(URL, { waitUntil: 'load' });

await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

// Verify kit DECOR entries exist & wait for at least one GLB to load.
const kitInfo = await page.evaluate(async () => {
  const studio = window.__studio;
  // Wait up to 8s for the truck GLB to enter cache
  const probe = async () => {
    for (let i = 0; i < 80; i++) {
      // Drop one truck via DecorStore.add then build mesh
      try {
        const inst = studio.decor.add({ type: 'kit_truck_yellow', x: 0, y: 0, z: 0 });
        if (inst) {
          studio.rebuildAllDecor?.();
          // Inspect the resulting mesh
          const mesh = studio.decorMeshById?.get(inst.id);
          if (mesh) {
            const isGroup = mesh.type === 'Group' || (mesh.children && mesh.children.length > 0);
            const placeholder = mesh.userData?.kitPlaceholder === true;
            if (isGroup && !placeholder) return { ok: true, isGroup, placeholder, kids: mesh.children.length };
            // Remove and retry
            studio.decor.remove(inst.id);
            studio.rebuildAllDecor?.();
          }
        }
      } catch (e) { return { ok: false, err: String(e) }; }
      await new Promise(r => setTimeout(r, 100));
    }
    return { ok: false, err: 'timeout waiting for GLB' };
  };
  return probe();
});
console.log('[smoke] kit info:', kitInfo);

// Take a screenshot
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'editor-with-kit-truck.png'), fullPage: false });

// Also: confirm palette has 'Racing Kit' header
const hasPaletteHeader = await page.evaluate(() => {
  const headers = [...document.querySelectorAll('.palette-group')].map(e => e.textContent);
  return headers.includes('Racing Kit');
});
console.log('[smoke] palette has Racing Kit header:', hasPaletteHeader);

await page.close();
if (browser.isConnected()) await browser.close();
process.exit(kitInfo.ok && hasPaletteHeader ? 0 : 1);
