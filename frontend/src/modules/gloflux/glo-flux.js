/**
 * glo-flux.js — Main orchestrator & game loop for gloFLUX mode.
 *
 * State machine:
 *   MENU → LOADING → COUNTDOWN → FLUX_ACTIVE → SURGE_CHECK → APOCALYPSE → RESULTS
 *
 * Responsibilities:
 *   - Initialize all sub-systems (arena, powers, surge, mutations, VFX, HUD, AI)
 *   - Game loop tick (60 fps)
 *   - Round lifecycle (spawn, respawn, elimination, victory)
 *   - Power-up spawn & collection
 *   - Score tracking
 *   - Disposal
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { FollowCamera } from '@babylonjs/core/Cameras/followCamera';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

import HavokPhysics from '@babylonjs/havok';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

import { drawPower, activatePower, tickPowers, createPowerState, awardEchoShards, FAMILY, FAMILY_META, getPower } from './glo-flux-powers.js';
import { generateGloFluxArena, ARENA_VARIANT, createShrinkState, tickShrinkBoundary, isOutsideBoundary, computeArenaMutations } from './glo-flux-arena.js';
import { createSurgeState, surgeFromChain, surgeFromKill, surgeFromAssist, surgeFromEchoShards, triggerApocalypseBurst, tickSurge, getSurgePercent, getSurgeTier, isBursting } from './glo-flux-surge.js';
import { createMutationState, infectKart, computeDeformedPositions, applyMutationToMaterial, serializeMutation, deserializeMutation } from './glo-flux-mutations.js';
import { createVFXState, requestPowerVFX, releasePowerVFX, tickPostProcess, queuePostProcess, getApocalypseBurstVFX, disposeVFX } from './glo-flux-vfx.js';
import { createHUDState, updateSurge, updatePowerSlots, updateCombo, updateMutation, updateHealth, updateRace, updateTelemetry, addKillFeedEntry, updateRadar, renderHUD, resizeHUD, disposeHUD, renderResultsOverlay, renderOnboardingHint } from './glo-flux-hud.js';
import { createMenuState, mountMenu, hideMenu, disposeMenu } from './glo-flux-menu.js';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from '../realtime/collision-layers.js';
import { applyKartDriving, createDriftState } from '../kart-physics.js';
import { createBotFleet, tickBots, disposeBots } from './glo-flux-ai.js';
import { ModeManager } from '../modes/ModeManager.js';
import { GloFluxMode } from '../modes/glo-flux.js';

// ── Game States ─────────────────────────────────────────────────────────────

export const GLOFLUX_STATE = Object.freeze({
  MENU:         'menu',
  LOADING:      'loading',
  COUNTDOWN:    'countdown',
  FLUX_ACTIVE:  'flux_active',
  SURGE_CHECK:  'surge_check',
  APOCALYPSE:   'apocalypse',
  RESULTS:      'results',
  WAITING:      'waiting',      // 20.15 — waiting for players
  PREMATCH:     'prematch',     // 20.15 — prematch lobby
  REMATCH:      'rematch',      // 20.15 — rematch vote
});

const COUNTDOWN_DURATION = 3;   // seconds
const POWER_SPAWN_INTERVAL = 8; // seconds between new power-up spawns
const ECHO_SHARD_INTERVAL = 15; // seconds between echo shard drops
const POWER_CORE_HEIGHT = 1.4;

function createInputState() {
  const state = {
    forward: false,
    reverse: false,
    left: false,
    right: false,
    brake: false,
    // 20.15 — post-match keys
    rematchPressed: false,
    returnPressed: false,
  };

  const keyMap = {
    w: 'forward',
    arrowup: 'forward',
    s: 'reverse',
    arrowdown: 'reverse',
    a: 'left',
    arrowleft: 'left',
    d: 'right',
    arrowright: 'right',
    ' ': 'brake',
  };

  const setKey = (event, isDown) => {
    const key = event.key.toLowerCase();
    const mapped = keyMap[key];
    if (mapped) {
      state[mapped] = isDown;
      event.preventDefault();
      return;
    }
    // Post-match keys (only fire on keydown)
    if (isDown && key === 'r') state.rematchPressed = true;
    if (isDown && key === 'escape') state.returnPressed = true;
  };

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    Object.keys(state).forEach((key) => {
      state[key] = false;
    });
  });

  return state;
}

// ── Main Orchestrator ───────────────────────────────────────────────────────

/**
 * Boot the gloFLUX mode.
 * @param {HTMLCanvasElement} canvas
 * @param {object} [preConfig] - If provided, skip menu & use this config
 * @returns {{ dispose: Function }}
 */
export function bootGloFlux(canvas, preConfig = null, options = {}) {
  const orch = {
    state: preConfig ? GLOFLUX_STATE.LOADING : GLOFLUX_STATE.MENU,
    config: preConfig,
    options,
    engine: null,
    scene: null,
    camera: null,
    arenaData: null,
    arenaRoot: null,
    players: [],           // [{id, mesh, physics, powerState, surgeState, mutationState, health, alive}]
    localPlayerId: 'local',
    input: createInputState(),
    network: options.networkClient || null,
    isMultiplayer: !!preConfig?.multiplayer,
    powerSpawns: [],       // [{position, powerId, mesh, collected}]
    hud: createHUDState(),
    vfx: createVFXState(),
    menu: createMenuState(),
    modeManager: new ModeManager(),
    gloFluxMode: null,
    bots: null,
    elapsed: 0,
    countdownRemain: COUNTDOWN_DURATION,
    nextPowerSpawn: POWER_SPAWN_INTERVAL,
    nextShardDrop: ECHO_SHARD_INTERVAL,
    shrinkState: null,
    disposed: false,
    _loopId: null,
    debug: {},
    // 20.15 — match flow
    matchResults: null,        // { standings, seedBadge }
    rematchStatus: null,       // { votes, target }
    // 20.19 — onboarding
    onboardingShown: false,
    onboardingHints: [],
    // 20.20 — audio context
    audioCtx: null,
  };

  // ── Engine + Scene ──────────────────────────────────────────────────────
  orch.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
  orch.scene = new Scene(orch.engine);
  orch.scene.clearColor = new Color3(0.02, 0.02, 0.04).toColor4(1);
  orch.scene.ambientColor = new Color3(0.1, 0.12, 0.08);

  // ── Lighting (wasteland mood) ───────────────────────────────────────────
  const hemi = new HemisphericLight('gf_hemi', new Vector3(0, 1, 0), orch.scene);
  hemi.intensity = 0.8;
  hemi.diffuse = new Color3(0.8, 0.9, 0.6);
  hemi.groundColor = new Color3(0.2, 0.15, 0.1);

  const dir = new DirectionalLight('gf_dir', new Vector3(-0.5, -1, 0.3), orch.scene);
  dir.intensity = 1.2;
  dir.diffuse = new Color3(1, 0.85, 0.5);

  // ── Camera ──────────────────────────────────────────────────────────────
  orch.camera = new FollowCamera('gf_cam', new Vector3(0, 15, -20), orch.scene);
  orch.camera.radius = 18;
  orch.camera.heightOffset = 8;
  orch.camera.rotationOffset = 180;
  orch.camera.cameraAcceleration = 0.05;
  orch.camera.maxCameraSpeed = 20;

  // ── Resize ──────────────────────────────────────────────────────────────
  const onResize = () => {
    orch.engine.resize();
    resizeHUD(orch.hud);
  };
  window.addEventListener('resize', onResize);

  // ── Menu Flow ───────────────────────────────────────────────────────────
  if (!preConfig) {
    mountMenu(orch.menu, (cfg) => {
      orch.config = cfg;
      orch.state = GLOFLUX_STATE.LOADING;
      hideMenu(orch.menu);
      startLoading(orch);
    });
  } else {
    startLoading(orch);
  }

  // ── Render Loop ─────────────────────────────────────────────────────────
  orch.engine.runRenderLoop(() => {
    if (orch.disposed) return;
    const dt = orch.engine.getDeltaTime() / 1000;
    tickOrchestrator(orch, dt);
    orch.scene.render();
  });

  return {
    _orch: orch,
    startMatch() {
      orch.state = GLOFLUX_STATE.FLUX_ACTIVE;
      orch.countdownRemain = 0;
    },
    // 20.15 — post-match controls
    requestRematch() {
      if (orch.network) orch.network.requestRematch();
    },
    requestReturn() {
      if (orch.network) orch.network.requestReturn();
      orch.state = GLOFLUX_STATE.MENU;
    },
    getResults() {
      return orch.matchResults;
    },
    getRematchStatus() {
      return orch.rematchStatus;
    },
    dispose() {
      orch.disposed = true;
      window.removeEventListener('resize', onResize);
      disposeHUD(orch.hud);
      disposeVFX(orch.vfx);
      disposeMenu(orch.menu);
      if (orch.bots) disposeBots(orch.bots);
        orch.modeManager.dispose();
      orch.engine.stopRenderLoop();
      orch.scene.dispose();
      orch.engine.dispose();
    },
  };
}

// ── Loading ─────────────────────────────────────────────────────────────────

function startLoading(orch) { window.__useRealPhysics = true;
  const HAVOK_WASM_PATH = `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`;
  HavokPhysics({ locateFile: (path) => (path.endsWith(".wasm") ? HAVOK_WASM_PATH : path) }).then((hk) => {
    const gravityVector = new Vector3(0, -9.81, 0);
    const physicsPlugin = new HavokPlugin(true, hk);
    orch.scene.enablePhysics(gravityVector, physicsPlugin);
    console.log("[gloFLUX] Havok Physics initialized.");
    _continueLoading(orch);
  });
}

function _continueLoading(orch) {
  const cfg = orch.config;
  const variant = cfg.variant === 'race' ? ARENA_VARIANT.RACE : ARENA_VARIANT.ARENA;

  // Generate procedural arena
  const { root, arenaData, theme } = generateGloFluxArena(
    cfg.arenaTheme || 'nuclear_desert',
    orch.scene,
    { variant, halfSize: 60 }
  );
  orch.arenaRoot = root;
  orch.arenaData = arenaData;

  // Shrink boundary (arena mode only)
  if (variant === ARENA_VARIANT.ARENA) {
    orch.shrinkState = createShrinkState(60, 0.3);
  }

  if (orch.isMultiplayer && orch.network) {
    orch.localPlayerId = orch.network.sessionId || orch.localPlayerId;
    syncNetworkPlayers(orch);
    syncNetworkPowerSpawns(orch);
    ensureGloFluxMode(orch);
    bindNetworkModeEvents(orch);
    const localPlayer = orch.players.find((player) => player.id === orch.localPlayerId);
    if (localPlayer) {
      orch.camera.lockedTarget = localPlayer.mesh;
    }
    orch.state = orch.network.room?.state?.started ? GLOFLUX_STATE.FLUX_ACTIVE : GLOFLUX_STATE.LOADING;
    console.log(`[gloFLUX] Loaded multiplayer arena: theme=${theme}, variant=${cfg.variant}, players=${orch.players.length}`);
    return;
  }

  // Spawn local player
  const localPlayer = createPlayer(orch, orch.localPlayerId, arenaData.spawnPositions[0] || new Vector3(0, 2, 0));
  orch.players.push(localPlayer);
  orch.camera.lockedTarget = localPlayer.mesh;

  // Spawn bots
  const botCount = cfg.botCount || 5;
  for (let i = 0; i < botCount; i++) {
    const spawnPos = arenaData.spawnPositions[(i + 1) % arenaData.spawnPositions.length] || new Vector3(i * 4, 2, i * 4);
    const bot = createPlayer(orch, `bot_${i}`, spawnPos);
    bot.isBot = true;
    orch.players.push(bot);
  }

  // Init bot AI
  orch.bots = createBotFleet(orch.players.filter(p => p.isBot), arenaData);

  // Spawn initial power-ups
  spawnPowerUps(orch);
  ensureGloFluxMode(orch);

  console.log(`[gloFLUX] Loaded: theme=${theme}, variant=${cfg.variant}, bots=${botCount}`);
  orch.state = GLOFLUX_STATE.COUNTDOWN;
  orch.countdownRemain = COUNTDOWN_DURATION;
}

function ensureGloFluxMode(orch) {
  if (orch.gloFluxMode) return orch.gloFluxMode;
  orch.gloFluxMode = orch.modeManager.register(new GloFluxMode({
    scene: orch.scene,
    engine: orch.engine,
    havokPlugin: typeof orch.scene.getPhysicsEngine === 'function' ? orch.scene.getPhysicsEngine() : null,
    networkClient: orch.network,
    hud: orch.hud,
    arenaData: orch.arenaData,
    arenaSeed: orch.network?.telemetry?.arenaSeed || orch.arenaData?.seed || orch.config?.arenaSeed || 0,
    localPlayerId: orch.localPlayerId,
    debugBus: orch.debug,
    options: orch.options,
  }));
  orch.modeManager.activate(orch.gloFluxMode.id).then(() => {
    if (typeof window !== 'undefined' && window.__gloflux?._orch === orch) {
      window.__glofluxMode = orch.gloFluxMode;
    }
  }).catch((error) => {
    console.error('[gloFLUX] Failed to activate mode', error);
  });
  return orch.gloFluxMode;
}

function bindNetworkModeEvents(orch) {
  if (!orch.network || orch._modeBindingsInstalled) return;
  orch._modeBindingsInstalled = true;

  orch.network.on('powerGranted', (msg = {}) => {
    const local = orch.players.find((player) => player.id === orch.localPlayerId);
    if (!local || !msg.powerId) return;
    const spawn = orch.powerSpawns.find((entry) => entry.idx === msg.idx);
    if (spawn) {
      spawn.collected = true;
      spawn.pending = false;
      if (spawn.mesh) spawn.mesh.setEnabled(false);
    }
    ensureGloFluxMode(orch).handleCoreCollected(local, msg.powerId, Date.now(), { fromNetwork: true });
  });

  orch.network.on('powerDenied', (msg = {}) => {
    const spawn = orch.powerSpawns.find((entry) => entry.idx === msg.idx);
    if (spawn) {
      spawn.pending = false;
    }
  });

  // 20.15 — phase transition from server
  orch.network.on('phaseChange', (msg = {}) => {
    const phaseMap = {
      waiting: GLOFLUX_STATE.WAITING,
      prematch: GLOFLUX_STATE.PREMATCH,
      countdown: GLOFLUX_STATE.COUNTDOWN,
      live: GLOFLUX_STATE.FLUX_ACTIVE,
      results: GLOFLUX_STATE.RESULTS,
      rematch: GLOFLUX_STATE.REMATCH,
    };
    const newState = phaseMap[msg.phase];
    if (newState) {
      orch.state = newState;
      console.log(`[gloFLUX] Phase → ${msg.phase}`);
    }
  });

  orch.network.on('matchResults', (msg = {}) => {
    orch.matchResults = msg;
    orch.state = GLOFLUX_STATE.RESULTS;
    if (msg.standings?.length) {
      addKillFeedEntry(orch.hud, `MATCH OVER — ${msg.standings[0].name} WINS!`, '#ff0');
    }
    // 20.23 — persist match progress
    _persistMatchResult(orch, msg);
  });

  orch.network.on('rematchStatus', (msg = {}) => {
    orch.rematchStatus = msg;
  });

  orch.network.on('rematchStarting', () => {
    orch.state = GLOFLUX_STATE.LOADING;
    orch.matchResults = null;
    orch.rematchStatus = null;
    addKillFeedEntry(orch.hud, 'REMATCH STARTING...', '#0f0');
  });

  // 20.16 — disconnection recovery
  orch.network.on('disconnected', () => {
    addKillFeedEntry(orch.hud, 'CONNECTION LOST — Reconnecting...', '#f80');
  });
}

function createPlayer(orch, id, position, meta = {}) {
  // Placeholder mesh — real kart loading happens in platform wiring
  const mesh = MeshBuilder.CreateBox(`kart_${id}`, { width: 1.2, height: 0.6, depth: 2 }, orch.scene);
  mesh.position = new Vector3(position.x, position.y, position.z);
  mesh.position.y = (position.y ?? 0.8) + 15;

  const material = new StandardMaterial(`kart_mat_${id}`, orch.scene);
  try {
    material.diffuseColor = Color3.FromHexString(meta.gloColor || meta.playerColor || '#ff0080');
  } catch {
    material.diffuseColor = new Color3(0.95, 0.2, 0.55);
  }
  material.emissiveColor = material.diffuseColor.scale(0.35);
  mesh.material = material;

  return {
    id,
    mesh,
    physics: window.__useRealPhysics ? (()=>{ const a = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: new Vector3(1.8,0.5,3.2) }, orch.scene); a.body.setMassProperties({ inertia: new Vector3(0,500,0) }); applyFilterToAggregate(a, FILTER.KART); return a; })() : null, driftState: createDriftState(), input: {forward:false,reverse:false,left:false,right:false,brake:false},
    powerState: createPowerState(),
    surgeState: createSurgeState(),
    mutationState: createMutationState(),
    health: 100,
    maxHealth: 100,
    alive: true,
    isBot: false,
    score: 0,
    kills: 0,
    lap: 0,
    checkpoint: 0,
    name: meta.name || id,
  };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

function tickOrchestrator(orch, dt) {
  const now = Date.now();
  orch.modeManager.update(dt, now);

  switch (orch.state) {
    case GLOFLUX_STATE.MENU:
      break;

    case GLOFLUX_STATE.LOADING:
      break;

    case GLOFLUX_STATE.WAITING:
      // 20.15 — waiting for players, show player count on HUD
      if (orch.isMultiplayer && orch.network) {
        syncNetworkPlayers(orch);
      }
      break;

    case GLOFLUX_STATE.PREMATCH:
      // 20.15 — prematch lobby, sync players
      if (orch.isMultiplayer && orch.network) {
        syncNetworkPlayers(orch);
      }
      break;

    case GLOFLUX_STATE.COUNTDOWN:
      orch.countdownRemain -= dt;
      if (orch.countdownRemain <= 0) {
        orch.state = GLOFLUX_STATE.FLUX_ACTIVE;
        // 20.19 — show first-time onboarding hint
        if (!orch.onboardingShown) {
          orch.onboardingShown = true;
          addKillFeedEntry(orch.hud, 'Collect ANOMALY CORES to build surge! Chain same-family for combos.', '#0ff');
        }
        console.log('[gloFLUX] GO!');
      }
      break;

    case GLOFLUX_STATE.FLUX_ACTIVE:
      tickFluxActive(orch, dt, now);
      break;

    case GLOFLUX_STATE.SURGE_CHECK:
      for (const p of orch.players) {
        if (p.alive && getSurgeTier(p.surgeState) >= 4) {
          triggerApocalypseBurst(p.surgeState);
          orch.state = GLOFLUX_STATE.APOCALYPSE;
          addKillFeedEntry(orch.hud, `${p.id} TRIGGERED APOCALYPSE!`, '#ff0');
          // 20.20 — apocalypse audio cue
          playTone(orch, 220, 0.6, 1.0);
          break;
        }
      }
      if (orch.state === GLOFLUX_STATE.SURGE_CHECK) {
        orch.state = GLOFLUX_STATE.FLUX_ACTIVE;
      }
      break;

    case GLOFLUX_STATE.APOCALYPSE:
      tickApocalypse(orch, dt, now);
      break;

    case GLOFLUX_STATE.RESULTS:
      // 20.15 — render results overlay with rematch voting
      renderResultsOverlay(orch.hud, orch.matchResults, orch.rematchStatus);
      // Handle post-match key presses
      if (orch.input.rematchPressed) {
        orch.input.rematchPressed = false;
        if (orch.network) orch.network.requestRematch();
      }
      if (orch.input.returnPressed) {
        orch.input.returnPressed = false;
        if (orch.network) orch.network.requestReturn();
        orch.state = GLOFLUX_STATE.MENU;
        mountMenu(orch.menu, (cfg) => {
          orch.config = cfg;
          orch.state = GLOFLUX_STATE.LOADING;
          hideMenu(orch.menu);
          startLoading(orch);
        });
      }
      break;

    case GLOFLUX_STATE.REMATCH:
      // Transition handled by network event
      break;
  }

  // Always render HUD
  renderHUD(orch.hud);
}

// ── Active Gameplay Tick ────────────────────────────────────────────────────

function tickFluxActive(orch, dt, now) {
  orch.elapsed += dt;

  if (orch.isMultiplayer && orch.network) {
    syncNetworkPlayers(orch);
    syncNetworkPowerSpawns(orch);
    orch.network.sendInput({
      forward: orch.input.forward && !orch.input.reverse,
      steer: orch.input.left && !orch.input.right ? -1 : (orch.input.right && !orch.input.left ? 1 : 0),
      brake: orch.input.brake,
    });
  }

  // Tick power-up timers for all players
  for (const p of orch.players) {
    if (!p.alive) continue;

    const expired = tickPowers(p.powerState, dt);
    for (const powId of expired) {
      releasePowerVFX(orch.vfx, powId);
    }

    // Tick surge
    const surgeResult = tickSurge(p.surgeState, dt, now);
      if (p.physics && p.alive) {
        let input = p.isBot ? p.input : orch.input;
        const steer = input.left && !input.right ? -1 : (input.right && !input.left ? 1 : 0);
        const accel = input.forward && !input.reverse ? 1 : (input.reverse ? -1 : 0);
        applyKartDriving(p.physics.body, p.mesh, { accelerate: accel, steer, brake: input.brake }, dt, p.driftState, { spdMult: 1, strMult: 1 });
      }
    if (surgeResult.tier >= 4 && !surgeResult.isBursting) {
      // Can trigger apocalypse — check on next tick
      orch.state = GLOFLUX_STATE.SURGE_CHECK;
    }
  }

  // Power-up spawning
  if (!orch.isMultiplayer) {
    orch.nextPowerSpawn -= dt;
    if (orch.nextPowerSpawn <= 0) {
      spawnPowerUps(orch);
      orch.nextPowerSpawn = POWER_SPAWN_INTERVAL;
    }
  }

  // Echo shard drops
  if (!orch.isMultiplayer) {
    orch.nextShardDrop -= dt;
    if (orch.nextShardDrop <= 0) {
      for (const p of orch.players) {
        if (p.alive) awardEchoShards(p.powerState, 2);
      }
      orch.nextShardDrop = ECHO_SHARD_INTERVAL;
    }
  }

  // Shrink boundary (arena mode)
  if (orch.shrinkState) {
    tickShrinkBoundary(orch.shrinkState, dt);
    for (const p of orch.players) {
      if (!p.alive) continue;
      const pos = p.mesh.position;
      if (isOutsideBoundary(orch.shrinkState, pos.x, pos.z)) {
        p.health -= 20 * dt; // damage outside ring
        if (p.health <= 0) {
          eliminatePlayer(orch, p);
        }
      }
    }
  }

  // Tick bot AI
  if (orch.bots) {
    tickBots(orch.bots, orch.players, orch.powerSpawns, dt, now);
  }

  syncPowerSpawnVisuals(orch, now);

  // Check for power-up collection
  checkPowerCollection(orch, now);

  // Post-process effects tick
  tickPostProcess(orch.vfx, now);

  // Update HUD
  const local = orch.players.find(p => p.id === orch.localPlayerId);
  if (local) {
    updateSurge(orch.hud, local.surgeState);
    updatePowerSlots(orch.hud, getActivePowersForHUD(local.powerState), now);
    updateMutation(orch.hud, local.mutationState);
    updateHealth(orch.hud, local.health, local.maxHealth);

    const alive = orch.players.filter(p => p.alive).length;
    const elapsed = orch.isMultiplayer && orch.network?.room?.state
      ? Number(orch.network.room.state.elapsed || orch.elapsed)
      : orch.elapsed;
    updateRace(orch.hud, elapsed, local.lap, orch.config?.variant === 'race' ? 5 : 0, countPlacement(orch, local), alive);
    if (orch.network?.telemetry) {
      updateTelemetry(orch.hud, orch.network.telemetry);
    }

    // Radar blips
    const blips = orch.players
      .filter(p => p.id !== orch.localPlayerId && p.alive)
      .map(p => ({
        x: p.mesh.position.x - local.mesh.position.x,
        z: p.mesh.position.z - local.mesh.position.z,
        type: 'enemy',
      }));
    for (const spawn of orch.powerSpawns) {
      if (spawn.collected) continue;
      blips.push({
        x: spawn.position.x - local.mesh.position.x,
        z: spawn.position.z - local.mesh.position.z,
        type: 'power',
      });
    }
    updateRadar(orch.hud, blips);
  }

  // Victory check
  checkVictory(orch);
}

// ── Apocalypse Phase ────────────────────────────────────────────────────────

function tickApocalypse(orch, dt, now) {
  let anyBursting = false;
  for (const p of orch.players) {
    const result = tickSurge(p.surgeState, dt, now);
    if (result.isBursting) {
      anyBursting = true;
    }
    if (result.burstComplete) {
      // Damage all other players
      for (const other of orch.players) {
        if (other.id !== p.id && other.alive) {
          other.health -= 30;
          if (other.health <= 0) eliminatePlayer(orch, other);
        }
      }
    }
  }

  if (!anyBursting) {
    orch.state = GLOFLUX_STATE.FLUX_ACTIVE;
  }
}

// ── Power-Up Spawning & Collection ──────────────────────────────────────────

function spawnPowerUps(orch) {
  if (!orch.arenaData?.powerUpSpawns) return;

  orch.arenaData.powerUpSpawns.forEach((spawn, idx) => {
    if (spawn.collected) return;
    const existing = orch.powerSpawns.find((entry) => entry.idx === idx) || orch.powerSpawns.find((entry) => entry.position.equals(spawn.position));
    if (existing && existing.collected) {
      existing.collected = false;
      existing.powerId = drawPower(Math.random).powerId;
      existing.pending = false;
      if (existing.mesh) {
        existing.mesh.setEnabled(true);
        existing.visualPowerId = null;
      }
    } else if (!existing) {
      orch.powerSpawns.push({
        idx,
        position: spawn.position.clone(),
        powerId: drawPower(Math.random).powerId,
        mesh: null, // visual placeholder created on first render
        collected: false,
        pending: false,
        visualPowerId: null,
      });
    }
  });
}

function checkPowerCollection(orch, now) {
  if (orch.isMultiplayer && orch.network) {
    const local = orch.players.find((player) => player.id === orch.localPlayerId && player.alive);
    if (!local) return;

    const pos = local.mesh.position;
    for (const spawn of orch.powerSpawns) {
      if (spawn.collected || spawn.pending) continue;
      const dx = pos.x - spawn.position.x;
      const dz = pos.z - spawn.position.z;
      if (dx * dx + dz * dz < 4) {
        spawn.pending = true;
        orch.network.requestPowerCollection(spawn.idx);
      }
    }
    return;
  }

  for (const p of orch.players) {
    if (!p.alive) continue;
    const pos = p.mesh.position;

    for (const spawn of orch.powerSpawns) {
      if (spawn.collected) continue;
      const dx = pos.x - spawn.position.x;
      const dz = pos.z - spawn.position.z;
      if (dx * dx + dz * dz < 4) { // collection radius 2
        spawn.collected = true;
        if (spawn.mesh) spawn.mesh.setEnabled(false);

        // Activate power
        const result = ensureGloFluxMode(orch).handleCoreCollected(p, spawn.powerId, now, { fromNetwork: false });
        if (result?.powerResult?.power) {
          // VFX
          requestPowerVFX(orch.vfx, spawn.powerId, now);

          // Synergy effects -> post-process
          for (const syn of result.powerResult.newSynergies) {
            if (syn.screenEffect) {
              queuePostProcess(orch.vfx, syn.screenEffect, now);
            }
          }

          addKillFeedEntry(orch.hud, `${p.id} -> ${result.powerResult.power.id}`, '#4f4');
        }
      }
    }
  }
}

function syncNetworkPowerSpawns(orch) {
  if (!orch.network?.powerSpawns?.length) {
    for (const entry of orch.powerSpawns) {
      disposePowerSpawnVisual(entry);
    }
    orch.powerSpawns = [];
    return;
  }

  const nextIds = new Set(orch.network.powerSpawns.map((spawn) => spawn.idx));
  for (const entry of orch.powerSpawns) {
    if (!nextIds.has(entry.idx)) {
      disposePowerSpawnVisual(entry);
    }
  }

  orch.powerSpawns = orch.network.powerSpawns.map((spawn) => {
    const existing = orch.powerSpawns.find((entry) => entry.idx === spawn.idx);
    return {
      idx: spawn.idx,
      position: existing?.position || new Vector3(spawn.x, spawn.y, spawn.z),
      powerId: spawn.powerId,
      mesh: existing?.mesh || null,
      collected: !!spawn.collected,
      pending: false,
      visualPowerId: existing?.visualPowerId || null,
    };
  });
}

function syncNetworkPlayers(orch) {
  if (!orch.network?.players) return;

  const seen = new Set();
  orch.network.players.forEach((netPlayer, sessionId) => {
    seen.add(sessionId);

    let player = orch.players.find((entry) => entry.id === sessionId);
    if (!player) {
      player = createPlayer(
        orch,
        sessionId,
        new Vector3(netPlayer.x || 0, (netPlayer.y || 0) + 0.8, netPlayer.z || 0),
        netPlayer,
      );
      orch.players.push(player);
      if (sessionId === orch.localPlayerId) {
        orch.camera.lockedTarget = player.mesh;
      }
    }
    if (orch.gloFluxMode) {
      orch.gloFluxMode.registerPlayer(player);
    }

    player.name = netPlayer.name || player.name;
    player.health = Number(netPlayer.health ?? player.health);
    player.alive = !!netPlayer.alive;
    player.score = Number(netPlayer.score ?? player.score);
    player.mesh.position.x = Number(netPlayer.x || 0);
    player.mesh.position.y = Number(netPlayer.y || 0) + 0.8;
    player.mesh.position.z = Number(netPlayer.z || 0);
    player.mesh.rotation.y = Number(netPlayer.ry || 0);
    player.mesh.setEnabled(player.alive);
  });

  for (let i = orch.players.length - 1; i >= 0; i -= 1) {
    const player = orch.players[i];
    if (seen.has(player.id) || (!orch.isMultiplayer && player.id === orch.localPlayerId)) continue;
    player.mesh?.dispose();
    orch.players.splice(i, 1);
  }
}

// ── Player Management ───────────────────────────────────────────────────────

function eliminatePlayer(orch, player) {
  player.alive = false;
  player.health = 0;
  if (player.mesh) player.mesh.setEnabled(false);
  addKillFeedEntry(orch.hud, `${player.id} ELIMINATED`, '#f44');
  // 20.20 — elimination stinger
  playTone(orch, 180, 0.3, 0.4);
  console.log(`[gloFLUX] ${player.id} eliminated`);
}

function checkVictory(orch) {
  const alivePlayers = orch.players.filter(p => p.alive);

  // Arena: last kart standing
  if (orch.config?.variant === 'arena' && alivePlayers.length <= 1) {
    orch.state = GLOFLUX_STATE.RESULTS;
    if (alivePlayers[0]) {
      addKillFeedEntry(orch.hud, `${alivePlayers[0].id} WINS!`, '#ff0');
    }
    console.log('[gloFLUX] GAME OVER — Results');
  }
}

function countPlacement(orch, player) {
  const sorted = [...orch.players].filter(p => p.alive).sort((a, b) => b.score - a.score);
  return sorted.findIndex(p => p.id === player.id) + 1;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getActivePowersForHUD(powerState) {
  return powerState.activePowers.map(p => ({
    powerId: p.powerId,
    family: getPower(p.powerId)?.family || 'unknown',
    expiresAt: p.startTime + p.remaining * 1000,
  }));
}

function syncPowerSpawnVisuals(orch, now) {
  const time = now / 1000;
  for (const spawn of orch.powerSpawns) {
    if (!spawn.mesh || spawn.visualPowerId !== spawn.powerId) {
      disposePowerSpawnVisual(spawn);
      spawn.mesh = createPowerSpawnVisual(orch, spawn);
      spawn.visualPowerId = spawn.powerId;
    }
    if (!spawn.mesh) continue;

    spawn.mesh.setEnabled(!spawn.collected);
    spawn.mesh.position.set(
      spawn.position.x,
      (spawn.position.y || 0) + POWER_CORE_HEIGHT + Math.sin(time * 2.2 + (spawn.idx || 0)) * 0.18,
      spawn.position.z,
    );
    spawn.mesh.rotation.y = time * 0.9 + (spawn.idx || 0) * 0.37;

    const pulse = 0.78 + Math.sin(time * 3.4 + (spawn.idx || 0) * 0.8) * 0.22;
    const meta = spawn.mesh.metadata || {};
    if (meta.coreMaterial) {
      meta.coreMaterial.emissiveColor = meta.baseColor.scale(0.55 + pulse * 0.75);
    }
    if (meta.shellMaterial) {
      meta.shellMaterial.emissiveColor = meta.baseColor.scale(0.24 + pulse * 0.32);
    }
    if (meta.accentMeshes) {
      meta.accentMeshes.forEach((mesh, index) => {
        mesh.rotation.x += 0.004 + index * 0.0008;
        mesh.rotation.z -= 0.003 + index * 0.0006;
      });
    }
  }
}

function createPowerSpawnVisual(orch, spawn) {
  const power = getPower(spawn.powerId);
  const family = power?.family || FAMILY.PHANTOM_HORDE;
  const baseColor = getFamilyColor3(family);
  const root = new TransformNode(`gf_power_core_${spawn.idx ?? 'local'}`, orch.scene);
  root.position.set(spawn.position.x, (spawn.position.y || 0) + POWER_CORE_HEIGHT, spawn.position.z);

  const coreMaterial = new StandardMaterial(`gf_power_core_mat_${spawn.idx ?? 'local'}`, orch.scene);
  coreMaterial.diffuseColor = baseColor.scale(0.45);
  coreMaterial.emissiveColor = baseColor.scale(1.05);
  coreMaterial.specularColor = baseColor.scale(0.2);

  const shellMaterial = new StandardMaterial(`gf_power_shell_mat_${spawn.idx ?? 'local'}`, orch.scene);
  shellMaterial.diffuseColor = baseColor.scale(0.12);
  shellMaterial.emissiveColor = baseColor.scale(0.35);
  shellMaterial.alpha = 0.72;

  const core = MeshBuilder.CreateSphere(`gf_power_core_inner_${spawn.idx ?? 'local'}`, { diameter: 0.9, segments: 10 }, orch.scene);
  core.parent = root;
  core.material = coreMaterial;

  const shell = MeshBuilder.CreateSphere(`gf_power_core_shell_${spawn.idx ?? 'local'}`, { diameter: 1.35, segments: 8 }, orch.scene);
  shell.parent = root;
  shell.material = shellMaterial;

  const ring = MeshBuilder.CreateTorus(`gf_power_core_ring_${spawn.idx ?? 'local'}`, { diameter: 1.8, thickness: 0.08, tessellation: 24 }, orch.scene);
  ring.parent = root;
  ring.rotation.x = Math.PI / 2;
  ring.material = shellMaterial;

  const accentMeshes = createFamilyAccents(orch, root, family, shellMaterial, spawn.idx ?? 0);
  root.metadata = { coreMaterial, shellMaterial, baseColor, accentMeshes };
  return root;
}

function createFamilyAccents(orch, root, family, material, idx) {
  const accentMeshes = [];

  if (family === FAMILY.PHANTOM_HORDE) {
    for (let i = 0; i < 3; i += 1) {
      const wisp = MeshBuilder.CreateSphere(`gf_power_wisp_${idx}_${i}`, { diameter: 0.28, segments: 6 }, orch.scene);
      wisp.parent = root;
      wisp.position.set(Math.cos((Math.PI * 2 * i) / 3) * 0.72, 0.15 + i * 0.08, Math.sin((Math.PI * 2 * i) / 3) * 0.72);
      wisp.material = material;
      accentMeshes.push(wisp);
    }
  } else if (family === FAMILY.ENTROPIC_VOID) {
    for (let i = 0; i < 4; i += 1) {
      const spike = MeshBuilder.CreateCylinder(`gf_power_spike_${idx}_${i}`, { height: 0.95, diameterTop: 0.02, diameterBottom: 0.18, tessellation: 5 }, orch.scene);
      spike.parent = root;
      spike.position.set(Math.cos((Math.PI * 2 * i) / 4) * 0.55, 0, Math.sin((Math.PI * 2 * i) / 4) * 0.55);
      spike.rotation.z = Math.PI / 2.8;
      spike.rotation.y = (Math.PI * 2 * i) / 4;
      spike.material = material;
      accentMeshes.push(spike);
    }
  } else if (family === FAMILY.BIOFRACTAL_AEGIS) {
    for (let i = 0; i < 3; i += 1) {
      const petal = MeshBuilder.CreateDisc(`gf_power_petal_${idx}_${i}`, { radius: 0.42, tessellation: 5 }, orch.scene);
      petal.parent = root;
      petal.position.y = -0.08 + i * 0.12;
      petal.rotation.x = Math.PI / 2;
      petal.rotation.z = (Math.PI * 2 * i) / 3;
      petal.material = material;
      accentMeshes.push(petal);
    }
  } else {
    for (let i = 0; i < 2; i += 1) {
      const halo = MeshBuilder.CreateTorus(`gf_power_halo_${idx}_${i}`, { diameter: 1.25 + i * 0.28, thickness: 0.05, tessellation: 18 }, orch.scene);
      halo.parent = root;
      halo.rotation.x = i === 0 ? Math.PI / 4 : -Math.PI / 4;
      halo.rotation.y = i * 0.8;
      halo.material = material;
      accentMeshes.push(halo);
    }
  }

  return accentMeshes;
}

function getFamilyColor3(family) {
  const rgb = FAMILY_META[family]?.color || [0.85, 0.2, 0.6];
  return new Color3(rgb[0], rgb[1], rgb[2]);
}

function disposePowerSpawnVisual(spawn) {
  if (!spawn?.mesh) return;
  spawn.mesh.dispose(false, true);
  spawn.mesh = null;
  spawn.visualPowerId = null;
}

// ── 20.20 — Audio Helpers ───────────────────────────────────────────────────

/**
 * Play a simple synthesized tone (event cue).
 * Uses Web Audio API — no pre-loaded samples required.
 */
function playTone(orch, frequency, duration, volume = 0.3) {
  try {
    if (!orch.audioCtx) {
      orch.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const ctx = orch.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {
    // Audio not available — silently skip
  }
}

// ── 20.23 — Persistence Helpers ─────────────────────────────────────────────

const PERSIST_KEY = 'twistedkart_gloflux_progress';

/**
 * Load persisted gloFLUX progress from localStorage.
 * @returns {{ matchesPlayed: number, familyMastery: object, seedBadges: string[], bestChain: number }}
 */
export function loadGloFluxProgress() {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return _defaultProgress();
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return _defaultProgress();
    return {
      matchesPlayed: Number(data.matchesPlayed) || 0,
      familyMastery: data.familyMastery || {},
      seedBadges: Array.isArray(data.seedBadges) ? data.seedBadges.slice(0, 100) : [],
      bestChain: Number(data.bestChain) || 0,
    };
  } catch (_) {
    return _defaultProgress();
  }
}

/**
 * Save gloFLUX progress after a match.
 * @param {{ matchesPlayed: number, familyMastery: object, seedBadges: string[], bestChain: number }} progress
 */
export function saveGloFluxProgress(progress) {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      matchesPlayed: Math.min(Number(progress.matchesPlayed) || 0, 99999),
      familyMastery: progress.familyMastery || {},
      seedBadges: (progress.seedBadges || []).slice(0, 100),
      bestChain: Math.min(Number(progress.bestChain) || 0, 999),
    }));
  } catch (_) {
    // Storage not available
  }
}

function _defaultProgress() {
  return { matchesPlayed: 0, familyMastery: {}, seedBadges: [], bestChain: 0 };
}

/** 20.23 — Save match results to localStorage persistence. */
function _persistMatchResult(orch, results) {
  try {
    const progress = loadGloFluxProgress();
    progress.matchesPlayed += 1;
    if (results.seedBadge && !progress.seedBadges.includes(results.seedBadge)) {
      progress.seedBadges.push(results.seedBadge);
    }
    // Track best chain from telemetry
    const telemetryChain = orch.network?.telemetry?.longestChain || 0;
    if (telemetryChain > progress.bestChain) {
      progress.bestChain = telemetryChain;
    }
    saveGloFluxProgress(progress);
  } catch (_) {
    // Non-critical
  }
}