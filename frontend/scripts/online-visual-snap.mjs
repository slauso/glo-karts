#!/usr/bin/env node
/**
 * Quick visual snapshot for the online editor3 lobby + in-race kart pose.
 * Saves PNGs under frontend/screenshots/online-redesign/.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FRONTEND = process.env.FRONTEND_URL || 'http://localhost:5174';
const OUT = resolve('screenshots/online-redesign');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

await page.goto(`${FRONTEND}/multiplayer-editor3.html?autostart=1`, { waitUntil: 'load' });
await page.waitForSelector('#overlay-lobby .overlay-title', { timeout: 20_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(OUT, 'lobby.png'), fullPage: false });
console.log('[online-visual-snap] saved lobby.png');

// Wait for race to begin (overlay-lobby gets .hidden) and a few seconds of driving.
try {
  await page.waitForFunction(() => document.querySelector('#overlay-lobby')?.classList.contains('hidden'), { timeout: 25_000 });
} catch {
  console.warn('[online-visual-snap] lobby never hid; capturing anyway.');
}
await page.waitForTimeout(4000);
await page.screenshot({ path: join(OUT, 'in-race.png'), fullPage: false });
console.log('[online-visual-snap] saved in-race.png');

await browser.close();
