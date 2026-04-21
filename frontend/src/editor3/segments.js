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

export const TILE = 4;          // world units per grid cell (small = denser tracks)
export const ROAD_WIDTH = TILE * 0.9;
export const ROAD_THICK = 0.4;
export const WALL_HEIGHT = 1.2;
export const WALL_THICK = 0.4;

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
    blocks: [deck(), ...curbStripes(), ...sideWalls()],
  },

  straight2: {
    label: 'Straight ×2',
    category: 'road',
    span: { x: 1, z: 2 },
    blocks: [
      { ...deck(TILE * 2), pos: [0, ROAD_THICK / 2, TILE / 2] },
      ...curbStripes(TILE * 2).map(b => ({ ...b, pos: [b.pos[0], b.pos[1], b.pos[2] + TILE / 2] })),
      ...sideWalls(TILE * 2).map(b => ({ ...b, pos: [b.pos[0], b.pos[1], b.pos[2] + TILE / 2] })),
    ],
  },

  straight4: {
    label: 'Straight ×4',
    category: 'road',
    span: { x: 1, z: 4 },
    blocks: [
      { ...deck(TILE * 4), pos: [0, ROAD_THICK / 2, TILE * 1.5] },
      ...curbStripes(TILE * 4).map(b => ({ ...b, pos: [b.pos[0], b.pos[1], b.pos[2] + TILE * 1.5] })),
      ...sideWalls(TILE * 4).map(b => ({ ...b, pos: [b.pos[0], b.pos[1], b.pos[2] + TILE * 1.5] })),
    ],
  },

  // Quarter-turn corner: travel enters at -Z edge, exits at -X edge
  // Approximated by a quarter ring of small deck quads (8 segments).
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
    // Two-cell ramp climbing from y=0 at -Z edge to y=TILE at +Z edge
    // Implemented as a tilted box bridging the two cells.
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
      // support pillar
      { kind: 'box', size: [ROAD_WIDTH * 0.8, TILE * 0.6, 0.3], pos: [0, TILE * 0.3, -TILE / 2 + 0.15], color: WALL_COLOR },
      { kind: 'box', size: [ROAD_WIDTH * 0.8, TILE * 0.6, 0.3], pos: [0, TILE * 0.3, TILE / 2 - 0.15], color: WALL_COLOR },
      // side rails on top
      { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, TILE], pos: [(TILE / 2) - WALL_THICK / 2, TILE * 0.6 + ROAD_THICK + WALL_HEIGHT / 2, 0], color: WALL_COLOR },
      { kind: 'box', size: [WALL_THICK, WALL_HEIGHT, TILE], pos: [-(TILE / 2) + WALL_THICK / 2, TILE * 0.6 + ROAD_THICK + WALL_HEIGHT / 2, 0], color: WALL_COLOR },
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
      // Side gantry posts
      { kind: 'box', size: [0.3, 2.5, 0.3], pos: [(TILE / 2) - 0.4, ROAD_THICK + 1.25, 0], color: FINISH_COLOR },
      { kind: 'box', size: [0.3, 2.5, 0.3], pos: [-(TILE / 2) + 0.4, ROAD_THICK + 1.25, 0], color: FINISH_COLOR },
      // Top crossbar
      { kind: 'box', size: [TILE, 0.3, 0.3], pos: [0, ROAD_THICK + 2.5, 0], color: FINISH_COLOR },
      ...sideWalls(),
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
      ...sideWalls(),
    ],
    isSpawn: true,
  },
};

// ── helpers for parametric pieces ──────────────────────────────

function cornerBlocks(mirror) {
  // Approximate quarter-turn road by 8 angled deck slabs
  const blocks = [];
  const SEGMENTS = 8;
  const radius = TILE / 2;
  // Center of the turn: the inside corner. For "corner L" (default), turn from
  // -Z entry to -X exit; arc center at (-TILE/2, 0, -TILE/2). For mirror it's +X exit.
  const cx = mirror ? TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i + 0.5) / SEGMENTS;
    const angle = mirror
      ? Math.PI + Math.PI / 2 * t   // from +Z direction toward +X
      : -Math.PI / 2 * t;            // from +Z direction toward -X (rotates clockwise looking down)
    // Place slab tangent to arc. Use slab length = arc segment
    const arcLen = (Math.PI / 2 * radius) / SEGMENTS;
    const slabAngle = mirror ? -Math.PI / 2 * t : Math.PI / 2 * t;
    const px = cx + Math.cos(mirror ? -Math.PI / 2 * t : Math.PI - Math.PI / 2 * t) * radius;
    const pz = cz + Math.sin(mirror ? -Math.PI / 2 * t : Math.PI - Math.PI / 2 * t) * radius;
    blocks.push({
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, arcLen * 1.05],
      pos: [px, ROAD_THICK / 2, pz],
      rotY: slabAngle,
      color: ROAD_COLOR,
      drivable: true,
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
