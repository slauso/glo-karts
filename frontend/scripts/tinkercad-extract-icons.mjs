/**
 * tinkercad-extract-icons.mjs — pull the full inner SVG markup for each
 * toolbar button in the live Tinkercad tab. Writes a JSON map keyed by the
 * `title` attribute on the inner <svg role="img">.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'dev-snapshots');
const CDP_URL = 'http://127.0.0.1:9222';

async function findEditor(b) {
  for (const ctx of b.contexts()) for (const p of ctx.pages())
    if (/tinkercad\.com\/things\/[^/]+\/edit/.test(p.url())) return p;
  return null;
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = await findEditor(browser);
  if (!page) { console.error('no editor tab'); process.exit(1); }
  const data = await page.evaluate(() => {
    const out = { toolbar: [], topnavTabs: [], snapGrid: null, rightPanelHeader: null };
    // Toolbar buttons live in .editor__tab__subnav__tool (or similar). Look broadly.
    const toolbarBtns = Array.from(document.querySelectorAll('a, button, div[role="button"]'))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.y >= 40 && r.y <= 90 && r.width >= 28 && r.height >= 28;
      });
    for (const b of toolbarBtns) {
      const r = b.getBoundingClientRect();
      const svg = b.querySelector('svg');
      const titleEl = svg ? (svg.querySelector('title') || (svg.getAttribute('title') ? { textContent: svg.getAttribute('title') } : null)) : null;
      const title = titleEl?.textContent || svg?.getAttribute('title') || b.getAttribute('aria-label') || b.getAttribute('title') || '';
      out.toolbar.push({
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        title: title.trim(),
        svg: svg ? svg.outerHTML : null,
      });
    }
    // Top-nav tab buttons (header right side).
    const topTabs = Array.from(document.querySelectorAll('.editor__topnav__tabbutton__link, .editor__topnav__tabbutton'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const svg = el.querySelector('svg');
        return { x: Math.round(r.x), y: Math.round(r.y), inner: el.outerHTML.slice(0, 1000), svg: svg?.outerHTML || null };
      });
    out.topnavTabs = topTabs;
    // Snap-grid selector text.
    const snap = Array.from(document.querySelectorAll('*')).find((el) => /^\s*\d+(\.\d+)?\s*mm\s*$/i.test((el.innerText || '').trim()) && el.children.length === 0);
    if (snap) {
      const wrap = snap.closest('.editor__inspector__select__advanced, .selectbox, [class*="select"]') || snap.parentElement;
      out.snapGrid = wrap ? wrap.outerHTML.slice(0, 1500) : null;
    }
    // Right-panel header (selector + search).
    const rp = document.querySelector('.editor__sidebar, [class*="sidebar"]');
    if (rp) out.rightPanelHeader = rp.outerHTML.slice(0, 2000);
    return out;
  });

  await mkdir(OUT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = join(OUT_DIR, `tc-icons-${ts}.json`);
  await writeFile(out, JSON.stringify(data, null, 2));
  console.log('wrote', out, '— toolbar items:', data.toolbar.length);
  await browser.close().catch(() => {});
}
main().catch((e) => { console.error(e); process.exit(1); });
