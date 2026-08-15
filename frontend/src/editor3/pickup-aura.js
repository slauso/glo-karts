/**
 * pickup-aura.js — idle VFX registry for world-placed item pickups:
 * a soft glow ring + orbiting spark motes + (on strong devices) a
 * breathing outer aura sphere, so pickups read clearly at distance
 * without relying on the base spin/bob motion alone.
 *
 * Mirrors the registry+tick architecture of `pickup-spin.js` (mesh ->
 * state Map, `tick*` called once per frame) but needs a THREE reference
 * since it builds real geometry/materials, unlike the transform-only
 * spin module.
 *
 * Tier-aware (see `playtest-perf.js`): ULTRA skips idle VFX entirely,
 * LOW gets a ring only, MED adds orbiting sparks, HIGH adds the full
 * breathing aura — so a track full of item boxes stays cheap on weak
 * devices while looking spectacular on strong ones.
 */

import { getPickupVisual } from './pickup-visuals.js';
import { resolvePlaytestBudget, PLAYTEST_TIER } from './playtest-perf.js';

// host (Object3D) -> aura state
const _auras = new Map();

let _clock = 0;
let _phaseSeed = 0;

let _cachedTier = null;
function _autoTier() {
  if (_cachedTier == null) {
    try { _cachedTier = resolvePlaytestBudget().tier; } catch (_) { _cachedTier = PLAYTEST_TIER.HIGH; }
  }
  return _cachedTier;
}

/**
 * Attach idle aura VFX to a pickup host mesh/group. No-op if the host
 * is already registered, or if the resolved device tier is ULTRA.
 * @param {typeof import('three')} THREERef
 * @param {Object3D} host - mesh/group the aura attaches to as children
 * @param {string} name - pickup name (drives aura color via pickup-visuals)
 * @param {object} [opts]
 * @param {number} [opts.tier] - override the auto-detected device tier
 * @param {number} [opts.radius] - orbit/ring radius (defaults to 0.6)
 */
export function registerPickupAura(THREERef, host, name, opts = {}) {
  if (!host || _auras.has(host)) return;
  const tier = opts.tier != null ? opts.tier : _autoTier();
  if (tier <= PLAYTEST_TIER.ULTRA) return;

  const v = getPickupVisual(name);
  const color = new THREERef.Color(v.accent);
  const radius = opts.radius || 0.6;

  const rig = new THREERef.Group();
  rig.renderOrder = 3;
  host.add(rig);

  // Glow ring — present from LOW tier up.
  const ring = new THREERef.Mesh(
    new THREERef.RingGeometry(radius * 0.86, radius, tier >= PLAYTEST_TIER.HIGH ? 32 : 18),
    new THREERef.MeshBasicMaterial({
      color, transparent: true, opacity: 0.4, side: THREERef.DoubleSide,
      depthWrite: false, blending: THREERef.AdditiveBlending,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  rig.add(ring);

  // Orbiting spark motes — MED tier and up.
  const sparks = [];
  if (tier >= PLAYTEST_TIER.MED) {
    const sparkMat = new THREERef.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREERef.AdditiveBlending,
    });
    const count = tier >= PLAYTEST_TIER.HIGH ? 4 : 2;
    for (let i = 0; i < count; i++) {
      const spark = new THREERef.Mesh(new THREERef.SphereGeometry(0.045, 6, 5), sparkMat);
      rig.add(spark);
      sparks.push({ mesh: spark, offset: (i / count) * Math.PI * 2 });
    }
  }

  // Breathing outer aura — HIGH tier only (strongest readability boost,
  // priciest thanks to transparent overdraw).
  let pulse = null;
  if (tier >= PLAYTEST_TIER.HIGH) {
    pulse = new THREERef.Mesh(
      new THREERef.SphereGeometry(radius * 0.82, 12, 10),
      new THREERef.MeshBasicMaterial({
        color, transparent: true, opacity: 0.12, depthWrite: false, blending: THREERef.AdditiveBlending,
      }),
    );
    rig.add(pulse);
  }

  const phase = (_phaseSeed += 1.7) % (Math.PI * 2);
  _auras.set(host, { rig, ring, sparks, pulse, phase, radius });
}

/** Remove a host from the aura registry (also auto-pruned when detached). */
export function unregisterPickupAura(host) {
  _auras.delete(host);
}

/** Advance all registered pickup auras. dt in seconds. */
export function tickPickupAura(dt) {
  if (!_auras.size) return;
  _clock += dt;
  const t = _clock;
  const dead = [];
  for (const [host, s] of _auras) {
    if (!host || !host.parent) { dead.push(host); continue; }

    s.ring.rotation.z += dt * 0.6;
    s.ring.material.opacity = 0.28 + Math.sin(t * 1.6 + s.phase) * 0.12;

    for (let i = 0; i < s.sparks.length; i++) {
      const sp = s.sparks[i];
      const a = t * 1.4 + sp.offset + s.phase;
      sp.mesh.position.set(
        Math.cos(a) * s.radius,
        Math.sin(a * 1.7) * 0.12,
        Math.sin(a) * s.radius,
      );
    }

    if (s.pulse) {
      const k = 1 + Math.sin(t * 1.2 + s.phase) * 0.18;
      s.pulse.scale.setScalar(k);
      s.pulse.material.opacity = 0.10 + Math.sin(t * 1.2 + s.phase) * 0.05;
    }
  }
  for (const host of dead) _auras.delete(host);
}

/** Clear the registry (used between editor scene rebuilds). */
export function clearPickupAura() {
  _auras.clear();
}
