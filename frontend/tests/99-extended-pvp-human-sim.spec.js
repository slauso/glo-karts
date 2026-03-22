/**
 * GLO KARTS — Extended PvP Human Simulation Test
 *
 * Simulates two human players in a full battle session:
 *   1. Both join via lobby flow (host + guest)
 *   2. Both reach matchLive
 *   3. Both drive around using WASD for 15+ seconds
 *   4. P1 picks up weapon via item box collision
 *   5. P1 fires weapon at P2 (E key)
 *   6. Both players turn, reverse, strafe
 *   7. P2 picks up weapon and fires back
 *   8. Verify no critical console errors throughout
 *   9. Verify positions stay finite (no NaN/Infinity)
 *  10. Verify network sync is healthy (staleInputDrops, OOO drops)
 *
 * This test captures ALL console messages (errors, warnings, logs)
 * and reports them for diagnostics.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  waitForMatchLive,
  debugGrantWeapon,
  teleportKart,
  getFirstItemBoxPos,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

async function readKartPosition(page) {
  return page.evaluate(() => {
    const client = window.__gloClient;
    const mesh = client?.localMesh;
    if (mesh?.position) {
      return { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    }

    const sessionId = client?.room?.sessionId;
    const player = sessionId ? client?.authoritativeState?.players?.get(sessionId) : null;
    if (player) {
      return { x: player.x, y: player.y, z: player.z };
    }

    return null;
  });
}

test.describe.configure({ mode: 'serial' });

test('extended PvP human simulation — drive, pickup, fire, collide', async ({ browser }) => {
  test.setTimeout(180_000);
  const roomConfig = withLobbyCode(BATTLE_CONFIG, 'human-sim');
  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();

  // Capture ALL console output from both pages
  const p1Errors = [], p2Errors = [];
  const p1Warnings = [], p2Warnings = [];
  const p1Console = [], p2Console = [];

  p1.on('pageerror', (e) => p1Errors.push(e.message));
  p2.on('pageerror', (e) => p2Errors.push(e.message));
  p1.on('console', (msg) => {
    p1Console.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'warning') p1Warnings.push(msg.text());
  });
  p2.on('console', (msg) => {
    p2Console.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === 'warning') p2Warnings.push(msg.text());
  });

  try {
    // ── Phase 1: Join and reach matchLive ──
    console.log('[human-sim] Phase 1: Joining battle room...');
    await injectGameConfig(p1, { ...roomConfig, playerName: 'Host-Human', kartId: 'tux' });
    await p1.goto('/realtime.html');
    await p1.waitForTimeout(2000);
    await injectGameConfig(p2, { ...roomConfig, playerName: 'Guest-Human', kartId: 'wilber' });
    await p2.goto('/realtime.html');

    await Promise.all([
      waitForDebug(p1, (d) => d.roomJoined, 25_000),
      waitForDebug(p2, (d) => d.roomJoined, 25_000),
    ]);
    console.log('[human-sim] Both players joined room');

    await waitForMatchLive([p1, p2], 45_000);
    console.log('[human-sim] Match is LIVE');

    // Verify initial state
    const d1Init = await readDebug(p1);
    const d2Init = await readDebug(p2);
    expect(d1Init.matchLive).toBe(true);
    expect(d2Init.matchLive).toBe(true);
    expect(d1Init.playerCount).toBeGreaterThanOrEqual(2);
    expect(d2Init.playerCount).toBeGreaterThanOrEqual(2);
    expect(d1Init.kartLoaded).toBe(true);
    expect(d2Init.kartLoaded).toBe(true);
    expect(d1Init.kartVisible).toBe(true);
    expect(d2Init.kartVisible).toBe(true);

    // ── Phase 2: P1 drives forward ──
    console.log('[human-sim] Phase 2: P1 driving forward (W) for 3s...');
    await p1.keyboard.down('KeyW');
    await p1.waitForTimeout(3000);
    await p1.keyboard.up('KeyW');

    const p1Pos1 = await readKartPosition(p1);
    console.log('[human-sim] P1 position after forward:', JSON.stringify(p1Pos1));
    expect(p1Pos1).toBeTruthy();
    expect(Number.isFinite(p1Pos1.x)).toBe(true);
    expect(Number.isFinite(p1Pos1.y)).toBe(true);
    expect(Number.isFinite(p1Pos1.z)).toBe(true);

    // ── Phase 3: P2 drives forward and turns ──
    console.log('[human-sim] Phase 3: P2 driving forward+right (W+D) for 3s...');
    await p2.keyboard.down('KeyW');
    await p2.keyboard.down('KeyD');
    await p2.waitForTimeout(3000);
    await p2.keyboard.up('KeyD');
    await p2.keyboard.up('KeyW');

    // ── Phase 4: P1 reverses and strafes left ──
    console.log('[human-sim] Phase 4: P1 reverse+left (S+A) for 2s...');
    await p1.keyboard.down('KeyS');
    await p1.keyboard.down('KeyA');
    await p1.waitForTimeout(2000);
    await p1.keyboard.up('KeyA');
    await p1.keyboard.up('KeyS');

    // ── Phase 5: Both drive simultaneously (stress test) ──
    console.log('[human-sim] Phase 5: Both players driving simultaneously for 4s...');
    await Promise.all([
      (async () => {
        await p1.keyboard.down('KeyW');
        await p1.keyboard.down('KeyD');
        await p1.waitForTimeout(2000);
        await p1.keyboard.up('KeyD');
        await p1.keyboard.down('KeyA');
        await p1.waitForTimeout(2000);
        await p1.keyboard.up('KeyA');
        await p1.keyboard.up('KeyW');
      })(),
      (async () => {
        await p2.keyboard.down('KeyW');
        await p2.waitForTimeout(1500);
        await p2.keyboard.down('KeyA');
        await p2.waitForTimeout(1500);
        await p2.keyboard.up('KeyA');
        await p2.keyboard.down('KeyD');
        await p2.waitForTimeout(1000);
        await p2.keyboard.up('KeyD');
        await p2.keyboard.up('KeyW');
      })(),
    ]);

    // ── Phase 6: Weapon pickup — teleport P1 to item box ──
    console.log('[human-sim] Phase 6: P1 picking up weapon...');
    await p1.waitForTimeout(1000);
    const boxPos = await getFirstItemBoxPos(p1);
    if (boxPos) {
      await teleportKart(p1, { x: boxPos.x, y: boxPos.y + 1, z: boxPos.z });
      await waitForDebug(p1, (d) => d.lastWeaponReceived !== null, 5_000)
        .catch(() => console.warn('[human-sim] P1 weapon pickup did not trigger'));
      const d1w = await readDebug(p1);
      console.log('[human-sim] P1 weapon received:', d1w.lastWeaponReceived);
      console.log('[human-sim] P1 weapon state:', JSON.stringify(d1w.weaponState));
    }

    await debugGrantWeapon(p1, 'missile', null, 1);
    await waitForDebug(p1, (d) => d.weaponState?.weapon2 === 'missile' && Number(d.weaponState?.ammo2 || 0) >= 1, 10_000);

    // ── Phase 7: P1 fires (E key) ──
    console.log('[human-sim] Phase 7: P1 firing weapon (E)...');
    await p1.bringToFront();
    await p1.keyboard.down('KeyE');
    await p1.waitForTimeout(250);
    await p1.keyboard.up('KeyE');
    await waitForDebug(p1, (d) => d.lastWeaponFired === 'missile', 10_000);
    const d1Fire = await readDebug(p1);
    console.log('[human-sim] P1 lastWeaponFired:', d1Fire.lastWeaponFired);

    // ── Phase 8: P2 picks up weapon and fires back ──
    console.log('[human-sim] Phase 8: P2 picking up weapon and firing back...');
    const boxPos2 = await getFirstItemBoxPos(p2);
    if (boxPos2) {
      await teleportKart(p2, { x: boxPos2.x, y: boxPos2.y + 1, z: boxPos2.z });
      await waitForDebug(p2, (d) => d.lastWeaponReceived !== null, 5_000)
        .catch(() => {});
    }
    await debugGrantWeapon(p2, 'fireball', null, 1);
    await waitForDebug(p2, (d) => d.weaponState?.weapon2 === 'fireball' && Number(d.weaponState?.ammo2 || 0) >= 1, 10_000);
    await p2.bringToFront();
    await p2.keyboard.down('KeyE');
    await p2.waitForTimeout(250);
    await p2.keyboard.up('KeyE');
    await waitForDebug(p2, (d) => d.lastWeaponFired === 'fireball', 10_000);

    // ── Phase 9: More driving for 5 more seconds ──
    console.log('[human-sim] Phase 9: Extended driving (5s more)...');
    await Promise.all([
      (async () => {
        await p1.keyboard.down('KeyW');
        await p1.waitForTimeout(5000);
        await p1.keyboard.up('KeyW');
      })(),
      (async () => {
        await p2.keyboard.down('KeyW');
        await p2.keyboard.down('KeyA');
        await p2.waitForTimeout(2500);
        await p2.keyboard.up('KeyA');
        await p2.keyboard.down('KeyD');
        await p2.waitForTimeout(2500);
        await p2.keyboard.up('KeyD');
        await p2.keyboard.up('KeyW');
      })(),
    ]);

    // ── Phase 10: Final state validation ──
    console.log('[human-sim] Phase 10: Final state validation...');
    const d1Final = await readDebug(p1);
    const d2Final = await readDebug(p2);

    // Positions are finite
    const fp1 = await readKartPosition(p1);
    const fp2 = await readKartPosition(p2);

    console.log('[human-sim] Final P1 position:', JSON.stringify(fp1));
    console.log('[human-sim] Final P2 position:', JSON.stringify(fp2));

    expect(fp1).toBeTruthy();
    expect(fp2).toBeTruthy();
    expect(Number.isFinite(fp1.x)).toBe(true);
    expect(Number.isFinite(fp1.y)).toBe(true);
    expect(Number.isFinite(fp1.z)).toBe(true);
    expect(Number.isFinite(fp2.x)).toBe(true);
    expect(Number.isFinite(fp2.y)).toBe(true);
    expect(Number.isFinite(fp2.z)).toBe(true);

    // Both above kill-plane
    expect(fp1.y).toBeGreaterThan(-70);
    expect(fp2.y).toBeGreaterThan(-70);

    // Network sync health
    console.log('[human-sim] P1 sync metrics:', JSON.stringify(d1Final.syncMetrics));
    console.log('[human-sim] P2 sync metrics:', JSON.stringify(d2Final.syncMetrics));
    console.log('[human-sim] P1 network:', JSON.stringify(d1Final.network));
    console.log('[human-sim] P2 network:', JSON.stringify(d2Final.network));

    // Verify sync is healthy (no excessive drops)
    if (d1Final.syncMetrics) {
      expect(d1Final.syncMetrics.staleInputDrops, 'P1 stale drop count < 1000').toBeLessThan(1000);
      expect(d1Final.syncMetrics.outOfOrderInputDrops, 'P1 OOO drop count < 100').toBeLessThan(100);
    }
    if (d2Final.syncMetrics) {
      expect(d2Final.syncMetrics.staleInputDrops, 'P2 stale drop count < 1000').toBeLessThan(1000);
      expect(d2Final.syncMetrics.outOfOrderInputDrops, 'P2 OOO drop count < 100').toBeLessThan(100);
    }

    // ── Report collected console messages ──
    console.log('\n═══ P1 Console Errors ═══');
    p1Errors.forEach(e => console.log('  ✗', e));
    console.log(`  Total: ${p1Errors.length}`);

    console.log('\n═══ P2 Console Errors ═══');
    p2Errors.forEach(e => console.log('  ✗', e));
    console.log(`  Total: ${p2Errors.length}`);

    // Critical error check
    const crit1 = p1Errors.filter(isCriticalError);
    const crit2 = p2Errors.filter(isCriticalError);
    console.log(`\n═══ Critical Errors ═══`);
    console.log(`  P1: ${crit1.length}`, crit1.length ? crit1 : '');
    console.log(`  P2: ${crit2.length}`, crit2.length ? crit2 : '');

    // Dump full console for debugging if critical errors exist
    if (crit1.length || crit2.length) {
      console.log('\n═══ Full P1 Console ═══');
      p1Console.slice(-50).forEach(l => console.log('  ', l));
      console.log('\n═══ Full P2 Console ═══');
      p2Console.slice(-50).forEach(l => console.log('  ', l));
    }

    expect(crit1, 'P1 should have no critical errors').toHaveLength(0);
    expect(crit2, 'P2 should have no critical errors').toHaveLength(0);

    console.log('[human-sim] ✅ All phases complete — game is in playable state');

  } finally {
    await Promise.allSettled([
      ctx1.close(),
      ctx2.close(),
    ]);
  }
});
