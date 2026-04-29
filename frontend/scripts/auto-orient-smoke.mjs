// auto-orient-smoke.mjs — verify track segment auto-orientation snaps to neighbours.
import { chromium } from '@playwright/test';

const BASE = process.env.EDITOR_BASE || 'localhost:5173';
(async () => {
  let b;
  try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
  catch { b = await chromium.launch({ headless: true }); }
  const ctx = b.contexts()[0] ?? await b.newContext();
  const p = await ctx.newPage();
  await p.goto(`http://${BASE}/editor.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.__studio && !!window.__studio.autoOrientRot, null, { timeout: 15000 });

  const cases = [
    // Corner placed at the open end of a N/S straight chain — keep rot=0
    // (corner.S meets straight.N).
    { name: 'corner-after-straight-chain', setup: 'straight,0,0,0;straight,0,1,0', probe: ['corner', 0, 2], expected: 0 },
    // Straight west of a corner whose W edge is exposed → rot=1 so the
    // straight's E end meets the corner.
    { name: 'straight-west-of-corner',     setup: 'corner,0,0,0',                  probe: ['straight', -1, 0], expected: 1 },
    // Crossroads — symmetric, default rot=0 is fine.
    { name: 'crossroads-after-straight',   setup: 'straight,0,0,0;straight,0,1,0', probe: ['crossroads', 0, 2], expected: 0 },
    // 1×2 tunnel placed at the end of a straight chain → rot=0.
    { name: 'tunnel-after-straight-chain', setup: 'straight,0,0,0;straight,0,1,0', probe: ['tunnel', 0, 2], expected: 0 },
    // Tunnel placed east of an EW (rot=1) straight — tunnel is 1×2 so its
    // W connector lands two cells away from the anchor; no rotation can put
    // a connector at (anchor)|W. Auto-orient correctly returns null.
    { name: 'tunnel-east-of-EW-straight',  setup: 'straight,0,0,1',                probe: ['tunnel', 1, 0], expected: null },
    // No neighbour offering a connector → return null (preserve user's rot).
    { name: 'no-neighbour-isolated',       setup: '',                              probe: ['corner', 5, 5], expected: null },
    // Neighbour exists but doesn't face us — also null (we don't fight a wall).
    { name: 't_junction-into-NS-straight', setup: 'straight,0,0,0',                probe: ['t_junction', 1, 0], expected: null },
    // Off-ramp at end of a bridge — bridge.N at (0,1) faces (0,2). Bridge
    // off-ramp's connector layout matches → rot=0.
    { name: 'bridge_offramp-after-bridge', setup: 'bridge,0,0,0',                  probe: ['bridge_offramp', 0, 2], expected: 0 },
  ];

  let fail = 0;
  for (const c of cases) {
    const r = await p.evaluate(({ setup, probe }) => {
      const { track, autoOrientRot } = window.__studio;
      track.clear();
      if (setup) {
        for (const item of setup.split(';')) {
          const [k, gx, gz, rot] = item.split(',');
          track.place(k, +gx, +gz, +rot);
        }
      }
      return autoOrientRot(probe[0], probe[1], probe[2], 0);
    }, c);
    const ok = r === c.expected;
    console.log(`${ok ? '✓' : '✗'} ${c.name}: rot=${r} (expected ${c.expected})`);
    if (!ok) fail++;
  }
  await b.close();
  if (fail) { console.error(`\n${fail}/${cases.length} cases failed`); process.exit(1); }
  console.log(`\n${cases.length}/${cases.length} auto-orient cases passed`);
})();
