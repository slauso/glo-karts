/**
 * GLO KARTS — Debug Arena Core Multiplayer Test
 *
 * Uses the exact diag-match.spec.js join pattern (which consistently passes)
 * with up to 3 retries for the flaky WS 1006 drop, plus gameplay assertions.
 */
import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  readDebug,
  isCriticalError,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

test.setTimeout(300_000);

test('debug arena: full multiplayer validation', async ({ browser }) => {
  let page1, page2, ctx1, ctx2;
  const errors1 = [], errors2 = [];
  let matchLive = false;

  // ── Retry join up to 3 times (WS 1006 flake on Windows) ─────────────
  for (let attempt = 1; attempt <= 3 && !matchLive; attempt++) {
    const lobbyCode = `arena-${Date.now()}-${attempt}`;
    const config = { ...BATTLE_CONFIG, lobbyCode };

    // Fresh contexts each attempt
    await Promise.allSettled([
      ctx1?.close?.(),
      ctx2?.close?.(),
    ]);
    errors1.length = 0;
    errors2.length = 0;

    ctx1 = await browser.newContext();
    ctx2 = await browser.newContext();
    page1 = await ctx1.newPage();
    page2 = await ctx2.newPage();

    // Attach listeners — mirror diag-match exactly
    const logs2 = [];
    page1.on('pageerror', (e) => errors1.push(e.message));
    page2.on('pageerror', (e) => errors2.push(e.message));
    page2.on('console', m => logs2.push(`[P2 ${m.type()}] ${m.text()}`));
    page2.on('crash', () => logs2.push('[P2 CRASH]'));
    page2.on('close', () => logs2.push('[P2 CLOSE]'));

    console.log(`[attempt ${attempt}] lobby=${lobbyCode}`);

    try {
      // ── Join (exact diag-match structure) ──────────────────────────
      await injectGameConfig(page1, { ...config, playerName: `Arena-P1` });
      await page1.goto('/realtime.html');
      await page1.waitForTimeout(3000);
      await injectGameConfig(page2, { ...config, playerName: `Arena-P2` });
      await page2.goto('/realtime.html');

      await Promise.all([
        waitForDebug(page1, d => d.roomJoined, 25_000),
        waitForDebug(page2, d => d.roomJoined, 25_000),
      ]);

      // ── Poll for matchLive (same cadence as diag) ──────────────────
      for (let i = 0; i < 15; i++) {
        await page1.waitForTimeout(2000);
        const d1 = await readDebug(page1);
        const d2 = await readDebug(page2);
        console.log(`[attempt ${attempt} t=${(i+1)*2}s] P1:mL=${d1?.matchLive} pc=${d1?.playerCount} P2:mL=${d2?.matchLive} pc=${d2?.playerCount}`);
        if (d1?.matchLive && d2?.matchLive) { matchLive = true; break; }
        // Detect P2 WS drop early (playerCount drops to 0)
        if (d2?.playerCount === 0 || d2 === null) {
          console.log(`[attempt ${attempt}] P2 WS dropped — retrying`);
          break;
        }
      }
    } catch (e) {
      console.log(`[attempt ${attempt}] error: ${e.message}`);
    }

    if (!matchLive && attempt < 3) {
      console.log(`[attempt ${attempt}] waiting 5s before retry...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  expect(matchLive, 'matchLive should fire on both players').toBe(true);

  // ── All gameplay assertions below (matchLive confirmed) ──────────────
  try {
    // Phase 1: Join verification + Physics diagnostics
    const d1 = await readDebug(page1);
    const d2 = await readDebug(page2);
    expect(d1.playerCount).toBeGreaterThanOrEqual(2);
    expect(d2.playerCount).toBeGreaterThanOrEqual(2);
    expect(d1.sessionId).not.toEqual(d2.sessionId);

    // Runtime physics diagnostics
    const diag = await page1.evaluate(() => {
      const c = window.__gloClient;
      const r = { boundsHalf: c?._arenaBoundsHalf, walls: [], kartMotion: null, kartShape: null };
      if (c?.localKartAggregate?.body) {
        r.kartMotion = c.localKartAggregate.body.getMotionType();
        if (c.localKartAggregate.shape) {
          r.kartShape = {
            membership: c.localKartAggregate.shape.filterMembershipMask,
            collide: c.localKartAggregate.shape.filterCollideMask
          };
        }
      }
      if (c?.scene) {
        c.scene.meshes.forEach(m => {
          if (m.name?.startsWith('dbg-wall')) {
            const info = { name: m.name, pos: { x: m.position.x, y: m.position.y, z: m.position.z } };
            const pb = m.physicsBody;
            if (pb) {
              info.motion = pb.getMotionType();
              if (pb.shape) {
                info.membership = pb.shape.filterMembershipMask;
                info.collide = pb.shape.filterCollideMask;
              }
            } else {
              info.noPhysics = true;
            }
            r.walls.push(info);
          }
        });
      }
      return r;
    });
    console.log(`[diag] boundsHalf=${diag.boundsHalf} kartMotion=${diag.kartMotion}`);
    console.log(`[diag] kartShape=${JSON.stringify(diag.kartShape)}`);
    console.log(`[diag] walls=${JSON.stringify(diag.walls)}`);
    expect(diag.boundsHalf, 'boundsHalf should be set').toBe(50);

    // Phase 2: Kart grounding
    await page1.waitForTimeout(2000);
    const pos1 = await page1.evaluate(() => {
      const m = window.__gloClient?.localMesh;
      return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
    });
    const pos2 = await page2.evaluate(() => {
      const m = window.__gloClient?.localMesh;
      return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
    });
    console.log(`[arena] P1 y=${pos1?.y?.toFixed(2)} P2 y=${pos2?.y?.toFixed(2)}`);
    expect(pos1, 'P1 kart').toBeTruthy();
    expect(pos2, 'P2 kart').toBeTruthy();
    // Karts should be grounded near floor (y=0), not floating at 5+
    expect(pos1.y).toBeGreaterThan(-2);
    expect(pos1.y).toBeLessThan(3);
    expect(pos2.y).toBeGreaterThan(-2);
    expect(pos2.y).toBeLessThan(3);

    // Phase 3: Y stability
    const ySamples = [];
    for (let i = 0; i < 6; i++) {
      const y = await page1.evaluate(() => window.__gloClient?.localMesh?.position?.y ?? null);
      if (y !== null) ySamples.push(y);
      await page1.waitForTimeout(500);
    }
    if (ySamples.length >= 2) {
      const yRange = Math.max(...ySamples) - Math.min(...ySamples);
      console.log(`[arena] Y range=${yRange.toFixed(2)}`);
      expect(yRange).toBeLessThan(5);
    }

    // Phase 4: Remote kart visible
    const seesRemote = await page1.evaluate(() => {
      const c = window.__gloClient;
      if (!c) return false;
      if (c.remoteMeshes && c.remoteMeshes.size > 0) return true;
      if (c._remoteKartEntities && c._remoteKartEntities.size > 0) return true;
      return c.scene?.meshes?.some(m => m.name?.includes('remote')) || false;
    });
    expect(seesRemote, 'P1 sees remote').toBe(true);

    // Phase 5: Driving displacement + live bounds monitoring
    const posBefore = await page1.evaluate(() => {
      const m = window.__gloClient?.localMesh;
      return m ? { x: m.position.x, z: m.position.z } : null;
    });
    // Sample position every 500ms while driving to see if clamp is working
    await page1.keyboard.down('KeyW');
    const driveSamples = [];
    for (let i = 0; i < 6; i++) {
      await page1.waitForTimeout(500);
      const s = await page1.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        const c = window.__gloClient;
        return m ? { x: m.position.x, z: m.position.z, bh: c?._arenaBoundsHalf } : null;
      });
      driveSamples.push(s);
    }
    await page1.keyboard.up('KeyW');
    await page1.waitForTimeout(500);
    const posAfter = await page1.evaluate(() => {
      const m = window.__gloClient?.localMesh;
      return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
    });
    console.log(`[arena] Drive samples: ${JSON.stringify(driveSamples.map(s => s ? `(${s.x.toFixed(1)},${s.z.toFixed(1)} bh=${s.bh})` : 'null'))}`);
    if (posBefore && posAfter) {
      const dist = Math.sqrt((posAfter.x - posBefore.x) ** 2 + (posAfter.z - posBefore.z) ** 2);
      console.log(`[arena] Drive dist=${dist.toFixed(2)} after=(${posAfter.x.toFixed(1)},${posAfter.z.toFixed(1)})`);
      expect(dist, 'kart moved').toBeGreaterThan(0.3);
    }

    // Phase 6: Position sync — verify P2 sees P1 in server state
    const readP1FromP2 = () => page2.evaluate(() => {
      const c = window.__gloClient;
      if (!c?.authoritativeState?.players) return null;
      for (const [sid, p] of c.authoritativeState.players.entries()) {
        if (sid !== c.room?.sessionId) return { x: p.x, z: p.z };
      }
      return null;
    });
    const p1OnP2 = await readP1FromP2();
    console.log(`[arena] P1 on P2: ${JSON.stringify(p1OnP2)}`);
    expect(p1OnP2, 'P2 sees P1 in server state').toBeTruthy();
    expect(Number.isFinite(p1OnP2.x), 'P1 x finite on P2').toBe(true);
    expect(Number.isFinite(p1OnP2.z), 'P1 z finite on P2').toBe(true);

    // Phase 7: Wall collision — verify kart stays within arena bounds
    // The kart was already driven to the boundary in Phase 5, so check its position
    const wallPos = await page1.evaluate(() => {
      const m = window.__gloClient?.localMesh;
      return m ? { x: m.position.x, z: m.position.z } : null;
    });
    if (wallPos) {
      console.log(`[arena] Wall test pos x=${wallPos.x.toFixed(2)} z=${wallPos.z.toFixed(2)}`);
      expect(Math.abs(wallPos.x), 'within arena X').toBeLessThan(55);
      expect(Math.abs(wallPos.z), 'within arena Z').toBeLessThan(55);
    }

    // Phase 7b: Item box grounding — boxes should be near floor, not floating
    const itemBoxY = await page1.evaluate(() => {
      const c = window.__gloClient;
      if (!c?.entityMeshes) return null;
      const results = [];
      c.entityMeshes.forEach((mesh, id) => {
        if (id.startsWith('box_') && mesh.isEnabled()) {
          results.push({ id, y: mesh.position.y });
        }
      });
      return results;
    });
    if (itemBoxY && itemBoxY.length > 0) {
      console.log(`[arena] Item boxes: ${JSON.stringify(itemBoxY.map(b => `${b.id}:y=${b.y.toFixed(2)}`))}`);
      for (const box of itemBoxY) {
        expect(box.y, `${box.id} grounded`).toBeLessThan(3);
        expect(box.y, `${box.id} above floor`).toBeGreaterThan(-1);
      }
    }

    // Phase 8: Finite positions
    for (const [label, page] of [['P1', page1], ['P2', page2]]) {
      const pos = await page.evaluate(() => {
        const m = window.__gloClient?.localMesh;
        return m ? { x: m.position.x, y: m.position.y, z: m.position.z } : null;
      });
      if (pos) {
        expect(Number.isFinite(pos.x), `${label} x finite`).toBe(true);
        expect(Number.isFinite(pos.y), `${label} y finite`).toBe(true);
        expect(Number.isFinite(pos.z), `${label} z finite`).toBe(true);
        expect(pos.y, `${label} above kill-plane`).toBeGreaterThan(-70);
      }
    }

    // Phase 9: No critical errors
    const crit1 = errors1.filter(isCriticalError);
    const crit2 = errors2.filter(isCriticalError);
    expect(crit1, 'P1 no crit errors').toHaveLength(0);
    expect(crit2, 'P2 no crit errors').toHaveLength(0);

  } finally {
    await Promise.allSettled([
      ctx1?.close?.(),
      ctx2?.close?.(),
    ]);
  }
});
