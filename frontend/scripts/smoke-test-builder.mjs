/**
 * smoke-test-builder.mjs — Offline end-to-end smoke test for the
 * track builder's grid placement and auto-connect logic.
 *
 * Simulates a human placing track segments on the grid and verifies:
 * 1. Every piece type can be placed
 * 2. Auto-connect finds valid rotations for neighbor connections
 * 3. Straight chains, L-turns, and mixed loops produce connected tracks
 * 4. Rotation behaviour is correct for all pieces
 *
 * Run:  node scripts/smoke-test-builder.mjs
 */

// ── Inline copies of the pure logic from grid-placement.js ───
// (We can't `import` from the actual module because it uses THREE.js)

const DIR = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });
const DIR_NAMES = ['N', 'E', 'S', 'W'];

const DIR_DX = [0, 1, 0, -1];
const DIR_DZ = [-1, 0, 1, 0];
function oppositeDir(d) { return (d + 2) % 4; }

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

function getPortsAtRotation(key, rotDeg) {
  const def = PIECE_DEFS[key];
  if (!def) return [];
  const steps = Math.round(((rotDeg % 360) + 360) % 360 / 90);
  return def.ports.map(d => (d + steps) % 4);
}

function hasPort(key, rotDeg, dir) {
  return getPortsAtRotation(key, rotDeg).includes(dir);
}

function cellKey(gx, gz) { return `${gx},${gz}`; }

// ── Simple grid state (no THREE dependency) ──────────────────

class GridState {
  constructor() { this.cells = new Map(); }
  isOccupied(gx, gz) { return this.cells.has(cellKey(gx, gz)); }
  get(gx, gz) { return this.cells.get(cellKey(gx, gz)) || null; }
  set(gx, gz, pieceKey, rotation) {
    this.cells.set(cellKey(gx, gz), { pieceKey, rotation });
  }

  /** Find the rotation that maximises connections with neighbors. */
  findBestRotation(gx, gz, pieceKey) {
    const rots = [0, 90, 180, 270];
    let best = 0, bestScore = -1;
    for (const rot of rots) {
      const ports = getPortsAtRotation(pieceKey, rot);
      let score = 0;
      for (const d of ports) {
        const nx = gx + DIR_DX[d];
        const nz = gz + DIR_DZ[d];
        const neighbor = this.get(nx, nz);
        if (neighbor && hasPort(neighbor.pieceKey, neighbor.rotation, oppositeDir(d))) {
          score++;
        }
      }
      if (score > bestScore) { bestScore = score; best = rot; }
    }
    return { rotation: best, connections: bestScore };
  }

  /** Count how many of this piece's ports connect to neighbours. */
  countConnections(gx, gz) {
    const cell = this.get(gx, gz);
    if (!cell) return 0;
    const ports = getPortsAtRotation(cell.pieceKey, cell.rotation);
    let count = 0;
    for (const d of ports) {
      const nx = gx + DIR_DX[d];
      const nz = gz + DIR_DZ[d];
      const neighbor = this.get(nx, nz);
      if (neighbor && hasPort(neighbor.pieceKey, neighbor.rotation, oppositeDir(d))) {
        count++;
      }
    }
    return count;
  }
}

// ── Test runner ──────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ── Tests ────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════');
console.log('  BUILDER SMOKE TEST — Grid Placement & Auto-Connect');
console.log('═══════════════════════════════════════════════════\n');

// TEST 1: Every piece can be placed and has a valid PIECE_DEF
console.log('TEST 1: Every piece has a valid definition');
const allKeys = Object.keys(PIECE_DEFS);
for (const key of allKeys) {
  const def = PIECE_DEFS[key];
  assert(def.ports.length > 0, `${key} has at least one port`);
  assert(def.category, `${key} has a category`);
  for (const port of def.ports) {
    assert(port >= 0 && port <= 3, `${key} port ${port} is valid direction`);
  }
}
console.log(`  ${allKeys.length} pieces validated\n`);

// TEST 2: Port rotation is correct for all pieces at all rotations
console.log('TEST 2: Port rotation correctness');
for (const key of allKeys) {
  const def = PIECE_DEFS[key];
  for (const rot of [0, 90, 180, 270]) {
    const ports = getPortsAtRotation(key, rot);
    assert(ports.length === def.ports.length,
      `${key} at ${rot}° has ${def.ports.length} ports`);
    // All ports must be in 0..3
    for (const p of ports) {
      assert(p >= 0 && p <= 3, `${key} at ${rot}° port ${p} is valid`);
    }
  }
}
console.log(`  All rotations validated\n`);

// TEST 3: Straight chain (N-S) — 5 straights in a column
console.log('TEST 3: Straight N-S chain (5 pieces)');
{
  const grid = new GridState();
  grid.set(0, 0, 'straight', 0);
  for (let z = 1; z <= 4; z++) {
    const { rotation, connections } = grid.findBestRotation(0, z, 'straight');
    grid.set(0, z, 'straight', rotation);
    assert(rotation === 0 || rotation === 180,
      `Straight at (0,${z}) auto-rotates to N-S (got ${rotation}°)`);
    assert(connections >= 1,
      `Straight at (0,${z}) connects to at least 1 neighbor`);
  }
  // Verify middle pieces connect to both N and S neighbors
  assert(grid.countConnections(0, 2) === 2, 'Middle straight connects N and S');
  console.log('  ✓ Straight chain passes\n');
}

// TEST 4: L-turn — straight → corner → straight
console.log('TEST 4: L-turn (straight → corner → straight)');
{
  const grid = new GridState();
  // Straight going N-S at (0,0)
  grid.set(0, 0, 'straight', 0);

  // Corner at (0,-1) should connect S to straight's N, then open E
  const { rotation: cornerRot } = grid.findBestRotation(0, -1, 'corner-large');
  grid.set(0, -1, 'corner-large', cornerRot);
  assert(grid.countConnections(0, -1) >= 1, 'Corner connects to straight below');

  // Find which direction the corner opens to (besides toward straight)
  const cornerPorts = getPortsAtRotation('corner-large', cornerRot);
  const nonSouth = cornerPorts.filter(d => d !== DIR.S);
  assert(nonSouth.length === 1, 'Corner has one non-connecting port');

  // Place a straight in the open direction
  const openDir = nonSouth[0];
  const nx = 0 + DIR_DX[openDir];
  const nz = -1 + DIR_DZ[openDir];
  const { rotation: exitRot, connections: exitConn } = grid.findBestRotation(nx, nz, 'straight');
  grid.set(nx, nz, 'straight', exitRot);
  assert(exitConn >= 1, `Exit straight at (${nx},${nz}) connects to corner`);
  console.log('  ✓ L-turn passes\n');
}

// TEST 5: All N-S pieces chain with straight
console.log('TEST 5: Every N-S piece connects to straight');
{
  const nsKeys = allKeys.filter(k => {
    const p = PIECE_DEFS[k].ports;
    return p.includes(DIR.N) && p.includes(DIR.S);
  });

  for (const key of nsKeys) {
    const grid = new GridState();
    grid.set(0, 0, 'straight', 0);
    const { rotation, connections } = grid.findBestRotation(0, 1, key);
    grid.set(0, 1, key, rotation);
    assert(connections >= 1, `${key} auto-connects to straight (rot=${rotation}°)`);
  }
  console.log(`  ${nsKeys.length} N-S pieces tested\n`);
}

// TEST 6: Corners chain with each other (90° turns)
console.log('TEST 6: Corner chain — 4 corners form a loop');
{
  const grid = new GridState();
  // Place corners at the 4 cells of a 2×2 region to form a closed loop
  // (0,0) needs E,S → rot 90;  (1,0) needs W,S → rot 180
  // (1,1) needs W,N → rot 270; (0,1) needs N,E → rot 0
  grid.set(0, 0, 'corner-large', 90);
  grid.set(1, 0, 'corner-large', 180);
  grid.set(1, 1, 'corner-large', 270);
  grid.set(0, 1, 'corner-large', 0);

  assert(grid.countConnections(0, 0) === 2, 'Corner (0,0) fully connected');
  assert(grid.countConnections(1, 0) === 2, 'Corner (1,0) fully connected');
  assert(grid.countConnections(1, 1) === 2, 'Corner (1,1) fully connected');
  assert(grid.countConnections(0, 1) === 2, 'Corner (0,1) fully connected');
  console.log('  ✓ Corner loop passes\n');
}

// TEST 7: Mixed track — build a rectangular circuit with correct rotations
console.log('TEST 7: Mixed rectangular circuit (manual rotations)');
{
  const grid = new GridState();
  // Build a closed rectangular circuit:
  //   row 0: corner(0,0) straight(1,0) skew(2,0) corner(3,0)
  //   row 1: straight(0,1)                       straight(3,1)
  //   row 2: corner(0,2) bump(1,2)     hill(2,2) corner(3,2)
  //
  // Corner rotations for correct connectivity:
  //   top-left (0,0): needs E,S → rot 90
  //   top-right (3,0): needs W,S → rot 180
  //   bottom-right (3,2): needs W,N → rot 270
  //   bottom-left (0,2): needs E,N → rot 0
  // E-W pieces need rot 90 (ports E,W), N-S pieces need rot 0 (ports N,S)

  grid.set(0, 0, 'corner-large', 90);
  grid.set(1, 0, 'straight', 90);
  grid.set(2, 0, 'skew-left', 90);
  grid.set(3, 0, 'corner-large', 180);
  grid.set(3, 1, 'straight', 0);
  grid.set(3, 2, 'corner-large', 270);
  grid.set(2, 2, 'hill-complete', 90);
  grid.set(1, 2, 'bump-up', 90);
  grid.set(0, 2, 'corner-large', 0);
  grid.set(0, 1, 'straight', 0);

  // Count total connections — a closed 10-piece loop should have 10 bidirectional connections
  let totalConnections = 0;
  for (const [key] of grid.cells) {
    const [gx, gz] = key.split(',').map(Number);
    totalConnections += grid.countConnections(gx, gz);
  }
  // Each connection counted twice → 10 connections = 20 total
  assert(totalConnections / 2 >= 8, `Circuit has ${totalConnections / 2} connections (expected 10)`);
  // Verify each piece is fully connected (2 connections each)
  let fullyConnected = 0;
  for (const [key] of grid.cells) {
    const [gx, gz] = key.split(',').map(Number);
    if (grid.countConnections(gx, gz) === 2) fullyConnected++;
  }
  assert(fullyConnected === 10, `${fullyConnected}/10 pieces fully connected`);
  console.log(`  ✓ Mixed circuit: ${totalConnections / 2} connections, ${fullyConnected}/10 fully connected\n`);
}

// TEST 8: Cap pieces terminate correctly
console.log('TEST 8: Cap pieces terminate track ends');
{
  const grid = new GridState();
  grid.set(0, 0, 'straight', 0);
  // cap-front has port S → should attach to straight's N port
  const { rotation: capRot, connections } = grid.findBestRotation(0, -1, 'cap-front');
  grid.set(0, -1, 'cap-front', capRot);
  assert(connections >= 1, 'cap-front connects to straight N');

  // cap-back has port N → should attach to straight's S port
  const { rotation: backRot, connections: backConn } = grid.findBestRotation(0, 1, 'cap-back');
  grid.set(0, 1, 'cap-back', backRot);
  assert(backConn >= 1, 'cap-back connects to straight S');
  console.log('  ✓ Cap termination passes\n');
}

// TEST 9: Wide piece (4-way) connects in all directions
console.log('TEST 9: Wide piece (4-way connector)');
{
  const grid = new GridState();
  grid.set(0, 0, 'wide', 0);
  // Place straights in all 4 directions
  for (const d of [DIR.N, DIR.E, DIR.S, DIR.W]) {
    const nx = DIR_DX[d];
    const nz = DIR_DZ[d];
    const { rotation, connections } = grid.findBestRotation(nx, nz, 'straight');
    grid.set(nx, nz, 'straight', rotation);
    assert(connections >= 1, `Straight ${DIR_NAMES[d]} of wide connects (rot=${rotation}°)`);
  }
  assert(grid.countConnections(0, 0) === 4, 'Wide piece has 4 connections');
  console.log('  ✓ Wide 4-way passes\n');
}

// TEST 10: Every piece type placed next to a straight auto-connects
console.log('TEST 10: Universal connectivity — every piece connects to at least one neighbor');
{
  let ok = 0;
  for (const key of allKeys) {
    const grid = new GridState();
    // Place a wide piece at center (4-way, connects any direction)
    grid.set(0, 0, 'wide', 0);
    // Try placing the test piece in each adjacent cell
    let connected = false;
    for (const d of [DIR.N, DIR.E, DIR.S, DIR.W]) {
      const nx = DIR_DX[d];
      const nz = DIR_DZ[d];
      const { connections } = grid.findBestRotation(nx, nz, key);
      if (connections > 0) { connected = true; break; }
    }
    assert(connected, `${key} can connect to wide piece in at least one direction`);
    if (connected) ok++;
  }
  console.log(`  ${ok}/${allKeys.length} pieces connect to wide\n`);
}

// ── Summary ──────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
