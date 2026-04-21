/**
 * editor3-smoke.spec.mjs — End-to-end smoke tests for Track Studio (editor3).
 *
 * Run:  npx playwright test tests/editor3-smoke.spec.mjs --headed
 *       (dev server must be running on http://127.0.0.1:5173)
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';

async function waitForEditor(page) {
  await page.waitForFunction(() => {
    return window.__studio && window.__studio.track && window.__studio.renderer;
  }, { timeout: 15000 });
}

async function waitForPlaytest(page) {
  await page.waitForFunction(() => {
    return window.__play && window.__play.chassisBody;
  }, { timeout: 15000 });
}

test.describe('Track Studio (editor3) — Smoke', () => {
  test('1 — editor loads and seeds a default track', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    await expect(page).toHaveTitle(/Track Studio/);
    await expect(page.locator('#kartSelect')).toBeVisible();
    await expect(page.locator('#playBtn')).toBeVisible();

    const pieceCount = await page.evaluate(() => window.__studio.track.placements.size);
    expect(pieceCount).toBeGreaterThanOrEqual(2);
  });

  test('2 — kart selector is populated with the STK roster', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    const options = await page.locator('#kartSelect option').count();
    expect(options).toBeGreaterThanOrEqual(10);

    // Change selection, verify persistence.
    await page.selectOption('#kartSelect', 'gnu');
    const stored = await page.evaluate(() => localStorage.getItem('studioSelectedKart'));
    expect(stored).toBe('gnu');
  });

  test('3 — Playtest button launches play.html with the track encoded', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    await Promise.all([
      page.waitForURL(/\/play\.html\?track=/, { timeout: 10000 }),
      page.click('#playBtn'),
    ]);

    await waitForPlaytest(page);
    await expect(page).toHaveTitle(/Playtest/);
    const speedText = await page.locator('#speed').textContent();
    expect(speedText).not.toBeNull();
  });

  test('4 — pause overlay opens on Escape and can resume', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);
    await Promise.all([
      page.waitForURL(/\/play\.html/, { timeout: 10000 }),
      page.click('#playBtn'),
    ]);
    await waitForPlaytest(page);

    // Focus the body so key events hit the game.
    await page.locator('body').click();
    await page.keyboard.press('Escape');
    await expect(page.locator('#pauseOverlay')).toHaveClass(/open/);

    await page.click('#resumeBtn');
    await expect(page.locator('#pauseOverlay')).not.toHaveClass(/open/);
  });

  test('5 — playtest kart accelerates when W is pressed', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);
    await Promise.all([
      page.waitForURL(/\/play\.html/, { timeout: 10000 }),
      page.click('#playBtn'),
    ]);
    await waitForPlaytest(page);

    // Give physics a beat, then accelerate.
    await page.waitForTimeout(400);
    await page.locator('body').click();
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(1500);
    await page.keyboard.up('KeyW');

    const speed = await page.evaluate(() => {
      const b = window.__play.chassisBody;
      return Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z);
    });
    expect(speed).toBeGreaterThan(1);
  });

  test('6 — clearing the track and playtesting surfaces a validation toast', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    // Accept confirm() automatically
    page.on('dialog', (d) => d.accept());
    await page.click('#clearBtn');

    // Track is empty → Playtest should NOT navigate; toast should appear.
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    const toastText = await page.locator('#toast').textContent();
    expect(toastText.toLowerCase()).toMatch(/pieces|spawn|finish/);
    expect(page.url()).toContain('/editor.html');
  });
});
