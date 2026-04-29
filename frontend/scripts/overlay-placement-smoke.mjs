// overlay-placement-smoke.mjs — Phase 1 combat overlays.
// Verifies that pickup / boost / modifier overlays:
//   1. Place freely on top of road segments (no cell collision).
//   2. Allow road segments to be placed on the same cell after them.
//   3. Allow MULTIPLE overlays to share a single cell (e.g. boost + coin).
//   4. Round-trip through encodeTrack/decodeTrack with their runtime
//      metadata intact and re-attach to the same world cells.
//   5. Surface a runtime registry entry per overlay placement.
//
// Runs against the live editor at EDITOR_URL (default localhost:5174).
// Exits non-zero on any failure.
import { chromium } from '@playwright/test';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';
const OVERLAY_KEYS = [
  'item_box', 'weapon_crate_heavy', 'health_orb', 'coin_pickup',
  'boost_pad', 'super_boost_pad', 'oil_slick', 'slow_strip', 'repair_strip',
];

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

// ── 1. Each overlay reports overlay:true and runtime metadata.
const meta = await p.evaluate((keys) => {
  const { SEGMENTS, track } = window.__studio;
  return import('/src/editor3/segments.js').then(({ getRuntime, isOverlaySegment }) => {
    return keys.map(k => ({
      key: k,
      def: !!SEGMENTS[k],
      overlay: !!SEGMENTS[k]?.overlay,
      isOverlay: track.isOverlay(k),
      isOverlaySeg: isOverlaySegment(k),
      runtime: getRuntime(k),
    }));
  });
}, OVERLAY_KEYS);

console.log('\n[1] Overlay flag + runtime metadata');
for (const m of meta) {
  log(m.def && m.overlay && m.isOverlay && m.isOverlaySeg && !!m.runtime,
    `${m.key.padEnd(20)} overlay=${m.overlay} runtime.kind=${m.runtime?.kind}`);
}

// ── 2. Place a straight, then drop each overlay on top → both coexist.
console.log('\n[2] Overlay sits on top of road');
const stacking = await p.evaluate((keys) => {
  const { track } = window.__studio;
  const out = [];
  for (const k of keys) {
    track.clear();
    const road = track.place('straight', 0, 0, 0);
    const overlay = track.place(k, 0, 0, 0);
    const cellOccupiedByRoad = track.cells.get(track.cellKey(0, 0, 0)) === road.id;
    const overlayPlaced = !!overlay;
    const overlayClaimedZeroCells = track.cells.size === 1; // only the road
    out.push({ k, road: !!road, overlayPlaced, cellOccupiedByRoad, overlayClaimedZeroCells });
  }
  track.clear();
  return out;
}, OVERLAY_KEYS);
for (const r of stacking) {
  log(r.road && r.overlayPlaced && r.cellOccupiedByRoad && r.overlayClaimedZeroCells,
    `${r.k.padEnd(20)} road=${r.road} overlay=${r.overlayPlaced} cellHeldByRoad=${r.cellOccupiedByRoad} cells=1`);
}

// ── 3. Multiple overlays on the SAME cell coexist.
console.log('\n[3] Multiple overlays on same cell');
const multi = await p.evaluate(() => {
  const { track } = window.__studio;
  track.clear();
  const r = track.place('straight', 5, 5, 0);
  const a = track.place('item_box', 5, 5, 0);
  const c = track.place('coin_pickup', 5, 5, 0);
  const bp = track.place('boost_pad', 5, 5, 0);
  const ids = [r, a, c, bp].map(p => p?.id || null);
  const total = track.placements.size;
  const cellsHeld = track.cells.size;
  track.clear();
  return { ids, total, cellsHeld };
});
log(multi.ids.every(id => id != null) && multi.total === 4 && multi.cellsHeld === 1,
  `4 placements (road+3 overlays), cells held by road only: total=${multi.total} cells=${multi.cellsHeld}`);

// ── 4. Drop overlay first, then road on the same cell — road still places.
console.log('\n[4] Overlay does not block subsequent road placement');
const order = await p.evaluate(() => {
  const { track } = window.__studio;
  track.clear();
  const a = track.place('item_box', 7, 7, 0);
  const r = track.place('straight', 7, 7, 0);
  const ok = !!a && !!r && track.cells.size === 1;
  track.clear();
  return { ok, aId: a?.id, rId: r?.id };
});
log(order.ok, `overlay-then-road: a=${order.aId} r=${order.rId}`);

// ── 5. Encode / decode round-trip preserves overlay placements + runtime.
console.log('\n[5] Encode/decode round-trip');
const trip = await p.evaluate((keys) => {
  const { track } = window.__studio;
  return import('/src/editor3/track-data.js').then(({ encodeTrack, decodeTrack }) => {
    return import('/src/editor3/segments.js').then(({ buildRuntimeRegistry }) => {
      track.clear();
      const expected = [];
      // Lay a row of straights and stack each overlay on cell (i,0).
      for (let i = 0; i < keys.length; i++) {
        track.place('straight', i, 0, 0);
        track.place(keys[i], i, 0, 0);
        expected.push(keys[i]);
      }
      const code = encodeTrack(track);
      const decoded = decodeTrack(code);
      const placedKeys = decoded ? decoded.all().filter(p => keys.includes(p.key)).map(p => p.key) : [];
      const reg = decoded ? buildRuntimeRegistry(decoded.all()) : [];
      return {
        codeLen: code.length,
        decoded: !!decoded,
        keysOk: keys.every(k => placedKeys.includes(k)),
        registryCount: reg.length,
        registryKinds: Array.from(new Set(reg.map(r => r.kind))).sort(),
      };
    });
  });
}, OVERLAY_KEYS);
log(trip.decoded && trip.keysOk && trip.registryCount === OVERLAY_KEYS.length,
  `code=${trip.codeLen}B decoded=${trip.decoded} keysOk=${trip.keysOk} reg=${trip.registryCount} kinds=${JSON.stringify(trip.registryKinds)}`);

await b.close();
console.log(`\n${fails.length === 0 ? '✓ ALL CLEAN' : `✗ ${fails.length} failures:`}`);
for (const f of fails) console.log('   ' + f);
process.exit(fails.length === 0 ? 0 : 1);
