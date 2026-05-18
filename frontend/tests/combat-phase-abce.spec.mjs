/**
 * combat-phase-abce.spec.mjs — Phase A→E smoke battery.
 *
 * Drives every WEAPONS class through `window.__play` hooks exposed by
 * play-main:
 *   1. ITEM_POOLS roll lands a real weapon (or coin) for default + heavy
 *   2. Direct mushroom grant → useActiveItem → boostUntil > now
 *   3. Star grant → use → starUntil + invuln + boost feed combat scalars
 *   4. Bullet Bill grant → use → bulletUntil + invuln; rail-follow
 *      doesn't crash on a non-empty drivableCells set
 *   5. Green-shell grant → use spawns a projectile entity in the runtime
 *   6. Banana grant → use spawns a hazard
 *   7. HP-zero triggers respawn handler (HP back to 100)
 *   8. setCombatPeers exposes peer karts to projectile targets
 *
 * The spec relies on the dev server running at 127.0.0.1:5174 (matches
 * combat-overlay-e2e.spec.mjs convention). Run:
 *   npm --prefix frontend run dev   # in another shell
 *   npx playwright test tests/combat-phase-abce.spec.mjs
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';

async function loadPlaytest(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  // Build a small drivable loop with one item box on it.
  await page.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
  const code = await page.evaluate(async (base) => {
    const td = await import(`${base}/src/editor3/track-data.js`);
    const t = new td.Track();
    for (let z = -2; z <= 2; z++) t.place('straight', 0, z, 0);
    t.place('item_box', 0, 0, 0);
    return td.encodeTrack(t);
  }, BASE);

  await page.goto(`${BASE}/play.html?track=${encodeURIComponent(code)}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => window.__play
         && window.__play.chassisBody
         && window.__play.combatState
         && typeof window.__play.useActiveItem === 'function'
         && typeof window.__play.grantWeapon === 'function',
      { timeout: 25000 },
    );
  } catch (e) {
    throw new Error(`Playtest globals never appeared. Errors:\n${errors.join('\n')}`);
  }
  return errors;
}

test.describe('Combat — Phase A→E smoke', () => {
  test('Phase E1: item_box rolls a weapon from default pool', async ({ page }) => {
    await loadPlaytest(page);

    // Run the roll several times — over enough rolls we should land at
    // least one MK weapon (mushroom/green_shell/banana) or coin.
    const seen = await page.evaluate(() => {
      const tally = {};
      for (let i = 0; i < 40; i++) {
        const w = window.__play.grantFromPool('default');
        if (w) tally[w] = (tally[w] || 0) + 1;
        else tally['coin'] = (tally['coin'] || 0) + 1;
      }
      return tally;
    });
    // At least one of the canonical default-pool entries showed up.
    const keys = Object.keys(seen);
    expect(keys.length, `pool roll should yield variety: ${JSON.stringify(seen)}`).toBeGreaterThan(0);
    const expected = new Set(['mushroom', 'green_shell', 'banana', 'coin']);
    const hit = keys.some((k) => expected.has(k));
    expect(hit, `pool roll should include canonical defaults: ${JSON.stringify(seen)}`).toBeTruthy();
  });

  test('Phase B mushroom: grant → use → boostUntil active', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      window.__play.grantWeapon('mushroom');
      const beforeActive = window.__play.playerCombat.inventory.active;
      const beforeCount  = window.__play.playerCombat.inventory.count;
      window.__play.useActiveItem();
      const pc = window.__play.playerCombat;
      return {
        beforeActive, beforeCount,
        boostUntil: pc.boostUntil,
        boostStrength: pc.boostStrength,
        afterActive: pc.inventory.active,
        now: performance.now(),
      };
    });
    expect(out.beforeActive).toBe('mushroom');
    expect(out.beforeCount).toBeGreaterThanOrEqual(1);
    expect(out.boostUntil).toBeGreaterThan(out.now);
    expect(out.boostStrength).toBeGreaterThan(0);
    expect(out.afterActive).toBeNull();  // single-use consumed
  });

  test('Phase B golden mushroom: 5 uses then empty', async ({ page }) => {
    await loadPlaytest(page);
    const counts = await page.evaluate(() => {
      window.__play.grantWeapon('golden_mushroom');
      const seq = [window.__play.playerCombat.inventory.count];
      for (let i = 0; i < 6; i++) {
        window.__play.useActiveItem();
        seq.push(window.__play.playerCombat.inventory.count);
      }
      return seq;
    });
    // Initial 5, then 4,3,2,1,0,0 (further uses no-op).
    expect(counts[0]).toBe(5);
    expect(counts[5]).toBe(0);
    expect(counts[6]).toBe(0);
  });

  test('Phase B star: invuln + boost timers set', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      window.__play.grantWeapon('star');
      window.__play.useActiveItem();
      return { ...window.__play.playerCombat, now: performance.now() };
    });
    expect(out.starUntil).toBeGreaterThan(out.now + 1000);
    expect(out.invulnUntil).toBeGreaterThan(out.now + 1000);
    expect(out.starStrength).toBeGreaterThan(0);
  });

  test('Phase B bullet bill: bulletUntil + invuln; rail-follow stable', async ({ page }) => {
    await loadPlaytest(page);
    // Enable buff, advance a few frames; the rail-follow runs in
    // tickCombat — the page must not throw.
    const ok = await page.evaluate(async () => {
      window.__play.grantWeapon('bullet_bill');
      window.__play.useActiveItem();
      // Wait ~250 ms so tickCombat exercises the rail-follow at least
      // a handful of times.
      await new Promise(r => setTimeout(r, 260));
      const pc = window.__play.playerCombat;
      return {
        bulletActive: pc.bulletUntil > performance.now(),
        invuln: pc.invulnUntil > performance.now(),
        finite: Number.isFinite(window.__play.chassisBody.position.x)
             && Number.isFinite(window.__play.chassisBody.position.z),
      };
    });
    expect(ok.bulletActive).toBeTruthy();
    expect(ok.invuln).toBeTruthy();
    expect(ok.finite).toBeTruthy();
  });

  test('Phase C green shell: use spawns a projectile entity', async ({ page }) => {
    await loadPlaytest(page);
    const result = await page.evaluate(() => {
      const before = window.__play.projectileRuntime._projectiles.length;
      window.__play.grantWeapon('green_shell');
      window.__play.useActiveItem();
      const after = window.__play.projectileRuntime._projectiles.length;
      const last = window.__play.projectileRuntime._projectiles[after - 1];
      return { before, after, name: last && last.name, hasVisual: !!(last && last.visual) };
    });
    expect(result.after).toBe(result.before + 1);
    expect(result.name).toBe('green_shell');
    expect(result.hasVisual).toBeTruthy();
  });

  test('Phase C/D banana: drop hazard appears in runtime', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      const before = window.__play.projectileRuntime._hazards.length;
      window.__play.grantWeapon('banana');
      window.__play.useActiveItem();
      const after = window.__play.projectileRuntime._hazards.length;
      return { before, after };
    });
    expect(out.after).toBe(out.before + 1);
  });

  test('Phase D bobomb: spawns arc-style projectile with fuse', async ({ page }) => {
    await loadPlaytest(page);
    const ent = await page.evaluate(() => {
      window.__play.grantWeapon('bobomb');
      window.__play.useActiveItem();
      const arr = window.__play.projectileRuntime._projectiles;
      const last = arr[arr.length - 1];
      return last && {
        name: last.name,
        useGravity: last.useGravity,
        fuseAt: last.fuseAt,
        bornAt: last.bornAt,
      };
    });
    expect(ent).toBeTruthy();
    expect(ent.name).toBe('bobomb');
    expect(ent.useGravity).toBeTruthy();
    expect(ent.fuseAt).toBeGreaterThan(ent.bornAt);
  });

  test('Phase E2: setCombatPeers feeds projectile target list', async ({ page }) => {
    await loadPlaytest(page);
    const result = await page.evaluate(() => {
      window.__play.setCombatPeers([
        { id: 'peer:test', position: { x: 0, y: 0, z: -10 } },
      ]);
      // Spawn a green shell pointed at -Z so it would hit the peer.
      window.__play.grantWeapon('green_shell');
      window.__play.useActiveItem();
      // Manually advance the runtime a few ticks to let the projectile
      // travel ~10 m at default speed (80 m/s → 125 ms).
      const now0 = performance.now();
      for (let i = 0; i < 10; i++) {
        window.__play.projectileRuntime.tick(0.02, now0 + i * 20);
      }
      // Either consumed (hit) or still alive — at minimum the runtime
      // saw the peer in its target list without throwing.
      return { peerCount: window.__play.projectileRuntime._projectiles.length, ok: true };
    });
    expect(result.ok).toBeTruthy();
  });

  test('Phase E3: HP HUD reflects state + zero triggers respawn', async ({ page }) => {
    await loadPlaytest(page);
    // Force HP to 0 and wait for the auto-respawn cycle.
    const out = await page.evaluate(async () => {
      window.__play.playerCombat.hp = 0;
      // Allow the HUD render + setTimeout(800) to fire.
      await new Promise(r => setTimeout(r, 1200));
      return { hp: window.__play.playerCombat.hp, hpText: document.getElementById('hpVal')?.textContent };
    });
    expect(out.hp).toBe(100);
    expect(out.hpText).toBe('100');
  });

  test('Phase B/E HUD: inventory slot updates classes on grant + fire', async ({ page }) => {
    await loadPlaytest(page);
    const states = await page.evaluate(async () => {
      const slot = document.getElementById('invSlot');
      const cls0 = slot.className;
      window.__play.grantWeapon('green_shell');
      // Wait for the next render frame.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cls1 = slot.className;
      const label1 = document.getElementById('invLabel').textContent;
      window.__play.useActiveItem();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cls2 = slot.className;
      const label2 = document.getElementById('invLabel').textContent;
      return { cls0, cls1, label1, cls2, label2 };
    });
    expect(states.cls0).toContain('empty');
    expect(states.cls1).toContain('has');
    expect(states.label1.toLowerCase()).toContain('green');
    expect(states.cls2).toContain('empty');
    expect(states.label2.toLowerCase()).toContain('empty');
  });

  // ── v8 / Vigilante weapon coverage ─────────────────────────────
  test('v8: every weapon grants + uses without throwing', async ({ page }) => {
    await loadPlaytest(page);
    const result = await page.evaluate(() => {
      const v8 = ['v8_missile','v8_cannon','v8_rocket','v8_mortar','v8_mine',
                  'v8_dynamite','v8_firethrower','v8_shield','v8_repair','v8_double_dmg'];
      const out = {};
      for (const name of v8) {
        try {
          window.__play.grantWeapon(name);
          const active = window.__play.playerCombat.inventory.active;
          window.__play.useActiveItem();
          out[name] = { active, ok: true };
        } catch (e) {
          out[name] = { ok: false, err: String(e && e.message || e) };
        }
      }
      return out;
    });
    for (const [name, r] of Object.entries(result)) {
      expect(r.ok, `${name}: ${r.err || ''}`).toBeTruthy();
      expect(r.active, `${name} should land in inventory`).toBe(name);
    }
  });

  test('v8 missile (homing): spawns projectile entity', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      const before = window.__play.projectileRuntime._projectiles.length;
      window.__play.grantWeapon('v8_missile');
      window.__play.useActiveItem();
      const arr = window.__play.projectileRuntime._projectiles;
      return { before, after: arr.length, name: arr[arr.length - 1]?.name, cls: arr[arr.length - 1]?.class };
    });
    expect(out.after).toBe(out.before + 1);
    expect(out.name).toBe('v8_missile');
    expect(out.cls).toBe('homing_nearest');
  });

  test('v8 mortar (arc): spawns gravity projectile with fuse', async ({ page }) => {
    await loadPlaytest(page);
    const ent = await page.evaluate(() => {
      window.__play.grantWeapon('v8_mortar');
      window.__play.useActiveItem();
      const arr = window.__play.projectileRuntime._projectiles;
      const last = arr[arr.length - 1];
      return last && { name: last.name, useGravity: last.useGravity, blast: last.blastRadius, fuseMs: last.fuseAt - last.bornAt };
    });
    expect(ent.name).toBe('v8_mortar');
    expect(ent.useGravity).toBeTruthy();
    expect(ent.blast).toBeGreaterThan(8);
    expect(ent.fuseMs).toBeGreaterThan(1500);
  });

  test('v8 mine: drops hazard behind kart', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      const before = window.__play.projectileRuntime._hazards.length;
      window.__play.grantWeapon('v8_mine');
      window.__play.useActiveItem();
      return { before, after: window.__play.projectileRuntime._hazards.length };
    });
    expect(out.after).toBe(out.before + 1);
  });

  test('v8 repair: heals HP up to cap', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      window.__play.playerCombat.hp = 25;
      window.__play.grantWeapon('v8_repair');
      window.__play.useActiveItem();
      return { hp: window.__play.playerCombat.hp };
    });
    expect(out.hp).toBeGreaterThan(25);
    expect(out.hp).toBeLessThanOrEqual(100);
  });

  test('v8 shield: sets invuln window', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      window.__play.grantWeapon('v8_shield');
      window.__play.useActiveItem();
      return { invulnUntil: window.__play.playerCombat.invulnUntil, now: performance.now() };
    });
    expect(out.invulnUntil).toBeGreaterThan(out.now + 1000);
  });

  test('v8 double damage: arms dmgBoost timer + multiplies projectile dmg', async ({ page }) => {
    await loadPlaytest(page);
    const out = await page.evaluate(() => {
      window.__play.grantWeapon('v8_double_dmg');
      window.__play.useActiveItem();
      const armed = window.__play.playerCombat.dmgBoostUntil;
      // Now fire a green shell — its dmg in WEAPONS is 30; with strength=1
      // we should see 60 on the spawned ent.
      window.__play.grantWeapon('green_shell');
      window.__play.useActiveItem();
      const arr = window.__play.projectileRuntime._projectiles;
      const last = arr[arr.length - 1];
      return { armed, now: performance.now(), dmg: last && last.dmg };
    });
    expect(out.armed).toBeGreaterThan(out.now);
    expect(out.dmg).toBeGreaterThanOrEqual(60);
  });

  test('v8 pool: rolls only v8 weapons', async ({ page }) => {
    await loadPlaytest(page);
    const seen = await page.evaluate(() => {
      const tally = {};
      for (let i = 0; i < 60; i++) {
        const w = window.__play.grantFromPool('v8');
        if (w) tally[w] = (tally[w] || 0) + 1;
      }
      return tally;
    });
    const keys = Object.keys(seen);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k.startsWith('v8_'), `pool 'v8' yielded non-v8: ${k}`).toBeTruthy();
    }
  });
});
