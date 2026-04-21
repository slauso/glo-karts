/**
 * road-panel.js — Grid-based road painting with auto-tiling.
 *
 * Uses track-data.js auto-tile engine for intelligent piece resolution.
 * Ghost preview shows actual 3D models with neighbor change previews.
 */
import * as THREE from 'three';
import { GRID_SIZE, snapToGrid, cellKey } from '../modules/track-placement.js';
import {
  TRACK_CELLS, addCell, removeCell, clearAllCells,
  resolveTile, getGhostPreview, importCells, exportCells,
  cellKey as tdCellKey,
} from './track-data.js';

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
    this._ghostGroup = new THREE.Group();
    this._ghostGroup.name = '__road_ghost_group';
    this._ghostMeshes = [];
  }

  /** Check if a cell exists at grid coords. */
  hasCell(x, z) {
    return this.cells.has(cellKey(snapToGrid(x), snapToGrid(z)));
  }

  getCell(key) {
    return this.cells.get(key) || null;
  }

  getSelectionId(key) {
    return `road:${key}`;
  }

  getSelectionEntity(key) {
    const cell = this.cells.get(key);
    if (!cell?.mesh) return null;
    const td = TRACK_CELLS.get(tdCellKey(cell.x, cell.z));
    const rotation = td?.rotation || 0;
    return {
      id: this.getSelectionId(key),
      type: td?.type || 'road',
      category: 'road',
      modelKey: 'road',
      object3D: cell.mesh,
      position: { x: cell.x, y: 0, z: cell.z },
      rotation,
      scale: 1,
      roadCellKey: key,
    };
  }

  getSelectionEntities() {
    return Array.from(this.cells.keys())
      .map((key) => this.getSelectionEntity(key))
      .filter(Boolean);
  }

  /** Paint a road cell at world position. Returns the cell key or null if already exists. */
  async paint(worldX, worldZ) {
    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);
    const key = cellKey(gx, gz);

    if (this.cells.has(key)) return null;

    // Add to track-data auto-tile engine (resolves self + neighbors)
    const changes = addCell(gx, gz);

    // Add to local mesh map
    this.cells.set(key, { x: gx, z: gz, mesh: null });

    // Rebuild self
    await this._rebuildCell(gx, gz);

    // Rebuild changed neighbors
    if (changes) {
      for (const change of changes) {
        if (change.gx === gx && change.gz === gz) continue;
        await this._rebuildCell(change.gx, change.gz);
      }
    }

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

    // Remove from track-data engine and re-resolve neighbors
    const changes = removeCell(gx, gz);
    for (const change of changes) {
      await this._rebuildCell(change.gx, change.gz);
    }

    return true;
  }

  async eraseByKey(key) {
    const cell = this.cells.get(key);
    if (!cell) return false;
    return this.erase(cell.x, cell.z);
  }

  async moveCellByKey(key, worldX, worldZ) {
    const cell = this.cells.get(key);
    if (!cell) return null;

    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);
    const nextKey = cellKey(gx, gz);
    if (nextKey === key) return key;
    if (this.cells.has(nextKey)) return null;

    // Erase old
    if (cell.mesh) this._group.remove(cell.mesh);
    this.cells.delete(key);
    removeCell(cell.x, cell.z);

    // Paint new
    this.cells.set(nextKey, { x: gx, z: gz, mesh: null });
    addCell(gx, gz);
    await this._rebuildCell(gx, gz);

    // Rebuild old neighbors
    const offsets = [[0, -GRID_SIZE], [0, GRID_SIZE], [GRID_SIZE, 0], [-GRID_SIZE, 0]];
    for (const [dx, dz] of offsets) {
      if (this.cells.has(cellKey(cell.x + dx, cell.z + dz))) {
        await this._rebuildCell(cell.x + dx, cell.z + dz);
      }
    }

    return nextKey;
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

    // Import into track-data engine
    const cellData = roadCells
      .filter(rc => rc?.position)
      .map(rc => ({
        gx: snapToGrid(rc.position.x),
        gz: snapToGrid(rc.position.z),
      }));
    importCells(cellData);

    // Sync local mesh map
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
    clearAllCells();
  }

  /** Show a ghost preview at position using actual 3D models. */
  async showGhost(worldX, worldZ, scene) {
    const gx = snapToGrid(worldX);
    const gz = snapToGrid(worldZ);

    // Ensure ghost group is in scene
    if (!this._ghostGroup.parent) scene.add(this._ghostGroup);

    // Clear previous ghosts
    this._clearGhosts();

    // If cell already occupied, don't show ghost
    if (this.cells.has(cellKey(gx, gz))) return;

    // Get preview from auto-tile engine
    const preview = getGhostPreview(gx, gz);
    if (!preview) return;

    // Show ghost for the new cell
    try {
      const ghostMesh = await this._loadModel(preview.self.type);
      ghostMesh.position.set(gx, 0, gz);
      ghostMesh.rotation.y = THREE.MathUtils.degToRad(preview.self.rotation);
      this._makeGhostTransparent(ghostMesh, 0x44ff88);
      this._ghostGroup.add(ghostMesh);
      this._ghostMeshes.push(ghostMesh);
    } catch {
      // Fallback flat plane
      const geo = new THREE.PlaneGeometry(GRID_SIZE * 0.9, GRID_SIZE * 0.9);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44ff88, transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      });
      const plane = new THREE.Mesh(geo, mat);
      plane.position.set(gx, 0.05, gz);
      this._ghostGroup.add(plane);
      this._ghostMeshes.push(plane);
    }

    // Show neighbor change previews
    for (const change of preview.neighborChanges) {
      try {
        const nbMesh = await this._loadModel(change.type);
        nbMesh.position.set(change.gx, 0, change.gz);
        nbMesh.rotation.y = THREE.MathUtils.degToRad(change.rotation);
        this._makeGhostTransparent(nbMesh, 0xffaa22, 0.25);
        this._ghostGroup.add(nbMesh);
        this._ghostMeshes.push(nbMesh);
      } catch {
        // skip failed neighbor previews
      }
    }
  }

  hideGhost() {
    this._clearGhosts();
  }

  _clearGhosts() {
    for (const m of this._ghostMeshes) {
      this._ghostGroup.remove(m);
    }
    this._ghostMeshes.length = 0;
  }

  _makeGhostTransparent(obj, color = 0x44ff88, opacity = 0.4) {
    obj.traverse(child => {
      if (!child.isMesh) return;
      const mat = Array.isArray(child.material) ? child.material : [child.material];
      mat.forEach(m => {
        m.transparent = true;
        m.opacity = opacity;
        m.depthWrite = false;
        if (m.emissive) {
          m.emissive.setHex(color);
          m.emissiveIntensity = 0.3;
        }
      });
    });
  }

  /** Get resolved type and rotation from track-data engine. */
  _getResolved(x, z) {
    const td = TRACK_CELLS.get(tdCellKey(x, z));
    if (td) return { model: td.type, rotation: td.rotation };
    return { model: 'straight', rotation: 0 };
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

    const { model, rotation } = this._getResolved(x, z);

    try {
      const mesh = await this._loadModel(model);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = THREE.MathUtils.degToRad(rotation);
      mesh.userData._roadCell = true;
      mesh.userData._cellKey = key;
      mesh.userData._selectionId = this.getSelectionId(key);
      cell.mesh = mesh;
      this._group.add(mesh);
    } catch (err) {
      console.warn(`[road-painter] Failed to load model '${model}':`, err);
      const geo = new THREE.PlaneGeometry(GRID_SIZE * 0.95, GRID_SIZE * 0.95);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: 0x555577 });
      const fallback = new THREE.Mesh(geo, mat);
      fallback.position.set(x, 0.02, z);
      fallback.userData._roadCell = true;
      fallback.userData._cellKey = key;
      fallback.userData._selectionId = this.getSelectionId(key);
      cell.mesh = fallback;
      this._group.add(fallback);
    }
  }
}
