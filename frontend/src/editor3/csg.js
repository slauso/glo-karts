// CSG helper for Tinkercad-style group subtraction.
// A group of decor instances combines all Solids and subtracts all Holes,
// producing a single merged Mesh (member meshes hidden while group is active).
//
// Uses three-bvh-csg's Brush + Evaluator. We assume the world units are mm
// and run CSG in world space (instance transforms baked into geometry).

import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { DECOR, getDecorMaterial } from './decor.js';

const _evaluator = new Evaluator();
_evaluator.useGroups = false;
_evaluator.consolidateGroups = true;

function _bakedBrush(inst) {
  const def = DECOR[inst.type];
  if (!def) return null;
  const g = def.build(inst.params).clone();
  const mtx = new THREE.Matrix4().compose(
    new THREE.Vector3(inst.x, inst.y, inst.z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(inst.rx, inst.ry, inst.rz)),
    new THREE.Vector3(inst.sx, inst.sy, inst.sz),
  );
  g.applyMatrix4(mtx);
  const b = new Brush(g);
  b.updateMatrixWorld();
  return b;
}

/** Build a single merged THREE.Mesh from a group's members.
 *  Returns null when the group has no Solid (nothing to draw). */
export function buildGroupMesh(members) {
  const solids = members.filter(d => !d.isHole && !d.isHidden);
  const holes = members.filter(d => d.isHole && !d.isHidden);
  if (solids.length === 0) return null;

  // Union all solids.
  let acc = _bakedBrush(solids[0]);
  for (let i = 1; i < solids.length; i++) {
    const b = _bakedBrush(solids[i]);
    if (!b) continue;
    acc = _evaluator.evaluate(acc, b, ADDITION);
  }
  // Subtract holes.
  for (const h of holes) {
    const b = _bakedBrush(h);
    if (!b) continue;
    acc = _evaluator.evaluate(acc, b, SUBTRACTION);
  }
  // Use the first solid's color/material for the merged result.
  const first = solids[0];
  const mat = getDecorMaterial(first.color, false, !!first.transparent);
  const mesh = new THREE.Mesh(acc.geometry, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
