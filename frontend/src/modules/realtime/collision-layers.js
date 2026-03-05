/**
 * Havok Physics Collision Layer System — Twisted Kart
 *
 * Bitmask-based collision filtering using Havok V2 Physics.
 * Each layer is a single bit in a 32-bit mask.
 *
 *   filterMembershipMask  — which layer(s) this shape belongs to
 *   filterCollideMask     — which layer(s) this shape collides with
 *
 * Two shapes interact only when BOTH directions overlap:
 *   (A.membership & B.collide) !== 0   AND   (B.membership & A.collide) !== 0
 */

// ── Layer Bits ──────────────────────────────────────────────────────────────
export const LAYER = {
  NONE:       0x0000,
  TRACK:      0x0001,   // Ground, walls, static scenery
  KART:       0x0002,   // All karts (local + remote)
  ITEM_BOX:   0x0004,   // Pickup item boxes  (trigger volumes)
  PROJECTILE: 0x0008,   // Fired projectiles   (trigger volumes)
  TRAP:       0x0010,   // Placed traps: bubblegum, banana (trigger volumes)
  BOUNDARY:   0x0020,   // Kill planes, OOB barriers
  ALL:        0xFFFF,
};

// ── Prebuilt Filter Presets ─────────────────────────────────────────────────
// Each preset defines { filterMembershipMask, filterCollideMask }.

export const FILTER = {
  /** Static track / arena geometry (ground, walls, ramps) */
  TRACK: {
    filterMembershipMask: LAYER.TRACK,
    filterCollideMask:    LAYER.KART | LAYER.PROJECTILE,
  },

  /** Any kart — local or remote */
  KART: {
    filterMembershipMask: LAYER.KART,
    filterCollideMask:    LAYER.TRACK | LAYER.KART | LAYER.ITEM_BOX
                        | LAYER.PROJECTILE | LAYER.TRAP | LAYER.BOUNDARY,
  },

  /** Item-box trigger volume */
  ITEM_BOX: {
    filterMembershipMask: LAYER.ITEM_BOX,
    filterCollideMask:    LAYER.KART,
  },

  /** Projectile trigger volume */
  PROJECTILE: {
    filterMembershipMask: LAYER.PROJECTILE,
    filterCollideMask:    LAYER.KART,
  },

  /** Placed-trap trigger volume (bubblegum / banana) */
  TRAP: {
    filterMembershipMask: LAYER.TRAP,
    filterCollideMask:    LAYER.KART,
  },

  /** Out-of-bounds / kill-plane barrier */
  BOUNDARY: {
    filterMembershipMask: LAYER.BOUNDARY,
    filterCollideMask:    LAYER.KART,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Apply a collision-layer filter to a raw PhysicsShape.
 * @param {import("@babylonjs/core").PhysicsShape} shape
 * @param {{ filterMembershipMask: number, filterCollideMask: number }} filter
 */
export function applyFilter(shape, filter) {
  if (!shape) return;
  shape.filterMembershipMask = filter.filterMembershipMask;
  shape.filterCollideMask    = filter.filterCollideMask;
}

/**
 * Convenience — apply a filter to an existing PhysicsAggregate.
 * @param {import("@babylonjs/core").PhysicsAggregate} aggregate
 * @param {{ filterMembershipMask: number, filterCollideMask: number }} filter
 */
export function applyFilterToAggregate(aggregate, filter) {
  if (!aggregate?.shape) return;
  applyFilter(aggregate.shape, filter);
}
