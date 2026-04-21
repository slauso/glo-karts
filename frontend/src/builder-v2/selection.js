/**
 * selection.js — Raycast pick, box-select, multi-select.
 */
import * as THREE from 'three';

export class Selection {
  /**
   * @param {import('./scene-graph.js').SceneGraph} sceneGraph
   * @param {() => void} onChange
   * @param {{resolveEntity?: (id: string|number) => any, listAdditionalEntities?: () => any[]}} [options]
   */
  constructor(sceneGraph, onChange, options = {}) {
    this._graph = sceneGraph;
    this._onChange = onChange;
    this._resolveEntity = options.resolveEntity || null;
    this._listAdditionalEntities = options.listAdditionalEntities || null;
    /** @type {Set<number>} */
    this._ids = new Set();
    this._highlightColor = new THREE.Color(0x66aaff);
    this._outlineMeshes = new Map();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._groundPoint = new THREE.Vector3();
  }

  get ids() { return this._ids; }
  get count() { return this._ids.size; }
  get isEmpty() { return this._ids.size === 0; }

  _resolve(id) {
    return this._graph.get(id) || this._resolveEntity?.(id) || null;
  }

  /** Get first selected entity. */
  first() {
    if (this._ids.size === 0) return null;
    return this._resolve(this._ids.values().next().value);
  }

  /** Get all selected entities. */
  all() {
    return Array.from(this._ids).map((id) => this._resolve(id)).filter(Boolean);
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
    for (const entity of this._listAdditionalEntities?.() || []) {
      this._ids.add(entity.id);
      this._highlight(entity.id, true);
    }
    this._onChange();
  }

  /** Check if an entity is selected. */
  has(id) { return this._ids.has(id); }

  /** Raycast pick from a pixel coordinate. Returns entity id or null. */
  pick(camera, pointer, targetGroups) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);

    const groups = Array.isArray(targetGroups) ? targetGroups.filter(Boolean) : [targetGroups].filter(Boolean);
    const meshes = [];
    groups.forEach((group) => {
      group.traverse((child) => {
        if (child.isMesh && child.visible) meshes.push(child);
      });
    });

    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length === 0) return null;

    for (const hit of hits) {
      let matchedRoot = null;
      for (const group of groups) {
        let obj = hit.object;
        while (obj && obj.parent !== group) obj = obj.parent;
        if (obj) {
          matchedRoot = obj;
          break;
        }
      }
      if (!matchedRoot) continue;
      if (matchedRoot.userData?._selectionId) return matchedRoot.userData._selectionId;

      for (const entity of this._graph.getAll()) {
        if (entity.object3D === matchedRoot) return entity.id;
      }

      const matchedId = matchedRoot.userData?._selectionId;
      if (matchedId) return matchedId;
    }
    return null;
  }

  /** Raycast against the ground plane. Returns world position or null. */
  pickGround(camera, pointer, ground) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.ray.intersectPlane(this._groundPlane, this._groundPoint);
    if (!hit) return null;
    return hit.clone();
  }

  _highlight(id, on) {
    const entity = this._resolve(id);
    if (!entity?.object3D) return;

    entity.object3D.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];

      if (on) {
        if (!child.userData._highlightBackup) {
          child.userData._highlightBackup = materials.map((material) => ({
            color: material.color?.clone?.() ?? null,
            emissive: material.emissive?.clone?.() ?? null,
            emissiveIntensity: material.emissiveIntensity ?? 0,
          }));
        }

        materials.forEach((material) => {
          if (material.emissive?.isColor) {
            material.emissive.copy(this._highlightColor);
            material.emissiveIntensity = 0.35;
          } else if (material.color?.isColor) {
            material.color.lerp(this._highlightColor, 0.45);
          }
        });
      } else {
        const backup = child.userData._highlightBackup || [];
        materials.forEach((material, index) => {
          const original = backup[index];
          if (!original) return;
          if (original.color && material.color?.isColor) material.color.copy(original.color);
          if (original.emissive && material.emissive?.isColor) {
            material.emissive.copy(original.emissive);
            material.emissiveIntensity = original.emissiveIntensity;
          }
        });
        delete child.userData._highlightBackup;
      }
    });
  }
}
