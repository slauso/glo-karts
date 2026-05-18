/**
 * projectile-runtime.js — Phase C/D projectile + hazard simulation.
 *
 * A small, self-contained kinematic sim layered on top of the main
 * Three.js scene. The kart physics worker is unaware of these
 * entities — they exist purely on main and apply effects back through
 * the same playerCombat scalar channels (boost/slow/oil) used by the
 * existing combat-runtime pickups.
 *
 * Supported weapon classes (matched to WEAPONS in segments.js):
 *   projectile      — green_shell: straight travel, cell-bounce ricochet
 *   homing_nearest  — red_shell:   steers toward closest forward target
 *   homing_leader   — blue_shell:  flies to "leader" then explodes (blast)
 *   projectile_arc  — bobomb:      gravity arc + fuse + blast radius
 *   drop_behind     — banana:      static hazard at drop position
 *
 * Wall collision is approximated via the host's `drivableCells` set
 * (a Set of "gx,gz" strings). When a projectile crosses out of a
 * drivable cell it reflects on whichever axis it left through. This
 * keeps the runtime free of any THREE.Raycaster hot path, which on
 * dense scenes would tank frame time.
 *
 * Owner grace: a projectile cannot hit its own owner for the first
 * `OWNER_GRACE_MS` after spawn, preventing instant self-impact.
 */

const OWNER_GRACE_MS = 400;
const DEFAULT_LIFETIME_MS = 6000;
const HIT_RADIUS_M = 1.6;      // generic kart-vs-projectile contact radius, authored in metres
const PROJ_PROJ_R_M = 1.2;     // projectile↔projectile cancel radius (m)
const GRAVITY_MPS2 = -22;      // m/s² (cosmetic, not the physics G)
const STEP_CAP_MS = 50;        // clamp dt so background tabs don't teleport
const TRAIL_SEGMENTS = 14;     // ribbon segment count (low-poly, fits low-end GPUs)
const MUZZLE_FLASH_MS = 90;    // muzzle sprite lifetime
const SCORCH_LIFE_MS = 1400;   // ground scorch decal fade
const BOMB_PULSE_LEAD_MS = 600;// pre-detonation pulse duration
// Hard cap on concurrent live entities. Protects low-end GPUs from
// runaway projectile spam (e.g. 8 karts each holding triple-shells
// firing at once would otherwise queue 24+ visuals every second).
// When the cap is exceeded, the OLDEST projectile is force-despawned
// to make room — that produces the same visual outcome as a normal
// expire and keeps the per-frame entity walk bounded.
const MAX_LIVE_PROJECTILES = 32;
const MAX_LIVE_HAZARDS = 24;
const MAX_RING_POOL = 8;       // concurrent impact-flash rings
const MAX_FLASH_POOL = 6;      // muzzle-flash sprite pool
const MAX_SCORCH_POOL = 6;     // scorch decal pool
const MAX_TRAIL_POOL = 16;     // trail ribbon pool

let _nextId = 1;

/**
 * @param {object} deps
 * @param {THREE} deps.THREE             - the THREE module reference
 * @param {THREE.Scene} deps.scene
 * @param {Set<string>} deps.drivableCells
 * @param {number} deps.tile             - cell size in world units
 * @param {number} [deps.worldUnitsPerMeter=1] - renderer scale for authored metre values
 * @param {() => Array<{id:number|string, position:{x:number,y:number,z:number}, isLocal:boolean, invuln:boolean}>} deps.getKartTargets
 * @param {(spec:object, hitPoint:{x:number,y:number,z:number}) => void} deps.applyHitToLocal
 * @param {(name:string, opts?:object) => void} [deps.playSfx]
 * @param {(name:string) => (THREE.Object3D|null)} [deps.instanceModel]
 */
export function createProjectileRuntime(deps) {
  const { THREE, scene, drivableCells, tile, getKartTargets, applyHitToLocal } = deps;
  const playSfx = deps.playSfx || (() => {});
  const instanceModel = deps.instanceModel || (() => null);
  const onCameraShake = deps.onCameraShake || (() => {});
  const worldUnitsPerMeter = Number(deps.worldUnitsPerMeter || 1);
  const toWorld = (metres) => metres * worldUnitsPerMeter;
  const hitRadius = toWorld(HIT_RADIUS_M);
  const projProjRadius = toWorld(PROJ_PROJ_R_M);
  const gravity = toWorld(GRAVITY_MPS2);

  /** @type {Array<object>} */
  const projectiles = [];
  /** @type {Array<object>} */
  const hazards = [];

  // ── Visual pool ──────────────────────────────────────────────
  // Per-model-name free list of holder Groups (already attached to
  // scene, just hidden when free). Avoids re-cloning skinned meshes
  // and re-allocating Group/Mesh/Material per shot, which is the
  // single biggest GC pressure source in sustained combat.
  /** @type {Map<string, THREE.Object3D[]>} */
  const _visualPool = new Map();
  function _poolKey(modelName) { return modelName || '__fallback__'; }
  function _acquireVisual(modelName, fallbackColor) {
    const key = _poolKey(modelName);
    const free = _visualPool.get(key);
    if (free && free.length) {
      const v = free.pop();
      v.visible = true;
      return v;
    }
    return _buildVisual(modelName, fallbackColor);
  }
  function _releaseVisual(modelName, v) {
    if (!v) return;
    v.visible = false;
    const key = _poolKey(modelName);
    let arr = _visualPool.get(key);
    if (!arr) { arr = []; _visualPool.set(key, arr); }
    // Hard cap pool size to avoid leaking memory if the player keeps
    // cycling between many different weapons.
    if (arr.length < 8) arr.push(v);
    else { scene.remove(v); _disposeDeep(v); }
  }
  function _disposeDeep(obj) {
    obj.traverse?.((o) => {
      if (o.geometry && typeof o.geometry.dispose === 'function') o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m && typeof m.dispose === 'function' && m.dispose();
      }
    });
  }

  // ── Impact-ring pool ─────────────────────────────────────────
  /** @type {Array<{mesh: THREE.Mesh, active: boolean, start: number, dur: number, baseR: number}>} */
  const _ringPool = [];
  function _acquireRing() {
    for (const r of _ringPool) if (!r.active) return r;
    if (_ringPool.length >= MAX_RING_POOL) {
      // Reuse oldest active.
      let oldest = _ringPool[0];
      for (const r of _ringPool) if (r.start < oldest.start) oldest = r;
      return oldest;
    }
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 1, 24),
      new THREE.MeshBasicMaterial({ color: 0xffaa33, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    const slot = { mesh, active: false, start: 0, dur: 350, baseR: 1 };
    _ringPool.push(slot);
    return slot;
  }

  // ── Muzzle-flash pool ────────────────────────────────────────
  // Tiny additive billboard. Pooled because cannons / streams fire
  // many shots per second on low-end devices and we cannot afford
  // per-shot allocations.
  const _flashPool = [];
  function _acquireFlash() {
    for (const s of _flashPool) if (!s.active) return s;
    if (_flashPool.length >= MAX_FLASH_POOL) {
      let oldest = _flashPool[0];
      for (const s of _flashPool) if (s.start < oldest.start) oldest = s;
      return oldest;
    }
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(toWorld(1.2), toWorld(1.2)),
      new THREE.MeshBasicMaterial({ color: 0xffe28a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const slot = { mesh, active: false, start: 0 };
    _flashPool.push(slot);
    return slot;
  }
  function _spawnMuzzleFlash(p, color) {
    const slot = _acquireFlash();
    slot.mesh.position.set(p.x, p.y, p.z);
    slot.mesh.material.color.setHex(color || 0xffe28a);
    slot.mesh.material.opacity = 0.9;
    slot.mesh.scale.setScalar(1);
    slot.mesh.visible = true;
    slot.active = true;
    slot.start = performance.now();
  }
  function _tickFlashes(now) {
    const cam = scene.userData?.__camera || null;
    for (const slot of _flashPool) {
      if (!slot.active) continue;
      const t = (now - slot.start) / MUZZLE_FLASH_MS;
      if (t >= 1) { slot.mesh.visible = false; slot.active = false; continue; }
      slot.mesh.material.opacity = 0.9 * (1 - t);
      slot.mesh.scale.setScalar(1 + t * 0.6);
      if (cam && cam.isCamera) slot.mesh.lookAt(cam.position);
    }
  }

  // ── Scorch-decal pool ────────────────────────────────────────
  // Dark ground disc fading over SCORCH_LIFE_MS. Sits 4 cm above y so
  // it z-fights cleanly. Reuses geometry/material per pool slot.
  const _scorchPool = [];
  function _acquireScorch() {
    for (const s of _scorchPool) if (!s.active) return s;
    if (_scorchPool.length >= MAX_SCORCH_POOL) {
      let oldest = _scorchPool[0];
      for (const s of _scorchPool) if (s.start < oldest.start) oldest = s;
      return oldest;
    }
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 18),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    const slot = { mesh, active: false, start: 0, baseR: 1 };
    _scorchPool.push(slot);
    return slot;
  }
  function _spawnScorch(p, radius) {
    const slot = _acquireScorch();
    const r = Math.max(toWorld(0.8), (radius || toWorld(1.5)) * 0.7);
    slot.mesh.position.set(p.x, (p.y || 0) + toWorld(0.04), p.z);
    slot.mesh.scale.setScalar(r);
    slot.mesh.material.opacity = 0.55;
    slot.mesh.visible = true;
    slot.active = true;
    slot.start = performance.now();
    slot.baseR = r;
  }
  function _tickScorches(now) {
    for (const slot of _scorchPool) {
      if (!slot.active) continue;
      const t = (now - slot.start) / SCORCH_LIFE_MS;
      if (t >= 1) { slot.mesh.visible = false; slot.active = false; continue; }
      slot.mesh.material.opacity = 0.55 * (1 - t);
    }
  }

  // ── Trail-ribbon pool ────────────────────────────────────────
  // One Line per active projectile, TRAIL_SEGMENTS verts. Geometry +
  // position attribute pre-allocated per slot; per-frame work is just
  // memcpy + needsUpdate. Cheaper than per-projectile allocations and
  // avoids GC churn during sustained combat.
  const _trailPool = [];
  function _acquireTrail(color) {
    let slot = null;
    for (const t of _trailPool) if (!t.active) { slot = t; break; }
    if (!slot) {
      if (_trailPool.length >= MAX_TRAIL_POOL) {
        let oldest = _trailPool[0];
        for (const t of _trailPool) if (t.bornAt < oldest.bornAt) oldest = t;
        slot = oldest;
      } else {
        const positions = new Float32Array(TRAIL_SEGMENTS * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({ color: color || 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.visible = false;
        scene.add(line);
        slot = { line, positions, count: 0, active: false, bornAt: 0 };
        _trailPool.push(slot);
      }
    }
    slot.line.material.color.setHex(color || 0xffffff);
    slot.line.material.opacity = 0.7;
    slot.line.visible = true;
    slot.count = 0;
    slot.active = true;
    slot.bornAt = performance.now();
    return slot;
  }
  function _releaseTrail(slot) {
    if (!slot) return;
    slot.line.visible = false;
    slot.active = false;
    slot.count = 0;
    slot.line.geometry.setDrawRange(0, 0);
  }
  function _pushTrailPoint(slot, x, y, z) {
    if (!slot || !slot.active) return;
    if (slot.count < TRAIL_SEGMENTS) {
      const i = slot.count * 3;
      slot.positions[i] = x; slot.positions[i + 1] = y; slot.positions[i + 2] = z;
      slot.count += 1;
    } else {
      slot.positions.copyWithin(0, 3, TRAIL_SEGMENTS * 3);
      const i = (TRAIL_SEGMENTS - 1) * 3;
      slot.positions[i] = x; slot.positions[i + 1] = y; slot.positions[i + 2] = z;
    }
    slot.line.geometry.setDrawRange(0, slot.count);
    slot.line.geometry.attributes.position.needsUpdate = true;
  }

  const _v = new THREE.Vector3();
  const _v2 = new THREE.Vector3();

  function _cellOf(x, z) {
    return `${Math.round(x / tile)},${Math.round(z / tile)}`;
  }
  function _isDrivable(x, z) {
    if (!drivableCells || drivableCells.size === 0) return true;  // no track data → no walls
    return drivableCells.has(_cellOf(x, z));
  }

  /** Build the visual mesh for a projectile, falling back to a tinted
   *  sphere if the model registry hasn't loaded the DAE yet.
   *
   *  IMPORTANT: instanceModel() returns a SkeletonUtils-style clone of a
   *  cached template. The pickup-spin and editor-pickup-palette systems
   *  also hold references to clones from the same template; mutating
   *  scale on the returned object directly is risky if any caller
   *  shares state. We always wrap in a fresh holder Group and only
   *  scale the holder, leaving the inner clone untouched. */
  function _buildVisual(modelName, fallbackColor) {
    const holder = new THREE.Group();
    holder.name = `proj:${modelName || 'fallback'}`;
    const inner = instanceModel(modelName);
    if (inner) {
      // DAE templates are authored in metres; lift to world units once,
      // on the holder, never on the cached/clone object itself.
      holder.scale.setScalar(worldUnitsPerMeter);
      holder.add(inner);
    } else {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(toWorld(0.4), 16, 12),
        new THREE.MeshStandardMaterial({
          color: fallbackColor,
          emissive: fallbackColor,
          emissiveIntensity: 0.45,
          roughness: 0.4,
        }),
      );
      mesh.castShadow = true;
      holder.add(mesh);
    }
    scene.add(holder);
    return holder;
  }

  /**
   * @param {object} args
   * @param {object} args.weapon - WEAPONS[name] entry (must have .class)
   * @param {string} args.name   - weapon key (e.g. 'green_shell')
   * @param {{x:number,y:number,z:number}} args.origin
   * @param {{x:number,y:number,z:number}} args.forward - unit vector
   * @param {number|string} args.ownerId
   * @returns {object|null} the spawned entity (debug)
   */
  function spawnProjectile({ weapon, name, origin, forward, ownerId }) {
    if (!weapon) return null;
    // Soft cap: drop oldest live projectile to keep entity count bounded.
    if (projectiles.length >= MAX_LIVE_PROJECTILES) {
      // Find oldest non-dead and despawn.
      let oldestIdx = -1, oldestT = Infinity;
      for (let i = 0; i < projectiles.length; i++) {
        const p = projectiles[i];
        if (p._dead) continue;
        if (p.bornAt < oldestT) { oldestT = p.bornAt; oldestIdx = i; }
      }
      if (oldestIdx >= 0) _despawn(projectiles[oldestIdx]);
    }
    const now = performance.now();
    const speed = toWorld(weapon.speed || 50);
    const visual = _acquireVisual(name, weapon.color != null ? weapon.color : _projectileColor(name));
    visual.position.set(origin.x, origin.y + toWorld(0.6), origin.z);
    // Orient so model "forward" (+Z) matches travel direction.
    const yaw = Math.atan2(forward.x, forward.z);
    visual.rotation.y = yaw;
    const ent = {
      id: _nextId++,
      kind: 'projectile',
      name,
      class: weapon.class,
      visual,
      px: origin.x, py: origin.y + toWorld(0.6), pz: origin.z,
      vx: forward.x * speed,
      vy: 0,
      vz: forward.z * speed,
      speed,
      ownerId,
      bornAt: now,
      expiresAt: now + (weapon.lifetimeMs || DEFAULT_LIFETIME_MS),
      ricochetsLeft: weapon.ricochets || 0,
      bouncesLeft: weapon.bounces || 0,
      bounceRetention: weapon.bounceRetention || 0,
      dmg: weapon.dmg || 30,
      blastRadius: weapon.blastRadius ? toWorld(weapon.blastRadius) : 0,
      effect: weapon.effect || 'spinout',
      // homing
      lockRange: toWorld(weapon.lockRange || 60),
      homingDelayMs: weapon.homingDelayMs || 0,
      turnRateRad: THREE.MathUtils.degToRad(weapon.turnRateDeg || 85),
      targetSpeed: toWorld(weapon.speedRampTo || weapon.speed || 50),
      // arc
      useGravity: weapon.class === 'projectile_arc',
      fuseAt: weapon.fuseMs ? (now + weapon.fuseMs) : 0,
      // visual spin
      spinAxis: (name === 'green_shell' || name === 'red_shell' || name === 'blue_shell')
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0.3, 0).normalize(),
      spinRate: 6,
    };
    if (ent.useGravity) {
      // Initial upward kick so the arc reads as a lob.
      ent.vy = toWorld(8);
    }
    // Trail ribbon — only for projectile classes that visually benefit.
    // Hazards (banana, mine) skip this. Color matches weapon tint.
    const trailColor = (weapon.color != null) ? weapon.color : _projectileColor(name);
    ent.trail = _acquireTrail(trailColor);
    _pushTrailPoint(ent.trail, ent.px, ent.py, ent.pz);
    // Muzzle flash at fire origin (one-shot). Ground-clamp slightly so
    // it doesn't z-fight the kart bumper.
    _spawnMuzzleFlash({ x: origin.x, y: origin.y + toWorld(0.7), z: origin.z }, trailColor);
    projectiles.push(ent);
    return ent;
  }

  /** Banana / oil drop. */
  function spawnHazard({ weapon, name, origin, ownerId }) {
    if (!weapon) return null;
    if (hazards.length >= MAX_LIVE_HAZARDS) {
      let oldestIdx = -1, oldestT = Infinity;
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (h._dead) continue;
        if (h.bornAt < oldestT) { oldestT = h.bornAt; oldestIdx = i; }
      }
      if (oldestIdx >= 0) _despawn(hazards[oldestIdx]);
    }
    const now = performance.now();
    const visual = _acquireVisual(name, weapon.color != null ? weapon.color : 0xffe066);
    visual.position.set(origin.x, origin.y + toWorld(0.25), origin.z);
    const ent = {
      id: _nextId++,
      kind: 'hazard',
      name,
      class: weapon.class,
      visual,
      px: origin.x, py: origin.y + toWorld(0.25), pz: origin.z,
      ownerId,
      bornAt: now,
      expiresAt: now + (weapon.lifetimeMs || 30000),
      effect: weapon.effect || 'spinout',
      durationMs: weapon.durationMs || 1200,
    };
    hazards.push(ent);
    return ent;
  }

  function _explode(ent, hitPoint, now) {
    playSfx('explosion', { gain: 0.85 });
    if (ent.blastRadius > 0) {
      const targets = getKartTargets() || [];
      for (const t of targets) {
        if (t.invuln) continue;
        if (now - ent.bornAt < OWNER_GRACE_MS && t.id === ent.ownerId) continue;
        const dx = t.position.x - hitPoint.x, dz = t.position.z - hitPoint.z;
        if ((dx * dx + dz * dz) <= (ent.blastRadius * ent.blastRadius)) {
          if (t.isLocal) {
            applyHitToLocal({ name: ent.name, effect: ent.effect, dmg: ent.dmg, durationMs: ent.durationMs || 1500 }, hitPoint);
          }
          // Peers eat the blast visually only — their authoritative
          // client applies the actual slow.
        }
      }
      // Bigger blasts: scorch decal + camera shake whose magnitude
      // scales with radius. Cheap helpers — both pooled.
      _spawnScorch(hitPoint, ent.blastRadius);
      const shakeMag = Math.min(0.8, (ent.blastRadius / Math.max(1, worldUnitsPerMeter)) * 0.06);
      onCameraShake(shakeMag, 220);
    } else {
      onCameraShake(0.05, 90);
    }
    _flashRing(hitPoint, ent.blastRadius || 1.5);
    _despawn(ent);
  }

  function _flashRing(p, radius) {
    // Pooled expanding-ring impact cue. Reuses up to MAX_RING_POOL
    // ring meshes — no per-explosion allocation, no per-frame rAF.
    // The ring's animation is driven from the main tick() so it
    // shares the host's frame budget instead of stacking parallel
    // requestAnimationFrame chains.
    const r = Math.max(toWorld(0.6), radius || toWorld(1.5));
    const slot = _acquireRing();
    slot.mesh.position.set(p.x, (p.y || 0) + toWorld(0.05), p.z);
    slot.mesh.scale.setScalar(r);
    slot.mesh.material.opacity = 0.85;
    slot.mesh.visible = true;
    slot.active = true;
    slot.start = performance.now();
    slot.dur = 350;
    slot.baseR = r;
  }

  function _tickRings(now) {
    for (const slot of _ringPool) {
      if (!slot.active) continue;
      const t = (now - slot.start) / slot.dur;
      if (t >= 1) {
        slot.mesh.visible = false;
        slot.active = false;
        continue;
      }
      const s = slot.baseR * (1 + t * 1.4);
      slot.mesh.scale.setScalar(s);
      slot.mesh.material.opacity = 0.85 * (1 - t);
    }
  }

  function _despawn(ent) {
    if (ent.visual) {
      // Return to pool instead of removing from scene — saves the
      // skinned-mesh clone and material allocations next time the
      // same weapon fires.
      _releaseVisual(ent.name, ent.visual);
    }
    if (ent.trail) { _releaseTrail(ent.trail); ent.trail = null; }
    ent._dead = true;
  }

  function _projectileColor(name) {
    switch (name) {
      case 'green_shell': return 0x55ff66;
      case 'red_shell':   return 0xff5555;
      case 'blue_shell':  return 0x3a7bff;
      case 'bobomb':      return 0x222831;
      case 'banana':      return 0xffe066;
      // V8 / Vigilante donor catalog (procedural fallback colors).
      // Used only when MP_WEAPON_TO_SP doesn't redirect to a polished
      // DAE mesh; matches the pickup pad halo color so the projectile
      // visually reads as "from that pickup".
      case 'v8_missile':     return 0xc25a14;
      case 'v8_cannon':      return 0x8a8f99;
      case 'v8_rocket':      return 0xff7a00;
      case 'v8_mortar':      return 0x4a4a55;
      case 'v8_mine':        return 0x55202a;
      case 'v8_dynamite':    return 0xb04020;
      case 'v8_firethrower': return 0xff4400;
      default:            return 0xffffff;
    }
  }

  function _findHomingTarget(ent, mode /* 'nearest'|'leader' */) {
    const targets = getKartTargets() || [];
    let best = null, bestScore = Infinity;
    for (const t of targets) {
      if (now - ent.bornAt < OWNER_GRACE_MS && t.id === ent.ownerId) continue;
      const dx = t.position.x - ent.px, dz = t.position.z - ent.pz;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > ent.lockRange * ent.lockRange) continue;
      // 'leader' is approximated as the target furthest from origin —
      // SP has only the local kart so this typically resolves to the
      // local kart and the shell loops back. That's the canonical
      // Mario Kart blue-shell behaviour anyway.
      const score = (mode === 'leader') ? -dist2 : dist2;
      if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
  }

  let now = 0;  // captured per tick for use inside helpers

  function tick(dt, tNow) {
    now = tNow;
    if (dt > STEP_CAP_MS / 1000) dt = STEP_CAP_MS / 1000;
    const targets = getKartTargets() || [];

    // ── projectiles ───────────────────────────────────────────
    for (const ent of projectiles) {
      if (ent._dead) continue;
      if (now >= ent.expiresAt) { _despawn(ent); continue; }

      // homing steer
      if ((ent.class === 'homing_nearest' || ent.class === 'homing_leader')
          && now - ent.bornAt >= ent.homingDelayMs) {
        const target = _findHomingTarget(ent, ent.class === 'homing_leader' ? 'leader' : 'nearest');
        if (target) {
          const dx = target.position.x - ent.px;
          const dz = target.position.z - ent.pz;
          const len = Math.hypot(dx, dz) || 1;
          if (ent.targetSpeed > ent.speed) {
            ent.speed = Math.min(ent.targetSpeed, ent.speed + toWorld(18) * dt);
          }
          const currentYaw = Math.atan2(ent.vx, ent.vz);
          const desiredYaw = Math.atan2(dx / len, dz / len);
          const deltaYaw = Math.atan2(Math.sin(desiredYaw - currentYaw), Math.cos(desiredYaw - currentYaw));
          const maxYaw = ent.turnRateRad * dt;
          const nextYaw = currentYaw + Math.max(-maxYaw, Math.min(maxYaw, deltaYaw));
          ent.vx = Math.sin(nextYaw) * ent.speed;
          ent.vz = Math.cos(nextYaw) * ent.speed;
        }
      }

      // gravity arc
      if (ent.useGravity) ent.vy += gravity * dt;

      // integrate
      const nx = ent.px + ent.vx * dt;
      const ny = ent.py + ent.vy * dt;
      const nz = ent.pz + ent.vz * dt;

      // wall ricochet via cell containment
      if (ent.class === 'projectile' && ent.ricochetsLeft > 0) {
        const wasInside = _isDrivable(ent.px, ent.pz);
        const nowInside = _isDrivable(nx, nz);
        if (wasInside && !nowInside) {
          // Determine which axis we crossed: probe the two single-axis
          // moves and reflect whichever one falls outside.
          const sideX = _isDrivable(nx, ent.pz);
          const sideZ = _isDrivable(ent.px, nz);
          if (!sideX && sideZ)      ent.vx = -ent.vx;
          else if (!sideZ && sideX) ent.vz = -ent.vz;
          else { ent.vx = -ent.vx; ent.vz = -ent.vz; }
          ent.vx *= 0.92; ent.vz *= 0.92;
          ent.ricochetsLeft -= 1;
          playSfx('boing', { gain: 0.55 });
          continue;  // skip the integration step that put us out of bounds
        }
      }

      ent.px = nx; ent.py = ny; ent.pz = nz;

      // ground clamp for arc
      if (ent.useGravity && ent.py <= toWorld(0.4)) {
        if (ent.bouncesLeft > 0 && ent.bounceRetention > 0) {
          ent.py = toWorld(0.4);
          ent.vy = Math.abs(ent.vy) * ent.bounceRetention;
          ent.vx *= ent.bounceRetention;
          ent.vz *= ent.bounceRetention;
          ent.bouncesLeft -= 1;
          playSfx('boing', { gain: 0.45, rate: 0.75 });
          continue;
        }
        // Detonate on impact.
        _explode(ent, { x: ent.px, y: toWorld(0.4), z: ent.pz }, now);
        continue;
      }
      // fuse
      if (ent.fuseAt && now >= ent.fuseAt) {
        _explode(ent, { x: ent.px, y: ent.py, z: ent.pz }, now);
        continue;
      }

      // visual sync
      ent.visual.position.set(ent.px, ent.py, ent.pz);
      ent.visual.rotateOnAxis(ent.spinAxis, ent.spinRate * dt);
      // Append a trail vertex this frame (sub-sampled — no point in
      // pushing more than ~30 points/s; we just throttle by frame).
      _pushTrailPoint(ent.trail, ent.px, ent.py, ent.pz);

      // Bomb pulse: lift emissiveIntensity in the last BOMB_PULSE_LEAD_MS
      // before fuse expiry. Read-mostly: only mutate when actually in
      // the lead-up window so we don't pay material walks every frame.
      if (ent.fuseAt) {
        const leadIn = ent.fuseAt - BOMB_PULSE_LEAD_MS;
        if (now > leadIn) {
          const u = Math.min(1, (now - leadIn) / BOMB_PULSE_LEAD_MS);
          // 6 Hz pulse synced to wall clock so peers see same beat.
          const beat = 0.5 + 0.5 * Math.sin((now - leadIn) * 0.012);
          ent.visual.traverse((o) => {
            if (o.isMesh && o.material && 'emissiveIntensity' in o.material) {
              o.material.emissiveIntensity = 0.3 + 1.4 * u * beat;
            }
          });
        }
      }

      // ── P1.5 projectile↔projectile interception ─────────────
      // Two non-arc projectiles within projProjRadius cancel each
      // other (Mario-Kart-style shell-vs-shell deflection). Skip arcs
      // and hazards — those have their own dynamics. We scan in O(n)
      // forward-only so each pair is tested once.
      let cancelled = false;
      if (ent.class === 'projectile' || ent.class === 'homing_nearest' || ent.class === 'homing_leader') {
        for (let j = 0; j < projectiles.length; j++) {
          const other = projectiles[j];
          if (other === ent || other._dead) continue;
          if (other.class === 'projectile_arc') continue;
          if (other.id <= ent.id) continue; // forward-only
          const ddx = other.px - ent.px, ddz = other.pz - ent.pz;
          if ((ddx * ddx + ddz * ddz) <= (projProjRadius * projProjRadius)) {
            const mid = { x: (ent.px + other.px) * 0.5, y: (ent.py + other.py) * 0.5, z: (ent.pz + other.pz) * 0.5 };
            _flashRing(mid, toWorld(1.0));
            playSfx('metal_clang', { gain: 0.7 });
            _despawn(other);
            _despawn(ent);
            cancelled = true;
            break;
          }
        }
      }
      if (cancelled) continue;

      // contact tests vs targets
      let consumed = false;
      for (const t of targets) {
        if (t.invuln) continue;
        if (now - ent.bornAt < OWNER_GRACE_MS && t.id === ent.ownerId) continue;
        const dx = t.position.x - ent.px, dz = t.position.z - ent.pz;
        if ((dx * dx + dz * dz) <= (hitRadius * hitRadius)) {
          if (ent.blastRadius > 0) {
            _explode(ent, { x: ent.px, y: ent.py, z: ent.pz }, now);
          } else if (t.isLocal) {
            applyHitToLocal({ name: ent.name, effect: ent.effect, dmg: ent.dmg, durationMs: ent.durationMs || 1500 }, t.position);
            playSfx('strike', { gain: 0.7 });
            _despawn(ent);
          } else {
            // Phase E2 — peer hit. We don't simulate the peer's reaction
            // here (the authoritative server / their own client owns
            // that). We just provide local visual + audio feedback so
            // the shooter sees confirmation, then the projectile is
            // consumed.
            _flashRing({ x: ent.px, y: ent.py, z: ent.pz }, 1.2);
            playSfx('strike', { gain: 0.7 });
            _despawn(ent);
          }
          consumed = true;
          break;
        }
      }
      if (consumed) continue;
    }

    // ── static hazards ────────────────────────────────────────
    for (const ent of hazards) {
      if (ent._dead) continue;
      if (now >= ent.expiresAt) { _despawn(ent); continue; }
      // Slow visual bob so the drop reads as live.
      const bob = Math.sin((now - ent.bornAt) * 0.004) * toWorld(0.05);
      ent.visual.position.y = ent.py + bob;
      ent.visual.rotation.y = (now - ent.bornAt) * 0.003;
      for (const t of targets) {
        if (t.invuln) continue;
        if (now - ent.bornAt < OWNER_GRACE_MS && t.id === ent.ownerId) continue;
        const dx = t.position.x - ent.px, dz = t.position.z - ent.pz;
        if ((dx * dx + dz * dz) <= (hitRadius * hitRadius)) {
          if (t.isLocal) {
            applyHitToLocal({ name: ent.name, effect: ent.effect, dmg: 10, durationMs: ent.durationMs || 1200 }, t.position);
          }
          playSfx('boing', { gain: 0.5 });
          _despawn(ent);
          break;
        }
      }
    }

    // Drive pooled impact rings from the same tick so we don't stack
    // parallel rAF chains.
    _tickRings(now);
    _tickFlashes(now);
    _tickScorches(now);

    // GC dead entries occasionally so the arrays don't grow unbounded.
    if ((projectiles.length + hazards.length) > 32) {
      _gc();
    }
  }

  function _gc() {
    let w = 0;
    for (let i = 0; i < projectiles.length; i++) if (!projectiles[i]._dead) projectiles[w++] = projectiles[i];
    projectiles.length = w;
    w = 0;
    for (let i = 0; i < hazards.length; i++) if (!hazards[i]._dead) hazards[w++] = hazards[i];
    hazards.length = w;
  }

  function clear() {
    for (const e of projectiles) _despawn(e);
    for (const e of hazards) _despawn(e);
    _gc();
  }

  return {
    spawnProjectile,
    spawnHazard,
    tick,
    clear,
    _projectiles: projectiles,
    _hazards: hazards,
  };
}
