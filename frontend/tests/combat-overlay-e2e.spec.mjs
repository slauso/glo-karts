/**
 * combat-overlay-e2e.spec.mjs — End-to-end smoke for the Phase 1 combat overlay
 * pipeline. Builds an in-memory track containing a `straight` piece with an
 * `item_box` overlay on top, encodes it with the studio's encoder, navigates
 * `play.html?track=<code>`, then teleports the chassis to the pickup centre
 * and asserts that:
 *   1. The combat state map contains the pickup.
 *   2. After ticking past the trigger, `playerCombat.weapon` becomes non-null.
 *   3. The HUD #combatTicker contains a confirmation string.
 *
 * Run:  npx playwright test tests/combat-overlay-e2e.spec.mjs
 *       (Vite dev server must be running on http://127.0.0.1:5174)
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

async function buildTrackCode(page) {
  // Reuse the live ESM modules served by Vite — no bundling required.
  return await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    t.place('straight', 0, 0, 0);
    t.place('straight', 0, 1, 0);
    t.place('item_box', 0, 0, 0);
    return td.encodeTrack(t);
  }, BASE);
}

test.describe('Combat overlays — Phase 1', () => {
  // The mirror chassis on main can't be teleported into a pickup because
  // the authoritative body lives in the physics worker; mirror writes
  // are overwritten on the next snapshot. The grant-path itself is
  // exercised authoritatively by `tests/combat-phase-abce.spec.mjs`
  // (window.__play.grantWeapon → useActiveItem). Keeping this test as a
  // documented skip until we expose a worker-side teleport hook.
  test.skip('item_box pickup grants a weapon when driven over', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
    // 1. Build the track via the same encoder the editor uses.
    const seed = await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
    expect(seed?.ok()).toBeTruthy();
    const code = await buildTrackCode(page);
    expect(code.length).toBeGreaterThan(0);

    // 2. Open playtest with that track.
    await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });

    // 3. Wait for the playtest globals.
    try {
      await page.waitForFunction(() => window.__play && window.__play.chassisBody && window.__play.combatState, { timeout: 20000 });
    } catch (e) {
      throw new Error(`waitForFunction failed. Page errors:\n${errors.join('\n')}`);
    }

    // 4. Confirm the pickup is in the combat state.
    const meta = await page.evaluate(() => {
      const list = [];
      window.__play.combatState.forEach((e) => list.push({ id: e.id, key: e.key, kind: e.kind, x: e.worldX, z: e.worldZ }));
      return list;
    });
    const box = meta.find(m => m.key === 'item_box');
    expect(box, `combat state should include item_box (got ${JSON.stringify(meta)})`).toBeTruthy();

    // 5. Teleport the chassis onto the pickup centre and zero velocity. The
    //    next render tick will run sweepKart and grant the pickup.
    await page.evaluate(({ x, z }) => {
      const cb = window.__play.chassisBody;
      // ChassisBodyMirror exposes Vec3Mirror.set(arr) — pass arrays.
      cb.position.set([x, cb.position.y, z]);
      cb.interpolatedPosition.set([x, cb.position.y, z]);
      cb.velocity.set([0, 0, 0]);
    }, { x: box.x, z: box.z });

    // 6. Wait for the combat tick to register the pickup.
    await page.waitForFunction(() => window.__play.playerCombat.weapon !== null, { timeout: 5000 });

    // Allow at least one render frame for renderTicker to flush.
    await page.waitForFunction(() => {
      const el = document.getElementById('combatTicker');
      return el && el.textContent && /got/i.test(el.textContent);
    }, { timeout: 3000 });
    const ticker = await page.locator('#combatTicker').textContent();
    expect(ticker || '').toMatch(/got/i);
  });
});
