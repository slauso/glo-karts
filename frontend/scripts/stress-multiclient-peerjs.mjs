import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const requested = Number(process.argv[2] || 6);
const CLIENT_COUNT = Math.max(4, Math.min(6, Number.isFinite(requested) ? requested : 6));

function dist(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function waitLobbyReady(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 45000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 45000 });
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
    };
  });
}

async function getOpponentPositionById(page, playerId) {
  return page.evaluate((id) => {
    const ms = window.multiplayerState;
    const opp = ms?.opponentCars?.[id];
    const pos = opp?.model?.position;
    if (!pos) return null;
    return { x: pos.x, y: pos.y, z: pos.z, visible: !!opp?.model?.visible };
  }, playerId);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const clients = [];

  for (let i = 0; i < CLIENT_COUNT; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
    page.on('dialog', (d) => d.accept().catch(() => {}));
    clients.push({ context, page, name: i === 0 ? 'Host' : `Guest${i}`, logs });
  }

  const host = clients[0];
  const guests = clients.slice(1);
  const report = {
    clientCount: CLIENT_COUNT,
    created: false,
    joinedGuests: 0,
    transitioned: 0,
    perClient: {},
    hostToGuestMovement: {},
    criticalErrors: {},
  };

  try {
    await Promise.all(clients.map((c) => waitLobbyReady(c.page)));

    for (let i = 0; i < clients.length; i++) {
      await clients[i].page.fill('#player-name-input', `${clients[i].name}_stress`);
    }

    await host.page.click('#create-party-btn', { force: true });
    await host.page.waitForFunction(() => {
      const info = document.querySelector('#host-info');
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      return info && !info.classList.contains('hidden') && code && code !== 'XXXXXX';
    }, { timeout: 60000 });
    report.created = true;

    const code = (await host.page.locator('#party-code').textContent())?.trim();
    if (!code) throw new Error('No party code generated');

    for (const guest of guests) {
      await guest.page.fill('#join-code-input', code);
      await guest.page.click('#join-party-btn', { force: true });
      await guest.page.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 60000 });
      report.joinedGuests += 1;
      await host.page.waitForTimeout(250);
    }

    await host.page.waitForFunction((n) => document.querySelectorAll('#player-list li').length >= n, CLIENT_COUNT, { timeout: 60000 });

    await host.page.click('.mode-btn[data-mode="battle"]', { force: true });
    await Promise.all(guests.map((g) => g.page.waitForFunction(() => document.querySelector('.mode-btn[data-mode="battle"]')?.classList.contains('active'), { timeout: 20000 })));

    await host.page.click('#play-btn', { force: true });
    for (const guest of guests) {
      await guest.page.click('#play-btn', { force: true });
    }

    await host.page.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden') && !btn.disabled;
    }, { timeout: 35000 });

    await host.page.click('#battle-start-btn', { force: true });

    await Promise.all(clients.map((c) => c.page.waitForURL(/battle\.html|realtime\.html/, { timeout: 60000 })));
    report.transitioned = clients.length;

    await Promise.all(clients.map((c) => c.page.waitForTimeout(9000)));

    for (const client of clients) {
      report.perClient[client.name] = await getBattleMetrics(client.page);
      report.criticalErrors[client.name] = client.logs.filter((l) => /Could not connect to peer|unavailable-id|Peer disconnected|Error connecting to host/i.test(l));
    }

    const hostId = await host.page.evaluate(() => sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId'));
    if (!hostId) throw new Error('Host player ID missing in battle phase');

    const before = {};
    for (const guest of guests) {
      before[guest.name] = await getOpponentPositionById(guest.page, hostId);
    }

    await host.page.mouse.click(320, 320);
    await host.page.keyboard.down('w');
    await host.page.keyboard.down('a');
    await host.page.waitForTimeout(1600);
    await host.page.keyboard.up('a');
    await host.page.keyboard.up('w');
    await host.page.waitForTimeout(1500);

    for (const guest of guests) {
      const after = await getOpponentPositionById(guest.page, hostId);
      const delta = dist(before[guest.name], after);
      report.hostToGuestMovement[guest.name] = {
        before: before[guest.name],
        after,
        delta,
        moved: delta > 0.2,
      };
    }

    const clientsHaveOpponents = Object.values(report.perClient).every((m) => m.hasMultiplayer && m.visibleOpponents >= Math.max(1, CLIENT_COUNT - 2));
    const noCriticalPeerErrors = Object.values(report.criticalErrors).every((errs) => errs.length === 0);
    const movementSeenByAllGuests = Object.values(report.hostToGuestMovement).every((m) => m.moved);

    const ok = report.created
      && report.joinedGuests === CLIENT_COUNT - 1
      && report.transitioned === CLIENT_COUNT
      && clientsHaveOpponents
      && noCriticalPeerErrors
      && movementSeenByAllGuests;

    console.log('STRESS_MULTI_CLIENT', JSON.stringify({ ok, report }, null, 2));
    process.exitCode = ok ? 0 : 1;
  } finally {
    await Promise.all(clients.map((c) => c.context.close().catch(() => {})));
    await browser.close();
  }
}

run().catch((e) => {
  console.error('STRESS_MULTI_CLIENT', JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
