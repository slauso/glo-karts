/**
 * soccer.js — Soccer / Football game mode logic.
 *
 * Rules:
 *  - Two teams (Red vs Blue).  Player is always on the Red team.
 *  - A physics ball (Havok sphere) spawns at centre field.
 *  - Two goal trigger volumes at each end of the arena.
 *  - When the ball enters a goal, the opposing team scores.
 *  - First to SCORE_LIMIT goals wins, or highest score after TIME_LIMIT.
 *
 * Integration:
 *   import { initSoccer, updateSoccer, isSoccerActive, getSoccerScore,
 *            disposeSoccer } from './modes/soccer.js';
 *   // In init():  initSoccer(scene, havokPlugin);
 *   // In loop:    updateSoccer(dt);
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';

// ── Config ──────────────────────────────────────────────────────────────────
const TIME_LIMIT = 180;       // 3-minute matches
const SCORE_LIMIT = 5;        // first to 5 goals
const BALL_RADIUS = 1.2;
const BALL_MASS = 2;
const BALL_RESTITUTION = 0.8;
const GOAL_WIDTH = 12;
const GOAL_HEIGHT = 5;
const FIELD_HALF_LENGTH = 40; // goals placed at ±FIELD_HALF_LENGTH
const RESET_DELAY = 2;        // seconds pause after a goal

// ── State ───────────────────────────────────────────────────────────────────
let _active = false;
let _score = { red: 0, blue: 0 };
let _elapsed = 0;
let _resetTimer = 0;
let _ballMesh = null;
let _ballAggregate = null;
let _goalMeshes = { red: null, blue: null };
let _scene = null;
let _hudEl = null;
let _timerEl = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Set up the soccer field, ball, and goals.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function initSoccer(scene) {
  _scene = scene;
  _active = true;
  _score = { red: 0, blue: 0 };
  _elapsed = 0;
  _resetTimer = 0;

  // ── Ball ────────────────────────────────────────────────────
  _ballMesh = MeshBuilder.CreateSphere('soccerBall', { diameter: BALL_RADIUS * 2, segments: 16 }, scene);
  _ballMesh.position = new Vector3(0, BALL_RADIUS + 1, 0);
  const ballMat = new StandardMaterial('ballMat', scene);
  ballMat.diffuseColor = new Color3(1, 1, 1);
  ballMat.specularColor = new Color3(0.4, 0.4, 0.4);
  _ballMesh.material = ballMat;

  try {
    _ballAggregate = new PhysicsAggregate(
      _ballMesh, PhysicsShapeType.SPHERE, {
        mass: BALL_MASS,
        restitution: BALL_RESTITUTION,
        friction: 0.5,
      }, scene,
    );
  } catch (e) {
    console.warn('Soccer ball physics init failed (Havok may not be ready):', e.message);
  }

  // ── Goals (trigger volumes — visual-only) ──────────────────
  _goalMeshes.red = _createGoal(scene, new Vector3(0, GOAL_HEIGHT / 2, -FIELD_HALF_LENGTH), new Color3(1, 0.2, 0.2));
  _goalMeshes.blue = _createGoal(scene, new Vector3(0, GOAL_HEIGHT / 2, FIELD_HALF_LENGTH), new Color3(0.2, 0.4, 1));

  // ── HUD ────────────────────────────────────────────────────
  _hudEl = document.createElement('div');
  _hudEl.id = 'soccer-hud';
  _hudEl.style.cssText = `
    position:fixed; top:10px; left:50%; transform:translateX(-50%);
    color:#fff; font-family:'Poppins',sans-serif; font-size:22px;
    background:rgba(0,0,0,.6); padding:8px 24px; border-radius:10px;
    z-index:160; pointer-events:none; text-align:center;
  `;
  _timerEl = document.createElement('div');
  _timerEl.style.fontSize = '14px';
  _hudEl.appendChild(_timerEl);
  document.body.appendChild(_hudEl);
  _updateHUD();
}

/**
 * Tick soccer logic each frame.
 * @param {number} dt
 * @returns {{ goal: 'red'|'blue'|null, finished: boolean, winner: 'red'|'blue'|'draw'|null }}
 */
export function updateSoccer(dt) {
  if (!_active) return { goal: null, finished: true, winner: _winner() };

  // In reset pause after a goal
  if (_resetTimer > 0) {
    _resetTimer -= dt;
    if (_resetTimer <= 0) _resetBall();
    return { goal: null, finished: false, winner: null };
  }

  _elapsed += dt;

  // Check ball vs goal triggers
  let scored = null;
  if (_ballMesh) {
    const bz = _ballMesh.position.z;
    if (bz < -FIELD_HALF_LENGTH + 1) { scored = 'blue'; _score.blue++; }
    else if (bz > FIELD_HALF_LENGTH - 1) { scored = 'red'; _score.red++; }
  }

  if (scored) {
    _resetTimer = RESET_DELAY;
    _updateHUD();

    // Win by score limit
    if (_score.red >= SCORE_LIMIT || _score.blue >= SCORE_LIMIT) {
      _active = false;
      return { goal: scored, finished: true, winner: _winner() };
    }
    return { goal: scored, finished: false, winner: null };
  }

  // Time limit
  if (_elapsed >= TIME_LIMIT) {
    _active = false;
    return { goal: null, finished: true, winner: _winner() };
  }

  _updateHUD();
  return { goal: null, finished: false, winner: null };
}

export function isSoccerActive() { return _active; }

export function getSoccerScore() {
  return { ..._score, elapsed: _elapsed, remaining: Math.max(TIME_LIMIT - _elapsed, 0) };
}

export function disposeSoccer() {
  _active = false;
  if (_ballAggregate) { _ballAggregate.dispose(); _ballAggregate = null; }
  if (_ballMesh) { _ballMesh.dispose(); _ballMesh = null; }
  if (_goalMeshes.red) { _goalMeshes.red.dispose(); _goalMeshes.red = null; }
  if (_goalMeshes.blue) { _goalMeshes.blue.dispose(); _goalMeshes.blue = null; }
  if (_hudEl) { _hudEl.remove(); _hudEl = null; }
  _scene = null;
}

/** Get the ball mesh (e.g. for bot targeting). */
export function getBallMesh() { return _ballMesh; }

// ── Internals ───────────────────────────────────────────────────────────────

function _createGoal(scene, position, color) {
  const goal = MeshBuilder.CreateBox('goal', { width: GOAL_WIDTH, height: GOAL_HEIGHT, depth: 0.5 }, scene);
  goal.position = position;
  const mat = new StandardMaterial('goalMat', scene);
  mat.diffuseColor = color;
  mat.alpha = 0.4;
  goal.material = mat;
  goal.isPickable = false;
  return goal;
}

function _resetBall() {
  if (!_ballMesh) return;
  _ballMesh.position.set(0, BALL_RADIUS + 1, 0);
  if (_ballAggregate?.body) {
    _ballAggregate.body.setLinearVelocity(Vector3.Zero());
    _ballAggregate.body.setAngularVelocity(Vector3.Zero());
  }
}

function _winner() {
  if (_score.red > _score.blue) return 'red';
  if (_score.blue > _score.red) return 'blue';
  return 'draw';
}

function _updateHUD() {
  if (!_hudEl) return;
  const remaining = Math.max(TIME_LIMIT - _elapsed, 0);
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(Math.floor(remaining % 60)).padStart(2, '0');
  _hudEl.innerHTML = `<span style="color:#ff6666">RED ${_score.red}</span>` +
    ` — <span style="color:#6688ff">BLUE ${_score.blue}</span>`;
  _timerEl.textContent = `${mm}:${ss}`;
  _hudEl.appendChild(_timerEl);
}
