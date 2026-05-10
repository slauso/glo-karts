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
    // Kart picker is now exposed via the right-aside Kart sub-menu (the
    // legacy header <select id="kartSelect"> is kept hidden as a compat
    // shim). The Kart tab button must be visible.
    await expect(page.locator('#tabKart')).toBeVisible();
    await expect(page.locator('#playBtn')).toBeVisible();

    const pieceCount = await page.evaluate(() => window.__studio.track.placements.size);
    expect(pieceCount).toBeGreaterThanOrEqual(2);
  });

  test('2 — kart selector is populated with the STK roster', async ({ page }) => {
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    // Open the Kart sub-menu in the right-aside.
    await page.click('#tabKart');
    await expect(page.locator('#kartPanel')).toBeVisible();

    const cardCount = await page.locator('#kartGrid .kart-card').count();
    expect(cardCount).toBeGreaterThanOrEqual(10);

    // Change selection by clicking a card; verify persistence + active state.
    await page.click('#kartGrid .kart-card[data-kart-id="gnu"]');
    const stored = await page.evaluate(() => localStorage.getItem('studioSelectedKart'));
    expect(stored).toBe('gnu');
    await expect(page.locator('#kartGrid .kart-card[data-kart-id="gnu"]')).toHaveClass(/active/);
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

  test('7 — lobby kart selection carries over to the editor', async ({ page }) => {
    // Mimic what the lobby writes when the player picks a kart
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      sessionStorage.setItem('selectedKart', 'konqi');
      sessionStorage.setItem('studioSelectedKart', 'konqi');
    });
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);

    const selected = await page.locator('#kartSelect').inputValue();
    expect(selected).toBe('konqi');
  });

  test('8 — lap counter increments after two finish-line crossings', async ({ page }) => {
    // Build a minimal track with a spawn and a finish two cells apart, then drive through.
    await page.goto(`${BASE}/editor.html`, { waitUntil: 'networkidle' });
    await waitForEditor(page);
    await page.evaluate(() => {
      const t = window.__studio.track;
      t.clear();
      t.place('spawn', 0, 0, 0);
      t.place('straight', 0, 1, 0);
      t.place('finish', 0, 2, 0);
      window.__studio.rebuildAll();
    });
    await page.click('#playBtn');
    await page.waitForURL(/play\.html/);
    await waitForPlaytest(page);

    // Resolve TILE from the runtime so tests are scale-agnostic.
    const TILE = await page.evaluate(async () => {
      const m = await import('/src/editor3/track-data.js');
      return m.TILE ?? 12;
    });
    const finishZ = 2 * TILE; // finish placed at gz=2

    // Cross #1: behind the line then past (offsets scale with TILE)
    const back = TILE * 0.4, fwd = TILE * 0.4, yAbove = TILE * 0.12;
    await page.evaluate(({ z, back, yAbove }) => {
      const p = window.__play;
      p.chassisBody.position.set(0, yAbove, z - back);
      p.chassisBody.velocity.set(0, 0, 0);
    }, { z: finishZ, back, yAbove });
    await page.waitForTimeout(200);
    await page.evaluate(({ z, fwd, yAbove }) => {
      window.__play.chassisBody.position.set(0, yAbove, z + fwd);
    }, { z: finishZ, fwd, yAbove });
    await page.waitForTimeout(300);
    // Clear the radius
    await page.evaluate(({ far, yAbove }) => {
      window.__play.chassisBody.position.set(far, yAbove, far);
    }, { far: TILE * 40, yAbove });
    await page.waitForTimeout(300);
    // Cross #2
    await page.evaluate(({ z, back, yAbove }) => {
      window.__play.chassisBody.position.set(0, yAbove, z - back);
    }, { z: finishZ, back, yAbove });
    await page.waitForTimeout(300);
    await page.evaluate(({ z, fwd, yAbove }) => {
      window.__play.chassisBody.position.set(0, yAbove, z + fwd);
    }, { z: finishZ, fwd, yAbove });
    await page.waitForTimeout(2500); // > 2s debounce

    const lapText = await page.locator('#lap').textContent();
    expect(lapText).toMatch(/^1/);
  });
});
