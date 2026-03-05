/**
 * track-data.js — Central track metadata registry
 *
 * Provides path resolution, scale, spawn positions and feature flags
 * for every selectable track and arena (custom maps, STK race tracks,
 * STK battle arenas).
 *
 * Start positions for STK tracks come from the SuperTuxKart SVN
 * scene.xml files (with a +3 Y offset so the car settles via physics).
 */

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const TRACK_REGISTRY = {
  // ── Custom maps ──────────────────────────────────────────────────────────
  map1: {
    type: 'custom',
    scale: 8,
    start: { x: 0, y: 5, z: 0 },
    startHeading: 0,
    hasGates: true,
    hasDecorations: true,
    hasTrackOutline: true,
  },
  map2: {
    type: 'custom',
    scale: 8,
    start: { x: 0, y: 5, z: 0 },
    startHeading: 0,
    hasGates: true,
    hasDecorations: true,
    hasTrackOutline: true,
  },

  // ── STK Race Tracks (start positions from quads.xml quad-0 center) ───────
  cocoa_temple:         { type: 'stk-track', scale: 1, laps: 3, name: 'Cocoa Temple',          start: { x:  26.252, y:   1.567, z:  43.161 }, startHeading: 0 },
  hacienda:             { type: 'stk-track', scale: 1, laps: 3, name: 'Hacienda',              start: { x:   0.000, y:   2.010, z:   5.000 }, startHeading: 0 },
  minigolf:             { type: 'stk-track', scale: 1, laps: 4, name: 'Minigolf',              start: { x:  -0.078, y:   3.482, z: -40.984 }, startHeading: 0 },
  sandtrack:            { type: 'stk-track', scale: 1, laps: 3, name: 'Shifting Sands',        start: { x:   1.373, y: -137.339,z:  11.154 }, startHeading: 0 },
  snowtuxpeak:          { type: 'stk-track', scale: 1, laps: 3, name: 'Snow Peak',             start: { x:-197.576, y:   2.944, z:  37.242 }, startHeading: 0 },
  zengarden:            { type: 'stk-track', scale: 1, laps: 4, name: 'Zen Garden',            start: { x:   1.494, y:   3.258, z:   0.121 }, startHeading: 0 },
  lighthouse:           { type: 'stk-track', scale: 1, laps: 4, name: 'Around the Lighthouse', start: { x:  26.262, y: -11.323, z: -51.253 }, startHeading: 0 },
  olivermath:           { type: 'stk-track', scale: 1, laps: 6, name: "Oliver's Math Class",   start: { x: -13.293, y:   2.936, z:  -2.885 }, startHeading: 0 },
  black_forest:         { type: 'stk-track', scale: 1, laps: 2, name: 'Black Forest',          start: { x:-104.994, y:   9.232, z:  63.053 }, startHeading: 0 },
  xr591:                { type: 'stk-track', scale: 1, laps: 3, name: 'XR591',                 start: { x:  -0.329, y:   3.402, z: -12.348 }, startHeading: 0 },
  oasis:                { type: 'stk-track', scale: 1, laps: 3, name: 'Oasis',                 start: { x:   0.000, y:   5.000, z:   0.000 }, startHeading: 0 },
  gran_paradiso_island: { type: 'stk-track', scale: 1, laps: 3, name: 'Gran Paradiso Island',  start: { x: 132.111, y:   8.992, z:  86.829 }, startHeading: 0 },
  mines:                { type: 'stk-track', scale: 1, laps: 3, name: 'Old Mine',              start: { x:   0.349, y:   2.880, z:  15.354 }, startHeading: 0 },
  snowmountain:         { type: 'stk-track', scale: 1, laps: 3, name: 'Northern Resort',       start: { x:   0.024, y:   0.759, z:   5.187 }, startHeading: 0 },
  abyss:                { type: 'stk-track', scale: 1, laps: 3, name: 'Antediluvian Abyss',    start: { x:  -5.843, y:   4.505, z:-131.870 }, startHeading: 0 },
  cornfield_crossing:   { type: 'stk-track', scale: 1, laps: 3, name: 'Cornfield Crossing',    start: { x:   0.409, y:   3.355, z:  21.760 }, startHeading: 0 },
  volcano_island:       { type: 'stk-track', scale: 1, laps: 2, name: 'Volcan Island',         start: { x: -36.382, y:  15.980, z:-135.976 }, startHeading: 0 },
  ravenbridge_mansion:  { type: 'stk-track', scale: 1, laps: 3, name: 'Ravenbridge Mansion',   start: { x:  -4.698, y:   2.267, z: -75.783 }, startHeading: 0 },

  // ── STK Battle Arenas ────────────────────────────────────────────────────
  // block fort: classic MK64-inspired arena; start from content-registry.js battle positions
  blockfort:                   { type: 'stk-arena', scale: 1, start: { x: 70.59, y: 7.89, z: 18.84 }, startHeading: 0 },
  battleisland:                { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  lasdunasarena:               { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  cave:                        { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  pumpkin_park:                { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  arena_candela_city:          { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  ancient_colosseum_labyrinth: { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  stadium:                     { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  alien_signal:                { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
  temple:                      { type: 'stk-arena', scale: 1, start: { x: 0, y: 5, z: 0 }, startHeading: 0 },
};

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Look up registry entry. Falls back to a generic custom-map entry so
 * the game never crashes on an unknown id.
 */
export function getTrackInfo(mapId) {
  return TRACK_REGISTRY[mapId] || {
    type: 'custom',
    scale: 8,
    start: { x: 0, y: 5, z: 0 },
    startHeading: 0,
    hasGates: false,
    hasDecorations: false,
    hasTrackOutline: false,
  };
}

export function isSTKTrack(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'stk-track';
}

export function isSTKArena(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'stk-arena';
}

export function isCustomMap(mapId) {
  const info = TRACK_REGISTRY[mapId];
  return info?.type === 'custom';
}

/** Returns the URL path to the main .glb model for this track/arena. */
export function getTrackModelPath(mapId) {
  const info = getTrackInfo(mapId);
  if (info.type === 'stk-track') return `/models/stk/tracks/${mapId}/track.glb`;
  if (info.type === 'stk-arena') return `/models/stk/arenas/${mapId}/arena.glb`;
  return `/models/maps/${mapId}/track.glb`;
}

/** Uniform scale to apply to the loaded .glb model. */
export function getTrackScale(mapId) {
  return getTrackInfo(mapId).scale;
}

/** Spawn position {x, y, z}. */
export function getStartPosition(mapId) {
  return { ...getTrackInfo(mapId).start };
}

/** Heading in radians around Y axis. */
export function getStartHeading(mapId) {
  return getTrackInfo(mapId).startHeading || 0;
}

/** Y coordinate below which the car is considered to have fallen off. */
export function getFallThreshold(mapId) {
  const info = getTrackInfo(mapId);
  return info.start.y - 80;
}

/** Whether this track has a gates.glb checkpoint file. */
export function hasGates(mapId) {
  return !!getTrackInfo(mapId).hasGates;
}

/** Whether this track has a decorations.glb. */
export function hasDecorations(mapId) {
  return !!getTrackInfo(mapId).hasDecorations;
}

/** Whether this track has a track-outline.glb for the minimap. */
export function hasTrackOutline(mapId) {
  return !!getTrackInfo(mapId).hasTrackOutline;
}

/**
 * Reposition an Ammo.js car body to the track's start position.
 * Call after the physics body has been created.
 */
export function applyStartPosition(ammo, carBody, vehicle, mapId) {
  const pos = getStartPosition(mapId);
  const heading = getStartHeading(mapId);

  const zero = new ammo.btVector3(0, 0, 0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);

  const transform = new ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new ammo.btVector3(pos.x, pos.y, pos.z));

  // Apply heading rotation around Y axis
  if (heading !== 0) {
    const halfAngle = heading / 2;
    const quat = new ammo.btQuaternion(0, Math.sin(halfAngle), 0, Math.cos(halfAngle));
    transform.setRotation(quat);
    ammo.destroy(quat);
  }

  carBody.setWorldTransform(transform);
  carBody.getMotionState().setWorldTransform(transform);

  // Reset steering
  if (vehicle) {
    for (let i = 0; i < 2; i++) {
      vehicle.setSteeringValue(0, i);
    }
  }

  ammo.destroy(zero);
  ammo.destroy(transform);
}
