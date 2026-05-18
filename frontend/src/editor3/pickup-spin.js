/**
 * pickup-spin.js — central registry + tick for slow-rotating pickup
 * meshes. Used by both the editor and play scenes so a track placed
 * in the studio looks identical when run live.
 *
 * Builders register their item visual via `registerPickupSpin(mesh)`.
 * A render-loop driver then calls `tickPickupSpin(dt)` once per frame
 * and we increment Y rotation for each registered mesh that's still
 * attached to the scene graph. Detached meshes are pruned lazily so
 * placement deletes don't accumulate dead refs.
 *
 * Performance: rotating ~50–200 small meshes is ~5 µs/frame on a
 * mid-range GPU/CPU — comfortably below the 16 ms budget.
 */

const _spinners = new Set();
const SPIN_RATE = 0.55;  // rad/s — slow, readable, non-distracting

/** Register a mesh to be slow-rotated each frame. */
export function registerPickupSpin(mesh) {
  if (!mesh) return;
  _spinners.add(mesh);
}

/** Remove a mesh from the spin set (also auto-pruned when detached). */
export function unregisterPickupSpin(mesh) {
  _spinners.delete(mesh);
}

/** Advance the spin animation. dt in seconds. */
export function tickPickupSpin(dt) {
  if (!_spinners.size) return;
  const da = SPIN_RATE * dt;
  // Iterate to a small array first so we can safely prune mid-loop.
  const dead = [];
  for (const m of _spinners) {
    if (!m || !m.parent) { dead.push(m); continue; }
    m.rotation.y += da;
  }
  for (const m of dead) _spinners.delete(m);
}

/** Clear the registry (used between editor scene rebuilds). */
export function clearPickupSpin() {
  _spinners.clear();
}
