/**
 * transform-gizmo.js — Visual move/rotate/scale handles for selected entities.
 *
 * Uses Three.js TransformControls under the hood.
 */
import { TransformControls } from 'three/addons/controls/TransformControls.js';

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

    /** @type {TransformControls|null} */
    this.tc = null;
    this._camera = camera;
    this._domElement = domElement;
    this._mode = 'translate'; // translate | rotate | scale
    this._snapOld = null;
  }

  get mode() { return this._mode; }

  /** Re-initialize with a (possibly new) camera. */
  init(scene, camera) {
    if (this.tc) {
      scene.remove(this.tc.getHelper());
      this.tc.dispose();
    }
    this._camera = camera;
    this.tc = new TransformControls(camera, this._domElement);
    this.tc.setMode(this._mode);
    this.tc.setSpace('world');
    this.tc.setSize(0.8);
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
    if (this.tc) this.tc.setMode(mode);
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

  _onDragEnd() {
    const entity = this._selection.first();
    if (!entity || !this._snapOld) return;

    // Sync entity data from Object3D
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
