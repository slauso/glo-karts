import { chromium } from 'playwright';
import fs from 'node:fs';
const log = (msg) => fs.appendFileSync('diag-playwright.log', msg + '\n');
log('diag-start');
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist','--enable-gpu-rasterization','--disable-software-rasterizer','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion','--enable-features=SharedArrayBuffer','--no-sandbox'] });
const cfg = { gameMode:'battle', trackId:'glo_arena', battleType:'deathmatch', maxPlayers:2, scoreLimit:5, selectedKart:'tux', lobbyCode:`diag-${Date.now()}-${Math.floor(Math.random()*1e5)}` };
async function prep(page, name) {
  await page.addInitScript((config) => {
    sessionStorage.setItem('gameConfig', JSON.stringify(config));
    sessionStorage.setItem('selectedKart', config.selectedKart || 'tux');
    sessionStorage.setItem('gloEffect', 'solid');
    sessionStorage.setItem('gloColor', '#ff0080');
    sessionStorage.setItem('gloColor2', '#00e5ff');
  }, { ...cfg, playerName: name });
}
const c1 = await browser.newContext({ baseURL:'http://127.0.0.1:5173' });
const c2 = await browser.newContext({ baseURL:'http://127.0.0.1:5173' });
const p1 = await c1.newPage();
const p2 = await c2.newPage();
p1.on('pageerror', e => log('P1 pageerror ' + e.message));
p2.on('pageerror', e => log('P2 pageerror ' + e.message));
p1.on('console', m => { if (['error','warning'].includes(m.type())) log('P1 console ' + m.type() + ' ' + m.text()); });
p2.on('console', m => { if (['error','warning'].includes(m.type())) log('P2 console ' + m.type() + ' ' + m.text()); });
await prep(p1, 'Diag-P1');
await p1.goto('/realtime.html');
await p1.waitForTimeout(2000);
await prep(p2, 'Diag-P2');
await p2.goto('/realtime.html');
for (let i = 0; i < 6; i++) {
  await p1.waitForTimeout(5000);
  const d1 = await p1.evaluate(() => { const d = window.__gloDebug || {}; return { roomJoined:d.roomJoined, matchLive:d.matchLive, playerCount:d.playerCount, readyCount:d.readyCount, readyRequiredCount:d.readyRequiredCount, roomId:d.roomId, sessionId:d.sessionId }; });
  const d2 = await p2.evaluate(() => { const d = window.__gloDebug || {}; return { roomJoined:d.roomJoined, matchLive:d.matchLive, playerCount:d.playerCount, readyCount:d.readyCount, readyRequiredCount:d.readyRequiredCount, roomId:d.roomId, sessionId:d.sessionId }; });
  log('TICK ' + i + ' P1 ' + JSON.stringify(d1) + ' P2 ' + JSON.stringify(d2));
}
await browser.close();
log('diag-end');
