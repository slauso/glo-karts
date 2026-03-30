import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS || 'false').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'builder-playtest-regression.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeReport(payload) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function readDebugState(page) {
  return page.evaluate(() => ({
    href: window.location.href,
    gameConfig: JSON.parse(sessionStorage.getItem('gameConfig') || '{}'),
    playtestMeta: JSON.parse(sessionStorage.getItem('gloBuilderPlaytestMeta') || 'null'),
    loadingVisible: (() => {
      const el = document.getElementById('loading-screen');
      return !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).opacity !== '0';
    })(),
    prematchVisible: (() => {
      const el = document.getElementById('prematch-lobby');
      return !!el && (el.classList.contains('visible') || getComputedStyle(el).display !== 'none');
    })(),
    builderPanelVisible: (() => {
      const el = document.getElementById('builder-playtest-panel');
      return !!el && !el.hidden;
    })(),
    builderStep: document.getElementById('builder-playtest-step')?.textContent?.trim() || '',
    builderDetail: document.getElementById('builder-playtest-detail')?.textContent?.trim() || '',
    builderStatus: document.getElementById('builder-playtest-status')?.textContent?.trim() || '',
    progressWidth: document.getElementById('builder-playtest-progress-fill')?.style.width || '',
    events: window.__builderPlaytestEvents || [],
    debug: window.__gloDebug || null,
    joinOptions: window.__gloClient?._joinOptions || null,
    roomName: window.__gloClient?.room?.name || '',
    matchLive: !!window.__gloDebug?.matchLive,
  }));
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext();
  const page = await context.newPage();
  const navs = [];
  let step = 'boot';

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      navs.push(frame.url());
    }
  });

  await page.addInitScript(() => {
    if (/\/builder\.html$/.test(window.location.pathname)) {
      localStorage.removeItem('gloBuilderDraft');
      sessionStorage.removeItem('gloBuilderLaunchIntent');
      sessionStorage.removeItem('gloBuilderPlaytestMeta');
      sessionStorage.removeItem('gameConfig');
      sessionStorage.removeItem('customTrackData');
      sessionStorage.setItem('selectedKart', 'tux');
      sessionStorage.setItem('selectedKartName', 'Tux');
      sessionStorage.setItem('carColor', 'red');
    }
    window.__builderPlaytestEvents = [];
    window.addEventListener('glo-playtest-progress', (event) => {
      window.__builderPlaytestEvents.push({
        ...(event.detail || {}),
        ts: Date.now(),
      });
    });
  });

  try {
    step = 'open-builder';
    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded' });

    step = 'wait-builder-ready';
    await page.waitForSelector('#ab-play', { timeout: 15000 });
    await page.waitForFunction(() => {
      const stats = document.getElementById('ab-stats')?.textContent || '';
      return /tiles/.test(stats) && /spawns/.test(stats);
    }, undefined, { timeout: 20000 });

    step = 'launch-playtest';
    await page.click('#ab-play');

    step = 'wait-direct-route';
    await page.waitForURL(/realtime\.html\?builderPlaytest=1/, { timeout: 30000 });
    await page.waitForFunction(() => {
      const config = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
      return config.builderPlaytest === true
        && config.directPlaytest === true
        && config.trackId === 'custom_import'
        && config.arenaId === 'custom_import'
        && typeof config.customTrackData === 'string'
        && config.customTrackData.length > 100;
    }, undefined, { timeout: 15000 });
    await page.waitForSelector('#builder-playtest-panel:not([hidden])', { timeout: 10000 });

    step = 'verify-loading-state';
    await page.waitForFunction(() => {
      const client = window.__gloClient;
      const loading = document.getElementById('loading-screen');
      const prematch = document.getElementById('prematch-lobby');
      return !!client?.room
        && loading
        && getComputedStyle(loading).display !== 'none'
        && prematch
        && !prematch.classList.contains('visible');
    }, undefined, { timeout: 45000 });

    step = 'wait-custom-arena-build';
    await page.waitForFunction(() => {
      return window.__gloDebug?.customArenaBuilt === true
        && window.__gloDebug?.requestedArenaId === 'custom_import'
        && typeof window.__gloClient?._joinOptions?.customTrackData === 'string'
        && window.__gloClient._joinOptions.customTrackData.length > 100;
    }, undefined, { timeout: 45000 });

    step = 'wait-match-live';
    await page.waitForFunction(() => window.__gloDebug?.matchLive === true, undefined, { timeout: 45000 });
    await page.waitForFunction(() => {
      const loading = document.getElementById('loading-screen');
      return !!loading && getComputedStyle(loading).display === 'none';
    }, undefined, { timeout: 10000 });

    const summary = await readDebugState(page);

    assert(navs.some((url) => /builder\.html/.test(url)), 'Flow should begin on builder.html');
    assert(navs.some((url) => /realtime\.html\?builderPlaytest=1/.test(url)), 'Flow should navigate directly to realtime.html with builderPlaytest flag');
    assert(!navs.some((url) => /index\.html/.test(url)), 'Builder playtest should not route through index.html');
    assert(summary.builderPanelVisible, 'Builder loading panel should be visible during direct playtest handoff');
    assert(summary.gameConfig?.builderPlaytest === true, 'gameConfig should be marked as a builder playtest');
    assert(summary.gameConfig?.customTrackData?.length > 100, 'gameConfig should retain customTrackData');
    assert(summary.joinOptions?.directPlaytest === true, 'Realtime join options should preserve directPlaytest mode');
    assert(summary.joinOptions?.customTrackData?.length > 100, 'Realtime join options should forward customTrackData');
    assert(summary.debug?.customArenaBuilt === true, 'Realtime runtime should build the custom arena');
    assert(summary.debug?.requestedArenaId === 'custom_import', 'Realtime runtime should request the custom arena id');
    assert(summary.roomName === 'battle_room', 'Builder playtest should join the battle_room shell');
    assert(summary.matchLive === true, 'Builder playtest should reach match live');
    assert(summary.events.some((event) => /builder arena assembled/i.test(event.label || '')), 'Progress events should report custom arena assembly');

    const payload = { ok: true, navs, summary };
    writeReport(payload);
    console.log('BUILDER_PLAYTEST_REGRESSION', JSON.stringify(payload, null, 2));
  } catch (error) {
    const payload = {
      ok: false,
      step,
      error: String(error?.message || error),
      navs,
      debug: await readDebugState(page).catch(() => null),
    };
    writeReport(payload);
    console.error('BUILDER_PLAYTEST_REGRESSION', JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

run().catch((error) => {
  const payload = { ok: false, error: String(error?.message || error) };
  writeReport(payload);
  console.error('BUILDER_PLAYTEST_REGRESSION', JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});