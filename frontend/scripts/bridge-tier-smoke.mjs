// Tier collision smoke. Bridge decks (tier 1) must NOT block ground
// placements (tier 0) below them, and vice versa. Bridge ramps occupy
// ground at one end and the deck tier at the other so they correctly
// chain into both ground roads and bridge spans.
import { chromium } from '@playwright/test';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';
let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track, null, { timeout: 15000 });

const fails = [];
const cases = await p.evaluate(() => {
  const { track } = window.__studio;
  const out = [];

  // Case 1: bridge at (0,0) deck spans (0,0)+(0,1) on tier 1.
  // A straight road MUST be placeable at (0,0) on the ground tier.
  track.clear();
  const bridge = track.place('bridge', 0, 0, 0);
  const groundUnder = track.place('straight', 0, 0, 0);
  out.push({
    name: 'straight under bridge cell (0,0)',
    ok: !!bridge && !!groundUnder,
    detail: { bridge: !!bridge, groundUnder: !!groundUnder },
  });

  // Case 2: a second straight at (0,1) (under the other bridge cell) too.
  const groundUnder2 = track.place('straight', 0, 1, 0);
  out.push({
    name: 'straight under bridge cell (0,1)',
    ok: !!groundUnder2,
  });

  // Case 3: two bridges on the same deck cells must collide.
  track.clear();
  const a = track.place('bridge', 0, 0, 0);
  const b2 = track.place('bridge', 0, 0, 0);
  out.push({
    name: 'two bridges on same deck cells must collide',
    ok: !!a && !b2,
  });

  // Case 4: bridge_onramp at (0,0..0,1): cell (0,1) is deck → another deck
  // piece at (0,1) must be blocked, but a ground straight at (0,0) (under
  // the on-ramp's foot which IS ground) is itself blocked. A ground
  // straight at (0,1) however IS allowed (under the elevated end).
  track.clear();
  track.place('bridge_onramp', 0, 0, 0); // ground at z=0, deck at z=1
  const groundAtFoot = track.place('straight', 0, 0, 0); // foot is ground → conflict
  const groundAtTopFoot = track.place('straight', 0, 1, 0); // under elevated end → ok
  out.push({
    name: 'bridge_onramp foot blocks ground at z=0',
    ok: !groundAtFoot,
  });
  out.push({
    name: 'bridge_onramp elevated end clear at ground z=1',
    ok: !!groundAtTopFoot,
  });

  // Case 5: bridge chain — onramp(0,0) → bridge(0,2) → offramp(0,4),
  // all rotated so they line up south→north along Z. Confirm none collide.
  track.clear();
  const r1 = track.place('bridge_onramp',  0, 0, 0);
  const r2 = track.place('bridge',         0, 2, 0);
  const r3 = track.place('bridge_offramp', 0, 4, 0);
  out.push({
    name: 'onramp → bridge → offramp chain places cleanly',
    ok: !!r1 && !!r2 && !!r3,
  });

  // Case 6: a road UNDER the entire bridge span (0,2)+(0,3) at ground.
  const under1 = track.place('straight', 0, 2, 0);
  const under2 = track.place('straight', 0, 3, 0);
  out.push({
    name: 'straights pass under bridge span at ground tier',
    ok: !!under1 && !!under2,
  });

  return out;
});

for (const c of cases) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  ' + JSON.stringify(c.detail) : ''}`);
  if (!c.ok) fails.push(c.name);
}
await b.close();
console.log(`\n${fails.length === 0 ? 'OK ALL CLEAN' : `FAIL ${fails.length}/${cases.length}`}`);
process.exit(fails.length === 0 ? 0 : 1);
