import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'online-arena-2p-probe.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const HOST_NAME = 'ArenaHost';
const GUEST_NAME = 'ArenaGuest';

async function setupPage(browser, label, log) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => {
    const line = `[${label}] pageerror: ${err.message}\n${err.stack || ''}`;
    console.error(line);
    log.push(line);
  });
  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error' || t === 'warning' || t === 'log') {
      const line = `[${label}] console.${t}: ${msg.text()}`;
      if (t !== 'warning' || /WebGL/.test(msg.text()) === false) {
        log.push(line);
      }
      if (t === 'error') console.log(line);
    }
  });
  page.on('requestfailed', (req) => {
    const line = `[${label}] requestfailed: ${req.url()} (${req.failure()?.errorText})`;
    console.warn(line);
    log.push(line);
  });
  return page;
}

async function openLobby(page, playerName) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#mode-cards', { timeout: 30000 });
  await page.waitForFunction(() => {
    const input = document.getElementById('player-name-input');
    return input && input.placeholder && !/Loading/i.test(input.placeholder);
  }, null, { timeout: 15000 });
  await page.fill('#player-name-input', playerName);
}

async function selectOnlineArena(page) {
  await page.evaluate(() => {
    document.querySelector('.mode-card[data-mode-id="online_arena"], [data-mode-id="online_arena"]')?.click();
  });
  await page.waitForSelector('#lobby-studio-picker:not(.hidden)', { timeout: 10000 });
  // wait for tiles
  await page.waitForFunction(() => document.querySelectorAll('.lsp-tile').length > 0, null, { timeout: 15000 });
}

async function pickFirstTemplate(page) {
  await page.evaluate(() => {
    const tile = document.querySelector('.lsp-tile');
    tile?.click();
  });
  await wait(500);
}

async function hostLobby(page) {
  await page.evaluate(() => document.getElementById('play-btn').click());
  await page.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    return code && code.length >= 5 && code !== '------';
  }, null, { timeout: 30000 });
  return (await page.locator('#party-code').textContent()).trim();
}

async function joinLobby(page, code) {
  await page.fill('#join-code-input', code);
  await page.click('#join-party-btn', { force: true });
  await page.waitForFunction(() => {
    return !!document.getElementById('host-info') &&
           !document.getElementById('host-info').classList.contains('hidden');
  }, null, { timeout: 30000 });
}

async function waitForPlayers(page, n) {
  await page.waitForFunction((expected) => {
    return document.querySelectorAll('#player-list li').length >= expected;
  }, n, { timeout: 30000 });
}

async function startMatch(host, guest) {
  await guest.click('#ready-btn', { force: true });
  await wait(400);
  await host.click('#start-match-btn', { force: true });
}

async function waitForGameLoad(page, label) {
  await page.waitForFunction(() => /multiplayer-editor3\.html/.test(location.pathname), null, { timeout: 30000 });
  console.log(`[${label}] navigated to ${page.url()}`);
  await page.waitForSelector('#canvas', { timeout: 15000 });
  // Wait for either status to flip to ok ("connected as XXXXXX") or fail
  await page.waitForFunction(() => {
    const s = document.getElementById('hud-status');
    return s && (s.classList.contains('ok') || s.classList.contains('err'));
  }, null, { timeout: 30000 });
  const status = await page.locator('#hud-status').textContent();
  const cls = await page.locator('#hud-status').evaluate(el => el.className);
  console.log(`[${label}] status: "${status}" (${cls})`);
  return { status, cls };
}

async function probeGameState(page, label, sampleSeconds = 6) {
  const samples = [];
  for (let i = 0; i < sampleSeconds; i++) {
    await wait(1000);
    const sample = await page.evaluate(() => {
      const hud = {
        status: document.getElementById('hud-status')?.textContent,
        track: document.getElementById('hud-track')?.textContent,
        players: document.getElementById('hud-players')?.textContent,
        lap: document.getElementById('hud-lap')?.textContent,
        ping: document.getElementById('hud-ping')?.textContent,
      };
      // Pull live kart positions from window.__roomRef if exposed; otherwise from
      // the scene graph via window.__ghosts if exposed. Fallback: introspect scene.
      const karts = [];
      try {
        // Best-effort: walk window for likely globals
        const room = window.__roomRef || window.roomRef || null;
        if (room && room.state && room.state.karts) {
          room.state.karts.forEach((k, sid) => {
            karts.push({ sid, x: k.x, y: k.y, z: k.z, lap: k.lap, lastSeq: k.lastSeq, finished: k.finished });
          });
        }
      } catch {}
      return { hud, karts, t: performance.now() };
    });
    samples.push(sample);
  }
  console.log(`[${label}] samples:`, JSON.stringify(samples, null, 2));
  return samples;
}

async function injectInputs(page, durationMs = 4000) {
  // Hold W to drive forward for `durationMs`
  await page.evaluate((ms) => {
    const evDown = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true });
    const evUp = new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true });
    window.dispatchEvent(evDown);
    setTimeout(() => window.dispatchEvent(evUp), ms);
  }, durationMs);
  await wait(durationMs + 200);
}

(async () => {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const screenshotDir = path.resolve(process.cwd(), 'reports', 'online-arena-2p');
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const consoleLog = [];
  const out = { success: false, errors: [], samples: {}, consoleLog };
  try {
    const host = await setupPage(browser, 'HOST', consoleLog);
    const guest = await setupPage(browser, 'GUEST', consoleLog);

    await openLobby(host, HOST_NAME);
    await openLobby(guest, GUEST_NAME);

    await selectOnlineArena(host);
    await selectOnlineArena(guest);

    await pickFirstTemplate(host);
    const code = await hostLobby(host);
    console.log(`[probe] lobby code = ${code}`);
    out.lobbyCode = code;

    await joinLobby(guest, code);
    await waitForPlayers(host, 2);
    console.log('[probe] both players in lobby');

    await startMatch(host, guest);
    await wait(500);

    const hostLoad = await waitForGameLoad(host, 'HOST');
    const guestLoad = await waitForGameLoad(guest, 'GUEST');
    out.hostLoad = hostLoad;
    out.guestLoad = guestLoad;

    await host.screenshot({ path: path.join(screenshotDir, 'host-loaded.png'), fullPage: false });
    await guest.screenshot({ path: path.join(screenshotDir, 'guest-loaded.png'), fullPage: false });

    out.samples.hostIdle = await probeGameState(host, 'HOST', 4);
    out.samples.guestIdle = await probeGameState(guest, 'GUEST', 4);

    await host.screenshot({ path: path.join(screenshotDir, 'host-idle.png'), fullPage: false });
    await guest.screenshot({ path: path.join(screenshotDir, 'guest-idle.png'), fullPage: false });

    await injectInputs(host, 3000);
    await injectInputs(guest, 3000);

    out.samples.hostDrive = await probeGameState(host, 'HOST', 4);
    out.samples.guestDrive = await probeGameState(guest, 'GUEST', 4);

    await host.screenshot({ path: path.join(screenshotDir, 'host-drive.png'), fullPage: false });
    await guest.screenshot({ path: path.join(screenshotDir, 'guest-drive.png'), fullPage: false });

    out.success = true;
  } catch (err) {
    out.errors.push(err?.message || String(err));
    console.error('[probe] FAILED:', err);
  } finally {
    fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2));
    console.log(`[probe] report -> ${REPORT_PATH}`);
    await browser.close();
  }
})();
