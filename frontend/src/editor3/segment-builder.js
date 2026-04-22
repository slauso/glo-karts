/**
 * segment-builder.js — Converts segment block definitions into:
 *   - Three.js Group of meshes (for visuals in editor + playtest)
 *   - cannon-es Body with Box shapes (for collisions in playtest)
 *
 * Same definition → matching visual + collider. Drive-on-what-you-see.
 */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { SEGMENTS } from './segments.js';
import { VISUAL_BUILDERS } from './road-geometry.js';

const materialCache = new Map();
function getMaterial(color) {
  if (!materialCache.has(color)) {
    materialCache.set(color, new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.05,
    }));
  }
  return materialCache.get(color);
}

const boxGeoCache = new Map();
function getBoxGeo(x, y, z) {
  const key = `${x.toFixed(3)}|${y.toFixed(3)}|${z.toFixed(3)}`;
  if (!boxGeoCache.has(key)) {
    boxGeoCache.set(key, new THREE.BoxGeometry(x, y, z));
  }
  return boxGeoCache.get(key);
}

/**
 * Build a Three.Group for a segment key. Origin = anchor cell center.
 * Caller is responsible for positioning + rotating the group on the grid.
 */
export function buildSegmentMesh(key) {
  const def = SEGMENTS[key];
  if (!def) {
    console.warn(`[segment-builder] Unknown segment '${key}'`);
    return new THREE.Group();
  }
  // Polished visual via road-geometry.js (preferred). Falls back to the
  // raw block list (cuboids) for any segment without a custom builder.
  const visualFn = VISUAL_BUILDERS[key];
  if (visualFn) {
    const group = visualFn();
    group.name = `seg:${key}`;
    group.traverse((obj) => {
      if (obj.isMesh) {
        if (obj.castShadow === undefined) obj.castShadow = true;
        if (obj.receiveShadow === undefined) obj.receiveShadow = true;
      }
    });
    return group;
  }
  const group = new THREE.Group();
  group.name = `seg:${key}`;
  for (const block of def.blocks) {
    const mesh = new THREE.Mesh(getBoxGeo(...block.size), getMaterial(block.color));
    mesh.position.set(...block.pos);
    if (block.rotX) mesh.rotation.x = block.rotX;
    if (block.rotY) mesh.rotation.y = block.rotY;
    if (block.rotZ) mesh.rotation.z = block.rotZ;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.drivable = !!block.drivable;
    group.add(mesh);
  }
  return group;
}

/**
 * Build a static cannon-es Body containing every solid block of a segment.
 * The body is placed at `worldPos` and rotated by `worldRotY` (radians).
 */
export function buildSegmentBody(key, worldPos, worldRotY) {
  const def = SEGMENTS[key];
  if (!def) return null;
  const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  const yawQuat = new CANNON.Quaternion();
  yawQuat.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), worldRotY);
  body.position.set(worldPos.x, worldPos.y, worldPos.z);
  body.quaternion.copy(yawQuat);

  for (const block of def.blocks) {
    if (block.solid === false) continue;
    const halfExtents = new CANNON.Vec3(
      block.size[0] / 2, block.size[1] / 2, block.size[2] / 2,
    );
    const shape = new CANNON.Box(halfExtents);
    const offset = new CANNON.Vec3(...block.pos);
    // Compose local rotation (rotX then rotY then rotZ)
    const localQuat = new CANNON.Quaternion();
    if (block.rotX || block.rotY || block.rotZ) {
      const qx = new CANNON.Quaternion();
      qx.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), block.rotX || 0);
      const qy = new CANNON.Quaternion();
      qy.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), block.rotY || 0);
      const qz = new CANNON.Quaternion();
      qz.setFromAxisAngle(new CANNON.Vec3(0, 0, 1), block.rotZ || 0);
      const tmp = new CANNON.Quaternion();
      qy.mult(qx, tmp);
      tmp.mult(qz, localQuat);
    }
    body.addShape(shape, offset, localQuat);
  }
  return body;
}

/** True if a segment block is marked as the "drivable" road surface. */
export function getDrivableTopY(key) {
  const def = SEGMENTS[key];
  if (!def) return 0.4;
  let maxY = 0;
  for (const b of def.blocks) {
    if (!b.drivable) continue;
    const top = b.pos[1] + b.size[1] / 2;
    if (top > maxY) maxY = top;
  }
  return maxY || 0.4;
}
