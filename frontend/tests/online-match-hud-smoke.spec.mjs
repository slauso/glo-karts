/**
 * online-match-hud-smoke.spec.mjs — 2-player online match HUD contract.
 *
 * Opt-in because it needs the realtime server on 127.0.0.1:2567.
 * Verifies the authoritative match lifecycle reaches racing and the
 * production HUD surfaces timer, scores, inventory slots, and minimap.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';
const REALTIME = 'ws://127.0.0.1:2567';
const TRACK_ID = '3d4824d8-807a-440c-807b-a67bd83252b8';

async function realtimeReachable() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${REALTIME.replace('ws:', 'http:').replace('wss:', 'https:')}/matchmake`, {
      method: 'GET', signal: ctrl.signal,
    });
    return res.status >= 200 && res.status < 600;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

test.describe('Online match HUD', () => {
  test('two clients share countdown, timer, scores, slots, and minimap', async ({ browser }) => {
    test.setTimeout(90000);
    test.skip(process.env.ONLINE_SMOKE !== '1', 'set ONLINE_SMOKE=1 to enable Colyseus smoke');
    test.skip(!(await realtimeReachable()), `realtime server not reachable at ${REALTIME}`);

    const room = `hud${Math.floor(Math.random() * 90000 + 10000)}`;
    const url = `${BASE}/multiplayer-editor3.html?trackId=${TRACK_ID}&room=${room}&autostart=1`;
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const host = await ctxA.newPage();
    const guest = await ctxB.newPage();

    await Promise.all([
      host.goto(url, { waitUntil: 'domcontentloaded' }),
      guest.goto(url, { waitUntil: 'domcontentloaded' }),
    ]);

    await host.waitForFunction(() => {
      const karts = window.__mp?.room?.state?.karts;
      if (!karts) return false;
      let count = 0;
      try { karts.forEach(() => { count += 1; }); }
      catch { count = karts.size || 0; }
      return count >= 2;
    }, { timeout: 45000 });
    await host.waitForFunction(() => window.__mp.room.state.status === 'racing', { timeout: 15000 });

    const hud = await host.evaluate(() => {
      const text = (id) => document.getElementById(id)?.textContent || '';
      return {
        status: window.__mp.room.state.status,
        players: (() => {
          let count = 0;
          window.__mp.room.state.karts.forEach(() => { count += 1; });
          return count;
        })(),
        time: text('match-time-value'),
        scoreA: text('score-left-value'),
        scoreB: text('score-right-value'),
        slotA: document.querySelector('#item-slot-1 .item-name')?.textContent || '',
        slotB: document.querySelector('#item-slot-2 .item-name')?.textContent || '',
        dots: document.querySelectorAll('#minimap .map-dot').length,
        lobbyHidden: document.getElementById('overlay-lobby')?.classList.contains('hidden'),
        countdownHidden: document.getElementById('overlay-countdown')?.classList.contains('hidden'),
      };
    });

    expect(hud.status).toBe('racing');
    expect(hud.players).toBe(2);
    expect(hud.time).toMatch(/^\d:\d{2}$/);
    expect(hud.scoreA).toBe('0');
    expect(hud.scoreB).toBe('0');
    expect(hud.slotA).toBeTruthy();
    expect(hud.slotB).toBeTruthy();
    expect(hud.dots).toBeGreaterThanOrEqual(2);
    expect(hud.lobbyHidden).toBe(true);
    expect(hud.countdownHidden).toBe(true);

    await ctxA.close();
    await ctxB.close();
  });
});