/**
 * splitscreen-main.js — Entry point for local 2-player vertical splitscreen.
 *
 * Two karts, two FollowCameras (left/right viewports), shared Havok physics.
 * P1: WASD + left-Shift(brake/drift) + Space(item)
 * P2: Arrows + right-Shift(brake/drift) + right-Ctrl(item)
 */

// ── Core imports ────────────────────────────────────────────────────────────
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/loaders/glTF";
import "./style.css";

// ── Engine / modules ────────────────────────────────────────────────────────
import { initBabylonRenderer } from './modules/babylon-renderer.js';
import { createVehicle, resetCarPosition } from './modules/babylon-car.js';
import { loadTrackModel } from './modules/babylon-track.js';
import { applyStartPosition } from './modules/track-data.js';
import { applyKartDriving, createDriftState, FIXED_PHYSICS_STEP } from './modules/kart-physics.js';
import { initPhysics } from './modules/physics.js';
import { initParticles, updateParticles } from './modules/babylon-particles.js';
import {
  playTrackMusic, playSFX, playCountdownSequence,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playPreRaceMusic, disposeAudio,
} from './modules/game-audio.js';
import { loadTrackData } from './modules/track-data-loader.js';
import {
  initCheckpoints,
  updateCheckpoints,
  getCurrentQuadCenter,
  getCurrentQuadHeading,
} from './modules/checkpoints.js';
import { loadGates, checkGateProximity, updateGateFading, showFinishMessage } from './modules/gates.js';

// ── Splitscreen helpers ─────────────────────────────────────────────────────
import {
  createKeyState,
  installSplitscreenInput,
  createSplitCameras,
  lockCamerasToKarts,
  createSplitHUD,
  createDividerLine,
} from './modules/splitscreen.js';

// ── Config from lobby ───────────────────────────────────────────────────────
let gameConfig = null;
try {
  const raw = sessionStorage.getItem('gameConfig');
  if (raw) gameConfig = JSON.parse(raw);
} catch (_) { /* no config */ }

const mapToLoad = gameConfig?.trackId || gameConfig?.arenaId || 'test_box';

// Detect splitscreen battle mode
const isBattleMode = gameConfig?.gameMode === 'splitscreen_battle';

// ── State ───────────────────────────────────────────────────────────────────
const keyStateP1 = createKeyState();
const keyStateP2 = createKeyState();

let bRenderer = null;
let scene = null;

// Player 1 refs
let carModelP1 = null;
let wheelMeshesP1 = [];
let kartBodyP1 = null;
let driftStateP1 = createDriftState();
let kartStateP1 = { isDrifting: false, sparksLevel: 0, isBoosting: false };

// Player 2 refs
let carModelP2 = null;
let wheelMeshesP2 = [];
let kartBodyP2 = null;
let driftStateP2 = createDriftState();
let kartStateP2 = { isDrifting: false, sparksLevel: 0, isBoosting: false };

let camP1 = null;
let camP2 = null;
let splitHUD = null;

const raceState = { raceStarted: false, raceFinished: false, countdownValue: 3 };

// ── Battle/Duel state (splitscreen battle) ──────────────────────────────────
const battleScore = { p1: 0, p2: 0 };
const DUEL_SCORE_LIMIT = 5;
let battleHudEl = null;

// Simple clock
const clock = {
  _prev: 0, _started: false,
  getDelta() {
    const now = performance.now() / 1000;
    if (!this._started) { this._started = true; this._prev = now; return 0; }
    const dt = now - this._prev;
    this._prev = now;
    return dt;
  },
};

let accumulator = 0;
let loadedCount = 0;

// ── Loading progress ────────────────────────────────────────────────────────
function setLoadProgress(pct) {
  const bar = document.getElementById('load-bar');
  if (bar) bar.style.width = `${Math.min(pct, 100)}%`;
}

function hideLoadingScreen() {
  setTimeout(() => {
    const el = document.getElementById('loading-screen');
    if (el) {
      el.style.opacity = '0';
      setTimeout(() => { el.style.display = 'none'; }, 500);
    }
  }, 300);
}

// ── Countdown ───────────────────────────────────────────────────────────────
function startCountdown() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    color:#fff;font-family:'Poppins',sans-serif;font-size:72px;font-weight:bold;
    text-shadow:0 0 20px rgba(255,255,255,.6);z-index:200;pointer-events:none;
  `;
  document.body.appendChild(overlay);

  let count = 3;
  overlay.textContent = String(count);
  playSFX('countdown_beep');

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      overlay.textContent = String(count);
      playSFX('countdown_beep');
    } else if (count === 0) {
      overlay.textContent = 'GO!';
      playSFX('countdown_go');

      // Unlock both karts
      if (kartBodyP1) kartBodyP1.setMotionType(PhysicsMotionType.DYNAMIC);
      if (kartBodyP2) kartBodyP2.setMotionType(PhysicsMotionType.DYNAMIC);

      raceState.raceStarted = true;
      playTrackMusic(mapToLoad);
      startEngineSound();
    } else {
      overlay.remove();
      clearInterval(interval);
    }
  }, 1000);
}

// ── Build input struct from keyState ────────────────────────────────────────
function buildInput(ks) {
  return {
    throttle: (ks.w ? 1 : 0) + (ks.s ? -1 : 0),
    steer:    (ks.a ? 1 : 0) + (ks.d ? -1 : 0),
    brake:    !!ks.shift,
  };
}

// ── Game loop ───────────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;

  const hasP1 = carModelP1 && kartBodyP1;
  const hasP2 = carModelP2 && kartBodyP2;

  while (accumulator >= FIXED_PHYSICS_STEP) {
    accumulator -= FIXED_PHYSICS_STEP;

    if (raceState.raceStarted && !raceState.raceFinished) {
      // ── Player 1 physics ────────────────────────────────────────
      if (hasP1) {
        const inputP1 = buildInput(keyStateP1);
        const res1 = applyKartDriving(kartBodyP1, carModelP1, inputP1, FIXED_PHYSICS_STEP, driftStateP1);
        if (splitHUD) splitHUD.updateP1(res1.speedKPH, 1, 3);

        // Spin wheels
        const rotAmt1 = (res1.speedKPH / 3.6) * FIXED_PHYSICS_STEP * 2.5;
        for (const wm of wheelMeshesP1) { if (wm) wm.rotation.x -= rotAmt1; }

        kartStateP1.isDrifting  = res1.driftTier > 0;
        kartStateP1.sparksLevel = res1.driftTier;
        kartStateP1.isBoosting  = res1.miniBoostActive;
      }

      // ── Player 2 physics ────────────────────────────────────────
      if (hasP2) {
        const inputP2 = buildInput(keyStateP2);
        const res2 = applyKartDriving(kartBodyP2, carModelP2, inputP2, FIXED_PHYSICS_STEP, driftStateP2);
        if (splitHUD) splitHUD.updateP2(res2.speedKPH, 1, 3);

        const rotAmt2 = (res2.speedKPH / 3.6) * FIXED_PHYSICS_STEP * 2.5;
        for (const wm of wheelMeshesP2) { if (wm) wm.rotation.x -= rotAmt2; }

        kartStateP2.isDrifting  = res2.driftTier > 0;
        kartStateP2.sparksLevel = res2.driftTier;
        kartStateP2.isBoosting  = res2.miniBoostActive;
      }
    }
  }

  // ── Splitscreen battle: collision scoring ───────────────────────
  if (isBattleMode && raceState.raceStarted && !raceState.raceFinished
      && carModelP1 && carModelP2) {
    const dist = carModelP1.position.subtract(carModelP2.position).length();
    if (dist < 3.5) {
      // Simple collision — faster kart scores
      const s1 = kartBodyP1 ? kartBodyP1.getLinearVelocity().length() : 0;
      const s2 = kartBodyP2 ? kartBodyP2.getLinearVelocity().length() : 0;
      if (s1 > s2 + 2) {
        battleScore.p1++;
        playSFX('crash');
      } else if (s2 > s1 + 2) {
        battleScore.p2++;
        playSFX('crash');
      }
      _updateBattleHUD();

      // Check win
      if (battleScore.p1 >= DUEL_SCORE_LIMIT || battleScore.p2 >= DUEL_SCORE_LIMIT) {
        raceState.raceFinished = true;
        const winner = battleScore.p1 >= DUEL_SCORE_LIMIT ? 'P1' : 'P2';
        _showBattleWinner(winner);
      }
    }
  }

  // ── Particles ───────────────────────────────────────────────────
  if (carModelP1) updateParticles(deltaTime, carModelP1, kartStateP1);

  // ── Render (scene.render auto-paints both viewports) ────────────
  if (scene) scene.render();
}

// ── Kart-loaded callback factory ────────────────────────────────────────────
function onKartLoaded(playerIndex, components) {
  const { carModel, wheelMeshes, kartAggregate } = components;

  if (playerIndex === 1) {
    carModelP1    = carModel;
    wheelMeshesP1 = wheelMeshes;
    kartBodyP1    = kartAggregate?.body ?? null;
  } else {
    carModelP2    = carModel;
    wheelMeshesP2 = wheelMeshes;
    kartBodyP2    = kartAggregate?.body ?? null;
  }

  loadedCount++;
  setLoadProgress(60 + loadedCount * 20);

  // Offset P2 kart so they don't overlap at spawn
  if (playerIndex === 2 && carModel) {
    carModel.position.addInPlace(new Vector3(4, 0, 0));
  }

  // Both karts loaded → wire cameras & start countdown
  if (carModelP1 && carModelP2) {
    lockCamerasToKarts(camP1, camP2, carModelP1, carModelP2);
    splitHUD = createSplitHUD();
    createDividerLine();
    if (isBattleMode) _createBattleHUD();
    hideLoadingScreen();
    setTimeout(() => startCountdown(), 500);
    animate();
  }
}

// ── Battle HUD helpers ──────────────────────────────────────────────────────
function _createBattleHUD() {
  if (!isBattleMode) return;
  battleHudEl = document.createElement('div');
  battleHudEl.id = 'split-battle-hud';
  battleHudEl.style.cssText = `
    position:fixed; top:10px; left:50%; transform:translateX(-50%);
    color:#fff; font-family:'Poppins',sans-serif; font-size:22px;
    background:rgba(0,0,0,.6); padding:6px 18px; border-radius:8px;
    z-index:200; pointer-events:none; text-align:center;
  `;
  document.body.appendChild(battleHudEl);
  _updateBattleHUD();
}

function _updateBattleHUD() {
  if (!battleHudEl) return;
  battleHudEl.innerHTML =
    `<span style="color:#ff7777">P1: ${battleScore.p1}</span>` +
    ` — ` +
    `<span style="color:#77aaff">P2: ${battleScore.p2}</span>`;
}

function _showBattleWinner(winner) {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
    color:#fff; font-family:'Poppins',sans-serif; font-size:64px; font-weight:bold;
    text-shadow:0 0 30px rgba(255,255,255,.8); z-index:300; pointer-events:none;
  `;
  overlay.textContent = `${winner} WINS!`;
  document.body.appendChild(overlay);
}

// ── Init ────────────────────────────────────────────────────────────────────
async function init() {
  window.addEventListener('beforeunload', () => disposeAudio());
  playPreRaceMusic();

  setLoadProgress(5);

  // ── Renderer (shared scene & engine for both viewports) ─────────
  bRenderer = await initBabylonRenderer('app');
  scene = bRenderer.scene;
  setLoadProgress(20);

  initParticles(scene);

  // ── Dual cameras ────────────────────────────────────────────────
  const cams = createSplitCameras(scene);
  camP1 = cams.camP1;
  camP2 = cams.camP2;

  // ── Physics world (Havok) ───────────────────────────────────────
  await initPhysics();
  setLoadProgress(30);

  // ── Input ───────────────────────────────────────────────────────
  installSplitscreenInput(keyStateP1, keyStateP2);

  // ── Track ───────────────────────────────────────────────────────
  loadTrackModel(mapToLoad, scene, null, () => {
    console.log(`Track loaded: ${mapToLoad}`);
    setLoadProgress(50);
  }, bRenderer.shadowGen);

  // ── Track metadata / checkpoints for supported content ─────────
  try {
    const td = await loadTrackData(mapToLoad, isBattleMode ? 'arena' : 'track');
    if (td?.driveline?.length) {
      initCheckpoints(td);
    }
  } catch (_) { /* track data optional */ }

  // ── Spawn P1 kart ──────────────────────────────────────────────
  // Temporarily store P1 kart id, then swap for P2
  const p1KartId = gameConfig?.p1Kart || sessionStorage.getItem('kartId') || 'tux';
  const p2KartId = gameConfig?.p2Kart || 'nolok';

  sessionStorage.setItem('kartId', p1KartId);
  createVehicle(scene, (c) => onKartLoaded(1, c), bRenderer.shadowGen);

  // ── Spawn P2 kart ──────────────────────────────────────────────
  // Small delay to prevent GLB cache collision on same model
  setTimeout(() => {
    sessionStorage.setItem('kartId', p2KartId);
    createVehicle(scene, (c) => onKartLoaded(2, c), bRenderer.shadowGen);
  }, 100);
}

init().catch(err => console.error('Splitscreen init failed:', err));
