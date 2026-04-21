import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeFill(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 20000 });
  await page.fill(selector, value);
}

/**
 * Navigate to the lobby page and wait for mode cards to render.
 * Optionally set a player name.
 */
async function openLobby(page, playerName) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mode-cards', { timeout: 30000 });
  if (playerName) {
    await safeFill(page, '#player-name-input', playerName);
  }
}

async function chooseKart(page, clicks = 1) {
  await page.waitForSelector('#kart-next-btn', { timeout: 20000 });
  for (let i = 0; i < clicks; i += 1) {
    await page.click('#kart-next-btn', { force: true });
    await wait(120);
  }
}

async function setGlo(page, effect = 'rainbow', color1 = '#11ff88', color2 = '#8844ff') {
  await page.evaluate(({ fx, c1, c2 }) => {
    sessionStorage.setItem('gloEffect', fx);
    sessionStorage.setItem('gloColor', c1);
    sessionStorage.setItem('gloColor2', c2);
  }, { fx: effect, c1: color1, c2: color2 });
}

/**
 * Select a mode by clicking the corresponding mode-card.
 * The only visible mode is `battle_online`; hidden modes can be force-injected via evaluate.
 */
async function selectMode(page, modeId) {
  const clicked = await page.evaluate((id) => {
    const card = document.querySelector(`.mode-card[data-mode-id="${id}"]`);
    if (card) { card.click(); return true; }
    return false;
  }, modeId);
  if (!clicked) throw new Error(`Mode card [data-mode-id="${modeId}"] not found`);
  await wait(200);
}

/**
 * Set battle-specific settings via hidden form fields + dispatching change events.
 */
async function setBattleSettings(page, { battleType, scoreLimit }) {
  await page.evaluate(({ bt, sl }) => {
    const btEl = document.getElementById('battle-type-select');
    if (btEl && bt) { btEl.value = bt; btEl.dispatchEvent(new Event('change')); }
    const slEl = document.getElementById('battle-score-limit');
    if (slEl && sl != null) { slEl.value = String(sl); slEl.dispatchEvent(new Event('change')); }
  }, { bt: battleType, sl: scoreLimit });
}

/**
 * Click #play-btn to create a lobby (host flow).
 * Waits until #host-info is visible and a lobby code is displayed.
 * Returns the lobby code string.
 */
async function createLobbyViaPlayBtn(host) {
  await host.waitForSelector('#play-btn:not([disabled])', { timeout: 10000 });
  await host.click('#play-btn', { force: true });

  await host.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    const hostInfoVisible = !document.querySelector('#host-info')?.classList.contains('hidden');
    return hostInfoVisible && code && code.length >= 3 && code !== 'XXXXXX' && code !== '------';
  }, { timeout: 30000 });

  return (await host.locator('#party-code').textContent())?.trim();
}

/**
 * Join an existing lobby using a lobby code.
 */
async function joinLobbyByCode(guest, code) {
  await safeFill(guest, '#join-code-input', code);
  await guest.click('#join-party-btn', { force: true });
  // Wait until at least one player appears in the list (indicating successful join)
  await guest.waitForFunction(() => {
    const list = document.querySelectorAll('#player-list li');
    return list.length >= 1;
  }, { timeout: 30000 });
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

/**
 * Scenario 1: Private battle lobby — host creates, guest joins, host starts.
 * Verifies gameConfig fields including scoreLimit propagation.
 */
async function runPrivateBattleFlow(browser) {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await openLobby(host, 'HostBattleUX');
    await openLobby(guest, 'GuestBattleUX');

    await chooseKart(host, 3);
    await setGlo(host, 'strobe', '#ff0088', '#22e5ff');

    await chooseKart(guest, 1);
    await setGlo(guest, 'two-color', '#00ff55', '#0044ff');

    // Select battle_online mode and configure settings
    await selectMode(host, 'battle_online');
    await setBattleSettings(host, { battleType: 'deathmatch', scoreLimit: 7 });

    // Host creates lobby via Play button
    const code = await createLobbyViaPlayBtn(host);
    assert(code && code.length >= 3, 'Lobby code not generated');

    // Guest joins
    await joinLobbyByCode(guest, code);
    await Promise.all([waitForTwoPlayers(host), waitForTwoPlayers(guest)]);

    // Guest readies up
    await guest.waitForSelector('#ready-btn:not(.hidden)', { timeout: 10000 });
    await guest.click('#ready-btn', { force: true });
    await wait(500);

    // Host starts match
    await host.waitForSelector('#start-match-btn:not(.hidden)', { timeout: 10000 });
    await host.click('#start-match-btn', { force: true });

    await Promise.all([waitForRealtime(host), waitForRealtime(guest)]);

    const hostConfig = await readGameConfig(host);
    const guestConfig = await readGameConfig(guest);

    assert(hostConfig?.gameMode === 'battle', 'Host battle gameMode mismatch');
    assert(hostConfig?.multiplayerProvider === 'colyseus', 'Host battle provider mismatch');
    assert(Array.isArray(hostConfig?.players) && hostConfig.players.length >= 2, 'Host battle players missing');
    assert(hostConfig?.scoreLimit === 7, `Host scoreLimit expected 7, got ${hostConfig?.scoreLimit}`);

    assert(guestConfig?.gameMode === 'battle', 'Guest battle gameMode mismatch');
    assert(Array.isArray(guestConfig?.players) && guestConfig.players.length >= 2, 'Guest battle players missing');
    assert(guestConfig?.scoreLimit === 7, `Guest scoreLimit expected 7, got ${guestConfig?.scoreLimit}`);

    // Verify glo fields propagated in player objects
    const hostPlayer = hostConfig.players.find((p) => p.name === 'HostBattleUX');
    assert(hostPlayer?.gloEffect === 'strobe', `Host gloEffect expected strobe, got ${hostPlayer?.gloEffect}`);

    return { ok: true, code, hostUrl: host.url(), guestUrl: guest.url() };
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
}

/**
 * Scenario 2: Solo host clicks play → creates lobby → alone in game.
 * Ensures a single player can proceed without a guest.
 */
async function runSoloHostFlow(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await openLobby(page, 'SoloHost');
    await chooseKart(page, 1);
    await setGlo(page, 'rainbow', '#00ffaa', '#6633ff');

    await selectMode(page, 'battle_online');

    const code = await createLobbyViaPlayBtn(page);
    assert(code && code.length >= 3, 'Solo lobby code not generated');

    // Host is alone — start match immediately (server auto-readies host)
    await page.waitForSelector('#start-match-btn:not(.hidden)', { timeout: 10000 });
    await page.click('#start-match-btn', { force: true });

    await waitForRealtime(page);

    const config = await readGameConfig(page);
    assert(config?.gameMode === 'battle', 'Solo host gameMode mismatch');
    assert(config?.multiplayerProvider === 'colyseus', 'Solo host provider mismatch');
    assert(config?.lobbyCode === code, 'Solo host lobbyCode mismatch');

    return { ok: true, code, url: page.url() };
  } finally {
    await ctx.close();
  }
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const summary = { ok: true, scenarios: [] };

  try {
    summary.scenarios.push({ label: 'private_battle', ...(await runPrivateBattleFlow(browser)) });
    summary.scenarios.push({ label: 'solo_host', ...(await runSoloHostFlow(browser)) });

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
