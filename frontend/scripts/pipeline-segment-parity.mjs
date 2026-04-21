/**
 * pipeline-segment-parity.mjs — End-to-end smoke test for the
 * TinkerTracks builder → game engine segment rendering pipeline.
 *
 * Validates EVERY registered segment type across every pipeline stage:
 *   1. Builder asset registry (TRACK_ASSETS)
 *   2. Builder grid placement (PIECE_DEFS)
 *   3. Serializer type pass-through (no type erasure)
 *   4. Game engine type resolution (CUSTOM_ARENA_TRACK_ASSETS + aliases)
 *   5. Game engine warp/fallback coverage (WARP_DEFS + fallback)
 *   6. Game engine span/footprint (SEGMENT_SPANS)
 *   7. Game engine port definitions (CUSTOM_ARENA_PORT_DEFS)
 *   8. Multi-cell anchor alignment consistency
 *
 * Usage:
 *   node scripts/pipeline-segment-parity.mjs
 *
 * Optional — run with the dev server live for an in-browser stage:
 *   HEADLESS=false node scripts/pipeline-segment-parity.mjs
 */

import { GRID_SIZE } from '../src/modules/track-placement.js';
import {
  resolveCustomArenaSegmentSpec,
  getFallbackSegmentFootprint,
  CUSTOM_ARENA_TRACK_ASSETS,
  getCustomArenaBasePorts,
} from '../src/modules/custom-arena-segments.js';

// ── Stage 0: Collect all the registries ──────────────────────
// We import these dynamically because the builder files use Three.js imports
// that will fail in plain Node.  Instead we parse what we need statically.

const GAME_ASSET_KEYS = new Set(CUSTOM_ARENA_TRACK_ASSETS.map(a => a.key));

// ── Builder-side segment keys (parsed from source) ───────────
// We can't directly import asset-loader.js / grid-placement.js because they
// depend on Three.js.  Instead we regex-extract all registered keys.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function extractKeys(filePath, pattern) {
  const src = readFileSync(join(ROOT, filePath), 'utf-8');
  const keys = new Set();
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const regex = new RegExp(pattern.source, flags);
  let match;
  while ((match = regex.exec(src)) !== null) {
    keys.add(match[1]);
  }
  return keys;
}

// TRACK_ASSETS keys from asset-loader.js: { key: 'xxx', ... }
const builderAssetKeys = extractKeys(
  'src/builder-v2/asset-loader.js',
  /key:\s*'([a-z0-9_-]+)'/,
);

// PIECE_DEFS keys from grid-placement.js: 'xxx': { ports: ...
const builderPieceKeys = extractKeys(
  'src/builder-v2/grid-placement.js',
  /^\s+'([a-z0-9_-]+)':\s*\{/m,
);

// WARP_DEFS keys from custom-arena-procedural.js
const gameWarpKeys = extractKeys(
  'src/modules/custom-arena-procedural.js',
  /^\s+'([a-z0-9_-]+)':\s*\(p\)/m,
);

// Builder warp keys from asset-loader.js: entries with both key: and warp:
// We split on entry boundaries to avoid cross-entry matching.
const builderWarpKeys = (() => {
  const src = readFileSync(join(ROOT, 'src/builder-v2/asset-loader.js'), 'utf-8');
  const keys = new Set();
  // Split on `{ key:` to get individual entries
  const entries = src.split(/\{\s*key:/);
  for (const entry of entries) {
    const keyMatch = entry.match(/^\s*'([a-z0-9_-]+)'/);
    if (keyMatch && entry.includes('warp:')) {
      keys.add(keyMatch[1]);
    }
  }
  return keys;
})();

// Builder procedural keys from asset-loader.js: build: true
const builderBuildKeys = extractKeys(
  'src/builder-v2/asset-loader.js',
  /key:\s*'([a-z0-9_-]+)'.*?build:\s*true/,
);

// Decoration keys (not track segments — should be excluded from game rendering)
const decorationKeys = new Set();
for (const key of builderAssetKeys) {
  if (key.startsWith('skr-deco') || key === 'skr-track-tents') {
    decorationKeys.add(key);
  }
}

// Segment-only keys (builder assets minus decorations)
const builderSegmentKeys = new Set(
  [...builderAssetKeys].filter(k => !decorationKeys.has(k)),
);

// ── Statistics ───────────────────────────────────────────────
let pass = 0;
let fail = 0;
let warn = 0;
const issues = [];

function check(ok, label, detail = '') {
  if (ok) {
    pass++;
  } else {
    fail++;
    issues.push({ label, detail });
    console.error(`  FAIL: ${label}${detail ? ' — ' + detail : ''}`);
  }
}

function advisory(ok, label, detail = '') {
  if (!ok) {
    warn++;
    console.warn(`  WARN: ${label}${detail ? ' — ' + detail : ''}`);
  }
}

// ── STAGE 1: Builder ↔ Game asset coverage ───────────────────
console.log('\n─── STAGE 1: Asset Registry Parity ───────────────────');

for (const key of builderSegmentKeys) {
  const resolved = resolveCustomArenaSegmentSpec(key);
  check(
    resolved !== null,
    `Game can resolve builder segment type '${key}'`,
    resolved ? `→ ${resolved.canonicalKey}` : 'resolveCustomArenaSegmentSpec returned null',
  );
}

// Reverse check: game assets not in builder
for (const key of GAME_ASSET_KEYS) {
  advisory(
    builderAssetKeys.has(key),
    `Game asset '${key}' exists in builder TRACK_ASSETS`,
  );
}

// ── STAGE 2: Warp parity ────────────────────────────────────
console.log('\n─── STAGE 2: Warp Definition Parity ──────────────────');

for (const key of builderWarpKeys) {
  check(
    gameWarpKeys.has(key),
    `Game has WARP_DEFS for builder warped type '${key}'`,
  );
}

for (const key of gameWarpKeys) {
  advisory(
    builderWarpKeys.has(key) || builderBuildKeys.has(key),
    `Game WARP_DEFS['${key}'] has a builder source (warp or build)`,
  );
}

// ── STAGE 3: Span/footprint consistency ─────────────────────
console.log('\n─── STAGE 3: Span / Footprint Consistency ─────────────');

// Extract builder span info by parsing TRACK_ASSETS entries with span:
const builderSpanSrc = readFileSync(join(ROOT, 'src/builder-v2/asset-loader.js'), 'utf-8');
const spanRegex = /key:\s*'([a-z0-9_-]+)'.*?span:\s*\{\s*x:\s*(\d+),\s*z:\s*(\d+)\s*\}/g;
const builderSpans = new Map();
let spanMatch;
while ((spanMatch = spanRegex.exec(builderSpanSrc)) !== null) {
  builderSpans.set(spanMatch[1], { x: Number(spanMatch[2]), z: Number(spanMatch[3]) });
}

for (const [key, builderSpan] of builderSpans) {
  const dims = getFallbackSegmentFootprint(key, GRID_SIZE);
  const gameSpanZ = Math.round(dims.length / GRID_SIZE);
  const gameSpanX = Math.round(dims.width / GRID_SIZE);
  check(
    gameSpanZ === builderSpan.z && gameSpanX === builderSpan.x,
    `Span match for '${key}'`,
    `builder ${builderSpan.x}×${builderSpan.z} vs game ${gameSpanX}×${gameSpanZ}`,
  );
}

// ── STAGE 4: Port definition coverage ───────────────────────
console.log('\n─── STAGE 4: Port Definition Coverage ─────────────────');

for (const key of builderSegmentKeys) {
  const ports = getCustomArenaBasePorts(key);
  // All track segments should have at least 1 port (except decorations)
  check(
    ports.length > 0,
    `Port defs exist for segment '${key}'`,
    `${ports.length} ports`,
  );
}

// ── STAGE 5: Serializer type pass-through ───────────────────
console.log('\n─── STAGE 5: Serializer Type Pass-Through ─────────────');

// Read the serializer source and verify no PLAYTEST_SEGMENT_TYPE_MAP references
const serializerSrc = readFileSync(
  join(ROOT, 'src/builder-v2/serializer.js'), 'utf-8',
);

check(
  !serializerSrc.includes('PLAYTEST_SEGMENT_TYPE_MAP['),
  'Serializer does NOT look up PLAYTEST_SEGMENT_TYPE_MAP',
  'Removed map should not be referenced in toPlaytestSegment',
);

// Verify toPlaytestSegment uses type as-is
const typePassThrough = /const\s+type\s*=\s*String\(segment\.type/;
check(
  typePassThrough.test(serializerSrc),
  'toPlaytestSegment passes type through as String(segment.type)',
);

// Verify PLAYTEST_WORLD_SCALE is applied consistently
const scaleMatch = serializerSrc.match(/const\s+PLAYTEST_WORLD_SCALE\s*=\s*(\d+)/);
check(
  scaleMatch && Number(scaleMatch[1]) === 3,
  'PLAYTEST_WORLD_SCALE is 3',
  scaleMatch ? `found ${scaleMatch[1]}` : 'not found',
);

// ── STAGE 6: Multi-cell anchor alignment ────────────────────
console.log('\n─── STAGE 6: Multi-Cell Anchor Alignment ──────────────');

const proceduralSrc = readFileSync(
  join(ROOT, 'src/modules/custom-arena-procedural.js'), 'utf-8',
);

check(
  proceduralSrc.includes('spanZ > 1'),
  'Game procedural module has multi-cell anchor alignment check',
);

check(
  proceduralSrc.includes('visual.position.z ='),
  'Game procedural module sets visual.position.z for multi-cell offset',
);

// Verify the formula matches builder expectation
const alignFormula = /visual\.position\.z\s*=\s*\(\(spanZ\s*-\s*1\)\s*\*\s*GRID_SIZE\)\s*\/\s*2/;
check(
  alignFormula.test(proceduralSrc),
  'Anchor alignment formula matches builder: ((spanZ-1)*GRID_SIZE)/2',
);

// ── STAGE 7: Pittsburgh bridge base resolution ──────────────
console.log('\n─── STAGE 7: Pittsburgh Bridge GLB Base ───────────────');

const pghKeys = [...GAME_ASSET_KEYS].filter(k => k.startsWith('pgh-'));
for (const key of pghKeys) {
  const asset = CUSTOM_ARENA_TRACK_ASSETS.find(a => a.key === key);
  check(
    asset?.base === 'skr-straight',
    `Pittsburgh bridge '${key}' has base 'skr-straight'`,
    `found base: '${asset?.base}'`,
  );
  check(
    gameWarpKeys.has(key),
    `Pittsburgh bridge '${key}' has game-side WARP_DEFS entry`,
  );
}

// ── STAGE 8: Coordinate system ──────────────────────────────
console.log('\n─── STAGE 8: Coordinate System ────────────────────────');

const clientSrc = readFileSync(
  join(ROOT, 'src/modules/realtime/colyseus-babylon-client.js'), 'utf-8',
);
check(
  clientSrc.includes('useRightHandedSystem = true'),
  'Babylon.js scene uses right-handed coordinate system (matches Three.js)',
);

// Verify rotation negation is applied
check(
  clientSrc.includes('rotation.y = -('),
  'Game engine negates Y rotation for segment placement',
);

// ── Summary ─────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════');
console.log(`  PASS: ${pass}   FAIL: ${fail}   WARN: ${warn}`);
console.log('═══════════════════════════════════════════════════════');

if (issues.length) {
  console.log('\nFailed checks:');
  for (const issue of issues) {
    console.log(`  • ${issue.label}${issue.detail ? ' — ' + issue.detail : ''}`);
  }
}

if (fail > 0) {
  console.log('\n✗ Pipeline parity audit FAILED');
  process.exit(1);
} else if (warn > 0) {
  console.log('\n⚠ Pipeline parity audit passed with warnings');
  process.exit(0);
} else {
  console.log('\n✓ Pipeline parity audit PASSED — all segments accounted for');
  process.exit(0);
}
