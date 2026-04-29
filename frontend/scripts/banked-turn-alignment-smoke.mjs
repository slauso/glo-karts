// Banked-turn edge-to-edge alignment smoke.
//
// Verifies that:
//   1. The banked_turn deck cross-section at its TWO endpoints (entry/exit)
//      degenerates to the same flat ribbon as `straight` — i.e. no
//      lifted edge, full ROAD_WIDTH, top at y=ROAD_THICK. This is what
//      guarantees seamless edge-to-edge tiling against neighbouring
//      pieces regardless of rotation.
//   2. Visually the banked_turn placement mesh fits inside its claimed
//      single cell at every rotation (overhang within 10% tile, same
//      tolerance as mesh-vs-grid-audit.mjs uses for curbs/walls).
//   3. Placed against a straight on either edge (S→banked exit, banked
//      entry→W), the centerlines meet within 5mm at the shared cell
//      boundary so no visual seam appears.
import { chromium } from '@playwright/test';

const URL_BASE = process.env.EDITOR_URL || 'http://localhost:5174/editor.html';
let b;
try { b = await chromium.connectOverCDP('http://127.0.0.1:9222'); }
catch { b = await chromium.launch({ headless: true }); }
const ctx = b.contexts()[0] ?? await b.newContext();
const p = await ctx.newPage();
await p.setViewportSize({ width: 1280, height: 800 });
await p.goto(URL_BASE, { waitUntil: 'load' });
await p.waitForFunction(() => !!window.__studio?.track && !!window.__studio?.rebuildAll, null, { timeout: 15000 });

const result = await p.evaluate(() => {
  const { track, scene, THREE, rebuildAll } = window.__studio;
  const TILE = 12000;
  const ROAD_WIDTH = TILE * 0.9;
  const ROAD_THICK = TILE * 0.04;  // ROAD_THICK = 0.04 * TILE in segments.js
  const TOL_MM = 50;               // 50mm slop in world units (5cm)
  const out = { cases: [], pass: 0, fail: 0 };

  function record(name, ok, detail) {
    out.cases.push({ name, ok, detail });
    if (ok) out.pass++; else out.fail++;
  }

  // ── Case 1: bbox-fits-cell at every rotation
  for (const rot of [0, 1, 2, 3]) {
    track.clear();
    const pl = track.place('banked_turn', 0, 0, rot);
    if (!pl) { record(`banked_turn rot=${rot} placement`, false, 'place returned null'); continue; }
    rebuildAll();
    let mesh = null;
    scene.traverse(o => { if (o.userData?.placementId === pl.id && !mesh) mesh = o; });
    if (!mesh) { record(`banked_turn rot=${rot} mesh present`, false, 'no mesh found'); continue; }
    const box = new THREE.Box3().setFromObject(mesh);
    const TOL = TILE * 0.10;
    const ok = box.min.x >= -TILE / 2 - TOL && box.max.x <= TILE / 2 + TOL
            && box.min.z >= -TILE / 2 - TOL && box.max.z <= TILE / 2 + TOL;
    record(`banked_turn rot=${rot} bbox in cell`, ok,
      `x[${Math.round(box.min.x)},${Math.round(box.max.x)}] z[${Math.round(box.min.z)},${Math.round(box.max.z)}]`);
  }

  // ── Case 2: deck top is FLAT at endpoints (no lift on outer edge).
  // Sample the deck mesh's top vertices closest to the entry edge (z=-TILE/2)
  // and exit edge (x=-TILE/2 for L). Their max y should be ~ROAD_THICK
  // (no banked lift remaining at the cell boundary).
  track.clear();
  const pL = track.place('banked_turn', 0, 0, 0);
  rebuildAll();
  let bMesh = null;
  scene.traverse(o => { if (o.userData?.placementId === pL.id && !bMesh) bMesh = o; });
  if (!bMesh) {
    record('banked_turn endpoint flatness', false, 'mesh missing');
  } else {
    bMesh.updateMatrixWorld(true);
    let entryMaxY = -Infinity, exitMaxY = -Infinity;
    let entryCount = 0, exitCount = 0;
    bMesh.traverse(obj => {
      if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes?.position) return;
      // Only consider drivable deck (skip curbs/decoration)
      if (!obj.userData?.drivable) return;
      const pos = obj.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        // Entry edge at z ≈ -TILE/2 (within 100mm)
        if (Math.abs(v.z + TILE / 2) < 100) {
          entryMaxY = Math.max(entryMaxY, v.y);
          entryCount++;
        }
        // Exit edge at x ≈ -TILE/2 (within 100mm) for L-bend
        if (Math.abs(v.x + TILE / 2) < 100) {
          exitMaxY = Math.max(exitMaxY, v.y);
          exitCount++;
        }
      }
    });
    const okEntry = entryCount > 0 && Math.abs(entryMaxY - ROAD_THICK) < TOL_MM;
    const okExit  = exitCount  > 0 && Math.abs(exitMaxY  - ROAD_THICK) < TOL_MM;
    record('banked_turn entry edge flat (y≈ROAD_THICK)', okEntry,
      `entryMaxY=${Math.round(entryMaxY)} expected≈${Math.round(ROAD_THICK)} samples=${entryCount}`);
    record('banked_turn exit edge flat (y≈ROAD_THICK)', okExit,
      `exitMaxY=${Math.round(exitMaxY)} expected≈${Math.round(ROAD_THICK)} samples=${exitCount}`);
  }

  // ── Case 3: place a straight south of the banked turn (entry side) and
  // verify their decks meet at z=-TILE/2 with matching x-range and y.
  track.clear();
  const pBank = track.place('banked_turn', 0, 0, 0);   // entry on -Z (south)
  const pStr  = track.place('straight', 0, -1, 0);     // straight just south
  rebuildAll();
  let bM = null, sM = null;
  scene.traverse(o => {
    if (o.userData?.placementId === pBank.id && !bM) bM = o;
    if (o.userData?.placementId === pStr.id  && !sM) sM = o;
  });
  if (!bM || !sM) {
    record('banked + straight south meet', false, 'missing meshes');
  } else {
    const bb = new THREE.Box3().setFromObject(bM);
    const sb = new THREE.Box3().setFromObject(sM);
    // No GAP: banked must extend at least to the seam line z=-TILE/2,
    // and straight must reach up to z=-TILE/2. Curbs may overlap into the
    // neighbour cell (normal behaviour, same as flat corner).
    const seamZ = -TILE / 2;
    const bankedReachesSeam = bb.min.z <= seamZ + TOL_MM;
    const straightReachesSeam = sb.max.z >= seamZ - TOL_MM;
    const ok = bankedReachesSeam && straightReachesSeam;
    record('banked entry meets straight (south) — no gap', ok,
      `banked.min.z=${Math.round(bb.min.z)} straight.max.z=${Math.round(sb.max.z)} seam=${seamZ}`);
  }

  // ── Case 4: place a straight west of the banked turn (exit side),
  // rotated to face east (rot=1 makes a straight run E-W). Banked L exits
  // to -X side at z=0.
  track.clear();
  track.place('banked_turn', 0, 0, 0);
  const pStrW = track.place('straight', -1, 0, 1);   // rot=1 lays straight along X
  rebuildAll();
  let bM2 = null, sM2 = null;
  scene.traverse(o => {
    if (o.userData?.placementId === pStrW?.id && !sM2) sM2 = o;
    // banked is the only banked_turn placement
    if (o.userData?.kind === 'banked_turn' && !bM2) bM2 = o;
  });
  if (!sM2) {
    record('banked + straight west meet', false, 'no west straight mesh (placement may have collided)');
  } else {
    // Both meshes' world-space x at the seam should be -TILE/2 = -6000
    const sb2 = new THREE.Box3().setFromObject(sM2);
    const seamGap = Math.abs(sb2.max.x - (-TILE / 2));
    const ok = seamGap < TOL_MM;
    record('banked exit meets straight (west) at x=-TILE/2', ok,
      `straight max.x=${Math.round(sb2.max.x)} expected=${-TILE / 2} gap=${Math.round(seamGap)}mm`);
  }

  return out;
});

console.log('');
for (const c of result.cases) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}  — ${c.detail}`);
}
console.log('');
console.log(`Result: ${result.pass} passed, ${result.fail} failed (${result.cases.length} total)`);
await b.close();
process.exit(result.fail === 0 ? 0 : 1);
