// Comprehensive segment hardening smoke. Runs against the live editor and
// verifies for every road segment:
//   1. Place → select → delete round-trip works (no zombie cells left).
//   2. Click any cell of a multi-cell footprint and confirm the placement
//      hit-tests back to the same id.
//   3. Auto-orient produces a connecting rotation when an existing piece's
//      open connector lands inside the candidate footprint.
//
// Exit code 1 on any failure.
import { chromium } from '@playwright/test';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';

let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.SEGMENT_KEYS, null, { timeout: 15000 });

const fails = [];
const log = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) fails.push(label);
};

// ── Round-trip per segment: place → cells claimed → remove → cells freed.
const roundtrip = await p.evaluate(() => {
  const { track, SEGMENT_KEYS, SEGMENTS } = window.__studio;
  const out = [];
  for (const key of SEGMENT_KEYS) {
    track.clear();
    const def = SEGMENTS[key];
    const pl = track.place(key, 100, 100, 0);
    const placed = !!pl;
    let claimed = 0;
    let cellsBefore = track.cells.size;
    if (pl) {
      const occ = track.occupiedCells(key, pl.gx, pl.gz, pl.rot);
      const expected = (def.span?.x || 1) * (def.span?.z || 1);
      claimed = (track.isOverlay(key) ? 0 : occ.length);
      track.remove(pl.id);
      const cellsAfter = track.cells.size;
      out.push({
        key, placed, expected,
        claimedAfterPlace: cellsBefore,
        leftoverAfterRemove: cellsAfter,
        ok: placed && cellsAfter === 0 && (track.isOverlay(key) || cellsBefore === expected),
      });
    } else {
      out.push({ key, placed: false, ok: false });
    }
  }
  return out;
});

console.log('\n[1] Place → claim → remove round-trip');
for (const r of roundtrip) {
  log(r.ok, `${r.key.padEnd(18)} placed=${r.placed} claimed=${r.claimedAfterPlace} leftover=${r.leftoverAfterRemove}${r.expected != null ? ` (expected ${r.expected})` : ''}`);
}

// ── Auto-orient adjacency: for every pair (A,B) where A has a connector,
// place A at origin then probe B at the cell A's first connector points
// to. Verify autoOrientRot returns a rot whose connector matches A's open
// edge (i.e. the resulting placement actually connects).
console.log('\n[2] Auto-orient pairwise adjacency');
const adj = await p.evaluate(() => {
  const { track, autoOrientRot, SEGMENT_KEYS, SEGMENTS } = window.__studio;
  // Use the same helpers the editor uses.
  const segMod = window.__studioSeg || {};
  // Re-import via dynamic import is tricky; replicate via track helpers.
  // We expose getWorldConnectors via __studio? No — use connectors directly.
  return import('/src/editor3/segments.js').then(({
    getConnectors, getWorldConnectors, sideDelta, oppositeSide, rotateSide,
  }) => {
    const out = [];
    const interesting = SEGMENT_KEYS.filter(k => !track.isOverlay(k) && k !== 'spawn');
    // Iterate every rotation of A as well — a previous bug only surfaced for
    // multi-cell pieces at rot=1 / rot=3.
    for (const a of interesting) {
      const connsA = getConnectors(a);
      if (!connsA.length) continue;
      for (const aRot of [0, 1, 2, 3]) {
        track.clear();
        const pa = track.place(a, 0, 0, aRot);
        if (!pa) { out.push({ a: `${a}@${aRot}`, b: '*', ok: false, reason: 'A failed to place' }); continue; }
        const wcA = getWorldConnectors(a, pa.gx, pa.gz, pa.rot);
        const c0 = wcA[0];
        const [dx, dz] = sideDelta(c0.side);
        const tgtGx = c0.gx + dx, tgtGz = c0.gz + dz;
        const expectedSide = oppositeSide(c0.side);
        for (const b of interesting) {
          if (b === a) continue;
          // Only expect a connection when SOME rotation of B placed at tgt
          // would actually land a connector at (tgt, expectedSide,
          // matching tier). Pairs that geometrically can't fit (e.g.
          // bridge_offramp deck-end → bridge_onramp deck-end on adjacent
          // cells — both want their deck on the FAR cell from anchor) are
          // skipped: they require an intermediate piece.
          let canFit = false;
          for (let testRot = 0; testRot < 4; testRot++) {
            const wcB = getWorldConnectors(b, tgtGx, tgtGz, testRot);
            if (wcB.some(c => c.gx === tgtGx && c.gz === tgtGz && c.side === expectedSide && (c.tier|0) === (c0.tier|0))) {
              canFit = true; break;
            }
          }
          if (!canFit) continue;
          const r = autoOrientRot(b, tgtGx, tgtGz, 0);
          let ok = false;
          if (r != null && track.isClear(b, tgtGx, tgtGz, r)) {
            const wcB = getWorldConnectors(b, tgtGx, tgtGz, r);
            ok = wcB.some(c => c.gx === tgtGx && c.gz === tgtGz && c.side === expectedSide && (c.tier|0) === (c0.tier|0));
          }
          out.push({ a: `${a}@${aRot}`, b, rot: r, ok, expectedSide, tgt: `(${tgtGx},${tgtGz})` });
        }
        track.remove(pa.id);
      }
    }
    return out;
  });
});
// Report only failures + summary
const totalAdj = adj.length;
const failsAdj = adj.filter(r => !r.ok);
for (const r of failsAdj) {
  console.log(`  ✗ ${r.a} → ${r.b} at ${r.tgt} side ${r.expectedSide}: rot=${r.rot}`);
}
log(failsAdj.length === 0, `pairwise adjacency: ${totalAdj - failsAdj.length}/${totalAdj} connected (failures listed above)`);

// ── Multi-cell hit-test: clicking any footprint cell resolves to the same id.
console.log('\n[3] Multi-cell hit-test');
const multiKeys = await p.evaluate(() => {
  const { SEGMENTS, SEGMENT_KEYS, track } = window.__studio;
  return SEGMENT_KEYS.filter(k => {
    const s = SEGMENTS[k]?.span;
    if (!s || (s.x <= 1 && s.z <= 1)) return false;
    // Overlays don't claim grid cells, so they are not addressable via
    // `track.getAt`. Skip them here — overlay-stacking is covered by its
    // own smoke (overlay-placement-smoke.mjs).
    return !track.isOverlay(k);
  });
});
const hitCheck = await p.evaluate(({ keys }) => {
  const { track, SEGMENTS } = window.__studio;
  return import('/src/editor3/segments.js').then(({ getCellTiers, getFootprint }) => {
    const out = [];
    for (const key of keys) {
      track.clear();
      const pl = track.place(key, 50, 50, 0);
      if (!pl) { out.push({ key, ok: false, reason: 'place failed' }); continue; }
      const fp = getFootprint(key);
      const tiers = getCellTiers(key);
      const ids = fp.map(([fx, fz], i) => track.getAt(50 + fx, 50 + fz, tiers[i] || 0)?.id);
      const allSameId = ids.every(id => id === pl.id);
      out.push({ key, ok: allSameId, ids });
      track.remove(pl.id);
    }
    return out;
  });
}, { keys: multiKeys });
for (const r of hitCheck) log(r.ok, `${r.key.padEnd(18)} ${r.ok ? 'all cells resolve to placement' : 'cells: '+JSON.stringify(r.ids)}`);

await b.close();
console.log(`\n${fails.length === 0 ? '✓ ALL CLEAN' : `✗ ${fails.length} failures:`}`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length === 0 ? 0 : 1);
