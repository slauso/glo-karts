/**
 * online-bandwidth-budget.spec.mjs — Phase 6.4 bandwidth budget probe.
 *
 * Connects two clients to editor3_race_room and asserts that the inbound
 * Colyseus state-patch stream stays under a fixed budget. The threshold
 * is intentionally loose (32 KB/s per client) so transient pickup /
 * weapon bursts don't false-flag; a regression that doubles snapshot
 * size or accidentally re-syncs everything every tick will still trip.
 *
 * Reads window.__gloDebug.network.bytesPerSec which is wired up in
 * multiplayer-editor3-main.js right after the WebSocket attaches.
 *
 * Skips when ONLINE_SMOKE != 1 or realtime server is unreachable.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';
const REALTIME = 'ws://127.0.0.1:2567';
const BUDGET_BYTES_PER_SEC = 32 * 1024; // 32 KB/s per client
const SAMPLE_WINDOW_MS = 6000;          // average over 6 seconds

async function realtimeReachable() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(REALTIME.replace('ws:', 'http:').replace('wss:', 'https:') + '/matchmake', { method: 'GET', signal: ctrl.signal });
    return res.status >= 200 && res.status < 600;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

test.describe('Bandwidth budget — Phase 6.4', () => {
  test('two-client editor3_race_room stays under 32 KB/s inbound', async ({ browser }) => {
    test.skip(process.env.ONLINE_SMOKE !== '1', 'set ONLINE_SMOKE=1 to enable');
    const up = await realtimeReachable();
    test.skip(!up, `realtime server not reachable at ${REALTIME}`);

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const a = await ctxA.newPage();
    const b = await ctxB.newPage();
    await Promise.all([
      a.goto(`${BASE}/multiplayer-editor3.html?autostart=1`, { waitUntil: 'domcontentloaded' }),
      b.goto(`${BASE}/multiplayer-editor3.html?autostart=1`, { waitUntil: 'domcontentloaded' }),
    ]);

    const ready = (page) => page.waitForFunction(() => {
      const r = window.__mp && window.__mp.room;
      return r && r.state && r.state.karts && r.state.karts.size >= 1;
    }, { timeout: 25000 });
    await Promise.all([ready(a), ready(b)]);

    // Burn off the connect-time burst (initial snapshot + asset hello).
    await a.waitForTimeout(2000);

    // Sample bytesPerSec across SAMPLE_WINDOW_MS, average per client.
    const sampleEvery = 1000;
    const samples = Math.max(1, Math.floor(SAMPLE_WINDOW_MS / sampleEvery));
    const sumA = []; const sumB = [];
    for (let i = 0; i < samples; i++) {
      await a.waitForTimeout(sampleEvery);
      const va = await a.evaluate(() => (window.__gloDebug?.network?.bytesPerSec) || 0);
      const vb = await b.evaluate(() => (window.__gloDebug?.network?.bytesPerSec) || 0);
      sumA.push(va); sumB.push(vb);
    }
    const avg = (xs) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const avgA = avg(sumA), avgB = avg(sumB);
    test.info().annotations.push({ type: 'bytesPerSec', description: `A=${avgA.toFixed(0)} B=${avgB.toFixed(0)} budget=${BUDGET_BYTES_PER_SEC}` });

    expect(avgA).toBeLessThan(BUDGET_BYTES_PER_SEC);
    expect(avgB).toBeLessThan(BUDGET_BYTES_PER_SEC);

    await ctxA.close();
    await ctxB.close();
  });
});
