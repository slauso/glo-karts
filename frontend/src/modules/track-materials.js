/**
 * track-materials.js — Shared material palette for track segments.
 *
 * Single-source color/surface definitions used by both the Three.js builder
 * preview and the Babylon.js runtime procedural meshes.
 */

/** Raw hex palette — engine-agnostic. */
export const PALETTE = Object.freeze({
  asphalt:      0x5e697c,
  asphaltDark:  0x536074,
  asphaltWarm:  0x687488,
  curb:         0xd46e43,
  stripe:       0xdfe7f1,
  edge:         0xa8b4c3,
  accentBlue:   0x63b4ff,
  accentGold:   0xffc063,
  accentGreen:  0x4bd297,
  accentRed:    0xff7d66,
  support:      0x344155,
  underlay:     0x2d394c,
  // Surface-specific colors (Phase 4)
  dirt:         0x8b6e4e,
  ice:          0xb8daf0,
  boost:        0x22ccff,
  water:        0x3366aa,
});

/** Surface type definitions with physics multipliers. */
export const SURFACE_TYPES = Object.freeze({
  asphalt: {
    label: 'Asphalt',
    color: PALETTE.asphalt,
    gripMultiplier: 1.0,
    speedMultiplier: 1.0,
    dragMultiplier: 1.0,
  },
  dirt: {
    label: 'Dirt',
    color: PALETTE.dirt,
    gripMultiplier: 0.55,
    speedMultiplier: 0.85,
    dragMultiplier: 1.3,
  },
  ice: {
    label: 'Ice',
    color: PALETTE.ice,
    gripMultiplier: 0.15,
    speedMultiplier: 1.0,
    dragMultiplier: 0.7,
  },
  boost: {
    label: 'Boost',
    color: PALETTE.boost,
    gripMultiplier: 1.0,
    speedMultiplier: 1.6,
    dragMultiplier: 0.5,
  },
  water: {
    label: 'Water',
    color: PALETTE.water,
    gripMultiplier: 0.35,
    speedMultiplier: 0.6,
    dragMultiplier: 2.0,
  },
});

/** Skybox presets (Phase 4). */
export const SKYBOX_PRESETS = Object.freeze({
  day:    { label: 'Day',    clearColor: 0x87ceeb, fogColor: 0x87ceeb, fogDensity: 0.002, ambientIntensity: 0.6, sunIntensity: 1.2 },
  sunset: { label: 'Sunset', clearColor: 0xff7744, fogColor: 0xff9966, fogDensity: 0.003, ambientIntensity: 0.4, sunIntensity: 0.9 },
  night:  { label: 'Night',  clearColor: 0x0a0a1e, fogColor: 0x0a0a1e, fogDensity: 0.006, ambientIntensity: 0.15, sunIntensity: 0.3 },
  space:  { label: 'Space',  clearColor: 0x000011, fogColor: 0x000011, fogDensity: 0.001, ambientIntensity: 0.1, sunIntensity: 0.5 },
});

/** Ground material presets (Phase 4). */
export const GROUND_PRESETS = Object.freeze({
  grass: { label: 'Grass', color: 0x2d5a27 },
  desert: { label: 'Desert Sand', color: 0xc2a060 },
  snow: { label: 'Snow', color: 0xe8e8f0 },
  dark: { label: 'Dark', color: 0x222240 },
});

/**
 * Segment geometry constants — shared between builder and runtime.
 * All dimensions are relative to GRID_SIZE.
 */
export function getSegmentConstants(gridSize) {
  return Object.freeze({
    GRID_SIZE: gridSize,
    HALF: gridSize / 2,
    DECK_HEIGHT: 0.75,
    ROAD_WIDTH: gridSize * 0.95,
    CURB_WIDTH: 0.36,
    HALF_STRAIGHT: gridSize * 0.56,
    CAP_LENGTH: gridSize * 0.34,
  });
}

/** Resolve a surface type definition, defaulting to asphalt. */
export function getSurfaceType(surfaceKey) {
  return SURFACE_TYPES[surfaceKey] || SURFACE_TYPES.asphalt;
}
