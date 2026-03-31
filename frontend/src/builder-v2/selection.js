/**
 * selection.js — Raycast pick, box-select, multi-select.
 */
import * as THREE from 'three';

export class Selection {
  /**
   * @param {import('./scene-graph.js').SceneGraph} sceneGraph
   * @param {() => void} onChange
   */
  constructor(sceneGraph, onChange) {
    this._graph = sceneGraph;
    this._onChange = onChange;
    /** @type {Set<number>} */
    this._ids = new Set();
    this._highlightColor = new THREE.Color(0x66aaff);
    this._outlineMeshes = new Map();
  }

  get ids() { return this._ids; }
  get count() { return this._ids.size; }
  get isEmpty() { return this._ids.size === 0; }

  /** Get first selected entity. */
  first() {
    if (this._ids.size === 0) return null;
    return this._graph.get(this._ids.values().next().value);
  }

  /** Get all selected entities. */
  all() {
    return Array.from(this._ids).map(id => this._graph.get(id)).filter(Boolean);
  }

  /** Select a single entity, replacing current selection. */
  select(id) {
    this.clear(true);
    this._ids.add(id);
    this._highlight(id, true);
    this._onChange();
  }

  /** Toggle entity in/out of selection (for Shift+click). */
  toggle(id) {
    if (this._ids.has(id)) {
      this._ids.delete(id);
      this._highlight(id, false);
    } else {
      this._ids.add(id);
      this._highlight(id, true);
    }
    this._onChange();
  }

  /** Clear all selection. */
  clear(silent = false) {
    for (const id of this._ids) this._highlight(id, false);
    this._ids.clear();
    if (!silent) this._onChange();
  }

  /** Select all entities. */
  selectAll() {
    for (const entity of this._graph.getAll()) {
      this._ids.add(entity.id);
      this._highlight(entity.id, true);
    }
    this._onChange();
  }

  /** Check if an entity is selected. */
  has(id) { return this._ids.has(id); }

  /** Raycast pick from a pixel coordinate. Returns entity id or null. */
  pick(camera, pointer, entityGroup) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    const meshes = [];
    entityGroup.traverse((child) => {
      if (child.isMesh && child.visible) meshes.push(child);
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    // Walk up to find the entity root (direct child of entityGroup)
    let obj = hits[0].object;
    while (obj && obj.parent !== entityGroup) obj = obj.parent;
    if (!obj) return null;

    // Find entity whose object3D matches
    for (const entity of this._graph.getAll()) {
      if (entity.object3D === obj) return entity.id;
    }
    return null;
  }

  /** Raycast against the ground plane. Returns world position or null. */
  pickGround(camera, pointer, ground) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(ground);
    if (hits.length === 0) return null;
    return hits[0].point;
  }

  _highlight(id, on) {
    const entity = this._graph.get(id);
    if (!entity?.object3D) return;

    entity.object3D.traverse((child) => {
      if (!child.isMesh) return;
      if (on) {
        if (!child.userData._origEmissive) {
          child.userData._origEmissive = child.material.emissive?.clone() || new THREE.Color(0);
          child.userData._origEmissiveIntensity = child.material.emissiveIntensity ?? 0;
        }
        child.material.emissive = this._highlightColor;
        child.material.emissiveIntensity = 0.35;
      } else {
        if (child.userData._origEmissive) {
          child.material.emissive = child.userData._origEmissive;
          child.material.emissiveIntensity = child.userData._origEmissiveIntensity;
          delete child.userData._origEmissive;
          delete child.userData._origEmissiveIntensity;
        }
      }
    });
  }
}
