/**
 * particles.js — STK-inspired particle / VFX system for Three.js modes
 *
 * Provides:
 *   - Drift sparks (blue mini / orange super) behind rear wheels
 *   - Boost flames (on mini/super-turbo activation)
 *   - Nitro / speed-lines stretch effect
 *   - Weapon hit flash particles
 *   - Item pickup sparkle ring
 *
 * All particle pools are GPU-friendly: BufferGeometry + Points.
 * No extra dependencies beyond Three.js.
 */
import * as THREE from 'three';

// ── Pool size limits ──────────────────────────────────────────────────
const SPARK_COUNT    = 80;
const FLAME_COUNT    = 40;
const HIT_COUNT      = 60;
const SPARKLE_COUNT  = 30;

// ── Shared state ──────────────────────────────────────────────────────
let sparkSystem  = null;
let flameSystem  = null;
let hitSystem    = null;
let sparkleSystem = null;

let isInitialized = false;
let _scene = null;

// ── Helper: simple particle pool ──────────────────────────────────────
function createPool(count, color, size, blending = THREE.AdditiveBlending) {
  const positions = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);
  const velocities = [];

  for (let i = 0; i < count; i++) {
    positions[i * 3]     = 0;
    positions[i * 3 + 1] = -9999; // off-screen
    positions[i * 3 + 2] = 0;
    lifetimes[i] = 0;
    velocities.push(new THREE.Vector3());
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.85,
    blending,
    depthWrite: false,
    sizeAttenuation: true,
  });

  const mesh = new THREE.Points(geo, mat);
  mesh.frustumCulled = false;

  return { geo, mat, mesh, positions, lifetimes, velocities, nextIdx: 0, count };
}

// ── Emit into a pool ──────────────────────────────────────────────────
function emit(pool, pos, vel, lifetime = 0.5, count = 1) {
  for (let n = 0; n < count; n++) {
    const i = pool.nextIdx;
    pool.nextIdx = (pool.nextIdx + 1) % pool.count;

    pool.positions[i * 3]     = pos.x + (Math.random() - 0.5) * 0.3;
    pool.positions[i * 3 + 1] = pos.y + Math.random() * 0.1;
    pool.positions[i * 3 + 2] = pos.z + (Math.random() - 0.5) * 0.3;

    pool.velocities[i].copy(vel).multiplyScalar(0.5 + Math.random() * 0.5);
    pool.lifetimes[i] = lifetime;
  }
  pool.geo.attributes.position.needsUpdate = true;
}

// ── Tick a pool (age + move) ──────────────────────────────────────────
function tickPool(pool, dt) {
  let anyAlive = false;
  for (let i = 0; i < pool.count; i++) {
    if (pool.lifetimes[i] <= 0) continue;
    pool.lifetimes[i] -= dt;
    if (pool.lifetimes[i] <= 0) {
      pool.positions[i * 3 + 1] = -9999;
    } else {
      anyAlive = true;
      pool.positions[i * 3]     += pool.velocities[i].x * dt;
      pool.positions[i * 3 + 1] += pool.velocities[i].y * dt;
      pool.positions[i * 3 + 2] += pool.velocities[i].z * dt;
      // gravity on sparks & hit particles
      pool.velocities[i].y -= 9.8 * dt;
    }
  }
  pool.geo.attributes.position.needsUpdate = true;
  return anyAlive;
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Call once after the Three.js scene is created.
 */
export function initParticles(scene) {
  if (isInitialized) return;
  _scene = scene;
  isInitialized = true;

  sparkSystem   = createPool(SPARK_COUNT,   0x4dc9ff, 0.18); // blue default
  flameSystem   = createPool(FLAME_COUNT,   0xff6600, 0.35);
  hitSystem     = createPool(HIT_COUNT,     0xff2222, 0.25);
  sparkleSystem = createPool(SPARKLE_COUNT, 0xffee44, 0.20);

  scene.add(sparkSystem.mesh);
  scene.add(flameSystem.mesh);
  scene.add(hitSystem.mesh);
  scene.add(sparkleSystem.mesh);
}

/**
 * Call every frame from animate():
 *   updateParticles(deltaTime, carModel, kartState);
 */
export function updateParticles(dt, carModel, kartState) {
  if (!isInitialized || !carModel) return;

  // ── Drift sparks ────────────────────────────────────────────────
  if (kartState && kartState.isDrifting && kartState.sparksLevel > 0) {
    // Color based on charge level
    const isSuper = kartState.sparksLevel >= 2;
    sparkSystem.mat.color.setHex(isSuper ? 0xff8800 : 0x4dc9ff);

    // Emit from behind the car (rear axle area)
    const back = new THREE.Vector3(0, 0.15, -1.2);
    back.applyQuaternion(carModel.quaternion);
    back.add(carModel.position);

    // Upward + slight random scatter velocity
    const upVel = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      1.5 + Math.random(),
      (Math.random() - 0.5) * 2,
    );
    emit(sparkSystem, back, upVel, 0.35, 3);
  }

  // ── Boost flames ────────────────────────────────────────────────
  if (kartState && kartState.isBoosting) {
    const exhaust = new THREE.Vector3(0, 0.3, -1.5);
    exhaust.applyQuaternion(carModel.quaternion);
    exhaust.add(carModel.position);

    // Backward flame direction
    const backward = new THREE.Vector3(0, 0.5, -3);
    backward.applyQuaternion(carModel.quaternion);

    emit(flameSystem, exhaust, backward, 0.25, 2);
  }

  // Tick all pools
  tickPool(sparkSystem, dt);
  tickPool(flameSystem, dt);
  tickPool(hitSystem, dt);
  tickPool(sparkleSystem, dt);
}

/**
 * Burst of particles at a world position (weapon hit, collision).
 */
export function emitHitBurst(worldPos, color = 0xff2222, count = 12) {
  if (!isInitialized) return;
  hitSystem.mat.color.setHex(color);
  for (let i = 0; i < count; i++) {
    const vel = new THREE.Vector3(
      (Math.random() - 0.5) * 6,
      2 + Math.random() * 4,
      (Math.random() - 0.5) * 6,
    );
    emit(hitSystem, worldPos, vel, 0.6);
  }
}

/**
 * Sparkle ring at an item-box position when picked up.
 */
export function emitPickupSparkle(worldPos) {
  if (!isInitialized) return;
  for (let i = 0; i < SPARKLE_COUNT; i++) {
    const angle = (i / SPARKLE_COUNT) * Math.PI * 2;
    const vel = new THREE.Vector3(
      Math.cos(angle) * 3,
      1.5 + Math.random(),
      Math.sin(angle) * 3,
    );
    emit(sparkleSystem, worldPos, vel, 0.5);
  }
}

/**
 * Clean up all particle systems.
 */
export function disposeParticles() {
  if (!isInitialized) return;
  [sparkSystem, flameSystem, hitSystem, sparkleSystem].forEach(sys => {
    if (sys && _scene) {
      _scene.remove(sys.mesh);
      sys.geo.dispose();
      sys.mat.dispose();
    }
  });
  isInitialized = false;
  _scene = null;
}
