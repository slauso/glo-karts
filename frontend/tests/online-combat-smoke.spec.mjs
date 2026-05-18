/**
 * online-combat-smoke.spec.mjs — Online (Colyseus) combat smoke.
 *
 * This spec is split between two roles:
 *   - HOST:  opens play.html?track=…&room=ABCD and grants itself a
 *            green shell.
 *   - GUEST: joins the same room, drives a couple of metres so the
 *            host receives transform updates.
 * After both pages stabilize we verify on the host that:
 *   1. window.__mp.ghosts has the guest entry
 *   2. window.__play.setCombatPeers has been called (peer count ≥ 1)
 *   3. Firing a green shell registers a projectile entity (smoke only —
 *      we don't assert a guaranteed hit because peer transforms lerp).
 *
 * Skips itself with `test.skip()` if the realtime server is not
 * reachable, so the suite stays green when only the frontend is running.
 */
import { test, expect } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174';
const REALTIME = 'ws://127.0.0.1:2567';

async function realtimeReachable() {
  // Quick AbortController-bounded probe so unreachable ports don't
  // stall for the full Windows TCP retry window.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(REALTIME.replace('ws:', 'http:').replace('wss:', 'https:') + '/matchmake', { method: 'GET', signal: ctrl.signal });
    return res.status >= 200 && res.status < 600;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

test.describe('Online combat — Colyseus smoke', () => {
  test('host sees guest as a combat peer + can fire a projectile', async ({ browser }) => {
    // Opt-in: only run when ONLINE_SMOKE=1 and the realtime server is
    // confirmed reachable. Default-skip keeps the suite green when only
    // the frontend is up.
    test.skip(process.env.ONLINE_SMOKE !== '1', 'set ONLINE_SMOKE=1 to enable Colyseus smoke');
    const up = await realtimeReachable();
    test.skip(!up, `realtime server not reachable at ${REALTIME}`);
    const room = 'TST' + Math.floor(Math.random() * 9000 + 1000);
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const host = await ctxA.newPage();
    const guest = await ctxB.newPage();

    // Build a tiny shared track via the host page.
    await host.goto(`${BASE}/editor.html`, { waitUntil: 'domcontentloaded' });
    const code = await host.evaluate(async (base) => {
      const td = await import(`${base}/src/editor3/track-data.js`);
      const t = new td.Track();
      for (let z = -3; z <= 3; z++) t.place('straight', 0, z, 0);
      return td.encodeTrack(t);
    }, BASE);

    const url = `${BASE}/play.html?track=${encodeURIComponent(code)}&room=${room}`;

    await Promise.all([
      host.goto(url, { waitUntil: 'domcontentloaded' }),
      guest.goto(url, { waitUntil: 'domcontentloaded' }),
    ]);

    // Wait for both to expose the combat hooks AND for at least one
    // ghost entry to appear on the host (= guest joined the room).
    await Promise.all([
      host.waitForFunction(() => window.__play && typeof window.__play.useActiveItem === 'function', { timeout: 25000 }),
      guest.waitForFunction(() => window.__play && window.__play.chassisBody, { timeout: 25000 }),
    ]);

    // Move the guest a bit so transforms broadcast.
    await guest.evaluate(() => {
      const cb = window.__play.chassisBody;
      cb.position.set(0, cb.position.y, -8);
    });

    // Wait for the host to register the guest as a peer in __mp.ghosts.
    await host.waitForFunction(
      () => window.__mp && window.__mp.ghosts && window.__mp.ghosts.size >= 1,
      { timeout: 15000 },
    );

    // Wait for setCombatPeers to be invoked at least once with a peer.
    const peerSeen = await host.waitForFunction(
      () => {
        // setCombatPeers writes into the closure; we can't read it
        // directly, so the proxy is __mp.ghosts being non-empty AND
        // the peer position being finite.
        const ghosts = window.__mp.ghosts;
        for (const g of ghosts.values()) {
          if (Number.isFinite(g.target.x)) return true;
        }
        return false;
      },
      { timeout: 10000 },
    );
    expect(peerSeen).toBeTruthy();

    // Host fires a green shell — verify projectile is alive.
    const result = await host.evaluate(() => {
      window.__play.grantWeapon('green_shell');
      window.__play.useActiveItem();
      return { projectiles: window.__play.projectileRuntime._projectiles.length };
    });
    expect(result.projectiles).toBeGreaterThanOrEqual(1);

    await ctxA.close();
    await ctxB.close();
  });
});
