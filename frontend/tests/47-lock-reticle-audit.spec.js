import { test, expect } from '@playwright/test';
import {
  injectGameConfig,
  waitForDebug,
  BATTLE_CONFIG,
} from './helpers/game-helpers.js';

function withLobbyCode(config, label) {
  return {
    ...config,
    lobbyCode: `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  };
}

async function bootSingleBattle(page, label = 'lock-reticle') {
  const cfg = withLobbyCode({ ...BATTLE_CONFIG, maxPlayers: 1 }, label);
  await injectGameConfig(page, cfg);
  await page.goto('/realtime.html');
  await waitForDebug(page, (d) => d.roomJoined === true && d.kartLoaded === true, 30_000);
}

async function runSyntheticLockSequence(page, distance = 16, frameMarks = [1, 18, 90]) {
  return page.evaluate(({ targetDistance, marks }) => {
    const client = window.__gloClient;
    if (!client?.localMesh) throw new Error('battle client unavailable');

    client.currentWeapon2 = 'missile';
    client._localCombatState.weapon2 = 'missile';

    const localPos = client.localMesh.position.clone();
    const targetPos = localPos.clone();
    targetPos.z += targetDistance;
    targetPos.y += 1.4;

    client._projectWorldToScreen = () => ({
      x: client.engine.getRenderWidth() / 2,
      y: client.engine.getRenderHeight() / 2,
      z: 0.5,
    });
    client._getMissileAimDirection = () => targetPos.subtract(localPos).normalize();

    const fakeTarget = {
      id: 'synthetic-lock-target',
      x: targetPos.x,
      y: targetPos.y - 1.4,
      z: targetPos.z,
      vx: 0,
      vy: 0,
      vz: 0,
      health: 100,
      name: 'Synthetic Target',
    };

    client.authoritativeState = {
      ...client.authoritativeState,
      players: {
        forEach(cb) { cb(fakeTarget, fakeTarget.id); },
        get(id) { return id === fakeTarget.id ? fakeTarget : null; },
      },
    };

    client._missileLockState.targetId = null;
    client._missileLockState.lockProgress = 0;
    client._missileLockState.locked = false;
    client._missileLockState.loseTimer = 0;
    client._missileLockTargetId = null;
    client._missileLockProgress = 0;
    client._missileLockWasLocked = false;

    const sortedMarks = [...marks].sort((a, b) => a - b);
    const snapshots = [];
    let currentFrame = 0;

    for (const targetFrame of sortedMarks) {
      while (currentFrame < targetFrame) {
        currentFrame += 1;
        client._updateMissileLockReticle(1 / 60);
      }
      const reticle = document.getElementById('lock-reticle');
      snapshots.push({
        frame: targetFrame,
        display: reticle?.style.display || '',
        width: Number.parseFloat(reticle?.style.width || '0'),
        height: Number.parseFloat(reticle?.style.height || '0'),
        left: reticle?.style.left || '',
        top: reticle?.style.top || '',
        targetId: client._missileLockTargetId || null,
        locked: !!client._missileLockState?.locked,
        progress: Number(client._missileLockState?.lockProgress || 0),
      });
    }

    return snapshots;
  }, { targetDistance: distance, marks: frameMarks });
}

test.describe.configure({ mode: 'serial' });

test('lock reticle appears, tightens, and reaches lock on an on-screen target', async ({ page }) => {
  await bootSingleBattle(page, 'lock-reticle-audit');
  const [early, mid, final] = await runSyntheticLockSequence(page, 16, [1, 18, 90]);

  expect(early.display).toBe('block');
  expect(early.targetId).toBe('synthetic-lock-target');
  expect(early.progress).toBeGreaterThan(0);
  expect(early.width).toBeGreaterThan(mid.width);

  expect(mid.display).toBe('block');
  expect(mid.left).not.toBe('');
  expect(mid.top).not.toBe('');
  expect(mid.progress).toBeGreaterThan(early.progress);
  expect(mid.width).toBeGreaterThan(final.width);

  expect(final.display).toBe('block');
  expect(final.locked).toBe(true);
  expect(final.progress).toBe(1);
  expect(final.width).toBeLessThanOrEqual(36);
  expect(final.height).toBeLessThanOrEqual(36);
});
