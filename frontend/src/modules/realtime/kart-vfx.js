/**
 * kart-vfx.js — Per-kart visual effects lifecycle manager.
 *
 * All VFX are PARENTED to KartEntity attachment TransformNodes so they
 * automatically follow the kart as it moves.  This eliminates the
 * "falling off" artifact where world-space particle bursts were left
 * behind at stale positions.
 *
 * Inspired by Mario-Kart-3.js's component-based VFX (Glow, Sparks,
 * Skate, KartDust) that are declaratively attached to the kart hierarchy.
 *
 * Features:
 *  - State machine: IDLE → BOOSTING / DRIFTING / DAMAGED / BURNING /
 *    FROZEN / STUNNED — each state activates/deactivates relevant effects.
 *  - Continuous effects (exhaust smoke, engine glow) tick every frame.
 *  - One-shot effects (hit flash, shield break) auto-clean up.
 *  - All cleanup on dispose() — no orphaned particles ever.
 */

import {
  ParticleSystem,
  Texture,
  Color4,
  Color3,
  Vector3,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core';
import { runtimeFXBudget, runtimePressure } from '../perf-tier.js';

// ═══════════════════════════════════════════════════════════════════════════
//  VFX States
// ═══════════════════════════════════════════════════════════════════════════

export const VFXState = {
  IDLE:    'idle',
  BOOST:   'boost',
  DRIFT:   'drift',
  DAMAGED: 'damaged',
  BURNING: 'burning',
  FROZEN:  'frozen',
  STUNNED: 'stunned',
  DEAD:    'dead',
};

const PARTICLE_TEX = 'https://assets.babylonjs.com/textures/flare.png';

// ═══════════════════════════════════════════════════════════════════════════
//  KartVFX
// ═══════════════════════════════════════════════════════════════════════════

export class KartVFX {
  /**
   * @param {import('@babylonjs/core').Scene} scene
   * @param {import('./kart-entity.js').KartEntity} kartEntity
   */
  constructor(scene, kartEntity, opts = {}) {
    this.scene      = scene;
    this.kart       = kartEntity;
    this.state      = VFXState.IDLE;
    this._disposed  = false;
    this.isRemote   = !!opts.remote;

    /** All particle systems owned by this manager */
    this._systems = [];

    /** All meshes created for VFX (shields, indicators, etc.) */
    this._meshes = [];

    /** Pending timers for auto-cleanup */
    this._timers = new Set();

    // ── Persistent systems ──────────────────────────────────────────────
    this._exhaustLeft  = null;
    this._exhaustRight = null;
    this._boostTrail   = null;
    this._stunStars    = null;
    this._burnFlames   = null;
    this._frozenCrystals = null;
    this._driftSparks  = null;
    this._damageSmoke  = null;
    this._driftGlow    = null;   // MK3.js: billboard glow under kart during drift
    this._wheelDust    = null;   // MK3.js: dust kicked up by wheels
    this._damagePulseRestore = null;

    this._init();
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Initialisation
  // ─────────────────────────────────────────────────────────────────────────

  _init() {
    this._exhaustLeft  = this._createExhaust('exhaustLeft');
    this._exhaustRight = this._createExhaust('exhaustRight');
    this._boostTrail   = this._createBoostTrail();
    this._stunStars    = this._createStunStars();
    this._burnFlames   = this._createBurnFlames();
    this._frozenCrystals = this._createFrostParticles();
    this._driftSparks  = this._createDriftSparks();
    this._damageSmoke  = this._createDamageSmoke();
    this._driftGlow    = this._createDriftGlow();
    this._wheelDust    = this._createWheelDust();
  }

  _fxScale(critical = false) {
    const pressure = runtimePressure();
    const base = Math.max(critical ? 0.55 : 0.35, runtimeFXBudget());
    const remoteMul = this.isRemote ? (critical ? 0.72 : 0.48) : 1;
    if (this.isRemote && !critical && pressure > 0.8) return 0;
    return Math.max(0, base * remoteMul);
  }

  _setEmitRate(ps, baseRate, critical = false) {
    if (!ps) return;
    ps.emitRate = Math.max(0, Math.round(baseRate * this._fxScale(critical)));
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Particle system factories (all PARENTED to attach points)
  // ─────────────────────────────────────────────────────────────────────────

  _createExhaust(attachName) {
    if (this.isRemote) return null;
    const node = this.kart.getAttachNode(attachName);
    if (!node) return null;

    const ps = new ParticleSystem(`exhaust_${attachName}_${this.kart.id}`, 30, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node; // PARENTED — follows the kart
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.35;
    ps.minSize = 0.08;
    ps.maxSize = 0.18;
    ps.emitRate = 8;
    ps.color1 = new Color4(0.7, 0.7, 0.7, 0.4);
    ps.color2 = new Color4(0.5, 0.5, 0.5, 0.2);
    ps.colorDead = new Color4(0.3, 0.3, 0.3, 0);
    ps.direction1 = new Vector3(-0.1, 0.05, -0.5);
    ps.direction2 = new Vector3(0.1, 0.15, -0.3);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.8;
    ps.gravity = new Vector3(0, 0.2, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createBoostTrail() {
    const node = this.kart.getAttachNode('boostRear');
    if (!node) return null;

    const ps = new ParticleSystem(`boost_${this.kart.id}`, 60, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.3;
    ps.minSize = 0.12;
    ps.maxSize = 0.3;
    ps.emitRate = 0; // off by default
    ps.color1 = new Color4(0.2, 0.6, 1.0, 0.9);
    ps.color2 = new Color4(0.1, 0.3, 1.0, 0.5);
    ps.colorDead = new Color4(0, 0, 0.5, 0);
    ps.direction1 = new Vector3(-0.2, 0, -1);
    ps.direction2 = new Vector3(0.2, 0.3, -0.5);
    ps.minEmitPower = 2;
    ps.maxEmitPower = 4;
    ps.gravity = new Vector3(0, -0.5, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createStunStars() {
    const node = this.kart.getAttachNode('stunAbove');
    if (!node) return null;

    const ps = new ParticleSystem(`stun_${this.kart.id}`, 20, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.9;
    ps.minSize = 0.1;
    ps.maxSize = 0.22;
    ps.emitRate = 0;
    ps.color1 = new Color4(1, 1, 0.3, 0.9);
    ps.color2 = new Color4(1, 0.9, 0, 0.6);
    ps.colorDead = new Color4(1, 1, 0, 0);
    ps.direction1 = new Vector3(-0.8, 0.2, -0.8);
    ps.direction2 = new Vector3(0.8, 1, 0.8);
    ps.minEmitPower = 0.4;
    ps.maxEmitPower = 1.2;
    ps.gravity = new Vector3(0, 0.5, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createBurnFlames() {
    const node = this.kart.getAttachNode('damageCenter');
    if (!node) return null;

    const ps = new ParticleSystem(`burn_${this.kart.id}`, 40, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.45;
    ps.minSize = 0.1;
    ps.maxSize = 0.25;
    ps.emitRate = 0;
    ps.color1 = new Color4(1.0, 0.4, 0.0, 0.9);
    ps.color2 = new Color4(1.0, 0.6, 0.1, 0.5);
    ps.colorDead = new Color4(0.3, 0.1, 0, 0);
    ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
    ps.direction2 = new Vector3(0.3, 1.5, 0.3);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.5;
    ps.gravity = new Vector3(0, 1, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createFrostParticles() {
    const node = this.kart.getAttachNode('damageCenter');
    if (!node) return null;

    const ps = new ParticleSystem(`frost_${this.kart.id}`, 30, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.7;
    ps.minSize = 0.05;
    ps.maxSize = 0.14;
    ps.emitRate = 0;
    ps.color1 = new Color4(0.6, 0.85, 1.0, 0.9);
    ps.color2 = new Color4(0.8, 0.95, 1.0, 0.5);
    ps.colorDead = new Color4(0.5, 0.8, 1, 0);
    ps.direction1 = new Vector3(-0.5, 0.3, -0.5);
    ps.direction2 = new Vector3(0.5, 1.0, 0.5);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.8;
    ps.gravity = new Vector3(0, -0.2, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createDriftSparks() {
    const node = this.kart.getAttachNode('boostRear');
    if (!node) return null;

    const ps = new ParticleSystem(`sparks_${this.kart.id}`, 40, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.1;
    ps.maxLifeTime = 0.25;
    ps.minSize = 0.04;
    ps.maxSize = 0.1;
    ps.emitRate = 0;
    ps.color1 = new Color4(1, 0.8, 0.2, 1);
    ps.color2 = new Color4(1, 0.5, 0, 0.8);
    ps.colorDead = new Color4(1, 0.3, 0, 0);
    ps.direction1 = new Vector3(-1, 0, -1);
    ps.direction2 = new Vector3(1, 0.5, 0);
    ps.minEmitPower = 1;
    ps.maxEmitPower = 3;
    ps.gravity = new Vector3(0, -3, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  _createDamageSmoke() {
    const node = this.kart.getAttachNode('damageTop');
    if (!node) return null;

    const ps = new ParticleSystem(`dmgSmoke_${this.kart.id}`, 25, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.4;
    ps.maxLifeTime = 0.8;
    ps.minSize = 0.1;
    ps.maxSize = 0.3;
    ps.emitRate = 0;
    ps.color1 = new Color4(0.3, 0.3, 0.3, 0.5);
    ps.color2 = new Color4(0.2, 0.2, 0.2, 0.3);
    ps.colorDead = new Color4(0.1, 0.1, 0.1, 0);
    ps.direction1 = new Vector3(-0.2, 0.5, -0.2);
    ps.direction2 = new Vector3(0.2, 1.2, 0.2);
    ps.minEmitPower = 0.3;
    ps.maxEmitPower = 0.7;
    ps.gravity = new Vector3(0, 0.8, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  /**
   * MK3.js-style drift glow — a soft additive glow emitter under the kart
   * that pulses in the drift tier colour. Replaces the Glow.jsx billboard.
   */
  _createDriftGlow() {
    if (this.isRemote) return null;
    const node = this.kart.getAttachNode('boostRear');
    if (!node) return null;

    const ps = new ParticleSystem(`driftGlow_${this.kart.id}`, 15, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.15;
    ps.maxLifeTime = 0.35;
    ps.minSize = 0.5;
    ps.maxSize = 1.2;
    ps.emitRate = 0; // off by default
    ps.color1 = new Color4(0.64, 1.0, 1.0, 0.6);  // blue tier default
    ps.color2 = new Color4(0.3, 0.8, 1.0, 0.3);
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.direction1 = new Vector3(-0.1, -0.05, -0.1);
    ps.direction2 = new Vector3(0.1, 0.1, 0.1);
    ps.minEmitPower = 0.05;
    ps.maxEmitPower = 0.2;
    ps.gravity = new Vector3(0, 0, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  /**
   * MK3.js-style wheel dust — kicked up by rear wheels when grounded and
   * moving fast. Ported from Dust.jsx (brownish particles from below).
   */
  _createWheelDust() {
    if (this.isRemote) return null;
    const node = this.kart.getAttachNode('boostRear');
    if (!node) return null;

    const ps = new ParticleSystem(`dust_${this.kart.id}`, 25, this.scene);
    ps.particleTexture = new Texture(PARTICLE_TEX, this.scene);
    ps.emitter = node;
    ps.minLifeTime = 0.2;
    ps.maxLifeTime = 0.5;
    ps.minSize = 0.08;
    ps.maxSize = 0.2;
    ps.emitRate = 0;
    ps.color1 = new Color4(0.65, 0.55, 0.4, 0.5);
    ps.color2 = new Color4(0.55, 0.45, 0.35, 0.3);
    ps.colorDead = new Color4(0.4, 0.35, 0.3, 0);
    ps.direction1 = new Vector3(-0.4, 0.1, -0.6);
    ps.direction2 = new Vector3(0.4, 0.4, -0.2);
    ps.minEmitPower = 0.5;
    ps.maxEmitPower = 1.5;
    ps.gravity = new Vector3(0, -1, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    this._systems.push(ps);
    return ps;
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  State management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Transition to a new VFX state. Automatically deactivates effects from
   * the previous state and activates effects for the new state.
   */
  setState(newState) {
    if (this._disposed || newState === this.state) return;
    const oldState = this.state;
    this.state = newState;

    // Deactivate old state effects
    this._deactivateState(oldState);

    // Activate new state effects
    this._activateState(newState);
  }

  _deactivateState(state) {
    switch (state) {
      case VFXState.BOOST:
        if (this._boostTrail) this._boostTrail.emitRate = 0;
        break;
      case VFXState.DRIFT:
        if (this._driftSparks) this._driftSparks.emitRate = 0;
        if (this._driftGlow) this._driftGlow.emitRate = 0;
        break;
      case VFXState.BURNING:
        if (this._burnFlames) this._burnFlames.emitRate = 0;
        this.kart.resetMaterials();
        break;
      case VFXState.FROZEN:
        if (this._frozenCrystals) this._frozenCrystals.emitRate = 0;
        this.kart.resetMaterials();
        break;
      case VFXState.STUNNED:
        if (this._stunStars) this._stunStars.emitRate = 0;
        break;
      case VFXState.DAMAGED:
        if (this._damageSmoke) this._damageSmoke.emitRate = 0;
        this.kart.resetMaterials();
        break;
      case VFXState.DEAD:
        break;
    }
  }

  _activateState(state) {
    switch (state) {
      case VFXState.IDLE:
        // Exhaust stays on at low rate
        this._setEmitRate(this._exhaustLeft, 8);
        this._setEmitRate(this._exhaustRight, 8);
        break;
      case VFXState.BOOST:
        this._setEmitRate(this._boostTrail, 40, true);
        this._setEmitRate(this._exhaustLeft, 25);
        this._setEmitRate(this._exhaustRight, 25);
        break;
      case VFXState.DRIFT:
        this._setEmitRate(this._driftSparks, 30);
        this._setEmitRate(this._driftGlow, 8);
        break;
      case VFXState.BURNING:
        this._setEmitRate(this._burnFlames, 30, true);
        break;
      case VFXState.FROZEN:
        this._setEmitRate(this._frozenCrystals, 20, true);
        break;
      case VFXState.STUNNED:
        this._setEmitRate(this._stunStars, 12, true);
        break;
      case VFXState.DAMAGED:
        this._setEmitRate(this._damageSmoke, 15, true);
        this.kart.setDamageTint(0.3);
        break;
      case VFXState.DEAD:
        // Turn off all continuous effects
        for (const ps of this._systems) {
          ps.emitRate = 0;
        }
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  One-shot effects
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Emit a one-shot damage hit burst at the kart's position.
   * Uses the damageCenter attachment point.
   */
  emitHitBurst() {
    if (this._disposed) return;
    this.kart.flashWhite(150);
    // Emit a short burst of sparks from damage center
    if (this._damageSmoke) {
      this._damageSmoke.manualEmitCount = Math.max(4, Math.round(8 * this._fxScale(true)));
    }
  }

  /**
   * Briefly anchor a visible damage plume/tint to the kart without replacing
   * longer-lived state effects like burning or frozen.
   */
  pulseDamage(durationMs = 220, tintIntensity = 0.22) {
    if (this._disposed) return;
    if (this._damagePulseRestore) {
      clearTimeout(this._damagePulseRestore);
      this._timers.delete(this._damagePulseRestore);
    }

    if (this._damageSmoke) {
      this._damageSmoke.emitRate = Math.max(this._damageSmoke.emitRate || 0, Math.round(18 * this._fxScale(true)));
      this._damageSmoke.manualEmitCount = Math.max(this._damageSmoke.manualEmitCount || 0, Math.max(5, Math.round(10 * this._fxScale(true))));
    }
    this.kart.setDamageTint(tintIntensity);

    const tid = setTimeout(() => {
      this._timers.delete(tid);
      if (this._disposed) return;
      if (this.state !== VFXState.DAMAGED && this.state !== VFXState.DEAD) {
        if (this._damageSmoke) this._damageSmoke.emitRate = 0;
        this.kart.resetMaterials();
      }
      this._damagePulseRestore = null;
    }, durationMs);
    this._damagePulseRestore = tid;
    this._timers.add(tid);
  }

  /**
   * Emit a one-shot stun burst (brief swirl of stars).
   */
  emitStunBurst() {
    if (this._disposed) return;
    if (this._stunStars) {
      this._stunStars.manualEmitCount = Math.max(5, Math.round(10 * this._fxScale(true)));
    }
  }

  /**
   * Set boost trail colour based on boost type.
   */
  setBoostColor(type) {
    if (!this._boostTrail) return;
    if (type === 'start' || type === 'drift_t2') {
      this._boostTrail.color1 = new Color4(0.2, 0.6, 1.0, 0.9);
      this._boostTrail.color2 = new Color4(0.1, 0.3, 1.0, 0.5);
    } else if (type === 'drift_t3') {
      // MK3.js purple tier — intense trail
      this._boostTrail.color1 = new Color4(0.84, 0.47, 1.0, 0.95);
      this._boostTrail.color2 = new Color4(0.55, 0.15, 0.85, 0.6);
    } else if (type === 'drift_t1') {
      this._boostTrail.color1 = new Color4(1.0, 0.5, 0.0, 0.9);
      this._boostTrail.color2 = new Color4(1.0, 0.2, 0.0, 0.5);
    } else {
      this._boostTrail.color1 = new Color4(0.0, 1.0, 0.8, 0.9);
      this._boostTrail.color2 = new Color4(0.0, 0.7, 0.5, 0.5);
    }
  }

  /**
   * Set drift spark colour based on charge tier.
   * MK3.js color palette: T1 blue #a3ffff, T2 yellow/orange #fab457, T3 purple #d677ff
   */
  setDriftTier(tier) {
    if (!this._driftSparks) return;
    if (tier >= 3) {
      // Purple tier (MK3.js: #d677ff)
      this._driftSparks.color1 = new Color4(0.84, 0.47, 1.0, 1);
      this._driftSparks.color2 = new Color4(0.55, 0.15, 0.85, 0.8);
      this._driftSparks.colorDead = new Color4(0.4, 0.1, 0.6, 0);
      this._setEmitRate(this._driftSparks, 50);
      this._driftSparks.minEmitPower = 2;
      this._driftSparks.maxEmitPower = 5;
      if (this._driftGlow) {
        this._driftGlow.color1 = new Color4(0.84, 0.47, 1.0, 0.7);
        this._driftGlow.color2 = new Color4(0.55, 0.15, 0.85, 0.35);
        this._setEmitRate(this._driftGlow, 12);
      }
    } else if (tier >= 2) {
      // Yellow/orange tier (MK3.js: #fab457)
      this._driftSparks.color1 = new Color4(0.98, 0.71, 0.34, 1);
      this._driftSparks.color2 = new Color4(1.0, 0.5, 0.1, 0.8);
      this._driftSparks.colorDead = new Color4(1.0, 0.3, 0.0, 0);
      this._setEmitRate(this._driftSparks, 40);
      this._driftSparks.minEmitPower = 1.5;
      this._driftSparks.maxEmitPower = 4;
      if (this._driftGlow) {
        this._driftGlow.color1 = new Color4(0.98, 0.71, 0.34, 0.6);
        this._driftGlow.color2 = new Color4(1.0, 0.5, 0.1, 0.3);
        this._setEmitRate(this._driftGlow, 10);
      }
    } else if (tier >= 1) {
      // Blue tier (MK3.js: #a3ffff)
      this._driftSparks.color1 = new Color4(0.64, 1.0, 1.0, 1);
      this._driftSparks.color2 = new Color4(0.3, 0.8, 1.0, 0.8);
      this._driftSparks.colorDead = new Color4(0.1, 0.4, 1.0, 0);
      this._setEmitRate(this._driftSparks, 30);
      this._driftSparks.minEmitPower = 1;
      this._driftSparks.maxEmitPower = 3;
      if (this._driftGlow) {
        this._driftGlow.color1 = new Color4(0.64, 1.0, 1.0, 0.6);
        this._driftGlow.color2 = new Color4(0.3, 0.8, 1.0, 0.3);
        this._setEmitRate(this._driftGlow, 8);
      }
    } else {
      // No tier yet — baseline orange sparks
      this._driftSparks.color1 = new Color4(1, 0.8, 0.2, 1);
      this._driftSparks.color2 = new Color4(1, 0.5, 0, 0.8);
      this._driftSparks.colorDead = new Color4(1, 0.3, 0, 0);
      this._setEmitRate(this._driftSparks, 30);
      this._driftSparks.minEmitPower = 1;
      this._driftSparks.maxEmitPower = 3;
      if (this._driftGlow) {
        this._setEmitRate(this._driftGlow, 6);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Per-frame update
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Call each frame. Adjusts exhaust intensity based on speed,
   * updates damage smoke density based on health.
   * @param {number} dt  Delta time in seconds
   * @param {number} speed  Horizontal speed (m/s)
   * @param {number} health  0-100 health percentage
   */
  update(dt, speed, health) {
    if (this._disposed) return;

    // Exhaust intensity - MK3.js: smoke emitters stop when speed > 15
    if (this.state === VFXState.IDLE || this.state === VFXState.BOOST) {
      if (speed > 15) {
        // MK3.js: exhaust smoke off at high speed (clean air feel)
        if (this._exhaustLeft)  this._exhaustLeft.emitRate = 0;
        if (this._exhaustRight) this._exhaustRight.emitRate = 0;
      } else {
        const exhaustRate = this.state === VFXState.BOOST
          ? Math.min(40, 15 + speed * 1.2)
          : Math.min(18, 5 + speed * 0.6);
        this._setEmitRate(this._exhaustLeft, exhaustRate);
        this._setEmitRate(this._exhaustRight, exhaustRate);
      }

      // Speed-based exhaust colour shift (slow=white, fast=blue-ish)
      if (speed > 8 && speed <= 15 && this._exhaustLeft) {
        const t = Math.min(1, (speed - 8) / 7);
        this._exhaustLeft.color1 = new Color4(0.7 - t * 0.3, 0.7 - t * 0.1, 0.7 + t * 0.3, 0.4);
        this._exhaustRight.color1 = new Color4(0.7 - t * 0.3, 0.7 - t * 0.1, 0.7 + t * 0.3, 0.4);
      }
    }

    // MK3.js: wheel dust when grounded and speed > 5 (Dust.jsx)
    if (this._wheelDust) {
      if (speed > 5 && this.state !== VFXState.DEAD) {
        this._setEmitRate(this._wheelDust, Math.min(15, speed * 0.8));
      } else {
        this._wheelDust.emitRate = 0;
      }
    }

    // Damage smoke intensity based on health (begins < 60%, heavy < 30%)
    if (this.state !== VFXState.DEAD && this._damageSmoke) {
      if (health < 30) {
        this._setEmitRate(this._damageSmoke, 20, true);
        this._damageSmoke.color1 = new Color4(0.15, 0.15, 0.15, 0.6);
      } else if (health < 60) {
        this._setEmitRate(this._damageSmoke, 8, true);
        this._damageSmoke.color1 = new Color4(0.3, 0.3, 0.3, 0.4);
      } else if (this.state !== VFXState.DAMAGED) {
        this._damageSmoke.emitRate = 0;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  //  Disposal
  // ─────────────────────────────────────────────────────────────────────────

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    // Cancel timers
    for (const tid of this._timers) clearTimeout(tid);
    this._timers.clear();
    this._damagePulseRestore = null;

    // Dispose all particle systems
    for (const ps of this._systems) {
      try {
        ps.stop();
        ps.dispose();
      } catch (_) {}
    }
    this._systems = [];

    // Dispose VFX meshes
    for (const m of this._meshes) {
      try { m.dispose(); } catch (_) {}
    }
    this._meshes = [];

    this._exhaustLeft = null;
    this._exhaustRight = null;
    this._boostTrail = null;
    this._stunStars = null;
    this._burnFlames = null;
    this._frozenCrystals = null;
    this._driftSparks = null;
    this._driftGlow = null;
    this._wheelDust = null;
    this._damageSmoke = null;
  }
}
