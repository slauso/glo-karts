// Probe Tinkercad's selection gizmo + inspector by attaching to the live
// CDP-controlled tab. Tinkercad renders the manipulator on a WebGL canvas,
// so we cannot DOM-walk the handles. Instead we:
//  1. Snapshot the inspector popup's exact HTML + computed styles.
//  2. Take a high-res cropped screenshot of the selected shape area.
//  3. Sample colors from canvas pixels around the selection box to derive
//     handle/arrow colors.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = path.resolve('dev-snapshots');
await fs.mkdir(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const browser = await chromium.connectOverCDP(CDP);
const ctx = browser.contexts()[0];
const tcPage = ctx.pages().find(p => p.url().includes('tinkercad.com'));
if (!tcPage) { console.error('No Tinkercad tab'); process.exit(1); }
await tcPage.bringToFront();
await tcPage.waitForTimeout(400);

// 1. Full-window screenshot for handle-shape reference
const fullPath = path.join(OUT_DIR, `tc-gizmo-${ts}-full.png`);
await tcPage.screenshot({ path: fullPath, fullPage: false });
console.log('[probe] full =', fullPath);

// 2. Walk DOM for inspector popup ('shape edit' panel that shows when something is selected)
const inspectorDump = await tcPage.evaluate(() => {
  const out = { panels: [], swatches: [], headers: [] };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const cls = (el.className && typeof el.className === 'string') ? el.className : '';
    const id = el.id || '';
    // Inspector popup heuristic: a small floating panel on the right side
    // with a header containing the shape name (e.g. 'Cylinder', 'Box').
    if ((cls.includes('inspector') || cls.includes('shapeedit') || cls.includes('shape-edit') || cls.includes('toolPalette')) && r.width < 400 && r.width > 120) {
      out.panels.push({
        cls, id,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        html: el.outerHTML.slice(0, 4000),
      });
    }
    // Color swatch: small square with backgroundColor set
    const cs = getComputedStyle(el);
    if (r.width >= 12 && r.width <= 28 && r.height >= 12 && r.height <= 28 && cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'rgb(255, 255, 255)') {
      out.swatches.push({
        cls, id,
        bg: cs.backgroundColor,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      });
    }
    // Headers (Solid/Hole tabs etc.)
    const txt = (el.textContent || '').trim();
    if (txt && txt.length < 24 && /^(Solid|Hole|Cylinder|Box|Sphere|Sides|Bevel|Segments|Radius|Length|Width|Height)$/i.test(txt) && r.width < 200) {
      out.headers.push({ txt, cls, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
    }
  }
  // Dedupe swatches by bg
  const seen = new Set();
  out.swatches = out.swatches.filter(s => { if (seen.has(s.bg)) return false; seen.add(s.bg); return true; });
  return out;
});
const dumpPath = path.join(OUT_DIR, `tc-gizmo-${ts}.json`);
await fs.writeFile(dumpPath, JSON.stringify(inspectorDump, null, 2));
console.log('[probe] dump =', dumpPath, '| panels:', inspectorDump.panels.length, 'swatches:', inspectorDump.swatches.length, 'headers:', inspectorDump.headers.length);

// 3. Sample canvas pixels near the centre to find the shape's bounding box.
// We screenshot a region around centre and read pixel colors for handle hint.
const canvasInfo = await tcPage.evaluate(() => {
  const cv = document.querySelector('canvas');
  if (!cv) return null;
  const r = cv.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (canvasInfo) {
  const cx = canvasInfo.x + canvasInfo.w / 2;
  const cy = canvasInfo.y + canvasInfo.h / 2;
  const w = 600, h = 600;
  const cropPath = path.join(OUT_DIR, `tc-gizmo-${ts}-crop.png`);
  await tcPage.screenshot({
    path: cropPath,
    clip: { x: Math.max(0, cx - w/2), y: Math.max(0, cy - h/2), width: w, height: h },
  });
  console.log('[probe] crop =', cropPath);
}

await browser.close();
console.log('[probe] done');
