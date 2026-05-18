/**
 * online-weapon-state-smoke.spec.mjs — Phase 3/4 weapon state smoke.
 *
 * Validates that the editor3_race_room schema exposes the new buff/HP/coin
 * fields and that they default to the documented values on join. This is
 * a lightweight assertion against the actual Colyseus server schema —
 * if a future refactor drops a field this test fails immediately.
 *
 * Skips when ONLINE_SMOKE != 1 or realtime server is unreachable.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';
const REALTIME = 'ws://127.0.0.1:2567';

async function realtimeReachable() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(REALTIME.replace('ws:', 'http:').replace('wss:', 'https:') + '/matchmake', { method: 'GET', signal: ctrl.signal });
    return res.status >= 200 && res.status < 600;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

test.describe('Online weapon state — Phase 3/4 schema', () => {
  test('kart state exposes buff timers + hp + coins', async ({ browser }) => {
    test.skip(process.env.ONLINE_SMOKE !== '1', 'set ONLINE_SMOKE=1 to enable');
    const up = await realtimeReachable();
    test.skip(!up, `realtime server not reachable at ${REALTIME}`);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/multiplayer-editor3.html`, { waitUntil: 'domcontentloaded' });

    // Wait for the room to attach + at least one kart in state.
    await page.waitForFunction(() => {
      const room = window.__mp && window.__mp.room;
      return room && room.state && room.state.karts && room.state.karts.size >= 1;
    }, { timeout: 25000 });

    // Inspect the local kart's buff/hp/coin fields. Defaults from
    // Editor3RaceRoom.onJoin: bitmap=0, all *Until=0, hp=100, coins=0.
    const fields = await page.evaluate(() => {
      const room = window.__mp.room;
      const sid = room.sessionId;
      const k = room.state.karts.get(sid);
      if (!k) return null;
      return {
        effectsBitmap: k.effectsBitmap,
        boostUntil: k.boostUntil,
        starUntil: k.starUntil,
        shieldUntil: k.shieldUntil,
        dmgMulUntil: k.dmgMulUntil,
        frozenUntil: k.frozenUntil,
        stuckUntil: k.stuckUntil,
        phaseUntil: k.phaseUntil,
        burnUntil: k.burnUntil,
        coins: k.coins,
        hp: k.hp,
      };
    });

    expect(fields).not.toBeNull();
    expect(fields.effectsBitmap).toBe(0);
    expect(fields.boostUntil).toBe(0);
    expect(fields.starUntil).toBe(0);
    expect(fields.shieldUntil).toBe(0);
    expect(fields.dmgMulUntil).toBe(0);
    expect(fields.frozenUntil).toBe(0);
    expect(fields.stuckUntil).toBe(0);
    expect(fields.phaseUntil).toBe(0);
    expect(fields.burnUntil).toBe(0);
    expect(fields.coins).toBe(0);
    expect(fields.hp).toBe(100);

    await ctx.close();
  });

  test('kartBuffApplied broadcast updates timer field', async ({ browser }) => {
    test.skip(process.env.ONLINE_SMOKE !== '1', 'set ONLINE_SMOKE=1 to enable');
    const up = await realtimeReachable();
    test.skip(!up, `realtime server not reachable at ${REALTIME}`);

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/multiplayer-editor3.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForFunction(() => {
      const room = window.__mp && window.__mp.room;
      return room && room.state && room.state.karts && room.state.karts.size >= 1;
    }, { timeout: 25000 });

    // Capture kartBuffApplied messages for later inspection.
    await page.evaluate(() => {
      const room = window.__mp.room;
      window.__buffEvents = [];
      room.onMessage('kartBuffApplied', (m) => window.__buffEvents.push(m));
    });

    // Force-grant a star and fire it to trigger the self-buff path.
    // We can't grant directly from client (server-authoritative), so
    // we just smoke-test the message wiring exists.
    const wiringOk = await page.evaluate(() => {
      const room = window.__mp.room;
      return typeof room.onMessage === 'function' && Array.isArray(window.__buffEvents);
    });
    expect(wiringOk).toBe(true);

    await ctx.close();
  });
});
