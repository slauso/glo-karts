// Navigates the CDP Chrome window to Tinkercad so the user can log in
// and open a project. Call repeatedly to refresh the listing.
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => /tinkercad\.com/i.test(p.url()));
if (!page) {
  page = ctx.pages()[0] || await ctx.newPage();
  console.log('[nav] sending tab to tinkercad.com/dashboard');
  await page.goto('https://www.tinkercad.com/dashboard', { waitUntil: 'domcontentloaded' }).catch(() => {});
}
await page.bringToFront();
console.log('[ready] active tab url:', page.url());
console.log('[ready] title:', await page.title());
await browser.close();
