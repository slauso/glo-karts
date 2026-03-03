import { chromium } from 'playwright';

const BASE_URL = 'http://localhost:5173';

async function waitLobby(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 30000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 30000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const hostLogs = [];
  const guestLogs = [];
  host.on('console', (m) => hostLogs.push(`${m.type()}: ${m.text()}`));
  guest.on('console', (m) => guestLogs.push(`${m.type()}: ${m.text()}`));
  host.on('dialog', (d) => d.accept().catch(() => {}));
  guest.on('dialog', (d) => d.accept().catch(() => {}));

  try {
    await Promise.all([waitLobby(host), waitLobby(guest)]);

    await host.fill('#player-name-input', 'HostVis');
    await guest.fill('#player-name-input', 'GuestVis');

    await host.click('#create-party-btn');
    await host.waitForSelector('#host-info:not(.hidden)', { timeout: 45000 });
    const code = (await host.locator('#party-code').textContent())?.trim();
    if (!code) throw new Error('No party code');

    await guest.fill('#join-code-input', code);
    await guest.click('#join-party-btn');
    await guest.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 30000 });

    await host.click('.mode-btn[data-mode="battle"]');
    await host.click('#play-btn');
    await guest.click('#play-btn');

    await host.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden') && !btn.disabled;
    }, { timeout: 20000 });

    await host.click('#battle-start-btn');

    await Promise.all([
      host.waitForURL(/battle\.html|realtime\.html/, { timeout: 35000 }),
      guest.waitForURL(/battle\.html|realtime\.html/, { timeout: 35000 }),
    ]);

    await host.waitForTimeout(6000);
    await guest.waitForTimeout(6000);

    const hostState = await host.evaluate(() => {
      const ms = window.multiplayerState;
      const cars = ms?.opponentCars ? Object.values(ms.opponentCars) : [];
      return {
        hasMs: !!ms,
        opponentCount: cars.length,
        visibleCount: cars.filter(c => c?.model?.visible).length,
      };
    });

    const guestState = await guest.evaluate(() => {
      const ms = window.multiplayerState;
      const cars = ms?.opponentCars ? Object.values(ms.opponentCars) : [];
      return {
        hasMs: !!ms,
        opponentCount: cars.length,
        visibleCount: cars.filter(c => c?.model?.visible).length,
      };
    });

    const badHostErrors = hostLogs.filter((l) => /Could not connect to peer|unavailable-id|Peer disconnected/i.test(l));
    const badGuestErrors = guestLogs.filter((l) => /Could not connect to peer|unavailable-id|Peer disconnected/i.test(l));

    const ok = hostState.visibleCount > 0 && guestState.visibleCount > 0 && badHostErrors.length === 0 && badGuestErrors.length === 0;

    console.log('VIS_SMOKE', JSON.stringify({
      ok,
      hostUrl: host.url(),
      guestUrl: guest.url(),
      hostState,
      guestState,
      hostErrors: badHostErrors,
      guestErrors: badGuestErrors,
    }, null, 2));

    if (!ok) process.exitCode = 1;
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await browser.close();
  }
}

run().catch((e) => {
  console.error('VIS_SMOKE', JSON.stringify({ ok: false, error: String(e?.message || e) }, null, 2));
  process.exit(1);
});
