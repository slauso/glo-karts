import { chromium } from 'playwright';
import { injectGameConfig, waitForDebug, BATTLE_CONFIG } from '../tests/helpers/game-helpers.js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

function uniqueLobbyCode(label = 'pickup-swap') {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

async function getActiveItemBoxes(page) {
  return page.evaluate(() => {
    const entities = window.__gloClient?.authoritativeState?.entities;
    if (!entities) return [];
    const boxes = [];
    for (const [id, entity] of entities.entries()) {
      if (entity?.type === 'item_box' && entity?.active) {
        boxes.push({ id, x: entity.x, y: entity.y, z: entity.z });
      }
    }
    return boxes;
  });
}

async function getSlotState(page) {
  return page.evaluate(() => {
    const client = window.__gloClient;
    const combat = client?._localCombatState || {};
    return {
      weapon2: combat.weapon2 || '',
      ammo2: Number(combat.ammo2 || 0),
      weapon3: combat.weapon3 || '',
      ammo3: Number(combat.ammo3 || 0),
      currentWeapon2: client?.currentWeapon2 || '',
      reserveWeapon: client?.reserveWeapon || '',
      lastWeaponReceived: window.__gloDebug?.lastWeaponReceived || null,
      swapCount: Number(client?._testSwapCount || 0),
    };
  });
}

async function moveNearAndPickup(page, itemBox) {
  await page.evaluate(({ itemBox: nextItemBox }) => {
    const client = window.__gloClient;
    const room = client?.room;
    const mesh = client?.localMesh;
    if (!client || !room || !mesh) return;

    room.send('debugTeleport', {
      x: nextItemBox.x,
      y: nextItemBox.y + 0.5,
      z: nextItemBox.z,
      heading: 0,
    });

    mesh.position.set(nextItemBox.x, nextItemBox.y + 0.5, nextItemBox.z);
    const body = client.localKartAggregate?.body;
    if (body) {
      body.disablePreStep = false;
      body.setLinearVelocity({ x: 0, y: 0, z: 0 });
      body.setAngularVelocity({ x: 0, y: 0, z: 0 });
    }
  }, { itemBox });

  await page.keyboard.down('w');
  await page.waitForTimeout(250);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const body = window.__gloClient?.localKartAggregate?.body;
    if (body) body.disablePreStep = true;
  });
}

async function installSwapProbe(page) {
  await page.evaluate(() => {
    const client = window.__gloClient;
    if (!client?.room) return;
    client._testSwapCount = 0;
    client.room.onMessage('secondaryWeaponSwapped', () => {
      client._testSwapCount = Number(client._testSwapCount || 0) + 1;
    });
  });
}

async function forceDistinctActiveWeapon(page, reserveWeapon) {
  const nextWeapon = reserveWeapon === 'fireball' ? 'tornado' : 'fireball';
  await page.evaluate(({ weaponId }) => {
    const room = window.__gloClient?.room;
    if (!room) return;
    room.send('debugGrantWeapon', { weaponId, ammo: 1 });
  }, { weaponId: nextWeapon });

  await page.waitForFunction((weaponId) => {
    const combat = window.__gloClient?._localCombatState;
    return combat?.weapon2 === weaponId;
  }, nextWeapon, { timeout: 5000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const errors = [];
  hostPage.on('pageerror', (error) => errors.push(`host:${String(error?.message || error)}`));
  guestPage.on('pageerror', (error) => errors.push(`guest:${String(error?.message || error)}`));

  const config = {
    ...BATTLE_CONFIG,
    maxPlayers: 1,
    scoreLimit: 3,
    playerName: 'PickupSwapTest',
    lobbyCode: uniqueLobbyCode(),
    multiplayerProvider: 'colyseus',
    multiplayer: true,
  };

  try {
    await injectGameConfig(hostPage, config);
    await injectGameConfig(guestPage, config);
    await hostPage.goto(`${BASE_URL}/realtime.html?smoke=PickupHost`, { waitUntil: 'domcontentloaded' });
    await guestPage.goto(`${BASE_URL}/realtime.html?smoke=PickupGuest`, { waitUntil: 'domcontentloaded' });
    await waitForDebug(hostPage, (d) => d.roomJoined === true, 30000);
    await waitForDebug(guestPage, (d) => d.roomJoined === true, 30000);
    await waitForDebug(hostPage, (d) => d.matchLive === true, 30000);
    await waitForDebug(guestPage, (d) => d.matchLive === true, 30000);
    await hostPage.waitForTimeout(1200);
    await installSwapProbe(hostPage);

    const boxes = await getActiveItemBoxes(hostPage);
    if (boxes.length < 2) {
      throw new Error(`Expected at least 2 active item boxes, found ${boxes.length}`);
    }

    await moveNearAndPickup(hostPage, boxes[0]);
    await hostPage.waitForFunction(() => {
      const combat = window.__gloClient?._localCombatState;
      return !!combat?.weapon2 && (!combat?.weapon3 || combat.ammo3 <= 0);
    }, { timeout: 10000 });
    const firstState = await getSlotState(hostPage);

    await moveNearAndPickup(hostPage, boxes[1]);
    await hostPage.waitForFunction(() => {
      const combat = window.__gloClient?._localCombatState;
      return !!combat?.weapon2 && !!combat?.weapon3 && Number(combat.ammo3 || 0) > 0;
    }, { timeout: 10000 });
    let secondState = await getSlotState(hostPage);

    if (secondState.weapon2 === secondState.weapon3 && secondState.weapon3) {
      await forceDistinctActiveWeapon(hostPage, secondState.weapon3);
      secondState = await getSlotState(hostPage);
    }

    await hostPage.keyboard.press('r');
    await hostPage.waitForFunction(() => {
      return Number(window.__gloClient?._testSwapCount || 0) > 0;
    }, { timeout: 5000 });
    await hostPage.waitForTimeout(250);
    const swappedState = await getSlotState(hostPage);

    const activeFilled = !!secondState.weapon2 && secondState.ammo2 > 0;
    const reserveFilled = !!secondState.weapon3 && secondState.ammo3 > 0;
    const swapObserved = swappedState.swapCount > 0;
    const visibleSwap =
      secondState.weapon2 !== swappedState.weapon2 ||
      secondState.weapon3 !== swappedState.weapon3 ||
      secondState.ammo2 !== swappedState.ammo2 ||
      secondState.ammo3 !== swappedState.ammo3;

    if (!activeFilled || !reserveFilled) {
      throw new Error(`Dual-slot fill failed: ${JSON.stringify({ firstState, secondState })}`);
    }
    if (!swapObserved) {
      throw new Error(`Swap event not observed: ${JSON.stringify({ secondState, swappedState })}`);
    }

    console.log('SECONDARY_PICKUP_SWAP_RESULT', JSON.stringify({
      ok: true,
      baseUrl: BASE_URL,
      firstState,
      secondState,
      swappedState,
      visibleSwap,
      errors,
    }, null, 2));
  } catch (error) {
    const finalState = await getSlotState(hostPage).catch(() => ({}));
    const debugState = await hostPage.evaluate(() => ({
      status: document.getElementById('rt-status')?.textContent || null,
      splash: document.getElementById('splash-status')?.textContent || null,
      hasClient: !!window.__gloClient,
      clientState: window.__gloClient ? {
        localPosition: window.__gloClient.localMesh ? {
          x: Number(window.__gloClient.localMesh.position.x || 0),
          y: Number(window.__gloClient.localMesh.position.y || 0),
          z: Number(window.__gloClient.localMesh.position.z || 0),
        } : null,
        pendingPickupBoxes: Array.from(window.__gloClient._pendingPickupBoxes || []),
        activeItemBoxes: (() => {
          const entities = window.__gloClient.authoritativeState?.entities;
          if (!entities) return [];
          const boxes = [];
          for (const [id, entity] of entities.entries()) {
            if (entity?.type === 'item_box' && entity?.active) {
              boxes.push({ id, x: entity.x, y: entity.y, z: entity.z });
            }
          }
          return boxes;
        })(),
      } : null,
      debug: window.__gloDebug ? JSON.parse(JSON.stringify(window.__gloDebug)) : null,
    })).catch(() => ({}));
    console.error('SECONDARY_PICKUP_SWAP_RESULT', JSON.stringify({
      ok: false,
      baseUrl: BASE_URL,
      error: String(error?.message || error),
      finalState,
      debugState,
      errors,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await hostContext.close();
    await guestContext.close();
    await browser.close();
  }
}

run();
