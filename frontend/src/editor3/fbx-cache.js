/**
 * fbx-cache.js — async loader + clone cache for FBX assets.
 *
 * Mirrors glb-cache.js so large FBX vehicle props from /public/v8 assets
 * can be dropped as lightweight cloned instances.
 */

import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const _loader = new FBXLoader();
const _cache = new Map();
const _pending = new Map();
const _listeners = new Set();

function encPath(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

export function onFbxLoaded(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function loadFBX(path) {
  if (_cache.has(path)) return Promise.resolve(_cache.get(path));
  if (_pending.has(path)) return _pending.get(path);

  const safePath = encPath(path);
  const p = new Promise((resolve, reject) => {
    _loader.load(
      safePath,
      (root) => {
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        _cache.set(path, root);
        _pending.delete(path);
        for (const fn of _listeners) {
          try { fn(path, root); } catch (e) { console.warn(e); }
        }
        resolve(root);
      },
      undefined,
      (err) => {
        _pending.delete(path);
        console.warn('[fbx] failed', path, err);
        reject(err);
      },
    );
  });

  _pending.set(path, p);
  return p;
}

export function instanceFBX(path) {
  const cached = _cache.get(path);
  if (!cached) return null;
  return cloneSkinned(cached);
}
