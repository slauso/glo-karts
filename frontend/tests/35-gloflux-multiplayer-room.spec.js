import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  isCriticalError,
} from './helpers/game-helpers.js';

function withPartyCode(label) {
  return `gf-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function buildConfig(partyCode, playerName) {
  return {
    gameMode: 'gloflux',
    multiplayer: true,
    roomName: 'gloflux',
    variant: 'arena',
    subMode: 'arena',
    maxPlayers: 2,
    selectedKart: 'tux',
    playerName,
    partyCode,
  };
}

async function waitForMultiplayerReady(page, timeout = 35_000) {
  await page.waitForFunction(
    () => {
      const orch = window.__gloflux?._orch;
      return !!(
        orch &&
        orch.network?.connected &&
        orch.network?.room &&
        orch.scene &&
        orch.hud?.canvas
      );
    },
    null,
    { timeout },
  );

  await page.waitForFunction(
    () => {
      const orch = window.__gloflux?._orch;
      return !!(orch && (orch.network?.room?.state?.started || orch.state === 'flux_active'));
    },
    null,
    { timeout },
  );
}

test.describe.configure({ mode: 'serial' });

test.describe('Glo Flux Multiplayer Room', () => {
  test('broadcasts chainActivated and advances patchVersion across two connected clients', async ({ browser }) => {
    const partyCode = withPartyCode('room');
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const errors1 = [];
    const errors2 = [];
    page1.on('pageerror', (err) => errors1.push(err.message));
    page2.on('pageerror', (err) => errors2.push(err.message));

    try {
      await injectGameConfig(page1, buildConfig(partyCode, 'GF Host'));
      await page1.goto('/gloflux.html');

      await page1.waitForTimeout(1500);

      await injectGameConfig(page2, buildConfig(partyCode, 'GF Guest'));
      await page2.goto('/gloflux.html');

      await Promise.all([
        waitForMultiplayerReady(page1),
        waitForMultiplayerReady(page2),
      ]);

      await Promise.all([
        page1.evaluate(() => {
          window.__gfRoomEvents = [];
          window.__gfRespawns = [];
          window.__gloflux._orch.network.on('chainActivated', (msg) => {
            window.__gfRoomEvents.push(msg);
          });
          window.__gloflux._orch.network.on('powerRespawn', (msg) => {
            window.__gfRespawns.push(msg);
          });
        }),
        page2.evaluate(() => {
          window.__gfRoomEvents = [];
          window.__gfRespawns = [];
          window.__gloflux._orch.network.on('chainActivated', (msg) => {
            window.__gfRoomEvents.push(msg);
          });
          window.__gloflux._orch.network.on('powerRespawn', (msg) => {
            window.__gfRespawns.push(msg);
          });
        }),
      ]);

      const setupSnapshot = await page1.evaluate(() => {
        const orch = window.__gloflux._orch;
        const spawns = orch.network.powerSpawns;
        const firstIdx = spawns[0]?.idx ?? 0;
        const secondIdx = spawns[1]?.idx ?? 1;
        orch.network.room.send('debugSetPowerSpawn', { idx: firstIdx, powerId: 'gravity_well' });
        orch.network.room.send('debugSetPowerSpawn', { idx: secondIdx, powerId: 'dimensional_rift' });
        return {
          sessionId: orch.network.sessionId,
          spawnIndices: [firstIdx, secondIdx],
        };
      });

      await Promise.all([
        page1.waitForFunction(
          ([firstIdx, secondIdx]) => {
            const respawns = window.__gfRespawns || [];
            const first = respawns.find((entry) => entry.idx === firstIdx && entry.powerId === 'gravity_well');
            const second = respawns.find((entry) => entry.idx === secondIdx && entry.powerId === 'dimensional_rift');
            return !!(first && second);
          },
          setupSnapshot.spawnIndices,
          { timeout: 10_000 },
        ),
        page2.waitForFunction(
          ([firstIdx, secondIdx]) => {
            const respawns = window.__gfRespawns || [];
            const first = respawns.find((entry) => entry.idx === firstIdx && entry.powerId === 'gravity_well');
            const second = respawns.find((entry) => entry.idx === secondIdx && entry.powerId === 'dimensional_rift');
            return !!(first && second);
          },
          setupSnapshot.spawnIndices,
          { timeout: 10_000 },
        ),
      ]);

      await page1.evaluate(([firstIdx, secondIdx]) => {
        const room = window.__gloflux._orch.network.room;
        room.send('debugCollectPower', { idx: firstIdx });
        room.send('debugCollectPower', { idx: secondIdx });
      }, setupSnapshot.spawnIndices);

      await Promise.all([
        page1.waitForFunction(
          (hostSessionId) => {
            const events = window.__gfRoomEvents || [];
            const telemetry = window.__gloflux?._orch?.network?.telemetry;
            return events.some((entry) => entry.sessionId === hostSessionId && entry.comboId === 'void_portal' && Number(entry.patchVersion || 0) >= 2)
              && Number(telemetry?.patchVersion || 0) >= 2;
          },
          setupSnapshot.sessionId,
          { timeout: 10_000 },
        ),
        page2.waitForFunction(
          (hostSessionId) => {
            const events = window.__gfRoomEvents || [];
            const telemetry = window.__gloflux?._orch?.network?.telemetry;
            return events.some((entry) => entry.sessionId === hostSessionId && entry.comboId === 'void_portal' && Number(entry.patchVersion || 0) >= 2)
              && Number(telemetry?.patchVersion || 0) >= 2;
          },
          setupSnapshot.sessionId,
          { timeout: 10_000 },
        ),
      ]);

      const [snapshot1, snapshot2] = await Promise.all([
        page1.evaluate(() => {
          const orch = window.__gloflux._orch;
          return {
            sessionId: orch.network.sessionId,
            telemetry: { ...orch.network.telemetry },
            events: (window.__gfRoomEvents || []).slice(),
          };
        }),
        page2.evaluate(() => {
          const orch = window.__gloflux._orch;
          return {
            sessionId: orch.network.sessionId,
            telemetry: { ...orch.network.telemetry },
            events: (window.__gfRoomEvents || []).slice(),
          };
        }),
      ]);

      expect(snapshot1.sessionId).toBeTruthy();
      expect(snapshot2.sessionId).toBeTruthy();
      expect(snapshot1.sessionId).not.toBe(snapshot2.sessionId);

      const hostEvent1 = snapshot1.events.find((entry) => entry.sessionId === snapshot1.sessionId && entry.comboId === 'void_portal');
      const hostEvent2 = snapshot2.events.find((entry) => entry.sessionId === snapshot1.sessionId && entry.comboId === 'void_portal');

      expect(hostEvent1).toMatchObject({
        sessionId: snapshot1.sessionId,
        comboId: 'void_portal',
        familyId: 'entropic_void',
      });
      expect(Number(hostEvent1.patchVersion || 0)).toBeGreaterThanOrEqual(2);
      expect(Number(hostEvent1.chainCount || 0)).toBeGreaterThanOrEqual(2);

      expect(hostEvent2).toMatchObject({
        sessionId: snapshot1.sessionId,
        comboId: 'void_portal',
        familyId: 'entropic_void',
      });
      expect(Number(hostEvent2.patchVersion || 0)).toBeGreaterThanOrEqual(2);

      expect(Number(snapshot1.telemetry.patchVersion || 0)).toBeGreaterThanOrEqual(2);
      expect(Number(snapshot2.telemetry.patchVersion || 0)).toBeGreaterThanOrEqual(2);
      expect(Number(snapshot1.telemetry.totalSurgeEvents || 0)).toBeGreaterThanOrEqual(2);
      expect(Number(snapshot2.telemetry.totalSurgeEvents || 0)).toBeGreaterThanOrEqual(2);

      expect(errors1.filter(isCriticalError)).toHaveLength(0);
      expect(errors2.filter(isCriticalError)).toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});