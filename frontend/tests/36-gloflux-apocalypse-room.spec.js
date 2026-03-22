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

test.describe('Glo Flux Apocalypse Room', () => {
  test('propagates chainActivated to patchVersion to apocalypseTriggered across the room', async ({ browser }) => {
    const partyCode = withPartyCode('apoc');
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    const errors1 = [];
    const errors2 = [];
    page1.on('pageerror', (err) => errors1.push(err.message));
    page2.on('pageerror', (err) => errors2.push(err.message));

    try {
      await injectGameConfig(page1, buildConfig(partyCode, 'GF Apocalypse Host'));
      await page1.goto('/gloflux.html');

      await page1.waitForTimeout(1500);

      await injectGameConfig(page2, buildConfig(partyCode, 'GF Apocalypse Guest'));
      await page2.goto('/gloflux.html');

      await Promise.all([
        waitForMultiplayerReady(page1),
        waitForMultiplayerReady(page2),
      ]);

      await Promise.all([
        page1.evaluate(() => {
          window.__gfRoomEvents = [];
          window.__gfRespawns = [];
          window.__gfApocalypseEvents = [];
          window.__gfRoomSnapshots = [];
          window.__gloflux._orch.network.on('chainActivated', (msg) => {
            window.__gfRoomEvents.push(msg);
          });
          window.__gloflux._orch.network.on('powerRespawn', (msg) => {
            window.__gfRespawns.push(msg);
          });
          window.__gloflux._orch.network.on('apocalypseTriggered', (msg) => {
            window.__gfApocalypseEvents.push(msg);
          });
          window.__gloflux._orch.network.room.onMessage('debugRoomSnapshot', (msg) => {
            window.__gfRoomSnapshots.push(msg);
          });
        }),
        page2.evaluate(() => {
          window.__gfRoomEvents = [];
          window.__gfRespawns = [];
          window.__gfApocalypseEvents = [];
          window.__gfRoomSnapshots = [];
          window.__gloflux._orch.network.on('chainActivated', (msg) => {
            window.__gfRoomEvents.push(msg);
          });
          window.__gloflux._orch.network.on('powerRespawn', (msg) => {
            window.__gfRespawns.push(msg);
          });
          window.__gloflux._orch.network.on('apocalypseTriggered', (msg) => {
            window.__gfApocalypseEvents.push(msg);
          });
          window.__gloflux._orch.network.room.onMessage('debugRoomSnapshot', (msg) => {
            window.__gfRoomSnapshots.push(msg);
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
          hostSessionId: orch.network.sessionId,
          spawnIndices: [firstIdx, secondIdx],
        };
      });

      const guestSessionId = await page2.evaluate(() => window.__gloflux._orch.network.sessionId);

      await Promise.all([
        page1.waitForFunction(
          ([firstIdx, secondIdx]) => {
            const respawns = window.__gfRespawns || [];
            return !!(
              respawns.find((entry) => entry.idx === firstIdx && entry.powerId === 'gravity_well') &&
              respawns.find((entry) => entry.idx === secondIdx && entry.powerId === 'dimensional_rift')
            );
          },
          setupSnapshot.spawnIndices,
          { timeout: 10_000 },
        ),
        page2.waitForFunction(
          ([firstIdx, secondIdx]) => {
            const respawns = window.__gfRespawns || [];
            return !!(
              respawns.find((entry) => entry.idx === firstIdx && entry.powerId === 'gravity_well') &&
              respawns.find((entry) => entry.idx === secondIdx && entry.powerId === 'dimensional_rift')
            );
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
          setupSnapshot.hostSessionId,
          { timeout: 10_000 },
        ),
        page2.waitForFunction(
          (hostSessionId) => {
            const events = window.__gfRoomEvents || [];
            const telemetry = window.__gloflux?._orch?.network?.telemetry;
            return events.some((entry) => entry.sessionId === hostSessionId && entry.comboId === 'void_portal' && Number(entry.patchVersion || 0) >= 2)
              && Number(telemetry?.patchVersion || 0) >= 2;
          },
          setupSnapshot.hostSessionId,
          { timeout: 10_000 },
        ),
      ]);

      await page1.evaluate(() => {
        window.__gloflux._orch.network.requestApocalypse();
      });

      await Promise.all([
        page1.waitForFunction(
          (hostSessionId) => {
            const apocalypseEvents = window.__gfApocalypseEvents || [];
            return apocalypseEvents.some((entry) => entry.sessionId === hostSessionId);
          },
          setupSnapshot.hostSessionId,
          { timeout: 10_000 },
        ),
        page2.waitForFunction(
          (hostSessionId) => {
            const apocalypseEvents = window.__gfApocalypseEvents || [];
            return apocalypseEvents.some((entry) => entry.sessionId === hostSessionId);
          },
          setupSnapshot.hostSessionId,
          { timeout: 10_000 },
        ),
      ]);

      await Promise.all([
        page1.waitForFunction(
          (guestId) => Number(window.__gloflux?._orch?.network?.room?.state?.players?.get?.(guestId)?.health || 100) <= 70,
          guestSessionId,
          { timeout: 10_000 },
        ),
      ]);

      await page1.evaluate(() => {
        window.__gloflux._orch.network.room.send('debugRoomSnapshotRequest', {});
      });

      await page1.waitForFunction(
        (guestId) => {
          const snapshots = window.__gfRoomSnapshots || [];
          const latest = snapshots[snapshots.length - 1];
          if (!latest?.players?.length) return false;
          const guest = latest.players.find((entry) => entry.sessionId === guestId);
          return Number(guest?.health || 100) <= 70;
        },
        guestSessionId,
        { timeout: 10_000 },
      );

      const [snapshot1, snapshot2] = await Promise.all([
        page1.evaluate((guestId) => {
          const orch = window.__gloflux._orch;
          const roomPlayer = orch.network.room.state.players.get(guestId);
          const latestSnapshot = (window.__gfRoomSnapshots || []).slice(-1)[0] || null;
          const snapshotGuest = latestSnapshot?.players?.find?.((entry) => entry.sessionId === guestId) || null;
          return {
            hostSessionId: orch.network.sessionId,
            telemetry: { ...orch.network.telemetry },
            chainEvents: (window.__gfRoomEvents || []).slice(),
            apocalypseEvents: (window.__gfApocalypseEvents || []).slice(),
            guestHealth: Number(roomPlayer?.health || 0),
            hostHealth: Number(orch.network.room.state.players.get(orch.network.sessionId)?.health || 0),
            latestSnapshot,
            snapshotGuestHealth: Number(snapshotGuest?.health || 0),
          };
        }, guestSessionId),
        page2.evaluate((guestId) => {
          const orch = window.__gloflux._orch;
          return {
            guestSessionId: orch.network.sessionId,
            telemetry: { ...orch.network.telemetry },
            chainEvents: (window.__gfRoomEvents || []).slice(),
            apocalypseEvents: (window.__gfApocalypseEvents || []).slice(),
          };
        }, guestSessionId),
      ]);

      expect(snapshot1.chainEvents.some((entry) => entry.sessionId === setupSnapshot.hostSessionId && entry.comboId === 'void_portal')).toBe(true);
      expect(Number(snapshot1.telemetry.patchVersion || 0)).toBeGreaterThanOrEqual(2);
      expect(snapshot1.apocalypseEvents.some((entry) => entry.sessionId === setupSnapshot.hostSessionId)).toBe(true);
      expect(snapshot2.apocalypseEvents.some((entry) => entry.sessionId === setupSnapshot.hostSessionId)).toBe(true);
      expect(snapshot1.guestHealth).toBeLessThanOrEqual(70);
      expect(snapshot1.snapshotGuestHealth).toBeLessThanOrEqual(70);
      expect(snapshot1.hostHealth).toBeGreaterThan(70);

      expect(errors1.filter(isCriticalError)).toHaveLength(0);
      expect(errors2.filter(isCriticalError)).toHaveLength(0);
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});