/**
 * road-geometry.js — Polished segment visuals.
 *
 * Each builder returns a THREE.Group whose shape closely traces a smooth
 * road centerline using ExtrudeGeometry along a CatmullRom/arc path.
 * Visuals are decoupled from the cannon-es collision blocks defined in
 * segments.js (which still use axis-aligned boxes).
 */
import * as THREE from 'three';
import { TILE, ROAD_WIDTH, ROAD_THICK, WALL_HEIGHT, WALL_THICK } from './segments.js';

// ── Materials (cached, shared) ────────────────────────────────────
const TEX = (() => {
  const make = (size, fn) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    fn(img.data, size);
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  };
  // Asphalt grain — speckle of dark gray on slightly lighter gray
  const asphalt = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 36 + Math.floor(Math.random() * 22);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v + 2; data[i * 4 + 3] = 255;
    }
  });
  // Asphalt roughness — same noise used inverted; rougher where darker
  const asphaltRough = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 200 + Math.floor(Math.random() * 50);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
  });
  // Concrete (lighter, smoother)
  const concrete = make(256, (data, size) => {
    for (let i = 0; i < size * size; i++) {
      const v = 130 + Math.floor(Math.random() * 26);
      data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v - 4; data[i * 4 + 3] = 255;
    }
  });
  return { asphalt, asphaltRough, concrete };
})();

const MATS = {
  asphalt: new THREE.MeshStandardMaterial({
    color: 0x2a2d33, map: TEX.asphalt, roughnessMap: TEX.asphaltRough,
    roughness: 0.95, metalness: 0.02,
  }),
  asphaltDark: new THREE.MeshStandardMaterial({
    color: 0x1a1c20, map: TEX.asphalt, roughness: 0.92, metalness: 0.02,
  }),
  concrete: new THREE.MeshStandardMaterial({
    color: 0x8b8e95, map: TEX.concrete, roughness: 0.78, metalness: 0.05,
  }),
  curbRed: new THREE.MeshStandardMaterial({
    color: 0xd0312d, roughness: 0.5, metalness: 0.0, emissive: 0x2a0000, emissiveIntensity: 0.4,
  }),
  curbWhite: new THREE.MeshStandardMaterial({
    color: 0xf2f2f2, roughness: 0.5, metalness: 0.0, emissive: 0x222222, emissiveIntensity: 0.3,
  }),
  paintYellow: new THREE.MeshStandardMaterial({
    color: 0xfbbf24, roughness: 0.45, metalness: 0.0, emissive: 0x3a2a00, emissiveIntensity: 0.6,
  }),
  paintWhite: new THREE.MeshStandardMaterial({
    color: 0xeeeeee, roughness: 0.45, metalness: 0.0, emissive: 0x222222, emissiveIntensity: 0.3,
  }),
  guardrail: new THREE.MeshStandardMaterial({
    color: 0xaab0bb, roughness: 0.55, metalness: 0.45,
  }),
  truss: new THREE.MeshStandardMaterial({
    color: 0x6c727f, roughness: 0.6, metalness: 0.5,
  }),
  finish: new THREE.MeshStandardMaterial({
    color: 0xfbbf24, roughness: 0.5, metalness: 0.2, emissive: 0x664400, emissiveIntensity: 0.7,
  }),
  spawn: new THREE.MeshStandardMaterial({
    color: 0x00e5ff, roughness: 0.3, metalness: 0.1, emissive: 0x006688, emissiveIntensity: 1.0,
  }),
  tunnelRoof: new THREE.MeshStandardMaterial({
    color: 0x21252c, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide,
  }),
  warning: new THREE.MeshStandardMaterial({
    color: 0xffcc00, roughness: 0.5, metalness: 0.0, emissive: 0x442200, emissiveIntensity: 0.5,
  }),
};

// ── Road cross-section profile ────────────────────────────────────
function makeDeckProfile(width = ROAD_WIDTH, thickness = ROAD_THICK, chamfer = 0.18) {
  const w = width / 2, t = thickness, c = chamfer;
  const s = new THREE.Shape();
  s.moveTo(-w + c, 0);
  s.lineTo(w - c, 0);
  s.lineTo(w, c);
  s.lineTo(w, t - c);
  s.lineTo(w - c, t);
  s.lineTo(-w + c, t);
  s.lineTo(-w, t - c);
  s.lineTo(-w, c);
  s.closePath();
  return s;
}
const DECK_PROFILE = makeDeckProfile();

// Curb cross-section: low triangular wedge sloping outward from road
function makeCurbProfile(height = 0.18, width = 0.55) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, 0);
  s.lineTo(width / 2, 0);
  s.lineTo(width / 2, height * 0.35);
  s.lineTo(-width / 2, height);
  s.closePath();
  return s;
}
const CURB_PROFILE = makeCurbProfile();

// ── Generic helpers ───────────────────────────────────────────────
function pathFromPoints(points) {
  const v3s = points.map(p => new THREE.Vector3(p[0], p[1] ?? 0, p[2]));
  return new THREE.CatmullRomCurve3(v3s, false, 'catmullrom', 0.5);
}

function arcPath3(cx, cz, radius, a0, a1, y = 0, samples = 24) {
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const a = a0 + (a1 - a0) * t;
    pts.push([cx + Math.cos(a) * radius, y, cz + Math.sin(a) * radius]);
  }
  return pathFromPoints(pts);
}

function extrudeRoad(path, opts = {}) {
  const profile = opts.profile || DECK_PROFILE;
  const steps = opts.steps || Math.max(24, Math.ceil(path.getLength() / 0.6));
  const geo = new THREE.ExtrudeGeometry(profile, {
    extrudePath: path, steps, bevelEnabled: false,
  });
  const mesh = new THREE.Mesh(geo, opts.material || MATS.asphalt);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.drivable = true;
  return mesh;
}

// Place small alternating-color curb stones along one side of a path.
function curbAlongPath(path, sideSign, opts = {}) {
  const grp = new THREE.Group();
  const count = opts.count || Math.max(6, Math.floor(path.getLength() / 0.8));
  const offset = (ROAD_WIDTH / 2) - 0.05;
  const yTop = ROAD_THICK + 0.001;
  const stone = new THREE.BoxGeometry(0.55, 0.16, 0.7);
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    // perpendicular offset in XZ
    const nx = Math.cos(yaw) * sideSign;
    const nz = -Math.sin(yaw) * sideSign;
    const m = new THREE.Mesh(stone, i % 2 === 0 ? MATS.curbRed : MATS.curbWhite);
    m.position.set(p.x + nx * offset, yTop + 0.08 + (p.y || 0), p.z + nz * offset);
    m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

// Dashed centerline paint along a path.
function dashedPaintAlongPath(path, mat = MATS.paintYellow, opts = {}) {
  const grp = new THREE.Group();
  const total = path.getLength();
  const dashLen = opts.dashLen || 1.2;
  const gapLen = opts.gapLen || 1.2;
  const cycle = dashLen + gapLen;
  const count = Math.floor(total / cycle);
  const dashGeo = new THREE.BoxGeometry(0.18, 0.04, dashLen);
  for (let i = 0; i < count; i++) {
    const t = ((i + 0.5) * cycle) / total;
    if (t > 1) break;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const yaw = Math.atan2(tan.x, tan.z);
    const m = new THREE.Mesh(dashGeo, mat);
    m.position.set(p.x, ROAD_THICK + 0.025 + (p.y || 0), p.z);
    m.rotation.y = yaw;
    m.castShadow = false; m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

// ── Builders ──────────────────────────────────────────────────────
function buildStraight(lengthZ, opts = {}) {
  const grp = new THREE.Group();
  const z0 = -lengthZ / 2;
  const z1 = lengthZ / 2;
  const path = pathFromPoints([[0, 0, z0], [0, 0, z1]]);
  grp.add(extrudeRoad(path));
  if (!opts.noCurbs) {
    grp.add(curbAlongPath(path, +1));
    grp.add(curbAlongPath(path, -1));
  }
  if (!opts.noPaint) grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildCorner(mirror) {
  const grp = new THREE.Group();
  // Quarter arc inside a single cell
  // L (mirror=false): enter -Z, exit -X; arc center at (-TILE/2, 0, -TILE/2)
  // R (mirror=true) : enter -Z, exit +X; arc center at (+TILE/2, 0, -TILE/2)
  const cx = mirror ? +TILE / 2 : -TILE / 2;
  const cz = -TILE / 2;
  const r = TILE / 2;
  // Angle from center to entry point (0,_,-TILE/2):
  //  L: dir=(+r,0,0) → atan2(0,+r)=0; exit (-TILE/2,0,0) dir=(0,0,+r) → atan2(+r,0)=π/2 → CCW 0→π/2
  //  R: dir=(-r,0,0) → atan2(0,-r)=π;  exit (+TILE/2,0,0) dir=(0,0,+r) → atan2(+r,0)=π/2 → CW π→π/2 (i.e. -π/2 sweep)
  const a0 = mirror ? Math.PI : 0;
  const a1 = Math.PI / 2;
  const path = arcPath3(cx, cz, r, a0, a1, 0, 18);
  grp.add(extrudeRoad(path));
  // Outside curb: mirror→inside is +X side of arc (closer to center cx>0), outside is -X side → side = -1
  // For L (mirror=false), center is at -TILE/2, outside is +X side → side = +1
  grp.add(curbAlongPath(path, mirror ? -1 : +1, { count: 10 }));
  // Inner edge gets a thin painted line instead of a curb
  const inner = curbAlongPath(path, mirror ? +1 : -1, { count: 10 });
  inner.children.forEach(c => { c.material = MATS.paintWhite; c.scale.set(0.4, 0.3, 0.6); c.position.y -= 0.05; });
  grp.add(inner);
  return grp;
}

function buildSweep(mirror) {
  const grp = new THREE.Group();
  // 2x2 footprint: cells (0,0),(0,1),(1,1) for left; mirrored on X for right.
  // Path turns from -Z entry on cell (0,0) to ±X exit on cell (1,1)/((-1,1)).
  // We anchor at (0,0); world centers used are simpler if we trace through
  // (0,0) → (0,1) → (1,1) cells. For mirror we trace (0,0) → (0,1) → (-1,1)
  // but our footprint stays positive (1,1). Editor still uses anchor + span.
  // Use a quarter-arc with center at (mirror? -TILE : +TILE, 0, +TILE) radius TILE.
  const cx = mirror ? -TILE : +TILE;
  const cz = +TILE;
  const r = TILE * 1.0;
  const a0 = mirror ? 0 : Math.PI;        // entry pointing toward (0,_,-TILE/2 side)
  const a1 = mirror ? -Math.PI / 2 : Math.PI / 2;
  // We want entry exactly at (0, 0, -TILE/2) heading +Z. Recompute:
  // For !mirror, center at (+TILE,0,+TILE), r=TILE: angle π → point (0,0,+TILE), tangent at angle π is (sinπ,_,?) — let's just sample and rely on arc.
  // Adjust: use a longer radius and smoother arc starting at (0, 0, -TILE/2).
  // Simpler: build the path explicitly via bezier-ish curve.
  const xExit = mirror ? -TILE : +TILE;
  const zExit = +TILE * 1.5;
  const pts = [
    [0, 0, -TILE / 2],
    [0, 0, +TILE / 2],
    [xExit * 0.3, 0, +TILE * 0.9],
    [xExit * 0.75, 0, +TILE * 1.25],
    [xExit, 0, zExit],
  ];
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 36 }));
  grp.add(curbAlongPath(path, mirror ? -1 : +1, { count: 14 }));
  grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildBend(mirror, lengthZcells = 2) {
  const grp = new THREE.Group();
  const dirX = mirror ? +1 : -1;
  const totalZ = TILE * lengthZcells;
  // S-curve from (0,_,-TILE/2) to (dirX*TILE, _, totalZ - TILE/2)
  const pts = [
    [0, 0, -TILE / 2],
    [0, 0, 0],
    [dirX * TILE * 0.5, 0, totalZ * 0.5 - TILE / 2],
    [dirX * TILE, 0, totalZ - TILE],
    [dirX * TILE, 0, totalZ - TILE / 2],
  ];
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 36 }));
  grp.add(curbAlongPath(path, +1, { count: 14 }));
  grp.add(curbAlongPath(path, -1, { count: 14 }));
  grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildChicane() {
  const grp = new THREE.Group();
  const totalZ = TILE * 4;
  const pts = [
    [0, 0, -TILE / 2],
    [0, 0, TILE * 0.0],
    [-TILE * 0.5, 0, TILE * 0.9],
    [-TILE * 0.5, 0, TILE * 1.6],
    [+TILE * 0.5, 0, TILE * 2.4],
    [+TILE * 0.5, 0, TILE * 3.1],
    [0, 0, TILE * 3.5 - TILE / 2 + TILE / 2],
    [0, 0, totalZ - TILE / 2],
  ];
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 64 }));
  grp.add(curbAlongPath(path, +1, { count: 22 }));
  grp.add(curbAlongPath(path, -1, { count: 22 }));
  grp.add(dashedPaintAlongPath(path));
  return grp;
}

function buildBanked(mirror) {
  // Sweep but the cross-section profile is rolled around the path tangent.
  // ExtrudeGeometry along a 3D path supports this natively if we displace
  // the path in Y on the outside — but that warps unevenly. Instead we
  // post-rotate the whole sweep mesh around its tangent — not feasible.
  // Practical approach: build the sweep, then rotate the entire group around
  // the chord between entry/exit axes by a fixed bank angle, biased outward.
  const grp = new THREE.Group();
  const sweep = buildSweep(mirror);
  // Apply uniform bank: rotate around Z so outside lifts up.
  // The path exit is along ±X; the appropriate bank axis isn't single — for
  // arcade feel we just lift the outside half of the deck via a soft tilt.
  // Add a wedge under the deck on the outside as a visual ramp surface.
  const dir = mirror ? -1 : +1;
  const wedge = new THREE.Mesh(
    new THREE.BoxGeometry(TILE * 0.45, 0.6, TILE * 1.6),
    MATS.concrete,
  );
  wedge.position.set(dir * TILE * 0.6, 0.3, TILE * 0.9);
  wedge.rotation.z = -dir * Math.PI / 18;
  wedge.castShadow = true; wedge.receiveShadow = true;
  grp.add(wedge);
  // Lean the sweep outward visually
  sweep.children.forEach((m) => {
    m.rotation.z = -dir * Math.PI / 18;
    m.position.y += 0.18;
  });
  grp.add(sweep);
  return grp;
}

function buildBump() {
  // Single cell straight with a low rounded hump.
  const grp = new THREE.Group();
  const samples = 20;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + TILE * t;
    const y = Math.sin(t * Math.PI) * 0.45;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 30 }));
  grp.add(curbAlongPath(path, +1, { count: 6 }));
  grp.add(curbAlongPath(path, -1, { count: 6 }));
  return grp;
}

function buildHill(lengthZcells = 2) {
  const grp = new THREE.Group();
  const totalZ = TILE * lengthZcells;
  const peak = TILE * 0.55;
  const samples = 32;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + totalZ * t;
    const y = Math.sin(t * Math.PI) * peak;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 48 }));
  grp.add(curbAlongPath(path, +1, { count: 14 }));
  grp.add(curbAlongPath(path, -1, { count: 14 }));
  grp.add(dashedPaintAlongPath(path, MATS.paintYellow, { dashLen: 1.0, gapLen: 1.5 }));
  return grp;
}

function buildRamp(yStart, yEnd, lengthZcells = 2) {
  const grp = new THREE.Group();
  const totalZ = TILE * lengthZcells;
  const samples = 18;
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + totalZ * t;
    // Smooth-step for nicer curve at top/bottom
    const e = t * t * (3 - 2 * t);
    const y = yStart + (yEnd - yStart) * e;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 28 }));
  // Side rails (guardrail) running along the ramp
  for (const side of [-1, +1]) {
    const railPts = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const z = -TILE / 2 + totalZ * t;
      const e = t * t * (3 - 2 * t);
      const y = yStart + (yEnd - yStart) * e;
      railPts.push([side * (ROAD_WIDTH / 2 - 0.1), y + ROAD_THICK + WALL_HEIGHT * 0.55, z]);
    }
    const rPath = pathFromPoints(railPts);
    const tube = new THREE.TubeGeometry(rPath, 24, 0.08, 8, false);
    const m = new THREE.Mesh(tube, MATS.guardrail);
    m.castShadow = true; m.receiveShadow = true;
    grp.add(m);
    // posts
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const p = rPath.getPointAt(t);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, WALL_HEIGHT, 0.12),
        MATS.guardrail,
      );
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.3, p.z);
      post.castShadow = true; post.receiveShadow = true;
      grp.add(post);
    }
  }
  grp.add(curbAlongPath(path, +1, { count: 14 }));
  grp.add(curbAlongPath(path, -1, { count: 14 }));
  return grp;
}

function buildJumpRamp() {
  const grp = new THREE.Group();
  const samples = 14;
  const pts = [];
  const peak = 1.4;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const z = -TILE / 2 + TILE * t;
    const y = Math.pow(t, 1.6) * peak;
    pts.push([0, y, z]);
  }
  const path = pathFromPoints(pts);
  grp.add(extrudeRoad(path, { steps: 24 }));
  // Yellow warning chevrons at the lip
  for (let i = -2; i <= 2; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.06, 0.3),
      MATS.warning,
    );
    chev.position.set(i * 1.6, ROAD_THICK + peak + 0.04, TILE / 2 - 0.4);
    chev.rotation.z = (i < 0 ? -1 : 1) * Math.PI / 16;
    grp.add(chev);
  }
  return grp;
}

function buildBridge() {
  const grp = new THREE.Group();
  const lengthZ = TILE * 2;
  const deckH = TILE * 0.6;
  const cz = lengthZ / 2 - TILE / 2;
  // Elevated deck (straight)
  const path = pathFromPoints([[0, deckH, -TILE / 2], [0, deckH, lengthZ - TILE / 2]]);
  grp.add(extrudeRoad(path, { steps: 16 }));
  grp.add(dashedPaintAlongPath(path));
  // Side guardrails (tubes + posts)
  for (const side of [-1, +1]) {
    const rPath = pathFromPoints([
      [side * (ROAD_WIDTH / 2 - 0.05), deckH + ROAD_THICK + WALL_HEIGHT * 0.6, -TILE / 2],
      [side * (ROAD_WIDTH / 2 - 0.05), deckH + ROAD_THICK + WALL_HEIGHT * 0.6, lengthZ - TILE / 2],
    ]);
    const tube = new THREE.TubeGeometry(rPath, 16, 0.1, 8, false);
    grp.add(new THREE.Mesh(tube, MATS.guardrail));
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      const p = rPath.getPointAt(t);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, WALL_HEIGHT, 0.14), MATS.guardrail);
      post.position.set(p.x, p.y - WALL_HEIGHT * 0.4, p.z);
      grp.add(post);
    }
  }
  // Arched truss underneath (two arches forming an X across the span)
  const arch = (xOffset) => {
    const archPath = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(xOffset, 0, -TILE / 2),
      new THREE.Vector3(xOffset, deckH * 1.05, cz),
      new THREE.Vector3(xOffset, 0, lengthZ - TILE / 2),
    );
    const tube = new THREE.TubeGeometry(archPath, 24, 0.18, 8, false);
    const m = new THREE.Mesh(tube, MATS.truss);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  grp.add(arch(-ROAD_WIDTH / 2 + 0.3));
  grp.add(arch(+ROAD_WIDTH / 2 - 0.3));
  // Cross-bracing every couple meters
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const z = -TILE / 2 + lengthZ * t;
    const yArch = deckH * 1.05 * (1 - 4 * Math.pow(t - 0.5, 2));
    const brace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, ROAD_WIDTH - 0.4, 8),
      MATS.truss,
    );
    brace.rotation.z = Math.PI / 2;
    brace.position.set(0, yArch, z);
    grp.add(brace);
  }
  return grp;
}

function buildBridgeRamp(direction) {
  // direction: 'up' => 0 → deckH, 'down' => deckH → 0
  const deckH = TILE * 0.6;
  return direction === 'up' ? buildRamp(0, deckH, 2) : buildRamp(deckH, 0, 2);
}

function buildTunnel() {
  const grp = new THREE.Group();
  const lengthZ = TILE * 2;
  const cz = lengthZ / 2 - TILE / 2;
  const path = pathFromPoints([[0, 0, -TILE / 2], [0, 0, lengthZ - TILE / 2]]);
  grp.add(extrudeRoad(path));
  grp.add(curbAlongPath(path, +1, { count: 14 }));
  grp.add(curbAlongPath(path, -1, { count: 14 }));
  // Half-cylinder roof
  const roofR = ROAD_WIDTH / 2 + 0.4;
  const roofGeo = new THREE.CylinderGeometry(
    roofR, roofR, lengthZ, 24, 1, true, 0, Math.PI,
  );
  const roof = new THREE.Mesh(roofGeo, MATS.tunnelRoof);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.4, cz);
  roof.castShadow = true; roof.receiveShadow = true;
  grp.add(roof);
  // Glow strip down the middle of the ceiling
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.08, lengthZ * 0.96),
    new THREE.MeshStandardMaterial({
      color: 0xfff2cc, emissive: 0xffd060, emissiveIntensity: 1.4, roughness: 0.4,
    }),
  );
  strip.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.4 + roofR - 0.18, cz);
  grp.add(strip);
  // End rim arches
  for (const z of [-TILE / 2 + 0.05, lengthZ - TILE / 2 - 0.05]) {
    const ringGeo = new THREE.TorusGeometry(roofR + 0.05, 0.18, 8, 24, Math.PI);
    const ring = new THREE.Mesh(ringGeo, MATS.truss);
    ring.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.4, z);
    ring.rotation.y = Math.PI / 2;
    grp.add(ring);
  }
  return grp;
}

function buildTJunction() {
  const grp = new THREE.Group();
  // Full-cell deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, ROAD_THICK, TILE),
    MATS.asphalt,
  );
  deck.position.y = ROAD_THICK / 2;
  deck.castShadow = false; deck.receiveShadow = true;
  deck.userData.drivable = true;
  grp.add(deck);
  // Chamfered fillets at the two interior corners (-X/+Z and +X/+Z are open;
  // -X/-Z and +X/-Z meet the entry; we close +Z edge with a curb).
  // Add curb stripes along the closed +Z edge (warning of dead end? no, T means
  // +Z is closed). Use yellow warning chevrons.
  for (let i = -2; i <= 2; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.06, 0.3),
      MATS.warning,
    );
    chev.position.set(i * 1.7, ROAD_THICK + 0.04, TILE / 2 - 0.5);
    chev.rotation.y = (i < 0 ? -1 : 1) * Math.PI / 14;
    grp.add(chev);
  }
  // Center plate
  const center = new THREE.Mesh(
    new THREE.CylinderGeometry(2.0, 2.0, 0.06, 24),
    MATS.paintWhite,
  );
  center.position.set(0, ROAD_THICK + 0.04, 0);
  grp.add(center);
  // Solid back wall (low) along closed +Z edge
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT * 0.7, WALL_THICK),
    MATS.guardrail,
  );
  wall.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.35, TILE / 2 - WALL_THICK / 2);
  wall.castShadow = true; wall.receiveShadow = true;
  grp.add(wall);
  return grp;
}

function buildCrossroads() {
  const grp = new THREE.Group();
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, ROAD_THICK, TILE),
    MATS.asphalt,
  );
  deck.position.y = ROAD_THICK / 2;
  deck.receiveShadow = true;
  deck.userData.drivable = true;
  grp.add(deck);
  // Painted cross at center
  for (const rot of [0, Math.PI / 2]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(TILE * 0.85, 0.05, 0.22),
      MATS.paintWhite,
    );
    stripe.position.y = ROAD_THICK + 0.03;
    stripe.rotation.y = rot;
    grp.add(stripe);
  }
  // Center diamond
  const dia = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.4, 0.06, 4),
    MATS.warning,
  );
  dia.position.set(0, ROAD_THICK + 0.04, 0);
  dia.rotation.y = Math.PI / 4;
  grp.add(dia);
  return grp;
}

function buildPlaza() {
  const grp = new THREE.Group();
  const cx = TILE / 2, cz = TILE / 2;
  const W = TILE * 2;
  // Main concrete plaza with darker asphalt center
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(W, ROAD_THICK, W),
    MATS.concrete,
  );
  base.position.set(cx, ROAD_THICK / 2, cz);
  base.receiveShadow = true;
  base.userData.drivable = true;
  grp.add(base);
  // Inner asphalt patch
  const inner = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.7, 0.06, W * 0.7),
    MATS.asphalt,
  );
  inner.position.set(cx, ROAD_THICK + 0.03, cz);
  grp.add(inner);
  // Border ring (white paint)
  const ringGeo = new THREE.RingGeometry(W * 0.36, W * 0.38, 48);
  const ring = new THREE.Mesh(ringGeo, MATS.paintWhite);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(cx, ROAD_THICK + 0.05, cz);
  grp.add(ring);
  // Corner pillars
  for (const sx of [-1, +1]) for (const sz of [-1, +1]) {
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 1.6, 12),
      MATS.guardrail,
    );
    pillar.position.set(cx + sx * (W / 2 - 0.5), ROAD_THICK + 0.8, cz + sz * (W / 2 - 0.5));
    pillar.castShadow = true; pillar.receiveShadow = true;
    grp.add(pillar);
  }
  return grp;
}

function buildCapEnd() {
  const grp = new THREE.Group();
  // Re-use straight deck for the cell
  grp.add(buildStraight(TILE, { noPaint: true }));
  // Chevron warning wall at +Z edge
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT * 1.1, WALL_THICK * 1.4),
    MATS.guardrail,
  );
  wall.position.set(0, ROAD_THICK + WALL_HEIGHT * 0.55, TILE / 2 - WALL_THICK * 0.7);
  wall.castShadow = true; wall.receiveShadow = true;
  grp.add(wall);
  // Yellow/black hazard chevrons on the wall face
  for (let i = -2; i <= 2; i++) {
    const chev = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.5, 0.06),
      i % 2 === 0 ? MATS.warning : new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }),
    );
    chev.position.set(i * 1.8, ROAD_THICK + WALL_HEIGHT * 0.55, TILE / 2 - WALL_THICK * 1.4 + 0.04);
    grp.add(chev);
  }
  return grp;
}

function buildFinish() {
  const grp = new THREE.Group();
  grp.add(buildStraight(TILE, { noPaint: true }));
  // Checker pattern across the road
  const cells = 12;
  const cellW = ROAD_WIDTH / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      const isBlack = (i + j) % 2 === 0;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(cellW * 0.98, 0.06, cellW * 0.98),
        isBlack
          ? new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.5 })
          : MATS.paintWhite,
      );
      tile.position.set(
        -ROAD_WIDTH / 2 + cellW * (i + 0.5),
        ROAD_THICK + 0.04,
        (j - 0.5) * cellW * 1.0,
      );
      grp.add(tile);
    }
  }
  // Side gantry posts
  for (const sx of [-1, +1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 3.2, 12),
      MATS.finish,
    );
    post.position.set(sx * (TILE / 2 - 0.3), ROAD_THICK + 1.6, 0);
    post.castShadow = true;
    grp.add(post);
  }
  // Top crossbar with banner
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(TILE - 0.4, 0.35, 0.35),
    MATS.finish,
  );
  bar.position.set(0, ROAD_THICK + 3.1, 0);
  bar.castShadow = true;
  grp.add(bar);
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(TILE - 0.8, 0.9, 0.05),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffaa00, emissiveIntensity: 0.4, roughness: 0.6,
    }),
  );
  banner.position.set(0, ROAD_THICK + 2.45, 0);
  grp.add(banner);
  return grp;
}

function buildSpawn() {
  const grp = new THREE.Group();
  grp.add(buildStraight(TILE, { noPaint: true, noCurbs: true }));
  // Glowing pad
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(2.6, 2.6, 0.08, 32),
    MATS.spawn,
  );
  pad.position.set(0, ROAD_THICK + 0.05, 0);
  grp.add(pad);
  // Ring around pad
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.8, 0.08, 8, 32),
    MATS.spawn,
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, ROAD_THICK + 0.06, 0);
  grp.add(ring);
  // Forward arrow
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.6, 1.2, 4),
    MATS.spawn,
  );
  arrow.rotation.x = Math.PI / 2;
  arrow.rotation.z = Math.PI / 4;
  arrow.position.set(0, ROAD_THICK + 0.4, 1.4);
  grp.add(arrow);
  return grp;
}

// ── Registry ──────────────────────────────────────────────────────
export const VISUAL_BUILDERS = {
  straight:        () => buildStraight(TILE),
  straight2:       () => { const g = buildStraight(TILE * 2); g.position.z = TILE / 2; return g; },
  straight4:       () => { const g = buildStraight(TILE * 4); g.position.z = TILE * 1.5; return g; },
  corner:          () => buildCorner(false),
  cornerR:         () => buildCorner(true),
  corner_large:    () => buildSweep(false),
  corner_largeR:   () => buildSweep(true),
  bend_left:       () => buildBend(false, 2),
  bend_right:      () => buildBend(true, 2),
  chicane:         () => buildChicane(),
  banked_turn:     () => buildBanked(false),
  banked_turnR:    () => buildBanked(true),
  bump_up:         () => buildBump(),
  hill_complete:   () => { const g = buildHill(2); g.position.z = TILE / 2; return g; },
  jump_ramp:       () => buildJumpRamp(),
  ramp_up:         () => { const g = buildRamp(0, TILE * 0.6, 2); g.position.z = TILE / 2; return g; },
  ramp_down:       () => { const g = buildRamp(TILE * 0.6, 0, 2); g.position.z = TILE / 2; return g; },
  plateau:         () => {
    const g = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH, ROAD_THICK, TILE), MATS.asphalt);
    deck.position.y = TILE * 0.6 + ROAD_THICK / 2;
    deck.userData.drivable = true; deck.castShadow = true; deck.receiveShadow = true;
    g.add(deck);
    // Side guardrails
    for (const side of [-1, +1]) {
      const tube = new THREE.TubeGeometry(
        pathFromPoints([
          [side * (ROAD_WIDTH / 2 - 0.05), TILE * 0.6 + ROAD_THICK + WALL_HEIGHT * 0.55, -TILE / 2],
          [side * (ROAD_WIDTH / 2 - 0.05), TILE * 0.6 + ROAD_THICK + WALL_HEIGHT * 0.55, TILE / 2],
        ]),
        12, 0.08, 6, false,
      );
      g.add(new THREE.Mesh(tube, MATS.guardrail));
    }
    // Concrete pillars
    for (const sz of [-1, +1]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(ROAD_WIDTH * 0.75, TILE * 0.6, 0.5),
        MATS.concrete,
      );
      pillar.position.set(0, TILE * 0.3, sz * (TILE / 2 - 0.25));
      pillar.castShadow = true; pillar.receiveShadow = true;
      g.add(pillar);
    }
    return g;
  },
  bridge:          () => { const g = buildBridge(); g.position.z = TILE / 2; return g; },
  bridge_onramp:   () => { const g = buildBridgeRamp('up'); g.position.z = TILE / 2; return g; },
  bridge_offramp:  () => { const g = buildBridgeRamp('down'); g.position.z = TILE / 2; return g; },
  tunnel:          () => { const g = buildTunnel(); g.position.z = TILE / 2; return g; },
  t_junction:      () => buildTJunction(),
  crossroads:      () => buildCrossroads(),
  wide:            () => buildPlaza(),
  cap_end:         () => buildCapEnd(),
  finish:          () => buildFinish(),
  spawn:           () => buildSpawn(),
};
