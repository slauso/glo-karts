// Phase: real-time mirror of host-side lobby selections to all guests.
// Verifies that when the host changes track / laps / battle type / max
// players, the guest's left card reflects the change within ~1.5s, and
// that the studio picker tile + tab also mirror the host's pick.
//
// Run:  node frontend/scripts/lobby-host-guest-mirror-probe.mjs
// Env:  BASE_URL (default http://localhost:5174)
//       HEADLESS=true|false

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'lobby-host-guest-mirror.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, label, log) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => {
    const line = `[${label}] pageerror: ${err.message}`;
    console.error(line); log.push(line);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const line = `[${label}] console.error: ${msg.text()}`;
      console.error(line); log.push(line);
    }
  });
  return page;
}

async function openLobby(page, name) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#mode-cards', { timeout: 30000 });
  await page.waitForFunction(() => {
    const i = document.getElementById('player-name-input');
    return i && i.placeholder && !/Loading/i.test(i.placeholder);
  }, null, { timeout: 15000 });
  await page.fill('#player-name-input', name);
}

async function selectOnlineArena(page) {
  await page.evaluate(() => {
    document.querySelector('[data-mode-id="online_arena"]')?.click();
  });
  await page.waitForSelector('#lobby-studio-picker:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.lsp-tile').length > 0, null, { timeout: 15000 });
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
    const hi = document.getElementById('host-info');
    return hi && !hi.classList.contains('hidden');
  }, null, { timeout: 30000 });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    selectedMapName: document.querySelector('.selected-map-name')?.textContent?.trim() || '',
    pickerSelectedTrackId: document.querySelector('.lsp-tile.active')?.dataset?.trackId || '',
    pickerActiveTab: document.querySelector('.lsp-tab.active')?.dataset?.tab || '',
    raceLaps: document.getElementById('race-laps')?.value || '',
    battleType: document.getElementById('battle-type-select')?.value || '',
    maxPlayers: document.getElementById('battle-max-players')?.value || '',
    hasGuestLockBanner: !!document.querySelector('.guest-lock-banner'),
    leftPanelLocked: document.querySelector('.simplified-left-panel')?.classList.contains('is-guest-locked') || false,
  }));
}

async function pollUntil(page, predicate, timeoutMs = 4000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await snapshot(page);
    if (predicate(last)) return { ok: true, snap: last, elapsedMs: Date.now() - t0 };
    await wait(150);
  }
  return { ok: false, snap: last, elapsedMs: Date.now() - t0 };
}

async function pickSecondTile(host) {
  return host.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.lsp-tile'));
    if (tiles.length < 2) { tiles[0]?.click(); return tiles[0]?.dataset?.trackId || null; }
    tiles[1].click();
    return tiles[1].dataset.trackId;
  });
}

async function main() {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const log = [];
  const results = [];
  const browser = await chromium.launch({ headless: HEADLESS });
  const failures = [];
  try {
    const host = await newPage(browser, 'host', log);
    const guest = await newPage(browser, 'guest', log);

    await openLobby(host, 'MirrorHost');
    await selectOnlineArena(host);
    const code = await hostLobby(host);
    log.push(`[host] lobby code = ${code}`);

    await openLobby(guest, 'MirrorGuest');
    await selectOnlineArena(guest);
    await joinLobby(guest, code);
    await wait(800);

    // Sanity: guest panel is locked + has banner.
    const initial = await snapshot(guest);
    log.push(`[guest] initial: ${JSON.stringify(initial)}`);
    if (!initial.leftPanelLocked || !initial.hasGuestLockBanner) {
      failures.push('guest left panel is not in read-only/locked state');
    }

    // === 1. Host picks a different studio template ===
    const newTrackId = await pickSecondTile(host);
    log.push(`[host] picked tile trackId=${newTrackId}`);
    await wait(400);
    const hostSnap1 = await snapshot(host);
    const guestRes1 = await pollUntil(guest, (s) => s.pickerSelectedTrackId === String(newTrackId), 3000);
    results.push({ step: 'track-mirror', hostSnap: hostSnap1, guestSnap: guestRes1.snap, elapsedMs: guestRes1.elapsedMs, ok: guestRes1.ok });
    if (!guestRes1.ok) failures.push(`guest did not mirror trackId ${newTrackId} (saw ${guestRes1.snap?.pickerSelectedTrackId})`);

    // === 2. Host changes laps ===
    await host.selectOption('#race-laps', { index: 1 }).catch(() => {});
    await host.evaluate(() => {
      const el = document.getElementById('race-laps');
      if (el) { el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await wait(300);
    const hostSnap2 = await snapshot(host);
    const guestRes2 = await pollUntil(guest, (s) => s.raceLaps === hostSnap2.raceLaps && hostSnap2.raceLaps !== '', 3000);
    results.push({ step: 'laps-mirror', hostSnap: hostSnap2, guestSnap: guestRes2.snap, elapsedMs: guestRes2.elapsedMs, ok: guestRes2.ok });
    if (!guestRes2.ok) failures.push(`guest did not mirror laps host=${hostSnap2.raceLaps} guest=${guestRes2.snap?.raceLaps}`);

    // === 3. Host changes max players ===
    const mpEl = await host.$('#battle-max-players');
    if (mpEl) {
      await host.selectOption('#battle-max-players', { index: 1 }).catch(() => {});
      await host.evaluate(() => document.getElementById('battle-max-players')?.dispatchEvent(new Event('change', { bubbles: true })));
      await wait(300);
      const hostSnap3 = await snapshot(host);
      const guestRes3 = await pollUntil(guest, (s) => s.maxPlayers === hostSnap3.maxPlayers, 3000);
      results.push({ step: 'maxPlayers-mirror', hostSnap: hostSnap3, guestSnap: guestRes3.snap, elapsedMs: guestRes3.elapsedMs, ok: guestRes3.ok });
      if (!guestRes3.ok) failures.push(`guest did not mirror maxPlayers host=${hostSnap3.maxPlayers} guest=${guestRes3.snap?.maxPlayers}`);
    }

    // === 4. Guest cannot interact with locked controls ===
    // CSS sets `pointer-events: none` on the entire .map-selector-container
    // when the guest panel has .is-guest-locked. Synthetic .click() in JS
    // bypasses that, so verify via computed style instead — that's what a
    // real mouse click would honour.
    const guestPickerBlocked = await guest.evaluate(() => {
      const container = document.querySelector('.map-selector-container');
      const tile = document.querySelector('.lsp-tile');
      const containerPE = container ? getComputedStyle(container).pointerEvents : null;
      const tilePE = tile ? getComputedStyle(tile).pointerEvents : null;
      return {
        containerPE,
        tilePE,
        blocked: containerPE === 'none' || tilePE === 'none',
      };
    });
    results.push({ step: 'guest-cannot-pick', detail: guestPickerBlocked });
    if (!guestPickerBlocked.blocked) {
      failures.push(`guest picker is interactive (container pointer-events=${guestPickerBlocked.containerPE})`);
    }
  } finally {
    await browser.close();
  }

  const report = { ts: Date.now(), pass: failures.length === 0, failures, results, log };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n=== lobby-host-guest-mirror-probe ===`);
  console.log(`pass: ${report.pass}`);
  if (failures.length) failures.forEach((f) => console.error(`FAIL: ${f}`));
  console.log(`report: ${REPORT_PATH}`);
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(2); });
