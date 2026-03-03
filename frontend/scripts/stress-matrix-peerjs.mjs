import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

const KARTS = [
  'tux', 'adiumy', 'nolok', 'wilber', 'xue', 'hexley', 'gavroche', 'emule', 'kiki', 'beastie',
  'amanda', 'suzanne', 'gnu', 'konqi', 'sara_the_racer', 'sara_the_wizard', 'puffy', 'pidgin'
];
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'white', 'black'];
const GLO_EFFECTS = ['solid', 'pulse', 'strobe', 'rainbow', 'two-color', 'chase'];
const GLO_COLORS = ['#ff0080', '#00e5ff', '#00ff44', '#ffee00', '#9933ff', '#ff4400', '#ffffff'];

const SCENARIOS = [
  { clients: 8, battleType: 'deathmatch' },
  { clients: 10, battleType: 'deathmatch' },
  { clients: 8, battleType: 'ctf' },
  { clients: 10, battleType: 'ctf' },
];

function dist(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function waitLobbyReady(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 120000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 120000 });
}

async function applyCustomization(page, index) {
  const kartId = KARTS[index % KARTS.length];
  const carColor = COLORS[index % COLORS.length];
  const gloEffect = GLO_EFFECTS[index % GLO_EFFECTS.length];
  const gloColor = GLO_COLORS[index % GLO_COLORS.length];
  const gloColor2 = GLO_COLORS[(index + 2) % GLO_COLORS.length];

  await page.evaluate(({ kartId, carColor, gloEffect, gloColor, gloColor2 }) => {
    sessionStorage.setItem('selectedKart', kartId);
    sessionStorage.setItem('carColor', carColor);
    sessionStorage.setItem('gloEffect', gloEffect);
    sessionStorage.setItem('gloColor', gloColor);
    sessionStorage.setItem('gloColor2', gloColor2);
  }, { kartId, carColor, gloEffect, gloColor, gloColor2 });

  return { kartId, carColor, gloEffect, gloColor, gloColor2 };
}

async function getBattleMetrics(page) {
  return page.evaluate(() => {
    const ms = window.multiplayerState;
    const cars = ms?.opponentCars ? Object.values(ms.opponentCars) : [];
    const visible = cars.filter((c) => c?.model?.visible).length;
    return {
      hasMultiplayer: !!ms,
      peerId: ms?.peer?.id || null,
      connections: Array.isArray(ms?.playerConnections) ? ms.playerConnections.length : 0,
      opponentCount: cars.length,
      visibleOpponents: visible,
      url: location.href,
      selectedKart: sessionStorage.getItem('selectedKart') || null,
      carColor: sessionStorage.getItem('carColor') || null,
      gloEffect: sessionStorage.getItem('gloEffect') || null,
      gloColor: sessionStorage.getItem('gloColor') || null,
      gloColor2: sessionStorage.getItem('gloColor2') || null,
    };
  });
}

async function getOpponentState(page, playerId) {
  return page.evaluate((id) => {
    const opp = window.multiplayerState?.opponentCars?.[id];
    if (!opp?.model) return null;
    const p = opp.model.position;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      visible: !!opp.model.visible,
      lastUpdate: Number(opp.lastUpdate || 0),
    };
  }, playerId);
}

async function measurePacketRate(page, hostId, durationMs = 5000) {
  return page.evaluate(async ({ hostId, durationMs }) => {
    const sampleMs = 50;
    const end = Date.now() + durationMs;
    let last = window.multiplayerState?.opponentCars?.[hostId]?.lastUpdate || 0;
    let changes = 0;

    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, sampleMs));
      const current = window.multiplayerState?.opponentCars?.[hostId]?.lastUpdate || 0;
      if (current && current !== last) {
        changes += 1;
        last = current;
      }
    }

    const perSec = changes / (durationMs / 1000);
    return { changes, perSec };
  }, { hostId, durationMs });
}

async function runScenario(browser, scenario) {
  const { clients: clientCount, battleType } = scenario;

  const group = [];
  for (let i = 0; i < clientCount; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    group.push({ context, page, name: i === 0 ? 'Host' : `Guest${i}`, logs });
  }

  const host = group[0];
  const guests = group.slice(1);

  const report = {
    clientCount,
    battleType,
    created: false,
    joinedGuests: 0,
    transitioned: 0,
    perClient: {},
    movementLatencyMsByGuest: {},
    hostMovementDeltaByGuest: {},
    packetRateByGuest: {},
    criticalErrors: {},
  };
  let stage = 'init';

  try {
    stage = 'lobby-ready';
    await Promise.all(group.map((c) => waitLobbyReady(c.page)));

    stage = 'apply-customization';
    for (let i = 0; i < group.length; i++) {
      const custom = await applyCustomization(group[i].page, i);
      await group[i].page.fill('#player-name-input', `${group[i].name}_${battleType}_${i}`);
      group[i].custom = custom;
    }

    stage = 'host-create-party';
    await host.page.click('#create-party-btn', { force: true });
    await host.page.waitForFunction(() => {
      const info = document.querySelector('#host-info');
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      return info && !info.classList.contains('hidden') && code && code !== 'XXXXXX';
    }, { timeout: 120000 });
    report.created = true;

    const code = (await host.page.locator('#party-code').textContent())?.trim();
    if (!code) throw new Error('No party code generated');

    stage = 'guests-join';
    for (const guest of guests) {
      await guest.page.fill('#join-code-input', code);
      await guest.page.click('#join-party-btn', { force: true });
      await guest.page.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 120000 });
      report.joinedGuests += 1;
      await host.page.waitForTimeout(150);
    }

    stage = 'host-sees-all-guests';
    await host.page.waitForFunction((n) => document.querySelectorAll('#player-list li').length >= n, clientCount, { timeout: 70000 });

    stage = 'battle-ready-up';
    await host.page.click('.mode-btn[data-mode="battle"]', { force: true });
    await host.page.selectOption('#battle-type-select', battleType);
    await host.page.dispatchEvent('#battle-type-select', 'change');

    await Promise.all(guests.map((g) => g.page.waitForFunction(() => document.querySelector('.mode-btn[data-mode="battle"]')?.classList.contains('active'), { timeout: 60000 })));

    await host.page.click('#play-btn', { force: true });
    for (const guest of guests) {
      await guest.page.click('#play-btn', { force: true });
    }

    await host.page.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden') && !btn.disabled;
    }, { timeout: 90000 });

    stage = 'battle-transition';
    await host.page.click('#battle-start-btn', { force: true });

    await Promise.all(group.map((c) => c.page.waitForURL(/battle\.html|realtime\.html/, { timeout: 120000 })));
    report.transitioned = group.length;

    await Promise.all(group.map((c) => c.page.waitForTimeout(9000)));

    stage = 'collect-metrics';
    for (const client of group) {
      report.perClient[client.name] = await getBattleMetrics(client.page);
      report.criticalErrors[client.name] = client.logs.filter((l) => /Could not connect to peer|unavailable-id|Peer disconnected|Failed to connect|Error connecting to host/i.test(l));
    }

    stage = 'movement-propagation';
    const hostId = await host.page.evaluate(() => sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId'));
    if (!hostId) throw new Error('Missing host id in battle');

    const before = {};
    for (const guest of guests) {
      before[guest.name] = await getOpponentState(guest.page, hostId);
    }

    const t0 = Date.now();
    await host.page.mouse.click(320, 320);
    await host.page.keyboard.down('w');
    await host.page.keyboard.down('a');
    await host.page.waitForTimeout(1500);
    await host.page.keyboard.up('a');
    await host.page.keyboard.up('w');

    for (const guest of guests) {
      let latencyMs = null;
      const beforeState = before[guest.name];
      const deadline = Date.now() + 5000;

      while (Date.now() < deadline) {
        const now = await getOpponentState(guest.page, hostId);
        if (now && beforeState && now.lastUpdate !== beforeState.lastUpdate) {
          latencyMs = Date.now() - t0;
          break;
        }
        await guest.page.waitForTimeout(50);
      }

      report.movementLatencyMsByGuest[guest.name] = latencyMs;
    }

    await Promise.all(guests.map((g) => g.page.waitForTimeout(1200)));

    for (const guest of guests) {
      const after = await getOpponentState(guest.page, hostId);
      report.hostMovementDeltaByGuest[guest.name] = {
        delta: dist(before[guest.name], after),
        moved: dist(before[guest.name], after) > 0.2,
      };
    }

    stage = 'packet-rate-sampling';
    for (const guest of guests) {
      report.packetRateByGuest[guest.name] = await measurePacketRate(guest.page, hostId, 5000);
    }

    const expectedOpponents = clientCount - 1;
    const visibilityOk = Object.values(report.perClient).every((m) => m.visibleOpponents >= Math.max(1, expectedOpponents - 1));
    const noCriticalPeerErrors = Object.values(report.criticalErrors).every((errs) => errs.length === 0);
    const movementOk = Object.values(report.hostMovementDeltaByGuest).every((m) => m.moved);
    const latencyOk = Object.values(report.movementLatencyMsByGuest).every((ms) => typeof ms === 'number' && ms <= 3000);

    const ok = report.created
      && report.joinedGuests === clientCount - 1
      && report.transitioned === clientCount
      && visibilityOk
      && noCriticalPeerErrors
      && movementOk
      && latencyOk;

    return { ok, report };
  } catch (error) {
    report.errorStage = stage;
    report.error = String(error?.message || error);
    return { ok: false, report };
  } finally {
    await Promise.all(group.map((c) => c.context.close().catch(() => {})));
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const allResults = [];

  try {
    for (const scenario of SCENARIOS) {
      const result = await runScenario(browser, scenario);
      allResults.push(result);
      console.log('STRESS_SCENARIO_RESULT', JSON.stringify(result, null, 2));
    }

    const allOk = allResults.every((r) => r.ok);
    const summary = allResults.map((r) => {
      const latencies = Object.values(r.report.movementLatencyMsByGuest).filter((v) => typeof v === 'number');
      const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

      const rates = Object.values(r.report.packetRateByGuest).map((v) => v?.perSec).filter((v) => typeof v === 'number');
      const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

      return {
        clients: r.report.clientCount,
        battleType: r.report.battleType,
        ok: r.ok,
        joinedGuests: r.report.joinedGuests,
        transitioned: r.report.transitioned,
        avgMovementLatencyMs: avgLatency,
        avgPacketRatePerSec: avgRate,
      };
    });

    console.log('STRESS_MATRIX_SUMMARY', JSON.stringify({ ok: allOk, summary }, null, 2));
    process.exitCode = allOk ? 0 : 1;
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('STRESS_MATRIX_SUMMARY', JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
