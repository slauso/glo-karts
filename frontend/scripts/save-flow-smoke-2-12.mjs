// Phase 2.12 smoke: verify Save / Save as / Publish each push to cloud
// AND mirror to localStorage AND signal cross-page listeners. Also opens
// the lobby and confirms the new save appears in the My Saves tab.
import { chromium } from 'playwright';

const dialogs = [];
const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('[err] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console.err] ' + m.text()); });
page.on('dialog', async (d) => {
  dialogs.push(d.message());
  if (/track name/i.test(d.message())) await d.accept('Phase212 Smoke Track');
  else if (/author/i.test(d.message())) await d.accept('SmokeBot');
  else await d.accept('SmokeBot');
});

// Wipe owner-token + author baseline so we can observe a deterministic save.
await page.goto('http://localhost:5173/editor.html');
await page.evaluate(() => { localStorage.clear(); });

await page.goto('http://localhost:5173/editor.html');
await page.waitForTimeout(2500);

// Dismiss the studio landing by clicking "New Project"
await page.evaluate(() => {
  const cards = document.querySelectorAll('.sl-card');
  for (const c of cards) if (/new project/i.test(c.textContent)) c.click();
});
await page.waitForTimeout(2000);

// Drop a single piece so the saved track has content.
await page.evaluate(() => {
  if (typeof window.__editor3_addPiece === 'function') {
    window.__editor3_addPiece('straight', 0, 0, 0);
  }
});

// Click hamburger Save (action=save) via JS.
const saveResult = await page.evaluate(() => {
  const b = document.querySelector('button[data-action="save"]');
  if (!b) return 'no save button';
  b.click();
  return 'clicked';
});
console.log('save click:', saveResult);
await page.waitForTimeout(1500);

// Verify localStorage has the autoload slot AND a savesUpdated signal.
const ls = await page.evaluate(() => ({
  hasAutoload: !!localStorage.getItem('gloKartsStudio.lastTrack'),
  savesUpdated: !!localStorage.getItem('gloKartsStudio.savesUpdated'),
  ownerToken: localStorage.getItem('gloKartsStudio.ownerToken'),
}));
console.log('after Save click:', ls);

// Confirm the cloud got a Phase212 Smoke Track owned by us.
const ownerToken = ls.ownerToken;
const mineRes = await fetch('http://localhost:8000/api/tracks/mine/', {
  headers: { 'X-Owner-Token': ownerToken },
}).then((r) => r.json());
console.log('mine count after Save:', mineRes.total, 'names:', mineRes.results.map((r) => r.name));

// Now Save as… (action=cloud-save)
await page.evaluate(() => document.querySelector('button[data-action="cloud-save"]').click());
await page.waitForTimeout(1500);
// And Publish to community
await page.evaluate(() => document.querySelector('button[data-action="cloud-publish"]').click());
await page.waitForTimeout(1500);

const community = await fetch('http://localhost:8000/api/tracks/community/').then((r) => r.json());
console.log('community count after Publish:', community.total, 'names:', community.results.map((r) => r.name));

// Open the lobby in a second tab and verify the My Saves picker shows it.
const lobby = await ctx.newPage();
lobby.on('pageerror', (e) => errors.push('[lobby err] ' + e.message));
await lobby.goto('http://localhost:5173/index.html');
await lobby.waitForTimeout(2500);
// Try to navigate to online lobby. Click "Online" or "Multiplayer" entry.
await lobby.evaluate(() => {
  const buttons = document.querySelectorAll('button, a');
  for (const b of buttons) if (/online|multiplayer|race/i.test(b.textContent || '')) { b.click(); break; }
});
await lobby.waitForTimeout(1500);
// Force-show the studio picker if it exists.
await lobby.evaluate(() => {
  const p = document.getElementById('lobby-studio-picker');
  if (p) p.classList.remove('hidden');
});
await lobby.waitForTimeout(2500);
// Click "My Saves" tab.
await lobby.evaluate(() => {
  const tabs = document.querySelectorAll('.lsp-tab');
  for (const t of tabs) if (/my saves/i.test(t.textContent)) t.click();
});
await lobby.waitForTimeout(2000);
const lobbyMine = await lobby.$$eval('.lsp-tile .lsp-name', els => els.map(e => e.textContent.trim()));
console.log('lobby My Saves tiles:', lobbyMine);

console.log('\n--- DIALOGS ---');
for (const d of dialogs) console.log('[dialog]', d);
console.log('\n--- ERRORS ---');
for (const e of errors) console.log(e);

// Cleanup probe tracks via local owner token.
const all = await fetch('http://localhost:8000/api/tracks/mine/', {
  headers: { 'X-Owner-Token': ownerToken },
}).then((r) => r.json());
for (const t of (all.results || [])) {
  if (/Phase212 Smoke|Smoke Track/i.test(t.name)) {
    await fetch(`http://localhost:8000/api/tracks/${t.id}/delete/`, {
      method: 'DELETE', headers: { 'X-Owner-Token': ownerToken },
    });
  }
}
await browser.close();
console.log('\nDONE');
