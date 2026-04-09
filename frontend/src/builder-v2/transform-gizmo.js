/**
 * transform-gizmo.js - Visual move/rotate/scale handles for selected entities.
 *
 * Uses Three.js TransformControls under the hood with grid-safe snaps.
 */
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GRID_SIZE } from '../modules/track-placement.js';

export class TransformGizmo {
  /**
   * @param {THREE.Camera} camera
   * @param {HTMLElement} domElement
   * @param {import('./scene-graph.js').SceneGraph} sceneGraph
   * @param {import('./selection.js').Selection} selection
   * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} orbitControls
   * @param {(entityId: number, oldPos: object, oldRot: number, oldScale: number) => void} onTransformEnd
   */
  constructor(camera, domElement, sceneGraph, selection, orbitControls, onTransformEnd) {
    this._graph = sceneGraph;
    this._selection = selection;
    this._orbitControls = orbitControls;
    this._onTransformEnd = onTransformEnd;

    this.tc = null;
    this._camera = camera;
    this._domElement = domElement;
    this._mode = 'translate';
    this._snapOld = null;
  }

  get mode() {
    return this._mode;
  }

  init(scene, camera) {
    if (this.tc) {
      scene.remove(this.tc.getHelper());
      this.tc.dispose();
    }
    this._camera = camera;
    this.tc = new TransformControls(camera, this._domElement);
    this.tc.setSpace('world');
    this.tc.setSize(0.8);
    this.tc.setMode(this._mode);
    this._applySnaps();
    scene.add(this.tc.getHelper());

    this.tc.addEventListener('dragging-changed', (e) => {
      this._orbitControls.enabled = !e.value;
      if (!e.value) this._onDragEnd();
    });

    this.tc.addEventListener('mouseDown', () => {
      const entity = this._selection.first();
      if (entity) {
        this._snapOld = {
          position: { ...entity.position },
          rotation: entity.rotation,
          scale: entity.scale,
        };
      }
    });
  }

  setMode(mode) {
    this._mode = mode;
    if (this.tc) {
      this.tc.setMode(mode);
      this._applySnaps();
    }
  }

  attach(entity) {
    if (!this.tc || !entity?.object3D) return;
    this.tc.attach(entity.object3D);
  }

  detach() {
    if (this.tc) this.tc.detach();
  }

  updateCamera(camera) {
    this._camera = camera;
    if (this.tc) this.tc.camera = camera;
  }

  _applySnaps() {
    if (!this.tc) return;
    this.tc.setTranslationSnap(this._mode === 'translate' ? GRID_SIZE : null);
    this.tc.setRotationSnap(this._mode === 'rotate' ? Math.PI / 2 : null);
    this.tc.setScaleSnap(this._mode === 'scale' ? 0.25 : null);
  }

  _onDragEnd() {
    const entity = this._selection.first();
    if (!entity || !this._snapOld) return;

    const obj = entity.object3D;
    entity.position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    entity.rotation = Math.round((-obj.rotation.y * 180 / Math.PI + 360) % 360);
    entity.scale = obj.scale.x;

    this._onTransformEnd(
      entity.id,
      this._snapOld.position,
      this._snapOld.rotation,
      this._snapOld.scale,
    );
    this._snapOld = null;
  }

  dispose(scene) {
    if (this.tc) {
      this.tc.detach();
      scene.remove(this.tc.getHelper());
      this.tc.dispose();
      this.tc = null;
    }
  }
}
