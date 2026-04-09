/**
 * ghost-recorder.js — Ghost recording & playback for Time Trial mode.
 *
 * Records the player kart's position + rotation at 10 Hz during a Time Trial,
 * stores the best ghost per track in localStorage, and renders a
 * semi-transparent "ghost kart" during subsequent runs.
 *
 * Usage:
 *   import { startRecording, recordFrame, stopRecording,
 *            loadGhost, spawnGhostKart, updateGhostPlayback,
 *            disposeGhost } from './ghost-recorder.js';
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';

// ── Constants ───────────────────────────────────────────────────────────────
const RECORD_HZ = 10;               // samples per second
const RECORD_INTERVAL = 1 / RECORD_HZ;
const STORAGE_PREFIX = 'ghost_';
const MAX_GHOST_BYTES = 512_000;     // 512 KB cap per ghost

// ── Internal state ──────────────────────────────────────────────────────────
let _recording = false;
let _frames = [];            // { t, px, py, pz, qx, qy, qz, qw }
let _accumulator = 0;
let _startTime = 0;
let _trackId = '';

// Playback state
let _ghostFrames = null;
let _ghostMesh = null;
let _ghostTime = 0;

// ── Recording API ───────────────────────────────────────────────────────────

/** Begin recording ghost frames for a given track. */
export function startRecording(trackId) {
  _recording = true;
  _frames = [];
  _accumulator = 0;
  _startTime = performance.now();
  _trackId = trackId || 'test_box';
}

/**
 * Call every frame with the kart mesh.  Internally down-samples to 10 Hz.
 * @param {number} dt - delta time in seconds
 * @param {import('@babylonjs/core').AbstractMesh} kartMesh
 */
export function recordFrame(dt, kartMesh) {
  if (!_recording || !kartMesh) return;
  _accumulator += dt;
  if (_accumulator < RECORD_INTERVAL) return;
  _accumulator -= RECORD_INTERVAL;

  const p = kartMesh.position;
  const q = kartMesh.rotationQuaternion || Quaternion.Identity();
  _frames.push({
    t: (performance.now() - _startTime) / 1000,
    px: p.x, py: p.y, pz: p.z,
    qx: q.x, qy: q.y, qz: q.z, qw: q.w,
  });
}

/**
 * Stop recording and, if the run is a new personal best, persist to localStorage.
 * @param {number} finishTimeSeconds - the total race time
 * @returns {{ saved: boolean, frames: number }}
 */
export function stopRecording(finishTimeSeconds) {
  _recording = false;
  if (_frames.length === 0) return { saved: false, frames: 0 };

  const key = STORAGE_PREFIX + _trackId;
  const payload = { time: finishTimeSeconds, frames: _frames };
  const json = JSON.stringify(payload);

  // Only save if under size cap
  if (json.length > MAX_GHOST_BYTES) {
    console.warn(`Ghost data too large (${json.length} bytes), not saving.`);
    return { saved: false, frames: _frames.length };
  }

  // Check personal best
  try {
    const existing = localStorage.getItem(key);
    if (existing) {
      const prev = JSON.parse(existing);
      if (prev.time <= finishTimeSeconds) {
        return { saved: false, frames: _frames.length };
      }
    }
    localStorage.setItem(key, json);
  } catch (e) {
    console.warn('Ghost save failed:', e);
    return { saved: false, frames: _frames.length };
  }
  return { saved: true, frames: _frames.length };
}

// ── Playback API ────────────────────────────────────────────────────────────

/**
 * Load the saved ghost for a track from localStorage.
 * @param {string} trackId
 * @returns {{ time: number, frames: Array } | null}
 */
export function loadGhost(trackId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + (trackId || 'test_box'));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Spawn a semi-transparent box mesh to represent the ghost kart.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Array} frames - ghost frame array from loadGhost()
 * @returns {import('@babylonjs/core').Mesh}
 */
export function spawnGhostKart(scene, frames) {
  if (_ghostMesh) _ghostMesh.dispose();
  _ghostFrames = frames;
  _ghostTime = 0;

  const mesh = MeshBuilder.CreateBox('ghostKart', { width: 2, height: 1, depth: 3.5 }, scene);
  const mat = new StandardMaterial('ghostMat', scene);
  mat.diffuseColor = new Color3(0.3, 0.7, 1);
  mat.alpha = 0.35;
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.isPickable = false;

  // Apply first frame position
  if (frames.length > 0) {
    const f = frames[0];
    mesh.position.set(f.px, f.py, f.pz);
    mesh.rotationQuaternion = new Quaternion(f.qx, f.qy, f.qz, f.qw);
  }

  _ghostMesh = mesh;
  return mesh;
}

/**
 * Advance ghost playback.  Call every frame.
 * @param {number} dt - delta time in seconds
 */
export function updateGhostPlayback(dt) {
  if (!_ghostFrames || !_ghostMesh) return;
  _ghostTime += dt;

  // Find the two frames bounding _ghostTime for interpolation
  let i = 0;
  while (i < _ghostFrames.length - 1 && _ghostFrames[i + 1].t < _ghostTime) i++;

  if (i >= _ghostFrames.length - 1) {
    // Ghost finished — hide it
    _ghostMesh.isVisible = false;
    return;
  }

  const a = _ghostFrames[i];
  const b = _ghostFrames[i + 1];
  const span = b.t - a.t;
  const alpha = span > 0 ? Math.min((_ghostTime - a.t) / span, 1) : 0;

  // Lerp position
  _ghostMesh.position.set(
    a.px + (b.px - a.px) * alpha,
    a.py + (b.py - a.py) * alpha,
    a.pz + (b.pz - a.pz) * alpha,
  );

  // Slerp rotation
  const qA = new Quaternion(a.qx, a.qy, a.qz, a.qw);
  const qB = new Quaternion(b.qx, b.qy, b.qz, b.qw);
  _ghostMesh.rotationQuaternion = Quaternion.Slerp(qA, qB, alpha);
  _ghostMesh.isVisible = true;
}

/** Clean up ghost mesh and internal state. */
export function disposeGhost() {
  if (_ghostMesh) {
    _ghostMesh.dispose();
    _ghostMesh = null;
  }
  _ghostFrames = null;
  _ghostTime = 0;
  _frames = [];
  _recording = false;
}

/** Check whether a ghost exists for a given track. */
export function hasGhostFor(trackId) {
  return localStorage.getItem(STORAGE_PREFIX + (trackId || 'test_box')) !== null;
}

/** Delete the saved ghost for a track. */
export function clearGhost(trackId) {
  localStorage.removeItem(STORAGE_PREFIX + (trackId || 'test_box'));
}
