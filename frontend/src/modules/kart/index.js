// frontend/src/modules/kart/index.js
//
// Phase 1.3 — Foundational kart API surface.
//
// Per project architecture direction, the editor3 stack (Three.js + cannon-es)
// is the FOUNDATIONAL engine; the Babylon + Havok stack (modules/kart-physics.js,
// modules/babylon-car.js, modules/realtime/kart-entity.js, etc.) is TRANSITIONAL
// and slated for retirement.
//
// This barrel re-exports the foundational kart APIs from their current locations
// without moving files (which would require rewriting ~38 import statements and
// is too risky for one commit). New code — especially the upcoming PvP weapons
// system and the editor3 → multiplayer bridge — should import kart APIs FROM
// HERE so that future relocations only have to update one file.
//
// Engine separation:
//   * Foundational (re-exported below):
//       editor3/kart-catalog.js   — registry (41 karts, IDs, asset paths, trail profiles)
//       editor3/kart-loader.js    — Three.js GLB loader, scale normalization, wheel pivots
//       editor3/kart-audio.js     — Web Audio kits + engine profiles (engine-agnostic)
//       kart-glo.js               — underglow rig (Three.js renderer hooks + pure math)
//       modules/kart.js           — weight-class state machine (engine-agnostic)
//   * Transitional (NOT re-exported — keep direct imports until those modules retire):
//       modules/kart-physics.js, modules/babylon-car.js,
//       modules/realtime/kart-entity.js, modules/realtime/kart-vfx.js
//
// When the Babylon stack is finally retired, the editor3 files can be physically
// moved into this directory and the re-export paths flipped — without changing
// any consumer that imports through this barrel.

// --- Registry (engine-agnostic) -------------------------------------------
export {
  KARTS,
  KART_BY_ID,
  DEFAULT_KART_ID,
  resolveSelectedKartId,
  getKart,
  KART_TRAIL_PROFILES,
  getKartTrailProfile,
} from '../../editor3/kart-catalog.js';

// --- Loader (Three.js + cannon-es) ----------------------------------------
export {
  KART_TARGET_LENGTH,
  KART_MAX_WIDTH,
  KART_PHYSICS_HALF_TRACK,
  KART_PHYSICS_HALF_BASE,
  loadKartTemplate,
  cloneKart,
  resolveKartWheels,
  preloadAllKarts,
} from '../../editor3/kart-loader.js';

// --- Audio (Web Audio, engine-agnostic) -----------------------------------
export {
  STD_KIT,
  V8_TBOLT_KIT,
  V8_STINGER_KIT,
  V8_CORSAIR_KIT,
  V8_CARAVELLE_KIT,
  V8_KITS,
  STD_ENGINE_PROFILE,
  V8_ENGINE_PROFILE,
  createKartAudio,
} from '../../editor3/kart-audio.js';

// --- Underglow / GLO customization ----------------------------------------
export {
  DEFAULT_GLO_EFFECT,
  DEFAULT_GLO_COLOR,
  DEFAULT_GLO_COLOR2,
  getStoredGlo,
  computeGloLook,
  createKartUnderglow,
} from '../../kart-glo.js';

// --- Weight-class state machine (engine-agnostic) -------------------------
export {
  WEIGHT_CLASSES,
  createKartState,
  updateKart,
  getEngineForce,
  getBrakingForce,
  getRearFriction,
} from '../kart.js';
