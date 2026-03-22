/**
 * kart-entity.js — Self-contained kart entity that owns its mesh hierarchy,
 * cloned materials, wheel references, and VFX attachment points.
 *
 * Key design decisions (ported from Mario-Kart-3.js best practices):
 *  1. Material isolation — every material on the loaded GLB is cloned so
 *     per-kart effects (flash, emissive tint, damage colour) never bleed
 *     between instances that share the same source model.
 *  2. Original-material snapshot — we store the pristine material state on
 *     load so `resetMaterials()` can always restore the kart to factory.
 *  3. Named attachment points — TransformNodes parented to the root mesh
 *     give VFX systems stable anchor points that follow the kart.
 *  4. Wheel references — auto-detected from the GLB hierarchy so the render
 *     loop can spin them and (in future) do per-wheel raycasting.
 *  5. Clean lifecycle — `dispose()` removes *everything* this entity owns.
 */

import {
  Vector3,
  Quaternion,
  Color3,
  Color4,
  TransformNode,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
  SceneLoader,
  StandardMaterial,
  Texture,
  DynamicTexture,
} from '@babylonjs/core';
import { resolveKartAsset } from '../content-registry.js';
import { FILTER, applyFilterToAggregate } from './collision-layers.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_EXTENTS = new Vector3(1.8, 0.5, 3.2);
const DEFAULT_MASS    = 800;

// Wheel offset definitions for per-wheel raycasting (local space)
const WHEEL_OFFSETS = {
  frontLeft:  new Vector3(-0.7, 0, 0.7),
  frontRight: new Vector3( 0.7, 0, 0.7),
  rearLeft:   new Vector3(-0.77, 0, -0.7),
  rearRight:  new Vector3( 0.77, 0, -0.7),
};

// VFX attachment point definitions (local space offsets from root)
const ATTACH_POINTS = {
  exhaustLeft:  new Vector3(-0.5, 0.3, -1.5),
  exhaustRight: new Vector3( 0.5, 0.3, -1.5),
  damageCenter: new Vector3( 0, 0.8, 0),
  damageTop:    new Vector3( 0, 1.6, 0),
  shieldCenter: new Vector3( 0, 0.5, 0),
  boostRear:    new Vector3( 0, 0.3, -1.8),
  stunAbove:    new Vector3( 0, 2.0, 0),
};

// ═══════════════════════════════════════════════════════════════════════════
//  KartEntity
// ═══════════════════════════════════════════════════════════════════════════

export class KartEntity {
  /**
   * @param {import('@babylonjs/core').Scene} scene
   * @param {object} opts
   * @param {string}  opts.id          Unique entity id (session id or 'local')
   * @param {string}  [opts.kartId]    Kart model id from content registry
   * @param {string}  [opts.color]     Player colour for model variant selection
   * @param {number}  [opts.scale]     Arena-wide scale override
   * @param {boolean} [opts.isLocal]   True for the local player's kart
   */
  constructor(scene, opts = {}) {
    this.scene   = scene;
    this.id      = opts.id || 'unknown';
    this.kartId  = opts.kartId || 'default';
    this.color   = opts.color || 'red';
    this.isLocal = !!opts.isLocal;

    /** @type {import('@babylonjs/core').AbstractMesh | null} */
    this.rootMesh = null;

    /** All child meshes (flat list) */
    this.childMeshes = [];

    /** Wheel mesh references (auto-detected from GLB names) */
    this.wheelMeshes = [];

    /** Named attachment TransformNodes keyed by ATTACH_POINTS keys */
    this.attachPoints = {};

    /** Physics aggregate (only for local kart or remote ANIMATED bodies) */
    this.aggregate = null;

    /** Snapshot of every material's original state for reliable reset */
    this._originalMaterials = new Map(); // mesh → { emissive, diffuse, alpha, ... }

    /** All cloned materials owned by this entity (for disposal) */
    this._ownedMaterials = [];

    /** Current extents after scaling */
    this.extents = DEFAULT_EXTENTS.clone();

    /** Scale factor applied */
    this.scaleFactor = opts.scale || null;

    /** True once `load()` resolves */
    this.loaded = false;

    /** True once `dispose()` is called */
    this.disposed = false;

    /** Active material override timers (setTimeout ids) for cleanup */
    this._overrideTimers = new Set();

    // Classified wheel references (populated in load → _classifyWheels)
    this._wheels = { fl: null, fr: null, rl: null, rr: null };
    this._wheelBaseY = new Map();  // mesh → original local Y position
    this._wheelBaseX = new Map();  // mesh → original local X position
    this._wheelBaseZ = new Map();  // mesh → original local Z position
    this._tireMaterial = null;     // shared uniform black-tread material
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Loading
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load the kart model, clone all materials, detect wheels, create
   * attachment points. Returns `this` for chaining.
   */
  async load() {
    const kartInfo = resolveKartAsset(this.kartId);
    let pathStr = kartInfo.modelPath;
    if (kartInfo.id === 'default' && this.color) {
      pathStr = `/models/car_${this.color}.glb`;
    }

    const pathParts = pathStr.split('/');
    const filename  = pathParts.pop();
    const dir       = pathParts.join('/') + '/';

    const result = await SceneLoader.ImportMeshAsync('', dir, filename, this.scene);

    this.rootMesh = result.meshes[0];
    this.rootMesh.name = `kart-${this.id}`;
    this.childMeshes = this.rootMesh.getChildMeshes(false);

    // ── Material isolation ──────────────────────────────────────────────
    this._cloneAndStoreMaterials();

    // ── Scaling ─────────────────────────────────────────────────────────
    const effectiveScale = this.scaleFactor
      || (kartInfo.scale && kartInfo.scale !== 1 ? kartInfo.scale : null);
    if (effectiveScale) {
      this.rootMesh.scaling.setAll(effectiveScale);
      this.rootMesh.computeWorldMatrix(true);
      this.extents = DEFAULT_EXTENTS.scale(effectiveScale);
      this.scaleFactor = effectiveScale;
    }

    // ── Wheel detection ─────────────────────────────────────────────────
    this.wheelMeshes = result.meshes.filter(
      m => m.name && /wheel/i.test(m.name) && m.getTotalVertices?.() > 0
    );

    // ── Classify wheels by position (FL/FR/RL/RR) ───────────────────────
    this._classifyWheels();

    // ── Apply uniform black tire tread texture ──────────────────────────
    this._applyTireTexture();

    // ── Store wheel base Y for suspension offsets ───────────────────────
    for (const wm of this.wheelMeshes) {
      this._wheelBaseY.set(wm, wm.position.y);
      this._wheelBaseX.set(wm, wm.position.x);
      this._wheelBaseZ.set(wm, wm.position.z);
    }

    // ── Attachment points ───────────────────────────────────────────────
    this._createAttachPoints();

    this.loaded = true;
    return this;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Material management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Clone every material in the hierarchy so this entity never shares
   * materials with other instances of the same GLB.  Store the original
   * (cloned) state for later reset.
   */
  /**
   * Classify wheel meshes as FL/FR/RL/RR based on their local-space
   * position relative to the kart centre.
   * Falls back to name-based detection ('front'/'rear' + left/right sign).
   */
  _classifyWheels() {
    if (this.wheelMeshes.length === 0) return;

    // ── Strategy 1: Name-based (STK GLBs use reliable names) ────────
    // STK pipeline names: wheel-front-left, wheel-front-right,
    // wheel-rear-left, wheel-rear-right (also with _0 suffixes from b3d)
    const byName = { fl: null, fr: null, rl: null, rr: null };
    for (const m of this.wheelMeshes) {
      const n = (m.name || '').toLowerCase();
      if      (n.includes('front') && n.includes('left'))  byName.fl = m;
      else if (n.includes('front') && n.includes('right')) byName.fr = m;
      else if ((n.includes('rear') || n.includes('back')) && n.includes('left'))  byName.rl = m;
      else if ((n.includes('rear') || n.includes('back')) && n.includes('right')) byName.rr = m;
    }
    if (byName.fl && byName.fr && byName.rl && byName.rr) {
      this._wheels = byName;
      return;
    }

    // ── Strategy 2: Position-based fallback (generic GLBs) ──────────
    const sorted = this.wheelMeshes.map(m => {
      const pos = m.position || Vector3.Zero();
      return { mesh: m, x: pos.x, z: pos.z };
    });
    // Partition into front/rear by Z (positive Z = front in Babylon)
    const avgZ = sorted.reduce((s, w) => s + w.z, 0) / sorted.length;
    const front = sorted.filter(w => w.z >= avgZ);
    const rear  = sorted.filter(w => w.z <  avgZ);
    // Pick left/right by X sign (negative X = left in Babylon)
    const pick = (arr, side) => {
      if (arr.length === 0) return null;
      if (arr.length === 1) return arr[0].mesh;
      return arr.sort((a, b) => side === 'left' ? a.x - b.x : b.x - a.x)[0].mesh;
    };
    this._wheels.fl = byName.fl || pick(front, 'left');
    this._wheels.fr = byName.fr || pick(front, 'right');
    this._wheels.rl = byName.rl || pick(rear, 'left');
    this._wheels.rr = byName.rr || pick(rear, 'right');
  }

  /**
   * Apply a uniform dark-rubber tire material to all wheel meshes.
   * Generates a small procedural tread texture (repeating dark stripes).
   */
  _applyTireTexture() {
    if (this.wheelMeshes.length === 0) return;

    // Create shared tire material once per entity
    const mat = new StandardMaterial(`tire_${this.id}`, this.scene);
    mat.diffuseColor  = new Color3(0.12, 0.12, 0.12);  // near-black rubber
    mat.specularColor = new Color3(0.08, 0.08, 0.08);  // slight sheen
    mat.roughness     = 0.9;

    // Procedural tread: small DynamicTexture with horizontal stripe bands
    const texSize = 64;
    const tex = new DynamicTexture(`tireTread_${this.id}`, texSize, this.scene, false);
    const ctx = tex.getContext();
    // Base rubber
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, texSize, texSize);
    // Tread grooves (lighter stripes)
    ctx.fillStyle = '#222222';
    for (let y = 0; y < texSize; y += 8) {
      ctx.fillRect(0, y, texSize, 3);
    }
    tex.update();
    tex.uScale = 2;
    tex.vScale = 4;
    mat.diffuseTexture = tex;

    this._tireMaterial = mat;
    this._ownedMaterials.push(mat);

    for (const wm of this.wheelMeshes) {
      wm.material = mat;
    }
  }

  _cloneAndStoreMaterials() {
    const allMeshes = [this.rootMesh, ...this.childMeshes];
    const seen = new Set();

    for (const mesh of allMeshes) {
      if (!mesh.material || seen.has(mesh.material.uniqueId)) continue;
      seen.add(mesh.material.uniqueId);

      // Clone the material — gives this entity its own copy
      const cloned = mesh.material.clone(`${mesh.material.name}_${this.id}`);
      this._ownedMaterials.push(cloned);

      // Store pristine snapshot
      this._originalMaterials.set(cloned.uniqueId, {
        emissiveColor: cloned.emissiveColor ? cloned.emissiveColor.clone() : null,
        diffuseColor:  cloned.diffuseColor  ? cloned.diffuseColor.clone()  : null,
        alpha:         cloned.alpha ?? 1,
        backFaceCulling: cloned.backFaceCulling ?? true,
      });

      // Apply cloned material to this mesh (and any children sharing the
      // same original material)
      const origId = mesh.material.uniqueId;
      for (const m of allMeshes) {
        if (m.material && m.material.uniqueId === origId) {
          m.material = cloned;
        }
      }
    }
  }

  /**
   * Reset all materials to their original (load-time) state.
   * Cancels any pending override timers.
   */
  resetMaterials() {
    // Cancel pending override timers
    for (const tid of this._overrideTimers) clearTimeout(tid);
    this._overrideTimers.clear();

    for (const mat of this._ownedMaterials) {
      const orig = this._originalMaterials.get(mat.uniqueId);
      if (!orig) continue;
      if (orig.emissiveColor && mat.emissiveColor) {
        mat.emissiveColor.copyFrom(orig.emissiveColor);
      }
      if (orig.diffuseColor && mat.diffuseColor) {
        mat.diffuseColor.copyFrom(orig.diffuseColor);
      }
      if (typeof orig.alpha === 'number') mat.alpha = orig.alpha;
    }
  }

  /**
   * Flash all materials white for `durationMs` then auto-restore.
   * Safe to call rapidly — each call cancels previous pending restores.
   */
  flashWhite(durationMs = 150) {
    if (this.disposed) return;
    for (const mat of this._ownedMaterials) {
      if (mat.emissiveColor) mat.emissiveColor.copyFromFloats(1, 1, 1);
    }
    const tid = setTimeout(() => {
      this._overrideTimers.delete(tid);
      if (!this.disposed) this.resetMaterials();
    }, durationMs);
    this._overrideTimers.add(tid);
  }

  /**
   * Set a damage tint overlay (red emissive) with customisable intensity.
   * Does NOT auto-restore — call `resetMaterials()` or `clearDamageTint()`.
   */
  setDamageTint(intensity = 0.5) {
    if (this.disposed) return;
    for (const mat of this._ownedMaterials) {
      const orig = this._originalMaterials.get(mat.uniqueId);
      if (!orig?.emissiveColor || !mat.emissiveColor) continue;
      mat.emissiveColor.copyFromFloats(
        orig.emissiveColor.r + intensity,
        orig.emissiveColor.g * (1 - intensity * 0.5),
        orig.emissiveColor.b * (1 - intensity * 0.5),
      );
    }
  }

  clearDamageTint() {
    this.resetMaterials();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Attachment points
  // ─────────────────────────────────────────────────────────────────────────

  _createAttachPoints() {
    for (const [name, offset] of Object.entries(ATTACH_POINTS)) {
      const node = new TransformNode(`attach_${name}_${this.id}`, this.scene);
      node.parent = this.rootMesh;
      node.position = offset.clone();
      this.attachPoints[name] = node;
    }
  }

  /**
   * Get the world-space position of a named attachment point.
   * @param {string} name  Key from ATTACH_POINTS
   * @returns {Vector3}
   */
  getAttachWorldPos(name) {
    const node = this.attachPoints[name];
    if (!node) return this.rootMesh?.position?.clone() || Vector3.Zero();
    return node.getAbsolutePosition();
  }

  /**
   * Get the TransformNode for a named attachment point so VFX can parent to it.
   * @param {string} name
   * @returns {TransformNode|null}
   */
  getAttachNode(name) {
    return this.attachPoints[name] || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Physics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a Havok physics aggregate for this kart.
   * @param {import('@babylonjs/core').HavokPlugin} havokPlugin
   * @param {'DYNAMIC'|'ANIMATED'} motionType
   */
  createPhysics(havokPlugin, motionType = 'DYNAMIC') {
    if (!havokPlugin || !this.rootMesh) return;
    try {
      const agg = new PhysicsAggregate(
        this.rootMesh,
        PhysicsShapeType.BOX,
        {
          mass: DEFAULT_MASS,
          friction: 0.8,
          restitution: motionType === 'ANIMATED' ? 0.1 : 0.01,
          extents: this.extents,
        },
        this.scene,
      );

      if (!agg || !agg.body) {
        console.warn(`[KartEntity] PhysicsAggregate created but body is null for ${this.id}`);
        return;
      }

      this.aggregate = agg;

      if (motionType === 'DYNAMIC') {
        // X/Z inertia must be nonzero to resist tumbling — zero = infinite angular accel
        this.aggregate.body.setMassProperties({ inertia: new Vector3(800, 500, 800) });
      } else {
        this.aggregate.body.setMotionType(PhysicsMotionType.ANIMATED);
        this.aggregate.body.disablePreStep = false;
      }

      applyFilterToAggregate(this.aggregate, FILTER.KART);

      if (motionType === 'DYNAMIC') {
        this.aggregate.body.setCollisionCallbackEnabled(true);
      }
    } catch (e) {
      console.warn(`[KartEntity] Physics creation failed for ${this.id}:`, e);
      this.aggregate = null;
    }
  }

  /** Freeze physics (static mode) — used during countdown/death. */
  freezePhysics() {
    if (this.aggregate && this.aggregate.body) {
      this.aggregate.body.setMotionType(PhysicsMotionType.STATIC);
    }
  }

  /** Unfreeze physics (dynamic mode) — used when match goes live. */
  unfreezePhysics() {
    if (this.aggregate && this.aggregate.body) {
      this.aggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
      this.aggregate.body.disablePreStep = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Visibility
  // ─────────────────────────────────────────────────────────────────────────

  setVisible(visible) {
    if (!this.rootMesh) return;
    this.rootMesh.isVisible = visible;
    for (const m of this.childMeshes) m.isVisible = visible;
    this.rootMesh.setEnabled(visible);
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Per-frame updates
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Spin wheel meshes proportional to speed.
   * @param {number} speed  Horizontal speed (m/s)
   * @param {number} dt     Delta time in seconds
   */
  spinWheels(speed, dt) {
    const rotAmt = speed * dt * 2.5; // visible at low speed too
    for (const wm of this.wheelMeshes) {
      wm.rotation.x -= rotAmt;
    }
  }

  /**
   * Apply per-wheel suspension travel offsets from kart-physics spring-damper.
   * Moves each wheel mesh up/down in local Y relative to its rest position.
   * Also compensates for body visual tilt so wheels stay grounded while the
   * body rocks from accel-lean, steer-lean, and terrain pitch/roll.
   *
   * @param {number[]} suspTravel  Array of 4 Y offsets [FL, FR, RL, RR]
   * @param {number}   pitchOff   Visual body pitch in radians (nose-up = negative)
   * @param {number}   rollOff    Visual body roll in radians
   */
  applySuspension(suspTravel, pitchOff = 0, rollOff = 0) {
    const mapping = [this._wheels.fl, this._wheels.fr, this._wheels.rl, this._wheels.rr];
    for (let i = 0; i < 4; i++) {
      const wm = mapping[i];
      if (!wm) continue;
      const baseY = this._wheelBaseY.get(wm) ?? 0;
      const baseX = this._wheelBaseX?.get(wm) ?? 0;
      const baseZ = this._wheelBaseZ?.get(wm) ?? 0;
      // Counteract the Y displacement each wheel gets from the parent's
      // visual tilt so wheels stay planted on the ground.
      const sinP = Math.sin(pitchOff), sinR = Math.sin(rollOff);
      const tiltCompY = -baseZ * sinP + baseX * sinR;
      wm.position.y = baseY + (suspTravel[i] || 0) + tiltCompY;
    }
  }

  /**
   * Return per-wheel raycast offsets derived from the actual loaded GLB
   * wheel positions (in local/unscaled space).  Falls back to hardcoded
   * defaults if wheels aren't classified yet.
   *
   * Order: [FL, FR, RL, RR]  — matches kart-physics.js convention.
   * Y is lifted slightly above wheel centre so the downward ray starts
   * above the ground plane even when wheels sit low.
   *
   * @returns {Vector3[]}
   */
  getWheelRayOffsets() {
    const RAY_Y_LIFT = 0.3;
    const mapping = [this._wheels.fl, this._wheels.fr, this._wheels.rl, this._wheels.rr];
    const offsets = [];
    for (let i = 0; i < 4; i++) {
      const wm = mapping[i];
      if (wm) {
        const bx = this._wheelBaseX?.get(wm) ?? 0;
        const bz = this._wheelBaseZ?.get(wm) ?? 0;
        offsets.push(new Vector3(bx, RAY_Y_LIFT, bz));
      } else {
        // Fallback: reasonable default
        const sign = (i % 2 === 0) ? -1 : 1; // 0,2=left(-X) 1,3=right(+X)
        const fwd  = i < 2 ? 0.7 : -0.7;
        offsets.push(new Vector3(sign * 0.7, RAY_Y_LIFT, fwd));
      }
    }
    return offsets;
  }

  /**
   * Apply visual front-wheel steering (always on, scales with input).
   * Unlike applyDriftVisuals' steer which only runs during drift,
   * this runs every frame for a polished feel.
   *
   * @param {number} steer  Normalised steer input -1..+1
   * @param {number} speed  Horizontal speed m/s  (scales visual steer)
   */
  applySteerVisuals(steer, speed) {
    // Visual angle: large enough to be clearly visible even from behind.
    // Dampening at speed is mild so you can still see turning at pace.
    const maxAngle = 0.65; // ~37 degrees — RC-car-style visible turnout
    const speedFactor = 1 - Math.min(speed / 50, 0.35); // mild reduction at speed
    const angle = steer * maxAngle * speedFactor;

    if (this._wheels.fl) this._wheels.fl.rotation.y = angle;
    if (this._wheels.fr) this._wheels.fr.rotation.y = angle;
  }

  /**
   * Apply MK3.js-style drift visual offset to the kart body.
   * - driftBodyYaw: rotates the visual model to simulate drift counter-steer
   * - steerAngle: steers front wheels visually
   * - rearSlide: offsets rear wheels laterally for slide illusion
   *
   * @param {number} driftBodyYaw    Y-axis offset in radians (from kart-physics)
   * @param {number} steerAngle      Front wheel visual steer (radians, 0 = straight)
   * @param {number} rearSlide       Back-wheel lateral offset for slide look
   */
  applyDriftVisuals(driftBodyYaw, steerAngle = 0, rearSlide = 0) {
    if (!this.rootMesh) return;

    // MK3.js: groupRef.current.rotation.y = damp(rotation.y, driftDir * 0.4, 4, delta)
    // We apply a visual yaw to the root mesh relative to its physics orientation.
    // This only affects visuals — physics body drives the actual orientation.
    if (!this._driftYawNode) {
      // Create a pivot node between root and children for visual-only yaw
      // Actually, for simplicity, we'll store the yaw offset and apply it
      // externally in the render loop. Just store the value.
    }
    this._currentDriftYaw = driftBodyYaw;

    // Front-wheel steer (visual) — only override if non-zero (applySteerVisuals handles normal steering)
    for (const wm of this.wheelMeshes) {
      const name = (wm.name || '').toLowerCase();
      if (steerAngle !== 0 && name.includes('front')) {
        wm.rotation.y = steerAngle;
      }
      // Rear-wheel lateral slide (visual offset)
      if (rearSlide !== 0 && (name.includes('rear') || name.includes('back'))) {
        if (!wm._originalLocalX) wm._originalLocalX = wm.position.x;
        wm.position.x = wm._originalLocalX + rearSlide;
      }
    }
  }

  /** Reset drift visuals to neutral (rear slide only; front steer handled by applySteerVisuals). */
  resetDriftVisuals() {
    this._currentDriftYaw = 0;
    for (const wm of this.wheelMeshes) {
      const name = (wm.name || '').toLowerCase();
      if (name.includes('rear') || name.includes('back')) {
        if (wm._originalLocalX != null) wm.position.x = wm._originalLocalX;
      }
    }
  }

  /**
   * Teleport the kart to a position+rotation, zero velocity.
   */
  teleport(pos, heading) {
    if (!this.rootMesh) return;
    this.rootMesh.position.copyFromFloats(pos.x, pos.y, pos.z);
    if (this.rootMesh.rotationQuaternion) {
      Quaternion.FromEulerAnglesToRef(0, heading || 0, 0, this.rootMesh.rotationQuaternion);
    }
    if (this.aggregate?.body) {
      this.aggregate.body.setLinearVelocity(Vector3.Zero());
      this.aggregate.body.setAngularVelocity(Vector3.Zero());
      this.aggregate.body.disablePreStep = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Disposal
  // ─────────────────────────────────────────────────────────────────────────

  dispose() {
    if (this.disposed) return;
    this.disposed = true;

    // Cancel all pending timers
    for (const tid of this._overrideTimers) clearTimeout(tid);
    this._overrideTimers.clear();

    // Dispose physics
    if (this.aggregate) {
      try { this.aggregate.dispose(); } catch (_) {}
      this.aggregate = null;
    }

    // Dispose attachment points
    for (const node of Object.values(this.attachPoints)) {
      try { node.dispose(); } catch (_) {}
    }
    this.attachPoints = {};

    // Dispose tire texture
    if (this._tireMaterial?.diffuseTexture) {
      try { this._tireMaterial.diffuseTexture.dispose(); } catch (_) {}
    }

    // Dispose owned materials
    for (const mat of this._ownedMaterials) {
      try { mat.dispose(); } catch (_) {}
    }
    this._ownedMaterials = [];
    this._originalMaterials.clear();

    // Dispose mesh hierarchy
    if (this.rootMesh) {
      try { this.rootMesh.dispose(false, true); } catch (_) {}
      this.rootMesh = null;
    }

    this.childMeshes = [];
    this.wheelMeshes = [];
    this._wheels = { fl: null, fr: null, rl: null, rr: null };
    this._wheelBaseY.clear();
    this._tireMaterial = null;
    this.loaded = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Factory helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load a kart for the local player.  Returns a ready-to-use KartEntity.
 */
export async function createLocalKartEntity(scene, opts) {
  const entity = new KartEntity(scene, { ...opts, isLocal: true });
  await entity.load();
  return entity;
}

/**
 * Load a kart for a remote player.  Returns a ready-to-use KartEntity.
 */
export async function createRemoteKartEntity(scene, opts) {
  const entity = new KartEntity(scene, { ...opts, isLocal: false });
  await entity.load();
  return entity;
}
