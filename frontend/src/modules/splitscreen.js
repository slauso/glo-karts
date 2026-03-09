/**
 * splitscreen.js — Local 2-Player vertical splitscreen rendering
 *
 * Uses Babylon.js dual FollowCameras with viewport splitting.
 * Player 1 (left half): WASD + Space(item) + Shift(brake/drift)
 * Player 2 (right half): Arrows + RCtrl(item) + RShift(brake/drift)
 *
 * Shared Havok physics scene — both karts exist in the same world.
 */

import { FollowCamera } from '@babylonjs/core/Cameras/followCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';

// ── Input maps ─────────────────────────────────────────────────

/** @returns fresh key-state object for a player */
export function createKeyState() {
  return { w: false, s: false, a: false, d: false, space: false, shift: false };
}

const P1_MAP = {
  w: 'w', a: 'a', s: 's', d: 'd',
  ' ': 'space', shift: 'shift',
};

const P2_MAP = {
  arrowup: 'w', arrowleft: 'a', arrowdown: 's', arrowright: 'd',
  control: 'space',           // Right Ctrl → item
};

/**
 * Install keyboard handlers that update two independent key-state objects.
 * Returns a dispose function to remove the listeners.
 */
export function installSplitscreenInput(keyStateP1, keyStateP2) {
  function onKey(e, value) {
    const k = e.key.toLowerCase();

    // Player 1 — WASD cluster + left Shift
    const p1Field = P1_MAP[k];
    if (p1Field && (k !== 'shift' || e.location !== 2)) {
      keyStateP1[p1Field] = value;
      e.preventDefault();
      return;
    }

    // Player 2 — Arrows + right Shift + right Ctrl
    const p2Field = P2_MAP[k];
    if (p2Field) {
      keyStateP2[p2Field] = value;
      e.preventDefault();
      return;
    }

    // Right shift for P2 brake/drift
    if (k === 'shift' && e.location === 2) {
      keyStateP2.shift = value;
      e.preventDefault();
    }
  }

  const down = (e) => onKey(e, true);
  const up   = (e) => onKey(e, false);

  document.addEventListener('keydown', down);
  document.addEventListener('keyup', up);

  return () => {
    document.removeEventListener('keydown', down);
    document.removeEventListener('keyup', up);
  };
}

// ── Dual camera setup ──────────────────────────────────────────

/**
 * Create two FollowCameras with left/right viewport split.
 * @param {BABYLON.Scene} scene
 * @returns {{ camP1: FollowCamera, camP2: FollowCamera }}
 */
export function createSplitCameras(scene) {
  const camP1 = new FollowCamera('camP1', new Vector3(0, 10, -15), scene);
  configureCam(camP1);
  camP1.viewport = new Viewport(0, 0, 0.5, 1);   // Left half

  const camP2 = new FollowCamera('camP2', new Vector3(0, 10, -15), scene);
  configureCam(camP2);
  camP2.viewport = new Viewport(0.5, 0, 0.5, 1);  // Right half

  scene.activeCameras = [camP1, camP2];
  // Clear single activeCamera so Babylon uses activeCameras array
  scene.activeCamera = null;

  return { camP1, camP2 };
}

function configureCam(cam) {
  cam.radius            = 12;
  cam.heightOffset      = 6;
  cam.rotationOffset    = 180;
  cam.cameraAcceleration = 0.04;
  cam.maxCameraSpeed    = 14;
  cam.minZ              = 0.1;
}

/**
 * Lock each camera to its respective kart mesh.
 */
export function lockCamerasToKarts(camP1, camP2, kartP1, kartP2) {
  camP1.lockedTarget = kartP1;
  camP2.lockedTarget = kartP2;
}

// ── Split HUD helpers ──────────────────────────────────────────

/**
 * Build minimal split HUD containers (speed + lap for each player).
 * Returns references for per-frame updates.
 */
export function createSplitHUD() {
  const hud = document.createElement('div');
  hud.id = 'splitscreen-hud';
  hud.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';

  const p1 = _hudSide('left', 'P1');
  const p2 = _hudSide('right', 'P2');
  hud.appendChild(p1.container);
  hud.appendChild(p2.container);
  document.body.appendChild(hud);

  return {
    updateP1(speedKPH, lap, totalLaps) { _updateSide(p1, speedKPH, lap, totalLaps); },
    updateP2(speedKPH, lap, totalLaps) { _updateSide(p2, speedKPH, lap, totalLaps); },
    dispose() { hud.remove(); },
  };
}

function _hudSide(side, label) {
  const container = document.createElement('div');
  const isLeft = side === 'left';
  container.style.cssText = `
    position:absolute; bottom:20px; ${isLeft ? 'left:5%' : 'right:5%'};
    color:#fff; font-family:'Funnel Sans',sans-serif; text-shadow:0 2px 6px rgba(0,0,0,.7);
    font-size:16px;
  `;
  const speedEl = document.createElement('div');
  speedEl.textContent = '0 KPH';
  speedEl.style.fontSize = '22px';

  const lapEl = document.createElement('div');
  lapEl.textContent = `${label} — Lap 1/3`;

  container.appendChild(speedEl);
  container.appendChild(lapEl);

  return { container, speedEl, lapEl, label };
}

function _updateSide(side, speedKPH, lap, totalLaps) {
  side.speedEl.textContent = `${Math.round(speedKPH)} KPH`;
  side.lapEl.textContent = `${side.label} — Lap ${lap}/${totalLaps}`;
}

// ── Divider line ───────────────────────────────────────────────

export function createDividerLine() {
  const div = document.createElement('div');
  div.id = 'splitscreen-divider';
  div.style.cssText = `
    position:fixed; top:0; left:50%; width:3px; height:100%;
    background:linear-gradient(180deg, rgba(255,255,255,.1), rgba(255,255,255,.6), rgba(255,255,255,.1));
    z-index:101; pointer-events:none;
  `;
  document.body.appendChild(div);
  return () => div.remove();
}
