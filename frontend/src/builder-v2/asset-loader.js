/**
 * asset-loader.js — Load + cache GLB models, auto-fit to grid cells,
 * generate thumbnail grid.
 *
 * Every loaded model is scaled per-axis so it fills exactly
 * GRID_SIZE × GRID_SIZE in XZ and centred so the bounding-box
 * midpoint sits at the local origin (grounded at Y = 0).
 * Y uses the smaller XZ scale to keep height proportional.
 * The result is wrapped in a Group so that position / rotation
 * set on the group work around the visual centre.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRID_SIZE } from '../modules/track-placement.js';

const loader = new GLTFLoader();
const cache = new Map();           // key → raw gltf.scene
const metaCache = new Map();       // key → { size, center, min, max, scaleX, scaleY, scaleZ }

/**
 * All available track piece assets.
 * Keys match the filenames without the "track-road-wide-" prefix.
 */
export const TRACK_ASSETS = [
  { key: 'straight',             file: 'track-road-wide-straight.glb',              label: 'Straight' },
  { key: 'corner-large',         file: 'track-road-wide-corner-large.glb',          label: 'Corner L' },
  { key: 'corner-small',         file: 'track-road-wide-corner-small.glb',          label: 'Corner S' },
  { key: 'corner-large-ramp',    file: 'track-road-wide-corner-large-ramp.glb',     label: 'Corner L Ramp' },
  { key: 'corner-small-ramp',    file: 'track-road-wide-corner-small-ramp.glb',     label: 'Corner S Ramp' },
  { key: 'curve',                file: 'track-road-wide-curve.glb',                 label: 'Curve' },
  { key: 'bend',                 file: 'track-road-wide-straight-bend.glb',         label: 'Bend' },
  { key: 'bend-large',           file: 'track-road-wide-straight-bend-large.glb',   label: 'Bend Large' },
  { key: 'bump-up',              file: 'track-road-wide-straight-bump-up.glb',      label: 'Bump Up' },
  { key: 'bump-down',            file: 'track-road-wide-straight-bump-down.glb',    label: 'Bump Down' },
  { key: 'hill-beginning',       file: 'track-road-wide-straight-hill-beginning.glb', label: 'Hill Start' },
  { key: 'hill-end',             file: 'track-road-wide-straight-hill-end.glb',     label: 'Hill End' },
  { key: 'hill-complete',        file: 'track-road-wide-straight-hill-complete.glb', label: 'Hill Full' },
  { key: 'hill-complete-half',   file: 'track-road-wide-straight-hill-complete-half.glb', label: 'Hill Half' },
  { key: 'skew-left',            file: 'track-road-wide-straight-skew-left.glb',    label: 'Skew Left' },
  { key: 'skew-right',           file: 'track-road-wide-straight-skew-right.glb',   label: 'Skew Right' },
  { key: 'skew-left-side',       file: 'track-road-wide-straight-skew-left-side.glb',  label: 'Skew L Side' },
  { key: 'skew-right-side',      file: 'track-road-wide-straight-skew-right-side.glb', label: 'Skew R Side' },
  { key: 'cap-front',            file: 'track-road-wide-cap-front.glb',             label: 'Cap Front' },
  { key: 'cap-back',             file: 'track-road-wide-cap-back.glb',              label: 'Cap Back' },
  { key: 'wide',                 file: 'track-road-wide.glb',                       label: 'Wide Pad' },
  { key: 'end',                  file: 'track-end.glb',                             label: 'End' },
];

/**
 * Load a GLB model by asset key.
 * Returns a Group wrapper with the clone scaled to fill GRID_SIZE
 * and centred at (0, 0, 0) (grounded at Y = 0).
 * @param {string} key
 * @returns {Promise<THREE.Group>}
 */
export async function loadModel(key) {
  const asset = TRACK_ASSETS.find(a => a.key === key);
  if (!asset) throw new Error(`Unknown asset: ${key}`);

  // ── Load + cache original + compute bbox metadata ──
  if (!cache.has(key)) {
    const gltf = await new Promise((resolve, reject) => {
      loader.load(`/models/track/${asset.file}`, resolve, undefined, reject);
    });
    const original = gltf.scene;
    cache.set(key, original);

    const bbox = new THREE.Box3().setFromObject(original);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    bbox.getSize(size);
    bbox.getCenter(center);
    const scaleX = GRID_SIZE / (size.x || 1);
    const scaleZ = GRID_SIZE / (size.z || 1);
    const scaleY = Math.min(scaleX, scaleZ); // keep height proportional
    metaCache.set(key, {
      size, center,
      min: bbox.min.clone(),
      max: bbox.max.clone(),
      scaleX, scaleY, scaleZ,
    });
  }

  // ── Clone + shadow setup ──
  const original = cache.get(key);
  const clone = original.clone();
  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  // ── Auto-fit: scale + centre inside a wrapper Group ──
  const meta = metaCache.get(key);
  const wrapper = new THREE.Group();
  wrapper.name = key;

  clone.scale.set(meta.scaleX, meta.scaleY, meta.scaleZ);
  clone.position.set(
    -meta.center.x * meta.scaleX,
    -meta.min.y * meta.scaleY,       // ground at y = 0
    -meta.center.z * meta.scaleZ,
  );
  wrapper.add(clone);

  return wrapper;
}

/**
 * Get the cached bounding-box metadata for an asset.
 * @param {string} key
 * @returns {{ size: THREE.Vector3, center: THREE.Vector3, min: THREE.Vector3, max: THREE.Vector3, scaleX: number, scaleY: number, scaleZ: number } | null}
 */
export function getModelMeta(key) {
  return metaCache.get(key) || null;
}

/**
 * Preload all track assets into cache.
 * @param {(loaded: number, total: number) => void} [onProgress]
 */
export async function preloadAll(onProgress) {
  const total = TRACK_ASSETS.length;
  let loaded = 0;
  const promises = TRACK_ASSETS.map(async (asset) => {
    try {
      if (!cache.has(asset.key)) {
        const gltf = await new Promise((resolve, reject) => {
          loader.load(`/models/track/${asset.file}`, resolve, undefined, reject);
        });
        const original = gltf.scene;
        cache.set(asset.key, original);

        // Compute bbox metadata
        const bbox = new THREE.Box3().setFromObject(original);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        bbox.getSize(size);
        bbox.getCenter(center);
        const scaleX = GRID_SIZE / (size.x || 1);
        const scaleZ = GRID_SIZE / (size.z || 1);
        const scaleY = Math.min(scaleX, scaleZ);
        metaCache.set(asset.key, {
          size, center,
          min: bbox.min.clone(),
          max: bbox.max.clone(),
          scaleX, scaleY, scaleZ,
        });
      }
    } catch (err) {
      console.warn(`[asset-loader] Failed to load ${asset.file}:`, err);
    }
    loaded++;
    onProgress?.(loaded, total);
  });
  await Promise.all(promises);
}

/**
 * Generate a thumbnail for an asset by rendering it to a small canvas.
 * @param {string} key
 * @param {number} [size=80]
 * @returns {Promise<string>} data URL
 */
export async function generateThumbnail(key, size = 80) {
  const model = await loadModel(key);

  const thumbScene = new THREE.Scene();
  thumbScene.background = new THREE.Color(0x1e1e34);
  thumbScene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(3, 5, 3);
  thumbScene.add(light);
  thumbScene.add(model);

  // Center and fit model
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  const boxSize = box.getSize(new THREE.Vector3());
  model.position.sub(center);

  const maxDim = Math.max(boxSize.x, boxSize.y, boxSize.z) || 1;
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  cam.position.set(maxDim * 0.9, maxDim * 0.7, maxDim * 0.9);
  cam.lookAt(0, 0, 0);

  const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  thumbRenderer.setSize(size, size);
  thumbRenderer.render(thumbScene, cam);

  const dataUrl = thumbRenderer.domElement.toDataURL();
  thumbRenderer.dispose();

  // Cleanup
  model.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });

  return dataUrl;
}
