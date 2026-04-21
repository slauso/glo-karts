/**
 * procedural-roads.js — Programmatic road tile geometry for TinkerTracks.
 *
 * Matches the exact visual style and material pipeline of Kenney SKR models:
 *   - Flat-color MeshStandardMaterial { roughness: 1, metalness: 0 }
 *   - Exact hex colours sampled from SKR colormap.png palette
 *   - Multi-layer geometry: ground plane → road slab → edge trim → features
 *   - Road surface at y = 0.75 for seamless tiling with SKR GLB pieces
 *
 * Palette colours extracted from /models/skr/Textures/colormap.png:
 *   road   #9da4c4   curb  #ffb94e   ground #36363a
 *   mark   #c1c1d8   wallG #36906a   wallW  #ca7652
 */
import * as THREE from 'three';
import { GRID_SIZE } from '../modules/track-placement.js';

/* ── Constants ─────────────────────────────────────────────── */
const C  = GRID_SIZE;        // 10 — cell size
const HC = C / 2;            // 5  — half cell
const RH = 0.75;             // road surface height (matches SKR straight)

/* ── Palette (exact hex sampled from SKR colormap.png) ─────── */
const PAL = {
  road:   0x9da4c4,   // steel blue — road slab body + surface
  ground: 0x36363a,   // dark charcoal — ground base plane
  curb:   0xffb94e,   // warm orange — edge curb trim
  mark:   0xc1c1d8,   // light grey-blue — road markings
  wallG:  0x36906a,   // green — corner barriers / guardrails
  wallW:  0xca7652,   // warm brown — end walls / feature highlights
  darkR:  0x474a58,   // charcoal — recessed surfaces, underside
};

/* ── Material cache ────────────────────────────────────────── */
const _matCache = new Map();
function mat(hex) {
  if (!_matCache.has(hex)) {
    _matCache.set(hex, new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 1,
      metalness: 0,
    }));
  }
  return _matCache.get(hex).clone();
}

/* ── Geometry helpers ──────────────────────────────────────── */

function add(group, geo, hex, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(hex));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  group.add(m);
  return m;
}

/* ── Common layer builders (match SKR model structure) ─────── */

/** Ground plane at y ≈ 0, visible around road edges. */
function addGround(g) {
  add(g, new THREE.BoxGeometry(C, 0.05, C), PAL.ground, 0, 0.025, 0);
}

/** Road slab from y = 0.05 to y = 0.75 (matches SKR road body). */
function addRoad(g) {
  const h = RH - 0.05;
  add(g, new THREE.BoxGeometry(C, h, C), PAL.road, 0, 0.05 + h / 2, 0);
}

/** Standard tile base: ground + road slab. Road surface at y = 0.75 exactly. */
function addBase(g) {
  addGround(g);
  addRoad(g);
}

/**
 * Orange curb trim strip along a cell edge.
 * Sits at the base of the road slab (y = 0.05 to ~0.15), matching SKR curb
 * placement. Narrower than the full edge so it looks like a painted kerb.
 */
function addCurb(g, side) {
  const L = C - 0.2;
  const W = 0.5;
  const H = 0.1;
  const Y = 0.05 + H / 2;
  switch (side) {
    case 'n': add(g, new THREE.BoxGeometry(L, H, W), PAL.curb, 0, Y, -HC + W / 2); break;
    case 's': add(g, new THREE.BoxGeometry(L, H, W), PAL.curb, 0, Y,  HC - W / 2); break;
    case 'e': add(g, new THREE.BoxGeometry(W, H, L), PAL.curb,  HC - W / 2, Y, 0); break;
    case 'w': add(g, new THREE.BoxGeometry(W, H, L), PAL.curb, -HC + W / 2, Y, 0); break;
  }
}

/** Add curbs on all edges EXCEPT the listed open sides. */
function addCurbsExcept(g, ...open) {
  for (const s of ['n', 's', 'e', 'w']) {
    if (!open.includes(s)) addCurb(g, s);
  }
}

/** Dashed center line running N↔S, flush on road surface. */
function addDashesNS(g) {
  const count = 5;
  const span = C * 0.7;
  const dl = span / (count * 2 - 1);
  for (let i = 0; i < count; i++) {
    const z = -span / 2 + i * dl * 2 + dl / 2;
    add(g, new THREE.BoxGeometry(0.18, 0.015, dl * 0.85), PAL.mark, 0, RH + 0.008, z);
  }
}

/** Dashed center line running E↔W. */
function addDashesEW(g) {
  const count = 5;
  const span = C * 0.7;
  const dl = span / (count * 2 - 1);
  for (let i = 0; i < count; i++) {
    const x = -span / 2 + i * dl * 2 + dl / 2;
    add(g, new THREE.BoxGeometry(dl * 0.85, 0.015, 0.18), PAL.mark, x, RH + 0.008, 0);
  }
}

/**
 * Green barrier wall along a cell edge (matches SKR corner guardrail).
 * Rises from road surface up, with a warm-coloured cap.
 */
function addBarrier(g, side) {
  const BH  = 2.0;      // barrier height above road
  const BW  = 0.8;      // barrier thickness
  const CAP = 0.15;     // cap strip height
  const Y   = RH + BH / 2;
  const yC  = RH + BH - CAP / 2;
  switch (side) {
    case 'n':
      add(g, new THREE.BoxGeometry(C, BH, BW),     PAL.wallG, 0, Y,  -HC + BW / 2);
      add(g, new THREE.BoxGeometry(C, CAP, BW + 0.1), PAL.wallW, 0, yC, -HC + BW / 2);
      break;
    case 's':
      add(g, new THREE.BoxGeometry(C, BH, BW),     PAL.wallG, 0, Y,   HC - BW / 2);
      add(g, new THREE.BoxGeometry(C, CAP, BW + 0.1), PAL.wallW, 0, yC, HC - BW / 2);
      break;
    case 'e':
      add(g, new THREE.BoxGeometry(BW, BH, C),     PAL.wallG,  HC - BW / 2, Y, 0);
      add(g, new THREE.BoxGeometry(BW + 0.1, CAP, C), PAL.wallW, HC - BW / 2, yC, 0);
      break;
    case 'w':
      add(g, new THREE.BoxGeometry(BW, BH, C),     PAL.wallG, -HC + BW / 2, Y, 0);
      add(g, new THREE.BoxGeometry(BW + 0.1, CAP, C), PAL.wallW, -HC + BW / 2, yC, 0);
      break;
  }
}

/**
 * Arc of curb trim dots for corner inner edge.
 * Thin strip at road-base level (matching SKR curb placement).
 */
function addArcCurb(g, cx, cz, r, sa = 0, ea = Math.PI / 2) {
  const steps = 14;
  const ds = 0.4;
  for (let i = 0; i <= steps; i++) {
    const a = sa + (i / steps) * (ea - sa);
    const x = cx + r * Math.cos(a);
    const z = cz - r * Math.sin(a);
    add(g, new THREE.BoxGeometry(ds, 0.1, ds), PAL.curb, x, 0.05 + 0.05, z);
  }
}

/**
 * Arc of green barrier wall segments for corner guardrails.
 * Matches the SKR corner's elevated green wall.
 */
function addArcBarrier(g, cx, cz, r, sa = 0, ea = Math.PI / 2) {
  const steps = 16;
  const BH = 2.0;
  const seg = (r * (ea - sa)) / steps;
  const bw = Math.max(seg * 0.92, 0.4);
  for (let i = 0; i <= steps; i++) {
    const a = sa + (i / steps) * (ea - sa);
    const x = cx + r * Math.cos(a);
    const z = cz - r * Math.sin(a);
    const m = add(g, new THREE.BoxGeometry(bw, BH, bw), PAL.wallG,
                  x, RH + BH / 2, z);
    m.rotation.y = a;
  }
}

/** Thin directional chevron arrow on road surface. */
function addChevron(g, dir, cx, cz) {
  const arm = 1.0, hw = 0.06;
  const y = RH + 0.008;
  if (dir === 'n' || dir === 's') {
    const s = dir === 'n' ? -1 : 1;
    const m1 = add(g, new THREE.BoxGeometry(hw * 2, 0.015, arm), PAL.wallW, cx - 0.4, y, cz + s * 0.15);
    m1.rotation.y = s * 0.4;
    const m2 = add(g, new THREE.BoxGeometry(hw * 2, 0.015, arm), PAL.wallW, cx + 0.4, y, cz + s * 0.15);
    m2.rotation.y = -s * 0.4;
  }
}

/* ── Piece builders ────────────────────────────────────────── */

const BUILDERS = {
  /* ─── Basic flat ─────────────────────────────────────────── */

  straight(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
  },

  wide(g) {
    addBase(g);
    addDashesNS(g);
    addDashesEW(g);
  },

  /* ─── Bumps ──────────────────────────────────────────────── */

  'bump-up'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    // Speed bump: matches SKR bump proportions (raised mound on road surface)
    add(g, new THREE.BoxGeometry(C * 0.8, 0.25, 2.8), PAL.darkR, 0, RH + 0.125, 0);
    add(g, new THREE.BoxGeometry(C * 0.6, 0.40, 1.4), PAL.ground, 0, RH + 0.20, 0);
  },

  'bump-down'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    // Recessed dip indicator
    add(g, new THREE.BoxGeometry(C * 0.8, 0.015, 2.8), PAL.darkR, 0, RH + 0.008, 0);
    add(g, new THREE.BoxGeometry(C * 0.5, 0.012, 0.12), PAL.wallW, 0, RH + 0.009, -1.5);
    add(g, new THREE.BoxGeometry(C * 0.5, 0.012, 0.12), PAL.wallW, 0, RH + 0.009,  1.5);
  },

  /* ─── Hills & ramps ─────────────────────────────────────── */

  'hill-beginning'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    // Ramped rise toward north (−Z) — stepped blocks matching SKR style
    add(g, new THREE.BoxGeometry(C * 0.92, 0.25, 3.0), PAL.road,  0, RH + 0.125,  1.0);
    add(g, new THREE.BoxGeometry(C * 0.92, 0.55, 2.5), PAL.road,  0, RH + 0.275, -1.5);
    add(g, new THREE.BoxGeometry(C * 0.92, 0.90, 2.0), PAL.darkR, 0, RH + 0.45,  -3.5);
    addChevron(g, 'n', 0, 3.0);
  },

  'hill-end'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    add(g, new THREE.BoxGeometry(C * 0.92, 0.90, 2.0), PAL.darkR, 0, RH + 0.45,   3.5);
    add(g, new THREE.BoxGeometry(C * 0.92, 0.55, 2.5), PAL.road,  0, RH + 0.275,  1.5);
    add(g, new THREE.BoxGeometry(C * 0.92, 0.25, 3.0), PAL.road,  0, RH + 0.125, -1.0);
    addChevron(g, 's', 0, -3.0);
  },

  'hill-complete'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    add(g, new THREE.BoxGeometry(C * 0.88, 0.35, 5.5), PAL.road,  0, RH + 0.175, 0);
    add(g, new THREE.BoxGeometry(C * 0.75, 0.65, 3.2), PAL.darkR, 0, RH + 0.325, 0);
    add(g, new THREE.BoxGeometry(C * 0.60, 0.90, 1.6), PAL.darkR, 0, RH + 0.45,  0);
  },

  'hill-complete-half'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    add(g, new THREE.BoxGeometry(C * 0.88, 0.22, 4.5), PAL.road,  0, RH + 0.11, 0);
    add(g, new THREE.BoxGeometry(C * 0.75, 0.42, 2.2), PAL.darkR, 0, RH + 0.21, 0);
  },

  /* ─── Corners (base ports: N + E) ───────────────────────── */

  'corner-small'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 'e');
    // Inner arc curb at base + outer barrier arc (matches SKR corner wall)
    addArcCurb(g, -HC, HC, 2.5, 0, Math.PI / 2);
    addArcBarrier(g, -HC, HC, 8.0, 0, Math.PI / 2);
  },

  'corner-large'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 'e');
    addArcCurb(g, -HC, HC, 4.5, 0, Math.PI / 2);
    addArcBarrier(g, -HC, HC, 8.5, 0, Math.PI / 2);
  },

  curve(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 'e');
    addArcCurb(g, -HC, HC, 3.5, 0, Math.PI / 2);
    addArcCurb(g, -HC, HC, 7.0, 0, Math.PI / 2);
  },

  'corner-small-ramp'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 'e');
    addArcCurb(g, -HC, HC, 2.5, 0, Math.PI / 2);
    addArcBarrier(g, -HC, HC, 8.0, 0, Math.PI / 2);
    // Raised ramp in NE quadrant
    add(g, new THREE.BoxGeometry(4, 0.45, 4), PAL.road, 2, RH + 0.225, -2);
  },

  'corner-large-ramp'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 'e');
    addArcCurb(g, -HC, HC, 4.5, 0, Math.PI / 2);
    addArcBarrier(g, -HC, HC, 8.5, 0, Math.PI / 2);
    add(g, new THREE.BoxGeometry(4, 0.45, 4), PAL.road, 2, RH + 0.225, -2);
  },

  /* ─── Bends & S-curves ──────────────────────────────────── */

  bend(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    // Diagonal guide line
    const m = add(g, new THREE.BoxGeometry(0.15, 0.012, 4.0), PAL.wallW, 0, RH + 0.007, 0);
    m.rotation.y = Math.PI / 6;
  },

  'bend-large'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    const m = add(g, new THREE.BoxGeometry(0.18, 0.012, 5.5), PAL.wallW, 0, RH + 0.007, 0);
    m.rotation.y = Math.PI / 4;
  },

  /* ─── Skews & offsets ───────────────────────────────────── */

  'skew-left'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    add(g, new THREE.BoxGeometry(2.2, 0.012, 0.12), PAL.wallW, -1.0, RH + 0.007, 0);
    addChevron(g, 'n', -1.5, 0);
  },

  'skew-right'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    add(g, new THREE.BoxGeometry(2.2, 0.012, 0.12), PAL.wallW, 1.0, RH + 0.007, 0);
    addChevron(g, 'n', 1.5, 0);
  },

  'skew-left-side'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    add(g, new THREE.BoxGeometry(0.10, 0.012, C * 0.55), PAL.wallW, -1.5, RH + 0.007, 0);
    add(g, new THREE.BoxGeometry(0.10, 0.012, C * 0.55), PAL.wallW, -2.5, RH + 0.007, 0);
  },

  'skew-right-side'(g) {
    addBase(g);
    addCurbsExcept(g, 'n', 's');
    addDashesNS(g);
    add(g, new THREE.BoxGeometry(0.10, 0.012, C * 0.55), PAL.wallW, 1.5, RH + 0.007, 0);
    add(g, new THREE.BoxGeometry(0.10, 0.012, C * 0.55), PAL.wallW, 2.5, RH + 0.007, 0);
  },

  /* ─── End caps ──────────────────────────────────────────── */

  'cap-front'(g) {
    addBase(g);
    addCurbsExcept(g, 's');
    addBarrier(g, 'n');
    addDashesNS(g);
  },

  'cap-back'(g) {
    addBase(g);
    addCurbsExcept(g, 'n');
    addBarrier(g, 's');
    addDashesNS(g);
  },

  end(g) {
    addBase(g);
    addCurbsExcept(g, 's');
    addBarrier(g, 'n');
    // End marker block
    add(g, new THREE.BoxGeometry(2, 0.8, 0.6), PAL.wallW, 0, RH + 0.4, -HC + 1.2);
    addDashesNS(g);
  },
};

/* ── Public API ────────────────────────────────────────────── */

/**
 * Build procedural road geometry for a custom piece type.
 * Returns a Group with centered geometry (exact 10×10 footprint).
 * Structure mirrors the wrapper/inner pattern used by GLB loadTemplate.
 */
export function buildProceduralRoad(key) {
  const inner = new THREE.Group();
  inner.name = key;

  const builder = BUILDERS[key];
  if (builder) {
    builder(inner);
  } else {
    // Fallback: plain straight
    addBase(inner);
    addCurbsExcept(inner, 'n', 's');
    addDashesNS(inner);
  }

  const wrapper = new THREE.Group();
  wrapper.name = key;
  wrapper.add(inner);
  return wrapper;
}
