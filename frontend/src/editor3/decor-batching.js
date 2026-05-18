/**
 * decor-batching.js — Build a draw-call-cheap, broadphase-cheap
 * representation of a DecorStore for the playtest runtime.
 *
 * Why: editor3 designs routinely contain hundreds of placed primitives.
 * The naive path (one Mesh + one static Body per instance) was costing
 * an extra draw call AND broadphase pair per shape, which is what made
 * the simulate scene "extremely resource hungry" on weaker devices.
 *
 * What this module does instead:
 *   1. Render path → group by (type, color, isHole, transparent, paramsKey).
 *      Each group becomes ONE THREE.InstancedMesh (or a single regular
 *      Mesh when the group only has one entry — instancing has overhead
 *      below ~3 instances on some drivers, so we keep it tunable).
 *   2. Collider path → bin static decor AABBs into a coarse XZ grid
 *      (chunkUnits cells). Per chunk, we add ONE static CANNON.Body
 *      that owns every instance's Box shape as a child shape. This
 *      keeps the broadphase pair count proportional to (#chunks the
 *      kart is near) instead of (#total decor).
 *
 * Both passes preserve picking IDs (instance.id → instanceMatrixIndex)
 * so future per-instance interactions can be re-attached without
 * structural rework.
 *
 * No imports of editor-only modules — only THREE + CANNON + DECOR
 * (the geometry registry already shared by the editor and play paths).
 */

import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { DECOR, getDecorMaterial, buildDecorMesh } from './decor.js';

const _scratchMat = new THREE.Matrix4();
const _scratchPos = new THREE.Vector3();
const _scratchQuat = new THREE.Quaternion();
const _scratchScale = new THREE.Vector3();
const _scratchEuler = new THREE.Euler();
const _scratchBox = new THREE.Box3();
const _scratchSize = new THREE.Vector3();
const _scratchCenter = new THREE.Vector3();

function paramsKey(params) {
  if (!params) return '';
  const keys = Object.keys(params).sort();
  let out = '';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out += (i ? '|' : '') + k + ':' + params[k];
  }
  return out;
}

function groupKey(inst) {
  return `${inst.type}|${inst.color}|${inst.isHole ? 1 : 0}|${inst.transparent ? 1 : 0}|${paramsKey(inst.params)}`;
}

function applyTransformToMatrix(out, inst) {
  _scratchPos.set(inst.x, inst.y, inst.z);
  _scratchEuler.set(inst.rx, inst.ry, inst.rz, 'XYZ');
  _scratchQuat.setFromEuler(_scratchEuler);
  _scratchScale.set(inst.sx, inst.sy, inst.sz);
  out.compose(_scratchPos, _scratchQuat, _scratchScale);
}

/**
 * Build a flat list of THREE.Object3D and a list of CANNON.Body chunks
 * for a DecorStore. Caller adds each visual to the scene and each body
 * to the world.
 *
 * @param {Iterable<object>} instances - DecorStore.all() output.
 * @param {object} [opts]
 * @param {number} [opts.instanceMin=2] - groups smaller than this stay un-instanced.
 * @param {number} [opts.maxColliders=2048] - hard cap on bodies generated.
 * @param {number} [opts.chunkUnits=14000] - XZ bin size in world units.
 * @param {boolean} [opts.castShadows=false] - whether decor casts shadows.
 * @param {boolean} [opts.receiveShadows=false] - whether decor receives.
 * @param {CANNON.Material|null} [opts.physicsMaterial=null] - shared material.
 * @returns {{ visuals: THREE.Object3D[], bodies: CANNON.Body[], stats: object }}
 */
export function buildBatchedDecor(instances, opts = {}) {
  const {
    instanceMin = 2,
    maxColliders = 2048,
    chunkUnits = 14000,
    castShadows = false,
    receiveShadows = false,
    physicsMaterial = null,
  } = opts;

  // ── Bucket by group key so identical primitives share an InstancedMesh.
  const buckets = new Map();
  const list = Array.isArray(instances) ? instances : Array.from(instances);
  for (const inst of list) {
    if (!DECOR[inst.type]) continue;
    if (inst.isHidden) continue;
    const k = groupKey(inst);
    let bucket = buckets.get(k);
    if (!bucket) { bucket = []; buckets.set(k, bucket); }
    bucket.push(inst);
  }

  const visuals = [];
  /** @type {Map<string, CANNON.Body>} */
  const chunks = new Map();
  let collidersCreated = 0;
  let instancedCount = 0;
  let regularCount = 0;
  let glbCount = 0;
  let modelCount = 0;

  for (const [, bucket] of buckets) {
    const sample = bucket[0];
    const def = DECOR[sample.type];
    if (!def) continue;

    // GLB-backed and model-backed props can't share a single InstancedMesh
    // (each clone owns its own scene graph/material state, or is async
    // swapped in via a builder), so we fall back to per-instance visuals.
    if (def.glb || def.model) {
      for (const inst of bucket) {
        const m = buildDecorMesh(inst);
        if (m) {
          visuals.push(m);
          if (def.glb) glbCount += 1;
          else modelCount += 1;
        }
        addColliderForInstance(inst, null, chunks, chunkUnits, physicsMaterial);
      }
      continue;
    }

    // Build geometry once for the whole bucket. _box / cylinder / sphere
    // / etc. all return either a cached singleton (geom('key', factory))
    // or a per-param geometry. Either way we own the reference here and
    // reuse it across all instances.
    const geom = def.build(sample.params);
    const mat = getDecorMaterial(sample.color, sample.isHole, !!sample.transparent);

    // Cache local-space AABB once per group: every instance shares the
    // same geometry, so the only per-instance work is transforming the
    // 8 corners by the instance matrix. Avoids constructing a probe
    // Mesh per instance (which dominated decor build cost on big scenes).
    if (!geom.boundingBox) geom.computeBoundingBox();
    const localBox = geom.boundingBox;

    if (bucket.length < instanceMin) {
      for (const inst of bucket) {
        const m = new THREE.Mesh(geom, mat);
        m.position.set(inst.x, inst.y, inst.z);
        m.rotation.set(inst.rx, inst.ry, inst.rz);
        m.scale.set(inst.sx, inst.sy, inst.sz);
        m.castShadow = castShadows;
        m.receiveShadow = receiveShadows;
        m.userData.decorId = inst.id;
        visuals.push(m);
        regularCount += 1;
        addColliderForInstance(inst, localBox, chunks, chunkUnits, physicsMaterial);
        if (++collidersCreated >= maxColliders) break;
      }
      continue;
    }

    const inst = new THREE.InstancedMesh(geom, mat, bucket.length);
    inst.frustumCulled = true;
    inst.castShadow = castShadows;
    inst.receiveShadow = receiveShadows;
    // Three's default usage is StaticDraw — perfect for our case (we
    // never animate decor transforms after the scene loads).
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < bucket.length; i++) {
      applyTransformToMatrix(_scratchMat, bucket[i]);
      inst.setMatrixAt(i, _scratchMat);
      // Map instance index → decor id for any future picking.
      inst.userData[`decorId:${i}`] = bucket[i].id;
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere?.();
    visuals.push(inst);
    instancedCount += 1;
    for (const i of bucket) {
      addColliderForInstance(i, localBox, chunks, chunkUnits, physicsMaterial);
      if (++collidersCreated >= maxColliders) break;
    }
  }

  return {
    visuals,
    bodies: Array.from(chunks.values()),
    stats: {
      total: list.length,
      groups: buckets.size,
      instancedGroups: instancedCount,
      regularMeshes: regularCount,
      glbMeshes: glbCount,
      modelMeshes: modelCount,
      colliderChunks: chunks.size,
      collidersCreated,
    },
  };
}

function addColliderForInstance(inst, localBox, chunks, chunkUnits, physicsMaterial) {
  // Two paths depending on whether we have a precomputed local AABB:
  //   - Primitives → transform the cached local box's 8 corners by the
  //     instance matrix and rebuild a world AABB. ~1 µs/instance, no
  //     allocations beyond the cached scratch arrays.
  //   - GLB/model props (localBox === null) → fall back to the old probe-Mesh
  //     path because their AABBs aren't trivially derivable from def.build.
  const def = DECOR[inst.type];
  if (!def) return;
  if (def.glb || def.model || !localBox) {
    if (def.glb || def.model) return; // collider not generated by this batcher
    // No localBox provided — defensive fallback.
    const geom = def.build(inst.params);
    const probe = new THREE.Mesh(geom, _PROBE_MAT);
    probe.position.set(inst.x, inst.y, inst.z);
    probe.rotation.set(inst.rx, inst.ry, inst.rz);
    probe.scale.set(inst.sx, inst.sy, inst.sz);
    probe.updateMatrixWorld(true);
    _scratchBox.makeEmpty();
    _scratchBox.setFromObject(probe);
  } else {
    // Fast path: transform the 8 corners of localBox by the instance
    // matrix and grow a world-space Box3 around them.
    applyTransformToMatrix(_scratchMat, inst);
    _scratchBox.makeEmpty();
    const min = localBox.min;
    const max = localBox.max;
    for (let cx = 0; cx < 2; cx++) {
      for (let cy = 0; cy < 2; cy++) {
        for (let cz = 0; cz < 2; cz++) {
          _scratchCornerVec.set(
            cx ? max.x : min.x,
            cy ? max.y : min.y,
            cz ? max.z : min.z,
          ).applyMatrix4(_scratchMat);
          _scratchBox.expandByPoint(_scratchCornerVec);
        }
      }
    }
  }
  if (!isFinite(_scratchBox.min.x)) return;
  _scratchBox.getSize(_scratchSize);
  _scratchBox.getCenter(_scratchCenter);
  if (_scratchSize.x <= 0 || _scratchSize.y <= 0 || _scratchSize.z <= 0) return;
  const cx = Math.floor(_scratchCenter.x / chunkUnits);
  const cz = Math.floor(_scratchCenter.z / chunkUnits);
  const key = `${cx}|${cz}`;
  let body = chunks.get(key);
  if (!body) {
    body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
    if (physicsMaterial) body.material = physicsMaterial;
    body.position.set(0, 0, 0);
    // Static decor never moves; flag it so cannon's broadphase / narrow
    // phase short-circuits sleep checks.
    body.allowSleep = false;
    body.collisionResponse = true;
    chunks.set(key, body);
  }
  const halfX = _scratchSize.x / 2;
  const halfY = _scratchSize.y / 2;
  const halfZ = _scratchSize.z / 2;
  const box = new CANNON.Box(new CANNON.Vec3(halfX, halfY, halfZ));
  body.addShape(box, new CANNON.Vec3(_scratchCenter.x, _scratchCenter.y, _scratchCenter.z));
}

// Single shared material for AABB probing (GLB fallback only) and a
// scratch Vec3 for the corner-transform fast path.
const _PROBE_MAT = new THREE.MeshBasicMaterial();
const _scratchCornerVec = new THREE.Vector3();
