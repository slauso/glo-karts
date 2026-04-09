import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeFill(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.fill(selector, value);
}

async function openLobby(page, playerName) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#create-party-btn', { timeout: 30000 });
  await safeFill(page, '#player-name-input', playerName);
}

async function chooseKart(page, clicks = 1) {
  await page.waitForSelector('#kart-next-btn', { timeout: 20000 });
  for (let i = 0; i < clicks; i += 1) {
    await page.click('#kart-next-btn', { force: true });
    await wait(120);
  }
}

async function chooseColor(page, colorName) {
  await page.evaluate((color) => {
    sessionStorage.setItem('carColor', color);
  }, colorName);
}

async function setGlo(page, effect = 'rainbow', color1 = '#11ff88', color2 = '#8844ff') {
  await page.evaluate(({ fx, c1, c2 }) => {
    sessionStorage.setItem('gloEffect', fx);
    sessionStorage.setItem('gloColor', c1);
    sessionStorage.setItem('gloColor2', c2);
  }, { fx: effect, c1: color1, c2: color2 });
}

async function setMode(page, mode) {
  await page.click(`.mode-btn[data-mode="${mode}"]`, { force: true });
}

async function selectTrack(page, trackId) {
  await page.click('.dropdown-button', { force: true });
  await page.click(`.dropdown-option[data-map-id="${trackId}"]`, { force: true });
}

async function selectBattleSettings(page, { arenaId, battleType }) {
  await page.selectOption('#battle-arena-select', arenaId);
  await page.selectOption('#battle-type-select', battleType);
}

async function createPrivateLobby(host) {
  await host.selectOption('#lobby-privacy-select', 'private');
  await host.click('#create-party-btn', { force: true });
  await host.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    const hostInfoVisible = !document.querySelector('#host-info')?.classList.contains('hidden');
    return hostInfoVisible && code && code !== 'XXXXXX' && code !== '------';
  }, { timeout: 30000 });
  return (await host.locator('#party-code').textContent())?.trim();
}

async function joinLobbyByCode(guest, code) {
  await safeFill(guest, '#join-code-input', code);
  await guest.click('#join-party-btn', { force: true });
  await guest.waitForFunction(() => document.querySelector('.join-section')?.classList.contains('hidden'), { timeout: 30000 });
}

async function waitForTwoPlayers(page) {
  await page.waitForFunction(() => {
    const list = document.querySelectorAll('#player-list li');
    return list.length >= 2;
  }, { timeout: 30000 });
}

async function waitForRealtime(page) {
  await page.waitForURL(/realtime\.html/, { timeout: 45000 });
}

async function readGameConfig(page) {
  return page.evaluate(() => {
    const raw = sessionStorage.getItem('gameConfig');
    return raw ? JSON.parse(raw) : null;
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runPrivateRaceFlow(browser) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await openLobby(host, 'HostRaceUX');
    await openLobby(guest, 'GuestRaceUX');

    await chooseKart(host, 2);
    await chooseColor(host, 'blue');
    await setGlo(host, 'rainbow', '#00ffaa', '#6633ff');

    await chooseKart(guest, 4);
    await chooseColor(guest, 'green');
    await setGlo(guest, 'pulse', '#ff8844', '#44bbff');

    await setMode(host, 'race');
    await selectTrack(host, 'hacienda');

    const code = await createPrivateLobby(host);
    await joinLobbyByCode(guest, code);

    await Promise.all([waitForTwoPlayers(host), waitForTwoPlayers(guest)]);

    await host.click('#play-btn', { force: true });

    await Promise.all([waitForRealtime(host), waitForRealtime(guest)]);

    const hostConfig = await readGameConfig(host);
    const guestConfig = await readGameConfig(guest);

    assert(hostConfig?.gameMode === 'race', 'Host race gameMode mismatch');
    assert(hostConfig?.trackId === 'hacienda', 'Host race track mismatch');
    assert(Array.isArray(hostConfig?.players) && hostConfig.players.length >= 2, 'Host race players missing');
    assert(hostConfig?.multiplayerProvider === 'colyseus', 'Host race provider mismatch');

    assert(guestConfig?.gameMode === 'race', 'Guest race gameMode mismatch');
    assert(guestConfig?.trackId === 'hacienda', 'Guest race track mismatch');
    assert(Array.isArray(guestConfig?.players) && guestConfig.players.length >= 2, 'Guest race players missing');

    return { ok: true, code, hostUrl: host.url(), guestUrl: guest.url() };
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
}

async function runPrivateBattleFlow(browser) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await openLobby(host, 'HostBattleUX');
    await openLobby(guest, 'GuestBattleUX');

    await chooseKart(host, 3);
    await chooseColor(host, 'purple');
    await setGlo(host, 'strobe', '#ff0088', '#22e5ff');

    await chooseKart(guest, 1);
    await chooseColor(guest, 'yellow');
    await setGlo(guest, 'two-color', '#00ff55', '#0044ff');

    await setMode(host, 'battle');
    await selectBattleSettings(host, { arenaId: 'cave', battleType: 'ctf' });

    const code = await createPrivateLobby(host);
    await joinLobbyByCode(guest, code);

    await Promise.all([waitForTwoPlayers(host), waitForTwoPlayers(guest)]);

    await host.click('#play-btn', { force: true });
    await guest.click('#play-btn', { force: true });

    await host.waitForFunction(() => {
      const btn = document.querySelector('#battle-start-btn');
      return btn && !btn.classList.contains('hidden') && !btn.disabled;
    }, { timeout: 30000 });

    await host.click('#battle-start-btn', { force: true });

    await Promise.all([waitForRealtime(host), waitForRealtime(guest)]);

    const hostConfig = await readGameConfig(host);
    const guestConfig = await readGameConfig(guest);

    assert(hostConfig?.gameMode === 'battle', 'Host battle gameMode mismatch');
    assert(hostConfig?.arenaId === 'cave', 'Host battle arena mismatch');
    assert(hostConfig?.battleType === 'ctf', 'Host battle type mismatch');
    assert(hostConfig?.multiplayerProvider === 'colyseus', 'Host battle provider mismatch');

    assert(guestConfig?.gameMode === 'battle', 'Guest battle gameMode mismatch');
    assert(guestConfig?.arenaId === 'cave', 'Guest battle arena mismatch');
    assert(guestConfig?.battleType === 'ctf', 'Guest battle type mismatch');

    return { ok: true, code, hostUrl: host.url(), guestUrl: guest.url() };
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
}

async function runOpenQuickMatchFlow(browser) {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await openLobby(pageA, 'OpenAUX');
    await openLobby(pageB, 'OpenBUX');

    await setMode(pageA, 'race');
    await setMode(pageB, 'race');

    await pageA.click('#quick-match-btn', { force: true });
    await pageB.click('#quick-match-btn', { force: true });

    await Promise.all([waitForTwoPlayers(pageA), waitForTwoPlayers(pageB)]);

    const hostPage = await pageA.evaluate(() => {
      return (document.querySelector('#play-btn')?.textContent || '').toUpperCase().includes('START RACE');
    }) ? pageA : pageB;

    await hostPage.click('#play-btn', { force: true });

    await Promise.all([waitForRealtime(pageA), waitForRealtime(pageB)]);

    const configA = await readGameConfig(pageA);
    const configB = await readGameConfig(pageB);

    assert(configA?.gameMode === 'race', 'Open flow A mode mismatch');
    assert(configB?.gameMode === 'race', 'Open flow B mode mismatch');
    assert(Array.isArray(configA?.players) && configA.players.length >= 2, 'Open flow A players missing');
    assert(Array.isArray(configB?.players) && configB.players.length >= 2, 'Open flow B players missing');

    return { ok: true, urlA: pageA.url(), urlB: pageB.url(), lobbyCodeA: configA?.lobbyCode, lobbyCodeB: configB?.lobbyCode };
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const summary = { ok: true, scenarios: [] };

  try {
    summary.scenarios.push({ label: 'private_race', ...(await runPrivateRaceFlow(browser)) });
    summary.scenarios.push({ label: 'private_battle', ...(await runPrivateBattleFlow(browser)) });
    summary.scenarios.push({ label: 'open_quick_match', ...(await runOpenQuickMatchFlow(browser)) });

    console.log('LOBBY_UX_REGRESSION', JSON.stringify(summary, null, 2));
  } catch (error) {
    summary.ok = false;
    summary.error = String(error?.message || error);
    console.error('LOBBY_UX_REGRESSION', JSON.stringify(summary, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error('LOBBY_UX_REGRESSION', JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
});
