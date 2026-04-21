export const STRAIGHT_CONNECTOR_SPAN = 4.286;

export const CUSTOM_ARENA_DIR = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });

const CUSTOM_ARENA_PORT_DEFS = {
  'skr-straight':  [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skr-corner':    [CUSTOM_ARENA_DIR.S, CUSTOM_ARENA_DIR.W],
  'skr-finish':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skr-bump':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'straight-2x':   [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'straight-3x':   [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'straight-4x':   [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'ramp-up':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'ramp-down':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'jump-ramp':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'landing-ramp':  [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'hill':          [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'dip':           [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  's-curve':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bank-left':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bank-right':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'gentle-s':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-ramp-up':   [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-ramp-down': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-1x':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-2x':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-3x':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-4x':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'crossover':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E, CUSTOM_ARENA_DIR.S, CUSTOM_ARENA_DIR.W],
  't-junction':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E, CUSTOM_ARENA_DIR.S],

  // ── Pittsburgh-themed bridges ──
  'pgh-clemente':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-warhol':        [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-carson':        [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-fort-pitt':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-fort-duquesne': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-west-end':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-veterans':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-16th-st':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-south-10th':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-31st-st':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-mckees-rocks':  [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-smithfield':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-liberty':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-62nd-st':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-birmingham':    [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-40th-st':       [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-hot-metal':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-glenwood':      [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-highland-park': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-homestead':     [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
};

/** Span definitions for multi-cell pieces (default 1×1 if absent). */
const SEGMENT_SPANS = {
  'straight-2x': { x: 1, z: 2 },
  'straight-3x': { x: 1, z: 3 },
  'straight-4x': { x: 1, z: 4 },
  'gentle-s':    { x: 1, z: 3 },
  'bridge-ramp-up':  { x: 1, z: 2 },
  'bridge-ramp-down': { x: 1, z: 2 },
  'bridge-2x':   { x: 1, z: 2 },
  'bridge-3x':   { x: 1, z: 3 },
  'bridge-4x':   { x: 1, z: 4 },

  // ── Pittsburgh bridges (multi-cell) ──
  'pgh-clemente':      { x: 1, z: 2 },
  'pgh-warhol':        { x: 1, z: 2 },
  'pgh-carson':        { x: 1, z: 2 },
  'pgh-fort-pitt':     { x: 1, z: 3 },
  'pgh-fort-duquesne': { x: 1, z: 3 },
  'pgh-west-end':      { x: 1, z: 2 },
  'pgh-veterans':      { x: 1, z: 4 },
  'pgh-16th-st':       { x: 1, z: 4 },
  'pgh-south-10th':    { x: 1, z: 3 },
  'pgh-31st-st':       { x: 1, z: 4 },
  'pgh-mckees-rocks':  { x: 1, z: 5 },
  'pgh-smithfield':    { x: 1, z: 3 },
  'pgh-liberty':       { x: 1, z: 6 },
  'pgh-birmingham':    { x: 1, z: 5 },
  'pgh-40th-st':       { x: 1, z: 4 },
  'pgh-hot-metal':     { x: 1, z: 4 },
  'pgh-glenwood':      { x: 1, z: 3 },
  'pgh-highland-park': { x: 1, z: 3 },
  'pgh-homestead':     { x: 1, z: 3 },
};

export const CUSTOM_ARENA_TRACK_ASSETS = [
  // ── SKR base tiles ──
  { key: 'skr-straight', file: 'track-straight.glb', label: 'Straight' },
  { key: 'skr-corner',   file: 'track-corner.glb',   label: 'Corner' },
  { key: 'skr-finish',   file: 'track-finish.glb',   label: 'Finish Line' },
  { key: 'skr-bump',     file: 'track-bump.glb',     label: 'Speed Bump' },

  // ── Warped variants (no GLB file — generated at runtime) ──
  { key: 'straight-2x',  file: null, label: 'Straight 2×',   base: 'skr-straight' },
  { key: 'straight-3x',  file: null, label: 'Straight 3×',   base: 'skr-straight' },
  { key: 'straight-4x',  file: null, label: 'Straight 4×',   base: 'skr-straight' },
  { key: 'ramp-up',      file: null, label: 'Ramp Up',       base: 'skr-straight' },
  { key: 'ramp-down',    file: null, label: 'Ramp Down',     base: 'skr-straight' },
  { key: 'jump-ramp',    file: null, label: 'Jump Ramp',     base: 'skr-straight' },
  { key: 'landing-ramp', file: null, label: 'Landing',       base: 'skr-straight' },
  { key: 'hill',         file: null, label: 'Hill',          base: 'skr-straight' },
  { key: 'dip',          file: null, label: 'Dip',           base: 'skr-straight' },
  { key: 's-curve',      file: null, label: 'S-Curve',       base: 'skr-straight' },
  { key: 'bank-left',    file: null, label: 'Bank Left',     base: 'skr-straight' },
  { key: 'bank-right',   file: null, label: 'Bank Right',    base: 'skr-straight' },
  { key: 'gentle-s',     file: null, label: 'Gentle S-Curve',base: 'skr-straight' },
  { key: 'bridge-ramp-up',   file: null, label: 'Bridge On-Ramp',  base: 'skr-straight' },
  { key: 'bridge-ramp-down', file: null, label: 'Bridge Off-Ramp', base: 'skr-straight' },
  { key: 'bridge-1x',     file: null, label: 'Bridge 1×',       base: 'skr-straight' },
  { key: 'bridge-2x',     file: null, label: 'Bridge 2×',       base: 'skr-straight' },
  { key: 'bridge-3x',     file: null, label: 'Bridge 3×',       base: 'skr-straight' },
  { key: 'bridge-4x',     file: null, label: 'Bridge 4×',       base: 'skr-straight' },
  { key: 'crossover',     file: null, label: 'Crossover',        base: null },
  { key: 't-junction',    file: null, label: 'T-Junction',       base: null },

  // ── Pittsburgh-themed bridges (warped from skr-straight GLB) ──
  { key: 'pgh-clemente',      file: null, label: 'Roberto Clemente Br.',  base: 'skr-straight' },
  { key: 'pgh-warhol',        file: null, label: 'Andy Warhol Br.',       base: 'skr-straight' },
  { key: 'pgh-carson',        file: null, label: 'Rachel Carson Br.',     base: 'skr-straight' },
  { key: 'pgh-fort-pitt',     file: null, label: 'Fort Pitt Br.',         base: 'skr-straight' },
  { key: 'pgh-fort-duquesne', file: null, label: 'Fort Duquesne Br.',     base: 'skr-straight' },
  { key: 'pgh-west-end',      file: null, label: 'West End Br.',          base: 'skr-straight' },
  { key: 'pgh-veterans',      file: null, label: 'Veterans Br.',          base: 'skr-straight' },
  { key: 'pgh-16th-st',       file: null, label: '16th Street Br.',       base: 'skr-straight' },
  { key: 'pgh-south-10th',    file: null, label: 'South 10th St Br.',     base: 'skr-straight' },
  { key: 'pgh-31st-st',       file: null, label: '31st Street Br.',       base: 'skr-straight' },
  { key: 'pgh-mckees-rocks',  file: null, label: 'McKees Rocks Br.',      base: 'skr-straight' },
  { key: 'pgh-smithfield',    file: null, label: 'Smithfield St Br.',     base: 'skr-straight' },
  { key: 'pgh-liberty',       file: null, label: 'Liberty Br.',           base: 'skr-straight' },
  { key: 'pgh-62nd-st',       file: null, label: '62nd Street Br.',       base: 'skr-straight' },
  { key: 'pgh-birmingham',    file: null, label: 'Birmingham Br.',        base: 'skr-straight' },
  { key: 'pgh-40th-st',       file: null, label: '40th Street Br.',       base: 'skr-straight' },
  { key: 'pgh-hot-metal',     file: null, label: 'Hot Metal Br.',         base: 'skr-straight' },
  { key: 'pgh-glenwood',      file: null, label: 'Glenwood Br.',          base: 'skr-straight' },
  { key: 'pgh-highland-park', file: null, label: 'Highland Park Br.',     base: 'skr-straight' },
  { key: 'pgh-homestead',     file: null, label: 'Homestead Grays Br.',   base: 'skr-straight' },
];

const CUSTOM_ARENA_SEGMENT_ASSET_MAP = new Map(CUSTOM_ARENA_TRACK_ASSETS.map((asset) => [asset.key, asset]));

const LEGACY_SEGMENT_ALIASES = {
  straight: { key: 'skr-straight' },
  flat_wide: { key: 'skr-straight' },
  curve_left: { key: 'skr-corner', mirrorX: true },
  curve_right: { key: 'skr-corner' },
  ramp_up: { key: 'ramp-up' },
  ramp_down: { key: 'ramp-down' },
};

export function resolveCustomArenaSegmentSpec(type) {
  const rawKey = String(type || 'straight').trim();
  const alias = LEGACY_SEGMENT_ALIASES[rawKey];
  const key = alias?.key || rawKey;
  const asset = CUSTOM_ARENA_SEGMENT_ASSET_MAP.get(key);
  if (!asset) return null;
  return {
    ...asset,
    mirrorX: !!alias?.mirrorX,
    canonicalKey: key,
    sourceKey: rawKey,
  };
}

export function oppositeCustomArenaDir(dir) {
  return (Number(dir) + 2) % 4;
}

export function getCustomArenaBasePorts(type) {
  const spec = resolveCustomArenaSegmentSpec(type);
  const key = spec?.canonicalKey || String(type || 'straight').trim();
  return [...(CUSTOM_ARENA_PORT_DEFS[key] || [])];
}

export function getCustomArenaPortsAtRotation(type, rotDeg = 0) {
  const ports = getCustomArenaBasePorts(type);
  const steps = Math.round((((Number(rotDeg) % 360) + 360) % 360) / 90);
  return ports.map((dir) => (dir + steps) % 4);
}

export function getFallbackSegmentFootprint(type, gridSize) {
  const spec = resolveCustomArenaSegmentSpec(type);
  const key = spec?.canonicalKey || String(type || 'skr-straight').trim();
  const span = SEGMENT_SPANS[key] || { x: 1, z: 1 };
  return {
    width: gridSize * span.x,
    length: gridSize * span.z,
    height: gridSize * 0.12,
  };
}
