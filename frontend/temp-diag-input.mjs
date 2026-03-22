import { chromium } from 'playwright';
import fs from 'node:fs';
const log = (msg) => fs.appendFileSync('diag-input.log', msg + '\n');
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist','--enable-gpu-rasterization','--disable-software-rasterizer','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-features=CalculateNativeWinOcclusion','--enable-features=SharedArrayBuffer','--no-sandbox'] });
const cfg = { gameMode:'battle', trackId:'glo_arena', battleType:'deathmatch', maxPlayers:2, scoreLimit:10, selectedKart:'tux', lobbyCode:`diag-input-${Date.now()}-${Math.floor(Math.random()*1e5)}` };
async function prep(page, name) {
  await page.addInitScript((config) => {
    sessionStorage.setItem('gameConfig', JSON.stringify(config));
    sessionStorage.setItem('selectedKart', config.selectedKart || 'tux');
    sessionStorage.setItem('gloEffect', 'solid');
    sessionStorage.setItem('gloColor', '#ff0080');
    sessionStorage.setItem('gloColor2', '#00e5ff');
  }, { ...cfg, playerName: name });
}
async function snap(page, label) {
  const d = await page.evaluate(() => {
    const c = window.__gloClient;
    const selfId = c?.room?.sessionId;
    const self = selfId ? c?.authoritativeState?.players?.get?.(selfId) : null;
    return {
      matchLive: !!window.__gloDebug?.matchLive,
      kartReady: !!c?._kartReady,
      inputSeq: Number(c?.inputSeq || 0),
      pending: Number(c?.pendingInputs?.length || 0),
      ack: Number(self?.lastProcessedInput || 0),
      latest: c?._latestRealtimeInput || null,
      pos: c?.localMesh ? { x: Number(c.localMesh.position.x||0), y: Number(c.localMesh.position.y||0), z: Number(c.localMesh.position.z||0) } : null,
    };
  });
  log(label + ' ' + JSON.stringify(d));
}
const c1 = await browser.newContext({ baseURL:'http://127.0.0.1:5173' });
const c2 = await browser.newContext({ baseURL:'http://127.0.0.1:5173' });
const p1 = await c1.newPage();
const p2 = await c2.newPage();
await prep(p1, 'Diag-P1');
await p1.goto('/realtime.html');
await p1.waitForTimeout(2000);
await prep(p2, 'Diag-P2');
await p2.goto('/realtime.html');
for (let i = 0; i < 20; i++) {
  await p1.waitForTimeout(2000);
  const live = await p1.evaluate(() => !!window.__gloDebug?.matchLive) && await p2.evaluate(() => !!window.__gloDebug?.matchLive);
  await snap(p1, 'prelive-p1-' + i);
  await snap(p2, 'prelive-p2-' + i);
  if (live) break;
}
await p1.bringToFront();
await snap(p1, 'before-burst');
await p1.keyboard.down('KeyW');
await p1.keyboard.down('Space');
await p1.waitForTimeout(1000);
await snap(p1, 'during-burst');
await p1.keyboard.up('Space');
await p1.keyboard.up('KeyW');
for (let i = 0; i < 6; i++) {
  await p1.waitForTimeout(1000);
  await snap(p1, 'post-burst-' + i);
}
await browser.close();
