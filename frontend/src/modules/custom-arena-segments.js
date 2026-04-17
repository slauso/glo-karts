export const STRAIGHT_CONNECTOR_SPAN = 4.286;

/**
 * Pittsburgh bridge definitions — maps piece key to bridge name & structural type.
 * Shared between Three.js builder and Babylon.js runtime.
 */
export const PGH_BRIDGE_DEFS = Object.freeze({
  'pgh-clemente':      { label: 'Roberto Clemente Bridge',  type: 'suspension',   color: 0xC39953, deckScale: 1.0  },
  'pgh-warhol':        { label: 'Andy Warhol Bridge',       type: 'suspension',   color: 0xC39953, deckScale: 1.05 },
  'pgh-carson':        { label: 'Rachel Carson Bridge',     type: 'suspension',   color: 0xC39953, deckScale: 0.95 },
  'pgh-fort-pitt':     { label: 'Fort Pitt Bridge',         type: 'bowstring',    color: 0x8B9DAF, deckScale: 1.15 },
  'pgh-fort-duquesne': { label: 'Fort Duquesne Bridge',     type: 'bowstring',    color: 0x7A8B99, deckScale: 1.0  },
  'pgh-west-end':      { label: 'West End Bridge',          type: 'tied-arch',    color: 0x6B8E6B, deckScale: 1.2  },
  'pgh-veterans':      { label: 'Veterans Bridge',          type: 'tied-arch',    color: 0x9BAFB0, deckScale: 1.0  },
  'pgh-16th-st':       { label: 'David McCullough Bridge',  type: 'tied-arch',    color: 0xB8A88A, deckScale: 0.9  },
  'pgh-south-10th':    { label: 'South 10th St Bridge',     type: 'tied-arch',    color: 0x7B9BAF, deckScale: 0.85 },
  'pgh-31st-st':       { label: '31st Street Bridge',       type: 'tied-arch',    color: 0x8E9E8E, deckScale: 0.9  },
  'pgh-mckees-rocks':  { label: 'McKees Rocks Bridge',      type: 'tied-arch',    color: 0xA09080, deckScale: 1.1  },
  'pgh-smithfield':    { label: 'Smithfield St Bridge',     type: 'lenticular',   color: 0x5C7A5C, deckScale: 0.85 },
  'pgh-liberty':       { label: 'Liberty Bridge',           type: 'cantilever',   color: 0x6E7F6E, deckScale: 1.1  },
  'pgh-62nd-st':       { label: '62nd Street Bridge',       type: 'cantilever',   color: 0x8A9A8A, deckScale: 0.95 },
  'pgh-birmingham':    { label: 'Birmingham Bridge',        type: 'girder',       color: 0x4E6E8E, deckScale: 1.0  },
  'pgh-40th-st':       { label: '40th Street Bridge',       type: 'girder',       color: 0x7A8A7A, deckScale: 0.9  },
  'pgh-hot-metal':     { label: 'Hot Metal Bridge',         type: 'truss',        color: 0x8B4513, deckScale: 1.05 },
  'pgh-glenwood':      { label: 'Glenwood Bridge',          type: 'truss',        color: 0x6B7B6B, deckScale: 1.15 },
  'pgh-highland-park': { label: 'Highland Park Bridge',     type: 'steel-arch',   color: 0x708090, deckScale: 1.1  },
  'pgh-homestead':     { label: 'Homestead Grays Bridge',   type: 'steel-arch',   color: 0x696969, deckScale: 1.0  },
});

export const CUSTOM_ARENA_DIR = Object.freeze({ N: 0, E: 1, S: 2, W: 3 });

const CUSTOM_ARENA_PORT_DEFS = {
  straight: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  wide: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E, CUSTOM_ARENA_DIR.S, CUSTOM_ARENA_DIR.W],
  'corner-small': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  'corner-large': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  curve: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  'bump-up': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bump-down': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'hill-beginning': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'hill-end': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'hill-complete': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'hill-complete-half': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'corner-small-ramp': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  'corner-large-ramp': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  bend: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bend-large': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skew-left': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skew-right': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skew-left-side': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'skew-right-side': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'cap-front': [CUSTOM_ARENA_DIR.S],
  'cap-back': [CUSTOM_ARENA_DIR.N],
  end: [CUSTOM_ARENA_DIR.S],
  // Phase 3 — new piece types
  't-junction': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E, CUSTOM_ARENA_DIR.S],
  crossroads: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E, CUSTOM_ARENA_DIR.S, CUSTOM_ARENA_DIR.W],
  'banked-turn': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.E],
  jump: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  tunnel: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  bridge: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-onramp': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'bridge-offramp': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  chicane: [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'ramp-up': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'ramp-down': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  // Pittsburgh Bridge Collection
  'pgh-clemente': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-warhol': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-carson': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-fort-pitt': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-fort-duquesne': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-west-end': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-veterans': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-16th-st': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-south-10th': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-31st-st': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-mckees-rocks': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-smithfield': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-liberty': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-62nd-st': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-birmingham': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-40th-st': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-hot-metal': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-glenwood': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-highland-park': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
  'pgh-homestead': [CUSTOM_ARENA_DIR.N, CUSTOM_ARENA_DIR.S],
};

export const CUSTOM_ARENA_TRACK_ASSETS = [
  { key: 'straight', file: 'track-road-wide-straight.glb', label: 'Straight' },
  { key: 'corner-large', file: 'track-road-wide-corner-large.glb', label: 'Corner L' },
  { key: 'corner-small', file: 'track-road-wide-corner-small.glb', label: 'Corner S' },
  { key: 'corner-large-ramp', file: 'track-road-wide-corner-large-ramp.glb', label: 'Corner L Ramp' },
  { key: 'corner-small-ramp', file: 'track-road-wide-corner-small-ramp.glb', label: 'Corner S Ramp' },
  { key: 'curve', file: 'track-road-wide-curve.glb', label: 'Curve' },
  { key: 'bend', file: 'track-road-wide-straight-bend.glb', label: 'Bend' },
  { key: 'bend-large', file: 'track-road-wide-straight-bend-large.glb', label: 'Bend Large' },
  { key: 'bump-up', file: 'track-road-wide-straight-bump-up.glb', label: 'Bump Up' },
  { key: 'bump-down', file: 'track-road-wide-straight-bump-down.glb', label: 'Bump Down' },
  { key: 'hill-beginning', file: 'track-road-wide-straight-hill-beginning.glb', label: 'Hill Start' },
  { key: 'hill-end', file: 'track-road-wide-straight-hill-end.glb', label: 'Hill End' },
  { key: 'hill-complete', file: 'track-road-wide-straight-hill-complete.glb', label: 'Hill Full' },
  { key: 'hill-complete-half', file: 'track-road-wide-straight-hill-complete-half.glb', label: 'Hill Half' },
  { key: 'skew-left', file: 'track-road-wide-straight-skew-left.glb', label: 'Skew Left' },
  { key: 'skew-right', file: 'track-road-wide-straight-skew-right.glb', label: 'Skew Right' },
  { key: 'skew-left-side', file: 'track-road-wide-straight-skew-left-side.glb', label: 'Skew L Side' },
  { key: 'skew-right-side', file: 'track-road-wide-straight-skew-right-side.glb', label: 'Skew R Side' },
  { key: 'cap-front', file: 'track-road-wide-cap-front.glb', label: 'Cap Front' },
  { key: 'cap-back', file: 'track-road-wide-cap-back.glb', label: 'Cap Back' },
  { key: 'wide', file: 'track-road-wide.glb', label: 'Wide Pad' },
  { key: 'end', file: 'track-end.glb', label: 'End' },
  // Phase 3 — new procedural-only pieces (no GLB, generated at runtime)
  { key: 't-junction', file: null, label: 'T-Junction' },
  { key: 'crossroads', file: null, label: 'Crossroads' },
  { key: 'banked-turn', file: null, label: 'Banked Turn' },
  { key: 'jump', file: null, label: 'Jump' },
  { key: 'tunnel', file: null, label: 'Tunnel' },
  { key: 'bridge', file: null, label: 'Bridge' },
  { key: 'bridge-onramp', file: null, label: 'Bridge On-Ramp' },
  { key: 'bridge-offramp', file: null, label: 'Bridge Off-Ramp' },
  { key: 'chicane', file: null, label: 'Chicane' },
  { key: 'ramp-up', file: null, label: 'Ramp Up' },
  { key: 'ramp-down', file: null, label: 'Ramp Down' },
  // Pittsburgh Bridge Collection
  { key: 'pgh-clemente', file: null, label: 'Roberto Clemente Bridge' },
  { key: 'pgh-warhol', file: null, label: 'Andy Warhol Bridge' },
  { key: 'pgh-carson', file: null, label: 'Rachel Carson Bridge' },
  { key: 'pgh-fort-pitt', file: null, label: 'Fort Pitt Bridge' },
  { key: 'pgh-fort-duquesne', file: null, label: 'Fort Duquesne Bridge' },
  { key: 'pgh-west-end', file: null, label: 'West End Bridge' },
  { key: 'pgh-veterans', file: null, label: 'Veterans Bridge' },
  { key: 'pgh-16th-st', file: null, label: 'David McCullough Bridge' },
  { key: 'pgh-south-10th', file: null, label: 'South 10th St Bridge' },
  { key: 'pgh-31st-st', file: null, label: '31st Street Bridge' },
  { key: 'pgh-mckees-rocks', file: null, label: 'McKees Rocks Bridge' },
  { key: 'pgh-smithfield', file: null, label: 'Smithfield St Bridge' },
  { key: 'pgh-liberty', file: null, label: 'Liberty Bridge' },
  { key: 'pgh-62nd-st', file: null, label: '62nd Street Bridge' },
  { key: 'pgh-birmingham', file: null, label: 'Birmingham Bridge' },
  { key: 'pgh-40th-st', file: null, label: '40th Street Bridge' },
  { key: 'pgh-hot-metal', file: null, label: 'Hot Metal Bridge' },
  { key: 'pgh-glenwood', file: null, label: 'Glenwood Bridge' },
  { key: 'pgh-highland-park', file: null, label: 'Highland Park Bridge' },
  { key: 'pgh-homestead', file: null, label: 'Homestead Grays Bridge' },
];

const CUSTOM_ARENA_SEGMENT_ASSET_MAP = new Map(CUSTOM_ARENA_TRACK_ASSETS.map((asset) => [asset.key, asset]));

const LEGACY_SEGMENT_ALIASES = {
  flat_wide: { key: 'wide' },
  curve_left: { key: 'corner-large', mirrorX: true },
  curve_right: { key: 'corner-large' },
  ramp_up: { key: 'hill-beginning' },
  ramp_down: { key: 'hill-end' },
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
  const key = spec?.canonicalKey || String(type || 'straight').trim();
  const heightMap = {
    'ramp-up': gridSize * 0.35,
    'ramp-down': gridSize * 0.35,
    bridge: gridSize * 0.45,
    'bridge-onramp': gridSize * 0.7,
    'bridge-offramp': gridSize * 0.7,
    jump: gridSize * 0.22,
    tunnel: gridSize * 0.25,
  };
  const height = heightMap[key] || (PGH_BRIDGE_DEFS[key] ? gridSize * 0.45 : gridSize * 0.12);

  // Multi-cell segments: match builder footprints
  let width = gridSize;
  let length = gridSize;
  if (key === 'bridge-onramp' || key === 'bridge-offramp') {
    length = gridSize * 2; // footprint [[0,0],[0,1]]
  } else if (key === 'wide') {
    width = gridSize * 2;  // footprint [[0,0],[1,0],[0,1],[1,1]]
    length = gridSize * 2;
  }

  return { width, length, height };
}
