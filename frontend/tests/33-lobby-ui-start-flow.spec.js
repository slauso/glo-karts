import { test, expect } from '@playwright/test';
import { isCriticalError } from './helpers/game-helpers.js';

test.describe.configure({ mode: 'serial' });

async function waitLobbyReady(page) {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mode-cards .mode-card', { timeout: 20_000 });
  await page.waitForFunction(() => {
    const loading = document.querySelector('#loading-screen');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0';
  }, { timeout: 20_000 });
}

async function selectOnlineBattle(page) {
  await page.locator('#mode-cards .mode-card[data-mode-id="battle_online"]').click();
  await expect(page.locator('#battle-settings')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#play-btn')).toBeEnabled({ timeout: 10_000 });
}

async function collectFailureContext(page) {
  return page.evaluate(() => ({
    href: window.location.href,
    statusText: document.querySelector('#rt-status')?.textContent?.trim() || '',
    splashStatus: document.querySelector('#splash-status')?.textContent?.trim() || '',
    joinStatus: document.querySelector('#join-status')?.textContent?.trim() || '',
    title: document.title,
    debug: window.__gloDebug ? JSON.parse(JSON.stringify(window.__gloDebug)) : null,
  }));
}

async function waitForMatchOutcome(page, timeout = 30_000) {
  return page.waitForFunction(() => {
    const statusText = document.querySelector('#rt-status')?.textContent || '';
    const debug = window.__gloDebug;
    return Boolean(debug?.matchLive) || statusText.includes('Connection failed');
  }, undefined, { timeout }).then(() => true).catch(() => false);
}

test('main menu online battle flow reaches realtime without connection failure', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const hostErrors = [];
  const guestErrors = [];
  const hostConsole = [];
  const guestConsole = [];

  const bindLogging = (page, errorSink, consoleSink) => {
    page.on('pageerror', (error) => errorSink.push(error.message));
    page.on('console', (msg) => {
      const text = msg.text();
      consoleSink.push(`[${msg.type()}] ${text}`);
      if (consoleSink.length > 80) consoleSink.shift();
    });
    page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));
  };

  bindLogging(host, hostErrors, hostConsole);
  bindLogging(guest, guestErrors, guestConsole);

  try {
    await Promise.all([waitLobbyReady(host), waitLobbyReady(guest)]);

    await host.fill('#player-name-input', 'Host UI');
    await guest.fill('#player-name-input', 'Guest UI');

    await selectOnlineBattle(host);
    await host.click('#play-btn');

    await host.waitForSelector('#host-info:not(.hidden)', { timeout: 20_000 });
    const partyCode = (await host.locator('#party-code').textContent())?.trim();
    expect(partyCode, 'host generated a lobby code').toBeTruthy();

    await guest.fill('#join-code-input', partyCode);
    await guest.click('#join-party-btn');

    await guest.waitForFunction(() => {
      return document.querySelector('.join-section')?.classList.contains('hidden');
    }, { timeout: 20_000 });

    await Promise.all([
      host.waitForFunction(() => document.querySelectorAll('#player-list li.player-row').length >= 2, { timeout: 20_000 }),
      guest.waitForFunction(() => document.querySelectorAll('#player-list li.player-row').length >= 2, { timeout: 20_000 }),
    ]);

    await Promise.all([
      host.click('#ready-btn'),
      guest.click('#ready-btn'),
    ]);

    await expect(host.locator('#start-match-btn')).toBeVisible({ timeout: 15_000 });
    await host.click('#start-match-btn');

    await Promise.all([
      host.waitForURL(/\/realtime\.html/, { timeout: 25_000 }),
      guest.waitForURL(/\/realtime\.html/, { timeout: 25_000 }),
    ]);

    const [hostOutcomeSeen, guestOutcomeSeen] = await Promise.all([
      waitForMatchOutcome(host, 35_000),
      waitForMatchOutcome(guest, 35_000),
    ]);

    const [hostContext, guestContext] = await Promise.all([
      collectFailureContext(host),
      collectFailureContext(guest),
    ]);

    const criticalHostErrors = hostErrors.filter(isCriticalError);
    const criticalGuestErrors = guestErrors.filter(isCriticalError);

    if (hostContext.statusText) console.log('[ui-flow] host status:', hostContext.statusText);
    if (guestContext.statusText) console.log('[ui-flow] guest status:', guestContext.statusText);
    console.log('[ui-flow] outcome seen:', { hostOutcomeSeen, guestOutcomeSeen });
    console.log('[ui-flow] host debug:', hostContext.debug);
    console.log('[ui-flow] guest debug:', guestContext.debug);
    if (criticalHostErrors.length) console.log('[ui-flow] host critical errors:', criticalHostErrors);
    if (criticalGuestErrors.length) console.log('[ui-flow] guest critical errors:', criticalGuestErrors);

    expect(host.url(), 'host stayed on realtime page').toMatch(/\/realtime\.html/);
    expect(guest.url(), 'guest stayed on realtime page').toMatch(/\/realtime\.html/);
    expect(hostContext.statusText, 'host did not show connection failure').not.toContain('Connection failed');
    expect(guestContext.statusText, 'guest did not show connection failure').not.toContain('Connection failed');
    expect(hostContext.debug?.matchLive, 'host reached matchLive').toBe(true);
    expect(guestContext.debug?.matchLive, 'guest reached matchLive').toBe(true);
    expect(criticalHostErrors, 'host browser errors').toHaveLength(0);
    expect(criticalGuestErrors, 'guest browser errors').toHaveLength(0);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});