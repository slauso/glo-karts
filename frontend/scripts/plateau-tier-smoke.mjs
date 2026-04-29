// Plateau tier smoke. Plateau decks live on the mid tier (1) so a ground
// straight (tier 0) MUST be placeable directly underneath. Mirror tests
// for curved_plateau / curved_plateauR. Also confirm two plateaus can't
// stack on the same deck cell, and that ramp_up's elevated end (tier 1)
// allows a ground road below it.
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

const cases = await p.evaluate(() => {
  const { track } = window.__studio;
  const out = [];

  // Case 1: straight goes UNDER plateau.
  track.clear();
  const plateau = track.place('plateau', 0, 0, 0);
  const under   = track.place('straight', 0, 0, 0);
  out.push({ name: 'straight under plateau cell (0,0)', ok: !!plateau && !!under });

  // Case 2: two plateaus on the same deck cell collide.
  track.clear();
  const a = track.place('plateau', 0, 0, 0);
  const b2 = track.place('plateau', 0, 0, 0);
  out.push({ name: 'two plateaus on same deck cell must collide', ok: !!a && !b2 });

  // Case 3: straight under curved_plateau.
  track.clear();
  const cp = track.place('curved_plateau', 0, 0, 0);
  const cpUnder = track.place('straight', 0, 0, 0);
  out.push({ name: 'straight under curved_plateau cell (0,0)', ok: !!cp && !!cpUnder });

  // Case 4: straight under curved_plateauR.
  track.clear();
  const cpR = track.place('curved_plateauR', 0, 0, 0);
  const cpRUnder = track.place('straight', 0, 0, 0);
  out.push({ name: 'straight under curved_plateauR cell (0,0)', ok: !!cpR && !!cpRUnder });

  // Case 5: ramp_up — foot at z=0 (tier 0) blocks ground straight, but
  // the elevated end at z=1 (tier 1) leaves ground clear.
  track.clear();
  track.place('ramp_up', 0, 0, 0);
  const footBlocked = track.place('straight', 0, 0, 0); // foot is tier 0 → conflict
  const topClear    = track.place('straight', 0, 1, 0); // elevated end → ground clear
  out.push({ name: 'ramp_up foot blocks ground at z=0', ok: !footBlocked });
  out.push({ name: 'ramp_up elevated end clears ground at z=1', ok: !!topClear });

  // Case 6: ramp_up exit (tier 1) connects to plateau (tier 1) — both
  // pieces should chain on the upper tier without colliding.
  track.clear();
  const r = track.place('ramp_up', 0, 0, 0);
  const pl = track.place('plateau', 0, 2, 0);
  out.push({ name: 'ramp_up exit chains to plateau on tier 1', ok: !!r && !!pl });

  return out;
});

const fails = cases.filter(c => !c.ok);
for (const c of cases) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? '  ' + JSON.stringify(c.detail) : ''}`);
await b.close();
console.log(`\n${fails.length === 0 ? 'OK ALL CLEAN' : `FAIL ${fails.length}/${cases.length}`}`);
process.exit(fails.length === 0 ? 0 : 1);
