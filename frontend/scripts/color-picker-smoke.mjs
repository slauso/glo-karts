// HSV color picker smoke: open popover, drag SV cursor, verify color changes.
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

await page.evaluate(() => {
  const s = window.__studio;
  s.decor.clear();
  const inst = s.decor.add({ type: 'sphere', x: 0, y: 0, z: 0 });
  s.rebuildAllDecor();
  s.selectDecor(inst.id);
});
await page.waitForTimeout(200);

// Click Custom button to open popover
await page.click('#ipColorCustom');
await page.waitForTimeout(150);

const open = await page.evaluate(() => {
  const p = document.getElementById('ipColorPopover');
  return p && !p.hidden;
});
console.log('[popover-open]', open);

// Drag SV square to mid-saturation, mid-value
const svBox = await page.$eval('#ipCpSv', el => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width * 0.7, y: r.top + r.height * 0.3 };
});
await page.mouse.move(svBox.x, svBox.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(150);

// Drag hue slider to about green
const hueBox = await page.$eval('#ipCpHue', el => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height * 0.33 };
});
await page.mouse.move(hueBox.x, hueBox.y);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(200);

const finalHex = await page.$eval('#ipCpHex', el => el.value);
console.log('[final-hex]', finalHex);

// Crop the inspector + popover area
const box = await page.evaluate(() => {
  const ip = document.getElementById('inspectorPopup');
  const pop = document.getElementById('ipColorPopover');
  const debug = { ipExists: !!ip, ipHidden: ip?.hidden, popExists: !!pop, popHidden: pop?.hidden };
  console.log('[clip-debug]', JSON.stringify(debug));
  if (!ip || !pop || pop.hidden) return null;
  const r1 = ip.getBoundingClientRect();
  const r2 = pop.getBoundingClientRect();
  const x = Math.floor(Math.min(r1.x, r2.x) - 10);
  const y = Math.floor(Math.min(r1.y, r2.y) - 10);
  const right = Math.max(r1.right, r2.right) + 10;
  const bottom = Math.max(r1.bottom, r2.bottom) + 10;
  return { x, y, width: Math.ceil(right - x), height: Math.ceil(bottom - y) };
});
console.log('[box]', JSON.stringify(box));
const shot = path.join(OUT, `cp-${ts}-popover.png`);
if (box) await page.screenshot({ path: shot, clip: box });
else await page.screenshot({ path: shot });
console.log('[shot]', shot);

await browser.close();
console.log('[done]');
