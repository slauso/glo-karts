/**
 * Lobby Track Preview — renders a slowly rotating 3D track inside #track-preview-container.
 * Listens for 'mapChanged' custom events dispatched by lobby.js.
 * Mirrors the design pattern of lobby-car.js (KartPreview).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveTrackAsset, resolveArenaAsset } from './modules/content-registry.js';

class TrackPreview {
  constructor() {
    this.container = document.getElementById('track-preview-container');
    if (!this.container) return;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.trackModel = null;
    this.rotationAngle = 0;
    this.loader = new GLTFLoader();
    this.pendingLoad = null;

    this._init();
    this._listen();
    this._animate();
  }

  _init() {
    this.scene = new THREE.Scene();

    // Soft multi-source lighting for track visibility
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(5, 8, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xeef0ff, 0.35);
    fill.position.set(-4, 3, -5);
    this.scene.add(fill);

    const w = this.container.clientWidth || 300;
    const h = this.container.clientHeight || 220;
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 5000);
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this._onResize());

    // Load default track
    this._loadTrack('map1');
  }

  /** Listen for track/arena selection events from lobby.js */
  _listen() {
    window.addEventListener('mapChanged', (e) => {
      const { mapId, kind } = e.detail || {};
      if (!mapId) return;
      if (kind === 'arena') {
        this._loadArena(mapId);
      } else {
        this._loadTrack(mapId);
      }
    });
  }

  _loadTrack(mapId) {
    const asset = resolveTrackAsset(mapId);
    if (!asset || !asset.trackPath) return;
    this.loadModel(asset.trackPath, asset.scale || 1);
  }

  _loadArena(arenaId) {
    const asset = resolveArenaAsset(arenaId);
    if (!asset) return;
    // Built-in procedural arenas have no GLB — show placeholder
    if (asset.type === 'procedural' || !asset.arenaPath) {
      this._showPlaceholder();
      return;
    }
    this.loadModel(asset.arenaPath, asset.scale || 1);
  }

  _showPlaceholder() {
    // Remove existing model and show the placeholder text
    if (this.trackModel) {
      this.scene.remove(this.trackModel);
      this.trackModel.traverse(c => {
        if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
      });
      this.trackModel = null;
    }
    const placeholder = this.container.querySelector('.preview-placeholder');
    if (placeholder) placeholder.style.display = 'flex';
  }

  loadModel(url, scale = 1) {
    // Cancel previous pending load
    if (this.pendingLoad) { this.pendingLoad.abort = true; }
    const token = { abort: false };
    this.pendingLoad = token;

    // Show loading state
    const placeholder = this.container.querySelector('.preview-placeholder');
    if (placeholder) placeholder.style.display = 'flex';

    this.loader.load(url, (gltf) => {
      if (token.abort) return; // superseded by newer load

      // Remove old model
      if (this.trackModel) {
        this.scene.remove(this.trackModel);
        this.trackModel.traverse(c => {
          if (c.isMesh) { c.geometry?.dispose(); c.material?.dispose(); }
        });
      }

      // Hide placeholder
      if (placeholder) placeholder.style.display = 'none';

      this.trackModel = gltf.scene;
      this.trackModel.scale.setScalar(scale);

      // Auto-frame: measure model and adjust camera so it fits
      const box = new THREE.Box3().setFromObject(this.trackModel);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Centre model at origin
      this.trackModel.position.sub(center);

      // Fit camera: use the largest horizontal dimension
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = this.camera.fov * (Math.PI / 180);
      const fitDist = (maxDim / 2) / Math.tan(fov / 2) * 1.3; // 1.3x padding for tracks

      // Elevated isometric-ish view
      const dist = Math.max(fitDist, 5);
      this.camera.position.set(0, dist * 0.6, dist * 0.8);
      this.camera.lookAt(0, 0, 0);

      this.rotationAngle = 0;
      this.scene.add(this.trackModel);
    }, undefined, (err) => {
      if (!token.abort) {
        console.warn('[TrackPreview] load error', url, err);
        if (placeholder) placeholder.style.display = 'flex';
      }
    });
  }

  _onResize() {
    if (!this.container || !this.camera || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (this.trackModel) {
      this.rotationAngle += 0.003; // Slow rotation — tracks are large
      this.trackModel.rotation.y = this.rotationAngle;
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}

// Initialise when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new TrackPreview());
} else {
  new TrackPreview();
}

export default TrackPreview;
