/**
 * camera-controller.js — Orbit + ortho/perspective toggle.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_POS = new THREE.Vector3(0, 60, 80);
const ORTHO_POS   = new THREE.Vector3(0, 120, 0.01);

export class CameraController {
  constructor(canvas, renderer) {
    this._canvas = canvas;
    this._renderer = renderer;
    this._isOrtho = false;

    // Perspective camera (default)
    this.perspCam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.perspCam.position.copy(DEFAULT_POS);

    // Orthographic camera (top-down)
    this.orthoCam = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.1, 1000);
    this.orthoCam.position.copy(ORTHO_POS);

    this.camera = this.perspCam;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 0);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.update();
  }

  get isOrtho() { return this._isOrtho; }

  resize(w, h) {
    const aspect = w / h;
    this.perspCam.aspect = aspect;
    this.perspCam.updateProjectionMatrix();

    const frustum = 60;
    this.orthoCam.left   = -frustum * aspect;
    this.orthoCam.right  =  frustum * aspect;
    this.orthoCam.top    =  frustum;
    this.orthoCam.bottom = -frustum;
    this.orthoCam.updateProjectionMatrix();
  }

  toggleOrtho() {
    this._isOrtho = !this._isOrtho;
    const target = this.controls.target.clone();

    if (this._isOrtho) {
      this.camera = this.orthoCam;
      this.orthoCam.position.set(target.x, 120, target.z + 0.01);
      this.orthoCam.lookAt(target);
    } else {
      this.camera = this.perspCam;
    }

    this.controls.object = this.camera;
    this.controls.target.copy(target);
    this.controls.update();
    return this._isOrtho;
  }

  fitToExtent(min, max) {
    const cx = (min.x + max.x) / 2;
    const cz = (min.z + max.z) / 2;
    const dx = max.x - min.x;
    const dz = max.z - min.z;
    const size = Math.max(dx, dz, 40);

    this.controls.target.set(cx, 0, cz);

    if (this._isOrtho) {
      this.orthoCam.position.set(cx, 120, cz + 0.01);
    } else {
      this.perspCam.position.set(cx, size * 0.8, cz + size * 0.9);
    }
    this.controls.update();
  }

  reset() {
    this.controls.target.set(0, 0, 0);
    if (this._isOrtho) {
      this.orthoCam.position.copy(ORTHO_POS);
    } else {
      this.perspCam.position.copy(DEFAULT_POS);
    }
    this.controls.update();
  }

  update() {
    this.controls.update();
  }
}
