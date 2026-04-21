import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'battle-4p-combat-probe.json');
const PLAYER_NAMES = ['PerfHost', 'PerfGuestA', 'PerfGuestB', 'PerfGuestC'];
const TELEPORT_LAYOUT = [
  { x: 18, y: 0.35, z: 0, heading: Math.PI },
  { x: 0, y: 0.35, z: 18, heading: -Math.PI / 2 },
  { x: -18, y: 0.35, z: 0, heading: 0 },
  { x: 0, y: 0.35, z: -18, heading: Math.PI / 2 },
];
const PROBE_CONFIG = {
  weaponId: 'crimson_hydra',
  ammo: 48,
  fireIntervalMs: 240,
  sampleCount: 12,
  sampleIntervalMs: 1000,
  minFpsFloor: 30,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(payload) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function openLobby(page, playerName) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#mode-cards', { timeout: 30000 });
  await page.waitForFunction(() => {
    const input = document.getElementById('player-name-input');
    return input && input.placeholder && input.placeholder !== 'Enter Your Nickname...';
  }, null, { timeout: 15000 });
  await page.fill('#player-name-input', playerName);
}

async function createLobby(hostPage) {
  await hostPage.evaluate(() => {
    document.querySelector('.mode-card[data-mode-id="battle_online"]')?.click();
  });
  await wait(400);
  await hostPage.click('#play-btn', { force: true });
  await hostPage.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    return code && code.length >= 3;
  }, null, { timeout: 30000 });
  return (await hostPage.locator('#party-code').textContent()).trim();
}

async function joinLobby(page, lobbyCode) {
  await page.fill('#join-code-input', lobbyCode);
  await page.click('#join-party-btn', { force: true });
  await page.waitForSelector('#host-info:not(.hidden)', { timeout: 30000 });
}

async function waitForLobbyCount(page, expectedCount) {
  await page.waitForFunction((count) => {
    return document.querySelectorAll('#player-list li').length >= count;
  }, expectedCount, { timeout: 30000 });
}

async function startMatch(hostPage, guestPages) {
  for (const guest of guestPages) {
    await guest.click('#ready-btn', { force: true });
    await wait(250);
  }

  await waitForLobbyCount(hostPage, 4);
  await hostPage.click('#start-match-btn', { force: true });
}

async function waitForBattle(page) {
  await page.waitForURL(/realtime\.html/, { timeout: 45000 });
  await page.waitForFunction(() => {
    const client = window.__gloClient || window.client;
    return client?.started === true && client?.room?.state?.started === true;
  }, null, { timeout: 120000 });
}

async function teleportPage(page, teleport) {
  await page.evaluate((nextPos) => {
    const client = window.__gloClient || window.client;
    client?.room?.send('debugTeleport', nextPos);
  }, teleport);

  await page.waitForFunction((expected) => {
    const client = window.__gloClient || window.client;
    const room = client?.room;
    const me = room?.state?.players?.get?.(room?.sessionId);
    if (!me) return false;
    return Math.abs(Number(me.x) - expected.x) < 1.5
      && Math.abs(Number(me.z) - expected.z) < 1.5;
  }, teleport, { timeout: 15000 });
}

async function startCombatDriver(page, config) {
  await page.evaluate((probeConfig) => {
    const client = window.__gloClient || window.client;
    const room = client?.room;
    if (!client || !room?.state?.players) throw new Error('Realtime client not ready for combat driver');

    if (window.__combatProbe?.stop) {
      window.__combatProbe.stop();
    }

    const sessionId = room.sessionId;
    const pickTarget = () => {
      const me = room.state.players.get?.(sessionId);
      if (!me) return null;
      let best = null;
      let bestDistanceSq = Infinity;
      room.state.players.forEach((candidate, id) => {
        if (id === sessionId || Number(candidate.health || 0) <= 0) return;
        const dx = Number(candidate.x) - Number(me.x);
        const dy = Number(candidate.y) - Number(me.y);
        const dz = Number(candidate.z) - Number(me.z);
        const distanceSq = (dx * dx) + (dy * dy) + (dz * dz);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best = candidate;
        }
      });
      return best;
    };

    window.__combatProbe = {
      weaponId: probeConfig.weaponId,
      fireIntervalMs: probeConfig.fireIntervalMs,
      stats: {
        fireBursts: 0,
        lastTargetId: '',
      },
      stop: null,
    };

    const fire = () => {
      const me = room.state.players.get?.(sessionId);
      if (!me) return;

      room.send('debugGrantWeapon', {
        weaponId: probeConfig.weaponId,
        ammo: probeConfig.ammo,
      });

      const target = pickTarget();
      const dx = target ? Number(target.x) - Number(me.x) : 0;
      const dy = target ? Number(target.y) - Number(me.y) : 0.05;
      const dz = target ? Number(target.z) - Number(me.z) : 1;
      const rawLength = Math.hypot(dx, dy, dz) || 1;
      const dirX = dx / rawLength;
      const dirY = Math.max(-0.18, Math.min(0.18, dy / rawLength));
      const dirZ = dz / rawLength;
      const originY = Number(me.y) + 1.1;

      room.send('fireWeapon', {
        slot: 'secondary',
        originX: Number(me.x) + dirX * 2.8,
        originY,
        originZ: Number(me.z) + dirZ * 2.8,
        dirX,
        dirY,
        dirZ,
        targetId: target?.id || '',
        lockStrength: target ? 1 : 0,
        lockLocked: !!target,
      });

      window.__combatProbe.stats.fireBursts += 1;
      window.__combatProbe.stats.lastTargetId = target?.id || '';
    };

    const timer = window.setInterval(fire, probeConfig.fireIntervalMs);
    window.__combatProbe.stop = () => {
      window.clearInterval(timer);
    };
    fire();
  }, config);
}

async function stopCombatDriver(page) {
  await page.evaluate(() => {
    if (window.__combatProbe?.stop) {
      window.__combatProbe.stop();
    }
  });
}

async function readCombatMetrics(page, label) {
  return page.evaluate((pageLabel) => {
    const client = window.__gloClient || window.client;
    const scene = client?.scene;
    const engine = client?.engine;
    const room = client?.room;
    const perfBudget = window.__gloDebug?.performanceBudget || null;

    let activeProjectiles = 0;
    let activeItemBoxes = 0;
    const particleNameCounts = new Map();
    room?.state?.entities?.forEach?.((entity) => {
      if (!entity?.active) return;
      if (entity.type === 'projectile') activeProjectiles += 1;
      if (entity.type === 'item_box') activeItemBoxes += 1;
    });

    for (const ps of scene?.particleSystems || []) {
      const key = ps?.name || 'unnamed';
      particleNameCounts.set(key, (particleNameCounts.get(key) || 0) + 1);
    }

    const me = room?.state?.players?.get?.(room?.sessionId);

    return {
      label: pageLabel,
      fps: Number((engine?.getFps?.() || 0).toFixed(1)),
      tier: perfBudget?.tier ?? null,
      drawCalls: Number(perfBudget?.drawCalls || 0),
      particleSystems: Number(scene?.particleSystems?.length || 0),
      activeParticles: Number(scene?.particleSystems?.reduce((sum, ps) => sum + (ps.getActiveCount?.() || 0), 0) || 0),
      activeProjectiles,
      activeItemBoxes,
      weapon2: me?.weapon2 || '',
      ammo2: Number(me?.ammo2 || 0),
      health: Number(me?.health || 0),
      score: Number(me?.score || 0),
      topParticleSystems: Array.from(particleNameCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12),
      probeStats: window.__combatProbe?.stats || null,
    };
  }, label);
}

function summarizeTimeline(timeline) {
  const perPlayerMin = new Map();
  let globalMinFps = Infinity;
  let peakProjectiles = 0;
  let peakDrawCalls = 0;

  for (const sample of timeline) {
    for (const metric of sample.metrics) {
      const currentMin = perPlayerMin.get(metric.label);
      perPlayerMin.set(metric.label, currentMin == null ? metric.fps : Math.min(currentMin, metric.fps));
      globalMinFps = Math.min(globalMinFps, metric.fps);
      peakProjectiles = Math.max(peakProjectiles, metric.activeProjectiles || 0);
      peakDrawCalls = Math.max(peakDrawCalls, metric.drawCalls || 0);
    }
  }

  return {
    globalMinFps: Number.isFinite(globalMinFps) ? Number(globalMinFps.toFixed(1)) : 0,
    peakProjectiles,
    peakDrawCalls,
    perPlayerMinFps: Object.fromEntries(
      [...perPlayerMin.entries()].map(([label, fps]) => [label, Number(fps.toFixed(1))])
    ),
  };
}

async function run() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--use-gl=angle',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const contexts = await Promise.all(
    PLAYER_NAMES.map(() => browser.newContext({ viewport: { width: 1280, height: 720 } }))
  );
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  let step = 'boot';

  try {
    step = 'open-lobbies';
    await Promise.all(pages.map((page, index) => openLobby(page, PLAYER_NAMES[index])));

    step = 'create-host-lobby';
    const lobbyCode = await createLobby(pages[0]);
    assert(lobbyCode, 'Host lobby code should be available');

    step = 'join-guests';
    for (const guest of pages.slice(1)) {
      await joinLobby(guest, lobbyCode);
    }

    step = 'wait-lobby-population';
    await Promise.all(pages.map((page) => waitForLobbyCount(page, 4)));

    step = 'start-match';
    await startMatch(pages[0], pages.slice(1));

    step = 'wait-for-battle';
    await Promise.all(pages.map((page) => waitForBattle(page)));

    step = 'teleport-layout';
    for (let i = 0; i < pages.length; i += 1) {
      await teleportPage(pages[i], TELEPORT_LAYOUT[i]);
    }

    await wait(1500);

    step = 'start-combat-drivers';
    await Promise.all(pages.map((page) => startCombatDriver(page, PROBE_CONFIG)));

    const timeline = [];
    step = 'sample-combat-load';
    for (let sampleIndex = 0; sampleIndex < PROBE_CONFIG.sampleCount; sampleIndex += 1) {
      await wait(PROBE_CONFIG.sampleIntervalMs);
      const metrics = await Promise.all(
        pages.map((page, index) => readCombatMetrics(page, PLAYER_NAMES[index]))
      );
      timeline.push({
        sampleIndex,
        elapsedMs: (sampleIndex + 1) * PROBE_CONFIG.sampleIntervalMs,
        metrics,
      });
    }

    step = 'stop-combat-drivers';
    await Promise.all(pages.map((page) => stopCombatDriver(page)));

    const summary = summarizeTimeline(timeline);
    const result = {
      ok: summary.globalMinFps >= PROBE_CONFIG.minFpsFloor,
      config: PROBE_CONFIG,
      lobbyCode,
      summary,
      timeline,
    };

    writeReport(result);
    console.log('BATTLE_4P_COMBAT_PROBE', JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    const payload = {
      ok: false,
      step,
      error: String(error?.message || error),
    };
    writeReport(payload);
    console.error('BATTLE_4P_COMBAT_PROBE', JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  } finally {
    await Promise.all(pages.map((page) => stopCombatDriver(page).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  const payload = { ok: false, error: String(error?.message || error) };
  writeReport(payload);
  console.error('BATTLE_4P_COMBAT_PROBE', JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});