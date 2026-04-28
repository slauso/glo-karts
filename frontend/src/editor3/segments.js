/**
 * segments.js — UNIFIED segment registry.
 *
 * Each segment definition describes its geometry as a list of primitive
 * "blocks" (cuboids, ramps). The same definition is used by:
 *   - the editor (to build a Three.Group preview)
 *   - the playtest runtime (to build matching cannon-es colliders)
 *
 * This guarantees what you see is what you drive on. No translation layer.
 *
 * Coordinate convention:
 *   - one cell = TILE units along X and Z
 *   - the cell is centered on (0,0,0) in local space
 *   - +Z is "forward" / piece travel direction
 *   - rotation in editor is multiples of 90° around +Y (in radians)
 */

// Tile sized for Mario-Kart-like proportions. Reference targets:
//   - kart length ~2.0m (chassis HZ=1.0)
//   - kart width  ~1.2m (chassis HX=0.6, capped to 1.4 in kart-loader)
//   - road width  ~10.8m → kart width is ~11% of road, MK8 ratio
// TILE bumped from 7 → 12 so karts no longer dwarf the segments.
export const TILE = 12;         // world units per grid cell
export const ROAD_WIDTH = TILE * 0.9;
export const ROAD_THICK = 0.5;
export const WALL_HEIGHT = 1.6;
export const WALL_THICK = 0.5;

/**
 * @typedef {Object} Block
 * @property {'box'|'ramp'} kind
 * @property {[number,number,number]} size    — full extents x,y,z (local, before rotation)
 * @property {[number,number,number]} pos     — center position
 * @property {number} [rotY]                  — local Y rotation in radians (default 0)
 * @property {number} [rotX]                  — local X rotation (used by ramps)
 * @property {number} color                   — hex color for material
 * @property {boolean} [drivable]             — whether kart can drive on this surface
 * @property {boolean} [solid]                — whether physics collider exists (default true)
 */

const ROAD_COLOR = 0x3a3f4b;
const CURB_R = 0xd0312d;
const CURB_W = 0xf0f0f0;
const WALL_COLOR = 0x6b7280;
const FINISH_COLOR = 0xfbbf24;
const RAMP_COLOR = 0x4f5663;

function deck(extentZ = TILE) {
  return {
    kind: 'box',
    size: [ROAD_WIDTH, ROAD_THICK, extentZ],
    pos: [0, ROAD_THICK / 2, 0],
    color: ROAD_COLOR,
    drivable: true,
  };
}

function curbStripes(extentZ = TILE) {
  // Red/white curbs along both long edges
  const out = [];
  const stripeW = 0.18;
  const stripeLen = extentZ / 5;
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (ROAD_WIDTH / 2 - stripeW / 2);
    for (let i = 0; i < 5; i++) {
      const z = -extentZ / 2 + stripeLen * (i + 0.5);
      out.push({
        kind: 'box',
        size: [stripeW, 0.06, stripeLen * 0.95],
        pos: [x, ROAD_THICK + 0.03, z],
        color: i % 2 === 0 ? CURB_R : CURB_W,
        solid: false,
      });
    }
  }
  return out;
}

function sideWalls(extentZ = TILE) {
  return [
    {
      kind: 'box',
      size: [WALL_THICK, WALL_HEIGHT, extentZ],
      pos: [(TILE / 2) - WALL_THICK / 2, ROAD_THICK + WALL_HEIGHT / 2, 0],
      color: WALL_COLOR,
    },
    {
      kind: 'box',
      size: [WALL_THICK, WALL_HEIGHT, extentZ],
      pos: [-(TILE / 2) + WALL_THICK / 2, ROAD_THICK + WALL_HEIGHT / 2, 0],
      color: WALL_COLOR,
    },
  ];
}

// ────────────────────────────────────────────────────────────────
// Segment definitions
// ────────────────────────────────────────────────────────────────

/** @type {Object.<string, {label:string, span:{x:number,z:number}, blocks:Block[], category:string}>} */
export const SEGMENTS = {
  straight: {
    label: 'Straight',
    category: 'road',
    span: { x: 1, z: 1 },
    // No side walls: tracks tile cleanly when laid next to each other.
    // Curbs are drawn so the road still visually frames the racing line.
    blocks: [deck(), ...curbStripes()],
  },

  // L-bend corner. Default (cornerL) enters at the -Z edge and exits at the -X edge.
  // Built as a full-cell flat deck so it tiles seamlessly with neighbouring straights.
  // The inside-edge curb is drawn to telegraph the turn direction.
  corner: {
    label: 'Corner L',
    category: 'road',
    span: { x: 1, z: 1 },
    blocks: cornerBlocks(false),
  },

  cornerR: {
    label: 'Corner R',
    category: 'road',
    span: { x: 1, z: 1 },
    blocks: cornerBlocks(true),
  },

  ramp_up: {
    label: 'Ramp Up',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: rampBlocks(0, TILE * 0.6, TILE * 2),
  },

  ramp_down: {
    label: 'Ramp Down',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: rampBlocks(TILE * 0.6, 0, TILE * 2),
  },

  // Flat plateau at the top of a ramp
  plateau: {
    label: 'Plateau',
    category: 'height',
    span: { x: 1, z: 1 },
    blocks: [
      { kind: 'box', size: [ROAD_WIDTH, ROAD_THICK, TILE], pos: [0, TILE * 0.6 + ROAD_THICK / 2, 0], color: ROAD_COLOR, drivable: true },
      // support pillars (visual only)
      { kind: 'box', size: [ROAD_WIDTH * 0.8, TILE * 0.6, 0.3], pos: [0, TILE * 0.3, -TILE / 2 + 0.15], color: WALL_COLOR },
      { kind: 'box', size: [ROAD_WIDTH * 0.8, TILE * 0.6, 0.3], pos: [0, TILE * 0.3, TILE / 2 - 0.15], color: WALL_COLOR },
    ],
  },

  finish: {
    label: 'Finish',
    category: 'special',
    span: { x: 1, z: 1 },
    blocks: [
      deck(),
      // Yellow checker line across the road
      { kind: 'box', size: [ROAD_WIDTH, 0.05, 0.5], pos: [0, ROAD_THICK + 0.03, 0], color: FINISH_COLOR, solid: false },
      // Side gantry posts (decorative only — never block the kart)
      { kind: 'box', size: [0.3, 2.5, 0.3], pos: [(TILE / 2) - 0.4, ROAD_THICK + 1.25, 0], color: FINISH_COLOR, solid: false },
      { kind: 'box', size: [0.3, 2.5, 0.3], pos: [-(TILE / 2) + 0.4, ROAD_THICK + 1.25, 0], color: FINISH_COLOR, solid: false },
      // Top crossbar
      { kind: 'box', size: [TILE, 0.3, 0.3], pos: [0, ROAD_THICK + 2.5, 0], color: FINISH_COLOR, solid: false },
    ],
    isFinish: true,
  },

  spawn: {
    label: 'Spawn',
    category: 'special',
    span: { x: 1, z: 1 },
    blocks: [
      deck(),
      // Glowing spawn marker
      { kind: 'box', size: [ROAD_WIDTH * 0.6, 0.05, ROAD_WIDTH * 0.6], pos: [0, ROAD_THICK + 0.03, 0], color: 0x00e5ff, solid: false },
    ],
    isSpawn: true,
  },

  // ── Junctions & wide road ─────────────────────────────────────
  wide: {
    label: 'Wide Plaza',
    category: 'junction',
    span: { x: 2, z: 2 },
    // 2x2 deck centered between the four cells. Anchor cell is the -X/-Z corner,
    // so the deck centre sits at (+TILE/2, _, +TILE/2).
    blocks: wideDeckBlocks(),
  },

  t_junction: {
    label: 'T-Junction',
    category: 'junction',
    span: { x: 1, z: 1 },
    blocks: tJunctionBlocks(),
  },

  crossroads: {
    label: 'Crossroads',
    category: 'junction',
    span: { x: 1, z: 1 },
    blocks: crossroadsBlocks(),
  },

  // ── Banked turn ──────────────────────────────────────────────
  // Single-cell 90° banked corner. Outside edge of the arc is lifted so
  // karts can carry more speed through the bend.
  banked_turn: {
    label: 'Banked Turn',
    category: 'road',
    span: { x: 1, z: 1 },
    blocks: bankedTurnBlocks(),
  },

  // ── Bumps & hills ────────────────────────────────────────────
  bump_up: {
    label: 'Bump',
    category: 'height',
    span: { x: 1, z: 1 },
    // Single cell with a small (~0.4u) raised bump in the middle. Drivable.
    blocks: bumpBlocks(0.4, 1),
  },
  hill_complete: {
    label: 'Rolling Hill',
    category: 'height',
    span: { x: 1, z: 2 },
    // Up-and-over hill in 2 cells. Gentle parabola approximated by 4 short ramps.
    blocks: rollingHillBlocks(TILE * 0.25, TILE * 2),
  },
  jump_ramp: {
    label: 'Jump Ramp',
    category: 'height',
    span: { x: 1, z: 1 },
    // Short kicker ramp that launches the kart. Rises ~1.2u over 1 cell.
    blocks: rampBlocks(0, 1.2, TILE).map((b, i) => ({
      ...b,
      // shrink to 1-cell length
      size: i === 0 ? [ROAD_WIDTH, ROAD_THICK, Math.sqrt(1.2 * 1.2 + TILE * TILE)] : b.size,
    })),
  },

  // ── Bridge (deck spans 1×2 elevated) ─────────────────────────
  bridge: {
    label: 'Bridge',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: bridgeBlocks(TILE * 0.6, TILE * 2),
  },
  bridge_onramp: {
    label: 'Bridge On-Ramp',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: rampBlocks(0, TILE * 0.6, TILE * 2),
  },
  bridge_offramp: {
    label: 'Bridge Off-Ramp',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: rampBlocks(TILE * 0.6, 0, TILE * 2),
  },

  // ── Tunnel (straight + arched roof) ──────────────────────────
  tunnel: {
    label: 'Tunnel',
    category: 'special',
    span: { x: 1, z: 2 },
    blocks: tunnelBlocks(TILE * 2),
  },

  // ── End caps ─────────────────────────────────────────────────
  cap_end: {
    label: 'End Cap',
    category: 'special',
    span: { x: 1, z: 1 },
    // Drivable straight + a wall on the +Z side closing off the dead end.
    blocks: [
      deck(),
      ...curbStripes(),
      { kind: 'box', size: [TILE, WALL_HEIGHT, WALL_THICK], pos: [0, ROAD_THICK + WALL_HEIGHT / 2, TILE / 2 - WALL_THICK / 2], color: WALL_COLOR },
    ],
  },
};

// ── helpers for parametric pieces ──────────────────────────────

function cornerBlocks(mirror) {
  // Full-cell flat deck so corners tile seamlessly with straights, regardless
  // of rotation. The "corner-ness" is telegraphed by a diagonal curb strip
  // along the *inside* edge of the L-bend.
  //
  // Convention: corner L (mirror=false) connects the -Z edge (incoming) to
  // the -X edge (outgoing). Corner R (mirror=true) connects -Z to +X.
  // The inside corner is therefore at (-x_sign * TILE/2, 0, -TILE/2).
  const blocks = [];
  // Deck fills the whole cell
  blocks.push({
    kind: 'box',
    size: [TILE, ROAD_THICK, TILE],
    pos: [0, ROAD_THICK / 2, 0],
    color: ROAD_COLOR,
    drivable: true,
  });
  // Outside-edge curb: red/white stripes along the outside of the arc.
  // For corner L (mirror=false) outside corner is at (+TILE/2, +TILE/2).
  // For corner R (mirror=true) outside corner is at (-TILE/2, +TILE/2).
  const outsideX = mirror ? -TILE / 2 : TILE / 2;
  const outsideZ = TILE / 2;
  const STRIPES = 5;
  const stripeLen = 0.55;
  for (let i = 0; i < STRIPES; i++) {
    // Param from 0 → entry edge (-Z) to 1 → exit edge (±X)
    const t = (i + 0.5) / STRIPES;
    const angle = mirror
      ? Math.PI + (Math.PI / 2) * t   // from -Z (pi) to +X (3pi/2)
      : -(Math.PI / 2) * t + Math.PI; // from -Z (pi) to -X (pi/2)... adjust
    // Compute stripe position along the outer arc of radius R = TILE (from inside corner)
    const R = TILE * 0.85;
    const insideX = -outsideX;
    const insideZ = -outsideZ;
    const px = insideX + Math.cos(angle) * R;
    const pz = insideZ + Math.sin(angle) * R;
    // Tangent angle for stripe orientation
    const tan = angle + Math.PI / 2;
    blocks.push({
      kind: 'box',
      size: [0.18, 0.06, stripeLen],
      pos: [px, ROAD_THICK + 0.03, pz],
      rotY: tan,
      color: i % 2 === 0 ? CURB_R : CURB_W,
      solid: false,
    });
  }
  return blocks;
}

function rampBlocks(yStart, yEnd, lengthZ) {
  // Single tilted box bridging start->end heights along Z.
  // The kart drives on its top face.
  const dy = yEnd - yStart;
  const dz = lengthZ;
  const length = Math.sqrt(dy * dy + dz * dz);
  const angle = Math.atan2(dy, dz);              // pitch around X
  const cy = (yStart + yEnd) / 2 + ROAD_THICK / 2;
  const cz = lengthZ / 2 - TILE / 2;             // ramp's first cell anchor at -TILE/2
  return [
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, length],
      pos: [0, cy, cz],
      rotX: -angle,                               // tilt forward
      color: RAMP_COLOR,
      drivable: true,
    },
    // Side rails along the ramp
    {
      kind: 'box',
      size: [WALL_THICK, WALL_HEIGHT, length],
      pos: [(TILE / 2) - WALL_THICK / 2, cy + WALL_HEIGHT / 2 + 0.05, cz],
      rotX: -angle,
      color: WALL_COLOR,
    },
    {
      kind: 'box',
      size: [WALL_THICK, WALL_HEIGHT, length],
      pos: [-(TILE / 2) + WALL_THICK / 2, cy + WALL_HEIGHT / 2 + 0.05, cz],
      rotX: -angle,
      color: WALL_COLOR,
    },
  ];
}

// ── Phase 1A new helpers ──────────────────────────────────────

function wideDeckBlocks() {
  // 2x2 plaza. Anchor cell is the -X/-Z corner of the footprint, so the
  // visible deck is centred at (TILE/2, _, TILE/2).
  const cx = TILE / 2;
  const cz = TILE / 2;
  const W = TILE * 2;
  return [
    { kind: 'box', size: [W, ROAD_THICK, W], pos: [cx, ROAD_THICK / 2, cz], color: ROAD_COLOR, drivable: true },
    // Faint inner ring stripe to mark the plaza centre
    { kind: 'box', size: [W * 0.7, 0.05, 0.18], pos: [cx, ROAD_THICK + 0.03, cz], color: CURB_W, solid: false },
    { kind: 'box', size: [0.18, 0.05, W * 0.7], pos: [cx, ROAD_THICK + 0.03, cz], color: CURB_W, solid: false },
  ];
}

function tJunctionBlocks() {
  // Three open ports: -Z (in), -X, +X. Block the +Z edge with a curb.
  // Implemented as a full-cell deck plus accent stripes on each open edge.
  return [
    { kind: 'box', size: [TILE, ROAD_THICK, TILE], pos: [0, ROAD_THICK / 2, 0], color: ROAD_COLOR, drivable: true },
    // Closed (+Z) edge curb stripes
    { kind: 'box', size: [TILE * 0.9, 0.06, 0.2], pos: [0, ROAD_THICK + 0.03, TILE / 2 - 0.15], color: CURB_R, solid: false },
    { kind: 'box', size: [TILE * 0.45, 0.06, 0.2], pos: [-TILE * 0.225, ROAD_THICK + 0.03, TILE / 2 - 0.15], color: CURB_W, solid: false },
    // Centre marker
    { kind: 'box', size: [TILE * 0.5, 0.05, TILE * 0.5], pos: [0, ROAD_THICK + 0.03, 0], color: 0x4f5663, solid: false },
  ];
}

function crossroadsBlocks() {
  // All four edges open. Just a flat deck with a cross marker.
  return [
    { kind: 'box', size: [TILE, ROAD_THICK, TILE], pos: [0, ROAD_THICK / 2, 0], color: ROAD_COLOR, drivable: true },
    { kind: 'box', size: [TILE * 0.85, 0.06, 0.2], pos: [0, ROAD_THICK + 0.03, 0], color: CURB_W, solid: false },
    { kind: 'box', size: [0.2, 0.06, TILE * 0.85], pos: [0, ROAD_THICK + 0.03, 0], color: CURB_W, solid: false },
  ];
}

function bankedTurnBlocks() {
  // Block-list FALLBACK only — the editor uses the visual builder in
  // road-geometry.js (`buildBanked`). We just need a single drivable cell
  // here so saved layouts and physics still have something solid to stand on
  // when the visual builder is not available.
  return [
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, TILE],
      pos: [0, ROAD_THICK / 2, 0],
      color: ROAD_COLOR,
      drivable: true,
    },
  ];
}

function bumpBlocks(height, lengthZcells) {
  // Drivable deck with a low rounded bump made of 3 stacked slabs.
  const lz = TILE * lengthZcells;
  return [
    { kind: 'box', size: [ROAD_WIDTH, ROAD_THICK, lz], pos: [0, ROAD_THICK / 2, 0], color: ROAD_COLOR, drivable: true },
    { kind: 'box', size: [ROAD_WIDTH, height * 0.4, lz * 0.7], pos: [0, ROAD_THICK + height * 0.2, 0], color: ROAD_COLOR, drivable: true },
    { kind: 'box', size: [ROAD_WIDTH, height * 0.4, lz * 0.45], pos: [0, ROAD_THICK + height * 0.5, 0], color: ROAD_COLOR, drivable: true },
    { kind: 'box', size: [ROAD_WIDTH, height * 0.3, lz * 0.25], pos: [0, ROAD_THICK + height * 0.75, 0], color: ROAD_COLOR, drivable: true },
  ];
}

function rollingHillBlocks(peakHeight, lengthZ) {
  // Up-and-over hill modelled as two opposing ramps meeting at the peak.
  const halfL = lengthZ / 2;
  const dy = peakHeight;
  const len = Math.sqrt(dy * dy + halfL * halfL);
  const angle = Math.atan2(dy, halfL);
  const cy = (peakHeight / 2) + ROAD_THICK / 2;
  return [
    // up-slope (anchor cell, centred at -TILE/2 along ramp axis)
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, len],
      pos: [0, cy, -halfL / 2],
      rotX: -angle,
      color: ROAD_COLOR,
      drivable: true,
    },
    // down-slope (centred at +TILE/2)
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, len],
      pos: [0, cy, halfL / 2 + halfL],
      rotX: angle,
      color: ROAD_COLOR,
      drivable: true,
    },
    // peak filler so the meeting line isn't a sharp seam
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK * 1.5, TILE * 0.4],
      pos: [0, peakHeight + ROAD_THICK / 2, halfL],
      color: ROAD_COLOR,
      drivable: true,
    },
  ];
}

function bridgeBlocks(deckHeight, lengthZ) {
  // Elevated drivable deck plus simple support pillars at each end.
  const cz = lengthZ / 2 - TILE / 2;
  return [
    // deck
    { kind: 'box', size: [ROAD_WIDTH, ROAD_THICK, lengthZ], pos: [0, deckHeight + ROAD_THICK / 2, cz], color: ROAD_COLOR, drivable: true },
    // side rails
    { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, lengthZ], pos: [(TILE / 2) - WALL_THICK / 2, deckHeight + ROAD_THICK + WALL_HEIGHT / 2, cz], color: WALL_COLOR },
    { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, lengthZ], pos: [-(TILE / 2) + WALL_THICK / 2, deckHeight + ROAD_THICK + WALL_HEIGHT / 2, cz], color: WALL_COLOR },
    // pillars (visual only, non-solid)
    { kind: 'box', size: [ROAD_WIDTH * 0.7, deckHeight, 0.4], pos: [0, deckHeight / 2, -TILE / 2 + 0.2], color: WALL_COLOR, solid: false },
    { kind: 'box', size: [ROAD_WIDTH * 0.7, deckHeight, 0.4], pos: [0, deckHeight / 2, lengthZ - TILE / 2 - 0.2], color: WALL_COLOR, solid: false },
  ];
}

function tunnelBlocks(lengthZ) {
  // Drivable straight + walls + a slab roof. Open ends at -Z and +Z.
  const cz = lengthZ / 2 - TILE / 2;
  const ROOF_Y = ROAD_THICK + WALL_HEIGHT + 0.3;
  return [
    { kind: 'box', size: [ROAD_WIDTH, ROAD_THICK, lengthZ], pos: [0, ROAD_THICK / 2, cz], color: ROAD_COLOR, drivable: true },
    // walls (full height)
    { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, lengthZ], pos: [(TILE / 2) - WALL_THICK / 2, ROAD_THICK + WALL_HEIGHT / 2, cz], color: WALL_COLOR },
    { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, lengthZ], pos: [-(TILE / 2) + WALL_THICK / 2, ROAD_THICK + WALL_HEIGHT / 2, cz], color: WALL_COLOR },
    // roof slab
    { kind: 'box', size: [TILE, 0.4, lengthZ], pos: [0, ROOF_Y, cz], color: 0x2a2f38 },
    // accent strip down the middle (decoration)
    { kind: 'box', size: [0.2, 0.05, lengthZ * 0.95], pos: [0, ROAD_THICK + 0.03, cz], color: 0xfbbf24, solid: false },
  ];
}

export const SEGMENT_KEYS = Object.keys(SEGMENTS);

/** Get span footprint cells for a segment, in local grid coords. */
export function getFootprint(key) {
  const def = SEGMENTS[key];
  if (!def) return [[0, 0]];
  const cells = [];
  for (let x = 0; x < def.span.x; x++) {
    for (let z = 0; z < def.span.z; z++) {
      cells.push([x, z]);
    }
  }
  return cells;
}
