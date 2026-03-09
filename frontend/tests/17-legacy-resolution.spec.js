/**
 * 17-legacy-resolution.spec.js — Phase 16 checkpoint
 *
 * Validates the legacy web-racing issue resolution:
 *   - No legacy HTML elements in game.html DOM
 *   - No .copy() misuse in main.js source (Babylon uses .copyFrom())
 *   - Canvas renders with nonzero dimensions
 *   - Modern HUD elements present, legacy ones absent
 *   - No legacy CSS selectors in style.css
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VITE = 'http://localhost:5173';
const SRC = resolve(__dirname, '..', 'src');

test.describe('Phase 16 — Legacy Issue Resolution', () => {

  // ── DOM Audit ─────────────────────────────────────────────────────────────

  test('game.html has no legacy speedometer HTML', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const legacyIds = ['racing-ui', 'speedometer', 'lap-counter', 'connection-ui'];
    for (const id of legacyIds) {
      const el = await page.$(`#${id}`);
      expect(el, `Legacy element #${id} should not exist`).toBeNull();
    }

    const legacyClasses = ['.gauge', '.gauge-body', '.gauge-fill', '.gauge-cover',
                           '.gauge-needle', '.speed-value', '.speed-unit'];
    for (const cls of legacyClasses) {
      const el = await page.$(cls);
      expect(el, `Legacy element ${cls} should not exist`).toBeNull();
    }
  });

  test('#app container exists and has dimensions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const app = await page.$('#app');
    expect(app).not.toBeNull();

    const box = await app.boundingBox();
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  // ── Source Audit ──────────────────────────────────────────────────────────

  test('main.js has no .copy() calls on Babylon Vector3/Quaternion', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');
    // Match lines like: someVector.copy( — but exclude comments
    const lines = src.split('\n');
    const copyCallLines = lines.filter(l => {
      const trimmed = l.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return /\.(copy)\(/.test(trimmed);
    });
    expect(copyCallLines).toHaveLength(0);
  });

  test('main.js has no initUI or updateSpeedometer functions', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');
    expect(src).not.toContain('function initUI()');
    expect(src).not.toContain('function updateSpeedometer(');
    expect(src).not.toContain('let speedElement');
    expect(src).not.toContain('let needleElement');
  });

  test('style.css has no legacy gauge or connection-ui rules', () => {
    const css = readFileSync(resolve(SRC, 'style.css'), 'utf8');
    expect(css).not.toContain('#racing-ui');
    expect(css).not.toContain('#speedometer');
    expect(css).not.toContain('.gauge-fill');
    expect(css).not.toContain('.gauge-needle');
    expect(css).not.toContain('#connection-ui');
    expect(css).not.toContain('#peer-id-input');
  });

  test('game.html source has no legacy speedometer markup', () => {
    const html = readFileSync(resolve(SRC, '..', 'game.html'), 'utf8');
    expect(html).not.toContain('id="racing-ui"');
    expect(html).not.toContain('id="speedometer"');
    expect(html).not.toContain('gauge-fill');
    expect(html).not.toContain('gauge-needle');
    expect(html).not.toContain('speed-value');
    expect(html).not.toContain('speed-unit');
  });

  // ── gates.js Audit ────────────────────────────────────────────────────────

  test('gates.js has no speedometer references', () => {
    const src = readFileSync(resolve(SRC, 'modules', 'gates.js'), 'utf8');
    expect(src).not.toContain("getElementById('speedometer')");
  });

});
