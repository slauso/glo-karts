/**
 * Screenshot verification: takes actual browser screenshots after match goes live.
 * Verifies the gk-preload opacity fix visually.
 */
import { chromium } from 'playwright';

const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle'] });

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    // Host opens lobby
    await host.goto('http://localhost:5173/index.html', { waitUntil: 'load' });
    await host.waitForSelector('#mode-cards', { timeout: 30000 });
    await host.waitForFunction(() => {
      const btn = document.getElementById('play-btn');
      const ni = document.getElementById('player-name-input');
      return btn && ni && ni.placeholder && ni.placeholder !== 'Enter Your Nickname...';
    }, null, { timeout: 15000 });
    await host.fill('#player-name-input', 'ScreenHost');
    await host.evaluate(() => {
      const card = document.querySelector('.mode-card[data-mode-id="battle_online"]');
      if (card) card.click();
    });
    await wait(500);

    // Guest opens lobby
    await guest.goto('http://localhost:5173/index.html', { waitUntil: 'load' });
    await guest.waitForSelector('#mode-cards', { timeout: 30000 });
    await guest.waitForFunction(() => {
      const btn = document.getElementById('join-party-btn');
      const ni = document.getElementById('player-name-input');
      return btn && ni && ni.placeholder && ni.placeholder !== 'Enter Your Nickname...';
    }, null, { timeout: 15000 });
    await guest.fill('#player-name-input', 'ScreenGuest');
    await wait(300);

    // Host creates
    await host.click('#play-btn', { force: true });
    await host.waitForFunction(() => {
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      return code && code.length >= 3;
    }, null, { timeout: 30000 });
    const code = (await host.locator('#party-code').textContent()).trim();
    console.log('Party code:', code);

    // Guest joins
    await guest.fill('#join-code-input', code);
    await guest.click('#join-party-btn', { force: true });
    await guest.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 1, null, { timeout: 30000 });
    await host.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 2, null, { timeout: 30000 });
    console.log('Both in lobby');

    // Ready & start
    await guest.click('#ready-btn', { force: true });
    await wait(500);
    await host.click('#start-match-btn', { force: true });

    // Wait for realtime.html
    await Promise.all([
      host.waitForURL(/realtime\.html/, { timeout: 45000 }),
      guest.waitForURL(/realtime\.html/, { timeout: 45000 }),
    ]);
    console.log('Both on realtime.html');

    // Wait for match live
    await host.waitForFunction(() => {
      const c = window.__gloClient || window.client;
      return c?.started === true;
    }, null, { timeout: 120000 });
    await guest.waitForFunction(() => {
      const c = window.__gloClient || window.client;
      return c?.started === true;
    }, null, { timeout: 120000 });
    console.log('Match is LIVE for both players!');

    // Wait for a few render frames
    await wait(3000);

    // Screenshots
    await host.screenshot({ path: 'host-screenshot.png' });
    await guest.screenshot({ path: 'guest-screenshot.png' });
    console.log('Screenshots saved.');

    // Diagnostics
    const hostDiag = await host.evaluate(() => ({
      bodyOpacity: getComputedStyle(document.body).opacity,
      gkPreload: document.documentElement.classList.contains('gk-preload'),
      elementOnTop: (() => {
        const e = document.elementFromPoint(640, 360);
        return e ? `${e.tagName}#${e.id}` : null;
      })(),
      prematchDisplay: document.getElementById('prematch-lobby')?.style.display,
      loadingDisplay: document.getElementById('loading-screen')?.style.display,
    }));
    const guestDiag = await guest.evaluate(() => ({
      bodyOpacity: getComputedStyle(document.body).opacity,
      gkPreload: document.documentElement.classList.contains('gk-preload'),
      elementOnTop: (() => {
        const e = document.elementFromPoint(640, 360);
        return e ? `${e.tagName}#${e.id}` : null;
      })(),
      prematchDisplay: document.getElementById('prematch-lobby')?.style.display,
      loadingDisplay: document.getElementById('loading-screen')?.style.display,
    }));

    console.log('HOST:', JSON.stringify(hostDiag));
    console.log('GUEST:', JSON.stringify(guestDiag));

    const ok = hostDiag.bodyOpacity === '1' && guestDiag.bodyOpacity === '1'
      && hostDiag.elementOnTop === 'CANVAS#realtime-canvas'
      && guestDiag.elementOnTop === 'CANVAS#realtime-canvas'
      && !hostDiag.gkPreload && !guestDiag.gkPreload;

    console.log(ok ? 'PASS: Both players rendering correctly' : 'FAIL: Check diagnostics above');
    if (!ok) process.exitCode = 1;

  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await browser.close();
  }
}

run();
