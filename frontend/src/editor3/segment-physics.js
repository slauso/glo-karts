/**
 * segment-physics.js — Engine-agnostic cannon-es body builder for a segment.
 *
 * Extracted from segment-builder.js (Phase 2.1) so the realtime server can
 * import the same physics code WITHOUT pulling in three.js / road-geometry.js.
 *
 * Single source of truth: this file is the canonical implementation. The
 * browser-side `segment-builder.js` re-exports `buildSegmentBody` and
 * `getDrivableTopY` from here, so behavior remains identical.
 *
 * Everything in this module depends only on `cannon-es` and `./segments.js`
 * (which is itself pure data).
 */
import * as CANNON from 'cannon-es';
import { SEGMENTS } from './segments.js';
import { WORLD_UNITS_PER_M } from './units.js';

// Segments are authored in metres; physics runs in mm.
const S = WORLD_UNITS_PER_M;

/**
 * Build a static cannon-es Body containing every solid block of a segment.
 * The body is placed at `worldPos` and rotated by `worldRotY` (radians).
 *
 * @param {string} key Segment id (key into SEGMENTS registry)
 * @param {{x:number,y:number,z:number}} worldPos World-unit position (mm)
 * @param {number} worldRotY Yaw rotation in radians around +Y
 * @returns {CANNON.Body|null} static body, or null if the segment is unknown
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
    const offset = new CANNON.Vec3(
      (block.pos?.[0] || 0) * S,
      (block.pos?.[1] || 0) * S,
      (block.pos?.[2] || 0) * S,
    );
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
    if (block.kind === 'trimesh') {
      // Curved surfaces (banked-turn bowl) where a discrete box mesh
      // can't seal the lateral seams without gaps. Vertices are stored
      // in segment-local *segment units* and scaled here to world (mm).
      const verts = new Float32Array(block.vertices.length);
      for (let i = 0; i < block.vertices.length; i++) verts[i] = block.vertices[i] * S;
      const shape = new CANNON.Trimesh(verts, block.indices);
      body.addShape(shape, offset, localQuat);
      continue;
    }
    const halfExtents = new CANNON.Vec3(
      (block.size[0] * S) / 2, (block.size[1] * S) / 2, (block.size[2] * S) / 2,
    );
    const shape = new CANNON.Box(halfExtents);
    body.addShape(shape, offset, localQuat);
  }
  return body;
}

/** Return the highest drivable-block top Y (in world units) for a segment. */
export function getDrivableTopY(key) {
  const def = SEGMENTS[key];
  if (!def) return 0.4 * S;
  let maxY = 0;
  for (const b of def.blocks) {
    if (!b.drivable) continue;
    if (b.kind === 'trimesh') {
      const verts = b.vertices;
      for (let i = 1; i < verts.length; i += 3) {
        if (verts[i] > maxY) maxY = verts[i];
      }
      continue;
    }
    const top = b.pos[1] + b.size[1] / 2;
    if (top > maxY) maxY = top;
  }
  return (maxY || 0.4) * S;
}

/** Scale factor metres → world units. Exported for callers that need it. */
export const SEGMENT_SCALE = S;
