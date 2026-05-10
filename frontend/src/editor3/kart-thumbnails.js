/**
 * kart-thumbnails.js — One-shot 3D thumbnail renderer for kart cards.
 *
 * Strategy:
 *   - One shared offscreen WebGLRenderer (small, ~160×120) that we reuse
 *     for every kart so we don't pay per-kart context creation.
 *   - Single shared Scene + Camera + lights; we add the kart, render to
 *     a data URL, then remove and dispose the kart clone.
 *   - Results are cached as data URLs in a Map so re-opening the panel
 *     is instant.
 *   - Renders are queued so we never block the main thread doing all
 *     ~30 karts at once; one kart per animation frame.
 *
 * Coordinate convention (mirrors editor preview): kart Group is
 * normalized to ~2 m long, faces -Z, sits on y=0. We frame from a low
 * 3/4 angle that flatters most kart silhouettes.
 */
import * as THREE from 'three';
import { cloneKart } from './kart-loader.js';
import { KARTS } from './kart-catalog.js';

const THUMB_W = 160;
const THUMB_H = 120;

/** @type {Map<string, string>} dataURL cache, keyed by kart id. */
const _cache = new Map();
/** @type {Map<string, Array<(url: string) => void>>} per-id subscriber queues. */
const _waiters = new Map();
/** @type {string[]} FIFO of kart ids awaiting their render slot. */
const _queue = [];
let _draining = false;

let _renderer = null;
let _scene = null;
let _camera = null;

function _ensureRig() {
  if (_renderer) return;
  _renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true, // required for toDataURL after render
  });
  _renderer.setPixelRatio(window.devicePixelRatio || 1);
  _renderer.setSize(THUMB_W, THUMB_H, false);
  _renderer.setClearColor(0x000000, 0);
  _renderer.outputColorSpace = THREE.SRGBColorSpace;

  _scene = new THREE.Scene();

  // Soft hemisphere fill + a single key light from camera-front-right.
  const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.0);
  _scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(2, 3, 2);
  _scene.add(key);

  // 3/4 view looking down at a 2-m kart sitting on y=0.
  // Kart faces -Z, so place camera at +X / +Y / +Z looking back at origin.
  _camera = new THREE.PerspectiveCamera(28, THUMB_W / THUMB_H, 100, 50000);
  _camera.position.set(2400, 1500, 2800);
  _camera.lookAt(0, 400, 0);
}

/**
 * Request one kart thumbnail. Resolves to a PNG data URL (or '' on
 * failure). Renders are serialized at most one per animation frame so
 * we never jam the main thread, even when 30+ cards request at once.
 * @param {string} kartId
 * @returns {Promise<string>}
 */
export function renderKartThumbnail(kartId) {
  if (_cache.has(kartId)) return Promise.resolve(_cache.get(kartId));
  return new Promise((resolve) => {
    const list = _waiters.get(kartId);
    if (list) {
      list.push(resolve);
      return;
    }
    _waiters.set(kartId, [resolve]);
    _queue.push(kartId);
    _drain();
  });
}

function _drain() {
  if (_draining) return;
  _draining = true;
  const tick = async () => {
    const id = _queue.shift();
    if (!id) { _draining = false; return; }
    let url = '';
    try {
      url = await _renderOne(id);
    } catch (err) {
      console.warn(`[kart-thumbnails] render failed for ${id}:`, err);
    }
    _cache.set(id, url);
    const waiters = _waiters.get(id) || [];
    _waiters.delete(id);
    for (const w of waiters) w(url);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function _renderOne(kartId) {
  _ensureRig();
  const model = await cloneKart(kartId);
  _scene.add(model);
  try {
    _renderer.render(_scene, _camera);
    return _renderer.domElement.toDataURL('image/png');
  } finally {
    _scene.remove(model);
    model.traverse((c) => {
      if (c.isMesh && c.geometry) c.geometry.dispose?.();
      // Materials are shared with the loader template — leave them.
    });
  }
}

/**
 * Optionally pre-warm the cache for every kart. Honours the same
 * one-per-frame queue so it never blocks the editor.
 */
export function prerenderAllKarts() {
  for (const k of KARTS) renderKartThumbnail(k.id);
}
