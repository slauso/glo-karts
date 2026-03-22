/**
 * fps-main.js — Playable first-person Havok weapons sandbox.
 *
 * Features:
 *  - Pointer-lock FPS controls
 *  - Havok capsule player
 *  - Imported weapon models attached to camera
 *  - Physics projectiles with muzzle flash, bullet trails, impacts, craters
 *  - HDR environment, PBR terrain/props, shadows, bloom, glow
 *  - Ammo/reload/score HUD
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';

import { createFPSController } from './modules/fps/fps-controller.js';
import { createWeaponSystem } from './modules/fps/fps-weapons.js';
import { createEffectsSystem } from './modules/fps/fps-effects.js';
import { createFPSEnvironment } from './modules/fps/fps-environment.js';
import { initHUD } from './modules/fps/fps-hud.js';
import { FPSNetworkClient } from './modules/fps/fps-network-client.js';
import { getColyseusEndpoint } from './modules/realtime/feature-flag.js';
import { getDefaultFpsSpawn } from './modules/fps/fps-arena-layout.js';

const canvas = document.getElementById('fps-canvas');
if (!canvas) throw new Error('Missing #fps-canvas');

const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, antialias: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.04, 0.06, 0.1, 1);
scene.useRightHandedSystem = true;

let controller;
let weaponSystem;
let effects;
let hud;
let environment;
let networkClient;

let score = 0;
let hits = 0;
let health = 100;
let lastFrame = performance.now();
let fpsSmoothed = 60;

boot().catch((err) => {
  console.error('FPS mode boot failed:', err);
  const loading = document.getElementById('loading-copy');
  if (loading) loading.textContent = 'Boot failed. Check console.';
});

async function boot() {
  const params = new URLSearchParams(window.location.search);
  const partyCode = params.get('party') || sessionStorage.getItem('partyCode') || '';
  const hk = await HavokPhysics({
    locateFile: (path) => path.endsWith('.wasm')
      ? `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`
      : path,
  });
  const havok = new HavokPlugin(true, hk);
  scene.enablePhysics(new Vector3(0, -9.81, 0), havok);

  // ── Lights ────────────────────────────────────────────────────────────
  const hemi = new HemisphericLight('ambient', new Vector3(0.2, 1, 0.1), scene);
  hemi.intensity = 0.55;
  hemi.groundColor = new Color3(0.12, 0.14, 0.18);

  const sun = new DirectionalLight('sun', new Vector3(-0.45, -1, 0.25), scene);
  sun.position = new Vector3(60, 80, -40);
  sun.intensity = 2.1;
  sun.shadowMinZ = 0.1;
  sun.shadowMaxZ = 260;

  const shadowGen = new ShadowGenerator(2048, sun);
  shadowGen.usePercentageCloserFiltering = true;
  shadowGen.bias = 0.0005;
  shadowGen.normalBias = 0.01;
  shadowGen.filteringQuality = ShadowGenerator.QUALITY_HIGH;

  // ── Post processing ───────────────────────────────────────────────────
  const glow = new GlowLayer('glow', scene, { blurKernelSize: 32 });
  glow.intensity = 0.45;

  // ── Environment ───────────────────────────────────────────────────────
  environment = await createFPSEnvironment(scene, shadowGen);

  // ── HUD ───────────────────────────────────────────────────────────────
  hud = initHUD();
  hud.updateScore(score, hits);
  hud.updateHealth(health);
  hud.showReloading(1);

  // ── Player controller ─────────────────────────────────────────────────
  controller = createFPSController(scene, canvas);
  scene.activeCamera = controller.camera;
  controller.onReloadKey(() => startReload());
  controller.onWeaponSwitch((idx) => {
    weaponSystem.switchWeapon(idx);
    const nextWeapon = weaponSystem.getCurrentWeapon();
    networkClient?.selectWeapon(nextWeapon?.id);
    syncHUDWeapon();
  });
  const initialSpawn = getDefaultFpsSpawn(0);
  controller.capsule.position = new Vector3(initialSpawn.x, initialSpawn.y + 4, initialSpawn.z);
  controller.camera.rotation.y = initialSpawn.yaw;

  const pipeline = new DefaultRenderingPipeline('fpsPipe', true, scene, [controller.camera]);
  pipeline.samples = 4;
  pipeline.fxaaEnabled = true;
  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.78;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 96;
  pipeline.bloomScale = 0.65;
  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.toneMappingEnabled = true;
  pipeline.imageProcessing.exposure = 1.05;
  pipeline.imageProcessing.contrast = 1.08;

  // ── Effects ───────────────────────────────────────────────────────────
  effects = createEffectsSystem(scene, controller.camera);

  // ── Weapon system ─────────────────────────────────────────────────────
  weaponSystem = await createWeaponSystem(scene, controller.camera);
  weaponSystem.onReloadComplete(() => {
    effects.playSound('reload');
    hud.showReloading(1);
    hud.updateAmmo(weaponSystem.getAmmoState());
  });
  weaponSystem.onReloadProgress((progress) => hud.showReloading(progress));

  // ── Dedicated realtime FPS room ───────────────────────────────────────
  networkClient = new FPSNetworkClient({
    endpoint: getColyseusEndpoint(),
    scene,
    controller,
    effects,
    hud,
    weaponSystem,
  });
  await networkClient.connect({
    roomName: 'fps_arena',
    playerName: sessionStorage.getItem('playerName') || `Arena_${Math.floor(Math.random() * 10000)}`,
    partyCode,
    scoreLimit: 10,
    maxPlayers: 8,
  });
  if (typeof window !== 'undefined') {
    window.__gloDebug = {
      roomJoined: false,
      sessionId: '',
      matchLive: false,
      playerCount: 0,
      remotePlayerCount: 0,
      lastWeaponFired: null,
      lastHitVictimId: null,
      lastEffect: null,
      activeProjectileCount: 0,
      remoteProjectileReplications: 0,
      ...(window.__gloDebug || {}),
    };
    window.__gloClient = networkClient;
    window.__fpsFire = () => fireActiveWeapon();
  }
  syncHUDWeapon();

  // ── Crosshair target helper ───────────────────────────────────────────
  const aimLight = new PointLight('aimLight', new Vector3(0, 0, 0), scene);
  aimLight.intensity = 0;
  aimLight.range = 5;

  syncHUDWeapon();

  // ── Pointer lock + input ──────────────────────────────────────────────
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock?.();
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      fireActiveWeapon();
    }
  });

  window.addEventListener('resize', () => engine.resize());

  // ── FPS / status ──────────────────────────────────────────────────────
  const loading = document.getElementById('loading-screen');
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 500);
  }

  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    controller.update(dt);
    weaponSystem.update(dt, controller.isMoving(), controller.getVelocity());
    networkClient.update(dt);
    effects.update(dt, controller.isMoving(), controller.getSpeed());

    // Update FPS readout
    fpsSmoothed = fpsSmoothed * 0.92 + (1 / Math.max(dt, 0.001)) * 0.08;
    const fpsEl = document.getElementById('fps-value');
    if (fpsEl) fpsEl.textContent = fpsSmoothed.toFixed(0);

    // Aim helper point light at crosshair hit
    const ray = controller.camera.getForwardRay(200);
    const pick = scene.pickWithRay(ray, (m) => m.isPickable && m !== controller.capsule);
    if (pick?.hit && pick.pickedPoint) {
      aimLight.position.copyFrom(pick.pickedPoint);
      aimLight.intensity = 0.7;
    } else {
      aimLight.intensity = 0;
    }

    scene.render();
  });
}

function syncHUDWeapon() {
  const current = weaponSystem.getCurrentWeapon();
  hud.updateWeaponName(current?.name || 'WEAPON');
  hud.updateAmmo(weaponSystem.getAmmoState());
  const idx = ['cannon', 'frostAxe', 'moltenDagger'].indexOf(current?.id);
  hud.updateWeaponSlot(Math.max(idx, 0));
}

function startReload() {
  if (!weaponSystem || weaponSystem.isReloading() || !networkClient) return;
  const ammo = weaponSystem.getAmmoState();
  if (ammo.current === ammo.max) return;
  networkClient.reloadWeapon(weaponSystem.getCurrentWeapon()?.id);
}

function fireActiveWeapon() {
  if (!weaponSystem || !networkClient || document.pointerLockElement !== canvas) return;

  const weapon = weaponSystem.getCurrentWeapon();
  if (!networkClient.canFire()) {
    if (!weaponSystem.isReloading()) startReload();
    return;
  }

  const ammoState = weaponSystem.fire({ consumeAmmo: false });
  if (!ammoState) return;

  effects.screenShake(0.025);

  const muzzleOrigin = controller.camera.globalPosition.add(controller.camera.getForwardRay().direction.scale(0.8)).add(new Vector3(0.18, -0.12, 0));
  const direction = controller.camera.getForwardRay().direction.clone();
  networkClient.fireWeapon(muzzleOrigin, direction);
}
