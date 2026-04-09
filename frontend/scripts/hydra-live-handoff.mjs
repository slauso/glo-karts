import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'hydra-live-handoff.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(payload) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function configureHydraOnlyHost(page) {
  await page.click('.mode-card[data-mode-id="battle_online"]');
  await page.waitForSelector('#battle-settings:not(.hidden)', { timeout: 10000 });
  await page.click('.weapon-loadout-btn[data-loadout="custom"]');
  await page.waitForSelector('.custom-weapon-chip[data-weapon-id="crimson_hydra"]', { timeout: 10000 });

  await page.evaluate(() => {
    const hydraId = 'crimson_hydra';
    document.querySelectorAll('.custom-weapon-chip.active').forEach((chip) => {
      if (chip.getAttribute('data-weapon-id') !== hydraId) {
        chip.click();
      }
    });
    const hydraChip = document.querySelector(`.custom-weapon-chip[data-weapon-id="${hydraId}"]`);
    if (!hydraChip) throw new Error('Hydra chip missing from host custom pool');
    if (!hydraChip.classList.contains('active')) {
      hydraChip.click();
    }
  });

  await page.click('#play-btn');
  await page.waitForSelector('#party-code', { timeout: 10000 });
}

async function joinGuest(page, lobbyCode) {
  await page.fill('#join-code-input', lobbyCode);
  await page.click('#join-party-btn');
  await page.waitForSelector('#host-info:not(.hidden)', { timeout: 10000 });
  await page.waitForSelector('#battle-settings:not(.hidden)', { timeout: 10000 });
  await page.waitForSelector('.weapon-loadout-btn.active[data-loadout="custom"]', { timeout: 10000 });
}

async function readLobbyState(page) {
  return page.evaluate(() => ({
    code: document.getElementById('party-code')?.textContent?.trim() || '',
    selectedLoadout: document.querySelector('.weapon-loadout-btn.active')?.getAttribute('data-loadout') || '',
    activeWeapons: [...document.querySelectorAll('.custom-weapon-chip.active')].map((chip) => chip.getAttribute('data-weapon-id')),
    hydraLabel: document.querySelector('.custom-weapon-chip[data-weapon-id="crimson_hydra"] .custom-weapon-label')?.textContent?.trim() || '',
  }));
}

async function readyAndStart(host, guest) {
  await guest.click('#ready-btn');
  await host.waitForSelector('#start-match-btn', { timeout: 10000 });
  await host.click('#start-match-btn');

  await Promise.all([
    host.waitForFunction(() => {
      const config = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
      return config?.loadoutId === 'custom' && Array.isArray(config?.weaponPool) && config.weaponPool[0] === 'crimson_hydra';
    }, undefined, { timeout: 20000 }),
    guest.waitForFunction(() => {
      const config = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
      return config?.loadoutId === 'custom' && Array.isArray(config?.weaponPool) && config.weaponPool[0] === 'crimson_hydra';
    }, undefined, { timeout: 20000 }),
  ]);
}

async function enterRealtimeBattle(page) {
  await page.goto(`${BASE_URL}/realtime.html`, { waitUntil: 'domcontentloaded' });
}

async function readGameConfig(page) {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('gameConfig') || '{}'));
}

async function waitForBattleSpawn(page) {
  await page.waitForFunction(() => {
    const client = window.client;
    const room = client?.room;
    if (!room?.state?.started || !room.sessionId || !room.state.players) return false;
    const me = room.state.players.get?.(room.sessionId);
    if (!me) return false;
    return Number.isFinite(Number(me.x)) && Number.isFinite(Number(me.y)) && Number.isFinite(Number(me.z));
  }, undefined, { timeout: 45000 });
}

async function readBattleState(page) {
  return page.evaluate(() => {
    const client = window.client;
    const room = client?.room;
    const me = room?.state?.players?.get?.(room?.sessionId);
    const players = [];
    room?.state?.players?.forEach?.((player, id) => {
      players.push({
        id,
        name: player.name,
        x: Number(player.x),
        y: Number(player.y),
        z: Number(player.z),
        health: Number(player.health),
        ready: !!player.ready,
      });
    });
    const itemBoxes = [];
    room?.state?.entities?.forEach?.((entity, id) => {
      if (entity.type === 'item_box') {
        itemBoxes.push({ id, active: !!entity.active, x: Number(entity.x), y: Number(entity.y), z: Number(entity.z) });
      }
    });
    return {
      roomName: room?.name || '',
      sessionId: room?.sessionId || '',
      started: !!room?.state?.started,
      playerCount: players.length,
      itemBoxCount: itemBoxes.length,
      localPlayer: me ? {
        id: me.id,
        x: Number(me.x),
        y: Number(me.y),
        z: Number(me.z),
        health: Number(me.health),
        ready: !!me.ready,
      } : null,
      players,
      activeItemBoxes: itemBoxes.filter((entity) => entity.active).length,
    };
  });
}

async function readBattleDebug(page) {
  return page.evaluate(() => {
    const client = window.client;
    const room = client?.room;
    const players = [];
    room?.state?.players?.forEach?.((player, id) => {
      players.push({ id, ready: !!player.ready, x: Number(player.x), y: Number(player.y), z: Number(player.z), health: Number(player.health) });
    });
    return {
      href: window.location.href,
      roomName: room?.name || '',
      sessionId: room?.sessionId || '',
      started: !!room?.state?.started,
      countdownActive: !!room?.state?.countdownActive,
      playerCount: players.length,
      players,
      splashStatus: document.getElementById('splash-status')?.textContent?.trim() || '',
      statusText: document.getElementById('status')?.textContent?.trim() || '',
    };
  });
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const host = await context.newPage();
  const guest = await context.newPage();
  let step = 'boot';

  try {
    step = 'load-lobby-pages';
    await Promise.all([
      host.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' }),
      guest.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' }),
    ]);
    await Promise.all([
      host.evaluate(() => sessionStorage.setItem('realtimeSmokeMode', 'hydra-handoff')),
      guest.evaluate(() => sessionStorage.setItem('realtimeSmokeMode', 'hydra-handoff')),
    ]);

    step = 'configure-host-hydra-only';
    await configureHydraOnlyHost(host);
    const hostLobby = await readLobbyState(host);
    assert(hostLobby.code && hostLobby.code !== 'XXXXXX', 'Host lobby code should be generated');
    assert(hostLobby.selectedLoadout === 'custom', 'Host should be using the custom loadout');
    assert(hostLobby.activeWeapons.length === 1 && hostLobby.activeWeapons[0] === 'crimson_hydra', 'Host custom pool should be Hydra-only');

    step = 'guest-join-lobby';
    await joinGuest(guest, hostLobby.code);
    const guestLobby = await readLobbyState(guest);
    assert(guestLobby.selectedLoadout === 'custom', 'Guest should receive the custom loadout from lobby state');
    assert(guestLobby.activeWeapons.length === 1 && guestLobby.activeWeapons[0] === 'crimson_hydra', 'Guest should mirror the Hydra-only pool');
    assert(guestLobby.hydraLabel === 'Crimson Hydra', 'Guest should render the Hydra chip label');

    step = 'start-match';
    await readyAndStart(host, guest);

    step = 'read-game-config';
    const hostGameConfig = await readGameConfig(host);
    const guestGameConfig = await readGameConfig(guest);
    step = 'enter-realtime-pages';
    await Promise.all([enterRealtimeBattle(host), enterRealtimeBattle(guest)]);
    step = 'wait-for-battle-spawn';
    await Promise.all([waitForBattleSpawn(host), waitForBattleSpawn(guest)]);
    step = 'read-battle-state';
    const hostBattle = await readBattleState(host);
    const guestBattle = await readBattleState(guest);
    const summary = {
      hostLobby,
      guestLobby,
      hostGameConfig: {
        loadoutId: hostGameConfig.loadoutId,
        weaponPool: hostGameConfig.weaponPool,
        arenaId: hostGameConfig.arenaId,
      },
      guestGameConfig: {
        loadoutId: guestGameConfig.loadoutId,
        weaponPool: guestGameConfig.weaponPool,
        arenaId: guestGameConfig.arenaId,
      },
      hostBattle,
      guestBattle,
    };

    assert(hostGameConfig.loadoutId === 'custom', 'Host gameConfig should carry the custom loadout');
    assert(guestGameConfig.loadoutId === 'custom', 'Guest gameConfig should carry the custom loadout');
    assert(Array.isArray(hostGameConfig.weaponPool) && hostGameConfig.weaponPool.length === 1 && hostGameConfig.weaponPool[0] === 'crimson_hydra', 'Host gameConfig weapon pool should be Hydra-only');
    assert(Array.isArray(guestGameConfig.weaponPool) && guestGameConfig.weaponPool.length === 1 && guestGameConfig.weaponPool[0] === 'crimson_hydra', 'Guest gameConfig weapon pool should be Hydra-only');
    assert(hostBattle.started && guestBattle.started, 'Both battle clients should report a live started match');
    assert(hostBattle.roomName === 'battle_room' && guestBattle.roomName === 'battle_room', 'Both clients should connect to battle_room');
    assert(hostBattle.playerCount >= 2 && guestBattle.playerCount >= 2, 'Both battle clients should see at least two players after spawn');
    assert(hostBattle.itemBoxCount === 8 && guestBattle.itemBoxCount === 8, 'Both battle clients should receive the arena item boxes after spawn');
    assert(hostBattle.localPlayer && hostBattle.localPlayer.health > 0, 'Host local player should spawn with health');
    assert(guestBattle.localPlayer && guestBattle.localPlayer.health > 0, 'Guest local player should spawn with health');
    assert(Number.isFinite(hostBattle.localPlayer?.x) && Number.isFinite(hostBattle.localPlayer?.z), 'Host local player should have finite spawn coordinates');
    assert(Number.isFinite(guestBattle.localPlayer?.x) && Number.isFinite(guestBattle.localPlayer?.z), 'Guest local player should have finite spawn coordinates');

    const payload = { ok: true, summary };
    writeReport(payload);
    console.log('HYDRA_LIVE_HANDOFF', JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      step,
      error: String(error?.message || error),
      debug: {
        host: await readBattleDebug(host).catch(() => null),
        guest: await readBattleDebug(guest).catch(() => null),
      },
    };
    writeReport(payload);
    console.error('HYDRA_LIVE_HANDOFF', JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  const payload = { ok: false, error: String(error?.message || error) };
  writeReport(payload);
  console.error('HYDRA_LIVE_HANDOFF', JSON.stringify(payload, null, 2));
  process.exit(1);
});