/**
 * camera-controller.js - Tinkercad-style orbit camera with named view presets.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_POS = new THREE.Vector3(0, 60, 80);
const ORTHO_POS = new THREE.Vector3(0, 120, 0.01);
const DEFAULT_BOUNDS = Object.freeze({
  min: { x: -50, z: -50 },
  max: { x: 50, z: 50 },
});

export class CameraController {
  constructor(canvas, renderer) {
    this._canvas = canvas;
    this._renderer = renderer;
    this._isOrtho = false;

    this.perspCam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.perspCam.position.copy(DEFAULT_POS);
    this.perspCam.up.set(0, 1, 0);

    this.orthoCam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    this.orthoCam.position.copy(ORTHO_POS);
    this.orthoCam.up.set(0, 0, -1);

    this.camera = this.perspCam;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = {
      LEFT: -1,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.update();
  }

  get isOrtho() {
    return this._isOrtho;
  }

  resize(w, h) {
    const aspect = w / h;
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();

    const frustum = 60;
    this.orthoCam.left = -frustum * aspect;
    this.orthoCam.right = frustum * aspect;
    this.orthoCam.top = frustum;
    this.orthoCam.bottom = -frustum;
    this.orthoCam.updateProjectionMatrix();
  }

  setProjection(nextIsOrtho) {
    this._isOrtho = Boolean(nextIsOrtho);
    const target = this.controls.target.clone();

    if (this._isOrtho) {
      this.camera = this.orthoCam;
      this.orthoCam.position.set(target.x, 120, target.z + 0.01);
      this.orthoCam.up.set(0, 0, -1);
      this.orthoCam.lookAt(target);
    } else {
      this.camera = this.perspCam;
      this.perspCam.up.set(0, 1, 0);
    }

    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
    return this._isOrtho;
  }

  toggleOrtho() {
    return this.setProjection(!this._isOrtho);
  }

  fitToExtent(min, max) {
    const values = [min?.x, min?.z, max?.x, max?.z];
    if (values.some((value) => !Number.isFinite(value))) {
      this.reset();
      return;
    }

    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const dx = max.x - min.x;
    const dz = max.z - min.z;
    const size = Math.max(dx, dz, 40);

    this.controls.target.set(cx, 0, cz);

    if (this._isOrtho) {
      this.orthoCam.position.set(cx, 120, cz + 0.01);
      this.orthoCam.up.set(0, 0, -1);
    } else {
      this.perspCam.position.set(cx, size * 0.8, cz + size * 0.9);
      this.perspCam.up.set(0, 1, 0);
    }
    this.controls.update();
  }

  setView(view = 'home', bounds = DEFAULT_BOUNDS) {
    const minX = Number.isFinite(bounds?.min?.x) ? bounds.min.x : DEFAULT_BOUNDS.min.x;
    const maxX = Number.isFinite(bounds?.max?.x) ? bounds.max.x : DEFAULT_BOUNDS.max.x;
    const minZ = Number.isFinite(bounds?.min?.z) ? bounds.min.z : DEFAULT_BOUNDS.min.z;
    const maxZ = Number.isFinite(bounds?.max?.z) ? bounds.max.z : DEFAULT_BOUNDS.max.z;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const dx = maxX - minX;
    const dz = maxZ - minZ;
    const span = Math.max(dx, dz, 40);
    const lift = Math.max(26, span * 0.55);
    const distance = Math.max(52, span * 1.15);

    this.controls.target.set(cx, 0, cz);

    switch (view) {
      case 'top':
        this.setProjection(true);
        this.orthoCam.position.set(cx, Math.max(90, span * 2.1), cz + 0.01);
        this.orthoCam.up.set(0, 0, -1);
        this.orthoCam.lookAt(this.controls.target);
        break;
      case 'front':
        this.setProjection(false);
        this.perspCam.position.set(cx, lift, cz + distance);
        this.perspCam.up.set(0, 1, 0);
        this.perspCam.lookAt(this.controls.target);
        break;
      case 'back':
        this.setProjection(false);
        this.perspCam.position.set(cx, lift, cz - distance);
        this.perspCam.up.set(0, 1, 0);
        this.perspCam.lookAt(this.controls.target);
        break;
      case 'left':
        this.setProjection(false);
        this.perspCam.position.set(cx - distance, lift, cz);
        this.perspCam.up.set(0, 1, 0);
        this.perspCam.lookAt(this.controls.target);
        break;
      case 'right':
        this.setProjection(false);
        this.perspCam.position.set(cx + distance, lift, cz);
        this.perspCam.up.set(0, 1, 0);
        this.perspCam.lookAt(this.controls.target);
        break;
      case 'home':
      default:
        this.setProjection(false);
        this.perspCam.position.set(cx + span * 0.65, Math.max(42, span * 0.85), cz + span * 0.75);
        this.perspCam.up.set(0, 1, 0);
        this.perspCam.lookAt(this.controls.target);
        break;
    }

    this.controls.update();
    return this._isOrtho;
  }

  reset() {
    this.controls.target.set(0, 0, 0);
    if (this._isOrtho) {
      this.orthoCam.position.copy(ORTHO_POS);
      this.orthoCam.up.set(0, 0, -1);
    } else {
      this.perspCam.position.copy(DEFAULT_POS);
      this.perspCam.up.set(0, 1, 0);
    }
    this.controls.update();
  }

  update() {
    this.controls.update();
  }
}
