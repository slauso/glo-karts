import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';

function distance(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function waitLobbyReady(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 30000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 30000 });
}

async function waitOpponentVisible(page) {
  await page.waitForFunction(() => {
    const ms = window.multiplayerState;
    if (!ms || !ms.opponentCars) return false;
    const cars = Object.values(ms.opponentCars);
    return cars.some((car) => car?.model?.visible);
  }, { timeout: 30000 });
}

async function getOpponentSnapshot(page) {
  return page.evaluate(() => {
    const ms = window.multiplayerState;
    if (!ms || !ms.opponentCars) return { visible: 0, first: null };
    const cars = Object.values(ms.opponentCars);
    const visibleCars = cars.filter((c) => c?.model?.visible);
    const first = visibleCars[0]?.model?.position
      ? {
          x: visibleCars[0].model.position.x,
          y: visibleCars[0].model.position.y,
          z: visibleCars[0].model.position.z,
        }
      : null;
    return { visible: visibleCars.length, first };
  });
}

async function focusBattleCanvas(page) {
  await page.mouse.click(300, 300);
  await page.waitForTimeout(150);
}

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 40 });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  host.on('dialog', (d) => d.accept().catch(() => {}));
  guest.on('dialog', (d) => d.accept().catch(() => {}));

  const report = {
    created: false,
    joined: false,
    hostReady: false,
    guestReady: false,
    started: false,
    hostUrl: '',
    guestUrl: '',
    hostVisibleOpponents: 0,
    guestVisibleOpponents: 0,
    hostSawGuestMove: false,
    guestSawHostMove: false,
    hostObservedDelta: 0,
    guestObservedDelta: 0,
  };

  try {
    await Promise.all([waitLobbyReady(host), waitLobbyReady(guest)]);

    await host.fill('#player-name-input', 'HostLiveVisual');
    await guest.fill('#player-name-input', 'GuestLiveVisual');

    await host.click('#create-party-btn', { force: true });
    await host.waitForFunction(() => {
      const info = document.querySelector('#host-info');
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      return info && !info.classList.contains('hidden') && code && code !== 'XXXXXX';
    }, { timeout: 45000 });
    report.created = true;

    const code = (await host.locator('#party-code').textContent())?.trim();
    await guest.fill('#join-code-input', code || '');
    await guest.click('#join-party-btn', { force: true });

    await guest.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 45000 });
    report.joined = true;

    await host.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 2, { timeout: 45000 });

    await host.click('.mode-btn[data-mode="battle"]', { force: true });
    await guest.waitForFunction(() => document.querySelector('.mode-btn[data-mode="battle"]')?.classList.contains('active'), { timeout: 15000 });

    await host.click('#play-btn', { force: true });
    report.hostReady = true;

    await guest.click('#play-btn', { force: true });
    report.guestReady = true;

    await host.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden') && !btn.disabled;
    }, { timeout: 25000 });

    await host.click('#battle-start-btn', { force: true });

    await Promise.all([
      host.waitForURL(/battle\.html|realtime\.html/, { timeout: 40000 }),
      guest.waitForURL(/battle\.html|realtime\.html/, { timeout: 40000 }),
    ]);
    report.started = true;
    report.hostUrl = host.url();
    report.guestUrl = guest.url();

    await Promise.all([waitOpponentVisible(host), waitOpponentVisible(guest)]);

    const beforeHost = await getOpponentSnapshot(host);
    const beforeGuest = await getOpponentSnapshot(guest);

    await focusBattleCanvas(host);
    await focusBattleCanvas(guest);

    await host.keyboard.down('w');
    await host.keyboard.down('a');
    await guest.keyboard.down('w');
    await guest.keyboard.down('d');
    await host.waitForTimeout(1400);
    await host.keyboard.up('a');
    await host.keyboard.up('w');
    await guest.keyboard.up('d');
    await guest.keyboard.up('w');

    await host.waitForTimeout(1200);

    const afterHost = await getOpponentSnapshot(host);
    const afterGuest = await getOpponentSnapshot(guest);

    report.hostVisibleOpponents = afterHost.visible;
    report.guestVisibleOpponents = afterGuest.visible;
    report.hostObservedDelta = distance(beforeHost.first, afterHost.first);
    report.guestObservedDelta = distance(beforeGuest.first, afterGuest.first);
    report.hostSawGuestMove = report.hostObservedDelta > 0.15;
    report.guestSawHostMove = report.guestObservedDelta > 0.15;

    const ok = report.created && report.joined && report.hostReady && report.guestReady && report.started
      && report.hostVisibleOpponents > 0 && report.guestVisibleOpponents > 0
      && report.hostSawGuestMove && report.guestSawHostMove;

    console.log('LIVE_KEEP_OPEN_SYNC_CHECK', JSON.stringify({ ok, report }, null, 2));
    console.log('Windows are intentionally left open for visual inspection.');
    console.log('Close this terminal command with Ctrl+C when done.');

    setInterval(async () => {
      try {
        const hostNow = await getOpponentSnapshot(host);
        const guestNow = await getOpponentSnapshot(guest);
        console.log('LIVE_HEARTBEAT', JSON.stringify({
          ts: Date.now(),
          hostVisibleOpponents: hostNow.visible,
          guestVisibleOpponents: guestNow.visible,
          hostUrl: host.url(),
          guestUrl: guest.url(),
        }));
      } catch (e) {
        console.log('LIVE_HEARTBEAT_ERROR', String(e?.message || e));
      }
    }, 15000);

    await new Promise(() => {});
  } catch (e) {
    console.error('LIVE_KEEP_OPEN_SYNC_CHECK', JSON.stringify({ ok: false, error: String(e?.message || e), report }, null, 2));
    console.log('Windows left open for debugging. Stop manually with Ctrl+C.');
    await new Promise(() => {});
  }
}

run();
