/**
 * surface-scroll.js — central registry + tick for animated UV scroll on
 * hazard surface meshes (ice, lava, water). Each registered mesh has its
 * texture `offset` advanced every frame so the surface looks alive even
 * before the player drives onto it.
 *
 * Mirrors the pickup-spin pattern: registry + per-frame tick driven by
 * both the editor and play render loops so a hazard placed in the studio
 * looks identical when the track is run live.
 */

const _scrollers = new Set();
const _ticks = new Set();

/**
 * Register a mesh whose material(s) should have their texture offsets
 * advanced each frame.
 *
 * IMPORTANT: pass a *cloned* texture (e.g. via `cloneTex` in
 * `road-geometry.js`). If you pass a shared `MOD_TEX.*` texture every
 * other mesh that references it will see the offsets crawl too —
 * which is exactly what was wrecking the pickup / track surfaces
 * before this contract was tightened.
 *
 * @param {THREE.Mesh} mesh    target mesh
 * @param {{u?:number,v?:number}} rate  UV units per second (default 0.05/0.0)
 */
export function registerSurfaceScroll(mesh, rate = {}) {
  if (!mesh) return;
  _scrollers.add({ mesh, u: rate.u ?? 0.05, v: rate.v ?? 0.0 });
}

/**
 * Register a generic per-frame tick callback. Used for hazard VFX
 * (bubble pops on lava/oil, flare plumes, ripple swells) that need
 * arbitrary procedural animation rather than just a UV scroll.
 *
 * The callback receives `(dt, t)` where `t` is the cumulative tick
 * time so callbacks can phase-shift independent instances. Returning
 * `false` (or detaching the host) lazily prunes the registration.
 *
 * @param {{host:THREE.Object3D, fn:(dt:number,t:number)=>any}} entry
 */
export function registerSurfaceTick(entry) {
  if (!entry || !entry.fn) return;
  entry.t = 0;
  _ticks.add(entry);
}

/** Advance the UV scroll. dt in seconds. */
export function tickSurfaceScroll(dt) {
  if (_scrollers.size) {
    const dead = [];
    // Now that each scroller owns a *cloned* texture, every entry's
    // offset advances independently — no need to dedupe across the set.
    for (const entry of _scrollers) {
      const m = entry.mesh;
      if (!m || !m.parent) { dead.push(entry); continue; }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const seen = new Set();
      for (const mat of mats) {
        if (!mat) continue;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'emissiveMap']) {
          const tex = mat[key];
          if (!tex || seen.has(tex)) continue;
          seen.add(tex);
          tex.offset.x += entry.u * dt;
          tex.offset.y += entry.v * dt;
        }
      }
    }
    for (const e of dead) _scrollers.delete(e);
  }
  if (_ticks.size) {
    const dead = [];
    for (const entry of _ticks) {
      const host = entry.host;
      if (host && !host.parent) { dead.push(entry); continue; }
      entry.t += dt;
      const r = entry.fn(dt, entry.t);
      if (r === false) dead.push(entry);
    }
    for (const e of dead) _ticks.delete(e);
  }
}

/** Clear the registry (used between editor scene rebuilds). */
export function clearSurfaceScroll() {
  _scrollers.clear();
  _ticks.clear();
}
