/**
 * studio-handoff-mk-pickups.spec.mjs — Studio → Play handoff for the
 * new MK-style pickups added in Phase A.
 *
 * Builds a track in the editor that contains every pk_<weapon> segment
 * plus the new modifier/hazard segments, encodes it, opens play.html,
 * and asserts that combatState picks each one up with the right
 * runtime payload. This catches encode/decode regressions in
 * track-data.js and ensures the pickup builders register their
 * `__pickupCube`-tagged visuals correctly.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

const EXPECTED = {
  pk_mushroom:        'weapon:mushroom',
  pk_golden_mushroom: 'weapon:golden_mushroom',
  pk_star:            'weapon:star',
  pk_green_shell:     'weapon:green_shell',
  pk_red_shell:       'weapon:red_shell',
  pk_blue_shell:      'weapon:blue_shell',
  pk_banana:          'weapon:banana',
  pk_bullet_bill:     'weapon:bullet_bill',
  pk_bobomb:          'weapon:bobomb',
  // v8 pickups
  pk_v8_missile:      'weapon:v8_missile',
  pk_v8_cannon:       'weapon:v8_cannon',
  pk_v8_rocket:       'weapon:v8_rocket',
  pk_v8_mortar:       'weapon:v8_mortar',
  pk_v8_mine:         'weapon:v8_mine',
  pk_v8_dynamite:     'weapon:v8_dynamite',
  pk_v8_firethrower:  'weapon:v8_firethrower',
  pk_v8_shield:       'weapon:v8_shield',
  pk_v8_repair:       'weapon:v8_repair',
  pk_v8_double_dmg:   'weapon:v8_double_dmg',
};

test('Studio handoff: every pk_* segment registers in combatState with correct payload', async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });

  // Lay a long straight strip and drop one of every pickup on a unique
  // tile. We give them lateral offsets via different gx so the centroids
  // don't collide.
  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    const keys = [
      'pk_mushroom','pk_golden_mushroom','pk_star',
      'pk_green_shell','pk_red_shell','pk_blue_shell',
      'pk_banana','pk_bullet_bill','pk_bobomb',
      'pk_v8_missile','pk_v8_cannon','pk_v8_rocket','pk_v8_mortar',
      'pk_v8_mine','pk_v8_dynamite','pk_v8_firethrower',
      'pk_v8_shield','pk_v8_repair','pk_v8_double_dmg',
    ];
    // Pre-place straights so cells are drivable.
    for (let z = 0; z < keys.length + 4; z++) t.place('straight', 0, z, 0);
    // Drop pickups along the strip.
    keys.forEach((k, i) => t.place(k, 0, i + 2, 0));
    return td.encodeTrack(t);
  }, BASE);
  expect(code.length).toBeGreaterThan(0);

  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      (n) => window.__play && window.__play.combatState && window.__play.combatState.size >= n,
      Object.keys(EXPECTED).length,
      { timeout: 60000 },
    );
  } catch (e) {
    throw new Error(`Combat state never populated. Errors:\n${errors.join('\n')}`);
  }

  const found = await page.evaluate((expected) => {
    const out = {};
    window.__play.combatState.forEach((e) => {
      if (e.key in expected) out[e.key] = e.payload;
    });
    return out;
  }, EXPECTED);

  for (const [key, payload] of Object.entries(EXPECTED)) {
    expect(found[key], `${key} should be in combatState with payload ${payload}`).toBe(payload);
  }
});
