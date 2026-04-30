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
// Vertical tier heights — used by bridge / plateau / ramps so the three
// drivable levels stay in sync between collision blocks and visuals.
//   tier 0 = ground (y = 0)
//   tier 1 = plateau (y = PLATEAU_HEIGHT)
//   tier 2 = bridge deck (y = BRIDGE_DECK_HEIGHT)
export const PLATEAU_HEIGHT = TILE * 0.6;
export const BRIDGE_DECK_HEIGHT = TILE * 1.2;
// Bridge on/off ramps span this many cells so the climb stays gradual
// (rise / run = BRIDGE_DECK_HEIGHT / (BRIDGE_RAMP_CELLS * TILE) ≈ 0.30).
export const BRIDGE_RAMP_CELLS = 4;

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
  // FUNCTIONAL alternating red/white curbs along both long edges. The
  // stripes are SOLID low bumps (height 0.25 m) so a kart that strays
  // off the racing line clatters over them — the rumble destabilises
  // the chassis enough to encourage drivers to stay inside the road.
  const out = [];
  const stripeW = 0.32;
  const stripeH = 0.25;
  const stripeLen = extentZ / 5;
  for (let side = -1; side <= 1; side += 2) {
    const x = side * (ROAD_WIDTH / 2 - stripeW / 2);
    for (let i = 0; i < 5; i++) {
      const z = -extentZ / 2 + stripeLen * (i + 0.5);
      out.push({
        kind: 'box',
        size: [stripeW, stripeH, stripeLen * 0.95],
        pos: [x, ROAD_THICK + stripeH / 2, z],
        color: i % 2 === 0 ? CURB_R : CURB_W,
        // solid:true → wheels physically bump over the curb.
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
      // Slim corner support columns (visual only, non-solid) so a road
      // placed UNDER the plateau on tier 0 has clearance.
      { kind: 'box', size: [0.4, TILE * 0.6, 0.4], pos: [-ROAD_WIDTH / 2 + 0.2, TILE * 0.3, -TILE / 2 + 0.2], color: WALL_COLOR, solid: false },
      { kind: 'box', size: [0.4, TILE * 0.6, 0.4], pos: [ ROAD_WIDTH / 2 - 0.2, TILE * 0.3, -TILE / 2 + 0.2], color: WALL_COLOR, solid: false },
      { kind: 'box', size: [0.4, TILE * 0.6, 0.4], pos: [-ROAD_WIDTH / 2 + 0.2, TILE * 0.3,  TILE / 2 - 0.2], color: WALL_COLOR, solid: false },
      { kind: 'box', size: [0.4, TILE * 0.6, 0.4], pos: [ ROAD_WIDTH / 2 - 0.2, TILE * 0.3,  TILE / 2 - 0.2], color: WALL_COLOR, solid: false },
    ],
  },

  // Raised L-bend curve at the same height as `plateau` so the two pieces
  // tile together to form elevated road circuits. Same connector layout
  // as `corner` (S→W) lifted by TILE*0.6. The drivable deck is a full-cell
  // box matching plateau's footprint so karts transition smoothly between
  // straight plateau tiles and curved plateau tiles.
  curved_plateau: {
    label: 'Curved Plateau L',
    category: 'height',
    span: { x: 1, z: 1 },
    blocks: curvedPlateauBlocks(false),
  },
  curved_plateauR: {
    label: 'Curved Plateau R',
    category: 'height',
    span: { x: 1, z: 1 },
    blocks: curvedPlateauBlocks(true),
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

  // ── Bridge (deck spans 1×2 elevated, top tier) ───────────────
  // Bridge deck sits at BRIDGE_DECK_HEIGHT (= 2× plateau height) so a
  // plateau road can pass UNDER the bridge while the bridge itself
  // remains the highest drivable level on the track.
  bridge: {
    label: 'Bridge',
    category: 'height',
    span: { x: 1, z: 2 },
    blocks: bridgeBlocks(BRIDGE_DECK_HEIGHT, TILE * 2),
  },
  // Bridge ramps stretch across BRIDGE_RAMP_CELLS cells (default 4) so
  // the climb to the upper deck is gradual enough for karts to traverse
  // without losing speed at the lip.
  bridge_onramp: {
    label: 'Bridge On-Ramp',
    category: 'height',
    span: { x: 1, z: BRIDGE_RAMP_CELLS },
    blocks: rampBlocks(0, BRIDGE_DECK_HEIGHT, TILE * BRIDGE_RAMP_CELLS),
  },
  bridge_offramp: {
    label: 'Bridge Off-Ramp',
    category: 'height',
    span: { x: 1, z: BRIDGE_RAMP_CELLS },
    blocks: rampBlocks(BRIDGE_DECK_HEIGHT, 0, TILE * BRIDGE_RAMP_CELLS),
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

  // ── Combat overlays (Phase 1 — drop-in PvP segments) ─────────
  // All combat overlays share three properties:
  //   - overlay: true  → does not claim a grid cell; stacks on roads
  //   - category: 'pickup' | 'modifier' | 'hazard'
  //   - runtime: { kind, ... }  → consumed by playtest + StudioRoom to
  //     spawn pickup/effect logic at the placement's world position.
  // Visual blocks are all marked solid:false so they never push karts.
  // The runtime layer handles every gameplay interaction.
  item_box: {
    label: 'Item Box',
    category: 'pickup',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: itemBoxBlocks(0xffd400, 1.4),
    runtime: { kind: 'pickup', payload: 'weapon_random', respawnMs: 4000, radius: TILE * 0.45 },
  },
  weapon_crate_heavy: {
    label: 'Heavy Crate',
    category: 'pickup',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: itemBoxBlocks(0xff5a3a, 1.6, true),
    runtime: { kind: 'pickup', payload: 'weapon_heavy', respawnMs: 8000, radius: TILE * 0.45 },
  },
  health_orb: {
    label: 'Health Orb',
    category: 'pickup',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: orbBlocks(0x55ff88),
    runtime: { kind: 'pickup', payload: 'health', amount: 50, respawnMs: 6000, radius: TILE * 0.4 },
  },
  coin_pickup: {
    label: 'Coin',
    category: 'pickup',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: orbBlocks(0xffe066, 0.7),
    runtime: { kind: 'pickup', payload: 'coin', amount: 1, respawnMs: 3000, radius: TILE * 0.3 },
  },
  boost_pad: {
    label: 'Boost Pad',
    category: 'modifier',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: boostPadBlocks(0xffa500, 1),
    runtime: { kind: 'effect', effect: 'boost', strength: 0.30, durationMs: 1000 },
  },
  super_boost_pad: {
    label: 'Super Boost',
    category: 'modifier',
    span: { x: 1, z: 2 },
    overlay: true,
    blocks: boostPadBlocks(0x4ad6ff, 2),
    runtime: { kind: 'effect', effect: 'boost', strength: 0.60, durationMs: 2000 },
  },
  oil_slick: {
    label: 'Oil Slick',
    category: 'hazard',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: paintPatchBlocks(0x111418, 0.85),
    runtime: { kind: 'effect', effect: 'oil', durationMs: 800, radius: TILE * 0.45 },
  },
  slow_strip: {
    label: 'Slow Strip',
    category: 'modifier',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: paintPatchBlocks(0x4caf50, 0.75),
    runtime: { kind: 'effect', effect: 'slow', strength: 0.40, durationMs: 600 },
  },
  repair_strip: {
    label: 'Repair Strip',
    category: 'modifier',
    span: { x: 1, z: 1 },
    overlay: true,
    blocks: paintPatchBlocks(0x00e5ff, 0.7),
    runtime: { kind: 'effect', effect: 'repair', amountPerSec: 8 },
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
      size: [0.32, 0.25, stripeLen],
      pos: [px, ROAD_THICK + 0.125, pz],
      rotY: tan,
      color: i % 2 === 0 ? CURB_R : CURB_W,
      // solid:true (default) so the kart bumps over a wide-line curb.
    });
  }
  return blocks;
}

function curvedPlateauBlocks(mirror) {
  // Raised L-bend at the same height as `plateau` (TILE*0.6). Drivable
  // deck fills the whole cell so it tiles seamlessly with adjacent
  // plateau / curved_plateau tiles. Inside-edge curb stripes telegraph
  // turn direction, mirroring `cornerBlocks`. Two pier columns under the
  // -X/+X edges (or +X/-X for R) so the deck visibly rests on supports
  // matching plateau's pillar language.
  const blocks = [];
  const deckH = TILE * 0.6;
  // Elevated full-cell deck
  blocks.push({
    kind: 'box',
    size: [TILE, ROAD_THICK, TILE],
    pos: [0, deckH + ROAD_THICK / 2, 0],
    color: ROAD_COLOR,
    drivable: true,
  });
  // Inside-edge curb (telegraph the turn). For L (mirror=false): inside
  // corner at (-TILE/2, -TILE/2). For R (mirror=true): inside at
  // (+TILE/2, -TILE/2).
  const insideX = mirror ? +TILE / 2 : -TILE / 2;
  const insideZ = -TILE / 2;
  const STRIPES = 5;
  const stripeLen = 0.55;
  for (let i = 0; i < STRIPES; i++) {
    const t = (i + 0.5) / STRIPES;
    // Arc center at the OUTSIDE corner; sample stripes along the inside
    // arc of radius TILE * 0.15 from the inside corner.
    const angle = mirror
      ? -(Math.PI / 2) * t                  // R: inside arc from -Z to +X
      : Math.PI + (Math.PI / 2) * t;        // L: inside arc from -Z to -X
    const R = TILE * 0.15;
    const px = insideX + Math.cos(angle) * R;
    const pz = insideZ + Math.sin(angle) * R;
    blocks.push({
      kind: 'box',
      size: [0.32, 0.25, stripeLen],
      pos: [px, deckH + ROAD_THICK + 0.125, pz],
      rotY: angle + Math.PI / 2,
      color: i % 2 === 0 ? CURB_R : CURB_W,
    });
  }
  // Slim support columns under the arc deck. Four pillars sit AT the
  // tile-edge seams of the arc (two at the entry seam z=-TILE/2 along
  // the road edges, two at the exit seam at x=±TILE/2 along the road
  // edges) so each pillar lands directly under the visible deck rather
  // than floating in empty cell corners. Marked solid:false so a ground
  // road on tier 0 still has clearance through the cell.
  const halfW = ROAD_WIDTH / 2;
  const inset = 0.2;
  const exitX = mirror ? +TILE / 2 - inset : -TILE / 2 + inset;
  const entryPositions = [
    [-halfW + inset, -TILE / 2 + inset],   // entry road-edge -X
    [+halfW - inset, -TILE / 2 + inset],   // entry road-edge +X
  ];
  const exitPositions = [
    [exitX, -halfW + inset],               // exit road-edge -Z
    [exitX, +halfW - inset],               // exit road-edge +Z
  ];
  for (const [px, pz] of [...entryPositions, ...exitPositions]) {
    blocks.push({
      kind: 'box',
      size: [0.4, deckH, 0.4],
      pos: [px, deckH / 2, pz],
      color: WALL_COLOR,
      solid: false,
    });
  }
  return blocks;
}

function rampBlocks(yStart, yEnd, lengthZ) {
  // The kart drives on its top face.
  const dy = yEnd - yStart;
  const dz = lengthZ;
  const length = Math.sqrt(dy * dy + dz * dz);
  const angle = Math.atan2(dy, dz);              // pitch around X
  const cy = (yStart + yEnd) / 2 + ROAD_THICK / 2;
  const cz = lengthZ / 2 - TILE / 2;             // ramp's first cell anchor at -TILE/2
  const blocks = [
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
  // Slim under-deck support pillars. Place one pair per cell-boundary
  // crossing along the ramp (excluding the foot which is already at
  // ground level). Pillar height tracks the ramp profile so each one
  // visibly meets the deck underside. solid:false keeps clearance for
  // any ground road that passes beneath the elevated portion.
  const cellCount = Math.max(1, Math.round(lengthZ / TILE));
  const halfWP = ROAD_WIDTH / 2;
  const insetP = 0.25;
  for (let i = 1; i < cellCount; i++) {
    const z = -TILE / 2 + i * TILE;          // pillar z (cell boundary)
    const t = (z + TILE / 2) / lengthZ;      // [0..1] along ramp
    const e = t * t * (3 - 2 * t);           // smooth-step profile
    const yDeck = yStart + (yEnd - yStart) * e;
    if (yDeck < 0.4) continue;                // skip if too short to read
    for (const sx of [-1, +1]) {
      blocks.push({
        kind: 'box',
        size: [0.4, yDeck, 0.4],
        pos: [sx * (halfWP - insetP), yDeck / 2, z],
        color: WALL_COLOR,
        solid: false,
      });
    }
  }
  return blocks;
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
  // Each slope's HORIZONTAL projection equals one cell (TILE), so the two
  // slopes together fill the full 2-cell footprint with no middle gap.
  // Cell 0 spans local z=-TILE/2..+TILE/2 (up-slope centred at 0); cell 1
  // spans +TILE/2..+3*TILE/2 (down-slope centred at +TILE). Peak filler
  // sits at the seam between the two cells (z = TILE/2).
  const cellLen = lengthZ / 2;                      // = TILE per slope
  const slopeLen = Math.sqrt(peakHeight * peakHeight + cellLen * cellLen);
  const angle = Math.atan2(peakHeight, cellLen);
  const cy = (peakHeight / 2) + ROAD_THICK / 2;
  return [
    // up-slope (cell 0, centred at z=0)
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, slopeLen],
      pos: [0, cy, 0],
      rotX: -angle,
      color: ROAD_COLOR,
      drivable: true,
    },
    // down-slope (cell 1, centred at z=+cellLen)
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK, slopeLen],
      pos: [0, cy, cellLen],
      rotX: angle,
      color: ROAD_COLOR,
      drivable: true,
    },
    // small peak filler bridging the seam between the two slopes
    {
      kind: 'box',
      size: [ROAD_WIDTH, ROAD_THICK * 1.5, TILE * 0.4],
      pos: [0, peakHeight + ROAD_THICK / 2, cellLen / 2],
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

// ── Combat overlay helpers (Phase 1) ───────────────────────────

/** Floating glowing cube — the classic "?" item box look. The cube is a
 *  standalone block tagged so the editor + visual builder can spin it for
 *  feedback. solid:false everywhere — runtime layer handles collection. */
function itemBoxBlocks(color, size = 1.4, heavy = false) {
  const half = size / 2;
  const baseY = ROAD_THICK + 0.6 + half;
  const blocks = [
    { kind: 'box', size: [size, size, size], pos: [0, baseY, 0], color, solid: false, isPickupCube: true },
  ];
  if (heavy) {
    // Reinforcement bands for the heavy crate variant — purely cosmetic.
    blocks.push(
      { kind: 'box', size: [size * 1.05, 0.12, 0.12], pos: [0, baseY, half - 0.06], color: 0x222428, solid: false },
      { kind: 'box', size: [size * 1.05, 0.12, 0.12], pos: [0, baseY, -half + 0.06], color: 0x222428, solid: false },
      { kind: 'box', size: [0.12, 0.12, size * 1.05], pos: [half - 0.06, baseY, 0], color: 0x222428, solid: false },
      { kind: 'box', size: [0.12, 0.12, size * 1.05], pos: [-half + 0.06, baseY, 0], color: 0x222428, solid: false },
    );
  } else {
    // Bright marker stripe (faux ?) so the cube reads at a glance.
    blocks.push(
      { kind: 'box', size: [size * 0.4, 0.05, size * 0.4], pos: [0, baseY + half + 0.01, 0], color: 0xffffff, solid: false },
    );
  }
  // Glowing base disc on the road so the spawn point is obvious even
  // while the cube is in respawn cooldown.
  blocks.push(
    { kind: 'box', size: [size * 1.6, 0.04, size * 1.6], pos: [0, ROAD_THICK + 0.02, 0], color, solid: false },
  );
  return blocks;
}

/** Floating sphere-ish marker rendered as a small octagonal stack of
 *  thin slabs. Used by health orbs and coins. */
function orbBlocks(color, size = 1.0) {
  const baseY = ROAD_THICK + 0.5 + size * 0.5;
  return [
    { kind: 'box', size: [size, size * 0.3, size], pos: [0, baseY, 0], color, solid: false, isPickupCube: true },
    { kind: 'box', size: [size * 0.7, size * 0.3, size * 0.7], pos: [0, baseY + size * 0.25, 0], color, solid: false },
    { kind: 'box', size: [size * 0.7, size * 0.3, size * 0.7], pos: [0, baseY - size * 0.25, 0], color, solid: false },
    // Halo on the road so it remains visible during respawn cooldown.
    { kind: 'box', size: [size * 1.4, 0.04, size * 1.4], pos: [0, ROAD_THICK + 0.02, 0], color, solid: false },
  ];
}

/** Painted boost-pad chevrons. Length in cells (1 or 2). The chevron
 *  arrow points along local +Z so the rotation logic naturally aligns
 *  pad direction with kart travel direction. */
function boostPadBlocks(color, lengthCells) {
  const lz = TILE * lengthCells;
  const cz = lz / 2 - TILE / 2;
  const blocks = [
    // Base paint patch — a darker rectangle along the racing line.
    { kind: 'box', size: [ROAD_WIDTH * 0.85, 0.03, lz * 0.95], pos: [0, ROAD_THICK + 0.02, cz], color: 0x1a1d22, solid: false },
  ];
  // Chevron count scales with length so the arrow density looks right.
  const CHEVRONS = lengthCells === 2 ? 8 : 4;
  const startZ = -TILE / 2 + lz / (CHEVRONS + 1);
  const stepZ = lz / (CHEVRONS + 1);
  for (let i = 0; i < CHEVRONS; i++) {
    const zc = startZ + stepZ * i;
    // Two diagonal segments forming a forward-pointing > shape.
    blocks.push(
      { kind: 'box', size: [ROAD_WIDTH * 0.5, 0.05, 0.18], pos: [-ROAD_WIDTH * 0.18, ROAD_THICK + 0.04, zc], rotY: -0.6, color, solid: false },
      { kind: 'box', size: [ROAD_WIDTH * 0.5, 0.05, 0.18], pos: [ ROAD_WIDTH * 0.18, ROAD_THICK + 0.04, zc], rotY:  0.6, color, solid: false },
    );
  }
  return blocks;
}

/** Flat painted patch covering most of a cell. Used by oil slick, slow
 *  strip, repair strip — only the colour and a subtle accent change. */
function paintPatchBlocks(color, scale = 0.85) {
  const w = ROAD_WIDTH * scale;
  return [
    { kind: 'box', size: [w, 0.04, w], pos: [0, ROAD_THICK + 0.02, 0], color, solid: false },
    // Cross-hatch accent so the patch reads as deliberate paint, not dirt.
    { kind: 'box', size: [w * 0.95, 0.05, 0.18], pos: [0, ROAD_THICK + 0.04, 0], color: 0xffffff, solid: false },
    { kind: 'box', size: [0.18, 0.05, w * 0.95], pos: [0, ROAD_THICK + 0.04, 0], color: 0xffffff, solid: false },
  ];
}

// NOTE: `SEGMENT_KEYS` is exported AFTER the walled-variant injector
// runs further down — that block clones every base segment into a new
// `${key}_walled` entry, and SEGMENT_KEYS must include them.

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

// ── Vertical tiers ──────────────────────────────────────────────
// Each segment's footprint cell occupies a vertical "tier" (0 = ground,
// 1 = elevated / bridge deck). Two placements in different tiers do NOT
// collide, which is what lets a road run UNDER a bridge deck. Per-cell
// tiers are listed in the same order as `getFootprint`. Default = all 0.
const CELL_TIERS = {
  // Plateau-family decks sit on the MID tier (1) so a ground road can
  // pass beneath them (mirrors the bridge → ground tier system).
  plateau:         [1],
  curved_plateau:  [1],
  curved_plateauR: [1],
  // Ramp_up climbs ground (cell 0) → plateau (cell 1). Cell 1 is on the
  // upper tier so a straight road can pass beneath the elevated end.
  ramp_up:         [0, 1],
  ramp_down:       [1, 0],
  // Bridge deck spans cells (0,0)+(0,1) entirely on the TOP tier (2).
  bridge:         [2, 2],
  // bridge_onramp climbs ground → top across BRIDGE_RAMP_CELLS cells:
  //   cell 0 = ground entry, cell 1-2 = mid (plateau tier), cell N = deck.
  // The intermediate cells sit at tier 1 so a ground road can still pass
  // beneath the upper half of the ramp.
  bridge_onramp:  [0, 1, 1, 2],
  // bridge_offramp = on-ramp reversed.
  bridge_offramp: [2, 1, 1, 0],
};

/** Per-footprint-cell tier list (parallel to `getFootprint(key)`). */
export function getCellTiers(key) {
  const fp = getFootprint(key);
  const t = CELL_TIERS[key];
  if (Array.isArray(t) && t.length === fp.length) return t.slice();
  return new Array(fp.length).fill(0);
}

// ── Connectors ──────────────────────────────────────────────────
// Each segment declares which edges of which footprint cells expose a
// drivable road opening. Sides are local (before rotation):
//   N = +Z, S = -Z, E = +X, W = -X
// Used by the editor's auto-orient feature: a piece being placed will
// rotate so its connectors line up with neighbouring placements' open
// edges, and by the upcoming validation/preview tooling to flag dead
// ends. For pieces that don't connect to anything (decorative, spawn,
// finish line gantries, etc) we keep simple S+N defaults so they still
// fall in line with adjacent straights.
//
// Format: [ { x, z, side }, ... ]   x,z = local cell offset (0..span-1)

const SN = [
  { x: 0, z: 0, side: 'S' },
  { x: 0, z: 0, side: 'N' },
];

const CONNECTORS = {
  straight:        SN,
  // L-bend: enters S, exits W (per cornerBlocks convention).
  corner:          [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 0, side: 'W' }],
  // R-bend: enters S, exits E.
  cornerR:         [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 0, side: 'E' }],
  // Two-cell ramps: bottom connector on -Z of (0,0), top on +Z of (0,1).
  ramp_up:         [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  ramp_down:       [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  plateau:         SN,
  // Curved plateaus mirror the corner connectors so they tile with both
  // straight plateau pieces (entry/exit S+N) and other curved plateaus.
  curved_plateau:  [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 0, side: 'W' }],
  curved_plateauR: [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 0, side: 'E' }],
  finish:          SN,
  spawn:           SN,
  // Wide 2x2 plaza — open on every outer edge.
  wide: [
    { x: 0, z: 0, side: 'S' }, { x: 1, z: 0, side: 'S' },
    { x: 0, z: 1, side: 'N' }, { x: 1, z: 1, side: 'N' },
    { x: 0, z: 0, side: 'W' }, { x: 0, z: 1, side: 'W' },
    { x: 1, z: 0, side: 'E' }, { x: 1, z: 1, side: 'E' },
  ],
  // T-junction: open S/N (through-road) + E (branch). Author's local frame
  // matches tJunctionBlocks() — the stop line + arrow point E.
  t_junction:      [
    { x: 0, z: 0, side: 'S' },
    { x: 0, z: 0, side: 'N' },
    { x: 0, z: 0, side: 'E' },
  ],
  crossroads: [
    { x: 0, z: 0, side: 'S' },
    { x: 0, z: 0, side: 'N' },
    { x: 0, z: 0, side: 'E' },
    { x: 0, z: 0, side: 'W' },
  ],
  // Banked left turn — same connectivity as `corner`.
  banked_turn:     [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 0, side: 'W' }],
  bump_up:         SN,
  hill_complete:   [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  jump_ramp:       SN,
  bridge:          [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  // Bridge ramps now span BRIDGE_RAMP_CELLS cells; exit connector lives
  // on the +Z side of the LAST cell (z = BRIDGE_RAMP_CELLS - 1).
  bridge_onramp:   [{ x: 0, z: 0, side: 'S' }, { x: 0, z: BRIDGE_RAMP_CELLS - 1, side: 'N' }],
  bridge_offramp:  [{ x: 0, z: 0, side: 'S' }, { x: 0, z: BRIDGE_RAMP_CELLS - 1, side: 'N' }],
  tunnel:          [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  // End cap — closed on the +Z side by a wall, only S is drivable.
  cap_end:         [{ x: 0, z: 0, side: 'S' }],
  // Combat overlays — declare S+N so auto-orient aligns chevrons /
  // markers along the same axis as the underlying road.
  item_box:           SN,
  weapon_crate_heavy: SN,
  health_orb:         SN,
  coin_pickup:        SN,
  boost_pad:          SN,
  super_boost_pad:    [{ x: 0, z: 0, side: 'S' }, { x: 0, z: 1, side: 'N' }],
  oil_slick:          SN,
  slow_strip:         SN,
  repair_strip:       SN,
};

// ── Walled variants ─────────────────────────────────────────────
// Each non-overlay base segment is duplicated into a `${key}_walled`
// twin. The variant is an EXACT copy of the base geometry (deck,
// curbs, pillars, gantries — everything is preserved verbatim so the
// walled twin drives identically) PLUS tall realistic barrier walls
// that follow the contour of the segment:
//
//   - flat segments (straight, plateau, bridge, finish, bump, banked):
//     vertical walls along every CLOSED cell edge
//   - corners / curved plateaus: walls hugging the two perpendicular
//     closed edges where the road bends
//   - ramps + bridge on/off-ramps + jump ramp: tilted walls that
//     follow the deck pitch end-to-end
//   - rolling hill: two opposing tilted walls per side, meeting at
//     the peak so the silhouette traces the up-and-over profile
//   - tunnel / wide plaza / crossroads: skipped (already enclosed
//     OR open on every side — no closed edge to wall)
//
// Each barrier is a two-tier concrete-style profile: a 0.8 m × 0.7 m
// foundation block topped by a 2.4 m × 0.45 m wall, total ≈3.2 m —
// tall enough to contain a hopping kart at full speed.
const W2_FOOT_H = 0.8;
const W2_FOOT_T = 0.7;
const W2_TOP_H  = 2.4;
const W2_TOP_T  = 0.45;
const W2_INSET  = W2_FOOT_T / 2;     // wall sits flush with the cell edge

/** Two-tier vertical wall. `length` runs along the wall axis, thickness
 *  along the perpendicular axis. `axis` is 'z' (length along Z, thick
 *  along X) or 'x' (length along X, thick along Z). `baseY` is the
 *  TOP-OF-DECK Y the foundation rests on. */
function tallWallStraight(length, cx, cz, baseY, axis) {
  const out = [];
  if (axis === 'z') {
    out.push(
      { kind: 'box', size: [W2_FOOT_T, W2_FOOT_H, length],
        pos: [cx, baseY + W2_FOOT_H / 2, cz], color: WALL_COLOR },
      { kind: 'box', size: [W2_TOP_T,  W2_TOP_H,  length],
        pos: [cx, baseY + W2_FOOT_H + W2_TOP_H / 2, cz], color: WALL_COLOR },
    );
  } else {
    out.push(
      { kind: 'box', size: [length, W2_FOOT_H, W2_FOOT_T],
        pos: [cx, baseY + W2_FOOT_H / 2, cz], color: WALL_COLOR },
      { kind: 'box', size: [length, W2_TOP_H,  W2_TOP_T],
        pos: [cx, baseY + W2_FOOT_H + W2_TOP_H / 2, cz], color: WALL_COLOR },
    );
  }
  return out;
}

/** Tilted wall hugging a ramp deck. `sideX` is +1 or -1 selecting the
 *  +X or -X long edge. The wall axis runs along Z, thickness along X,
 *  and the whole stack tips by the ramp pitch via rotX so it stays
 *  flush with the (tilted) deck surface across the full ramp length. */
function tallWallRamp(yStart, yEnd, lengthZ, sideX) {
  const dy = yEnd - yStart;
  const length = Math.sqrt(dy * dy + lengthZ * lengthZ);
  const angle = Math.atan2(dy, lengthZ);
  // Same Y/Z anchor as the ramp deck itself (mirrors rampBlocks).
  const cyDeckCenter = (yStart + yEnd) / 2 + ROAD_THICK / 2;
  const yDeckTop = cyDeckCenter + ROAD_THICK / 2;
  const cz = lengthZ / 2 - TILE / 2;
  const cx = sideX * (TILE / 2 - W2_INSET);
  return [
    { kind: 'box', size: [W2_FOOT_T, W2_FOOT_H, length],
      pos: [cx, yDeckTop + W2_FOOT_H / 2, cz], rotX: -angle, color: WALL_COLOR },
    { kind: 'box', size: [W2_TOP_T,  W2_TOP_H,  length],
      pos: [cx, yDeckTop + W2_FOOT_H + W2_TOP_H / 2, cz], rotX: -angle, color: WALL_COLOR },
  ];
}

/** Build the wall set for one base segment. Returns `null` for segments
 *  that should NOT have a walled variant (open-on-all-sides plazas,
 *  already-enclosed tunnels, pickup/overlay, spawn). */
function buildWalls(key) {
  const T = TILE;
  const halfEdge = T / 2 - W2_INSET;     // wall centre offset from cell centre
  const groundDeckTop = ROAD_THICK;      // top of ground-tier deck

  switch (key) {
    // ── Flat single-cell straights ─────────────────────────────
    case 'straight':
    case 'finish':
    case 'bump_up':
    case 'banked_turn':
      return [
        ...tallWallStraight(T, +halfEdge, 0, groundDeckTop, 'z'),
        ...tallWallStraight(T, -halfEdge, 0, groundDeckTop, 'z'),
      ];

    // End cap already has a +Z wall; add the two long sides.
    case 'cap_end':
      return [
        ...tallWallStraight(T, +halfEdge, 0, groundDeckTop, 'z'),
        ...tallWallStraight(T, -halfEdge, 0, groundDeckTop, 'z'),
      ];

    // ── Corners (closed edges = perpendicular outside L) ────────
    // corner L: connectors S, W → closed N (+Z) and E (+X).
    case 'corner':
      return [
        ...tallWallStraight(T, +halfEdge, 0, groundDeckTop, 'z'),  // E
        ...tallWallStraight(T, 0, +halfEdge, groundDeckTop, 'x'),  // N
      ];
    // corner R: connectors S, E → closed N (+Z) and W (-X).
    case 'cornerR':
      return [
        ...tallWallStraight(T, -halfEdge, 0, groundDeckTop, 'z'),  // W
        ...tallWallStraight(T, 0, +halfEdge, groundDeckTop, 'x'),  // N
      ];

    // ── Plateau family (mid-tier deck) ─────────────────────────
    case 'plateau': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      return [
        ...tallWallStraight(T, +halfEdge, 0, yTop, 'z'),
        ...tallWallStraight(T, -halfEdge, 0, yTop, 'z'),
      ];
    }
    case 'curved_plateau': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      return [
        ...tallWallStraight(T, +halfEdge, 0, yTop, 'z'),
        ...tallWallStraight(T, 0, +halfEdge, yTop, 'x'),
      ];
    }
    case 'curved_plateauR': {
      const yTop = PLATEAU_HEIGHT + ROAD_THICK;
      return [
        ...tallWallStraight(T, -halfEdge, 0, yTop, 'z'),
        ...tallWallStraight(T, 0, +halfEdge, yTop, 'x'),
      ];
    }

    // ── Ramps (tilted walls following the deck pitch) ──────────
    case 'ramp_up':
      return [
        ...tallWallRamp(0, T * 0.6, T * 2, +1),
        ...tallWallRamp(0, T * 0.6, T * 2, -1),
      ];
    case 'ramp_down':
      return [
        ...tallWallRamp(T * 0.6, 0, T * 2, +1),
        ...tallWallRamp(T * 0.6, 0, T * 2, -1),
      ];
    case 'jump_ramp':
      return [
        ...tallWallRamp(0, 1.2, T, +1),
        ...tallWallRamp(0, 1.2, T, -1),
      ];
    case 'bridge_onramp':
      return [
        ...tallWallRamp(0, BRIDGE_DECK_HEIGHT, T * BRIDGE_RAMP_CELLS, +1),
        ...tallWallRamp(0, BRIDGE_DECK_HEIGHT, T * BRIDGE_RAMP_CELLS, -1),
      ];
    case 'bridge_offramp':
      return [
        ...tallWallRamp(BRIDGE_DECK_HEIGHT, 0, T * BRIDGE_RAMP_CELLS, +1),
        ...tallWallRamp(BRIDGE_DECK_HEIGHT, 0, T * BRIDGE_RAMP_CELLS, -1),
      ];

    // ── Bridge deck (top tier, two cells along Z) ──────────────
    case 'bridge': {
      const yTop = BRIDGE_DECK_HEIGHT + ROAD_THICK;
      const length = T * 2;
      const cz = length / 2 - T / 2;
      return [
        ...tallWallStraight(length, +halfEdge, cz, yTop, 'z'),
        ...tallWallStraight(length, -halfEdge, cz, yTop, 'z'),
      ];
    }

    // ── Rolling hill (up + down slope per side) ────────────────
    case 'hill_complete': {
      const peakHeight = T * 0.25;
      const lengthZ = T * 2;
      const cellLen = lengthZ / 2;                       // one slope per cell
      const len = Math.sqrt(peakHeight * peakHeight + cellLen * cellLen);
      const angle = Math.atan2(peakHeight, cellLen);
      const cyDeckCenter = (peakHeight / 2) + ROAD_THICK / 2;
      const yDeckTop = cyDeckCenter + ROAD_THICK / 2;
      const out = [];
      for (const sx of [-1, +1]) {
        const cx = sx * halfEdge;
        // Up-slope wall (cell 0, centred at z=0)
        out.push(
          { kind: 'box', size: [W2_FOOT_T, W2_FOOT_H, len],
            pos: [cx, yDeckTop + W2_FOOT_H / 2, 0], rotX: -angle, color: WALL_COLOR },
          { kind: 'box', size: [W2_TOP_T,  W2_TOP_H,  len],
            pos: [cx, yDeckTop + W2_FOOT_H + W2_TOP_H / 2, 0], rotX: -angle, color: WALL_COLOR },
        );
        // Down-slope wall (cell 1, centred at z=+cellLen)
        out.push(
          { kind: 'box', size: [W2_FOOT_T, W2_FOOT_H, len],
            pos: [cx, yDeckTop + W2_FOOT_H / 2, cellLen], rotX: angle, color: WALL_COLOR },
          { kind: 'box', size: [W2_TOP_T,  W2_TOP_H,  len],
            pos: [cx, yDeckTop + W2_FOOT_H + W2_TOP_H / 2, cellLen], rotX: angle, color: WALL_COLOR },
        );
      }
      return out;
    }

    // ── Open / pre-enclosed segments — no walled variant ───────
    case 'tunnel':
    case 'wide':
    case 't_junction':
    case 'crossroads':
    case 'spawn':
      return null;

    default:
      return null;
  }
}

{
  const baseKeysSnapshot = Object.keys(SEGMENTS);
  for (const baseKey of baseKeysSnapshot) {
    const base = SEGMENTS[baseKey];
    if (!base) continue;
    if (base.overlay || base.isSpawn) continue;   // skip pickups / spawn

    const wallBlocks = buildWalls(baseKey);
    if (!wallBlocks || wallBlocks.length === 0) continue;

    // Strip the small red/white curb stripes from the base when building
    // the walled copy. The tall grey barriers already mark every closed
    // edge, and a few of the base curb generators (notably corner /
    // curved-plateau outer-arc stripes) place blocks slightly outside
    // the cell footprint — harmless on the base segment but visible as
    // floating debris next to the much taller walls. Drop them.
    const baseSansCurbs = base.blocks.filter(
      (b) => b.color !== CURB_R && b.color !== CURB_W
    );

    const walledKey = `${baseKey}_walled`;
    SEGMENTS[walledKey] = {
      label: `${base.label} (Walled)`,
      category: 'walled',
      span: { x: base.span.x, z: base.span.z },
      // Base geometry (decks, pillars, gantries) + contour-matching walls.
      blocks: [...baseSansCurbs, ...wallBlocks],
    };
    if (base.isFinish) SEGMENTS[walledKey].isFinish = true;
    if (base.runtime) SEGMENTS[walledKey].runtime = base.runtime;

    CONNECTORS[walledKey] = (CONNECTORS[baseKey] || SN).map((c) => ({ ...c }));
    if (CELL_TIERS[baseKey]) CELL_TIERS[walledKey] = CELL_TIERS[baseKey].slice();
  }
}

export const SEGMENT_KEYS = Object.keys(SEGMENTS);

const SIDE_CW = ['N', 'W', 'S', 'E']; // rotating one quarter-turn (rot=1) maps SIDE_CW[i] → SIDE_CW[(i+1)%4]
const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
const SIDE_TO_DELTA = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

function _normRot(rot) {
  const r = Number.isFinite(rot) ? rot : 0;
  return ((r % 4) + 4) % 4;
}

/** Rotate a side label by `rot` quarter-turns (matches mesh.rotation.y = -rot * π/2). */
export function rotateSide(side, rot) {
  const r = _normRot(rot);
  const i = SIDE_CW.indexOf(side);
  if (i < 0) return side;
  return SIDE_CW[(i + r) % 4];
}

/** Rotate a local cell offset (fx, fz) by `rot` quarter-turns about origin.
 *  Matches the actual mesh rotation `mesh.rotation.y = -rot * π/2`, so that
 *  the cells claimed by a rotated multi-cell footprint coincide with the
 *  world position of its rendered geometry. R_y(-π/2) sends (0,0,1) →
 *  (-1,0,0), so per quarter-turn (fx,fz) → (-fz, fx). */
export function rotateCell(fx, fz, rot) {
  const r = _normRot(rot);
  let ox = fx, oz = fz;
  for (let i = 0; i < r; i++) {
    const nx = -oz; const nz = ox;
    ox = nx; oz = nz;
  }
  return [ox, oz];
}

/** Get the opposite side label. */
export function oppositeSide(side) { return OPP[side] || side; }

/** Side → (dx, dz) delta to the cell across that edge. */
export function sideDelta(side) {
  const d = SIDE_TO_DELTA[side];
  return d ? [d[0], d[1]] : [0, 0];
}

/** Returns connector list for a segment in its local frame (default: S+N if none declared). */
export function getConnectors(key) {
  return CONNECTORS[key] || SN;
}

/**
 * Returns world-frame connectors for a segment placement:
 * [{ gx, gz, side, tier }] — gx/gz is the world cell containing the connector,
 * `side` is the world-frame edge of that cell which exposes the road,
 * `tier` is the vertical layer of that cell (0 = ground, 1 = bridge deck).
 */
export function getWorldConnectors(key, gx, gz, rot) {
  const conns = getConnectors(key);
  // Build a (localX,localZ) → tier lookup so each connector inherits the
  // tier of the footprint cell that owns it.
  const fp = getFootprint(key);
  const tiers = getCellTiers(key);
  const tierByLocal = new Map();
  for (let i = 0; i < fp.length; i++) {
    tierByLocal.set(`${fp[i][0]},${fp[i][1]}`, tiers[i] || 0);
  }
  const out = new Array(conns.length);
  for (let i = 0; i < conns.length; i++) {
    const c = conns[i];
    const [rx, rz] = rotateCell(c.x, c.z, rot);
    const tier = tierByLocal.get(`${c.x},${c.z}`) || 0;
    out[i] = { gx: gx + rx, gz: gz + rz, side: rotateSide(c.side, rot), tier };
  }
  return out;
}

// ── Runtime metadata (Phase 1 combat overlays) ──────────────────

/** Returns the runtime descriptor for a segment, or null if it has none.
 *  Both the playtest layer and StudioRoom call this to discover which
 *  placements should spawn pickups / fire effects. */
export function getRuntime(key) {
  return SEGMENTS[key]?.runtime || null;
}

/** Returns true if the segment is an overlay (does not claim a grid cell).
 *  Mirrors `Track.isOverlay` so server-side code can use the same rule
 *  without importing the Track class. */
export function isOverlaySegment(key) {
  const def = SEGMENTS[key];
  return !!(def?.isSpawn || def?.overlay);
}

/**
 * Walk a list of placements and return a flat array of runtime instances:
 *   { id, key, kind, payload, effect, gx, gz, rot, worldX, worldZ, ...meta }
 * `tileSize` defaults to TILE so the result is in segment-local units;
 * pass the world TILE (m × WORLD_UNITS_PER_M) when calling from the
 * playtest runtime.
 */
export function buildRuntimeRegistry(placements, tileSize = TILE) {
  const out = [];
  for (const p of placements) {
    const rt = getRuntime(p.key);
    if (!rt) continue;
    out.push({
      id: p.id ?? out.length + 1,
      key: p.key,
      gx: p.gx | 0,
      gz: p.gz | 0,
      rot: ((p.rot | 0) % 4 + 4) % 4,
      worldX: (p.gx | 0) * tileSize,
      worldZ: (p.gz | 0) * tileSize,
      ...rt,
    });
  }
  return out;
}
