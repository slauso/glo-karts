import * as THREE from 'three';

/**
 * Skid trail ribbons for the THREE.js race-mode kart.
 *
 * Drops a small quad at each wheel's ground-contact point whenever the wheel
 * is slipping (Bullet's m_skidInfo < threshold) and in contact with ground.
 * The drops form a ring buffer per wheel that is rendered as an indexed
 * triangle mesh with per-vertex RGBA so old marks fade out smoothly.
 *
 * Why a custom buffer instead of THREE.Line2 / a particle system:
 *  - We need persistent, on-ground decals (not screen-aligned billboards)
 *    that smear when the kart drifts. Particles look like dust, not rubber.
 *  - A single static BufferGeometry per wheel rebuilt in-place each frame
 *    avoids GC pressure and keeps the per-frame cost ≈ 4 wheels × 80 verts.
 *
 * Visual: very dark, low-opacity quads laid flat ~1cm above the contact
 * point with polygonOffset to avoid z-fighting with the road surface.
 */

const RING_LEN          = 80;          // segments per wheel (≈2.5 s @ 30 Hz)
const EMIT_HZ           = 30;          // max drops per second per wheel
const EMIT_DT           = 1 / EMIT_HZ;
const LIFETIME          = 2.5;         // seconds before a drop is fully gone
const SKID_THRESHOLD    = 0.7;         // emit when m_skidInfo < this (1 = full grip)
const STRIP_HALF_WIDTH  = 0.22;        // half-width of the rubber line (m)
const VERTICAL_OFFSET   = 0.02;        // lift above contact to dodge z-fighting
const MAX_GAP_DT        = 0.12;        // gap > this disconnects the ribbon
const MAX_JUMP_DIST_SQ  = 16;          // (4 m)^2 — disconnect on respawn teleports
const TRAIL_COLOR       = new THREE.Color(0x0a0a0a);
const PEAK_ALPHA        = 0.75;
const REUSE_VEC         = new THREE.Vector3();
const REUSE_RIGHT       = new THREE.Vector3();

function createWheelRing() {
  // Two vertices per ring slot (left and right edge of the strip).
  const verts  = new Float32Array(RING_LEN * 2 * 3);
  const colors = new Float32Array(RING_LEN * 2 * 4);
  const idx    = new Uint16Array(RING_LEN * 6);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors, 4));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  geom.setDrawRange(0, 0);
  // Static-ish bounding sphere: track is bounded; supplying a large one
  // avoids automatic recompute on every position update.
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  return {
    head: 0,                                              // ring write index
    times: new Float32Array(RING_LEN),                    // time-of-drop (sec)
    valid: new Uint8Array(RING_LEN),                      // 1 if slot has a drop
    connect: new Uint8Array(RING_LEN),                    // 1 if connects to prev slot
    lastEmit: -Infinity,
    geom,
    verts,
    colors,
    idx,
  };
}

let trailGroup = null;
let wheels = null;        // array of 4 wheel rings
let elapsed = 0;          // module clock (seconds)

export function initSkidTrails(scene, wheelCount = 4) {
  if (trailGroup) return; // idempotent
  trailGroup = new THREE.Group();
  trailGroup.name = 'skid-trails';
  trailGroup.frustumCulled = false;
  scene.add(trailGroup);

  wheels = new Array(wheelCount);
  for (let i = 0; i < wheelCount; i++) {
    const ring = createWheelRing();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,                 // don't occlude transparent things behind
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ring.geom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;                // draw after opaque road
    trailGroup.add(mesh);
    wheels[i] = ring;
  }
}

/**
 * Update all wheel skid trails. Call once per render frame (NOT per physics
 * sub-step) so emission rate is independent of physics tick count.
 *
 * @param {object}  ammoNS         the Ammo namespace (window.Ammo)
 * @param {*}       vehicle        Bullet btRaycastVehicle (already stepped)
 * @param {THREE.Object3D} carModel  chassis root — used for "right" axis
 * @param {number}  dt             render delta (seconds)
 */
export function updateSkidTrails(ammoNS, vehicle, carModel, dt) {
  if (!trailGroup || !vehicle || !carModel || !wheels) return;
  elapsed += dt;

  // Chassis right axis in world space — used to lay the strip across the
  // direction of travel. Wheels can yaw individually for steering, but using
  // chassis-right keeps strips visually consistent and avoids strip flicker
  // when steering rapidly.
  REUSE_RIGHT.set(1, 0, 0).applyQuaternion(carModel.quaternion);

  const wheelCount = Math.min(wheels.length, vehicle.getNumWheels());
  for (let w = 0; w < wheelCount; w++) {
    const ring = wheels[w];
    const info = vehicle.getWheelInfo(w);
    const ray  = info.get_m_raycastInfo();
    const inContact = !!ray.get_m_isInContact();
    // m_skidInfo: 1 = full grip, 0 = full slip. Bullet sets this each step
    // based on the lateral friction impulse vs the available friction cone.
    const skid = info.get_m_skidInfo();

    if (inContact && skid < SKID_THRESHOLD && (elapsed - ring.lastEmit) >= EMIT_DT) {
      const cp = ray.get_m_contactPointWS();
      REUSE_VEC.set(cp.x(), cp.y() + VERTICAL_OFFSET, cp.z());
      const slot = ring.head;
      const prevSlot = (slot - 1 + RING_LEN) % RING_LEN;
      // Detect respawn / teleport: previous drop is too far to be the same
      // continuous skid. Without this the ribbon would smear across the
      // entire teleport distance after a reset.
      let connect = (elapsed - ring.lastEmit) <= MAX_GAP_DT ? 1 : 0;
      if (connect && ring.valid[prevSlot]) {
        const pBase = prevSlot * 6;
        // Use midpoint of previous quad to estimate distance.
        const px = (ring.verts[pBase + 0] + ring.verts[pBase + 3]) * 0.5;
        const py = (ring.verts[pBase + 1] + ring.verts[pBase + 4]) * 0.5;
        const pz = (ring.verts[pBase + 2] + ring.verts[pBase + 5]) * 0.5;
        const dx = REUSE_VEC.x - px, dy = REUSE_VEC.y - py, dz = REUSE_VEC.z - pz;
        if (dx * dx + dy * dy + dz * dz > MAX_JUMP_DIST_SQ) connect = 0;
      }
      const base = slot * 6;
      // Left vertex
      ring.verts[base + 0] = REUSE_VEC.x - REUSE_RIGHT.x * STRIP_HALF_WIDTH;
      ring.verts[base + 1] = REUSE_VEC.y - REUSE_RIGHT.y * STRIP_HALF_WIDTH;
      ring.verts[base + 2] = REUSE_VEC.z - REUSE_RIGHT.z * STRIP_HALF_WIDTH;
      // Right vertex
      ring.verts[base + 3] = REUSE_VEC.x + REUSE_RIGHT.x * STRIP_HALF_WIDTH;
      ring.verts[base + 4] = REUSE_VEC.y + REUSE_RIGHT.y * STRIP_HALF_WIDTH;
      ring.verts[base + 5] = REUSE_VEC.z + REUSE_RIGHT.z * STRIP_HALF_WIDTH;

      ring.times[slot] = elapsed;
      ring.valid[slot] = 1;
      ring.connect[slot] = connect;
      ring.lastEmit = elapsed;
      ring.head = (slot + 1) % RING_LEN;

      ring.geom.attributes.position.needsUpdate = true;
    }

    // Update colors (alpha fade) every frame regardless of emission.
    let drewAny = false;
    let indexCount = 0;
    for (let s = 0; s < RING_LEN; s++) {
      const cBase = s * 8;
      if (!ring.valid[s]) {
        ring.colors[cBase + 3] = 0;
        ring.colors[cBase + 7] = 0;
        continue;
      }
      const age = elapsed - ring.times[s];
      if (age >= LIFETIME) {
        ring.valid[s] = 0;
        ring.connect[s] = 0;
        ring.colors[cBase + 3] = 0;
        ring.colors[cBase + 7] = 0;
        continue;
      }
      const a = (1 - age / LIFETIME) * PEAK_ALPHA;
      ring.colors[cBase + 0] = TRAIL_COLOR.r;
      ring.colors[cBase + 1] = TRAIL_COLOR.g;
      ring.colors[cBase + 2] = TRAIL_COLOR.b;
      ring.colors[cBase + 3] = a;
      ring.colors[cBase + 4] = TRAIL_COLOR.r;
      ring.colors[cBase + 5] = TRAIL_COLOR.g;
      ring.colors[cBase + 6] = TRAIL_COLOR.b;
      ring.colors[cBase + 7] = a;
      drewAny = true;
    }

    // Rebuild the index list: a quad bridges slot s and the slot before it
    // in emission order, but only when both are valid AND the newer slot
    // was flagged "connect". This naturally creates breaks when the kart
    // stops skidding, then resumes.
    if (drewAny) {
      for (let s = 0; s < RING_LEN; s++) {
        if (!ring.valid[s] || !ring.connect[s]) continue;
        const prev = (s - 1 + RING_LEN) % RING_LEN;
        if (!ring.valid[prev]) continue;
        // prev: 2 verts at index prev*2 and prev*2+1
        // curr: 2 verts at index s*2     and s*2+1
        const a = prev * 2, b = prev * 2 + 1, c = s * 2, d = s * 2 + 1;
        ring.idx[indexCount++] = a;
        ring.idx[indexCount++] = b;
        ring.idx[indexCount++] = c;
        ring.idx[indexCount++] = b;
        ring.idx[indexCount++] = d;
        ring.idx[indexCount++] = c;
      }
    }

    ring.geom.setDrawRange(0, indexCount);
    ring.geom.attributes.color.needsUpdate = true;
    ring.geom.index.needsUpdate = true;
  }
}

/** Drop all trails (used on respawn / race reset). */
export function clearSkidTrails() {
  if (!wheels) return;
  for (const ring of wheels) {
    ring.valid.fill(0);
    ring.connect.fill(0);
    ring.lastEmit = -Infinity;
    ring.geom.setDrawRange(0, 0);
  }
}
