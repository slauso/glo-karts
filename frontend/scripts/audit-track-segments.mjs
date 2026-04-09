/**
 * audit-track-segments.mjs — Offline diagnostic script.
 *
 * Loads every builder track-piece GLB, computes raw bounding boxes,
 * auto-fit scale factors (matching asset-loader.js logic), and reports
 * per-piece edge positions so we can detect misalignment between pieces
 * that are supposed to snap together.
 *
 * Run:  node scripts/audit-track-segments.mjs
 */

import { readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

// ── Minimal GLB bbox parser (no GPU needed) ───────────────────
// We parse the binary GLB, extract the JSON chunk, then compute
// the bounding box from the accessor min/max in the POSITION attribute.

function parseGLB(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== 0x46546C67) throw new Error('Not a GLB file');

  // JSON chunk starts at offset 12
  const jsonLen = view.getUint32(12, true);
  const jsonStr = new TextDecoder().decode(buffer.slice(20, 20 + jsonLen));
  return JSON.parse(jsonStr);
}

function computeBBox(gltf) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  // Walk all meshes → primitives → POSITION accessor
  for (const mesh of (gltf.meshes || [])) {
    for (const prim of (mesh.primitives || [])) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx === undefined) continue;
      const accessor = gltf.accessors?.[posIdx];
      if (!accessor) continue;

      // Use accessor min/max (guaranteed for POSITION per glTF spec)
      if (accessor.min && accessor.max) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], accessor.min[i]);
          max[i] = Math.max(max[i], accessor.max[i]);
        }
      }
    }
  }

  // Also account for node transforms (translation only for simplicity)
  // Most STK-derived track pieces have identity transforms, but check anyway.
  // Full transform support would need matrix decomposition — skip for now.

  return { min, max };
}

// ── Piece definitions (mirror of grid-placement.js) ──────────
const DIR = { N: 0, E: 1, S: 2, W: 3 };

const PIECE_DEFS = {
  'straight':          { ports: [DIR.N, DIR.S], category: 'basic' },
  'wide':              { ports: [DIR.N, DIR.E, DIR.S, DIR.W], category: 'basic' },
  'corner-small':      { ports: [DIR.N, DIR.E], category: 'corner' },
  'corner-large':      { ports: [DIR.N, DIR.E], category: 'corner' },
  'curve':             { ports: [DIR.N, DIR.E], category: 'corner' },
  'bump-up':           { ports: [DIR.N, DIR.S], category: 'hill' },
  'bump-down':         { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-beginning':    { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-end':          { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-complete':     { ports: [DIR.N, DIR.S], category: 'hill' },
  'hill-complete-half':{ ports: [DIR.N, DIR.S], category: 'hill' },
  'corner-small-ramp': { ports: [DIR.N, DIR.E], category: 'hill' },
  'corner-large-ramp': { ports: [DIR.N, DIR.E], category: 'hill' },
  'bend':              { ports: [DIR.N, DIR.S], category: 'bend' },
  'bend-large':        { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-left':         { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-right':        { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-left-side':    { ports: [DIR.N, DIR.S], category: 'bend' },
  'skew-right-side':   { ports: [DIR.N, DIR.S], category: 'bend' },
  'cap-front':         { ports: [DIR.S], category: 'cap' },
  'cap-back':          { ports: [DIR.N], category: 'cap' },
  'end':               { ports: [DIR.S], category: 'cap' },
};

const TRACK_ASSETS = [
  { key: 'straight',             file: 'track-road-wide-straight.glb' },
  { key: 'corner-large',         file: 'track-road-wide-corner-large.glb' },
  { key: 'corner-small',         file: 'track-road-wide-corner-small.glb' },
  { key: 'corner-large-ramp',    file: 'track-road-wide-corner-large-ramp.glb' },
  { key: 'corner-small-ramp',    file: 'track-road-wide-corner-small-ramp.glb' },
  { key: 'curve',                file: 'track-road-wide-curve.glb' },
  { key: 'bend',                 file: 'track-road-wide-straight-bend.glb' },
  { key: 'bend-large',           file: 'track-road-wide-straight-bend-large.glb' },
  { key: 'bump-up',              file: 'track-road-wide-straight-bump-up.glb' },
  { key: 'bump-down',            file: 'track-road-wide-straight-bump-down.glb' },
  { key: 'hill-beginning',       file: 'track-road-wide-straight-hill-beginning.glb' },
  { key: 'hill-end',             file: 'track-road-wide-straight-hill-end.glb' },
  { key: 'hill-complete',        file: 'track-road-wide-straight-hill-complete.glb' },
  { key: 'hill-complete-half',   file: 'track-road-wide-straight-hill-complete-half.glb' },
  { key: 'skew-left',            file: 'track-road-wide-straight-skew-left.glb' },
  { key: 'skew-right',           file: 'track-road-wide-straight-skew-right.glb' },
  { key: 'skew-left-side',       file: 'track-road-wide-straight-skew-left-side.glb' },
  { key: 'skew-right-side',      file: 'track-road-wide-straight-skew-right-side.glb' },
  { key: 'cap-front',            file: 'track-road-wide-cap-front.glb' },
  { key: 'cap-back',             file: 'track-road-wide-cap-back.glb' },
  { key: 'wide',                 file: 'track-road-wide.glb' },
  { key: 'end',                  file: 'track-end.glb' },
];

const GRID_SIZE = 10;
const REF_SCALE = GRID_SIZE / 4.4;  // ≈ 2.2727 — cap for small pieces
const modelsDir = join(import.meta.dirname, '..', 'public', 'models', 'track');

// ── Main ──────────────────────────────────────────────────────

const results = [];
const issues = [];

for (const asset of TRACK_ASSETS) {
  const filePath = join(modelsDir, asset.file);
  let buf;
  try {
    buf = readFileSync(filePath);
  } catch {
    issues.push({ key: asset.key, issue: `FILE MISSING: ${asset.file}` });
    continue;
  }

  const gltf = parseGLB(buf);
  const { min, max } = computeBBox(gltf);

  const rawSizeX = max[0] - min[0];
  const rawSizeY = max[1] - min[1];
  const rawSizeZ = max[2] - min[2];
  const rawCenterX = (min[0] + max[0]) / 2;
  const rawCenterY = (min[1] + max[1]) / 2;
  const rawCenterZ = (min[2] + max[2]) / 2;

  // Auto-fit scaling (matches asset-loader.js — global REF_SCALE for ALL pieces)
  const scale = REF_SCALE;

  // After auto-fit: the wrapper's extent in world space
  const fittedSizeX = rawSizeX * scale;
  const fittedSizeZ = rawSizeZ * scale;
  const fittedSizeY = rawSizeY * scale;

  // The clone is positioned at (-center * scale) inside the wrapper,
  // so the wrapper center is at world (0,0,0) but the visual edges are:
  //   x: ±fittedSizeX/2, z: ±fittedSizeZ/2
  // North edge: z = -GRID_SIZE/2, South edge: z = +GRID_SIZE/2
  // West edge: x = -GRID_SIZE/2, East edge: x = +GRID_SIZE/2

  // But with non-uniform scale, X and Z will both be GRID_SIZE,
  // so the road surface at port edges may not align vertically.

  // Compute the Y at each edge. For a flat piece, all edges should be at y=0.
  // For hills/ramps, the entry/exit Y matters for connection alignment.
  // We approximate using the raw min Y at each z-extreme.

  // Key metric: aspect ratio tells us if the raw model is square
  const aspectXZ = rawSizeX / (rawSizeZ || 0.001);

  const def = PIECE_DEFS[asset.key];

  const result = {
    key: asset.key,
    category: def?.category || '?',
    ports: def?.ports?.map(p => ['N','E','S','W'][p]).join(',') || '?',
    rawSize: `${rawSizeX.toFixed(3)} × ${rawSizeY.toFixed(3)} × ${rawSizeZ.toFixed(3)}`,
    rawMin: `(${min[0].toFixed(3)}, ${min[1].toFixed(3)}, ${min[2].toFixed(3)})`,
    rawMax: `(${max[0].toFixed(3)}, ${max[1].toFixed(3)}, ${max[2].toFixed(3)})`,
    rawCenter: `(${rawCenterX.toFixed(3)}, ${rawCenterY.toFixed(3)}, ${rawCenterZ.toFixed(3)})`,
    aspectXZ: aspectXZ.toFixed(3),
    scale: scale.toFixed(4),
    fittedSize: `${fittedSizeX.toFixed(3)} × ${fittedSizeY.toFixed(3)} × ${fittedSizeZ.toFixed(3)}`,
    roadWidthAtEdge: (rawSizeX * scale).toFixed(3),   // road width at N/S port edge
  };

  results.push(result);

  // ── Flag issues ──
  if (min[1] < -0.01) {
    issues.push({
      key: asset.key,
      issue: `RAW MODEL EXTENDS BELOW Y=0: min.y = ${min[1].toFixed(3)}. Ground plane might be offset.`,
    });
  }

  // Check if the piece fills its cell in the port direction
  const maxDim = Math.max(rawSizeX, rawSizeZ);
  const minDim = Math.min(rawSizeX, rawSizeZ);
  if (minDim / maxDim < 0.3) {
    issues.push({
      key: asset.key,
      issue: `VERY THIN PIECE: aspect ${aspectXZ.toFixed(3)}, fitted ${fittedSizeX.toFixed(1)}×${fittedSizeZ.toFixed(1)}. May have visible gaps at edges.`,
    });
  }
}

// ── Report ──────────────────────────────────────────────────── 

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  TRACK SEGMENT AUDIT REPORT');
console.log('  GRID_SIZE =', GRID_SIZE);
console.log('════════════════════════════════════════════════════════════════\n');

// Table header
const hdr = 'Key'.padEnd(22) + 'Cat'.padEnd(8) + 'Ports'.padEnd(10) +
  'Raw X×Y×Z'.padEnd(28) + 'Scale'.padEnd(10) + 'Fitted X×Y×Z'.padEnd(28) + 'Road W';
console.log(hdr);
console.log('─'.repeat(hdr.length + 10));

for (const r of results) {
  console.log(
    r.key.padEnd(22) +
    r.category.padEnd(8) +
    r.ports.padEnd(10) +
    r.rawSize.padEnd(28) +
    r.scale.padEnd(10) +
    r.fittedSize.padEnd(28) +
    r.roadWidthAtEdge
  );
}

console.log('\n');

// ── Compatibility matrix: can each port pair connect? ──────────
// Two pieces connect if at the shared edge:
// 1. Both fitted X size == GRID_SIZE (guaranteed by auto-fit)
// 2. Road surface Y at the shared edge matches
// 3. Road surface WIDTH at edge matches (broken if non-uniform scale)

// Check all port pairs
console.log('════════════════════════════════════════════════════════════════');
console.log('  COMPATIBILITY ISSUES');
console.log('════════════════════════════════════════════════════════════════\n');

if (issues.length === 0) {
  console.log('  ✅ No issues found.');
} else {
  for (const iss of issues) {
    console.log(`  ❌ [${iss.key}] ${iss.issue}`);
  }
}

// ── Cross-piece edge compatibility ────────────────────────────
console.log('\n════════════════════════════════════════════════════════════════');
console.log('  CROSS-PIECE EDGE COMPATIBILITY');
console.log('════════════════════════════════════════════════════════════════\n');

// For each pair of pieces that share a port direction,
// check that the road width at the shared edge matches.
// With uniform scaling, proportions are preserved so road
// widths depend on the raw model width × uniform scale.

// Group by road width at edge
const widthMap = new Map();
for (const r of results) {
  const w = r.roadWidthAtEdge;
  if (!widthMap.has(w)) widthMap.set(w, []);
  widthMap.get(w).push(r.key);
}

console.log(`  Pieces grouped by road width at connection edge:`);
for (const [w, keys] of [...widthMap.entries()].sort((a,b) => parseFloat(b[0]) - parseFloat(a[0]))) {
  console.log(`\n    Width = ${w} units (${keys.length} pieces):`);
  for (const k of keys) console.log(`      ${k}`);
}

console.log('\n  NOTE: With uniform scaling, all pieces preserve their original');
console.log('  proportions. Road width groups show which pieces have matching');
console.log('  widths at connection edges.\n');

// ── Summary ───────────────────────────────────────────────────
console.log('════════════════════════════════════════════════════════════════');
console.log('  SUMMARY');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  Total pieces:    ${TRACK_ASSETS.length}`);
console.log(`  Issues found:    ${issues.length}`);
console.log(`  Road width groups: ${widthMap.size}`);
console.log('════════════════════════════════════════════════════════════════\n');
