export const STRAIGHT_CONNECTOR_SPAN = 4.286;

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
  return {
    width: gridSize,
    length: gridSize,
    height: gridSize * 0.12,
  };
}
