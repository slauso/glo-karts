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
import { WORLD_UNITS_PER_M } from './units.js';

// Segments are authored in metres; the rest of the pipeline runs in mm.
// `S` converts authored metres → world units (mm) at the build boundary.
const S = WORLD_UNITS_PER_M;

const materialCache = new Map();
function getMaterial(color) {
  if (!materialCache.has(color)) {
    const mat = new THREE.MeshStandardMaterial({
      color, roughness: 0.85, metalness: 0.05,
    });
    mat._shared = true; // flag: don't dispose on track clear — shared across all placements
    materialCache.set(color, mat);
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
    const inner = visualFn();
    inner.scale.setScalar(S);
    const group = new THREE.Group();
    group.name = `seg:${key}`;
    group.add(inner);
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
    // Trimesh blocks never reach here in practice (they're paired with
    // a polished VISUAL_BUILDERS entry). Skip defensively to avoid
    // dereferencing missing size/pos arrays in the fallback path.
    if (block.kind === 'trimesh') continue;
    const sx = block.size[0] * S, sy = block.size[1] * S, sz = block.size[2] * S;
    const px = block.pos[0] * S,  py = block.pos[1] * S,  pz = block.pos[2] * S;
    const mesh = new THREE.Mesh(getBoxGeo(sx, sy, sz), getMaterial(block.color));
    mesh.position.set(px, py, pz);
    if (block.rotX) mesh.rotation.x = block.rotX;
    if (block.rotY) mesh.rotation.y = block.rotY;
    if (block.rotZ) mesh.rotation.z = block.rotZ;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.drivable = !!block.drivable;
    if (block.isPickupCube) mesh.userData.__pickupCube = true;
    group.add(mesh);
  }
  return group;
}

/**
 * Build a static cannon-es Body containing every solid block of a segment.
 * The body is placed at `worldPos` and rotated by `worldRotY` (radians).
 *
 * Implementation moved to ./segment-physics.js (Phase 2.1) so the realtime
 * server can import the same builder without pulling in three.js. This file
 * still re-exports it for browser callers.
 */
export { buildSegmentBody, getDrivableTopY } from './segment-physics.js';
