import { chromium } from 'playwright';

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:5174';

function isBattlePhaseUrl(url) {
  return /\/battle\.html|\/realtime\.html/.test(url);
}

async function waitLobbyReady(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 20000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 20000 });
}

async function clickBattleMode(hostPage) {
  const battleBtn = hostPage.locator('.mode-btn[data-mode="battle"]');
  await battleBtn.click();
  await hostPage.waitForFunction(() => {
    const panel = document.querySelector('#battle-settings');
    return !!panel && !panel.classList.contains('hidden');
  }, { timeout: 10000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();

  hostPage.on('dialog', (d) => d.accept().catch(() => {}));
  guestPage.on('dialog', (d) => d.accept().catch(() => {}));

  const checkpoints = {
    hostReadyClicked: false,
    guestReadyClicked: false,
    startBattleVisible: false,
    startBattleEnabled: false,
    hostTransitioned: false,
    guestTransitioned: false,
    hostUrl: null,
    guestUrl: null,
  };

  try {
    await Promise.all([waitLobbyReady(hostPage), waitLobbyReady(guestPage)]);

    await hostPage.fill('#player-name-input', 'HostSmoke');
    await guestPage.fill('#player-name-input', 'GuestSmoke');

    await hostPage.click('#create-party-btn');
    await hostPage.waitForSelector('#host-info:not(.hidden)', { timeout: 45000 });
    await hostPage.waitForFunction(() => {
      const code = document.querySelector('#party-code')?.textContent?.trim();
      return !!code && code !== 'XXXXXX';
    }, { timeout: 45000 });

    const partyCode = (await hostPage.locator('#party-code').textContent())?.trim();
    if (!partyCode) throw new Error('Party code not generated');

    await guestPage.fill('#join-code-input', partyCode);
    await guestPage.click('#join-party-btn');
    await guestPage.waitForFunction(() => {
      return document.querySelector('.join-section')?.classList.contains('hidden');
    }, { timeout: 20000 });

    await hostPage.waitForFunction(() => {
      const items = document.querySelectorAll('#player-list li');
      return items.length >= 2;
    }, { timeout: 20000 });

    await clickBattleMode(hostPage);

    await hostPage.click('#play-btn');
    checkpoints.hostReadyClicked = true;

    await guestPage.waitForFunction(() => {
      return document.querySelector('.mode-btn[data-mode="battle"]')?.classList.contains('active');
    }, { timeout: 10000 });

    await guestPage.click('#play-btn');
    checkpoints.guestReadyClicked = true;

    await hostPage.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.classList.contains('hidden');
    }, { timeout: 15000 });
    checkpoints.startBattleVisible = true;

    await hostPage.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return !!btn && !btn.disabled;
    }, { timeout: 15000 });
    checkpoints.startBattleEnabled = true;

    await hostPage.click('#battle-start-btn');

    await Promise.all([
      hostPage.waitForURL((url) => isBattlePhaseUrl(url.toString()), { timeout: 25000 }),
      guestPage.waitForURL((url) => isBattlePhaseUrl(url.toString()), { timeout: 25000 }),
    ]);

    checkpoints.hostUrl = hostPage.url();
    checkpoints.guestUrl = guestPage.url();
    checkpoints.hostTransitioned = isBattlePhaseUrl(checkpoints.hostUrl);
    checkpoints.guestTransitioned = isBattlePhaseUrl(checkpoints.guestUrl);

    console.log('SMOKE_RESULT', JSON.stringify({ ok: true, partyCode, checkpoints }, null, 2));
  } catch (error) {
    checkpoints.hostUrl = hostPage.url();
    checkpoints.guestUrl = guestPage.url();
    console.error('SMOKE_RESULT', JSON.stringify({ ok: false, error: String(error?.message || error), checkpoints }, null, 2));
    process.exitCode = 1;
  } finally {
    await hostContext.close();
    await guestContext.close();
    await browser.close();
  }
}

run();
