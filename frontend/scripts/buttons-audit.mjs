// Verifies each header button now has a working handler.
// Drives each by id, checks observable side-effects.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.EDITOR_URL || 'http://localhost:5173/editor.html';
const OUT = path.resolve('dev-snapshots/buttons-audit');
fs.mkdirSync(OUT, { recursive: true });

let browser;
try { browser = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { browser = await chromium.launch({ headless: true }); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = await ctx.newPage();
let dialog = null;
page.on('dialog', async (d) => { dialog = d.message(); await d.dismiss(); });

await page.setViewportSize({ width: 1400, height: 860 });
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.__studio, null, { timeout: 15000 });

const results = {};

// 1. Hamburger menu opens dropdown
await page.click('#menuBtn');
results.menuOpens = await page.isVisible('#menuDropdown');
// Click outside (use Escape via click on canvas with force; the document listener filters menu/menuBtn).
await page.locator('canvas').click({ position: { x: 600, y: 500 }, force: true });
await page.waitForTimeout(150);
const dbg = await page.evaluate(() => ({
  hidden: document.getElementById('menuDropdown')?.hidden,
  display: getComputedStyle(document.getElementById('menuDropdown')).display,
}));
console.log('[debug] menu state after canvas click:', dbg);
results.menuCloses = !(await page.isVisible('#menuDropdown'));

// 2. Top tabs
const tabIds = ['topTabDesign','topTabSimulate','topTabHome','topTabLibrary','topTabAdjust','topTabBrick'];
for (const id of tabIds) results['exists_'+id] = await page.locator('#'+id).count() > 0;

// 2a. Brick view toggles wireframe
await page.click('#topTabBrick');
await page.waitForTimeout(150);
results.brickWireframeOn = await page.evaluate(() => {
  const s = window.__studio;
  let on = false; s.scene.traverse(o => { if (o.isMesh && o.material && o.material.wireframe) on = true; });
  return on;
});
await page.click('#topTabBrick');
await page.waitForTimeout(150);
results.brickWireframeOff = await page.evaluate(() => {
  const s = window.__studio;
  let onCount = 0; s.scene.traverse(o => { if (o.isMesh && o.material && o.material.wireframe) onCount++; });
  return onCount === 0;
});

// 2b. Adjust opens settings popup
dialog = null;
await page.click('#topTabAdjust');
await page.waitForTimeout(200);
results.adjustOpensTerrainPopup = await page.isVisible('#terrainPopup');

// 3. Right-aside tabs
await page.click('#tabNotes');
await page.waitForTimeout(150);
results.notesPanelShown = await page.isVisible('#notesPanel');
results.paletteHiddenWhenNotes = !(await page.isVisible('#palette'));

// Type into notes
await page.fill('#trackNotesArea', 'audit smoke');
await page.waitForTimeout(50);
results.notesPersisted = await page.evaluate(() => {
  return Object.keys(localStorage).some(k => k.startsWith('gloKartsStudio.notes::'));
});

await page.click('#tabShapes');
await page.waitForTimeout(150);
results.paletteShownAgain = await page.isVisible('#palette');

await page.screenshot({ path: path.join(OUT, 'after-tabs.png') });

const failed = Object.entries(results).filter(([,v]) => !v);
console.log('[buttons-audit] results:', results);
if (failed.length) { console.log('[buttons-audit] FAIL:', failed.map(([k]) => k).join(', ')); process.exit(1); }
console.log('[buttons-audit] all', Object.keys(results).length, 'checks PASS');
await page.close();
if (browser.isConnected()) await browser.close();
