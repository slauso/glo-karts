/**
 * scene-graph.js — Entity management: add/remove/query placed objects.
 */
import * as THREE from 'three';

let _nextId = 1;

/**
 * @typedef {Object} Entity
 * @property {number} id
 * @property {string} type      - segment type key or obstacle/spawn type
 * @property {string} category  - 'segment' | 'obstacle' | 'spawn'
 * @property {string} modelKey  - asset key for the GLB model
 * @property {THREE.Object3D} object3D
 * @property {{x:number,y:number,z:number}} position
 * @property {number} rotation  - degrees (0/90/180/270)
 * @property {number} scale
 * @property {number} heading   - for spawn points
 */

export class SceneGraph {
  /** @param {THREE.Group} parentGroup */
  constructor(parentGroup) {
    /** @type {Map<number, Entity>} */
    this.entities = new Map();
    this._group = parentGroup;
  }

  add(entity) {
    if (!entity.id) entity.id = _nextId++;
    this.entities.set(entity.id, entity);
    if (entity.object3D) this._group.add(entity.object3D);
    return entity;
  }

  remove(id) {
    const entity = this.entities.get(id);
    if (!entity) return null;
    if (entity.object3D) {
      this._group.remove(entity.object3D);
      entity.object3D.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else child.material.dispose();
        }
      });
    }
    this.entities.delete(id);
    return entity;
  }

  get(id) { return this.entities.get(id) || null; }

  getAll() { return Array.from(this.entities.values()); }

  getByCategory(category) {
    return this.getAll().filter(e => e.category === category);
  }

  clear() {
    for (const id of [...this.entities.keys()]) this.remove(id);
    _nextId = 1;
  }

  updateTransform(id, pos, rotation, scale) {
    const entity = this.entities.get(id);
    if (!entity) return;
    if (pos) {
      entity.position = { ...pos };
      entity.object3D?.position.set(pos.x, pos.y, pos.z);
    }
    if (rotation !== undefined) {
      entity.rotation = rotation;
      if (entity.object3D) entity.object3D.rotation.y = -(rotation * Math.PI / 180);
    }
    if (scale !== undefined) {
      entity.scale = scale;
      entity.object3D?.scale.setScalar(scale);
    }
  }

  /** Serialize all entities to a plain array (for undo/redo & save). */
  serialize() {
    return this.getAll().map(e => ({
      id: e.id,
      type: e.type,
      category: e.category,
      modelKey: e.modelKey,
      position: { ...e.position },
      rotation: e.rotation,
      scale: e.scale,
      heading: e.heading || 0,
    }));
  }

  /** Get the bounding box of all entities. */
  getBounds() {
    const all = this.getAll();
    if (all.length === 0) return { min: { x: -50, y: 0, z: -50 }, max: { x: 50, y: 0, z: 50 } };
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const e of all) {
      minX = Math.min(minX, e.position.x - 5);
      minZ = Math.min(minZ, e.position.z - 5);
      maxX = Math.max(maxX, e.position.x + 5);
      maxZ = Math.max(maxZ, e.position.z + 5);
    }
    return { min: { x: minX, y: 0, z: minZ }, max: { x: maxX, y: 0, z: maxZ } };
  }

  resetIdCounter() { _nextId = 1; }
  setIdCounter(n) { _nextId = n; }
  getIdCounter() { return _nextId; }
}
