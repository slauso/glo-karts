/**
 * road-panel.js — Grid-based road painting with auto-tiling bitmask.
 *
 * Inspired by Starter-Kit-Racing's editor.html auto-tile system.
 * Uses 4-bit neighbor mask (N=8, S=4, E=2, W=1) to pick piece + rotation.
 */
import * as THREE from 'three';
import { GRID_SIZE, snapToGrid, cellKey } from '../modules/track-placement.js';

/**
 * Road cell storage keyed by "x:z".
 * Each cell holds { x, z, mesh, neighborMask }.
 */
export class RoadPainter {
  /**
   * @param {THREE.Group} entityGroup
   * @param {(key: string) => Promise<THREE.Object3D>} loadModelFn
   */
  constructor(entityGroup, loadModelFn) {
    this._group = entityGroup;
    this._loadModel = loadModelFn;
    /** @type {Map<string, { x: number, z: number, mesh: THREE.Object3D|null }>} */
    this.cells = new Map();
    this._ghostMesh = null;
  }

  /** Check if a cell exists at grid coords. */
  hasCell(x, z) {
    return this.cells.has(cellKey(snapToGrid(x), snapToGrid(z)));
  }

  /** Paint a road cell at world position. Returns the cell key or null if already exists. */
  async paint(worldX, worldZ) {
    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);
    const key = cellKey(gx, gz);

    if (this.cells.has(key)) return null;

    this.cells.set(key, { x: gx, z: gz, mesh: null });

    // Rebuild affected neighbors + self
    await this._rebuildCell(gx, gz);
    await this._rebuildNeighbors(gx, gz);

    return key;
  }

  /** Erase a road cell at world position. Returns true if erased. */
  async erase(worldX, worldZ) {
    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);
    const key = cellKey(gx, gz);

    const cell = this.cells.get(key);
    if (!cell) return false;

    if (cell.mesh) {
      this._group.remove(cell.mesh);
    }
    this.cells.delete(key);

    // Rebuild neighbors
    await this._rebuildNeighbors(gx, gz);
    return true;
  }

  /** Get all cells as an array for serialization. */
  serialize() {
    return Array.from(this.cells.values()).map((c, i) => ({
      id: i + 1,
      position: { x: c.x, y: 0, z: c.z },
    }));
  }

  /** Load cells from serialized data. */
  async deserialize(roadCells) {
    this.clearAll();
    for (const rc of roadCells) {
      if (!rc?.position) continue;
      const gx = snapToGrid(rc.position.x);
      const gz = snapToGrid(rc.position.z);
      this.cells.set(cellKey(gx, gz), { x: gx, z: gz, mesh: null });
    }
    await this.rebuildAll();
  }

  /** Rebuild all cell meshes. */
  async rebuildAll() {
    const promises = [];
    for (const cell of this.cells.values()) {
      promises.push(this._rebuildCell(cell.x, cell.z));
    }
    await Promise.all(promises);
  }

  /** Clear all road cells. */
  clearAll() {
    for (const cell of this.cells.values()) {
      if (cell.mesh) this._group.remove(cell.mesh);
    }
    this.cells.clear();
  }

  /** Show a ghost preview at position. */
  showGhost(worldX, worldZ, scene) {
    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);

    if (!this._ghostMesh) {
      const geo = new THREE.PlaneGeometry(GRID_SIZE * 0.9, GRID_SIZE * 0.9);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44ff88,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide,
      });
      this._ghostMesh = new THREE.Mesh(geo, mat);
      this._ghostMesh.name = '__road_ghost';
    }

    this._ghostMesh.position.set(gx, 0.05, gz);

    if (!this._ghostMesh.parent) scene.add(this._ghostMesh);
    this._ghostMesh.visible = true;
  }

  hideGhost() {
    if (this._ghostMesh) this._ghostMesh.visible = false;
  }

  /** Determine piece + rotation from 4-bit neighbor bitmask. */
  classifyCell(x, z) {
    const N = this.cells.has(cellKey(x, z - GRID_SIZE)) ? 8 : 0;
    const S = this.cells.has(cellKey(x, z + GRID_SIZE)) ? 4 : 0;
    const E = this.cells.has(cellKey(x + GRID_SIZE, z)) ? 2 : 0;
    const W = this.cells.has(cellKey(x - GRID_SIZE, z)) ? 1 : 0;
    const mask = N | S | E | W;

    // Count connections
    const count = [N,S,E,W].filter(Boolean).length;

    if (count === 0) return { model: 'wide', rotation: 0 };

    if (count === 1) {
      // Dead end — straight pointing toward the neighbor
      if (N) return { model: 'straight', rotation: 0 };
      if (S) return { model: 'straight', rotation: 0 };
      if (E) return { model: 'straight', rotation: 90 };
      if (W) return { model: 'straight', rotation: 90 };
    }

    if (count === 2) {
      // Straight or corner
      if (N && S) return { model: 'straight', rotation: 0 };
      if (E && W) return { model: 'straight', rotation: 90 };
      // Corners
      if (N && E) return { model: 'corner-small', rotation: 0 };
      if (E && S) return { model: 'corner-small', rotation: 90 };
      if (S && W) return { model: 'corner-small', rotation: 180 };
      if (W && N) return { model: 'corner-small', rotation: 270 };
    }

    if (count === 3) {
      // T-junction — use wide pad as we don't have a T-piece
      return { model: 'wide', rotation: 0 };
    }

    // count === 4 — crossroads
    return { model: 'wide', rotation: 0 };
  }

  async _rebuildCell(x, z) {
    const key = cellKey(x, z);
    const cell = this.cells.get(key);
    if (!cell) return;

    // Remove old mesh
    if (cell.mesh) {
      this._group.remove(cell.mesh);
      cell.mesh = null;
    }

    const { model, rotation } = this.classifyCell(x, z);

    try {
      const mesh = await this._loadModel(model);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = -(rotation * Math.PI / 180);
      mesh.userData._roadCell = true;
      mesh.userData._cellKey = key;
      cell.mesh = mesh;
      this._group.add(mesh);
    } catch (err) {
      console.warn(`[road-painter] Failed to load model '${model}':`, err);
      // Fallback: colored plane
      const geo = new THREE.PlaneGeometry(GRID_SIZE * 0.95, GRID_SIZE * 0.95);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x555577 });
      const fallback = new THREE.Mesh(geo, mat);
      fallback.position.set(x, 0.02, z);
      fallback.userData._roadCell = true;
      fallback.userData._cellKey = key;
      cell.mesh = fallback;
      this._group.add(fallback);
    }
  }

  async _rebuildNeighbors(x, z) {
    const offsets = [
      [0, -GRID_SIZE], [0, GRID_SIZE],
      [GRID_SIZE, 0], [-GRID_SIZE, 0],
    ];
    for (const [dx, dz] of offsets) {
      if (this.cells.has(cellKey(x + dx, z + dz))) {
        await this._rebuildCell(x + dx, z + dz);
      }
    }
  }
}
