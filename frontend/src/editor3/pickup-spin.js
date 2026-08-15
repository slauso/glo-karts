/**
 * pickup-spin.js — central registry + tick for animated pickup meshes.
 * Used by the editor, the single-player playtest AND the multiplayer
 * client so a track placed in the studio looks & feels identical when
 * run live or shared online.
 *
 * Historically this only applied a slow Y rotation. It now drives a
 * Mario-Kart-8-style "alive" idle for every registered pickup:
 *   - continuous Y spin
 *   - gentle vertical bob (sine)
 *   - subtle axis tilt / tumble (sine, offset phase)
 *   - soft scale pulse
 * plus one-shot spawn (pop-in) and collect (dissolve/rise) transitions
 * so grabbing and respawning an item box reads clearly.
 *
 * API is backwards-compatible: `registerPickupSpin(mesh)` still works.
 * Callers may pass a profile name or options object as a 2nd argument
 * to tune the feel per pickup type.
 *
 * Dependency-free (no THREE import): we only touch mesh.rotation /
 * .position / .scale which are plain-object-like on Object3D.
 */

// mesh -> state
const _anim = new Map();

// Global clock so every pickup shares a coherent wave while individual
// phase offsets keep neighbouring boxes from pulsing in lockstep.
let _clock = 0;
let _phaseSeed = 0;

/**
 * Named feel profiles. Amplitudes are in the pickup's *local* units;
 * most pickup hosts are roughly ~1 unit tall so these read well.
 */
const PROFILES = {
  // Default item-box / crate feel — lively spin, clear bob, tumble tilt.
  box: {
    spin: 0.95, bobAmp: 0.11, bobRate: 2.3,
    tiltAmp: 0.09, tiltRate: 1.7, pulseAmp: 0.045, pulseRate: 3.1,
  },
  // Coins / discs — faster flat spin, tiny bob, no tilt.
  coin: {
    spin: 2.6, bobAmp: 0.06, bobRate: 3.0,
    tiltAmp: 0.0, tiltRate: 0, pulseAmp: 0.03, pulseRate: 4.0,
  },
  // Health orb / floaty energy — slow spin, tall bob, breathing pulse.
  orb: {
    spin: 0.7, bobAmp: 0.16, bobRate: 1.9,
    tiltAmp: 0.05, tiltRate: 1.3, pulseAmp: 0.07, pulseRate: 2.2,
  },
  // Static-ish prop pedestals — legacy slow spin, minimal motion.
  prop: {
    spin: 0.55, bobAmp: 0.04, bobRate: 1.6,
    tiltAmp: 0.0, tiltRate: 0, pulseAmp: 0.0, pulseRate: 0,
  },
};

function _resolveProfile(opts) {
  if (!opts) return PROFILES.box;
  if (typeof opts === 'string') return PROFILES[opts] || PROFILES.box;
  const base = PROFILES[opts.profile] || PROFILES.box;
  return { ...base, ...opts };
}

/**
 * Register a mesh to be animated each frame.
 * @param {Object3D} mesh
 * @param {string|Object} [opts] profile name ('box'|'coin'|'orb'|'prop')
 *   or an options object overriding profile fields.
 */
export function registerPickupSpin(mesh, opts) {
  if (!mesh) return;
  const p = _resolveProfile(opts);
  const phase = (_phaseSeed += 1.37) % (Math.PI * 2);
  _anim.set(mesh, {
    baseY: mesh.position ? mesh.position.y : 0,
    baseScale: mesh.scale ? mesh.scale.x || 1 : 1,
    spin: p.spin, bobAmp: p.bobAmp, bobRate: p.bobRate,
    tiltAmp: p.tiltAmp, tiltRate: p.tiltRate,
    pulseAmp: p.pulseAmp, pulseRate: p.pulseRate,
    phase,
    // one-shot transition: null | { type:'spawn'|'collect', t, dur, cb }
    tr: { type: 'spawn', t: 0, dur: 0.38, cb: null },
  });
}

/** Remove a mesh from the animation set (also auto-pruned when detached). */
export function unregisterPickupSpin(mesh) {
  _anim.delete(mesh);
}

/**
 * Trigger the pop-in spawn animation for an already-registered mesh
 * (e.g. an item box respawning). No-op if not registered.
 */
export function playPickupSpawn(mesh) {
  const s = _anim.get(mesh);
  if (s) s.tr = { type: 'spawn', t: 0, dur: 0.38, cb: null };
}

/**
 * Trigger the collect dissolve (shrink + rise). Optional callback fires
 * once the animation completes (e.g. to hide/remove the mesh).
 */
export function playPickupCollect(mesh, cb) {
  const s = _anim.get(mesh);
  if (s) { s.tr = { type: 'collect', t: 0, dur: 0.30, cb: cb || null }; }
  else if (cb) cb();
}

// Overshoot ease for a satisfying pop.
function _easeOutBack(x) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Advance all pickup animations. dt in seconds. */
export function tickPickupSpin(dt) {
  if (!_anim.size) return;
  _clock += dt;
  const t = _clock;
  const dead = [];
  for (const [m, s] of _anim) {
    if (!m || !m.parent) { dead.push(m); continue; }

    if (s.spin) m.rotation.y += s.spin * dt;
    if (s.tiltAmp) m.rotation.z = Math.sin(t * s.tiltRate + s.phase) * s.tiltAmp;

    const bob = s.bobAmp ? Math.sin(t * s.bobRate + s.phase) * s.bobAmp : 0;
    let pulse = s.pulseAmp ? 1 + Math.sin(t * s.pulseRate + s.phase) * s.pulseAmp : 1;

    let animScale = 1;
    let riseY = 0;
    if (s.tr) {
      s.tr.t += dt;
      const k = Math.min(1, s.tr.t / s.tr.dur);
      if (s.tr.type === 'spawn') {
        animScale = Math.max(0.001, _easeOutBack(k));
        if (k >= 1) s.tr = null;
      } else if (s.tr.type === 'collect') {
        animScale = Math.max(0.001, 1 - k);
        riseY = k * 0.9;
        m.rotation.y += s.spin * 2.5 * dt;
        pulse = 1;
        if (k >= 1) {
          const cb = s.tr.cb; s.tr = null;
          if (cb) cb();
        }
      }
    }

    if (m.position) m.position.y = s.baseY + bob + riseY;
    if (m.scale) {
      const sc = s.baseScale * pulse * animScale;
      m.scale.set(sc, sc, sc);
    }
  }
  for (const m of dead) _anim.delete(m);
}

/** Clear the registry (used between editor scene rebuilds). */
export function clearPickupSpin() {
  _anim.clear();
}
