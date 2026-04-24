/**
 * tinkercad-explore.mjs — connect to the user-launched Chrome via CDP and
 * dump the live Tinkercad editor's DOM structure so we can mirror it.
 *
 * Output: frontend/dev-snapshots/tc-ui-<ts>.json with:
 *   - viewport size
 *   - header chrome (buttons, labels, icons)
 *   - toolbar (button order, titles, svg paths)
 *   - right panel (shape catalog, search, generators)
 *   - bottom HUDs (snap grid, ruler, edit grid)
 *   - hotkey hints (any title attribute with shortcut)
 *
 * Run:  node scripts/tinkercad-explore.mjs
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'dev-snapshots');
const CDP_URL = 'http://127.0.0.1:9222';

async function findTinkercadEditor(browser) {
  for (const ctx of browser.contexts()) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (/tinkercad\.com\/things\/[^/]+\/edit/.test(url)) return p;
    }
  }
  return null;
}

const PAGE_FN = () => {
  // Walk shadow DOM + iframes + every clickable-looking element.
  const collected = [];
  const seen = new WeakSet();

  function walk(root, depth = 0) {
    if (!root || seen.has(root)) return;
    seen.add(root);
    const nodes = root.querySelectorAll
      ? root.querySelectorAll('*')
      : [];
    for (const el of nodes) {
      // Push interesting ones.
      const tag = el.tagName?.toLowerCase();
      if (!tag) continue;
      const role = el.getAttribute?.('role');
      const isClickable =
        tag === 'button' || tag === 'a' || tag === 'input' || tag === 'select' || tag === 'label' ||
        role === 'button' || role === 'tab' || role === 'menuitem' ||
        el.getAttribute?.('data-testid') || el.getAttribute?.('aria-label') ||
        (el.onclick !== null && el.onclick !== undefined);
      if (isClickable) {
        const r = el.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) {
          const s = window.getComputedStyle(el);
          if (s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0) {
          collected.push({
              tag,
              id: el.id || null,
              cls: typeof el.className === 'string' ? el.className.slice(0, 80) : null,
              title: el.getAttribute('title') || null,
              ariaLabel: el.getAttribute('aria-label') || null,
              dataTestid: el.getAttribute('data-testid') || null,
              role: role || null,
              text: (el.innerText || el.value || '').toString().trim().slice(0, 60),
              // Capture inner HTML so SVG icons reveal their identity (path d=, etc.)
              inner: (el.innerHTML || '').replace(/\s+/g, ' ').trim().slice(0, 300),
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              depth,
            });
          }
        }
      }
      // Descend shadow root.
      if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
    }
    // Iframes.
    const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
    for (const f of iframes) {
      try { if (f.contentDocument) walk(f.contentDocument, depth + 1); } catch (e) { /* cross-origin */ }
    }
  }
  walk(document);

  // Also collect canvases (for size/position only).
  const canvases = Array.from(document.querySelectorAll('canvas')).map((c) => {
    const r = c.getBoundingClientRect();
    return { id: c.id || null, cls: c.className || null, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });

  // De-dup by rect+text.
  const dedup = new Map();
  for (const c of collected) {
    const k = `${c.rect.x},${c.rect.y},${c.rect.w},${c.rect.h}|${c.text}|${c.ariaLabel}|${c.title}`;
    if (!dedup.has(k)) dedup.set(k, c);
  }
  const items = Array.from(dedup.values());

  const W = window.innerWidth, H = window.innerHeight;
  const region = (r) => {
    if (r.y < 70) return 'header';
    if (r.y < 130) return 'toolbar';
    if (r.x < 80) return 'left-rail';
    if (r.x > W - 360) return 'right-panel';
    if (r.y > H - 80) return 'bottom-hud';
    if (r.x < 220 && r.y > H - 220) return 'bottom-left';
    if (r.x > W - 220 && r.y > H - 220) return 'bottom-right';
    return 'canvas-overlay';
  };
  const grouped = {};
  for (const it of items) {
    const reg = region(it.rect);
    (grouped[reg] = grouped[reg] || []).push(it);
  }
  for (const k of Object.keys(grouped)) {
    grouped[k].sort((a, b) => (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x));
  }
  return { url: location.href, viewport: { w: W, h: H }, title: document.title, canvases, total: items.length, grouped };
};

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const page = await findTinkercadEditor(browser);
  if (!page) {
    console.error('[explore] No Tinkercad /things/.../edit tab open. Open a 3D design and re-run.');
    process.exit(1);
  }
  await page.bringToFront();
  await page.waitForTimeout(500);
  const data = await page.evaluate(PAGE_FN);

  // Hover each header/toolbar button briefly to capture tooltip text.
  // Tinkercad uses a global tooltip element that renders on mouseenter.
  const targets = [...(data.grouped.header || []), ...(data.grouped.toolbar || [])]
    .filter((it) => it.rect.w >= 24 && it.rect.h >= 24)
    .slice(0, 60);
  console.log('[explore] hovering', targets.length, 'buttons for tooltip capture...');
  const tooltips = [];
  for (const it of targets) {
    const cx = it.rect.x + it.rect.w / 2;
    const cy = it.rect.y + it.rect.h / 2;
    try {
      await page.mouse.move(cx, cy);
      await page.waitForTimeout(450); // tooltip delay
      const tip = await page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll(
          '[role="tooltip"], .tooltip, .Tooltip, [class*="tooltip" i], [class*="Tooltip"], .ui-tooltip'
        ));
        for (const t of candidates) {
          const r = t.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (t.innerText || '').trim()) {
            return { text: t.innerText.trim().slice(0, 120), rect: { x: Math.round(r.x), y: Math.round(r.y) } };
          }
        }
        return null;
      });
      tooltips.push({ btn: { x: it.rect.x, y: it.rect.y, w: it.rect.w, h: it.rect.h }, tip });
    } catch (e) { /* skip */ }
  }
  // Reset cursor.
  await page.mouse.move(10, 10);

  data.tooltips = tooltips;
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `tc-ui-${ts}.json`);
  await writeFile(out, JSON.stringify(data, null, 2));
  console.log('[explore] wrote', out);
  console.log('[explore] regions:', Object.keys(data.grouped).map(k => `${k}=${data.grouped[k].length}`).join(', '));
  console.log('[explore] tooltips with text:', tooltips.filter(t => t.tip).length);
  await browser.close().catch(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
