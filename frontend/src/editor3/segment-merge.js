/**
 * segment-merge.js — Collapse static segment groups into per-material
 * merged buffers to slash draw calls.
 *
 * Why:
 *   Each road segment in editor3 is a `THREE.Group` of dozens of small
 *   primitive meshes (curbs, posts, dashes, signs, paint stripes). On a
 *   12-tile loop that's already 200-400 draw calls before any decor.
 *
 * What this does:
 *   Walks an array of root Object3D's (the segment group meshes already
 *   placed in the scene), buckets every leaf Mesh by its Material UUID,
 *   bakes each bucket's geometry into world space (applying the parent
 *   group's transform), and produces ONE merged BufferGeometry per
 *   material. The result is a small set of static `THREE.Mesh` objects
 *   that replace the originals.
 *
 * Anything that needs to remain interactive (anything tagged with
 * `userData.__pickupCube`, `userData.__finishLine`, or
 * `userData.__keepLive === true`) is preserved as-is and excluded from
 * the merge so combat/lap detection still works.
 *
 * Returns: { merged: THREE.Mesh[], stats: { groupsMerged, materials, drawCallsBefore, drawCallsAfter } }
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const KEEP_LIVE_FLAGS = ['__pickupCube', '__finishLine', '__keepLive', '__overlay'];

function shouldKeepLive(obj) {
  let cur = obj;
  while (cur) {
    if (cur.userData) {
      for (const flag of KEEP_LIVE_FLAGS) if (cur.userData[flag]) return true;
    }
    cur = cur.parent;
  }
  return false;
}

/**
 * @param {THREE.Object3D[]} roots Segment group meshes already added to the scene.
 * @param {object} opts
 * @param {boolean} [opts.castShadow=false]
 * @param {boolean} [opts.receiveShadow=false]
 * @returns {{ merged: THREE.Mesh[], stats: { groupsMerged: number, materials: number, drawCallsBefore: number, drawCallsAfter: number, leavesMerged: number, leavesKept: number } }}
 */
export function mergeSegmentGroups(roots, opts = {}) {
  const castShadow = !!opts.castShadow;
  const receiveShadow = !!opts.receiveShadow;

  /** @type {Map<string, { material: THREE.Material, geometries: THREE.BufferGeometry[] }>} */
  const buckets = new Map();
  let drawCallsBefore = 0;
  let leavesKept = 0;

  for (const root of roots) {
    root.updateMatrixWorld(true);
    const toRemove = [];
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      if (shouldKeepLive(obj)) { leavesKept += 1; return; }
      drawCallsBefore += 1;

      // Multi-material meshes (groups in the geometry) bypass merging
      // because they require coordinated material arrays. Rare on
      // segment primitives \u2014 keep them live.
      if (Array.isArray(obj.material)) { leavesKept += 1; return; }
      // Skinned / morphed meshes also bypass.
      if (obj.isSkinnedMesh || (obj.geometry && obj.geometry.morphAttributes && Object.keys(obj.geometry.morphAttributes).length)) {
        leavesKept += 1; return;
      }

      const mat = obj.material;
      if (!mat || !obj.geometry) { leavesKept += 1; return; }

      // Bake world transform into a clone so the merge bucket lives in
      // world space (no parenting required for the merged mesh).
      const baked = obj.geometry.clone();
      baked.applyMatrix4(obj.matrixWorld);
      // Drop attributes that aren't shared across the bucket to keep
      // mergeGeometries() happy (it requires identical attribute sets).
      // Standard primitives have position/normal/uv \u2014 leave those.

      const key = mat.uuid;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: mat, geometries: [] };
        buckets.set(key, bucket);
      }
      bucket.geometries.push(baked);
      toRemove.push(obj);
    });
    // Detach merged leaves to free the GPU slots they used to occupy.
    for (const obj of toRemove) {
      obj.parent && obj.parent.remove(obj);
      // Don't dispose geometry/material \u2014 they may be shared with other
      // segments / materials cache. The merged copies are independent.
    }
  }

  const merged = [];
  let leavesMerged = 0;
  for (const [, bucket] of buckets) {
    if (!bucket.geometries.length) continue;
    leavesMerged += bucket.geometries.length;
    let geom;
    try {
      // Try indexed merge first (the common case). If geometries have
      // mismatched attribute layouts mergeGeometries returns null.
      geom = mergeGeometries(bucket.geometries, false);
    } catch {
      geom = null;
    }
    if (!geom) {
      // Fallback: surface each geometry as its own static mesh so we
      // don't lose visuals. Still cheaper than the live tree because
      // there are no traversals / matrix updates.
      for (const g of bucket.geometries) {
        const mesh = new THREE.Mesh(g, bucket.material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        merged.push(mesh);
      }
      continue;
    }
    geom.computeBoundingSphere();
    const mesh = new THREE.Mesh(geom, bucket.material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.frustumCulled = true;
    merged.push(mesh);
  }

  return {
    merged,
    stats: {
      groupsMerged: roots.length,
      materials: buckets.size,
      drawCallsBefore,
      drawCallsAfter: merged.length,
      leavesMerged,
      leavesKept,
    },
  };
}
