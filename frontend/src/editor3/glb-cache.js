/**
 * glb-cache.js — small async loader + clone cache for GLB props.
 *
 * Used by decor.js to expose Kenney CC0 racing-kit assets (vehicles,
 * decoration scenes, track props) as instanceable decor pieces inside
 * the editor. GLBs are loaded once, the parsed scene is kept in memory,
 * and each instance is a `clone(true)` of that scene (geometries +
 * materials are SHARED via the clone's references — only the Object3D
 * graph is duplicated, so 100 trucks cost ~1 truck of GPU memory).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const _loader = new GLTFLoader();
const _cache = new Map();    // path -> THREE.Group (parsed scene root)
const _pending = new Map();  // path -> Promise<Group>
const _listeners = new Set();

export function onGlbLoaded(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

export function loadGLB(path) {
  if (_cache.has(path)) return Promise.resolve(_cache.get(path));
  if (_pending.has(path)) return _pending.get(path);
  const p = new Promise((resolve, reject) => {
    _loader.load(
      path,
      (gltf) => {
        const root = gltf.scene || gltf.scenes[0];
        // Normalise: enable shadows so the asset matches our editor lighting.
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        _cache.set(path, root);
        _pending.delete(path);
        for (const fn of _listeners) { try { fn(path, root); } catch (e) { console.warn(e); } }
        resolve(root);
      },
      undefined,
      (err) => {
        _pending.delete(path);
        console.warn('[glb] failed', path, err);
        reject(err);
      },
    );
  });
  _pending.set(path, p);
  return p;
}

export function getGLB(path) { return _cache.get(path) || null; }

export function preloadGLBs(paths) {
  return Promise.allSettled(paths.map(loadGLB));
}

/**
 * Build an instance Object3D for the cached GLB at `path`. Returns null
 * if the GLB has not been loaded yet — callers should fall back to a
 * placeholder mesh and re-create once `onGlbLoaded` fires.
 */
export function instanceGLB(path) {
  const cached = _cache.get(path);
  if (!cached) return null;
  return cached.clone(true);
}
