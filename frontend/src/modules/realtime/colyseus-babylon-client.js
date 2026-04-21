import { Client } from "colyseus.js";
import {
  Engine,
  Scene,
  Vector3,
  Matrix,
  Quaternion,
  FollowCamera,
  DirectionalLight,
  HemisphericLight,
  MeshBuilder,
  HavokPlugin,
  SceneLoader,
  PhysicsAggregate,
  PhysicsShapeType,
  PhysicsMotionType,
  PhysicsRaycastResult,
  StandardMaterial,
  Color3,
  Color4,
  PostProcess,
  Effect,
  VertexBuffer,
} from "@babylonjs/core";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { navigateWithTransition } from '../../ui/page-transition.js';
import {
  createGloUnderglow, updateGloUnderglow, setGloVisible, disposeGloUnderglow,
} from './glo-underglow.js';
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import HavokPhysics from "@babylonjs/havok";
import { resolveTrackAsset, resolveArenaAsset, resolveKartAsset, ALL_ARENAS, WEAPON_SETS } from "../content-registry.js";
import { FILTER, LAYER, applyFilterToAggregate } from './collision-layers.js';
import { GRID_SIZE } from '../track-placement.js';
import {
  CUSTOM_ARENA_DIR,
  getFallbackSegmentFootprint,
  oppositeCustomArenaDir,
  resolveCustomArenaSegmentSpec,
} from '../custom-arena-segments.js';
import {
  createFallbackPortAnchors,
  getSegmentWorldConnectors,
} from '../custom-arena-anchors.js';
import { buildCustomArenaSegmentVisual } from '../custom-arena-procedural.js';
import { createMinimap, updateMinimapPlayers, createBattleMinimap, updateBattleMinimapPlayers } from '../minimap.js';
import { initParticles, updateParticles, disposeParticles, emitWeaponExplosion, emitShieldBreak, createProjectileTrail, disposeProjectileTrail, resetParticleBudget, emitItemBoxShatter } from '../babylon-particles.js';
import { initGamepad, pollGamepad, disposeGamepad } from '../gamepad-input.js';
import { getBindings, disposeControlsOverlay } from '../input-config.js';
import { pause as pauseGame, resume as resumeGame, isPaused } from '../pause-menu.js';
import {
  applyKartDriving, createDriftState, raycastWheels, computeBodyPitchRoll,
  computeSuspension, computeSteerLean, computeAccelLean,
  syncVehicleGroundState,
} from '../kart-physics.js';
import { KartEntity, createLocalKartEntity, createRemoteKartEntity } from './kart-entity.js';
import { createKartRaycastVehicle } from '../raycast-vehicle.js';
import { KartVFX, VFXState } from './kart-vfx.js';
import {
  playTrackMusic, playSFX, playWeaponFireSFX, playWeaponHitSFX,
  playAnomalyCue, playWeaponImpactSynth, playHitConfirmSFX,
  playEliminationSFX, playHeartbeat, playBalloonPop,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playCountdownSequence, stopBGM, disposeAudio,
  playBattleMusic, setBattleMusicIntensity, setBattleMusicDead, playMissileLockTone,
  startAmbientLoop, stopAmbientLoop, updateBoundaryWarning,
} from "../game-audio.js";
import {
  showHitConfirm, showKOOverlay, hideKOOverlay,
  showRespawnText, hideRespawnText, updateLowHealthWarning,
  showDamageDirection, showOffscreenDamageArrow,
  createScoreDisplay, updateScoreDisplay, showScoreboard, hideScoreboard,
  startItemRoulette, isRouletteActive,
  createLockReticle, updateLockReticle,
} from '../battle-hud.js';
import {
  createBattleGUIHud, disposeBattleGUIHud,
  updateGUIHealthBar, flashGUIHealthDamage, updateGUILives,
  updateGUIWeapon, updateGUIScore, pulseGUIWeaponSlot, pulseGUIReserveSlot,
  showGUIStatusLane, clearGUIStatusLane, showGUIArenaMood, clearGUIArenaMood,
  updateGUIBattleTelemetry, updateGUILockTelemetry,
} from '../battle-gui-hud.js';
import * as PrematchLobby from './prematch-lobby.js';
import { generateMapDefinition } from '../map-definition-generator.js';
import {
  loadBattleAssets, disposeBattleAssets, playWeaponFireSound, playWeaponHitSound,
  playBattleSound, areBattleAssetsLoaded,
} from '../battle/battle-assets.js';
import { createBananaModel } from '../battle/weapon-models.js';
import {
  initBattleVFX, disposeBattleVFX, emitMuzzleFlash, emitBattleExplosion,
  emitFrostImpact, emitLightningStrike, emitBlackHoleVortex, emitKillCelebration,
  emitFireBurst, emitShockwaveRing, shakeCamera, showHitMarkerVFX,
  showMultiKillBanner, flashDamageVignette, emitWeaponImpactVFX, emitStreamImpactVFX,
  emitTeslaArcBetween, emitPhaseSwapBurst, emitFinalFusionBurst, emitNuclearFissionDetonation,
} from '../battle/battle-vfx.js';
import { createWeaponModel, createItemBoxModel } from '../battle/weapon-models.js';
import { createLockState, tickLockOn } from '../weapons/targeting.js';
import { initWeaponFXEnhance, disposeWeaponFXEnhance, tickDecals, syncWeaponFXQuality } from '../battle/weapon-fx-enhance.js';
import { detectPerformanceTier, forcePerformanceTier, startAdaptiveMonitor, stopAdaptiveMonitor, getTier, TIER, updateRuntimePerformanceBudget, runtimeFXBudget, runtimePostFXBudget, runtimePressure } from '../perf-tier.js';

const HAVOK_WASM_PUBLIC_PATH = `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`;
const CUSTOM_ARENA_DIR_VECTORS = {
  [CUSTOM_ARENA_DIR.N]: { x: 0, z: -GRID_SIZE },
  [CUSTOM_ARENA_DIR.E]: { x: GRID_SIZE, z: 0 },
  [CUSTOM_ARENA_DIR.S]: { x: 0, z: GRID_SIZE },
  [CUSTOM_ARENA_DIR.W]: { x: -GRID_SIZE, z: 0 },
};
const MAX_QUEUED_PROJECTILE_EVENTS = 120;
const MAX_QUEUED_IMPACT_EVENTS = 120;
const MAX_QUEUED_CRASH_EVENTS = 48;
const MAX_PENDING_INPUTS = 180;
const COLYSEUS_PROTOCOL_NAMES = {
  9: 'HANDSHAKE',
  10: 'JOIN_ROOM',
  11: 'ERROR',
  12: 'LEAVE_ROOM',
  13: 'ROOM_DATA',
  14: 'ROOM_STATE',
  15: 'ROOM_STATE_PATCH',
  16: 'ROOM_DATA_SCHEMA',
  17: 'ROOM_DATA_BYTES',
};

function emitPlaytestProgress(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('glo-playtest-progress', { detail }));
  if (window.__gloDebug) {
    window.__gloDebug.playtestProgress = detail;
  }
}

const WEAPON_DISPLAY = {
  missile: { icon: "ðŸš€", hue: "#ff7448", accent: "#ffd1b8", category: "Projectile" },
  crimson_hydra: { icon: "ðŸ‰", hue: "#ff425d", accent: "#ffd0d8", category: "Projectile", displayName: "Crimson Hydra" },
  bowling_ball: { icon: "ðŸŽ³", hue: "#9aa3b7", accent: "#eef3ff", category: "Projectile" },
  shield: { icon: "ðŸ›¡ï¸", hue: "#55bbff", accent: "#c7efff", category: "Defence" },
  cake: { icon: "ðŸŽ‚", hue: "#ffb347", accent: "#fff0c8", category: "Projectile" },
  plunger: { icon: "ðŸª ", hue: "#f85b44", accent: "#ffd7cc", category: "Projectile" },
  nitro: { icon: "ðŸ’¥", hue: "#12d59c", accent: "#d8fff2", category: "Projectile" },
  bubblegum: { icon: "ðŸ«§", hue: "#ff73cb", accent: "#ffe2f5", category: "Trap" },
  banana: { icon: "ðŸŒ", hue: "#f6d53f", accent: "#fff6ba", category: "Trap" },
  swatter: { icon: "ðŸª°", hue: "#ff8f6b", accent: "#ffe0d6", category: "Melee" },
  parachute: { icon: "ðŸª‚", hue: "#8fb6ff", accent: "#e2ecff", category: "Debuff" },
  anchor: { icon: "âš“", hue: "#83a7c8", accent: "#e0eef9", category: "Debuff" },
  ludicrous_mode: { icon: "ðŸ”‹", hue: "#ff00ff", accent: "#ff99ff", category: "Buff" },
  pirateleportation: { icon: "ðŸ´â€â˜ ï¸", hue: "#9b59b6", accent: "#e8d5f5", category: "Utility" },
  mirror_realm: { icon: "ðŸªž", hue: "#91d6ff", accent: "#e8f8ff", category: "Defence" },
  phase_shift: { icon: "ðŸ‘»", hue: "#9ef2d0", accent: "#ebfff8", category: "Defence" },
  weather_dominion: { icon: "â›ˆï¸", hue: "#7ab4ff", accent: "#e2f0ff", category: "Utility" },
  fireball: { icon: "ðŸ”¥", hue: "#ff7a30", accent: "#ffd6bf", category: "Elemental" },
  toxic_spread: { icon: "â˜£ï¸", hue: "#6fd34a", accent: "#e6ffd9", category: "Elemental" },
  ice_lance: { icon: "ðŸ§Š", hue: "#74d3ff", accent: "#e6f8ff", category: "Elemental" },
  tornado: { icon: "ðŸŒªï¸", hue: "#93e0c2", accent: "#e8fff4", category: "Elemental" },
  super_nova: { icon: "â˜¢ï¸", hue: "#f6d64a", accent: "#fff7bf", category: "Elemental", displayName: "Final Fusion" },
  rock_barrage: { icon: "ðŸª¨", hue: "#b08b67", accent: "#f2e6d9", category: "Elemental" },
  lightning_bolt: { icon: "âš¡", hue: "#c6ccff", accent: "#f0f2ff", category: "Elemental" },
  wind_slash: { icon: "ðŸ’¨", hue: "#9de7c8", accent: "#eefff7", category: "Elemental" },
  toxic_cloud: { icon: "ðŸ§ª", hue: "#5bb33d", accent: "#dbffd0", category: "Elemental" },
  glow_thrower: { icon: "ðŸ”¥", hue: "#ff0080", accent: "#ff99cc", category: "Stream", displayName: "Glo Thrower" },
  glo_burst: { icon: "ðŸ’ ", hue: "#00e5ff", accent: "#b3f5ff", category: "Stream", displayName: "Glo Burst" },
};

const PROJECTILE_MODEL_ALIASES = {
  bowling_ball: 'bowling',
  missile: 'guided_missile',
  crimson_hydra: 'guided_missile',
};

const DEBUG_WM_WEAPON_CYCLE = [
  'fireball',
  'toxic_spread',
  'ice_lance',
  'tornado',
  'super_nova',
  'rock_barrage',
  'lightning_bolt',
  'wind_slash',
  'toxic_cloud',
];

const BATTLE_IMPACT_SYNTH_WEAPONS = new Set([
  'black_hole',
  'lightning_bolt',
  'plasma_railgun',
  'shockwave_cannon',
  'super_nova',
]);

const GLO_BURST_WARMUP_MS = 90;
const GLO_BURST_FIRE_INTERVAL_MS = 60;
const STREAM_SECONDARY_FIRE_INTERVAL_MS = 45;

function collectWorldVerticesFromMeshes(meshes) {
  const vertices = [];
  for (const mesh of meshes) {
    if (typeof mesh.getVerticesData !== 'function') continue;
    const positions = mesh.getVerticesData('position');
    if (!positions?.length) continue;
    const world = mesh.computeWorldMatrix(true);
    for (let index = 0; index < positions.length; index += 3) {
      const raw = new Vector3(positions[index], positions[index + 1], positions[index + 2]);
      vertices.push(Vector3.TransformCoordinates(raw, world));
    }
  }
  return vertices;
}

export class ColyseusBabylonClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "ws://localhost:2567";
    this.roomName = options.roomName || "race_room";
    this.playerName = options.playerName || "Player";
    this.maxPlayers = options.maxPlayers || 12;
    this.gameType = options.gameType || "deathmatch";
    this.performanceMode = options.performanceMode === 'ultra_low' ? 'ultra_low' : 'auto';

    this.client = new Client(this.endpoint);
    this.room = null;

    this.engine = null;
    this.scene = null;
    this.localMesh = null;
    this.remoteMeshes = new Map();
    this.entityMeshes = new Map();
    this.loadingPromises = new Map();
    this.entityAggregates = new Map();      // entityId â†’ PhysicsAggregate
    this.remoteKartAggregates = new Map();  // playerId â†’ PhysicsAggregate
    this._remoteTargets = new Map();           // playerId â†’ { pos: Vector3, rot: Quaternion }
    this._remoteWheelMeshes = new Map();       // playerId â†’ mesh[] (wheel child meshes)
    this._projectileTargets = new Map();       // entityId â†’ { pos, vel, lastUpdate, subType }
    /** @type {KartEntity|null} */
    this._localKartEntity = null;
    /** @type {KartVFX|null} */
    this._localKartVFX = null;
    /** @type {Map<string, KartEntity>} */
    this._remoteKartEntities = new Map();
    /** @type {Map<string, KartVFX>} */
    this._remoteKartVFXs = new Map();
    this.havokPlugin = null;

    this.inputSeq = 0;
    this.pendingInputs = [];
    this.authoritativeState = null;
    this.started = false;
    this.localInitializedFromServer = false;
    this._latestRealtimeInput = {
      throttle: 0,
      steer: 0,
      brake: false,
      drift: false,
      firePrimary: false,
      fireSecondary: false,
    };
    this._inputKeepaliveMs = 100;
    this._inputKeepaliveInterval = null;

    // Weapon state â€” dual weapon system + reserve
    this.currentWeapon = "";        // primary (always glo_burst)
    this.currentWeapon2 = "";       // secondary (pickup slot)
    this.reserveWeapon = "";        // reserve (MK-style backup)
    this.reserveAmmo = 0;
    this._localCombatState = {
      weapon: "",
      displayWeapon: "",
      ammo: 0,
      fireCooldown: 0,
      overheat: 0,
      overheated: false,
      effectType: "",
      shielded: false,
      shieldHP: 0,
      maxCooldownMs: 0,
      // Secondary slot
      weapon2: "",
      ammo2: 0,
      fireCooldown2: 0,
      maxCooldownMs2: 0,
      // Reserve slot
      weapon3: "",
      ammo3: 0,
    };
    this._firePressedLastFrame = false;
    this._fire2PressedLastFrame = false;
    this._swapSecondaryPressedLastFrame = false;
    this._missileLockState = createLockState({
      maxRange: 85,
      minRange: 4,
      halfAngle: Math.PI / 4.5,
      acquireTime: 0.52,
      loseTime: 0.24,
      stickyBonus: 0.2,
      maxScreenOffsetNorm: 0.56,
      centerBias: 0.92,
      edgePenalty: 1.42,
      minAcquireScale: 0.34,
    });
    this._missileLockTargetId = null;
    this._missileLockProgress = 0;
    this._missileLockScreenX = null;
    this._missileLockScreenY = null;
    this._lastMissileLockToneAt = 0;
    this._missileLockWasLocked = false;
    this._lastRockImpactTime = 0;
    this._lastRockImpactPos = null;
    this._lastFinalFusionBurstAt = 0;
    this._tmpProjectileRotation = new Quaternion();
    this._queuedProjectileFires = [];
    this._queuedProjectileHits = [];
    this._queuedKartCrashes = [];
    this._suppressedEntityIds = new Set();
    this._debugScenarioTimer = null;
    this._debugScenarioCleanup = null;
    this._remoteInterpolationBeforeRender = null;
    this._inputPollingBeforeRender = null;
    this._primaryWarmupUntil = 0;
    this._lastPrimaryFireSentAt = 0;

    // Active effect state
    this.activeEffect = "";      // current effect type on local player
    this.effectOverlayEl = null;  // DOM overlay for blind/status effects
    this._effectOverlayTimer = null;
    this._arenaEffectOverlayEl = null;
    this._arenaEffectOverlayTimer = null;
    this._arenaEnvironmentBase = null;
    this._arenaWeatherType = "";

    // Keyboard input state
    this._keys = {};
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onWindowBlur = null;
    this._onVisibilityChange = null;
    this._onResize = null;
    this._automationMode = typeof navigator !== 'undefined'
      && !!navigator.webdriver
      && /HeadlessChrome/i.test(navigator.userAgent || '');
    this._lastPerfSampleAt = 0;
    this._hardwareScalingLevel = 1;
    this._lastPerfSnapshot = {
      players: 1,
      drawCalls: 0,
      particles: 0,
      particleSystems: 0,
      projectiles: 0,
      tier: getTier(),
      fxBudget: runtimeFXBudget(),
      postFXBudget: runtimePostFXBudget(),
      pressure: runtimePressure(),
    };
    this._debugWeaponCycleIndex = 0;

    // Lap / race progress
    this._lapHudEl = null;
    this._lapCount = 0;
    this._totalLaps = 3;
    this._raceFinished = false;
    this._lapCooldownUntil = 0;   // timestamp â€” ignore finish-line triggers before this

    // â”€â”€ Mini-turbo drift state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._driftCharge     = 0;
    this._wasDrifting     = false;
    this._miniBoostTimer  = 0;
    this._miniBoostTier   = 0;  // 0=none, 1=blue, 2=orange
    this._prevDriftTier   = 0;
    this._prevBoostActive = false;
    // Phase 21: shared drift state object for kart-physics.js
    this._driftState      = createDriftState();
    this._pendingPickupBoxes = new Map();
    // Phase 21: FOV / camera feel
    this._baseFOV         = 75 * (Math.PI / 180);  // base FOV in radians
    this._maxFOV          = 85 * (Math.PI / 180);  // max FOV at top speed
    // Phase 21 Block C: death/respawn state machine
    this._deathState      = null; // { phase:'dead'|'respawning', timer, deathPos }
    this._invulnTimer     = 0;
    this._invulnBlinkOn   = true;
    this._localHealth     = 100;
    this._localLives      = 3;
    this._heartbeatTimer  = 0;
    this._timeSyncInterval = null;
    this._metricsPollInterval = null;
    this._syncDebugPanelEl = null;
    this._networkStats = {
      patchRateMs: 100,
      baseInterpolationDelayMs: 110,
      interpolationDelayMs: 110,
      rttMs: 0,
      jitterMs: 0,
      clockOffsetMs: 0,
      authoritative: false,
      lastTimeSyncAt: 0,
    };

    // â”€â”€ Automated-test debug bus â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // window.__gloDebug is read by Playwright specs to assert game state without
    // relying purely on fragile console-log scraping.
    if (typeof window !== 'undefined') {
      window.__gloDebug = {
        trackPhysicsCount: 0,   // colliders created by _createTrackPhysics
        kartLoaded: false,      // kart GLB loaded successfully
        kartVisible: false,     // kart revealed on GO
        matchLive: false,       // matchLive received
        roomJoined: false,      // Colyseus room joined
        sessionId: null,        // this player's Colyseus session id
        playerCount: 0,         // number of players in room state
        spawnPos: null,         // { x, y, z } spawn point
        effectiveKartScale: null, // final kart scale applied
        lastWeaponReceived: null, // weapon string from itemReceived
        lastWeaponFired: null,    // subType from projectileFired
        lastHitVictimId: null,    // victimId from projectileHit
        lastEffect: null,         // effect type from effectApplied
        lastShieldAbsorbed: null, // victimId from shieldAbsorbed
        lastKartCrash: null,      // latest kartCrash payload for local player
        lastArenaEffect: null,    // current arena effect id
        lastAnomalyCue: null,     // last procedural anomaly audio cue fired
        matchEnded: null,         // full matchEnd message
        network: null,            // rtt / jitter / interpolation stats
        syncMetrics: null,        // latest server metrics snapshot
        weaponState: null,        // local authoritative weapon/effect state
        lowLevelFrames: [],       // raw Colyseus frames observed on the socket
        readySignalSent: false,   // explicit ready gate signal sent to server
        errors: [],               // runtime JS errors captured internally
        burstQueues: null,        // queued Colyseus burst counts
        performanceMode: this.performanceMode,
      };
    }

    // GLO underglow system (shader decal + trail)
    this._gloKit = null;           // local player's GLO kit
    this._remoteGloKits = new Map(); // sessionId â†’ GLO kit for remote players

    // Kart pre-match state
    this._kartReady       = false;   // true only after matchLive fires
    this._matchLiveHandled = false;
    this._autoStartTimer = null;
    this._stateCatchupTimer = null;
    this._clientReadySent = false;
    this._lastReadySignalAt = 0;
    this._countdownStartAt = 0;
    this._countdownAudioTimer = null;
    this._countdownVisualTimer = null;
    this._lowLevelTraceInstalled = false;
    this._wheelMeshes     = [];      // child meshes whose name contains "wheel" â€” rotated by speed
    this._targetCamRadius = 12;      // camera's ideal follow radius (may shorten for wall-clip avoidance)
    this._arenaKartScale  = null;    // per-arena kart scale override from content-registry

    // â”€â”€ Camera view modes (C key cycles) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this._cameraMode = 0;
    this._cameraModes = [
      { name: 'Chase',  radius: 12, height: 6,   fovBase: 75, accel: 0.035, maxSpeed: 12 },
      { name: 'Low Behind', radius: 8.5, height: 2.2, fovBase: 78, accel: 0.05, maxSpeed: 15 },
      { name: 'Close',  radius: 4.75,  height: 2.55, fovBase: 80, accel: 0.07,  maxSpeed: 20 },
    ];
  }

  _setSceneBeforeRender(slot, callback) {
    if (!this.scene || typeof callback !== "function") return;
    const existing = this[slot];
    if (existing) {
      this.scene.unregisterBeforeRender(existing);
    }
    this[slot] = callback;
    this.scene.registerBeforeRender(callback);
  }

  _clearSceneBeforeRender(slot) {
    const callback = this[slot];
    if (!callback || !this.scene) {
      this[slot] = null;
      return;
    }
    this.scene.unregisterBeforeRender(callback);
    this[slot] = null;
  }

  _allowRemoteVisualFlair() {
    if (this.performanceMode === 'ultra_low') return false;
    return getTier() !== TIER.LOW && runtimePressure() < 0.58;
  }

  _allowLocalVisualFlair() {
    if (this.performanceMode === 'ultra_low') return false;
    return !(getTier() === TIER.LOW && runtimePressure() >= 0.42);
  }

  _allowBattleHudPolish() {
    return this.performanceMode !== 'ultra_low';
  }

  _allowBattleImpactPolish() {
    return this.performanceMode !== 'ultra_low' && runtimeFXBudget() > 0.34;
  }

  _allowBattleCameraJuice() {
    return this.performanceMode !== 'ultra_low';
  }

  _allowBattleMinimap() {
    return this.performanceMode !== 'ultra_low';
  }

  _allowArenaAmbience() {
    return this.performanceMode !== 'ultra_low';
  }

  _shedLocalVisualOverhead() {
    if (this._allowLocalVisualFlair()) return;
    if (this._localKartVFX) {
      try { this._localKartVFX.dispose(); } catch (_) {}
      this._localKartVFX = null;
    }
    if (this._gloKit) {
      try { disposeGloUnderglow(this._gloKit); } catch (_) {}
      this._gloKit = null;
    }
  }

  _shedRemoteVisualOverhead() {
    if (this._allowRemoteVisualFlair()) return;
    this._remoteKartVFXs.forEach((remoteVFX) => {
      try { remoteVFX?.dispose?.(); } catch (_) {}
    });
    this._remoteKartVFXs.clear();
    this._remoteGloKits.forEach((kit) => {
      try { disposeGloUnderglow(kit); } catch (_) {}
    });
    this._remoteGloKits.clear();
  }

  _computeTargetHardwareScaling(perfSnapshot = null) {
    const tier = getTier();
    const pressure = Number(perfSnapshot?.pressure ?? runtimePressure() ?? 0);
    const snapshotPlayers = perfSnapshot?.players;
    const authoritativePlayers = this.authoritativeState?.players?.size;
    const roomPlayers = this.room?.state?.players?.size;
    const players = Math.max(1, Number(snapshotPlayers ?? authoritativePlayers ?? roomPlayers ?? 1));
    const fps = Math.max(1, Number(this.engine?.getFps?.() || 60));
    let scale = this.performanceMode === 'ultra_low'
      ? 2.2
      : tier === TIER.LOW ? 1.7 : tier === TIER.MEDIUM ? 1.3 : 1.0;

    if (players >= 4) scale += 0.45;
    else if (players >= 3) scale += 0.2;

    if (pressure >= 0.9) scale += 1.1;
    else if (pressure >= 0.75) scale += 0.85;
    else if (pressure >= 0.6) scale += 0.55;
    else if (pressure >= 0.45) scale += 0.3;

    if (fps < 18) scale += 0.55;
    else if (fps < 24) scale += 0.35;
    else if (fps < 30) scale += 0.2;

    return Math.max(1, Math.min(3, Math.round(scale * 20) / 20));
  }

  _syncHardwareScaling(perfSnapshot = null, force = false) {
    if (!this.engine) return;
    const nextScale = this._computeTargetHardwareScaling(perfSnapshot);
    if (!force && Math.abs(nextScale - (this._hardwareScalingLevel || 1)) < 0.05) return;
    this.engine.setHardwareScalingLevel(nextScale);
    this._hardwareScalingLevel = nextScale;
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.hardwareScalingLevel = nextScale;
    }
  }

  async initBabylon(canvas) {
    this.engine = new Engine(canvas, true);
    detectPerformanceTier(this.engine);
    if (this.performanceMode === 'ultra_low') {
      forcePerformanceTier(TIER.LOW);
    }
    console.log('[PerfTier] Detected tier:', getTier());
    this.scene = new Scene(this.engine);
    this._syncHardwareScaling(null, true);
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.performanceMode = this.performanceMode;
    }
    this.scene.useRightHandedSystem = true; // Phase 1: STK uses right-handed

    // GLO animation â€” no longer needs GlowLayer (shaders handle glow internally)
    this._gloTime = 0;

    const initialCameraMode = this._cameraModes[this._cameraMode];

    // Setup FollowCamera
    this.camera = new FollowCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.radius = initialCameraMode.radius;
    this.camera.heightOffset = initialCameraMode.height;
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = initialCameraMode.accel;
    this.camera.maxCameraSpeed = initialCameraMode.maxSpeed;
    this.camera.minZ = 0.1;             // prevent near-clip artifacts inside tunnels/walls
    this.camera.fov = this._baseFOV;    // Phase 21: dynamic FOV starts at base
    this._targetCamRadius = initialCameraMode.radius;
    // this.camera.attachControl(canvas, true); // Removed to fix console warnings

    const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.6;
    const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), this.scene);
    dirLight.intensity = 0.8;
    dirLight.position = new Vector3(20, 40, 20);

    try {
      const hk = await HavokPhysics({
        locateFile: (path) => (path.endsWith(".wasm") ? HAVOK_WASM_PUBLIC_PATH : path),
      });
      const plugin = new HavokPlugin(true, hk);
      // Task 3.1: Match solo gravity (-20) for consistent feel across modes
      this.scene.enablePhysics(new Vector3(0, -20, 0), plugin);
      this.havokPlugin = plugin;
    } catch (error) {
      console.error("[realtime] Havok init failed, continuing without physics", error);
    }

    // â”€â”€ Smooth interpolation for remote karts + GLO animation â”€â”€
    this._setSceneBeforeRender("_remoteInterpolationBeforeRender", () => {
      resetParticleBudget(); // (21.39) reset per-frame particle emission budget
      const dtSeconds = this.engine.getDeltaTime() / 1000;
      const nowMs = performance.now();
      this._drainBurstQueues();
      const lerpAlpha = this._getRemoteInterpolationAlpha(dtSeconds);
      const extrapolationMs = Math.min(
        this._networkStats.interpolationDelayMs * 0.35,
        this._networkStats.patchRateMs * 1.5,
      );

      for (const [id, target] of this._remoteTargets.entries()) {
        const mesh = this.remoteMeshes.get(id);
        if (!mesh || !mesh.position) continue;
        const renderPos = target.renderPos || (target.renderPos = new Vector3());
        renderPos.copyFrom(target.pos);
        if (target.vel) {
          renderPos.x += target.vel.x * (extrapolationMs / 1000);
          renderPos.y += target.vel.y * (extrapolationMs / 1000);
          renderPos.z += target.vel.z * (extrapolationMs / 1000);
        }

        const preLerpDist = Math.sqrt(
          (renderPos.x - mesh.position.x) ** 2 +
          (renderPos.z - mesh.position.z) ** 2
        );
        Vector3.LerpToRef(mesh.position, renderPos, lerpAlpha, mesh.position);
        if (mesh.rotationQuaternion && target.rot) {
          Quaternion.SlerpToRef(mesh.rotationQuaternion, target.rot, lerpAlpha, mesh.rotationQuaternion);
        }
        // â”€â”€ Wheel spin for remote karts â”€â”€
        const wheels = this._remoteWheelMeshes.get(id);
        if (wheels && runtimePressure() < 0.72) {
          const rotAmt = preLerpDist * lerpAlpha * 2.5;
          for (const w of wheels) w.rotation.x -= rotAmt;
        }
        // â”€â”€ Steering visuals for remote karts (synced steer input) â”€â”€
        const remoteEntity = this._remoteKartEntities.get(id);
        if (remoteEntity) {
          const speed = target.vel ? Math.sqrt(target.vel.x ** 2 + target.vel.z ** 2) : 0;
          remoteEntity.applySteerVisuals(target.steer || 0, speed);
        }
      }

      // Animate GLO underglow each frame (local + remote)
      const dt = dtSeconds;
      if (this._gloKit) updateGloUnderglow(this._gloKit, dt);
      this._remoteGloTick = (this._remoteGloTick || 0) + 1;
      const remoteGloStride = runtimePressure() > 0.72 ? 4 : runtimePressure() > 0.45 ? 2 : 1;
      if (this._allowRemoteVisualFlair() && (this._remoteGloTick % remoteGloStride) === 0) {
        for (const kit of this._remoteGloKits.values()) {
          updateGloUnderglow(kit, dt * remoteGloStride);
        }
      }

      // â”€â”€ Smooth projectile interpolation â€” velocity extrapolation + facing â”€â”€
      for (const [id, pt] of this._projectileTargets.entries()) {
        const mesh = this.entityMeshes.get(id);
        if (!mesh || !mesh.isEnabled()) {
          this._projectileTargets.delete(id);
          continue;
        }

        const isTrap = pt.subType === 'bubblegum' || pt.subType === 'banana';
        if (isTrap) continue; // traps don't move

        const timeSinceUpdate = (nowMs - pt.lastUpdate) / 1000;
        const predictionWindow = Math.min(timeSinceUpdate, 0.25);
        const predictionWeight = timeSinceUpdate <= 0.25
          ? 1
          : Math.max(0, 1 - (timeSinceUpdate - 0.25) * 3);

        // Extrapolate position using velocity
        mesh.position.x += pt.vel.x * dtSeconds * predictionWeight;
        mesh.position.y += pt.vel.y * dtSeconds * predictionWeight;
        mesh.position.z += pt.vel.z * dtSeconds * predictionWeight;

        // Smooth correction toward last-known server position
        const correctionAlpha = Math.min(1, dtSeconds * 8);
        // Server-extrapolated position (where server thinks it is now)
        const serverX = pt.pos.x + pt.vel.x * predictionWindow;
        const serverY = Math.max(0.35, pt.pos.y + pt.vel.y * predictionWindow);
        const serverZ = pt.pos.z + pt.vel.z * predictionWindow;
        mesh.position.x += (serverX - mesh.position.x) * correctionAlpha;
        mesh.position.y += (serverY - mesh.position.y) * correctionAlpha;
        mesh.position.z += (serverZ - mesh.position.z) * correctionAlpha;

        // Clamp Y to arena floor â€” prevent projectiles from visually sinking below ground
        if (mesh.position.y < 0.35) mesh.position.y = 0.35;

        // Face direction of travel (Y-axis rotation from XZ velocity)
        const speed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        if (speed > 0.5) {
          const targetYaw = Math.atan2(pt.vel.x, pt.vel.z);
          mesh.rotation.y = targetYaw;
          // Pitch for arced projectiles
          if (Math.abs(pt.vel.y) > 0.5) {
            mesh.rotation.x = -Math.atan2(pt.vel.y, speed);
          } else {
            mesh.rotation.x += (0 - mesh.rotation.x) * Math.min(1, dtSeconds * 10);
          }
        }

        // Per-weapon flight animations
        this._animateProjectileFlight(mesh, pt, dtSeconds);

        // Sync physics body if present
        const agg = this.entityAggregates.get(id);
        if (agg?.body) {
          try {
            if (mesh.rotationQuaternion) {
              agg.body.setTargetTransform(mesh.position, mesh.rotationQuaternion);
            } else {
              Quaternion.FromEulerAnglesToRef(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, this._tmpProjectileRotation);
              agg.body.setTargetTransform(mesh.position, this._tmpProjectileRotation);
            }
          } catch (_) {}
        }
      }

      // Update minimap (builds opponents map from remoteMeshes)
      if (this.localMesh) {
        if (this._joinOptions?.gameMode === 'battle' && this._allowBattleMinimap()) {
          updateBattleMinimapPlayers(
            this.localMesh,
            this.room?.sessionId,
            this.remoteMeshes,
            this.authoritativeState?.players,
          );
        } else {
          const opponents = {};
          for (const [id, m] of this.remoteMeshes.entries()) {
            if (m && m.position) opponents[id] = { model: m };
          }
          updateMinimapPlayers(this.localMesh, opponents);
        }
      }

      this._updateMissileLockReticle(dtSeconds);
    });

    // (21.39) Lightweight debug FPS overlay â€” toggle with F3
    this._perfOverlay = null;
    this._perfVisible = false;
    this._perfKeyHandler = (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this._perfVisible = !this._perfVisible;
        if (this._perfOverlay) this._perfOverlay.style.display = this._perfVisible ? 'block' : 'none';
      }
    };
    window.addEventListener('keydown', this._perfKeyHandler);

    this.engine.runRenderLoop(() => {
      this.scene.render();
      tickDecals();
      const nowPerf = performance.now();
      const perfSampleIntervalMs = this._automationMode ? 750 : 200;
      if (!this._lastPerfSampleAt || (nowPerf - this._lastPerfSampleAt) >= perfSampleIntervalMs) {
        this._lastPerfSampleAt = nowPerf;
        const totalDrawCalls = Number(this.scene.getEngine()._drawCalls?.current ?? 0);
        const drawCalls = Math.max(0, totalDrawCalls - (this._lastDrawCallsTotal ?? totalDrawCalls));
        this._lastDrawCallsTotal = totalDrawCalls;
        const particles = this.scene.particleSystems?.reduce((n, ps) => n + (ps.getActiveCount?.() ?? 0), 0) ?? 0;
        const particleSystems = this.scene.particleSystems?.length ?? 0;
        let projectileCount = 0;
        for (const [, mesh] of this.entityMeshes.entries()) {
          if (mesh?._entityType === 'projectile' && mesh.isEnabled?.()) projectileCount++;
        }
        const playerCount = this.authoritativeState?.players?.size || this.room?.state?.players?.size || 1;
        const perfSnapshot = updateRuntimePerformanceBudget({
          players: playerCount,
          particles,
          particleSystems,
          drawCalls,
          projectiles: projectileCount,
          fps: this.engine.getFps(),
        });
        if (playerCount >= 4 && getTier() !== TIER.LOW) {
          forcePerformanceTier(TIER.LOW);
        }
        if (this.performanceMode === 'ultra_low' && getTier() !== TIER.LOW) {
          forcePerformanceTier(TIER.LOW);
        }
        syncWeaponFXQuality();
        this._lastPerfSnapshot = {
          players: playerCount,
          drawCalls,
          particles,
          particleSystems,
          projectiles: projectileCount,
          tier: getTier(),
          fxBudget: Number(perfSnapshot.fxBudget.toFixed(3)),
          postFXBudget: Number(perfSnapshot.postFXBudget.toFixed(3)),
          pressure: Number(perfSnapshot.pressure.toFixed(3)),
        };
        this._syncHardwareScaling(this._lastPerfSnapshot);
        this._shedLocalVisualOverhead();
        this._shedRemoteVisualOverhead();
      }
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.performanceBudget = this._lastPerfSnapshot;
      }
      // Update perf overlay when visible
      if (this._perfVisible) {
        if (!this._perfOverlay) {
          this._perfOverlay = document.createElement('div');
          this._perfOverlay.id = 'perf-overlay';
          this._perfOverlay.style.cssText = 'position:fixed;top:4px;left:4px;background:rgba(0,0,0,0.7);color:#0f0;font:bold 12px monospace;padding:4px 8px;border-radius:4px;z-index:9999;pointer-events:none;';
          document.body.appendChild(this._perfOverlay);
        }
        const fps = this.engine.getFps().toFixed(0);
        const drawCalls = this.scene.getEngine()._drawCalls?.current ?? '?';
        const activeMeshes = this.scene.getActiveMeshes().length;
        const particles = this.scene.particleSystems?.reduce((n, ps) => n + (ps.getActiveCount?.() ?? 0), 0) ?? 0;
        this._perfOverlay.textContent = `FPS: ${fps} | Draw: ${drawCalls} | Mesh: ${activeMeshes} | Ptcl: ${particles} | Tier: ${getTier()} | Scale: ${this._hardwareScalingLevel.toFixed(2)} | FX: ${runtimeFXBudget().toFixed(2)} | PFX: ${runtimePostFXBudget().toFixed(2)} | Load: ${runtimePressure().toFixed(2)}`;
      }
    });
    if (!this._automationMode) {
      startAdaptiveMonitor(this.engine);
    }
    this._onResize = () => this.engine?.resize();
    window.addEventListener("resize", this._onResize);
  }

  /**
   * Create a static trimesh physics body for a glTF scene.
   * We flatten the entire mesh hierarchy into a single merged mesh so that
   * Havok receives one clean trimesh shape with all world transforms baked in.
   * This avoids the parent-child hierarchy issues that caused karts to fall
   * through floors when each sub-mesh got its own PhysicsAggregate.
   */
  _createTrackPhysics(importResult) {
    if (!importResult?.meshes?.length) return;
    if (!this.havokPlugin) {
      console.warn("[realtime] No physics engine â€” skipping track physics");
      this._createFallbackGround();
      return;
    }

    // Collect all geometry-bearing meshes (broader filter for GLTF imports).
    // GLTF __root__ is a TransformNode with no geometry â€” skip it.
    // InstancedMesh shares geometry via sourceMesh â€” include those too.
    // Do NOT filter by isVisible â€” STK exports set isVisible=false on some geometry children.
    const geometryMeshes = importResult.meshes.filter((m) => {
      if (!m.getTotalVertices) return false;
      if (m.getTotalVertices() > 0) return true;
      if (m.sourceMesh && m.sourceMesh.getTotalVertices && m.sourceMesh.getTotalVertices() > 0) return true;
      return false;
    });

    console.log(`[realtime] Geometry meshes found: ${geometryMeshes.length} / ${importResult.meshes.length} total`);

    if (geometryMeshes.length === 0) {
      console.warn("[realtime] Track has zero geometry meshes â€“ using fallback ground");
      this._createFallbackGround();
      return;
    }

    // Ensure world matrices are up-to-date
    this.scene.render(); // force a frame so transforms propagate
    geometryMeshes.forEach((m) => m.computeWorldMatrix(true));

    let physicsCreated = 0;

    for (const mesh of geometryMeshes) {
      try {
        // For InstancedMesh, clone from the sourceMesh with this instance's transform
        const sourceMesh = mesh.sourceMesh || mesh;
        const clone = sourceMesh.clone(`${mesh.name}_collider`, null);
        if (!clone) continue;
        if (typeof clone.makeGeometryUnique === 'function') {
          clone.makeGeometryUnique();
        }

        // If this was an instance, overlay the instance's world transform
        if (mesh.sourceMesh) {
          clone.position.copyFrom(mesh.absolutePosition);
          if (mesh.absoluteRotationQuaternion) {
            clone.rotationQuaternion = mesh.absoluteRotationQuaternion.clone();
          }
          clone.scaling.copyFrom(mesh.absoluteScaling);
        }

        // Bake the full world transform into vertex data
        clone.computeWorldMatrix(true);
        clone.bakeCurrentTransformIntoVertices();
        clone.parent = null;
        clone.position.copyFromFloats(0, 0, 0);
        if (clone.rotationQuaternion) {
          clone.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
        } else {
          clone.rotation.copyFromFloats(0, 0, 0);
        }
        clone.scaling.copyFromFloats(1, 1, 1);
        clone.isVisible = false;

        const agg = new PhysicsAggregate(
          clone, PhysicsShapeType.CONVEX_HULL,
          { mass: 0, friction: 0.6, restitution: 0.05 },
          this.scene
        );
        applyFilterToAggregate(agg, FILTER.TRACK);
        physicsCreated++;
      } catch (err) {
        // Non-fatal â€” some decorative meshes may fail
        console.warn(`[realtime] Physics failed for mesh "${mesh.name}":`, err.message);
      }
    }

    console.log(`[realtime] Track physics: ${physicsCreated}/${geometryMeshes.length} colliders created`);
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.trackPhysicsCount = physicsCreated;
    }

    // Safety net: if no colliders were created, add a large flat ground
    if (physicsCreated === 0) {
      this._createFallbackGround();
    }
  }

  _polishArenaGeometry(importResult, arenaId) {
    if (!importResult?.meshes?.length) return;

    const environmentBoost = arenaId === 'glo_arena' ? 1.2 : 1.0;
    for (const mesh of importResult.meshes) {
      if (!mesh?.getTotalVertices || mesh.getTotalVertices() <= 0) continue;
      mesh.receiveShadows = true;

      const materials = Array.isArray(mesh.material?.subMaterials)
        ? mesh.material.subMaterials.filter(Boolean)
        : (mesh.material ? [mesh.material] : []);

      for (const material of materials) {
        material.backFaceCulling = false;
        if ('roughness' in material && typeof material.roughness === 'number') {
          material.roughness = Math.min(material.roughness, 0.92);
        }
        if ('metallic' in material && typeof material.metallic === 'number') {
          material.metallic = Math.min(material.metallic, 0.18);
        }
        if ('environmentIntensity' in material && typeof material.environmentIntensity === 'number') {
          material.environmentIntensity = Math.max(material.environmentIntensity, environmentBoost);
        }
      }
    }
  }

  // â”€â”€ Per-arena environment: skybox color, fog, lighting tuning â”€â”€â”€â”€â”€â”€
  _setupArenaEnvironment(arenaId) {
    const ENVS = {
      glo_arena:  {
        clear: [0.76, 0.62, 0.43, 1],
        fog: 'exp2',
        fogDensity: 0.0026,
        fogColor: [0.76, 0.62, 0.43],
        hemiInt: 0.92,
        dirInt: 1.18,
        exposure: 1.06,
        contrast: 1.08,
        skyboxImages: [
          '/textures/battle/skybox/px.jpg',
          '/textures/battle/skybox/py.jpg',
          '/textures/battle/skybox/pz.jpg',
          '/textures/battle/skybox/nx.jpg',
          '/textures/battle/skybox/ny.jpg',
          '/textures/battle/skybox/nz.jpg',
        ],
      },
      blockfort:  { clear: [0.45, 0.65, 0.95, 1], fog: 'exp2', fogDensity: 0.003, fogColor: [0.45, 0.65, 0.95], hemiInt: 0.7, dirInt: 1.0 },
      stadium:    { clear: [0.35, 0.55, 0.85, 1], fog: 'exp2', fogDensity: 0.002, fogColor: [0.35, 0.55, 0.85], hemiInt: 0.8, dirInt: 1.0 },
      debug_arena:{ clear: [0.55, 0.62, 0.72, 1], fog: 'none', fogDensity: 0, fogColor: [0.55, 0.62, 0.72], hemiInt: 1.0, dirInt: 1.2 },
      custom_import: { clear: [0.05, 0.08, 0.12, 1], fog: 'none', fogDensity: 0, fogColor: [0.05, 0.08, 0.12], hemiInt: 0.92, dirInt: 1.1, exposure: 1.0, contrast: 1.03 },
      test_box:   { clear: [0.45, 0.65, 0.95, 1], fog: 'exp2', fogDensity: 0.003, fogColor: [0.45, 0.65, 0.95], hemiInt: 0.7, dirInt: 1.0 },
    };
    const env = ENVS[arenaId] || ENVS.test_box;

    this.scene.clearColor = new Color4(env.clear[0], env.clear[1], env.clear[2], env.clear[3]);

    if (env.fog === 'exp2') {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogDensity = env.fogDensity;
      this.scene.fogColor = new Color3(env.fogColor[0], env.fogColor[1], env.fogColor[2]);
    } else {
      this.scene.fogMode = Scene.FOGMODE_NONE;
    }

    // Tune existing lights
    const hemi = this.scene.getLightByName('hemiLight');
    const dir  = this.scene.getLightByName('dirLight');
    if (hemi) hemi.intensity = env.hemiInt;
    if (dir)  dir.intensity  = env.dirInt;

    this.scene.imageProcessingConfiguration.exposure = env.exposure || 1;
    this.scene.imageProcessingConfiguration.contrast = env.contrast || 1;

    if (this._arenaSkybox) {
      this._arenaSkybox.dispose();
      this._arenaSkybox = null;
    }
    if (env.skyboxImages?.length === 6) {
      try {
        const cubeTexture = CubeTexture.CreateFromImages(env.skyboxImages, this.scene);
        this.scene.environmentTexture = cubeTexture;
        this._arenaSkybox = this.scene.createDefaultSkybox(cubeTexture, true, 1400, 0.38);
      } catch (error) {
        console.warn(`[realtime] Arena skybox load failed for '${arenaId}':`, error);
      }
    }

    this._captureArenaEnvironmentBase();
    if (this._arenaWeatherType) {
      this._applyArenaWeatherToScene(this._arenaWeatherType);
    }

    console.log(`[realtime] Arena environment set for '${arenaId}'`);
  }

  _captureArenaEnvironmentBase() {
    if (!this.scene) return;
    const hemi = this.scene.getLightByName('hemiLight');
    const dir = this.scene.getLightByName('dirLight');
    this._arenaEnvironmentBase = {
      clearColor: this.scene.clearColor?.clone?.() || new Color4(0, 0, 0, 1),
      fogMode: this.scene.fogMode,
      fogDensity: Number(this.scene.fogDensity || 0),
      fogColor: this.scene.fogColor?.clone?.() || new Color3(0.55, 0.62, 0.72),
      exposure: Number(this.scene.imageProcessingConfiguration?.exposure || 1),
      contrast: Number(this.scene.imageProcessingConfiguration?.contrast || 1),
      hemiIntensity: typeof hemi?.intensity === 'number' ? hemi.intensity : null,
      dirIntensity: typeof dir?.intensity === 'number' ? dir.intensity : null,
    };
  }

  _lerpColor3(from, to, amount) {
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    return new Color3(
      from.r + (to.r - from.r) * t,
      from.g + (to.g - from.g) * t,
      from.b + (to.b - from.b) * t,
    );
  }

  _lerpColor4(from, to, amount) {
    const t = Math.max(0, Math.min(1, Number(amount) || 0));
    return new Color4(
      from.r + (to.r - from.r) * t,
      from.g + (to.g - from.g) * t,
      from.b + (to.b - from.b) * t,
      from.a + (to.a - from.a) * t,
    );
  }

  _applyArenaWeatherToScene(effectType) {
    if (!this.scene) return;
    if (!this._arenaEnvironmentBase) this._captureArenaEnvironmentBase();
    const base = this._arenaEnvironmentBase;
    if (!base) return;

    const hemi = this.scene.getLightByName('hemiLight');
    const dir = this.scene.getLightByName('dirLight');

    if (effectType === 'arena_rain') {
      this.scene.fogMode = Scene.FOGMODE_EXP2;
      this.scene.fogDensity = Math.max(base.fogDensity * 2.4, 0.0068);
      this.scene.fogColor = this._lerpColor3(base.fogColor, new Color3(0.46, 0.56, 0.7), 0.78);
      this.scene.clearColor = this._lerpColor4(base.clearColor, new Color4(0.18, 0.23, 0.3, base.clearColor.a ?? 1), 0.68);
      this.scene.imageProcessingConfiguration.exposure = base.exposure * 0.84;
      this.scene.imageProcessingConfiguration.contrast = base.contrast * 1.03;
      if (typeof hemi?.intensity === 'number' && base.hemiIntensity != null) hemi.intensity = base.hemiIntensity * 0.68;
      if (typeof dir?.intensity === 'number' && base.dirIntensity != null) dir.intensity = base.dirIntensity * 0.72;
      return;
    }

    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = Math.max(base.fogDensity * 4.5, 0.012);
    this.scene.fogColor = this._lerpColor3(base.fogColor, new Color3(0.84, 0.88, 0.92), 0.72);
    this.scene.clearColor = this._lerpColor4(base.clearColor, new Color4(0.3, 0.34, 0.4, base.clearColor.a ?? 1), 0.5);
    this.scene.imageProcessingConfiguration.exposure = base.exposure * 0.92;
    this.scene.imageProcessingConfiguration.contrast = base.contrast * 0.98;
    if (typeof hemi?.intensity === 'number' && base.hemiIntensity != null) hemi.intensity = base.hemiIntensity * 0.8;
    if (typeof dir?.intensity === 'number' && base.dirIntensity != null) dir.intensity = base.dirIntensity * 0.78;
  }

  _restoreArenaWeatherScene() {
    if (!this.scene || !this._arenaEnvironmentBase) return;
    const base = this._arenaEnvironmentBase;
    const hemi = this.scene.getLightByName('hemiLight');
    const dir = this.scene.getLightByName('dirLight');

    this.scene.clearColor = base.clearColor.clone();
    this.scene.fogMode = base.fogMode;
    this.scene.fogDensity = base.fogDensity;
    this.scene.fogColor = base.fogColor.clone();
    this.scene.imageProcessingConfiguration.exposure = base.exposure;
    this.scene.imageProcessingConfiguration.contrast = base.contrast;
    if (typeof hemi?.intensity === 'number' && base.hemiIntensity != null) hemi.intensity = base.hemiIntensity;
    if (typeof dir?.intensity === 'number' && base.dirIntensity != null) dir.intensity = base.dirIntensity;
  }

  _createFallbackGround() {
    console.warn("[realtime] Creating debug arena (100Ã—100, flat floor + 4 walls)");
    const hasPhysics = typeof this.scene.getPhysicsEngine === 'function' && this.scene.getPhysicsEngine();

    const SIZE = 100;
    const HALF = SIZE / 2;
    const WALL_H = 6;
    const WALL_T = 20; // Thick enough to prevent tunneling at low FPS

    const _box = (name, w, h, d, x, y, z, mat, filter = FILTER.TRACK) => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.receiveShadows = true;
      if (hasPhysics) {
        const agg = new PhysicsAggregate(m, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, this.scene);
        applyFilterToAggregate(agg, filter);
      }
      return m;
    };

    // â”€â”€ Materials â”€â”€
    const matGround = new StandardMaterial("dbg-ground-mat", this.scene);
    // Procedural checkerboard grid texture for spatial reference & VFX visibility
    const GRID_RES = 1024;
    const CELLS = 20;           // 20Ã—20 = 5m per cell at 100Ã—100 arena
    const floorTex = new DynamicTexture("dbg-floor-tex", GRID_RES, this.scene, true);
    const ctx = floorTex.getContext();
    const cellPx = GRID_RES / CELLS;
    const colA = "#4a4e56";     // light tile
    const colB = "#3a3e44";     // dark tile
    for (let r = 0; r < CELLS; r++) {
      for (let c = 0; c < CELLS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? colA : colB;
        ctx.fillRect(c * cellPx, r * cellPx, cellPx, cellPx);
      }
    }
    // Grid lines
    ctx.strokeStyle = "#5a5e66";
    ctx.lineWidth = 2;
    for (let i = 0; i <= CELLS; i++) {
      const p = i * cellPx;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, GRID_RES); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(GRID_RES, p); ctx.stroke();
    }
    // Center crosshair (10m = 2 cells thick)
    ctx.strokeStyle = "#6a6e78";
    ctx.lineWidth = 4;
    const mid = GRID_RES / 2;
    ctx.beginPath(); ctx.moveTo(mid, 0); ctx.lineTo(mid, GRID_RES); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(GRID_RES, mid); ctx.stroke();
    floorTex.update();
    matGround.diffuseTexture = floorTex;
    matGround.specularColor = new Color3(0.12, 0.12, 0.14);

    const matWall = new StandardMaterial("dbg-wall-mat", this.scene);
    matWall.diffuseColor = new Color3(0.22, 0.22, 0.25);

    // â”€â”€ Ground slab (thick box so Havok has a solid collision surface) â”€â”€
    const GROUND_THICKNESS = 2;
    const ground = MeshBuilder.CreateBox("dbg-ground", { width: SIZE, height: GROUND_THICKNESS, depth: SIZE }, this.scene);
    ground.position.y = -GROUND_THICKNESS / 2; // top surface at y=0
    ground.material = matGround;
    ground.receiveShadows = true;
    if (hasPhysics) {
      const gAgg = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.02 }, this.scene);
      applyFilterToAggregate(gAgg, FILTER.TRACK);
    }

    // â”€â”€ 4 Walls (use TRACK filter for solid collision, not BOUNDARY which is for triggers) â”€â”€
    _box("dbg-wall-N", SIZE + WALL_T * 2, WALL_H, WALL_T, 0, WALL_H / 2, -(HALF + WALL_T / 2), matWall, FILTER.TRACK);
    _box("dbg-wall-S", SIZE + WALL_T * 2, WALL_H, WALL_T, 0, WALL_H / 2,  (HALF + WALL_T / 2), matWall, FILTER.TRACK);
    _box("dbg-wall-E", WALL_T, WALL_H, SIZE + WALL_T * 2,  (HALF + WALL_T / 2), WALL_H / 2, 0, matWall, FILTER.TRACK);
    _box("dbg-wall-W", WALL_T, WALL_H, SIZE + WALL_T * 2, -(HALF + WALL_T / 2), WALL_H / 2, 0, matWall, FILTER.TRACK);

    // â”€â”€ Corner markers for orientation (small colored pillars) â”€â”€
    const corners = [
      { name: 'NW', x: -HALF + 3, z: -HALF + 3, color: new Color3(0.9, 0.2, 0.2) },
      { name: 'NE', x:  HALF - 3, z: -HALF + 3, color: new Color3(0.2, 0.4, 0.9) },
      { name: 'SW', x: -HALF + 3, z:  HALF - 3, color: new Color3(0.9, 0.8, 0.15) },
      { name: 'SE', x:  HALF - 3, z:  HALF - 3, color: new Color3(0.2, 0.8, 0.3) },
    ];
    for (const c of corners) {
      const cMat = new StandardMaterial(`dbg-corner-${c.name}`, this.scene);
      cMat.diffuseColor = c.color;
      _box(`dbg-pillar-${c.name}`, 2, 3, 2, c.x, 1.5, c.z, cMat);
    }

    if (!hasPhysics) console.warn('[realtime] Physics not available â€” arena created without collision');

    // Store arena half-size for game-level bounds enforcement
    this._arenaBoundsHalf = HALF;
  }

  async loadSceneAssets(options) {
    let trackInfo;
    let customTrackParsed = null;
    const requestedArenaId = options.arenaId || options.trackId || 'test_box';
    const customTrackBytes = typeof options.customTrackData === 'string'
      ? options.customTrackData.length
      : (options.customTrackData ? JSON.stringify(options.customTrackData).length : 0);

    emitPlaytestProgress({
      phase: 'scene-load',
      label: 'Decoding arena blueprint',
      detail: customTrackBytes ? `${customTrackBytes.toLocaleString()} bytes from builder` : 'No builder arena payload detected',
      progress: 0.28,
    });

    // Check for custom track data from Track Builder
    if (options.customTrackData) {
      try {
        customTrackParsed = typeof options.customTrackData === 'string'
          ? JSON.parse(options.customTrackData) : options.customTrackData;
      } catch (_) { /* ignore parse errors */ }
    }

    console.info('[custom-arena-debug] loadSceneAssets input', {
      gameMode: options.gameMode || null,
      trackId: options.trackId || null,
      arenaId: requestedArenaId,
      customTrackBytes,
      customTrackParsed: !!customTrackParsed,
    });
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.requestedArenaId = requestedArenaId;
      window.__gloDebug.customTrackBytes = customTrackBytes;
      window.__gloDebug.customArenaBuilt = false;
    }

    if (options.gameMode === "battle") {
      trackInfo = resolveArenaAsset(options.trackId);
    } else {
      trackInfo = resolveTrackAsset(options.trackId);
    }

    const buildCustomArena = async (trackData) => {
      const hasPhysics = typeof this.scene.getPhysicsEngine === 'function' && this.scene.getPhysicsEngine();
      const bounds = trackData?.bounds || { min: { x: -40, y: 0, z: -40 }, max: { x: 40, y: 0, z: 40 } };
      const totalSegments = Math.max(1, (trackData?.segments || []).length || 1);
      const authoredStaticObstacles = (trackData?.obstacles || []).filter((obstacle) => String(obstacle?.type || 'barrier') !== 'item_box');
      const totalObstacles = Math.max(1, authoredStaticObstacles.length || 1);
      const floorWidth = Math.max(40, (bounds.max.x - bounds.min.x) + 28);
      const floorDepth = Math.max(40, (bounds.max.z - bounds.min.z) + 28);
      const floorCenterX = (bounds.min.x + bounds.max.x) * 0.5;
      const floorCenterZ = (bounds.min.z + bounds.max.z) * 0.5;
      const floorHeight = 0.6;
      const floorY = Math.min(bounds.min.y || 0, 0) - floorHeight;

      const floorMat = new StandardMaterial('custom-arena-floor-mat', this.scene);
      floorMat.diffuseColor = new Color3(0.07, 0.1, 0.15);
      floorMat.specularColor = new Color3(0.03, 0.05, 0.07);

      const floor = MeshBuilder.CreateBox('custom-arena-floor', {
        width: floorWidth,
        depth: floorDepth,
        height: floorHeight,
      }, this.scene);
      emitPlaytestProgress({
        phase: 'scene-load',
        label: 'Forging arena floor',
        detail: `${(trackData?.segments || []).length || 0} tiles Â· ${(trackData?.obstacles || []).length || 0} props`,
        progress: 0.42,
      });
      floor.position.set(floorCenterX, floorY, floorCenterZ);
      floor.material = floorMat;
      floor.receiveShadows = true;
      if (hasPhysics) {
        const floorAggregate = new PhysicsAggregate(floor, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.02 }, this.scene);
        applyFilterToAggregate(floorAggregate, FILTER.TRACK);
      }

      const importSegmentVisual = async (segment, index) => {
        const procedural = await buildCustomArenaSegmentVisual(this.scene, segment?.type, segment.id || index);
        if (!procedural) {
          console.warn(`[realtime] Unknown custom arena segment type: ${String(segment?.type || 'unknown')}`);
        }
        return procedural;
      };

      const createFallbackSegmentVisual = (segmentType, index) => {
        const dims = getFallbackSegmentFootprint(segmentType, GRID_SIZE);
        const spec = resolveCustomArenaSegmentSpec(segmentType);
        const canonicalType = spec?.canonicalKey || String(segmentType || 'straight');
        const color = canonicalType === 'wide'
          ? new Color3(0.12, 0.74, 0.66)
          : canonicalType.includes('corner') || canonicalType === 'curve'
            ? new Color3(0.93, 0.58, 0.24)
            : canonicalType.includes('hill') || canonicalType.includes('ramp') || canonicalType.includes('bump')
              ? new Color3(0.68, 0.46, 0.96)
              : new Color3(0.2, 0.58, 0.92);
        const mesh = MeshBuilder.CreateBox(`custom-segment-fallback-${index}`, {
          width: dims.width,
          depth: dims.length,
          height: dims.height,
        }, this.scene);
        const material = new StandardMaterial(`custom-segment-fallback-mat-${index}`, this.scene);
        material.diffuseColor = color;
        material.specularColor = new Color3(0.1, 0.12, 0.18);
        mesh.material = material;
        mesh.position.y = dims.height * 0.5;
        mesh.receiveShadows = true;
        return {
          visual: mesh,
          bounds: new Vector3(dims.width, dims.height, dims.length),
          anchorMeta: {
            scale: 1,
            portAnchors: createFallbackPortAnchors(canonicalType, dims.width, dims.length, dims.height * 0.5),
          },
        };
      };

      const getRecordConnectors = (record) => getSegmentWorldConnectors({
        entityId: record.id,
        type: record.type,
        rotationDeg: record.rotation,
        position: {
          x: record.root.position.x,
          y: record.root.position.y,
          z: record.root.position.z,
        },
        portAnchors: record.anchorMeta?.portAnchors,
        scale: (record.anchorMeta?.scale || 1) * record.segmentScale,
      }).map((connector) => ({
        ...connector,
        record,
        connectorId: `${record.id}:${connector.baseDir}`,
      }));

      const findMatchedConnectorPairs = (segmentRecords) => {
        const connectors = segmentRecords.flatMap(getRecordConnectors);
        const bestByConnector = new Map();

        for (const connector of connectors) {
          const neighborDelta = CUSTOM_ARENA_DIR_VECTORS[connector.dir] || { x: 0, z: 0 };
          const expectedNeighborCenter = {
            x: connector.record.root.position.x + neighborDelta.x,
            z: connector.record.root.position.z + neighborDelta.z,
          };
          let bestMatch = null;

          for (const other of connectors) {
            if (connector.connectorId === other.connectorId || connector.entityId === other.entityId) continue;
            if (other.dir !== oppositeCustomArenaDir(connector.dir)) continue;

            const centerDelta = Math.hypot(
              other.record.root.position.x - expectedNeighborCenter.x,
              other.record.root.position.z - expectedNeighborCenter.z,
            );
            if (centerDelta > GRID_SIZE * 0.2) continue;

            const deltaX = other.position.x - connector.position.x;
            const deltaY = other.position.y - connector.position.y;
            const deltaZ = other.position.z - connector.position.z;
            const planarDistance = Math.hypot(deltaX, deltaZ);
            if (planarDistance > GRID_SIZE * 0.35 || Math.abs(deltaY) > GRID_SIZE * 0.2) continue;

            const score = planarDistance + (Math.abs(deltaY) * 2) + (centerDelta * 0.5);
            if (!bestMatch || score < bestMatch.score) {
              bestMatch = { other, score, planarDistance, deltaX, deltaY, deltaZ };
            }
          }

          if (bestMatch) bestByConnector.set(connector.connectorId, bestMatch);
        }

        const pairs = [];
        const seen = new Set();
        for (const connector of connectors) {
          const best = bestByConnector.get(connector.connectorId);
          if (!best) continue;
          const reverse = bestByConnector.get(best.other.connectorId);
          if (!reverse || reverse.other.connectorId !== connector.connectorId) continue;

          const pairKey = [connector.connectorId, best.other.connectorId].sort().join('::');
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          pairs.push({
            key: pairKey,
            a: connector,
            b: best.other,
            delta: { x: best.deltaX, y: best.deltaY, z: best.deltaZ },
            planarDistance: best.planarDistance,
          });
        }

        return pairs;
      };

      const refineSegmentPlacements = (segmentRecords) => {
        for (let pass = 0; pass < 2; pass++) {
          const pairs = findMatchedConnectorPairs(segmentRecords);
          if (!pairs.length) return pairs;

          const corrections = new Map(segmentRecords.map((record) => [record.id, { x: 0, y: 0, z: 0, count: 0 }]));
          for (const pair of pairs) {
            if (pair.planarDistance < 0.01 && Math.abs(pair.delta.y) < 0.01) continue;
            if (pair.planarDistance > GRID_SIZE * 0.18 || Math.abs(pair.delta.y) > GRID_SIZE * 0.12) continue;

            const aEntry = corrections.get(pair.a.entityId);
            const bEntry = corrections.get(pair.b.entityId);
            const aLocked = pair.a.record.segmentIndex === 0;
            const bLocked = pair.b.record.segmentIndex === 0;
            const aFactor = aLocked ? 0 : (bLocked ? 1 : 0.5);
            const bFactor = bLocked ? 0 : (aLocked ? 1 : 0.5);

            if (aFactor > 0 && aEntry) {
              aEntry.x += pair.delta.x * aFactor;
              aEntry.y += pair.delta.y * aFactor;
              aEntry.z += pair.delta.z * aFactor;
              aEntry.count += 1;
            }
            if (bFactor > 0 && bEntry) {
              bEntry.x -= pair.delta.x * bFactor;
              bEntry.y -= pair.delta.y * bFactor;
              bEntry.z -= pair.delta.z * bFactor;
              bEntry.count += 1;
            }
          }

          let moved = false;
          for (const record of segmentRecords) {
            if (record.segmentIndex === 0) continue;
            const correction = corrections.get(record.id);
            if (!correction?.count) continue;

            const delta = new Vector3(
              correction.x / correction.count,
              correction.y / correction.count,
              correction.z / correction.count,
            );
            if (delta.length() < 0.001 || delta.length() > GRID_SIZE * 0.18) continue;
            record.root.position.addInPlace(delta);
            moved = true;
          }

          if (!moved) return pairs;
        }

        return findMatchedConnectorPairs(segmentRecords);
      };

      const createResidualSegmentSeamBlends = (pairs) => {
        if (!pairs.length) return;

        const seamMaterial = new StandardMaterial('custom-arena-seam-mat', this.scene);
        seamMaterial.diffuseColor = new Color3(0.155, 0.165, 0.18);
        seamMaterial.specularColor = new Color3(0.01, 0.01, 0.01);
        seamMaterial.emissiveColor = new Color3(0.015, 0.016, 0.018);
        seamMaterial.alpha = 0.98;

        for (const pair of pairs) {
          if (pair.planarDistance < 0.035 || pair.planarDistance > GRID_SIZE * 0.22) continue;
          if (Math.abs(pair.delta.y) > GRID_SIZE * 0.08) continue;

          const seamDir = pair.a.dir;
          const footprintA = getFallbackSegmentFootprint(pair.a.record.type, GRID_SIZE);
          const footprintB = getFallbackSegmentFootprint(pair.b.record.type, GRID_SIZE);
          const acrossSpan = seamDir === CUSTOM_ARENA_DIR.N || seamDir === CUSTOM_ARENA_DIR.S
            ? Math.min(footprintA.width * pair.a.record.segmentScale, footprintB.width * pair.b.record.segmentScale)
            : Math.min(footprintA.length * pair.a.record.segmentScale, footprintB.length * pair.b.record.segmentScale);
          const blendLength = Math.max(0.12, pair.planarDistance + 0.08);
          const seam = MeshBuilder.CreateBox(`custom-seam-${pair.key}`, {
            width: seamDir === CUSTOM_ARENA_DIR.N || seamDir === CUSTOM_ARENA_DIR.S ? Math.max(1.2, acrossSpan - 0.8) : blendLength,
            depth: seamDir === CUSTOM_ARENA_DIR.N || seamDir === CUSTOM_ARENA_DIR.S ? blendLength : Math.max(1.2, acrossSpan - 0.8),
            height: 0.03,
          }, this.scene);
          seam.material = seamMaterial;
          seam.receiveShadows = true;
          seam.position = new Vector3(
            (pair.a.position.x + pair.b.position.x) * 0.5,
            Math.max(pair.a.position.y, pair.b.position.y) + 0.012,
            (pair.a.position.z + pair.b.position.z) * 0.5,
          );

          if (hasPhysics) {
            const seamAggregate = new PhysicsAggregate(seam, PhysicsShapeType.BOX, {
              mass: 0,
              friction: 0.92,
              restitution: 0.02,
            }, this.scene);
            applyFilterToAggregate(seamAggregate, FILTER.TRACK);
          }
        }
      };

      const collectRenderBounds = (record) => {
        const meshes = record.renderMeshes?.length
          ? record.renderMeshes
          : (record.root.getChildMeshes ? record.root.getChildMeshes(false) : []);
        let min = null;
        let max = null;

        for (const mesh of meshes) {
          mesh.computeWorldMatrix(true);
          const world = mesh.getWorldMatrix();
          const positions = mesh.getVerticesData?.(VertexBuffer.PositionKind);
          if (!positions?.length) continue;

          for (let index = 0; index < positions.length; index += 3) {
            const point = Vector3.TransformCoordinates(
              new Vector3(positions[index], positions[index + 1], positions[index + 2]),
              world,
            );
            if (!min) {
              min = point.clone();
              max = point.clone();
              continue;
            }
            min.minimizeInPlace(point);
            max.maximizeInPlace(point);
          }
        }

        if (!min || !max) return null;
        const center = min.clone().add(max).scale(0.5);
        const size = max.clone().subtract(min);
        return {
          min: {
            x: Number(min.x.toFixed(3)),
            y: Number(min.y.toFixed(3)),
            z: Number(min.z.toFixed(3)),
          },
          max: {
            x: Number(max.x.toFixed(3)),
            y: Number(max.y.toFixed(3)),
            z: Number(max.z.toFixed(3)),
          },
          center: {
            x: Number(center.x.toFixed(3)),
            y: Number(center.y.toFixed(3)),
            z: Number(center.z.toFixed(3)),
          },
          size: {
            x: Number(size.x.toFixed(3)),
            y: Number(size.y.toFixed(3)),
            z: Number(size.z.toFixed(3)),
          },
        };
      };

      const collectSegmentDebugRecord = (record) => ({
        id: String(record.id),
        type: record.type,
        position: {
          x: Number(record.root.position.x.toFixed(3)),
          y: Number(record.root.position.y.toFixed(3)),
          z: Number(record.root.position.z.toFixed(3)),
        },
        rotation: Number(record.rotation || 0),
        scale: Number(record.segmentScale || 1),
        bounds: collectRenderBounds(record),
        connectors: getRecordConnectors(record).map((connector) => ({
          baseDir: Number(connector.baseDir),
          dir: Number(connector.dir),
          position: {
            x: Number(connector.position.x.toFixed(3)),
            y: Number(connector.position.y.toFixed(3)),
            z: Number(connector.position.z.toFixed(3)),
          },
        })),
      });

      const segmentRecords = [];
      for (const [segmentIndex, segment] of (trackData?.segments || []).entries()) {
        const segmentType = segment?.type ? String(segment.type) : 'straight';
        const segmentRoot = new TransformNode(`custom-segment-node-${segment.id || segmentIndex}`, this.scene);
        const segmentVisual = await importSegmentVisual(segment, segmentIndex) || createFallbackSegmentVisual(segmentType, segmentIndex);
        const visual = segmentVisual.visual;
        visual.parent = segmentRoot;
        const segmentScale = Number(segment.scale || 1) || 1;
        segmentRoot.position = new Vector3(
          Number(segment.position?.x || 0),
          Number(segment.position?.y || 0),
          Number(segment.position?.z || 0),
        );
        segmentRoot.rotation.y = -(Number(segment.rotation || 0) * Math.PI) / 180;
        segmentRoot.scaling = new Vector3(segmentScale, segmentScale, segmentScale);
        segmentRecords.push({
          id: String(segment.id || `segment-${segmentIndex}`),
          type: segmentType,
          rotation: Number(segment.rotation || 0),
          root: segmentRoot,
          bounds: segmentVisual.bounds || new Vector3(GRID_SIZE, 1.2, GRID_SIZE),
          renderMeshes: segmentVisual.renderMeshes || null,
          physicsMeshes: segmentVisual.physicsMeshes || null,
          anchorMeta: segmentVisual.anchorMeta || {
            scale: 1,
            portAnchors: createFallbackPortAnchors(segmentType, GRID_SIZE, GRID_SIZE),
          },
          segmentScale,
          segmentIndex,
        });

        if (segmentIndex === 0 || segmentIndex === totalSegments - 1 || (segmentIndex + 1) % Math.max(1, Math.ceil(totalSegments / 5)) === 0) {
          emitPlaytestProgress({
            phase: 'scene-load',
            label: 'Placing track geometry',
            detail: `Tile ${segmentIndex + 1} of ${totalSegments}`,
            progress: 0.42 + (((segmentIndex + 1) / totalSegments) * 0.28),
          });
        }
      }

      // Builder playtests already provide authored world coordinates.
      // Do not nudge pieces in runtime; preserve 1:1 placement.
      // We still detect matched connectors so tiny authored/render gaps can be
      // visually blended without moving the user's layout.
      const connectorPairs = findMatchedConnectorPairs(segmentRecords);

      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.customArenaInputSegments = (trackData?.segments || []).map((segment) => ({
          id: String(segment?.id || ''),
          type: String(segment?.type || 'straight'),
          position: {
            x: Number(segment?.position?.x || 0),
            y: Number(segment?.position?.y || 0),
            z: Number(segment?.position?.z || 0),
          },
          rotation: Number(segment?.rotation || 0),
          scale: Number(segment?.scale || 1),
        }));
        window.__gloDebug.customArenaInputSpawns = (trackData?.startPositions || []).map((spawn, index) => ({
          id: String(spawn?.id || index + 1),
          position: {
            x: Number(spawn?.position?.x || 0),
            y: Number(spawn?.position?.y || 0),
            z: Number(spawn?.position?.z || 0),
          },
          heading: Number(spawn?.heading || 0),
        }));
        window.__gloDebug.customArenaInputObstacles = (trackData?.obstacles || []).map((obstacle, index) => ({
          id: String(obstacle?.id || index + 1),
          type: String(obstacle?.type || 'barrier'),
          position: {
            x: Number(obstacle?.position?.x || 0),
            y: Number(obstacle?.position?.y || 0),
            z: Number(obstacle?.position?.z || 0),
          },
          rotation: Number(obstacle?.rotation || 0),
          scale: Number(obstacle?.scale || 1),
        }));
        window.__gloDebug.customArenaSegments = segmentRecords.map(collectSegmentDebugRecord);
      }

      for (const record of segmentRecords) {
        if (!hasPhysics) continue;

        // Use rendered meshes as driveable surface colliders (trimesh).
        // Wall colliders come from cell data (below), not from mesh geometry.
        const colliderMeshes = record.renderMeshes;
        let trimeshSuccess = 0;
        if (colliderMeshes?.length) {
          record.root.computeWorldMatrix(true);
          for (const mesh of colliderMeshes) {
            mesh.computeWorldMatrix(true);
            try {
              const clone = mesh.clone(`${mesh.name}_col`, null);
              if (!clone) continue;
              if (typeof clone.makeGeometryUnique === 'function') {
                clone.makeGeometryUnique();
              }
              clone.setParent(null);
              clone.position.copyFrom(mesh.absolutePosition);
              clone.rotationQuaternion = mesh.absoluteRotationQuaternion?.clone() || null;
              const absScale = new Vector3();
              mesh.getWorldMatrix().decompose(absScale);
              clone.scaling.copyFrom(absScale);
              clone.bakeCurrentTransformIntoVertices();
              clone.isVisible = false;
              const agg = new PhysicsAggregate(clone, PhysicsShapeType.MESH, {
                mass: 0,
                friction: 0.9,
                restitution: 0.02,
              }, this.scene);
              applyFilterToAggregate(agg, FILTER.TRACK);
              trimeshSuccess++;
            } catch (meshPhysErr) {
              // If trimesh fails for this sub-mesh, skip silently
            }
          }
        }
        // BOX fallback if no trimesh colliders succeeded
        if (!trimeshSuccess) {
          const collider = MeshBuilder.CreateBox(`custom-segment-collider-${record.id}`, {
            width: Math.max(1, record.bounds.x),
            height: Math.max(1.4, record.bounds.y),
            depth: Math.max(1, record.bounds.z),
          }, this.scene);
          collider.parent = record.root;
          collider.position.y = Math.max(
            0,
            (Math.max(1.4, record.bounds.y) * 0.5) - 0.04,
          );
          collider.isVisible = false;
          collider.isPickable = false;

          const aggregate = new PhysicsAggregate(collider, PhysicsShapeType.BOX, {
            mass: 0,
            friction: 0.9,
            restitution: 0.02,
          }, this.scene);
          applyFilterToAggregate(aggregate, FILTER.TRACK);
        }
      }

      // ── Wall colliders from cell data ──────────────────────────
      // Walls only appear on outer track edges, never between connected segments.
      if (hasPhysics && Array.isArray(trackData.wallColliders)) {
        for (const [wallIndex, wall] of trackData.wallColliders.entries()) {
          const wallMesh = MeshBuilder.CreateBox(`wall-collider-${wallIndex}`, {
            width: wall.size.x,
            height: wall.size.y,
            depth: wall.size.z,
          }, this.scene);
          wallMesh.position = new Vector3(
            Number(wall.position.x),
            Number(wall.position.y),
            Number(wall.position.z),
          );
          wallMesh.isVisible = false;
          wallMesh.isPickable = false;

          const wallAgg = new PhysicsAggregate(wallMesh, PhysicsShapeType.BOX, {
            mass: 0,
            friction: 0.3,
            restitution: 0.5,
          }, this.scene);
          applyFilterToAggregate(wallAgg, FILTER.TRACK);
        }
      }

      createResidualSegmentSeamBlends(connectorPairs);

      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.customArenaSegments = segmentRecords.map(collectSegmentDebugRecord);
        window.__gloDebug.customArenaConnectorPairs = connectorPairs.map((pair) => ({
          key: pair.key,
          planarDistance: Number(pair.planarDistance.toFixed(3)),
          a: {
            entityId: String(pair.a.entityId),
            dir: Number(pair.a.dir),
            position: {
              x: Number(pair.a.position.x.toFixed(3)),
              y: Number(pair.a.position.y.toFixed(3)),
              z: Number(pair.a.position.z.toFixed(3)),
            },
          },
          b: {
            entityId: String(pair.b.entityId),
            dir: Number(pair.b.dir),
            position: {
              x: Number(pair.b.position.x.toFixed(3)),
              y: Number(pair.b.position.y.toFixed(3)),
              z: Number(pair.b.position.z.toFixed(3)),
            },
          },
        }));
      }

      const builtObstacleRecords = [];
      for (const [index, obstacle] of authoredStaticObstacles.entries()) {
        const obstacleType = String(obstacle?.type || 'barrier');
        const obstacleFilter = obstacleType === 'item_box'
          ? FILTER.ITEM_BOX
          : obstacleType === 'banana'
            ? FILTER.TRAP
            : FILTER.TRACK;
        let obstacleMesh;
        if (obstacleType === 'item_box') {
          obstacleMesh = createItemBoxModel(this.scene, {
            includeCarousel: false,
            includeSparkles: false,
          });
          obstacleMesh.scaling.scaleInPlace(3.1);
        } else if (obstacleType === 'banana') {
          obstacleMesh = createBananaModel(this.scene);
          obstacleMesh.scaling.scaleInPlace(7.2);
        } else if (obstacleType === 'boost_pad') {
          obstacleMesh = MeshBuilder.CreateBox(`custom-obstacle-${index}`, { width: 7.2, height: 0.6, depth: 11.2 }, this.scene);
          const boostMat = new StandardMaterial(`custom-obstacle-mat-${index}`, this.scene);
          boostMat.diffuseColor = new Color3(0, 0.66, 1);
          boostMat.emissiveColor = new Color3(0.06, 0.31, 0.4);
          obstacleMesh.material = boostMat;
        } else {
          obstacleMesh = MeshBuilder.CreateBox(`custom-obstacle-${index}`, { width: 9.5, height: 5.5, depth: 2.5 }, this.scene);
          const barrierMat = new StandardMaterial(`custom-obstacle-mat-${index}`, this.scene);
          barrierMat.diffuseColor = new Color3(0.4, 0.46, 0.54);
          obstacleMesh.material = barrierMat;
        }

        obstacleMesh.position = new Vector3(
          Number(obstacle.position?.x || 0),
          obstacleType === 'boost_pad' ? 0.3 : obstacleType === 'item_box' ? 2.6 : obstacleType === 'banana' ? 1.7 : 2.75,
          Number(obstacle.position?.z || 0),
        );
        obstacleMesh.rotation.y = -(Number(obstacle.rotation || 0) * Math.PI) / 180;
        obstacleMesh.scaling.scaleInPlace(Number(obstacle.scale || 1) || 1);
        builtObstacleRecords.push({
          id: String(obstacle?.id || index + 1),
          type: obstacleType,
          position: {
            x: Number(obstacleMesh.position.x.toFixed(3)),
            y: Number(obstacleMesh.position.y.toFixed(3)),
            z: Number(obstacleMesh.position.z.toFixed(3)),
          },
          rotation: Number(obstacle?.rotation || 0),
          scale: Number(obstacle?.scale || 1),
        });

        if (hasPhysics) {
          const obstacleAggregate = new PhysicsAggregate(obstacleMesh, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.05 }, this.scene);
          applyFilterToAggregate(obstacleAggregate, obstacleFilter);
        }

        if (index === 0 || index === totalObstacles - 1 || (index + 1) % Math.max(1, Math.ceil(totalObstacles / 3)) === 0) {
          emitPlaytestProgress({
            phase: 'scene-load',
            label: 'Installing arena props',
            detail: `Prop ${index + 1} of ${totalObstacles}`,
            progress: 0.72 + (((index + 1) / totalObstacles) * 0.12),
          });
        }
      }

      const wallThickness = 8;
      const wallHeight = 6;
      const wallMat = new StandardMaterial('custom-arena-wall-mat', this.scene);
      wallMat.diffuseColor = new Color3(0.16, 0.18, 0.24);

      const createWall = (name, width, height, depth, x, y, z) => {
        const wall = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
        wall.position.set(x, y, z);
        wall.material = wallMat;
        if (hasPhysics) {
          const wallAggregate = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.7, restitution: 0.04 }, this.scene);
          applyFilterToAggregate(wallAggregate, FILTER.TRACK);
        }
      };

      createWall('custom-wall-n', floorWidth + wallThickness * 2, wallHeight, wallThickness, floorCenterX, wallHeight * 0.5, floorCenterZ - (floorDepth * 0.5) - (wallThickness * 0.5));
      createWall('custom-wall-s', floorWidth + wallThickness * 2, wallHeight, wallThickness, floorCenterX, wallHeight * 0.5, floorCenterZ + (floorDepth * 0.5) + (wallThickness * 0.5));
      createWall('custom-wall-e', wallThickness, wallHeight, floorDepth + wallThickness * 2, floorCenterX + (floorWidth * 0.5) + (wallThickness * 0.5), wallHeight * 0.5, floorCenterZ);
      createWall('custom-wall-w', wallThickness, wallHeight, floorDepth + wallThickness * 2, floorCenterX - (floorWidth * 0.5) - (wallThickness * 0.5), wallHeight * 0.5, floorCenterZ);

      emitPlaytestProgress({
        phase: 'scene-load',
        label: 'Sealing combat boundaries',
        detail: 'Arena collision shell ready',
        progress: 0.9,
      });

      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.customArenaBuiltObstacles = builtObstacleRecords;
      }

      this._arenaBoundsHalf = Math.max(floorWidth, floorDepth) * 0.5;
    };

    // â”€â”€ DEBUG: skip GLB loading, use procedural debug arena â”€â”€
    const USE_DEBUG_ARENA = !customTrackParsed;
    if (USE_DEBUG_ARENA) {
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.customArenaBuilt = false;
      }
      console.info('[custom-arena-debug] loadSceneAssets using fallback arena path', {
        gameMode: options.gameMode || null,
        trackId: options.trackId || null,
        arenaId: requestedArenaId,
        customTrackBytes,
      });
      emitPlaytestProgress({
        phase: 'scene-load',
        label: 'Using fallback arena shell',
        detail: 'Builder data was unavailable, so the debug arena path was selected',
        progress: 0.34,
        state: 'warning',
      });
      console.log('[realtime] DEBUG ARENA mode â€” skipping GLB load');
      this._createFallbackGround();
      const debugSpawns = [
        { x: 10, y: 0.35, z: 0 }, { x: -10, y: 0.35, z: 0 },
        { x: 0, y: 0.35, z: 10 }, { x: 0, y: 0.35, z: -10 },
        { x: 15, y: 0.35, z: 15 }, { x: -15, y: 0.35, z: -15 },
        { x: 15, y: 0.35, z: -15 }, { x: -15, y: 0.35, z: 15 },
      ];
      this._spawnPos = debugSpawns[0];
      this._allSpawnPositions = debugSpawns;
      this._fallThreshold = -28;
      // Kill plane
      const kp = MeshBuilder.CreateGround("kill-plane", { width: 2000, height: 2000 }, this.scene);
      kp.position.y = -30;
      kp.isVisible = false;
      if (this.havokPlugin) {
        const killAgg = new PhysicsAggregate(kp, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
        applyFilterToAggregate(killAgg, FILTER.BOUNDARY);
      }
      kp._isBoundary = true;
      // Fall through to kart loading below (do NOT return early)
    } else {

    try {
      if (customTrackParsed) {
        // Build custom track from TrackData JSON
        console.log('[realtime] Building custom track from TrackData...');
        await buildCustomArena(customTrackParsed);
        if (typeof window !== 'undefined' && window.__gloDebug) {
          window.__gloDebug.customArenaBuilt = true;
        }
        console.info('[custom-arena-debug] loadSceneAssets built custom arena', {
          gameMode: options.gameMode || null,
          trackId: options.trackId || null,
          arenaId: requestedArenaId,
          customTrackBytes,
        });
        emitPlaytestProgress({
          phase: 'scene-load',
          label: 'Builder arena assembled',
          detail: 'Custom combat geometry is live in the runtime shell',
          progress: 0.96,
        });
      } else {
        console.info('[custom-arena-debug] loadSceneAssets resolved registry asset', {
          gameMode: options.gameMode || null,
          trackId: options.trackId || null,
          arenaId: requestedArenaId,
          resolvedAssetId: trackInfo?.id || options.trackId || null,
          customTrackBytes,
        });
        console.log(`[realtime] Loading track models for ${trackInfo.id}...`);
        const assetPath = trackInfo.arenaPath || trackInfo.trackPath;
        if (assetPath) {
          const pathParts = assetPath.split('/');
          const filename = pathParts.pop();
          const dir = pathParts.join('/') + '/';
          const result = await SceneLoader.ImportMeshAsync("", dir, filename, this.scene)
            .catch((e) => { console.warn(`[realtime] Failed to load ${filename}:`, e); return null; });

          this._polishArenaGeometry(result, trackInfo.id);
          this._createTrackPhysics(result);

          // Auto-generate map definitions (walls, spawns) from mesh geometry
          if (result?.meshes?.length) {
            this._autoMapDef = generateMapDefinition(this.scene, result, {
              numPlayers: 8,
              numItems: 10,
              generateWalls: true,
            });
          }

          // Load decorations (visual only, no physics)
          if (trackInfo.decorationsPath) {
            const decParts = trackInfo.decorationsPath.split('/');
            const decFilename = decParts.pop();
            SceneLoader.ImportMeshAsync("", decParts.join('/') + '/', decFilename, this.scene)
              .catch((e) => console.warn(`[realtime] Decorations load skipped:`, e.message));
          }
        } else {
          console.warn("[realtime] No track/arena path found â€” using fallback ground");
          this._createFallbackGround();
        }
      }
    } catch (e) {
      console.error("[realtime] Map loading failed:", e);
      this._createFallbackGround();
    }
    } // end else (non-debug arena path)

    if (!USE_DEBUG_ARENA) {
    // â”€â”€ Spawn positions â”€â”€
    // Priority: custom track data > track-data.js registry > auto-generated from mesh
    const customSpawns = customTrackParsed?.startPositions;
    const customSegments = Array.isArray(customTrackParsed?.segments) ? customTrackParsed.segments : [];
    let spawnPositions;
      
      function normalizeSpawn(sp) {
        if (!sp) return { x: 0, y: 5, z: 0 };
        if (sp.position && Array.isArray(sp.position)) return { x: sp.position[0], y: sp.position[1], z: sp.position[2], heading: sp.heading };
        if (sp.position && typeof sp.position.x === 'number') return { x: sp.position.x, y: sp.position.y || 0, z: sp.position.z, heading: sp.heading };
        if (Array.isArray(sp)) return { x: sp[0], y: sp[1], z: sp[2] };
        return { x: sp.x || 0, y: sp.y || 0, z: sp.z || 0 };
      }

      function deriveCustomSegmentSpawn() {
        if (!customSegments.length) return null;
        const endpoint = customSegments.find((segment) => Number(segment?.connectionCount || 0) <= 1)
          || customSegments[0];
        return normalizeSpawn({
          position: {
            x: Number(endpoint?.position?.x || 0),
            // Hint Y just above the authored segment; `_sampleSurfaceY` snaps
            // the kart to the actual TRACK surface at runtime.
            y: Number(endpoint?.position?.y || 0) + 1,
            z: Number(endpoint?.position?.z || 0),
          },
          heading: Number(endpoint?.rotation || 0),
        });
      }

      if (customSpawns?.length) {
        spawnPositions = customSpawns.map(normalizeSpawn);
      } else if (customTrackParsed && customSegments.length) {
        spawnPositions = [deriveCustomSegmentSpawn()].filter(Boolean);
      } else if (trackInfo.startPositions?.length > 1) {
        spawnPositions = trackInfo.startPositions.map(normalizeSpawn);
      } else if (this._autoMapDef?.spawnPositions?.length) {
        spawnPositions = this._autoMapDef.spawnPositions.map(normalizeSpawn);
        console.log(`[realtime] Using ${spawnPositions.length} auto-generated spawn points`);
      } else {
        spawnPositions = [ normalizeSpawn(trackInfo.start || { x: 0, y: 5, z: 0 }) ];
        }

      // â”€â”€ Kill-plane boundary below the track â”€â”€
    const baseY = spawnPositions[0]?.y || 0;
    const killY = baseY - 30;
    const killPlane = MeshBuilder.CreateGround("kill-plane", { width: 2000, height: 2000 }, this.scene);
    killPlane.position.y = killY;
    killPlane.isVisible = false;
    if (this.havokPlugin) {
      const killAgg = new PhysicsAggregate(killPlane, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
      applyFilterToAggregate(killAgg, FILTER.BOUNDARY);
    }
    killPlane._isBoundary = true;

    this._spawnPos = spawnPositions[0] || { x: 0, y: 5, z: 0 };
    this._allSpawnPositions = spawnPositions;
    this._fallThreshold = killY + 10; // trigger respawn 10 units above kill plane

    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.customArenaResolvedSpawns = spawnPositions.map((spawn, index) => ({
        id: String(customSpawns?.[index]?.id || index + 1),
        position: {
          x: Number(spawn?.x || 0),
          y: Number(spawn?.y || 0),
          z: Number(spawn?.z || 0),
        },
        heading: Number(spawn?.heading || 0),
      }));
    }

    // Per-arena kart scale override (e.g. blockfort needs much smaller karts)
    this._arenaKartScale = trackInfo.kartScale || null;
    } // end !USE_DEBUG_ARENA spawn/kill-plane section

    if (options.smokeMode) {
      this.localMesh = MeshBuilder.CreateBox("localCar", { size: 1.8 }, this.scene);
      this.localMesh.position = new Vector3(
        this._spawnPos.x,
        this._sampleSurfaceY(this._spawnPos.x, this._spawnPos.z, this._spawnPos.y, 0.3),
        this._spawnPos.z,
      );
      const smokeScale = this._arenaKartScale || 1;
      this._localKartExtents = new Vector3(1.8 * smokeScale, 0.5 * smokeScale, 3.2 * smokeScale);
      if (this.havokPlugin) {
        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.01, extents: this._localKartExtents }, this.scene);
        this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(800, 500, 800) });
        applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
        this.localKartAggregate.body.setCollisionCallbackEnabled(true);
      }
      this.localMesh.isVisible = false;
      if (this.localKartAggregate) this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
      this._kartReady = false;
      this.camera.lockedTarget = this.localMesh;
      this._gloKit = createGloUnderglow(this.scene, this.localMesh, {
        effect: options.gloEffect, color: options.gloColor, color2: options.gloColor2, id: 'local',
      });
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.kartLoaded = true;
        window.__gloDebug.spawnPos = { x: this._spawnPos.x, y: this._spawnPos.y, z: this._spawnPos.z };
        window.__gloDebug.smokeMode = options.smokeMode;
      }
      return;
    }

    const kartInfo = resolveKartAsset(options.kartId);
    try {
      console.log(`[realtime] Loading local player kart (id: ${kartInfo.id}, color: ${options.playerColor})...`);

      // â”€â”€ KartEntity: isolated materials, auto-detected wheels, attach points â”€â”€
      const localKartEntity = await createLocalKartEntity(this.scene, {
        id: 'local',
        kartId: options.kartId,
        color: options.playerColor,
        scale: this._arenaKartScale || (kartInfo.scale && kartInfo.scale !== 1 ? kartInfo.scale : null),
        isLocal: true,
      });
      this._localKartEntity = localKartEntity;
      this.localMesh = localKartEntity.rootMesh;
      this.localMesh.name = "local-player";

      // â”€â”€ KartVFX: all effects parented to attachment points â”€â”€
      this._localKartVFX = new KartVFX(this.scene, localKartEntity);

      this._gloKit = createGloUnderglow(this.scene, this.localMesh, {
        effect: options.gloEffect, color: options.gloColor, color2: options.gloColor2, id: 'local',
      });
      // Use track's start position (slightly above to let physics settle)
      this.localMesh.position = new Vector3(
        this._spawnPos.x,
        this._sampleSurfaceY(this._spawnPos.x, this._spawnPos.z, this._spawnPos.y, 0.3),
        this._spawnPos.z
      );
      
      this._localKartExtents = localKartEntity.extents;
      if (this.havokPlugin) {
        localKartEntity.createPhysics(this.havokPlugin, 'DYNAMIC');
        this.localKartAggregate = localKartEntity.aggregate;

        // â”€â”€ Raycast vehicle: force-based suspension on the physics body â”€â”€
        if (this.localKartAggregate?.body) {
          const wheelOffsets = localKartEntity.getWheelRayOffsets?.() || undefined;
          this._raycastVehicle = createKartRaycastVehicle(
            this.localKartAggregate.body,
            this.havokPlugin,
            { wheelOffsets, rayCollideWith: LAYER.TRACK },
          );
        }
      }

      // â”€â”€ Pre-match: hide kart & freeze physics until matchLive fires â”€â”€
      localKartEntity.setVisible(false);
      if (localKartEntity.aggregate) localKartEntity.freezePhysics();
      this._kartReady = false;
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.kartLoaded = true;
        window.__gloDebug.spawnPos = { x: this._spawnPos.x, y: this._spawnPos.y, z: this._spawnPos.z };
        window.__gloDebug.effectiveKartScale = localKartEntity.scaleFactor;
      }

      // Cache wheel child meshes so we can animate their spin each frame
      this._wheelMeshes = localKartEntity.wheelMeshes;

      this.camera.lockedTarget = this.localMesh;

    } catch (e) {
      console.error("[realtime] Kart loading failed: ", e);
      this.localMesh = MeshBuilder.CreateBox("localCar", { size: 1.8 }, this.scene);
      this.localMesh.position = new Vector3(
        this._spawnPos.x,
        this._sampleSurfaceY(this._spawnPos.x, this._spawnPos.z, this._spawnPos.y, 0.3),
        this._spawnPos.z,
      );
      const fbScale = this._arenaKartScale || 1;
      this._localKartExtents = new Vector3(1.8 * fbScale, 0.5 * fbScale, 3.2 * fbScale);
      if (this.havokPlugin) {
        this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.01, extents: this._localKartExtents }, this.scene);
        this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(800, 500, 800) });
        applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
        this.localKartAggregate.body.setCollisionCallbackEnabled(true);
      }
      // Pre-match hide + static
      this.localMesh.isVisible = false;
      if (this.localKartAggregate) this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
      this._kartReady = false;
      this.camera.lockedTarget = this.localMesh;
      this._gloKit = createGloUnderglow(this.scene, this.localMesh, {
        effect: options.gloEffect, color: options.gloColor, color2: options.gloColor2, id: 'local',
      });
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.kartLoaded = true;
        window.__gloDebug.spawnPos = { x: this._spawnPos.x, y: this._spawnPos.y, z: this._spawnPos.z };
      }
    }
  }

  async connect(options = {}) {
    const weaponPool = Array.isArray(options.weaponPool)
      ? [...new Set(options.weaponPool.map((weaponId) => String(weaponId || '').trim()).filter(Boolean))]
      : [];
    const joinOptions = {
        playerName: options.playerName || this.playerName,
        maxPlayers: options.maxPlayers || this.maxPlayers,
        gameMode: options.gameMode || "race",
        gameType: options.gameType || this.gameType,
      battleType: options.battleType || options.gameType || this.gameType,
        trackId: options.trackId || "test_box",
      arenaId: options.arenaId || options.trackId || "test_box",
        scoreLimit: options.scoreLimit || 5,
      botCount: options.botCount ?? 0,
      loadoutId: options.loadoutId || "classic",
      weaponPool,
        smokeMode: options.smokeMode || "",
        partyCode: options.partyCode || "",
      isHost: !!options.isHost,
        kartId: options.kartId || "tux",
        playerColor: options.playerColor || "red",
        gloEffect: options.gloEffect || "solid",
        gloColor: options.gloColor || "#ff0080",
        gloColor2: options.gloColor2 || "#00e5ff",
      customTrackData: options.customTrackData || "",
      directPlaytest: !!options.directPlaytest,
    };

    emitPlaytestProgress({
      phase: 'connect',
      label: 'Preparing realtime shell',
      detail: `${joinOptions.gameMode.toUpperCase()} Â· ${joinOptions.arenaId || joinOptions.trackId}`,
      progress: 0.18,
    });

    // Load visual assets before connecting
    console.log('[realtime] connect: loading scene assets...');
    await this.loadSceneAssets(joinOptions);
    console.log('[realtime] connect: scene assets loaded OK');

    // Per-arena environment (sky, fog, lighting)
    this._setupArenaEnvironment(joinOptions.arenaId || joinOptions.trackId || 'debug_arena');

    // â”€â”€ Defer heavy init work across frames to avoid jank â”€â”€
    // Each setTimeout(fn, 0) yields to the browser between operations,
    // preventing long frames during the sync init that blocks rendering.
    const _deferFrame = () => new Promise(r => setTimeout(r, 0));

    // Particles â€” 4 systems + textures
    initParticles(this.scene);
    createLockReticle();
    await _deferFrame();

    // Battle-specific VFX + HUD (80+ GUI controls)
    if (joinOptions.gameMode === 'battle') {
      initBattleVFX(this.scene);
      await _deferFrame();
      initWeaponFXEnhance(this.scene, this.camera);
      await _deferFrame();
      loadBattleAssets(this.scene).catch(e => console.warn('[battle-assets] preload error:', e));
      createBattleGUIHud(this.scene);
      await _deferFrame();
      this._installBattleDebugHooks();
    }

    // Init minimap
    if (joinOptions.gameMode !== "battle") {
      try { createMinimap(joinOptions.trackId || 'test_box', this.scene); } catch (_) {}
    } else if (this._autoMapDef?.aabb && this._allowBattleMinimap()) {
      try {
        const aabb = this._autoMapDef.aabb;
        createBattleMinimap(
          joinOptions.trackId || 'glo_arena',
          { min: { x: aabb.min.x, z: aabb.min.z }, max: { x: aabb.max.x, z: aabb.max.z } },
          (this._autoMapDef.itemPositions || []).map(p => ({ x: p.x, z: p.z })),
        );
      } catch (_) {}
    }

    console.log('[realtime] connect: join roomName=' + this.roomName + ' endpoint=' + this.endpoint);
    this.room = await this.client.joinOrCreate(this.roomName, joinOptions);
    console.log('[realtime] connect: joined room sessionId=' + this.room.sessionId);
    emitPlaytestProgress({
      phase: 'connect',
      label: 'Room synchronized',
      detail: `Session ${this.room.sessionId}`,
      progress: 0.98,
    });
    this._installLowLevelFrameTrace();
    this._joinOptions = joinOptions;
    this._startNetworkSync();
    this._renderSyncDebugPanel();
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.roomJoined = true;
      window.__gloDebug.sessionId = this.room.sessionId;
      window.__gloDebug.roomId = this.room.id || null;
      window.__gloClient = this;
    }

    // â”€â”€ Show prematch lobby (hides loading screen) â”€â”€
    if (!joinOptions.directPlaytest) {
      const ls = document.getElementById('loading-screen');
      if (ls) { ls.style.opacity = '0'; setTimeout(() => ls.style.display = 'none', 500); }
      // Build a minimal player map from joinOptions for the initial card
      const initialPlayers = new Map();
      initialPlayers.set(this.room.sessionId, {
        name: joinOptions.playerName,
        playerKart: joinOptions.kartId,
        gloEffect: joinOptions.gloEffect,
        gloColor: joinOptions.gloColor,
        gloColor2: joinOptions.gloColor2,
      });
      PrematchLobby.show(
        { players: initialPlayers },
        this.room.sessionId,
        joinOptions,
      );
    }

    // â”€â”€ Havok trigger observable â€” physics-based item pickup + projectile/trap hits â”€â”€
    if (this.havokPlugin) {
      this.havokPlugin.onTriggerCollisionObservable.add((event) => {
        if (event.type !== "TRIGGER_ENTERED") return;

        const meshA = event.collider?.transformNode;
        const meshB = event.collidedAgainst?.transformNode;

        // Identify which body is the local kart and which is the entity
        let entityMesh = null;
        if (meshA === this.localMesh && meshB?._entityId) entityMesh = meshB;
        else if (meshB === this.localMesh && meshA?._entityId) entityMesh = meshA;
        else return;

        const entityId = entityMesh._entityId;
        const entity = this.authoritativeState?.entities?.get(entityId);
        if (!entity || !entity.active) return;

        if (entity.type === "item_box") {
          this._queueItemBoxPickup(entityId, entityMesh, 'trigger');
        }
        // Projectile/trap trigger hits are handled server-side (tickProjectiles)
        // but could be used for client-side prediction in Phase 2
      });
    }

    // Handle the 'joined' acknowledgment from the game room
    this.room.onMessage("joined", (msg) => {
      console.log("[realtime] Joined game room:", msg);
      this._applySyncConfig(msg?.sync);
      this._startNetworkSync();
      this._renderSyncDebugPanel();
    });

    this.room.onMessage("timeSync", (msg) => {
      this._handleTimeSync(msg);
    });

    this.room.onMessage("syncMetricsSnapshot", (msg) => {
      this._handleSyncMetrics(msg);
    });

    this.room.onLeave((code) => {
      if (this._autoStartTimer) {
        clearTimeout(this._autoStartTimer);
        this._autoStartTimer = null;
      }
      if (this._stateCatchupTimer) {
        clearInterval(this._stateCatchupTimer);
        this._stateCatchupTimer = null;
      }
      this._stopNetworkSync();
    });

    // Handle countdown sequence from server
    this.room.onMessage("startSequence", (msg) => {
      this._beginServerCountdown(msg);
    });

    this.room.onMessage("startCancelled", () => {
      this._cancelServerCountdown();
    });

    // Handle match going live
    this.room.onMessage("matchLive", (msg) => {
      this._enterMatchLive(msg);
    });

    this.room.onStateChange((state) => {
      this._applyRoomStateSnapshot(state, joinOptions);
      // Refresh post-game lobby player chips when room state changes
      if (this._postGamePlayerRefresh) this._postGamePlayerRefresh();
    });

    const initialState = this.room.state;
    if (initialState) {
      this._applyRoomStateSnapshot(initialState, joinOptions);
    }
    this._startStateCatchup(joinOptions);
    this._sendClientReadySignal();

    this.room.onMessage("itemReceived", (msg) => {
      console.log("[colyseus] Item received!", msg);
      const slot = msg.slot || "secondary";
      if (slot === "reserve") {
        // Item went to reserve slot
        this.reserveWeapon = msg.weapon || "";
        this.reserveAmmo = Math.max(0, Number(msg.ammo ?? 0));
        this._localCombatState = {
          ...this._localCombatState,
          weapon3: msg.weapon || "",
          ammo3: this.reserveAmmo,
        };
      } else {
        // Item went to secondary (active) slot
        this.currentWeapon2 = msg.weapon || "";
        this._localCombatState = {
          ...this._localCombatState,
          weapon2: msg.weapon || "",
          ammo2: Math.max(0, Number(msg.ammo ?? 0)),
          maxCooldownMs2: Number(msg.cooldownMs || 0),
        };
      }
      // Sync reserve state from server if included
      if (msg.reserve) {
        this.reserveWeapon = msg.reserve.weapon || "";
        this.reserveAmmo = Number(msg.reserve.ammo || 0);
        this._localCombatState.weapon3 = this.reserveWeapon;
        this._localCombatState.ammo3 = this.reserveAmmo;
      }
      this._publishWeaponDebugState();
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastWeaponReceived = msg.weapon;
      updateGUIWeapon(this._localCombatState, WEAPON_DISPLAY);
      if (slot === "reserve") {
        pulseGUIReserveSlot();
      } else {
        pulseGUIWeaponSlot();
      }
      if (areBattleAssetsLoaded()) playBattleSound('pickup', { volume: 0.52 });
      else playSFX('pickup');
      window.dispatchEvent(new CustomEvent("weaponEquipped", { detail: msg }));
      // Quick green screen flash â€” confirms the pickup without any extra assets
      const flash = document.createElement('div');
      Object.assign(flash.style, {
        position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10000',
        background: 'rgba(80, 255, 140, 0.22)', transition: 'opacity 0.5s',
      });
      document.body.appendChild(flash);
      requestAnimationFrame(() => {
        flash.style.opacity = '0';
        setTimeout(() => flash.remove(), 520);
      });
    });

    this.room.onMessage("secondaryWeaponSwapped", (msg) => {
      this.currentWeapon2 = msg?.active?.weapon || "";
      this.reserveWeapon = msg?.reserve?.weapon || "";
      this.reserveAmmo = Number(msg?.reserve?.ammo || 0);
      this._localCombatState = {
        ...this._localCombatState,
        weapon2: this.currentWeapon2,
        ammo2: Number(msg?.active?.ammo || 0),
        maxCooldownMs2: Number(msg?.cooldownMs || 0),
        weapon3: this.reserveWeapon,
        ammo3: this.reserveAmmo,
      };
      this._publishWeaponDebugState();
      updateGUIWeapon(this._localCombatState, WEAPON_DISPLAY);
      pulseGUIWeaponSlot();
      pulseGUIReserveSlot();
    });

    this.room.onMessage("projectileFired", (msg) => {
      this._enqueueBurstMessage(this._queuedProjectileFires, msg, MAX_QUEUED_PROJECTILE_EVENTS);
    });

    this.room.onMessage("projectileHit", (msg) => {
      this._enqueueBurstMessage(this._queuedProjectileHits, msg, MAX_QUEUED_IMPACT_EVENTS);
    });

    this.room.onMessage("kartCrash", (msg) => {
      this._enqueueBurstMessage(this._queuedKartCrashes, msg, MAX_QUEUED_CRASH_EVENTS);
    });

    this.room.onMessage("effectApplied", (msg) => {
      console.log("[colyseus] Effect applied:", msg.type, "on", msg.target);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastEffect = msg.type;
      if (msg.type === 'mirror') this._playAnomalyCue('mirror_realm_ready', 0.9);
      if (msg.type === 'phase_shift_swap') {
        this._playAnomalyCue('phase_shift_ready', 0.95);
        this._handlePhaseShiftSwap(msg);
        return;
      }
      if (this.room && msg.target === this.room.sessionId) {
        this.showEffectOverlay(msg.type, msg.duration || 2000);
      }
    });

    this.room.onMessage("arenaEffectApplied", (msg) => {
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastArenaEffect = msg.type;
      this._playAnomalyCue(msg.type === 'arena_rain' ? 'arena_rain' : 'arena_fog', 1);
      this.showArenaEffectOverlay(msg.type, msg.duration || 4000);
    });

    this.room.onMessage("arenaEffectCleared", () => {
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastArenaEffect = null;
      this._playAnomalyCue('arena_clear', 0.7);
      this._clearArenaEffectOverlay();
    });

    this.room.onMessage("shieldAbsorbed", (msg) => {
      console.log("[colyseus] Shield absorbed hit for", msg.victimId, "HP:", msg.shieldHP);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastShieldAbsorbed = msg.victimId;
      const projectileMesh = msg.projectileId ? this.entityMeshes.get(msg.projectileId) : null;
      if (projectileMesh) projectileMesh._impactHandled = true;
      if (this.room && msg.victimId === this.room.sessionId) {
        this.flashShield();
        if (msg.shieldBroken && this.localMesh) emitShieldBreak(this.localMesh.position);
      }
      // Remote player shield break
      if (msg.shieldBroken) {
        const shieldVictimMesh = this.remoteMeshes.get(msg.victimId);
        if (shieldVictimMesh) emitShieldBreak(shieldVictimMesh.position);
      }
    });

    // â”€â”€ Kill feed for battle mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.room.onMessage("playerKilled", (msg) => {
      this._addKillFeedEntry(msg.attackerName, msg.victimName, msg.weapon, msg);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastKill = msg;

      // Kill celebration VFX + multi-kill banner for local attacker
      if (this.room && msg.attackerId === this.room.sessionId) {
        if (this.localMesh && this._allowBattleImpactPolish()) emitKillCelebration(this.localMesh.position);
        playBattleSound('sparkle_hit', { volume: 0.48, cooldownMs: 80 });
        const streak = msg.multiKill || msg.killStreak || 1;
        if (streak >= 2 && this._allowBattleHudPolish()) showMultiKillBanner(streak);
      }
      // Death VFX at victim position
      const killVictimMesh = this.remoteMeshes.get(msg.victimId);
      if (killVictimMesh) {
        const recentImpact = this._lastProjectileImpactMeta;
        const duplicatedImpact = recentImpact
          && recentImpact.victimId === msg.victimId
          && recentImpact.subType === msg.weapon
          && (performance.now() - recentImpact.at) < 260;
        if (!duplicatedImpact && this._allowBattleImpactPolish()) {
          emitBattleExplosion(killVictimMesh.position, msg.weapon);
        }
        playBattleSound('death', { volume: 0.72, cooldownMs: 110 });
      }
    });

    // â”€â”€ Death sequence trigger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.room.onMessage("playerDied", (msg) => {
      if (this.room && msg.victimId === this.room.sessionId) {
        if (this._allowBattleCameraJuice()) shakeCamera(this.camera, 0.5, 600);
        if (this._allowBattleHudPolish()) flashDamageVignette();
        this._startDeathSequence(msg);
      }
    });

    // â”€â”€ Elimination (balloon mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.room.onMessage("playerEliminated", (msg) => {
      this._addKillFeedEntry('', msg.playerName, '', { callout: 'â˜ ï¸ ELIMINATED' });
      // If we were eliminated, enter spectator
      if (this.room && msg.playerId === this.room.sessionId) {
        this._localLives = 0;
        updateGUILives(0);
        this._enterSpectatorMode();
      }
    });

    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.matchEnded = msg;
      stopEngineSound();
      stopBGM();
      // Reset match state so the next match cycle can fire properly
      this._matchLiveHandled = false;
      this.started = false;
      this._kartReady = false;
      this._audioStarted = false;
      this._showMatchEndScreen(msg);
    });

    // â”€â”€ Race lap messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.room.onMessage("lapStarted", (msg) => {
      this._lapCount = msg.lap || 1;
      this._totalLaps = msg.totalLaps || 3;
      this._updateLapHud();
    });

    this.room.onMessage("yourLap", (msg) => {
      this._lapCount = msg.lap;
      this._totalLaps = msg.totalLaps || this._totalLaps;
      this._updateLapHud();
      this._showLapOverlay(`LAP ${msg.lap} / ${msg.totalLaps}`);
      if (msg.lap === msg.totalLaps) playSFX('last_lap');
      // Extend cooldown â€” don't re-trigger finish line for 18s
      this._lapCooldownUntil = Date.now() + 18000;
    });

    this.room.onMessage("lapComplete", (msg) => {
      // Another player completed a lap â€” update leaderboard if exposed
      console.log(`[race] ${msg.name} completed lap ${msg.lap}/${msg.totalLaps}`);
    });

    this.room.onMessage("youFinished", (msg) => {
      this._raceFinished = true;
      playSFX('race_finish');
      this._showLapOverlay(`FINISHED  P${msg.position}!`, 5000);
      this._lapCooldownUntil = Date.now() + 999999; // stop any further triggers
    });

    this.room.onMessage("raceFinished", (msg) => {
      console.log(`[race] ${msg.name} finished P${msg.position}`);
    });

    // Start keyboard input loop
    this.setupInputLoop();

    // Auto-start only once enough players are present; this avoids starting the
    // countdown while a second local client is still finishing heavy asset load.
    const configuredMaxPlayers = Number(joinOptions.maxPlayers || this.maxPlayers || 1);
    const requiredPlayers = configuredMaxPlayers > 1 ? 2 : 1;
    const tryAutoStart = () => {
      this._autoStartTimer = null;
      if (!this.room || this.started || this._matchLiveHandled) return;

      const playerCount = this.authoritativeState?.players?.size || this.room?.state?.players?.size || 0;
      if (playerCount >= requiredPlayers) {
        console.log(`[realtime] Sending auto-start to game room (players=${playerCount})...`);
        this.room.send("start", {});
        return;
      }

      this._autoStartTimer = setTimeout(tryAutoStart, 1000);
    };

    this._autoStartTimer = setTimeout(tryAutoStart, 6000);

    return this.room;
  }

  _applySyncConfig(sync = {}) {
    if (!sync || typeof sync !== 'object') return;
    if (Number.isFinite(sync.patchRateMs)) this._networkStats.patchRateMs = sync.patchRateMs;
    if (Number.isFinite(sync.interpolationBaseDelayMs)) this._networkStats.baseInterpolationDelayMs = sync.interpolationBaseDelayMs;
    if (typeof sync.authoritative === 'boolean') this._networkStats.authoritative = sync.authoritative;
    this._updateInterpolationDelay();
    this._renderSyncDebugPanel();
  }

  _applySyncConfigFromState(state) {
    if (!state) return;
    this._applySyncConfig({
      patchRateMs: Number(state.syncPatchRateMs || 0),
      simulationHz: Number(state.syncSimulationHz || 0),
      staleInputMs: Number(state.syncStaleInputMs || 0),
      interpolationBaseDelayMs: Number(state.syncInterpolationBaseDelayMs || 0),
      authoritative: !!state.syncAuthoritative,
    });
  }

  _beginServerCountdown(msg = {}) {
    const durationMs = Math.max(0, Number(msg.durationMs || 0));
    const serverNow = Number(msg.serverNow || Date.now());
    const startAt = Number(msg.startAt || (serverNow + durationMs));
    if (!startAt || (this._countdownStartAt && this._countdownStartAt === startAt)) return;

    this._cancelServerCountdown(false);
    this._countdownStartAt = startAt;

    console.log("[realtime] Start sequence â€” match begins in", durationMs, "ms");
    const totalSec = Math.max(0, Math.round(durationMs / 1000));
    PrematchLobby.startCountdown(totalSec);

    const clientStartAt = startAt + (Date.now() - serverNow);
    const timeUntilBeep = Math.max(0, clientStartAt - Date.now() - 3500);
    this._countdownAudioTimer = window.setTimeout(() => {
      playCountdownSequence();
      this._countdownAudioTimer = null;
    }, timeUntilBeep);

    if (durationMs > 0) {
      this._countdownVisualTimer = window.setTimeout(() => {
        this._countdownVisualTimer = null;
      }, durationMs + 100);
    }
  }

  _cancelServerCountdown(resetLobby = true) {
    this._countdownStartAt = 0;
    if (this._countdownAudioTimer) {
      window.clearTimeout(this._countdownAudioTimer);
      this._countdownAudioTimer = null;
    }
    if (this._countdownVisualTimer) {
      window.clearTimeout(this._countdownVisualTimer);
      this._countdownVisualTimer = null;
    }
    if (this._countdownEl) {
      this._countdownEl.remove();
      this._countdownEl = null;
    }
    if (resetLobby && PrematchLobby.isVisible()) {
      PrematchLobby.cancelCountdown('WAITING');
    }
  }

  _syncCountdownFromState(state) {
    if (!state || this._matchLiveHandled) return;
    if (state.started) {
      this._cancelServerCountdown();
      return;
    }

    if (state.countdownActive && Number(state.countdownStartAt || 0) > 0) {
      this._beginServerCountdown({
        durationMs: Number(state.countdownDurationMs || 0),
        startAt: Number(state.countdownStartAt || 0),
        serverNow: Number(state.serverTime || Date.now()),
      });
      return;
    }

    if (this._countdownStartAt) {
      this._cancelServerCountdown();
    }
  }

  _installLowLevelFrameTrace() {
    if (this._lowLevelTraceInstalled || !this.room?.connection?.events?.onmessage) return;

    const originalOnMessage = this.room.connection.events.onmessage.bind(this.room);
    this.room.connection.events.onmessage = (event) => {
      try {
        const raw = event?.data;
        let protocolCode = null;
        let byteLength = 0;
        if (raw instanceof ArrayBuffer) {
          const bytes = new Uint8Array(raw);
          protocolCode = bytes[0] ?? null;
          byteLength = bytes.byteLength;
        } else if (ArrayBuffer.isView(raw)) {
          const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
          protocolCode = bytes[0] ?? null;
          byteLength = bytes.byteLength;
        }

        const record = {
          at: Date.now(),
          protocolCode,
          protocol: COLYSEUS_PROTOCOL_NAMES[protocolCode] || `UNKNOWN_${protocolCode ?? 'NA'}`,
          bytes: byteLength,
        };

        if (typeof window !== 'undefined' && window.__gloDebug) {
          const frames = Array.isArray(window.__gloDebug.lowLevelFrames)
            ? window.__gloDebug.lowLevelFrames
            : [];
          frames.push(record);
          window.__gloDebug.lowLevelFrames = frames.slice(-20);
        }

        if (protocolCode != null) {
          console.log('[realtime] raw frame', record.protocol, `bytes=${record.bytes}`);
        }
      } catch (_) {
        // Low-level tracing must never break the actual Colyseus handler.
      }

      return originalOnMessage(event);
    };

    this._lowLevelTraceInstalled = true;
  }

  _sendClientReadySignal(force = false) {
    if (!this.room || this.roomName !== 'battle_room') return;
    const now = Date.now();
    if (!force && this._clientReadySent) return;
    if (force && (now - this._lastReadySignalAt) < 1200) return;
    this.room.send('clientReady', { sentAt: Date.now() });
    this._clientReadySent = true;
    this._lastReadySignalAt = now;
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.readySignalSent = true;
    }
  }

  _applyRoomStateSnapshot(state, joinOptions = this._joinOptions || {}) {
    if (!state) return;

    this.started = !!state.started;
    this.authoritativeState = state;
    this._applySyncConfigFromState(state);
    this._syncCountdownFromState(state);
    this.reconcile(state);
    this.syncRemoteMeshes(state);
    this.syncEntities(state);

    if (this.started && !this._matchLiveHandled) {
      this._enterMatchLive({ startedAt: state?.serverTime || Date.now(), derivedFromState: true });
    }
    if (typeof window !== 'undefined' && window.__gloDebug && state?.players) {
      window.__gloDebug.playerCount = state.players.size;
      window.__gloDebug.readyCount = Number(state.readyCount || 0);
      window.__gloDebug.readyRequiredCount = Number(state.readyRequiredCount || 0);
    }
    if (
      this.roomName === 'battle_room'
      && !this.started
      && !this._matchLiveHandled
      && Number(state?.players?.size || 0) >= 2
      && Number(state?.readyCount || 0) < Number(state?.readyRequiredCount || 0)
    ) {
      this._sendClientReadySignal(true);
    }

    if (PrematchLobby.isVisible() && state?.players) {
      PrematchLobby.updatePlayers(state, this.room.sessionId);
    }

    if (this.started && !this._audioStarted) {
      this._audioStarted = true;
      startEngineSound();
      if (joinOptions.gameMode === 'battle') {
        playBattleMusic(joinOptions.trackId || 'glo_arena');
        if (this._allowArenaAmbience()) {
          startAmbientLoop(joinOptions.trackId || 'glo_arena');
        }
      } else {
        playTrackMusic(joinOptions.trackId || 'test_box');
      }
    }
  }

  _startStateCatchup(joinOptions = this._joinOptions || {}) {
    if (this._stateCatchupTimer) {
      clearInterval(this._stateCatchupTimer);
      this._stateCatchupTimer = null;
    }

    let attempts = 0;
    this._stateCatchupTimer = setInterval(() => {
      attempts += 1;
      if (!this.room) {
        clearInterval(this._stateCatchupTimer);
        this._stateCatchupTimer = null;
        return;
      }

      const snapshot = this.room.state;
      if (snapshot) {
        this._applyRoomStateSnapshot(snapshot, joinOptions);
      }

      const playerCount = snapshot?.players?.size || 0;
      const waitingForBattleLive = this.roomName === 'battle_room'
        && playerCount > 0
        && !this._matchLiveHandled
        && (!!snapshot?.countdownActive || !snapshot?.started);
      const shouldStop = attempts >= 80
        || (!waitingForBattleLive && playerCount > 0 && (this._matchLiveHandled || attempts >= 10))
        || (playerCount === 0 && attempts >= 20);
      if (shouldStop) {
        clearInterval(this._stateCatchupTimer);
        this._stateCatchupTimer = null;
      }
    }, 500);
  }

  _startNetworkSync() {
    this._stopNetworkSync();
    const sendTimeSync = () => {
      if (!this.room) return;
      this.room.send('timeSync', { clientSentAt: Date.now() });
    };
    const pollMetrics = () => {
      if (!this.room) return;
      this.room.send('syncMetricsRequest', {});
    };
    sendTimeSync();
    pollMetrics();
    this._timeSyncInterval = window.setInterval(sendTimeSync, 2000);
    this._metricsPollInterval = window.setInterval(pollMetrics, 1000);
  }

  _stopNetworkSync() {
    if (this._timeSyncInterval) {
      window.clearInterval(this._timeSyncInterval);
      this._timeSyncInterval = null;
    }
    if (this._metricsPollInterval) {
      window.clearInterval(this._metricsPollInterval);
      this._metricsPollInterval = null;
    }
  }

  _handleTimeSync(msg = {}) {
    const clientSentAt = Number(msg.clientSentAt || 0);
    const serverReceivedAt = Number(msg.serverReceivedAt || 0);
    const serverSentAt = Number(msg.serverSentAt || serverReceivedAt || 0);
    const clientReceivedAt = Date.now();
    if (!clientSentAt || !serverReceivedAt || !serverSentAt) return;

    const rtt = Math.max(0, clientReceivedAt - clientSentAt);
    const midpoint = (clientSentAt + clientReceivedAt) * 0.5;
    const serverMidpoint = (serverReceivedAt + serverSentAt) * 0.5;
    const offset = serverMidpoint - midpoint;

    this._networkStats.rttMs = this._networkStats.rttMs
      ? this._networkStats.rttMs + (rtt - this._networkStats.rttMs) * 0.2
      : rtt;
    const jitter = Math.abs(rtt - (this._networkStats._lastRttMs || rtt));
    this._networkStats.jitterMs = this._networkStats.jitterMs
      ? this._networkStats.jitterMs + (jitter - this._networkStats.jitterMs) * 0.2
      : jitter;
    this._networkStats._lastRttMs = rtt;
    this._networkStats.clockOffsetMs = this._networkStats.clockOffsetMs
      ? this._networkStats.clockOffsetMs + (offset - this._networkStats.clockOffsetMs) * 0.2
      : offset;
    this._networkStats.lastTimeSyncAt = clientReceivedAt;

    this._applySyncConfig(msg);
    this._updateInterpolationDelay();

    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.network = {
        rttMs: Math.round(this._networkStats.rttMs),
        jitterMs: Math.round(this._networkStats.jitterMs),
        interpolationDelayMs: Math.round(this._networkStats.interpolationDelayMs),
        patchRateMs: Math.round(this._networkStats.patchRateMs),
        authoritative: this._networkStats.authoritative,
      };
    }
    this._renderSyncDebugPanel();
  }

  _handleSyncMetrics(msg = {}) {
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.syncMetrics = msg;
    }
    this._renderSyncDebugPanel(msg);
  }

  _updateInterpolationDelay() {
    const base = Number(this._networkStats.baseInterpolationDelayMs || 110);
    const rtt = Number(this._networkStats.rttMs || 0);
    const jitter = Number(this._networkStats.jitterMs || 0);
    const patch = Number(this._networkStats.patchRateMs || 100);
    this._networkStats.interpolationDelayMs = Math.max(
      60,
      Math.min(260, Math.round(Math.max(base, patch + rtt * 0.75 + jitter * 2))),
    );
  }

  _getRemoteInterpolationAlpha(dtSeconds) {
    const delayMs = Math.max(50, Number(this._networkStats.interpolationDelayMs || 110));
    return Math.max(0.08, Math.min(0.45, (dtSeconds * 1000) / delayMs));
  }

  _ensureSyncDebugPanel() {
    if (this._syncDebugPanelEl || typeof document === 'undefined') return this._syncDebugPanelEl;
    const shell = document.createElement('div');
    shell.id = 'sync-debug-shell';
    Object.assign(shell.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      zIndex: '90',
      pointerEvents: 'auto',
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'sync-debug-toggle';
    button.setAttribute('aria-label', 'Toggle sync monitor');
    Object.assign(button.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '42px',
      height: '42px',
      padding: '0 12px',
      borderRadius: '21px',
      border: '1px solid rgba(152,230,247,0.34)',
      background: 'linear-gradient(132deg, rgba(72,58,44,0.92) 0%, rgba(48,42,36,0.82) 45%, rgba(22,26,34,0.8) 100%)',
      color: '#dff7ff',
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      cursor: 'pointer',
      boxShadow: '0 12px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(245,232,210,0.12)',
      backdropFilter: 'blur(12px) saturate(118%)',
      WebkitBackdropFilter: 'blur(12px) saturate(118%)',
    });
    button.textContent = 'Sync';

    const panel = document.createElement('div');
    panel.id = 'sync-debug-panel';
    Object.assign(panel.style, {
      display: 'none',
      marginTop: '10px',
      width: '248px',
      maxHeight: '80vh',
      overflowY: 'auto',
      padding: '14px 14px 12px',
      borderRadius: '16px',
      background: 'linear-gradient(132deg, rgba(72,58,44,0.86) 0%, rgba(48,42,36,0.72) 45%, rgba(22,26,34,0.72) 100%)',
      border: '1px solid rgba(196,176,146,0.42)',
      color: '#ffffff',
      fontFamily: '"Rajdhani", "Exo 2", sans-serif',
      fontSize: '12px',
      lineHeight: '1.35',
      boxShadow: '0 16px 42px rgba(0,0,0,0.38), inset 0 1px 0 rgba(245,232,210,0.14)',
      backdropFilter: 'blur(16px) saturate(120%)',
      WebkitBackdropFilter: 'blur(16px) saturate(120%)',
      pointerEvents: 'auto',
      opacity: '0.98',
    });

    const applyExpandedState = () => {
      const expanded = !!this._syncDebugExpanded;
      panel.style.display = expanded ? 'block' : 'none';
      button.textContent = expanded ? 'Hide' : 'Sync';
      button.style.color = expanded ? '#98e6f7' : '#dff7ff';
    };

    button.addEventListener('click', () => {
      this._syncDebugExpanded = !this._syncDebugExpanded;
      applyExpandedState();
    });

    shell.appendChild(button);
    shell.appendChild(panel);
    document.body.appendChild(shell);
    applyExpandedState();
    this._syncDebugPanelEl = panel;
    this._syncDebugToggleEl = button;
    return panel;
  }

  _renderSyncDebugPanel(snapshot = null) {
    const panel = this._ensureSyncDebugPanel();
    if (!panel) return;
    const metrics = snapshot || (typeof window !== 'undefined' ? window.__gloDebug?.syncMetrics : null) || {};
    const rows = [
      ['auth', this._networkStats.authoritative ? 'ON' : 'OFF'],
      ['rtt', `${Math.round(this._networkStats.rttMs || 0)} ms`],
      ['jitter', `${Math.round(this._networkStats.jitterMs || 0)} ms`],
      ['interp', `${Math.round(this._networkStats.interpolationDelayMs || 0)} ms`],
      ['patch', `${Math.round(this._networkStats.patchRateMs || 0)} ms`],
      ['tick drift', `${Number(metrics.avgTickDriftMs || 0).toFixed(2)} ms`],
      ['input avg', `${Number(metrics.avgInputAgeMs || 0).toFixed(2)} ms`],
      ['input max', `${Math.round(metrics.maxInputAgeMs || 0)} ms`],
      ['stale drop', String(metrics.staleInputDrops || 0)],
      ['ooo drop', String(metrics.outOfOrderInputDrops || 0)],
      ['players', String(metrics.playerCount || this.authoritativeState?.players?.size || 0)],
    ];
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:12px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.2em;text-transform:uppercase;color:rgba(245,232,210,0.84);">Sync Monitor</div>
        <div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${this._networkStats.authoritative ? '#98e6f7' : '#f0b1bf'};">${this.roomName.replace('_room', '').toUpperCase()}</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:flex-end;margin-bottom:10px;">
        <div style="width:152px;height:28px;border-radius:14px;border:1px solid rgba(152,230,247,0.34);background:rgba(78,94,92,0.24);display:flex;align-items:center;padding:0 10px;position:relative;overflow:hidden;">
          <div style="font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:rgba(198,234,245,0.86);">Scan</div>
          <div style="position:absolute;right:12px;left:52px;height:2px;border-radius:2px;background:rgba(180,222,235,0.18);"></div>
          <div style="position:absolute;left:56px;width:26px;height:2px;border-radius:2px;background:rgba(180,240,255,0.7);"></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;column-gap:14px;row-gap:5px;">
        ${rows.map(([label, value]) => `<div style="font-size:10px;font-weight:700;letter-spacing:0.09em;text-transform:uppercase;color:rgba(245,232,210,0.7);">${label}</div><div style="font-size:12px;font-weight:700;color:#f2fbff;text-align:right;">${value}</div>`).join('')}
      </div>
    `;
    this._renderWeaponLab(panel);
  }

  // â”€â”€ Weapon Lab â€” individual pickup test mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _renderWeaponLab(panel) {
    if (this.roomName !== 'battle_room') return;

    // Reuse or create the weapon lab container (avoid full re-render flicker)
    let lab = panel.querySelector('#weapon-lab');
    if (!lab) {
      lab = document.createElement('div');
      lab.id = 'weapon-lab';
      panel.appendChild(lab);
    }

    const expanded = !!this._weaponLabExpanded;
    const activeW2 = this._localCombatState?.weapon2 || '';
    const activeW3 = this._localCombatState?.weapon3 || '';
    const ammo2 = this._localCombatState?.ammo2 ?? 0;
    const ammo3 = this._localCombatState?.ammo3 ?? 0;
    const cooldown2 = this._localCombatState?.fireCooldown2 ?? 0;

    // Group weapons by category
    const categories = {};
    for (const [id, info] of Object.entries(WEAPON_DISPLAY)) {
      if (id === 'glo_burst' || id === 'shield' || id === 'banana' || id === 'ludicrous_mode') continue;
      const cat = info.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ id, ...info });
    }

    // Category display order
    const catOrder = ['Elemental', 'Projectile', 'Trap', 'Melee', 'Debuff', 'Buff', 'Utility', 'Defence', 'Stream'];
    const sorted = catOrder.filter(c => categories[c]).map(c => [c, categories[c]]);

    // Current weapon status
    const activeDisplay = WEAPON_DISPLAY[activeW2];
    const statusIcon = activeDisplay ? activeDisplay.icon : 'â€”';
    const statusName = activeDisplay ? (activeDisplay.displayName || activeW2.replace(/_/g, ' ')) : 'NONE';
    const statusColor = activeDisplay ? activeDisplay.hue : '#666';

    const headerStyle = `display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding-top:12px;border-top:1px solid rgba(152,230,247,0.18);cursor:pointer;user-select:none;`;

    let html = `<div id="weapon-lab-header" style="${headerStyle}">
      <div style="display:flex;align-items:center;gap:6px;">
        <div style="font-size:10px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase;color:rgba(245,210,160,0.9);">Weapon Lab</div>
        <div style="font-size:12px;opacity:0.7;">${expanded ? 'â–¾' : 'â–¸'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;">
        <span style="font-size:13px;">${statusIcon}</span>
        <span style="font-size:10px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.06em;">${statusName}</span>
        ${ammo2 > 0 ? `<span style="font-size:9px;font-weight:700;color:rgba(255,255,255,0.5);margin-left:2px;">Ã—${ammo2}</span>` : ''}
      </div>
    </div>`;

    if (expanded) {
      // Fire + Clear buttons
      html += `<div style="display:flex;gap:6px;margin:10px 0 8px;">
        <button id="wlab-fire" style="flex:1;height:28px;border-radius:8px;border:1px solid rgba(255,120,80,0.6);background:rgba(255,80,40,0.25);color:#ffb899;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">ðŸ”¥ Fire</button>
        <button id="wlab-fire-reserve" style="flex:1;height:28px;border-radius:8px;border:1px solid rgba(180,140,255,0.5);background:rgba(140,100,220,0.2);color:#d4bbff;font-family:inherit;font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;cursor:pointer;">ðŸ”„ Swap+Fire</button>
        <button id="wlab-clear" style="width:42px;height:28px;border-radius:8px;border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);font-family:inherit;font-size:10px;font-weight:700;cursor:pointer;">âœ•</button>
      </div>`;

      // Weapon status detail
      if (activeW2) {
        html += `<div style="margin-bottom:10px;padding:6px 8px;border-radius:8px;background:rgba(${this._hexToRgb(statusColor)},0.12);border:1px solid rgba(${this._hexToRgb(statusColor)},0.3);">
          <div style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:3px;">Equipped Secondary</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:16px;">${statusIcon}</span>
            <div>
              <div style="font-size:11px;font-weight:800;color:#fff;text-transform:uppercase;">${statusName}</div>
              <div style="font-size:9px;color:rgba(255,255,255,0.5);">ammo ${ammo2} Â· cd ${Math.round(cooldown2)}ms</div>
            </div>
          </div>
        </div>`;
      }
      if (activeW3) {
        const resDisp = WEAPON_DISPLAY[activeW3];
        html += `<div style="margin-bottom:10px;padding:4px 8px;border-radius:6px;background:rgba(140,100,220,0.1);border:1px solid rgba(140,100,220,0.2);">
          <div style="font-size:9px;font-weight:700;color:rgba(200,180,255,0.7);text-transform:uppercase;">Reserve: ${resDisp?.icon || ''} ${activeW3.replace(/_/g, ' ')} Ã—${ammo3}</div>
        </div>`;
      }

      // Weapon grid by category
      for (const [cat, weapons] of sorted) {
        html += `<div style="font-size:9px;font-weight:800;letter-spacing:0.16em;text-transform:uppercase;color:rgba(200,220,245,0.5);margin:8px 0 4px;">${cat}</div>`;
        html += `<div style="display:flex;flex-wrap:wrap;gap:3px;">`;
        for (const w of weapons) {
          const isActive = w.id === activeW2;
          const isReserve = w.id === activeW3;
          const borderColor = isActive ? w.hue : isReserve ? '#a080e0' : 'rgba(255,255,255,0.12)';
          const bgColor = isActive ? `rgba(${this._hexToRgb(w.hue)},0.25)` : isReserve ? 'rgba(140,100,220,0.15)' : 'rgba(255,255,255,0.04)';
          const textColor = isActive ? '#fff' : 'rgba(255,255,255,0.7)';
          const name = w.displayName || w.id.replace(/_/g, ' ');
          html += `<button class="wlab-btn" data-weapon="${w.id}" title="${name}" style="display:flex;align-items:center;gap:3px;padding:3px 7px;border-radius:6px;border:1px solid ${borderColor};background:${bgColor};color:${textColor};font-family:inherit;font-size:9px;font-weight:700;text-transform:uppercase;cursor:pointer;white-space:nowrap;transition:background 0.15s,border-color 0.15s;">
            <span style="font-size:12px;line-height:1;">${w.icon}</span>
            <span style="letter-spacing:0.04em;">${name.length > 12 ? name.slice(0, 10) + '..' : name}</span>
          </button>`;
        }
        html += `</div>`;
      }

      // Infinite ammo toggle
      const infAmmo = !!this._weaponLabInfiniteAmmo;
      html += `<div style="display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:8px;border-top:1px solid rgba(152,230,247,0.12);">
        <button id="wlab-inf-ammo" style="width:18px;height:18px;border-radius:4px;border:1px solid ${infAmmo ? '#98e6f7' : 'rgba(255,255,255,0.2)'};background:${infAmmo ? 'rgba(152,230,247,0.3)' : 'transparent'};color:${infAmmo ? '#98e6f7' : 'rgba(255,255,255,0.4)'};font-size:11px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;">${infAmmo ? 'âœ“' : ''}</button>
        <span style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);">Infinite Ammo</span>
      </div>`;
    }

    lab.innerHTML = html;

    // Attach event listeners (delegated on the lab container)
    const header = lab.querySelector('#weapon-lab-header');
    if (header) {
      header.onclick = () => {
        this._weaponLabExpanded = !this._weaponLabExpanded;
        this._renderWeaponLab(panel);
      };
    }

    if (expanded) {
      // Weapon buttons
      lab.querySelectorAll('.wlab-btn').forEach(btn => {
        btn.onmouseenter = () => { btn.style.filter = 'brightness(1.3)'; };
        btn.onmouseleave = () => { btn.style.filter = ''; };
        btn.onclick = () => {
          const weaponId = btn.dataset.weapon;
          if (!this.room) return;
          const ammo = this._weaponLabInfiniteAmmo ? 999 : undefined;
          this.room.send('debugGrantWeapon', {
            targetId: this.room.sessionId,
            weaponId,
            ...(ammo !== undefined && { ammo }),
          });
          // Flash the button
          btn.style.background = `rgba(152,230,247,0.4)`;
          setTimeout(() => this._renderWeaponLab(panel), 300);
        };
      });

      // Fire button
      const fireBtn = lab.querySelector('#wlab-fire');
      if (fireBtn) {
        fireBtn.onclick = () => {
          if (this.room && this.currentWeapon2) {
            this.room.send("fireWeapon", { ...this._buildFirePayload('secondary'), slot: 'secondary' });
          }
          fireBtn.style.background = 'rgba(255,80,40,0.5)';
          setTimeout(() => { fireBtn.style.background = 'rgba(255,80,40,0.25)'; }, 200);
        };
      }

      // Swap+Fire button (swap reserve to active, then fire)
      const swapFireBtn = lab.querySelector('#wlab-fire-reserve');
      if (swapFireBtn) {
        swapFireBtn.onclick = () => {
          if (this.room && this.reserveWeapon) {
            this.room.send("swapSecondaryWeapon", {});
            setTimeout(() => {
              if (this.room && this.currentWeapon2) {
                this.room.send("fireWeapon", { ...this._buildFirePayload('secondary'), slot: 'secondary' });
              }
            }, 150);
          }
          swapFireBtn.style.background = 'rgba(140,100,220,0.4)';
          setTimeout(() => { swapFireBtn.style.background = 'rgba(140,100,220,0.2)'; }, 200);
        };
      }

      // Clear button
      const clearBtn = lab.querySelector('#wlab-clear');
      if (clearBtn) {
        clearBtn.onclick = () => {
          // Grant an empty/invalid weapon to clear the slot
          if (this.room) {
            this.room.send('debugGrantWeapon', { targetId: this.room.sessionId, weaponId: '__clear__' });
          }
        };
      }

      // Infinite ammo toggle
      const infBtn = lab.querySelector('#wlab-inf-ammo');
      if (infBtn) {
        infBtn.onclick = () => {
          this._weaponLabInfiniteAmmo = !this._weaponLabInfiniteAmmo;
          this._renderWeaponLab(panel);
        };
      }
    }
  }

  _enqueueBurstMessage(queue, msg, maxSize) {
    queue.push(msg);
    if (queue.length > maxSize) {
      queue.splice(0, queue.length - maxSize);
    }
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.burstQueues = {
        projectileFires: this._queuedProjectileFires.length,
        projectileHits: this._queuedProjectileHits.length,
        kartCrashes: this._queuedKartCrashes.length,
      };
    }
  }

  _drainBurstQueues() {
    const tier = getTier();
    const fireBudget = tier === TIER.LOW ? 4 : tier === TIER.MEDIUM ? 6 : 10;
    const hitBudget = tier === TIER.LOW ? 2 : tier === TIER.MEDIUM ? 4 : 6;
    const crashBudget = tier === TIER.LOW ? 1 : 2;

    for (let i = 0; i < fireBudget && this._queuedProjectileFires.length > 0; i++) {
      this._handleProjectileFiredMessage(this._queuedProjectileFires.shift());
    }
    for (let i = 0; i < hitBudget && this._queuedProjectileHits.length > 0; i++) {
      this._handleProjectileHitMessage(this._queuedProjectileHits.shift());
    }
    for (let i = 0; i < crashBudget && this._queuedKartCrashes.length > 0; i++) {
      this._handleKartCrashMessage(this._queuedKartCrashes.shift());
    }

    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.burstQueues = {
        projectileFires: this._queuedProjectileFires.length,
        projectileHits: this._queuedProjectileHits.length,
        kartCrashes: this._queuedKartCrashes.length,
      };
    }
  }

  _handleProjectileFiredMessage(msg) {
    if (!msg) return;
    console.log("[colyseus] Projectile fired:", msg.subType, "by", msg.ownerId);
    if (areBattleAssetsLoaded()) playWeaponFireSound(msg.subType);
    else playWeaponFireSFX(msg.subType);
    if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastWeaponFired = msg.subType;

    const firerMesh = (msg.ownerId === this.room?.sessionId)
      ? this.localMesh
      : this.remoteMeshes.get(msg.ownerId);
    if (firerMesh && getTier() !== TIER.LOW && runtimePressure() < 0.62) {
      emitMuzzleFlash(firerMesh.position, msg.subType);
    }
  }

  _handleProjectileHitMessage(msg) {
    if (!msg) return;
    console.log("[colyseus] Projectile hit:", msg.victimId, "for", msg.damage, "dmg", msg.subType);
    if (areBattleAssetsLoaded()) {
      playWeaponHitSound(msg.subType, { damage: msg.damage || 30 });
      if (BATTLE_IMPACT_SYNTH_WEAPONS.has(msg.subType)) {
        playWeaponImpactSynth(msg.subType, msg.damage || 30);
      }
    } else {
      playWeaponHitSFX(msg.subType);
      playWeaponImpactSynth(msg.subType, msg.damage || 30);
    }
    if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastHitVictimId = msg.victimId;
    this._lastProjectileImpactMeta = {
      victimId: msg.victimId,
      subType: msg.subType,
      at: performance.now(),
    };
    const projectileMesh = msg.projectileId ? this.entityMeshes.get(msg.projectileId) : null;
    if (projectileMesh) projectileMesh._impactHandled = true;

    const victimMesh = (msg.victimId === this.room?.sessionId)
      ? this.localMesh
      : this.remoteMeshes.get(msg.victimId);
    const impactPosition = Number.isFinite(msg.hitX) && Number.isFinite(msg.hitY) && Number.isFinite(msg.hitZ)
      ? new Vector3(msg.hitX, msg.hitY, msg.hitZ)
      : victimMesh?.position;
    const attackerMesh = (msg.attackerId === this.room?.sessionId)
      ? this.localMesh
      : this.remoteMeshes.get(msg.attackerId);
    if (msg.subType === 'rock_barrage' && impactPosition) {
      this._lastRockImpactTime = performance.now();
      this._lastRockImpactPos = impactPosition.clone ? impactPosition.clone() : new Vector3(impactPosition.x, impactPosition.y, impactPosition.z);
    }
    if (victimMesh) {
      const pos = impactPosition || victimMesh.position;
      if (msg.subType === 'lightning_bolt') {
        if (attackerMesh && this._allowBattleImpactPolish()) {
          emitTeslaArcBetween(
            attackerMesh.position.add(new Vector3(0, 1.2, 0)),
            pos.clone ? pos.clone() : new Vector3(pos.x, pos.y, pos.z),
            1.05,
          );
        }
        if (this._allowBattleImpactPolish()) emitLightningStrike(pos);
      } else if (msg.subType === 'glo_burst' || msg.subType === 'glow_thrower') {
        if (this._allowBattleImpactPolish()) emitStreamImpactVFX(pos, msg.subType);
      } else if (msg.subType === 'missile' || msg.subType === 'crimson_hydra') {
        if (this._allowBattleImpactPolish()) {
          emitWeaponExplosion(
            pos,
            Math.min(msg.damage || 30, 40),
            msg.subType === 'crimson_hydra' ? 0xff4a2a : 0xff7a1c,
          );
        }
      } else {
        if (this._allowBattleImpactPolish()) emitWeaponImpactVFX(pos, msg.subType, msg.damage || 30);
      }
      const victimVFX = msg.victimId === this.room?.sessionId
        ? this._localKartVFX
        : this._remoteKartVFXs.get(msg.victimId);
      if (victimVFX) {
        victimVFX.emitHitBurst();
        if (msg.subType === 'glo_burst') victimVFX.pulseDamage(260, 0.2);
        else if (msg.subType === 'glow_thrower') victimVFX.pulseDamage(340, 0.18);
        else if (msg.subType === 'lightning_bolt') victimVFX.emitStunBurst();
      }
    }
    if (this.room && msg.victimId === this.room.sessionId) {
      this.flashDamage();
      if (this._allowBattleHudPolish()) flashDamageVignette();
      if (!areBattleAssetsLoaded()) playSFX('crash');
      if (this._allowBattleImpactPolish() && this.localMesh && msg.subType === 'lightning_bolt' && attackerMesh) {
        emitTeslaArcBetween(
          attackerMesh.position.add(new Vector3(0, 1.2, 0)),
          this.localMesh.position.add(new Vector3(0, 1.0, 0)),
          1.15,
        );
      }
      const shakeIntensity = Math.min(1.0, (msg.damage || 30) / 50);
      if (this._allowBattleCameraJuice()) shakeCamera(this.camera, shakeIntensity, 400);
      this._triggerShockwave(msg.damage || 30);
      if (typeof msg.remainingHealth === 'number') {
        this._localHealth = msg.remainingHealth;
        updateGUIHealthBar(this._localHealth);
        flashGUIHealthDamage();
        updateLowHealthWarning(this._localHealth);
      }
      const atkMesh = this.remoteMeshes.get(msg.attackerId);
      if (atkMesh && this.localMesh) {
        const dx = atkMesh.position.x - this.localMesh.position.x;
        const dz = atkMesh.position.z - this.localMesh.position.z;
        const angle = Math.atan2(dx, dz);
        if (this._allowBattleHudPolish()) {
          showDamageDirection(angle, msg.subType);
          showOffscreenDamageArrow(angle);
        }
      }
    }

    if (this.room && msg.attackerId === this.room.sessionId) {
      if (this._allowBattleHudPolish()) showHitConfirm(msg.damage || 30);
      if (this._allowBattleImpactPolish()) showHitMarkerVFX();
      playHitConfirmSFX();
    }
  }

  _handleKartCrashMessage(msg) {
    if (!msg) return;
    const impactPosition = Number.isFinite(msg.hitX) && Number.isFinite(msg.hitY) && Number.isFinite(msg.hitZ)
      ? new Vector3(msg.hitX, msg.hitY, msg.hitZ)
      : null;
    const severity = Number(msg.severity || 0);
    const playerAEntity = msg.playerAId === this.room?.sessionId
      ? this._localKartEntity
      : this._remoteKartEntities.get(msg.playerAId);
    const playerBEntity = msg.playerBId === this.room?.sessionId
      ? this._localKartEntity
      : this._remoteKartEntities.get(msg.playerBId);

    if (impactPosition && this._allowBattleImpactPolish()) {
      emitShockwaveRing(impactPosition, 6 + Math.min(10, severity * 0.6), [1, 0.58, 0.18]);
      emitWeaponImpactVFX(impactPosition, 'wind_slash');
    }

    playerAEntity?.flashWhite(110);
    playerBEntity?.flashWhite(110);
    if (msg.playerAId === this.room?.sessionId) this._localKartVFX?.emitHitBurst();
    if (msg.playerBId === this.room?.sessionId) this._localKartVFX?.emitHitBurst();
    if (msg.playerAId !== this.room?.sessionId) this._remoteKartVFXs.get(msg.playerAId)?.emitHitBurst();
    if (msg.playerBId !== this.room?.sessionId) this._remoteKartVFXs.get(msg.playerBId)?.emitHitBurst();

    const localIsA = msg.playerAId === this.room?.sessionId;
    const localIsB = msg.playerBId === this.room?.sessionId;
    if (!localIsA && !localIsB) return;

    const localDamage = localIsA ? Number(msg.damageA || 0) : Number(msg.damageB || 0);
    const remainingHealth = localIsA ? msg.remainingHealthA : msg.remainingHealthB;
    const otherId = localIsA ? msg.playerBId : msg.playerAId;
    const otherMesh = this.remoteMeshes.get(otherId);

    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.lastKartCrash = {
        playerAId: msg.playerAId,
        playerBId: msg.playerBId,
        localPlayerId: this.room?.sessionId || null,
        localDamage,
        remainingHealth,
        severity,
        otherId,
      };
    }

    if (areBattleAssetsLoaded()) {
      playBattleSound('rock_hit', {
        volume: 0.42 + Math.min(0.18, severity * 0.03),
        playbackRate: Math.max(0.78, 0.96 - Math.min(0.16, severity * 0.02)),
        cooldownMs: 80,
      });
    } else {
      playSFX('crash');
    }
    if (localDamage > 0 || severity >= 2) {
      this.flashDamage();
      if (this._allowBattleHudPolish()) flashDamageVignette();
      if (this._allowBattleCameraJuice()) {
        shakeCamera(this.camera, Math.min(0.95, 0.22 + severity * 0.05), 320);
      }
    }
    if (typeof remainingHealth === 'number') {
      this._localHealth = remainingHealth;
      updateGUIHealthBar(this._localHealth);
      if (localDamage > 0) {
        flashGUIHealthDamage();
        updateLowHealthWarning(this._localHealth);
      }
    }
    if (otherMesh && this.localMesh) {
      const dx = otherMesh.position.x - this.localMesh.position.x;
      const dz = otherMesh.position.z - this.localMesh.position.z;
      const angle = Math.atan2(dx, dz);
      if (this._allowBattleHudPolish()) showDamageDirection(angle, 'wind_slash');
    }
  }

  _getRemoteProjectileVisualBudget() {
    const tier = getTier();
    const base = tier === TIER.LOW ? 6 : (tier === TIER.MEDIUM ? 10 : 16);
    return Math.max(4, Math.round(base * runtimeFXBudget()));
  }

  _installBattleDebugHooks() {
    if (typeof window === 'undefined' || !window.__gloDebug || !import.meta.env?.DEV) return;
    window.__gloDebug.triggerMushroomCloud = (opts = {}) => {
      if (!this.scene || !this.localMesh) return false;
      const forward = this.localMesh.forward?.scale?.(opts.distance ?? 12) || new Vector3(0, 0, 12);
      const pos = this.localMesh.position.add(forward);
      emitNuclearFissionDetonation(pos);
      window.__gloDebug.lastDebugScenario = { type: 'mushroom-cloud', at: Date.now(), x: pos.x, y: pos.y, z: pos.z };
      return true;
    };
    window.__gloDebug.runBattleDebugScenario = (opts = {}) => this._runBattleDebugScenario(opts);
    window.__gloDebug.clearBattleDebugScenario = () => { this._cleanupDebugScenario(); return true; };
  }

  _cleanupDebugScenario() {
    if (this._debugScenarioTimer) {
      clearTimeout(this._debugScenarioTimer);
      this._debugScenarioTimer = null;
    }
    if (typeof this._debugScenarioCleanup === 'function') {
      try { this._debugScenarioCleanup(); } catch (_) {}
      this._debugScenarioCleanup = null;
    }
  }

  _runBattleDebugScenario(opts = {}) {
    if (!import.meta.env?.DEV || this.roomName !== 'battle_room' || !this.scene || !this.localMesh) return false;
    this._cleanupDebugScenario();

    const count = Math.max(4, Math.min(this._getRemoteProjectileVisualBudget(), Number(opts.count || 10)));
    const radius = Math.max(6, Number(opts.radius || 14));
    const durationMs = Math.max(450, Number(opts.durationMs || 1200));
    const subTypes = Array.isArray(opts.subTypes) && opts.subTypes.length
      ? opts.subTypes.map((id) => String(id || '').trim()).filter(Boolean)
      : null;
    const subType = opts.subType || subTypes?.[0] || 'super_nova';
    const center = this.localMesh.position.add(this.localMesh.forward?.scale?.(10) || new Vector3(0, 0, 10));
    const createdIds = [];

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const id = `__debug_proj_${Date.now()}_${i}`;
      const nextSubType = subTypes ? subTypes[i % subTypes.length] : subType;
      const mesh = this._createProjectileMesh(id, nextSubType);
      const px = center.x + Math.cos(angle) * radius;
      const pz = center.z + Math.sin(angle) * radius;
      mesh.position.set(px, center.y + 1.6, pz);
      mesh._entityId = id;
      mesh._entityType = 'projectile';
      mesh._subType = nextSubType;
      this.entityMeshes.set(id, mesh);
      this._projectileTargets.set(id, {
        pos: mesh.position.clone(),
        vel: new Vector3(-Math.cos(angle) * 9, 0, -Math.sin(angle) * 9),
        lastUpdate: performance.now(),
        subType: nextSubType,
        spawnTime: performance.now(),
        lifespan: durationMs / 1000,
        maxLifespan: durationMs / 1000,
        targetId: '',
      });
      createdIds.push(id);
    }

    this._debugScenarioCleanup = () => {
      for (const id of createdIds) {
        const mesh = this.entityMeshes.get(id);
        if (mesh) {
          if (mesh._trailId) disposeProjectileTrail(mesh._trailId);
          this._disposeProjectileVisual(mesh);
          try { mesh.dispose(); } catch (_) {}
        }
        this.entityMeshes.delete(id);
        this.entityAggregates.delete(id);
        this._projectileTargets.delete(id);
        this._suppressedEntityIds.delete(id);
      }
    };

    this._debugScenarioTimer = setTimeout(() => {
      this._cleanupDebugScenario();
      if (this._allowBattleImpactPolish() && subTypes?.includes('final_fission')) {
        emitNuclearFissionDetonation(center);
      } else if (this._allowBattleImpactPolish() && (!subTypes || subTypes.includes('super_nova'))) {
        emitWeaponImpactVFX(center, 'super_nova');
      }
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.lastDebugScenario = {
          type: 'battle-burst',
          at: Date.now(),
          count,
          subType,
          subTypes,
          x: center.x,
          y: center.y,
          z: center.z,
        };
      }
    }, durationMs);

    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.lastDebugScenario = {
        type: 'battle-burst-start',
        at: Date.now(),
        count,
        subType,
        subTypes,
        x: center.x,
        y: center.y,
        z: center.z,
      };
    }
    return true;
  }

  _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return `${parseInt(h.substring(0, 2), 16)},${parseInt(h.substring(2, 4), 16)},${parseInt(h.substring(4, 6), 16)}`;
  }

  _publishWeaponDebugState() {
    if (typeof window === 'undefined' || !window.__gloDebug) return;
    window.__gloDebug.weaponState = {
      weapon: this._localCombatState.weapon,
      displayWeapon: this._localCombatState.displayWeapon,
      ammo: this._localCombatState.ammo,
      weapon2: this._localCombatState.weapon2,
      ammo2: this._localCombatState.ammo2,
      weapon3: this._localCombatState.weapon3,
      ammo3: this._localCombatState.ammo3,
      fireCooldown: this._localCombatState.fireCooldown,
      effectType: this._localCombatState.effectType,
      shielded: this._localCombatState.shielded,
      maxCooldownMs: this._localCombatState.maxCooldownMs,
    };
  }

  _canPickupAnotherItem() {
    return (!this.currentWeapon2 || (this._localCombatState?.ammo2 ?? 0) <= 0)
      || (!this.reserveWeapon || (this._localCombatState?.ammo3 ?? 0) <= 0);
  }

  _getBuilderPlaytestHandling() {
    if (!this._joinOptions?.directPlaytest) return null;
    if (typeof this.roomName !== 'string' || !this.roomName.startsWith('builder_')) return null;
    return {
      turnResponse: 2.5,
      lateralGrip: 0.18,
      driftGripMul: 0.14,
      velocityAlign: 0.45,
    };
  }

  _queueItemBoxPickup(entityId, entityMesh = null, source = 'unknown') {
    if (!this.room || !entityId) return false;
    if (!this._canPickupAnotherItem()) return false;
    if (this._pendingPickupBoxes.has(entityId)) return false;

    this._pendingPickupBoxes.set(entityId, Date.now());
    if (entityMesh?.setEnabled) {
      entityMesh.setEnabled(false);
      try { emitItemBoxShatter(entityMesh.position); } catch (_) { /* ok */ }
    }
    const pos = this.localMesh?.position;
    this.room.send('pickupItem', {
      entityId,
      x: Number(pos?.x || 0),
      y: Number(pos?.y || 0),
      z: Number(pos?.z || 0),
    });
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.lastPickupRequest = { entityId, source, at: Date.now() };
    }
    return true;
  }

  _syncLocalCombatState(self) {
    const nextState = {
      weapon: self.weapon || '',
      displayWeapon: self.weapon || (Number(self.fireCooldown || 0) > 0 ? this._localCombatState.displayWeapon : ''),
      ammo: Math.max(0, Number(self.ammo || 0)),
      fireCooldown: Math.max(0, Number(self.fireCooldown || 0)),
      overheat: Number(self.overheat || 0),
      overheated: !!self.overheated,
      effectType: self.effectType || '',
      shielded: !!self.shielded,
      shieldHP: Number(self.shieldHP || 0),
      maxCooldownMs: this._localCombatState.maxCooldownMs,
      // Secondary slot
      weapon2: self.weapon2 || '',
      ammo2: Math.max(0, Number(self.ammo2 || 0)),
      fireCooldown2: Math.max(0, Number(self.fireCooldown2 || 0)),
      maxCooldownMs2: this._localCombatState.maxCooldownMs2,
      // Reserve slot
      weapon3: self.weapon3 || '',
      ammo3: Math.max(0, Number(self.ammo3 || 0)),
    };
    const changed =
      nextState.weapon !== this._localCombatState.weapon ||
      nextState.ammo !== this._localCombatState.ammo ||
      nextState.weapon2 !== this._localCombatState.weapon2 ||
      nextState.ammo2 !== this._localCombatState.ammo2 ||
      nextState.weapon3 !== this._localCombatState.weapon3 ||
      nextState.ammo3 !== this._localCombatState.ammo3 ||
      Math.round(nextState.fireCooldown / 100) !== Math.round(this._localCombatState.fireCooldown / 100) ||
      nextState.effectType !== this._localCombatState.effectType ||
      nextState.shielded !== this._localCombatState.shielded ||
      Math.round(nextState.overheat) !== Math.round(this._localCombatState.overheat);

    this._localCombatState = nextState;
    this.currentWeapon = nextState.weapon;
    this.currentWeapon2 = nextState.weapon2;
    this.reserveWeapon = nextState.weapon3;
    this.reserveAmmo = nextState.ammo3;
    this._localHealth = Number(self.health || 0);
    this._localLives = Number(self.lives || 0);
    this._publishWeaponDebugState();
    updateGUIHealthBar(this._localHealth);
    updateGUILives(this._localLives);
    updateGUIScore(Number(self.score || 0), 'Knock Outs');
    updateScoreDisplay(Number(self.score || 0), this.gameType === 'balloon' ? 'KOs' : 'Kills');
    if (changed) updateGUIWeapon(this._localCombatState, WEAPON_DISPLAY);
  }

  _isAuthoritativeMode() {
    return !!this._networkStats.authoritative && (this.roomName === 'battle_room' || this.roomName === 'race_room');
  }

  _reconcileAuthoritativeLocal(self) {
    if (!this.localMesh || !this.localKartAggregate?.body) return;
    const serverPos = new Vector3(self.x, self.y, self.z);
    const targetRot = new Quaternion(self.rx, self.ry, self.rz, self.rw);

    // Clamp server position to arena bounds before reconciling
    if (this._arenaBoundsHalf) {
      const half = this._arenaBoundsHalf;
      const margin = 0.5;
      serverPos.x = Math.max(-half + margin, Math.min(half - margin, serverPos.x));
      serverPos.z = Math.max(-half + margin, Math.min(half - margin, serverPos.z));
    }

    const posError = Vector3.Distance(this.localMesh.position, serverPos);
    const posAlpha = posError > 8 ? 1 : posError > 3 ? 0.35 : posError > 1 ? 0.14 : 0.05;
    const rotAlpha = posError > 3 ? 0.35 : 0.14;

    Vector3.LerpToRef(this.localMesh.position, serverPos, posAlpha, this.localMesh.position);
    // Reconcile rotation against the clean physics quat to avoid
    // slerping with visual pitch/roll offsets baked in
    const reconTarget = this._physicsQuat || this.localMesh.rotationQuaternion;
    if (reconTarget) {
      Quaternion.SlerpToRef(reconTarget, targetRot, rotAlpha, reconTarget);
      if (this._physicsQuat) {
        this.localMesh.rotationQuaternion.copyFrom(this._physicsQuat);
      }
    } else {
      this.localMesh.rotationQuaternion = targetRot;
    }

    const body = this.localKartAggregate.body;
    let svx = self.vx || 0, svy = self.vy || 0, svz = self.vz || 0;
    // Clamp server velocity if kart is at arena boundary
    if (this._arenaBoundsHalf) {
      const half = this._arenaBoundsHalf;
      const p = this.localMesh.position;
      if (p.x >= half - 1 && svx > 0) svx = 0;
      if (p.x <= -half + 1 && svx < 0) svx = 0;
      if (p.z >= half - 1 && svz > 0) svz = 0;
      if (p.z <= -half + 1 && svz < 0) svz = 0;
    }
    body.setLinearVelocity(new Vector3(svx, svy, svz));
    if (posError > 6) {
      body.setAngularVelocity(new Vector3(0, 0, 0));
    }
  }

    _sampleSurfaceY(x, z, fallbackY = 0, clearance = 0.6) {
      const baseY = Number.isFinite(fallbackY) ? fallbackY : 0;
      if (!this.havokPlugin) return baseY + clearance;

      const scanTop = Math.max(
        baseY + 30,
        (this._autoMapDef?.aabb?.max?.y ?? baseY) + 20,
      );
      const castDistance = 220;
      const from = new Vector3(Number(x) || 0, scanTop, Number(z) || 0);
      const to = new Vector3(from.x, from.y - castDistance, from.z);
      const hit = new PhysicsRaycastResult();

      try {
        // Restrict the surface probe to drivable TRACK geometry so the
        // sample is never contaminated by the kart's own collider, other karts,
        // item boxes, projectiles, or decorative props above the road. Without
        // this filter the raycast can latch onto the local kart aggregate during
        // `_syncAuthoritativeSpawn` and ratchet the spawn Y upward, producing
        // the visible "kart hovering above the play surface" bug in builder
        // arena playtests.
        this.havokPlugin.raycast(from, to, hit, { collideWith: LAYER.TRACK });
        if (hit.hasHit && Number.isFinite(hit.hitDistance)) {
          const sampledY = from.y - hit.hitDistance + clearance;
          // Builder-authored custom tracks can momentarily report the fallback
          // kill plane or arena floor before segment colliders settle. When that
          // happens, trust the authored spawn height instead of dropping the kart
          // far below the visible track shell.
          if (sampledY < baseY - 1.25) {
            return baseY + clearance;
          }
          return sampledY;
        }
      } catch (_) {
        // Fall back to the authored Y when Havok raycasts are unavailable.
      }

      return baseY + clearance;
    }

  _syncAuthoritativeSpawn(self) {
    if (!self) return;
    const arenaY = this._allSpawnPositions?.[0]?.y;
    const serverY = Number(self.y || 0);
    const baseY = (arenaY != null && Math.abs(serverY - arenaY) > 2) ? arenaY : serverY;
    const nextSpawn = {
      x: Number(self.x || 0),
      y: this._sampleSurfaceY(Number(self.x || 0), Number(self.z || 0), baseY, 0.3),
      z: Number(self.z || 0),
    };
    if (![nextSpawn.x, nextSpawn.y, nextSpawn.z].every(Number.isFinite)) return;
    this._spawnPos = nextSpawn;
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.spawnPos = { ...nextSpawn };
    }
  }

  _enterMatchLive(msg = {}) {
    if (this._matchLiveHandled) return;
    this._matchLiveHandled = true;
    this.started = true;
    this._cancelServerCountdown();
    console.log("[realtime] Match is LIVE!", msg?.derivedFromState ? "(derived from state)" : "");

    // Remove post-game lobby overlay if still shown
    document.getElementById('_glo-match-end')?.remove();
    this._postGamePlayerRefresh = null;

    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen && loadingScreen.style.display !== 'none') {
      loadingScreen.style.opacity = '0';
      setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
    }

    emitPlaytestProgress({
      phase: 'live',
      label: 'Playtest live',
      detail: 'Dropping into the generated arena now',
      progress: 1,
    });

    if (PrematchLobby.isVisible()) PrematchLobby.hide();
    // Fallback: force-remove prematch overlay even if rAF hasn't added 'visible' yet
    const pmOverlay = document.getElementById('prematch-lobby');
    if (pmOverlay && (pmOverlay.style.display !== 'none')) {
      pmOverlay.classList.remove('visible', 'fade-out');
      pmOverlay.style.display = 'none';
    }
    this._showGoOverlay();

    const self = this.authoritativeState?.players?.get?.(this.room?.sessionId || '');
    if (self) this._syncAuthoritativeSpawn(self);

    if (this.localMesh) {
      if (this._spawnPos) {
        this.localMesh.position.copyFromFloats(
          this._spawnPos.x,
          this._spawnPos.y,
          this._spawnPos.z
        );
        if (this.localMesh.rotationQuaternion) {
          const selfRot = self
            ? new Quaternion(self.rx, self.ry, self.rz, self.rw)
            : Quaternion.Identity();
          this.localMesh.rotationQuaternion.copyFrom(selfRot);
          // Sync cached physics quat
          if (this._physicsQuat) this._physicsQuat.copyFrom(selfRot);
          else this._physicsQuat = selfRot.clone();
        }
      }
      // Use KartEntity for visibility (handles root + children)
      if (this._localKartEntity) {
        this._localKartEntity.setVisible(true);
      } else {
        this.localMesh.isVisible = true;
        this.localMesh.getChildMeshes(false).forEach(m => { m.isVisible = true; });
      }
    }

    try {
      if (this.localKartAggregate && this.localKartAggregate.body) {
        this.localKartAggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
        this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
        this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
        this.localKartAggregate.body.disablePreStep = false;
      }
    } catch (e) {
      console.warn('[realtime] Physics unfreeze error (non-fatal):', e);
    }

    this._kartReady = true;
    setGloVisible(this._gloKit, true);
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.kartVisible = true;
      window.__gloDebug.matchLive = true;
    }

    // Start boost: if player timed throttle to the GO frame, grant a 1.5s speed burst
    const _sb = getBindings();
    if (this._countdownStartBoostWindow && this._keys && (this._keys[_sb.throttle] || this._keys['ArrowUp'])) {
      this._startBoostTimer = 1.5;
      console.log('[realtime] Start boost activated!');
      playSFX('boost');
    }

    if (this.roomName === 'race_room') {
      this._totalLaps = this.room?.state?.totalLaps || 3;
      this._lapCount = 0;
      this._raceFinished = false;
      this._lapCooldownUntil = Date.now() + 8000;
      this._initLapHud();
      this._updateLapHud();
    }
  }

  setupInputLoop() {
    this._teardownInputLoop();

    // Track pressed keys
    this._onKeyDown = (e) => {
      this._keys[e.code] = true;
      if (e.code === 'F8') {
        e.preventDefault();
        this._debugGrantNextWmWeapon();
      }
      // Tab: show scoreboard
      if (e.code === 'Tab') {
        e.preventDefault();
        this._updateAndShowScoreboard();
      }
      // C: cycle camera view (Chase â†’ Low Behind â†’ Close â€¦)
      if (e.code === 'KeyC') {
        this._cameraMode = (this._cameraMode + 1) % this._cameraModes.length;
        const mode = this._cameraModes[this._cameraMode];
        this._targetCamRadius = mode.radius;
        this._baseFOV = mode.fovBase * (Math.PI / 180);
        this._maxFOV  = (mode.fovBase + 10) * (Math.PI / 180);
        if (this.camera) {
          this.camera.heightOffset = mode.height;
          this.camera.cameraAcceleration = mode.accel;
          this.camera.maxCameraSpeed = mode.maxSpeed;
        }
      }
    };
    this._onKeyUp = (e) => {
      this._keys[e.code] = false;
      if (e.code === 'Tab') hideScoreboard();
    };
    this._onWindowBlur = () => {
      this._resetInputState({ sendNeutral: true });
    };
    this._onVisibilityChange = () => {
      if (document.hidden) {
        this._resetInputState({ sendNeutral: true });
      }
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);
    window.addEventListener("blur", this._onWindowBlur);
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    // Gamepad support (21.33)
    initGamepad((connected) => {
      console.log(`[Gamepad] ${connected ? 'connected' : 'disconnected'}`);
    });
    this._gpScoreboardHeld = false;
    this._gpPauseHeld = false;

    if (this._inputKeepaliveInterval) {
      window.clearInterval(this._inputKeepaliveInterval);
    }
    this._inputKeepaliveInterval = window.setInterval(() => {
      this._sendRealtimeInputKeepalive();
    }, this._inputKeepaliveMs);

    // Per-frame input polling â†’ sendInput()
    this._setSceneBeforeRender("_inputPollingBeforeRender", () => {
      if (!this.localMesh || !this.room) return;

      // Block all input/physics until the match goes LIVE (avoids pre-match kart movement)
      if (!this._kartReady) return;

      // â”€â”€ Death/respawn state machine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (this._deathState) {
        const dDt = this.engine.getDeltaTime() / 1000;
        this._deathState.timer -= dDt;
        // Animate debris
        if (this._deathDebris) {
          for (const d of this._deathDebris) {
            if (!d.isDisposed()) {
              d.position.addInPlace(d._vel.scale(dDt));
              d._vel.y -= 20 * dDt;
              d.rotation.x += 5 * dDt;
              d.rotation.z += 3 * dDt;
            }
          }
        }
        if (this._deathState.phase === 'dead' && this._deathState.timer <= 0) {
          hideKOOverlay();
          if (this._deathDebris) {
            for (const d of this._deathDebris) d.dispose();
            this._deathDebris = null;
          }
          this._respawnLocalKart(this._deathState.respawnPos);
          this._deathState = null;
        }
        return; // Block all input during death
      }

      // â”€â”€ Invulnerability blink â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (this._invulnTimer > 0) {
        const iDt = this.engine.getDeltaTime() / 1000;
        this._invulnTimer -= iDt;
        const visible = Math.floor(this._invulnTimer / 0.15) % 2 === 0;
        if (this.localMesh) this.localMesh.setEnabled(visible);
        if (this._invulnTimer <= 0) {
          this._invulnTimer = 0;
          if (this.localMesh) this.localMesh.setEnabled(true);
          hideRespawnText();
        }
      }

      // â”€â”€ Low health heartbeat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (this._localHealth <= 25 && this._localHealth > 0) {
        this._heartbeatTimer -= this.engine.getDeltaTime() / 1000;
        if (this._heartbeatTimer <= 0) {
          if (areBattleAssetsLoaded()) playBattleSound('heartbeat');
          else playHeartbeat();
          this._heartbeatTimer = 1.2;
        }
      }
      updateLowHealthWarning(this._localHealth);

      // â”€â”€ Battle music intensity (21.26) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (this._joinOptions?.gameMode === 'battle' && this.authoritativeState?.players) {
        const scoreLimit = this.authoritativeState?.scoreLimit || 10;
        let maxScore = 0;
        this.authoritativeState.players.forEach(p => { if (p.score > maxScore) maxScore = p.score; });
        if (maxScore >= scoreLimit - 1) {
          setBattleMusicIntensity('matchpoint');
        } else if (this._localHealth <= 30) {
          setBattleMusicIntensity('high');
        } else {
          setBattleMusicIntensity('normal');
        }
      }

      const k = this._keys;
      const b = getBindings();
      const kbThrottle = (k[b.throttle] || k["ArrowUp"] ? 1 : 0) + (k[b.reverse] || k["ArrowDown"] ? -1 : 0);
      const kbSteer    = (k[b.steerLeft] || k["ArrowLeft"] ? 1 : 0) + (k[b.steerRight] || k["ArrowRight"] ? -1 : 0);
      const kbBrake    = !!(k[b.brake] || k["ShiftLeft"] || k["ShiftRight"]);
      const kbFirePrimary   = !!(k[b.firePrimary] || k["Space"]);
      const kbFireSecondary = !!(k[b.fireSecondary] || k["Enter"]);
      const kbSwapSecondary = !!k[b.swapSecondary];

      // Merge gamepad input (21.33)
      const gp = pollGamepad();
      let throttle = gp.connected ? (Math.abs(gp.throttle) > Math.abs(kbThrottle) ? gp.throttle : kbThrottle) : kbThrottle;
      const steer  = gp.connected ? (Math.abs(gp.steer) > Math.abs(kbSteer) ? gp.steer : kbSteer) : kbSteer;
      const brake  = kbBrake || gp.brake;
      const firePrimary   = kbFirePrimary || (gp.connected && gp.fire);
      const fireSecondary = kbFireSecondary || (gp.connected && gp.fireSecondary);
      const drift  = !!(k[b.drift] || k["KeyX"]) || gp.drift;
      this._latestRealtimeInput = {
        throttle,
        steer,
        brake,
        drift,
        firePrimary,
        fireSecondary,
      };

      // Gamepad scoreboard toggle
      if (gp.connected) {
        if (gp.scoreboard && !this._gpScoreboardHeld) this._updateAndShowScoreboard();
        if (!gp.scoreboard && this._gpScoreboardHeld) hideScoreboard();
        this._gpScoreboardHeld = gp.scoreboard;
        // Gamepad pause toggle (21.34)
        if (gp.pause && !this._gpPauseHeld) {
          if (isPaused()) resumeGame(); else pauseGame();
        }
        this._gpPauseHeld = gp.pause;
      }

      // Skip input when paused
      if (isPaused()) return;

      // Start boost: temporary speed multiplier from well-timed GO throttle
      if (this._startBoostTimer > 0) {
        this._startBoostTimer -= this.engine.getDeltaTime() / 1000;
        if (throttle > 0) throttle = 1.5; // 50% speed boost
        if (this._localKartVFX) {
          this._localKartVFX.setBoostColor('start');
          this._localKartVFX.setState(VFXState.BOOST);
        }
      }

      // Status effect VFX â€” authoritative effect state drives local anchors.
      this._applyKartEffectVFX(this._localKartVFX, this._localCombatState.effectType);

      // â”€â”€ Dynamic forcefield shield (HP-based, greenâ†’red) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      this._updateForceFieldShield();

      // â”€â”€ KartVFX per-frame update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const dtVFX = this.engine.getDeltaTime() / 1000;
      if (this._localKartVFX) {
        const speed = this.localKartAggregate?.body
          ? this.localKartAggregate.body.getLinearVelocity().length()
          : 0;
        this._localKartVFX.update(dtVFX, speed, this._localHealth);
      }
      if (this.authoritativeState?.players?.forEach) {
        this._remoteKartVFXTick = (this._remoteKartVFXTick || 0) + 1;
        const remoteVFXStride = runtimePressure() > 0.72 ? 4 : runtimePressure() > 0.45 ? 2 : 1;
        if ((this._remoteKartVFXTick % remoteVFXStride) === 0) {
          this._remoteKartVFXs.forEach((remoteVFX, remoteId) => {
            const remotePlayer = this.authoritativeState.players.get(remoteId);
            if (!remotePlayer || !remoteVFX) return;
            this._applyKartEffectVFX(remoteVFX, remotePlayer.effectType || '');
            remoteVFX.update(
              dtVFX * remoteVFXStride,
              Math.hypot(Number(remotePlayer.vx || 0), Number(remotePlayer.vz || 0)),
              Number(remotePlayer.health || 100),
            );
          });
        }
      }

      // â”€â”€ Ludicrous Mode VFX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      this._updateLudicrousVFX(dtVFX);

      // Spectator mode â€” ignore normal inputs, fire cycles target
      if (this._spectating) {
        if (fireSecondary && !this._spectatorFireHeld) {
          this._cycleSpectatorTarget();
        }
        this._spectatorFireHeld = fireSecondary;
        return; // skip all normal input handling when spectating
      }

      if (kbSwapSecondary && !this._swapSecondaryPressedLastFrame && this.reserveWeapon) {
        this.room.send("swapSecondaryWeapon", {});
      }
      this._swapSecondaryPressedLastFrame = kbSwapSecondary;

      // Send input when there is actual input, or idle heartbeat every 200ms
      const hasInput = throttle !== 0 || steer !== 0 || brake || firePrimary || fireSecondary || drift;
      const neutralInput = {
        throttle: 0,
        steer: 0,
        brake: false,
        firePrimary: false,
        fireSecondary: false,
        drift: false,
      };
      if (hasInput) {
        this.sendInput({ throttle, steer, brake, firePrimary, fireSecondary, drift });
        this._wasSendingInput = true;
        this._lastInputSendTime = performance.now();
      } else if (this._wasSendingInput) {
        // Release/idle packets should reach the server, but don't need client prediction
        // or pending-input reconciliation churn.
        this.sendInput(neutralInput, {
          applyPrediction: false,
          emitWeaponEvents: false,
        });
        this._wasSendingInput = false;
        this._lastInputSendTime = performance.now();
      } else if (!this._lastInputSendTime || performance.now() - this._lastInputSendTime > 200) {
        this.sendInput(neutralInput, {
          applyPrediction: false,
          emitWeaponEvents: false,
        });
        this._lastInputSendTime = performance.now();
      }

      // Engine pitch reflects speed
      if (this.localKartAggregate?.body) {
        const vel = this.localKartAggregate.body.getLinearVelocity();
        const speed = vel ? Math.sqrt(vel.x * vel.x + vel.z * vel.z) : 0;
        updateEnginePitch(speed);
        // Legacy wheel spin removed â€” handled in applyLocalPrediction via KartEntity.spinWheels()
      }

      // Out-of-bounds respawn (arena-aware threshold)
      const fallY = this._fallThreshold ?? -60;
      if (this.localMesh && this.localMesh.position.y < fallY && this._spawnPos) {
        // Pick nearest spawn to where the player fell (XZ only)
        const nearest = this._getNearestSpawn(this.localMesh.position);
        this._respawnLocalKart(nearest);
      }

      // â”€â”€ Finish-line detection (race mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Uses proximity to the spawn position as a simple finish-line trigger.
      // Once a lap is started by crossing the line, subsequent crossings
      // advance the lap counter. A cooldown prevents double-triggers.
      if (
        this.started &&
        !this._raceFinished &&
        this.localMesh &&
        this._spawnPos &&
        this.roomName === 'race_room' &&
        Date.now() > this._lapCooldownUntil
      ) {
        const sp = this._spawnPos;
        const pos = this.localMesh.position;
        const dx = pos.x - sp.x;
        const dz = pos.z - sp.z;
        const distSq = dx * dx + dz * dz;
        if (distSq < 64) {  // 8m trigger radius around start/finish
          this._lapCooldownUntil = Date.now() + 18000; // enforce minimum lap time
          this.room.send('checkpoint', { idx: 0 });
        }
      }

      // â”€â”€ Camera clip avoidance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Raycast from the kart toward the camera's current position.
      // If anything obstructs the line-of-sight, shorten the camera radius so
      // the player never loses sight of their kart behind walls or pillars.
      if (this.localMesh && this.havokPlugin && this.camera) {
        try {
          const from = this.localMesh.position.add(new Vector3(0, 1.0, 0));
          const to   = this.camera.position.clone();
          const hit  = new PhysicsRaycastResult();
          this.havokPlugin.raycast(from, to, hit);
          if (hit.hasHit && hit.hitDistance < this._targetCamRadius - 1.0) {
            // Snap camera closer so it stays on the player side of the obstruction
            this.camera.radius = Math.max(3.5, hit.hitDistance - 0.8);
          } else if (this.camera.radius < this._targetCamRadius - 0.05) {
            // Gradually restore to ideal radius once clear
            this.camera.radius = Math.min(this._targetCamRadius, this.camera.radius + 0.2);
          }
        } catch (_) { /* raycast API unavailable â€” skip clip avoidance this frame */ }
      }
    });
  }

  _debugGrantNextWmWeapon() {
    if (!this.room || this.roomName !== 'battle_room') return;

    const weaponId = DEBUG_WM_WEAPON_CYCLE[this._debugWeaponCycleIndex % DEBUG_WM_WEAPON_CYCLE.length];
    this._debugWeaponCycleIndex += 1;

    this.room.send('debugGrantWeapon', {
      targetId: this.room.sessionId,
      weaponId,
    });

    console.log(`[debug] Granted WM weapon: ${weaponId} (press F8 to cycle)`);
  }

  /** Pick the nearest spawn point (XZ distance) to a world position */
  _getNearestSpawn(pos) {
    const spawns = this._allSpawnPositions;
    if (!spawns || spawns.length <= 1) return this._spawnPos;
    let best = spawns[0], bestDist = Infinity;
    for (const sp of spawns) {
      const dx = (sp.x || 0) - pos.x;
      const dz = (sp.z || 0) - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestDist) { bestDist = d; best = sp; }
    }
    return best;
  }

  /** Gather live player data from Colyseus state and show scoreboard */
  _updateAndShowScoreboard() {
    const state = this.authoritativeState;
    if (!state?.players) return;
    const players = [];
    state.players.forEach((p, id) => {
      players.push({
        id,
        name: p.name || '?',
        score: p.score || 0,
        deaths: p.deaths || 0,
        health: p.health ?? 100,
        weapon: p.weapon || '',
      });
    });
    showScoreboard(players, this.room?.sessionId);
  }

  /** Respawn the local kart at the spawn position */
  _respawnLocalKart(overridePos) {
    if (!this.localMesh || !this.localKartAggregate?.body) return;
    const sp = overridePos || this._spawnPos || { x: 0, y: 5, z: 0 };
    this.localMesh.position.copyFromFloats(
      sp.x,
      this._sampleSurfaceY(sp.x, sp.z, sp.y, 0.9),
      sp.z,
    );
    if (this.localMesh.rotationQuaternion) {
      this.localMesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
    }
    // Reset cached physics quat so visual offsets don't carry over
    if (this._physicsQuat) this._physicsQuat.copyFromFloats(0, 0, 0, 1);
    this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
    this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
    this.localKartAggregate.body.disablePreStep = false;
    // Reset materials to pristine state (fixes accumulated emissive corruption)
    if (this._localKartEntity) this._localKartEntity.resetMaterials();
    // Clear any active VFX state
    if (this._localKartVFX) this._localKartVFX.setState(VFXState.IDLE);
    // Show kart + start invuln blink
    this.localMesh.setEnabled(true);
    this._invulnTimer = 2.0;
    this._invulnBlinkOn = true;
    this._localHealth = 100;
    this._heartbeatTimer = 0;
    setBattleMusicDead(false);
    showRespawnText("RESPAWNING...");
    console.log("[realtime] Respawned local kart at spawn position");
  }

  /** Trigger death animation â€” hide kart, show debris + KO overlay */
  _startDeathSequence(msg) {
    if (this._deathState) return;
    const pos = this.localMesh ? this.localMesh.position.clone() : new Vector3(0, 2, 0);
    const respawnPos = { x: msg.spawnX, y: msg.spawnY || 2.5, z: msg.spawnZ };
    this._deathState = { phase: 'dead', timer: 2.5, deathPos: pos, respawnPos };
    this._localHealth = 100;
    setBattleMusicDead(true);

    // Hide kart + set DEAD VFX state
    if (this.localMesh) this.localMesh.setEnabled(false);
    if (this._localKartVFX) this._localKartVFX.setState(VFXState.DEAD);

    // Spawn debris pieces
    this._deathDebris = [];
    for (let i = 0; i < 4; i++) {
      const d = MeshBuilder.CreateBox(`debris_${i}`, { size: 0.3 + Math.random() * 0.3 }, this.scene);
      d.position.copyFrom(pos);
      const mat = new StandardMaterial(`dmat_${i}`, this.scene);
      mat.diffuseColor = new Color3(0.6 + Math.random() * 0.4, 0.2, 0.1);
      d.material = mat;
      d._vel = new Vector3(
        (Math.random() - 0.5) * 12,
        6 + Math.random() * 6,
        (Math.random() - 0.5) * 12
      );
      this._deathDebris.push(d);
    }

    // Explosion VFX + audio
    emitWeaponExplosion(pos, 100);
    showKOOverlay("KO'd!");
    if (areBattleAssetsLoaded()) playBattleSound('death', { volume: 0.74, playbackRate: 0.92, cooldownMs: 180 });
    else playEliminationSFX();

    // Clear weapon on death
    Object.assign(this._localCombatState, { weapon: '', displayWeapon: '', ammo: 0, fireCooldown: 0, effectType: '', shielded: false, maxCooldownMs: 0 });

    // Decrement local lives + pop balloon
    if (this._localLives > 0) {
      this._localLives -= 1;
      updateGUILives(this._localLives);
      this._popBalloon(this._localLives);
    }

    console.log("[realtime] Death sequence started");
  }

  // â”€â”€ 21.32 Spectator Mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  _enterSpectatorMode() {
    this._spectating = true;
    this._spectatorIdx = 0;
    // Hide local kart
    if (this.localMesh) this.localMesh.setEnabled(false);
    // Show spectator HUD
    if (!this._spectatorEl) {
      this._spectatorEl = document.createElement('div');
      this._spectatorEl.id = 'spectator-hud';
      this._spectatorEl.style.cssText = `
        position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
        font-family: 'Poppins', sans-serif; font-size: 1rem; font-weight: 700;
        color: #fff; background: rgba(0,0,0,0.6); padding: 6px 18px;
        border-radius: 8px; z-index: 120; pointer-events: none;
        text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      `;
      document.body.appendChild(this._spectatorEl);
    }
    this._spectatorEl.style.display = 'block';
    this._cycleSpectatorTarget();
    console.log("[realtime] Entered spectator mode");
  }

  _cycleSpectatorTarget() {
    if (!this._spectating || !this.remoteMeshes.size) return;
    const ids = [...this.remoteMeshes.keys()];
    this._spectatorIdx = (this._spectatorIdx || 0) % ids.length;
    const targetId = ids[this._spectatorIdx];
    const targetMesh = this.remoteMeshes.get(targetId);
    if (targetMesh && this.camera) {
      this.camera.lockedTarget = targetMesh;
    }
    // Show name
    const playerState = this.authoritativeState?.players?.get?.(targetId);
    const name = playerState?.name || `Player ${this._spectatorIdx + 1}`;
    if (this._spectatorEl) {
      this._spectatorEl.textContent = `SPECTATING: ${name} [Fire to switch]`;
    }
    this._spectatorIdx++;
  }

  // â”€â”€ Lap HUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Create or return the persistent lap counter element */
  _initLapHud() {
    if (this._lapHudEl) return this._lapHudEl;
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed', top: '14px', left: '50%',
      transform: 'translateX(-50%)',
      padding: '6px 20px',
      background: 'rgba(0,0,0,0.65)',
      color: '#fff',
      fontFamily: "'Bungee', Impact, sans-serif",
      fontSize: 'clamp(1rem, 3vw, 1.6rem)',
      borderRadius: '8px',
      zIndex: '9990',
      pointerEvents: 'none',
      letterSpacing: '0.06em',
      display: 'none',
    });
    document.body.appendChild(el);
    this._lapHudEl = el;
    return el;
  }

  /** Refresh the lap counter text */
  _updateLapHud() {
    const el = this._initLapHud();
    const lap = Math.min(this._lapCount, this._totalLaps);
    el.textContent = `LAP  ${lap} / ${this._totalLaps}`;
    el.style.display = this._lapCount > 0 ? 'block' : 'none';
  }

  /**
   * Flash a big centred lap message ("LAP 2 / 3", "FINISHED P1!", etc.)
   * @param {string} text
   * @param {number} [durationMs=2500]
   */
  _showLapOverlay(text, durationMs = 2500) {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '9995',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    });
    const label = document.createElement('div');
    Object.assign(label.style, {
      fontSize: 'clamp(3rem, 10vw, 6rem)',
      fontFamily: "'Bungee', Impact, sans-serif",
      color: '#ffffff',
      textShadow: '0 0 40px rgba(255,200,0,0.9), 0 4px 12px rgba(0,0,0,0.7)',
      opacity: '0',
      transform: 'scale(0.7)',
      transition: 'opacity 0.3s ease-out, transform 0.3s ease-out',
    });
    label.textContent = text;
    overlay.appendChild(label);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      label.style.opacity = '1';
      label.style.transform = 'scale(1)';
    });
    setTimeout(() => {
      label.style.opacity = '0';
      label.style.transform = 'scale(1.3)';
      setTimeout(() => overlay.remove(), 400);
    }, durationMs);
  }

  /**
   * Show a non-blocking match-end results screen.
   * Displays after a 1s delay so the GO overlay clears first.
   */
  _showMatchEndScreen(msg) {
    setTimeout(() => {
      // Remove if already shown
      document.getElementById('_glo-match-end')?.remove();
      this._postGameSettingsChanged = false;

      const isRace = msg?.mode === 'race';
      const isSelfWinner = msg?.winnerId === this.room?.sessionId;
      const standings = msg?.standings || [];

      // Determine if local player is the room host
      const myId = this.room?.sessionId;
      const stablePlayerId = sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId') || myId;
      let amHost = false;
      // The game room sessionId can differ from the lobby player id, so prefer
      // the persisted player id and join-time host flag when rebuilding host state.
      if (this._joinOptions?.isHost) {
        amHost = true;
      }

      // Game room player schema doesn't have isHost â€” check gameConfig from lobby
      try {
        const gc = JSON.parse(sessionStorage.getItem('gameConfig') || '{}');
        if (gc.players) {
          amHost = amHost || gc.players.some((p) => (p.id === stablePlayerId || p.id === myId) && p.isHost);
        }
      } catch (_) {}
      // Also check room state in case it does expose isHost
      if (!amHost && this.room?.state?.players) {
        this.room.state.players.forEach((p, id) => {
          if (id === myId && p.isHost) amHost = true;
        });
      }

      // Current settings from room state or joinOptions for defaults
      const roomState = this.room?.state || {};
      const opts = this._joinOptions || {};
      const curArena = roomState.trackId || opts.trackId || 'glo_arena';
      const curBattleType = roomState.gameType || roomState.battleType || opts.battleType || opts.gameType || 'deathmatch';
      const curLoadout = roomState.loadoutId || opts.loadoutId || 'classic';
      const curScoreLimit = roomState.scoreLimit ?? opts.scoreLimit ?? 5;
      const curBotCount = roomState.botCount ?? opts.botCount ?? 0;

      // â”€â”€ Build full-screen overlay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const screen = document.createElement('div');
      screen.id = '_glo-match-end';
      Object.assign(screen.style, {
        position: 'fixed', inset: '0', zIndex: '10010',
        background: 'rgba(0,0,0,0.88)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center',
        fontFamily: "'Bungee', Impact, sans-serif",
        color: '#fff',
        padding: '24px 16px',
        gap: '12px',
        opacity: '0',
        transition: 'opacity 0.6s ease-in',
        overflowY: 'auto',
      });

      // â”€â”€ Shared styles â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const labelStyle = {
        fontSize: 'clamp(0.65rem, 1.4vw, 0.78rem)',
        color: 'rgba(255,255,255,0.5)',
        fontWeight: '700',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: '4px',
      };
      const selectStyle = {
        width: '100%',
        padding: '8px 10px',
        fontSize: 'clamp(0.8rem, 1.8vw, 0.95rem)',
        fontFamily: "'Poppins', sans-serif",
        background: 'rgba(255,255,255,0.08)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '8px',
        outline: 'none',
        cursor: amHost ? 'pointer' : 'not-allowed',
        opacity: amHost ? '1' : '0.5',
      };
      const inputStyle = {
        ...selectStyle,
        width: '80px',
        textAlign: 'center',
      };

      // â”€â”€ Title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const title = document.createElement('div');
      title.textContent = isRace ? 'ðŸ RACE OVER' : (isSelfWinner ? 'ðŸ† VICTORY!' : 'âš”ï¸  MATCH OVER');
      Object.assign(title.style, {
        fontSize: 'clamp(1.8rem, 6vw, 3.2rem)',
        textShadow: '0 0 30px rgba(255,200,0,0.7)',
        color: isSelfWinner ? '#ffd700' : '#fff',
        flexShrink: '0',
      });
      screen.appendChild(title);

      // â”€â”€ Winner banner â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (msg?.winner || standings[0]?.name) {
        const winBanner = document.createElement('div');
        winBanner.textContent = `ðŸ† ${msg?.winner || standings[0]?.name}`;
        Object.assign(winBanner.style, {
          fontSize: 'clamp(1.2rem, 4vw, 2.2rem)',
          color: '#ffd700',
          textShadow: '0 0 20px rgba(255,200,0,0.8)',
          background: 'rgba(255,200,0,0.1)',
          padding: '6px 20px',
          borderRadius: '8px',
          border: '2px solid rgba(255,200,0,0.4)',
          flexShrink: '0',
        });
        screen.appendChild(winBanner);
      }

      // â”€â”€ Standings table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (standings.length > 0) {
        const table = document.createElement('div');
        Object.assign(table.style, {
          display: 'flex', flexDirection: 'column', gap: '3px',
          width: '100%', maxWidth: '500px', flexShrink: '0',
        });

        const header = document.createElement('div');
        Object.assign(header.style, {
          display: 'grid',
          gridTemplateColumns: '36px 1fr 54px 54px 46px',
          gap: '6px', padding: '4px 14px',
          fontSize: 'clamp(0.6rem, 1.3vw, 0.75rem)',
          color: 'rgba(255,255,255,0.35)',
          fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase',
        });
        header.innerHTML = '<span></span><span>Player</span><span style="text-align:center">K</span><span style="text-align:center">D</span><span style="text-align:center">K/D</span>';
        table.appendChild(header);

        standings.forEach((entry, i) => {
          const row = document.createElement('div');
          const medal = ['ðŸ¥‡', 'ðŸ¥ˆ', 'ðŸ¥‰'][i] || `${i + 1}.`;
          const kills = entry.score ?? 0;
          const deaths = entry.deaths ?? 0;
          const kd = deaths === 0 ? kills.toFixed(1) : (kills / deaths).toFixed(1);
          const isSelf = entry.sessionId === myId;
          Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: '36px 1fr 54px 54px 46px',
            gap: '6px',
            background: isSelf ? 'rgba(0,200,100,0.15)' : (i === 0 ? 'rgba(255,200,0,0.1)' : 'rgba(255,255,255,0.04)'),
            padding: '6px 14px', borderRadius: '6px',
            fontSize: 'clamp(0.8rem, 2.2vw, 1rem)',
            color: i === 0 ? '#ffd700' : (isSelf ? '#00ff88' : '#ccc'),
            alignItems: 'center',
            border: isSelf ? '1px solid rgba(0,255,100,0.25)' : 'none',
          });
          row.innerHTML = `<span>${medal}</span><span>${entry.name || '?'}</span><span style="text-align:center">${kills}</span><span style="text-align:center">${deaths}</span><span style="text-align:center;color:rgba(255,255,255,0.45)">${kd}</span>`;
          table.appendChild(row);
        });
        screen.appendChild(table);
      }

      // â”€â”€ Divider â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const divider = document.createElement('div');
      Object.assign(divider.style, {
        width: '100%', maxWidth: '500px', height: '1px',
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)',
        flexShrink: '0', margin: '4px 0',
      });
      screen.appendChild(divider);

      // â”€â”€ Next Match Settings (host-editable) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const settingsSection = document.createElement('div');
      Object.assign(settingsSection.style, {
        width: '100%', maxWidth: '500px',
        display: 'flex', flexDirection: 'column', gap: '10px',
        flexShrink: '0',
      });

      const settingsTitle = document.createElement('div');
      settingsTitle.textContent = amHost ? 'âš™ï¸  NEXT MATCH SETTINGS' : 'âš™ï¸  MATCH SETTINGS';
      Object.assign(settingsTitle.style, {
        fontSize: 'clamp(0.85rem, 2vw, 1.1rem)',
        color: '#ff0080',
        letterSpacing: '0.06em',
        textAlign: 'center',
      });
      settingsSection.appendChild(settingsTitle);

      if (!amHost) {
        const hostNote = document.createElement('div');
        hostNote.textContent = 'Waiting for host to configureâ€¦';
        Object.assign(hostNote.style, {
          fontSize: 'clamp(0.7rem, 1.6vw, 0.85rem)',
          color: 'rgba(255,255,255,0.4)',
          textAlign: 'center',
          fontStyle: 'italic',
          fontFamily: "'Poppins', sans-serif",
        });
        settingsSection.appendChild(hostNote);
      }

      const settingsGrid = document.createElement('div');
      Object.assign(settingsGrid.style, {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '10px',
      });

      // Helper to create a settings field
      const makeField = (labelText, controlEl) => {
        const field = document.createElement('div');
        const lbl = document.createElement('div');
        lbl.textContent = labelText;
        Object.assign(lbl.style, labelStyle);
        field.appendChild(lbl);
        field.appendChild(controlEl);
        return field;
      };

      // Arena selector
      const arenaSelect = document.createElement('select');
      Object.assign(arenaSelect.style, selectStyle);
      arenaSelect.disabled = !amHost;
      for (const [id, arena] of Object.entries(ALL_ARENAS)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = arena.label || id;
        opt.style.background = '#1a1a2e';
        if (id === curArena) opt.selected = true;
        arenaSelect.appendChild(opt);
      }
      settingsGrid.appendChild(makeField('Arena', arenaSelect));

      // Battle type selector
      const btSelect = document.createElement('select');
      Object.assign(btSelect.style, selectStyle);
      btSelect.disabled = !amHost;
      for (const [bt, label] of [['deathmatch', 'Deathmatch'], ['ctf', 'Capture The Flag'], ['balloon', 'Three Strikes']]) {
        const opt = document.createElement('option');
        opt.value = bt;
        opt.textContent = label;
        opt.style.background = '#1a1a2e';
        if (bt === curBattleType) opt.selected = true;
        btSelect.appendChild(opt);
      }
      settingsGrid.appendChild(makeField('Battle Type', btSelect));

      // Weapon loadout selector
      const loadoutSelect = document.createElement('select');
      Object.assign(loadoutSelect.style, selectStyle);
      loadoutSelect.disabled = !amHost;
      for (const [id, ws] of Object.entries(WEAPON_SETS)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = ws.label || id;
        opt.style.background = '#1a1a2e';
        if (id === curLoadout) opt.selected = true;
        loadoutSelect.appendChild(opt);
      }
      settingsGrid.appendChild(makeField('Loadout', loadoutSelect));

      // Score limit
      const scoreInput = document.createElement('input');
      scoreInput.type = 'number';
      scoreInput.min = '1';
      scoreInput.max = '50';
      scoreInput.value = String(curScoreLimit);
      Object.assign(scoreInput.style, inputStyle);
      scoreInput.disabled = !amHost;
      settingsGrid.appendChild(makeField('Score Limit', scoreInput));

      // Bot count
      const botInput = document.createElement('input');
      botInput.type = 'number';
      botInput.min = '0';
      botInput.max = '10';
      botInput.value = String(curBotCount);
      Object.assign(botInput.style, inputStyle);
      botInput.disabled = !amHost;
      settingsGrid.appendChild(makeField('Bots', botInput));

      settingsSection.appendChild(settingsGrid);

      // Settings-changed indicator (hidden until host changes something)
      const settingsChangedBadge = document.createElement('div');
      settingsChangedBadge.textContent = 'â— Changes saved â€” REMATCH will use these settings';
      Object.assign(settingsChangedBadge.style, {
        fontSize: 'clamp(0.65rem, 1.4vw, 0.8rem)',
        color: '#00e5ff',
        textAlign: 'center',
        fontFamily: "'Poppins', sans-serif",
        display: 'none',
        transition: 'opacity 0.3s',
      });
      settingsSection.appendChild(settingsChangedBadge);

      const sendPostGameSettings = () => {
        if (!this.room || !amHost) return;
        const nextBattleType = btSelect.value;
        const nextSettings = {
          trackId: arenaSelect.value,
          battleType: nextBattleType,
          gameType: nextBattleType,
          loadoutId: loadoutSelect.value,
          scoreLimit: parseInt(scoreInput.value, 10) || 5,
          botCount: parseInt(botInput.value, 10) || 0,
        };
        this._joinOptions = {
          ...(this._joinOptions || {}),
          ...nextSettings,
        };
        this.gameType = nextBattleType;
        this.room.send('settingsUpdate', nextSettings);
      };

      // Wire up live settings updates (host only)
      if (amHost) {
        const onSettingsChange = () => {
          this._postGameSettingsChanged = true;
          settingsChangedBadge.style.display = 'block';
          sendPostGameSettings();
        };
        arenaSelect.addEventListener('change', onSettingsChange);
        btSelect.addEventListener('change', onSettingsChange);
        loadoutSelect.addEventListener('change', onSettingsChange);
        scoreInput.addEventListener('change', onSettingsChange);
        botInput.addEventListener('change', onSettingsChange);
      }

      screen.appendChild(settingsSection);

      // â”€â”€ Connected Players â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const playersSection = document.createElement('div');
      Object.assign(playersSection.style, {
        width: '100%', maxWidth: '500px',
        display: 'flex', flexWrap: 'wrap', gap: '8px',
        justifyContent: 'center', flexShrink: '0',
      });
      const playersLabel = document.createElement('div');
      playersLabel.style.cssText = 'width:100%;text-align:center;font-size:clamp(0.6rem,1.3vw,0.75rem);color:rgba(255,255,255,0.35);letter-spacing:0.1em;text-transform:uppercase;font-weight:700;';
      playersLabel.textContent = 'IN LOBBY';
      playersSection.appendChild(playersLabel);

      const updatePlayerChips = () => {
        // Remove old chips (keep label)
        playersSection.querySelectorAll('.pg-player-chip').forEach(c => c.remove());
        if (!this.room?.state?.players) return;
        this.room.state.players.forEach((p, id) => {
          const chip = document.createElement('div');
          chip.className = 'pg-player-chip';
          const isMe = id === myId;
          Object.assign(chip.style, {
            padding: '4px 12px',
            borderRadius: '20px',
            fontSize: 'clamp(0.7rem, 1.6vw, 0.85rem)',
            fontFamily: "'Poppins', sans-serif",
            color: isMe ? '#00ff88' : '#fff',
            background: isMe ? 'rgba(0,255,100,0.12)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${isMe ? 'rgba(0,255,100,0.3)' : 'rgba(255,255,255,0.1)'}`,
          });
          chip.textContent = (p.name || 'Player') + (p.isHost ? ' â˜…' : '');
          playersSection.appendChild(chip);
        });
      };
      updatePlayerChips();
      screen.appendChild(playersSection);

      // Refresh player chips when room state changes
      this._postGamePlayerRefresh = () => {
        if (document.getElementById('_glo-match-end')) updatePlayerChips();
      };

      const startNextMatch = () => {
        if (amHost && this._postGameSettingsChanged) {
          sendPostGameSettings();
        }
        this._postGameSettingsChanged = false;
        screen.remove();
        this._postGamePlayerRefresh = null;
        if (this.room) this.room.send('triggerStart', {});
      };

      // â”€â”€ Action Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, {
        display: 'flex', gap: '12px', flexWrap: 'wrap',
        justifyContent: 'center', flexShrink: '0', marginTop: '8px',
      });

      const makeBtn = (text, bg, shadow) => {
        const btn = document.createElement('button');
        btn.textContent = text;
        Object.assign(btn.style, {
          padding: '10px 28px',
          fontSize: 'clamp(0.85rem, 2.2vw, 1.15rem)',
          fontFamily: "'Bungee', Impact, sans-serif",
          background: bg,
          color: '#fff',
          border: 'none',
          borderRadius: '12px',
          cursor: 'pointer',
          letterSpacing: '0.05em',
          boxShadow: `0 0 18px ${shadow}`,
          transition: 'transform 0.12s, box-shadow 0.12s',
        });
        btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
        btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
        return btn;
      };

      // REMATCH â€” same settings, instant restart
      const btnRematch = makeBtn('REMATCH', 'linear-gradient(135deg, #00cc66, #009944)', 'rgba(0,200,100,0.4)');
      btnRematch.addEventListener('click', () => {
        startNextMatch();
      });
      btnRow.appendChild(btnRematch);

      // LEAVE â€” go back to main menu
      const btnLeave = makeBtn('LEAVE', 'linear-gradient(135deg, #ff0080, #7700ff)', 'rgba(255,0,128,0.4)');
      btnLeave.addEventListener('click', () => {
        this._postGamePlayerRefresh = null;
        void navigateWithTransition('/index.html');
      });
      btnRow.appendChild(btnLeave);

      screen.appendChild(btnRow);

      document.body.appendChild(screen);
      requestAnimationFrame(() => { screen.style.opacity = '1'; });

      // Victory/defeat audio stinger
      if (areBattleAssetsLoaded()) {
        playBattleSound(isSelfWinner ? 'victory' : 'defeat');
      } else if (isSelfWinner) {
        playSFX('race_win');
      } else {
        playSFX('race_finish');
      }
    }, 1200);
  }

  /** Visual countdown overlay: 3 â†’ 2 â†’ 1 â†’ GO! with scale-pulse */
  _showCountdownOverlay(durationMs) {
    // Remove any existing overlay
    if (this._countdownEl) { this._countdownEl.remove(); this._countdownEl = null; }

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "9998",
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none",
    });

    const num = document.createElement("div");
    Object.assign(num.style, {
      fontSize: "clamp(6rem, 20vw, 12rem)", fontFamily: "'Bungee', Impact, sans-serif",
      fontWeight: "400", color: "#fff",
      textShadow: "0 0 40px rgba(255,0,128,0.8), 0 4px 20px rgba(0,0,0,0.6)",
    });
    overlay.appendChild(num);
    document.body.appendChild(overlay);
    this._countdownEl = overlay;

    const colors = ['#ff3333', '#ffaa00', '#00ff88'];
    const steps = Math.floor(durationMs / 1000);
    let remaining = steps;

    const tick = () => {
      if (remaining <= 0) {
        overlay.remove();
        this._countdownEl = null;
        return;
      }
      const colorIdx = Math.max(0, Math.min(2, 3 - remaining));
      num.textContent = String(remaining);
      num.style.color = colors[colorIdx] || '#fff';
      num.style.animation = 'none';
      // Force reflow then apply pop animation
      void num.offsetHeight;
      num.style.animation = 'countdownPop 0.5s ease-out forwards';
      // Fade out in the last 300ms of each second
      setTimeout(() => {
        num.style.animation = 'countdownFade 0.3s ease-in forwards';
      }, 700);
      remaining--;
      setTimeout(tick, 1000);
    };
    tick();

    // Start boost detection: if player holds throttle right at GO, grant boost
    this._countdownStartBoostWindow = false;
    const goTime = durationMs;
    setTimeout(() => { this._countdownStartBoostWindow = true; }, Math.max(0, goTime - 400));
    setTimeout(() => { this._countdownStartBoostWindow = false; }, goTime + 300);
  }

  _showGoOverlay() {
    if (this._countdownEl) { this._countdownEl.remove(); this._countdownEl = null; }

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "9998",
      display: "flex", alignItems: "center", justifyContent: "center",
      pointerEvents: "none",
    });
    const label = document.createElement("div");
    Object.assign(label.style, {
      fontSize: "clamp(5rem, 18vw, 10rem)", fontFamily: "'Bungee', Impact, sans-serif",
      fontWeight: "400", color: "#00ff88",
      textShadow: "0 0 60px rgba(0,255,128,0.7), 0 4px 20px rgba(0,0,0,0.5)",
      transition: "transform 0.5s ease-out, opacity 0.5s ease-out",
      transform: "scale(0.5)", opacity: "0",
    });
    label.textContent = "GO!";
    overlay.appendChild(label);
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      label.style.transform = "scale(1.2)";
      label.style.opacity = "1";
    });

    setTimeout(() => {
      label.style.transform = "scale(2)";
      label.style.opacity = "0";
      setTimeout(() => overlay.remove(), 600);
    }, 1200);
  }

  startMatch() {
    if (this.room) this.room.send("start", {});
  }

  triggerStart() {
    if (this.room) this.room.send("triggerStart", {});
  }

  _sendRealtimeInputKeepalive() {
    if (!this.room || !this.localMesh || !this._kartReady || this._deathState || this._spectating || isPaused()) return;

    const sinceLastSend = this._lastInputSendTime ? performance.now() - this._lastInputSendTime : Infinity;
    if (sinceLastSend < this._inputKeepaliveMs * 0.8) return;

    const latest = this._latestRealtimeInput || {};
    this.sendInput({
      throttle: Number(latest.throttle || 0),
      steer: Number(latest.steer || 0),
      brake: !!latest.brake,
      drift: !!latest.drift,
      firePrimary: false,
      fireSecondary: false,
    }, {
      applyPrediction: false,
      emitWeaponEvents: false,
    });
    this._lastInputSendTime = performance.now();
  }

  sendInput(input, options = {}) {
    if (!this.room || !this.localMesh) return;

    const seq = ++this.inputSeq;
    const { position } = this.localMesh;
    // Use the clean physics-only quaternion (without visual lean/pitch offsets)
    const rq = this._physicsQuat || this.localMesh.rotationQuaternion;
    
    if (!rq) {
        this.localMesh.rotationQuaternion = new Quaternion();
    }

    const payload = {
      seq,
      throttle: Number(input.throttle || 0),
      steer: Number(input.steer || 0),
      brake: Number(input.brake || 0),
      drift: !!input.drift,
      fire: !!(input.firePrimary || input.fireSecondary),
      x: position.x,
      y: position.y,
      z: position.z,
      rx: (rq || this.localMesh.rotationQuaternion).x,
      ry: (rq || this.localMesh.rotationQuaternion).y,
      rz: (rq || this.localMesh.rotationQuaternion).z,
      rw: (rq || this.localMesh.rotationQuaternion).w,
    };

    if (options.applyPrediction !== false) {
      this.checkLocalCollisions();
      this.applyLocalPrediction(payload);
      this.pendingInputs.push(payload);
      if (this.pendingInputs.length > MAX_PENDING_INPUTS) {
        this.pendingInputs.splice(0, this.pendingInputs.length - MAX_PENDING_INPUTS);
      }
    }
    this.room.send("input", payload);

    if (options.emitWeaponEvents === false) {
      return;
    }

    // â”€â”€ Primary fire (Space) â€” glo_burst, continuous stream with overheat â”€â”€
    if (input.firePrimary && this.currentWeapon && !this._localCombatState.overheated) {
      const now = performance.now();
      if (this.currentWeapon === 'glo_burst') {
        if (!this._firePressedLastFrame) {
          this._primaryWarmupUntil = now + GLO_BURST_WARMUP_MS;
          this._lastPrimaryFireSentAt = 0;
          if (areBattleAssetsLoaded()) {
            playBattleSound('machine_gun', { volume: 0.16, playbackRate: 0.76, cooldownMs: 0 });
          } else {
            playSFX('machine_gun', 0.28);
          }
        }
        if (now >= this._primaryWarmupUntil && (!this._lastPrimaryFireSentAt || (now - this._lastPrimaryFireSentAt) >= GLO_BURST_FIRE_INTERVAL_MS)) {
          this.room.send("fireWeapon", { ...this._buildFirePayload("primary"), slot: "primary", warmupComplete: true });
          this._lastPrimaryFireSentAt = now;
        }
      } else if (!this._lastStreamFireTime || now - this._lastStreamFireTime > STREAM_SECONDARY_FIRE_INTERVAL_MS) {
        this.room.send("fireWeapon", { ...this._buildFirePayload("primary"), slot: "primary" });
        this._lastStreamFireTime = now;
      }
    } else {
      this._primaryWarmupUntil = 0;
      this._lastPrimaryFireSentAt = 0;
    }

    // â”€â”€ Secondary fire (E) â€” pickup weapon â”€â”€
    if (input.fireSecondary && this.currentWeapon2) {
      const isStream2 = this.currentWeapon2 === 'glow_thrower';
      if (isStream2) {
        const now = performance.now();
        if (!this._lastStream2FireTime || now - this._lastStream2FireTime > STREAM_SECONDARY_FIRE_INTERVAL_MS) {
          this.room.send("fireWeapon", { ...this._buildFirePayload("secondary"), slot: "secondary" });
          this._lastStream2FireTime = now;
        }
      } else if (!this._fire2PressedLastFrame) {
        this.room.send("fireWeapon", { ...this._buildFirePayload("secondary"), slot: "secondary" });
      }
    }
    this._firePressedLastFrame = !!input.firePrimary;
    this._fire2PressedLastFrame = !!input.fireSecondary;
  }

  _buildFirePayload(slot = "primary") {
    const origin = this.localMesh?.position?.clone?.() || new Vector3(0, 0, 0);
    origin.y += 0.9;

    const weaponId = slot === 'secondary' ? this.currentWeapon2 : this.currentWeapon;
    const aimDir = weaponId === 'tornado'
      ? this._getGroundedAimDirection()
      : this._getMissileAimDirection();

    origin.addInPlace(new Vector3(aimDir.x * 2.8, Math.max(0, aimDir.y) * 1.2, aimDir.z * 2.8));

    const payload = {
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      dirX: aimDir.x,
      dirY: aimDir.y,
      dirZ: aimDir.z,
    };

    const activeLockWeapon = this._getActiveLockWeapon();
    if (slot === 'secondary' && activeLockWeapon) {
      payload.lockStrength = Math.max(0, Math.min(1, Number(this._missileLockState?.lockProgress) || 0));
      payload.lockLocked = !!this._missileLockState?.locked;
      if (this._missileLockState?.targetId) {
        payload.targetId = this._missileLockTargetId;
      }
    }

    return payload;
  }

  _sendNeutralRealtimeInput() {
    if (!this.room || !this.localMesh || !this._kartReady || this._deathState || this._spectating) return;
    this.sendInput({
      throttle: 0,
      steer: 0,
      brake: false,
      drift: false,
      firePrimary: false,
      fireSecondary: false,
    }, {
      applyPrediction: false,
      emitWeaponEvents: false,
    });
    this._lastInputSendTime = performance.now();
  }

  _resetInputState(options = {}) {
    const { sendNeutral = false } = options;
    this._keys = {};
    this._latestRealtimeInput = {
      throttle: 0,
      steer: 0,
      brake: false,
      drift: false,
      firePrimary: false,
      fireSecondary: false,
    };
    this._firePressedLastFrame = false;
    this._fire2PressedLastFrame = false;
    this._swapSecondaryPressedLastFrame = false;
    this._gpScoreboardHeld = false;
    this._gpPauseHeld = false;
    this._wasSendingInput = false;
    this._primaryWarmupUntil = 0;
    this._lastPrimaryFireSentAt = 0;
    this._lastStreamFireTime = 0;
    this._lastStream2FireTime = 0;
    hideScoreboard();
    if (sendNeutral) {
      this._sendNeutralRealtimeInput();
    }
  }

  _teardownInputLoop() {
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp) window.removeEventListener("keyup", this._onKeyUp);
    if (this._onWindowBlur) window.removeEventListener("blur", this._onWindowBlur);
    if (this._onVisibilityChange) document.removeEventListener("visibilitychange", this._onVisibilityChange);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._onWindowBlur = null;
    this._onVisibilityChange = null;
    disposeGamepad();
    if (this._inputKeepaliveInterval) {
      window.clearInterval(this._inputKeepaliveInterval);
      this._inputKeepaliveInterval = null;
    }
    this._clearSceneBeforeRender("_inputPollingBeforeRender");
    this._resetInputState();
  }

  _getGroundedAimDirection() {
    let aimDir = this.localMesh?.forward?.scale?.(-1) || new Vector3(0, 0, 1);
    aimDir.y = 0;
    if (aimDir.lengthSquared() < 0.0001) {
      return new Vector3(0, 0, 1);
    }
    aimDir.normalize();
    return aimDir;
  }

  _getActiveLockWeapon() {
    if (this.currentWeapon2 === 'missile' || this.currentWeapon2 === 'crimson_hydra' || this.currentWeapon2 === 'lightning_bolt') {
      return this.currentWeapon2;
    }
    return '';
  }

  _syncLockConfigForWeapon(weaponId) {
    const config = weaponId === 'lightning_bolt'
      ? {
          maxRange: 42,
          minRange: 3,
          halfAngle: Math.PI / 5.8,
          acquireTime: 0.22,
          loseTime: 0.18,
          stickyBonus: 0.18,
          maxScreenOffsetNorm: 0.42,
          centerBias: 1.18,
          edgePenalty: 1.75,
          minAcquireScale: 0.28,
        }
      : weaponId === 'crimson_hydra'
        ? {
            maxRange: 90,
            minRange: 4,
            halfAngle: Math.PI / 5.3,
            acquireTime: 0.42,
            loseTime: 0.26,
            stickyBonus: 0.2,
            maxScreenOffsetNorm: 0.58,
            centerBias: 0.98,
            edgePenalty: 1.38,
            minAcquireScale: 0.28,
          }
        : {
          maxRange: 85,
          minRange: 4,
          halfAngle: Math.PI / 5.2,
          acquireTime: 0.52,
          loseTime: 0.24,
          stickyBonus: 0.2,
          maxScreenOffsetNorm: 0.56,
          centerBias: 0.92,
          edgePenalty: 1.42,
          minAcquireScale: 0.34,
        };

    Object.assign(this._missileLockState.config, config);
  }

  _getMissileAimDirection() {
    let baseForward = this.localMesh?.forward?.scale?.(-1) || new Vector3(0, 0, 1);
    if (baseForward.lengthSquared() < 0.0001) {
      baseForward = new Vector3(0, 0, 1);
    }
    baseForward.y = Math.max(-0.12, Math.min(0.18, baseForward.y || 0));
    baseForward.normalize();

    let aimDir = baseForward.clone();

    const camRay = this.camera?.getForwardRay?.(120);
    if (camRay?.direction) {
      const projected = camRay.direction.clone();
      projected.y = Math.max(-0.2, Math.min(0.35, projected.y));
      if (projected.lengthSquared() > 0.0001) {
        projected.normalize();
        const alignment = Vector3.Dot(projected, baseForward);
        if (alignment > 0.2) {
          const cameraInfluence = Math.min(0.42, Math.max(0.12, (alignment - 0.2) * 0.45));
          aimDir = Vector3.Lerp(baseForward, projected, cameraInfluence);
          if (aimDir.lengthSquared() > 0.0001) {
            aimDir.normalize();
          } else {
            aimDir = baseForward.clone();
          }
        }
      }
    }

    return aimDir;
  }

  _resolveKartVFXState(effectType) {
    const effect = String(effectType || '').toLowerCase();
    if (!effect) return '';
    if (effect === 'stunned' || effect === 'stun' || effect === 'spinout' || effect === 'knockback') {
      return VFXState.STUNNED;
    }
    if (effect === 'frozen' || effect === 'freeze') {
      return VFXState.FROZEN;
    }
    if (effect === 'burning' || effect === 'burn') {
      return VFXState.BURNING;
    }
    if (effect === 'poison' || effect === 'poisoned') {
      return VFXState.DAMAGED;
    }
    return '';
  }

  _applyKartEffectVFX(vfx, effectType) {
    if (!vfx) return;
    const nextState = this._resolveKartVFXState(effectType);
    if (nextState) {
      vfx.setState(nextState);
      return;
    }
    if (
      vfx.state === VFXState.STUNNED
      || vfx.state === VFXState.FROZEN
      || vfx.state === VFXState.BURNING
      || vfx.state === VFXState.DAMAGED
    ) {
      vfx.setState(VFXState.IDLE);
    }
  }

  _projectWorldToScreen(worldPos) {
    if (!worldPos || !this.scene || !this.camera || !this.engine) return null;
    const viewport = this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight());
    const projected = Vector3.Project(worldPos, Matrix.Identity(), this.scene.getTransformMatrix(), viewport);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || projected.z < 0 || projected.z > 1) {
      return null;
    }
    return projected;
  }

  _updateMissileLockReticle(dt) {
    const activeLockWeapon = this._getActiveLockWeapon();
    if (!activeLockWeapon || !this.localMesh || !this.authoritativeState?.players || !this.camera) {
      this._missileLockState.targetId = null;
      this._missileLockState.lockProgress = 0;
      this._missileLockState.locked = false;
      this._missileLockState.loseTimer = 0;
      this._missileLockTargetId = null;
      this._missileLockProgress = 0;
      this._missileLockScreenX = null;
      this._missileLockScreenY = null;
      this._missileLockWasLocked = false;
      updateLockReticle(null, null, false);
      if (this._allowBattleHudPolish()) {
        updateGUILockTelemetry({ lockWeapon: activeLockWeapon || '', lockProgress: 0, locked: false, targetName: '' });
      }
      return;
    }

    this._syncLockConfigForWeapon(activeLockWeapon);

    const localPos = this.localMesh.position;
    const aimDir = this._getMissileAimDirection();
    const candidates = [];

    this.authoritativeState.players.forEach((player, playerId) => {
      if (playerId === this.room?.sessionId) return;
      if (Number(player.health || 0) <= 0) return;

      const targetPos = new Vector3(player.x || 0, (player.y || 0) + 1.4, player.z || 0);
      const screenPos = this._projectWorldToScreen(targetPos);
      if (!screenPos) return;
      const halfWidth = Math.max(1, this.engine?.getRenderWidth?.() / 2 || 1);
      const halfHeight = Math.max(1, this.engine?.getRenderHeight?.() / 2 || 1);
      const offsetX = (screenPos.x - halfWidth) / halfWidth;
      const offsetY = (screenPos.y - halfHeight) / halfHeight;
      const screenOffsetNorm = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
      candidates.push({
        id: playerId,
        position: targetPos,
        velocity: new Vector3(player.vx || 0, player.vy || 0, player.vz || 0),
        screenPos,
        screenOffsetNorm,
      });
    });

    const lockResult = tickLockOn(this._missileLockState, localPos, aimDir, candidates, dt);
    const trackedCandidate = lockResult.candidate && lockResult.candidate.id === lockResult.targetId
      ? lockResult.candidate
      : candidates.find((candidate) => candidate.id === lockResult.targetId) || null;

    this._missileLockTargetId = lockResult.targetId;
    this._missileLockProgress = lockResult.lockProgress;
    const targetPlayer = lockResult.targetId ? this.authoritativeState.players.get(lockResult.targetId) : null;
    const targetName = targetPlayer?.name || "";

    if (!trackedCandidate?.screenPos) {
      this._missileLockScreenX = null;
      this._missileLockScreenY = null;
      updateLockReticle(null, null, false);
      if (this._allowBattleHudPolish()) {
        updateGUILockTelemetry({
          lockWeapon: activeLockWeapon,
          lockProgress: lockResult.lockProgress,
          locked: lockResult.locked,
          targetName,
        });
      }
      this._missileLockWasLocked = false;
      return;
    }

    this._missileLockScreenX = trackedCandidate.screenPos.x;
    this._missileLockScreenY = trackedCandidate.screenPos.y;
    updateLockReticle(
      trackedCandidate.screenPos.x,
      trackedCandidate.screenPos.y,
      lockResult.locked,
      lockResult.lockProgress,
    );
    if (this._allowBattleHudPolish()) {
      updateGUILockTelemetry({
        lockWeapon: activeLockWeapon,
        lockProgress: lockResult.lockProgress,
        locked: lockResult.locked,
        targetName,
      });
    }

    const now = performance.now();
    const justLocked = lockResult.locked && !this._missileLockWasLocked;
    if (lockResult.targetId) {
      const intervalMs = lockResult.locked
        ? 122
        : Math.max(120, 620 - lockResult.lockProgress * 420);
      if (!justLocked && (now - this._lastMissileLockToneAt) >= intervalMs) {
        playMissileLockTone(lockResult.lockProgress, lockResult.locked);
        this._lastMissileLockToneAt = now;
      }
    }
    if (justLocked) {
      playMissileLockTone(1, true);
      playSFX('locked', 0.42);
      this._lastMissileLockToneAt = now;
    }
    this._missileLockWasLocked = lockResult.locked;
  }

  checkLocalCollisions() {
    if (!this.authoritativeState?.entities || !this.localMesh) return;
    const localPos = this.localMesh.position;
    this.authoritativeState.entities.forEach((entity, id) => {
      if (!entity?.active || entity.type !== 'item_box') return;
      const dx = localPos.x - entity.x;
      const dy = localPos.y - entity.y;
      const dz = localPos.z - entity.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < 16) {
        this._queueItemBoxPickup(id, this.entityMeshes.get(id) || null, 'proximity');
      }
    });
  }

  applyLocalPrediction(input) {
    if (!this.localMesh || !this.localKartAggregate) return;

    const body = this.localKartAggregate.body;
    const transform = this.localMesh;
    const dt = 1 / 60;

    // â”€â”€ Restore clean physics quaternion before running physics â”€â”€â”€â”€â”€â”€â”€â”€
    // The previous frame may have added visual offsets (pitch/roll/lean).
    // We must restore the physics-only orientation so Havok doesn't
    // integrate on top of visual tilt and cause runaway accumulation.
    if (this._physicsQuat && this.localMesh.rotationQuaternion) {
      this.localMesh.rotationQuaternion.copyFrom(this._physicsQuat);
    }

    // â”€â”€ Force-based raycast suspension + ground detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // RaycastVehicle applies spring-damper forces to the physics body at each
    // wheel contact point (replaces the old visual-only suspension model).
    // Also populates drift state ground data so applyKartDriving knows isGrounded.
    if (this._raycastVehicle) {
      this._raycastVehicle.update();
      syncVehicleGroundState(this._raycastVehicle, this._driftState);
    } else {
      // Fallback: legacy per-wheel raycasting (no force-based suspension)
      const wheelOffsets = this._localKartEntity?.getWheelRayOffsets?.() || null;
      raycastWheels(this.havokPlugin, transform, this._driftState, PhysicsRaycastResult, wheelOffsets);
    }

    // Read active effect multipliers from server state
    let spdMult = 1.0;
    let strMult = 1.0;
    if (this.room && this.authoritativeState?.players) {
      const self = this.authoritativeState.players.get(this.room.sessionId);
      if (self) {
        spdMult = self.speedMultiplier ?? 1.0;
        strMult = self.steerMultiplier ?? 1.0;
      }
    }

    // â”€â”€ Delegate to shared kart-physics.js (eliminates inline duplication) â”€â”€
    const result = applyKartDriving(body, transform, input, dt, this._driftState, {
      spdMult,
      strMult,
      handling: this._getBuilderPlaytestHandling(),
    });
    if (this._allowBattleHudPolish()) {
      updateGUIBattleTelemetry({
        speedKPH: result.speedKPH,
        driftTier: result.driftTier,
        miniBoostTier: result.miniBoostTier,
        boostActive: result.miniBoostActive,
        isGrounded: result.isGrounded,
        isReversing: result.isReversing,
      });
    }

    // â”€â”€ Arena bounds enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this._arenaBoundsHalf) {
      const pos = transform.position;
      const half = this._arenaBoundsHalf;
      const vel = body.getLinearVelocity();
      let clamped = false;
      // Pull 0.5 units inside boundary so pre-step sync keeps body inside wall
      if (pos.x >= half)  { pos.x = half - 0.5;  vel.x = Math.min(vel.x, 0); clamped = true; }
      if (pos.x <= -half) { pos.x = -half + 0.5; vel.x = Math.max(vel.x, 0); clamped = true; }
      if (pos.z >= half)  { pos.z = half - 0.5;  vel.z = Math.min(vel.z, 0); clamped = true; }
      if (pos.z <= -half) { pos.z = -half + 0.5; vel.z = Math.max(vel.z, 0); clamped = true; }
      if (clamped) {
        body.setLinearVelocity(vel);
        body.disablePreStep = false;
      }
    }

    // â”€â”€ Drift / boost audiovisual feedback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const driftTier = result.driftTier;
    const boostActive = result.miniBoostActive;
    const isDrifting = driftTier > 0 || this._driftState.wasDrifting;
    if (driftTier > 0 && driftTier !== this._prevDriftTier) playSFX('skid', 0.5);
    if (boostActive && !this._prevBoostActive) playSFX('boost', 0.7);
    this._prevDriftTier = driftTier;
    this._prevBoostActive = boostActive;

    // Update particles (sparks / flames) for local kart
    if (this.localMesh && this._allowLocalVisualFlair()) {
      updateParticles(dt, this.localMesh, {
        isDrifting: this._driftState.wasDrifting,
        sparksLevel: driftTier,
        isBoosting: boostActive,
        speed: result.speedKPH,
      });
    }

    // â”€â”€ KartVFX drift integration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this._localKartVFX) {
      if (isDrifting && this._localKartVFX.state !== VFXState.DRIFT) {
        this._localKartVFX.setState(VFXState.DRIFT);
      }
      if (isDrifting) this._localKartVFX.setDriftTier(driftTier);
      if (!isDrifting && this._localKartVFX.state === VFXState.DRIFT) {
        this._localKartVFX.setState(VFXState.IDLE);
      }
      // MK3.js: boost trail colour by tier
      if (boostActive) {
        const bTier = result.miniBoostTier;
        this._localKartVFX.setBoostColor(bTier >= 3 ? 'drift_t3' : bTier >= 2 ? 'drift_t2' : 'drift_t1');
        if (this._localKartVFX.state !== VFXState.BOOST) {
          this._localKartVFX.setState(VFXState.BOOST);
        }
      }
    }

    // â”€â”€ MK3.js per-frame kart entity visuals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this._localKartEntity) {
      const speedMS = result.hSpeed || (result.speedKPH / 3.6);
      // Wheel spin (MK3.js: wheelRotation += speed * 0.01)
      this._localKartEntity.spinWheels(speedMS, dt);

      // Drift visual: body yaw offset + rear slide during active drift
      const rearSlide = result.driftDirection !== 0 ? result.driftDirection * 0.08 : 0;
      this._localKartEntity.applyDriftVisuals(result.driftBodyYaw, 0, rearSlide);

      // Always-on front-wheel visual steering (must come AFTER applyDriftVisuals)
      this._localKartEntity.applySteerVisuals(result.steer || 0, speedMS);

      // Per-wheel suspension spring offsets (applied AFTER quaternion to include tilt compensation)
      const bodyY = this.localMesh?.position?.y ?? 0;
      const justLanded = this._driftState.landingFrames === 3; // first landing frame
      computeSuspension(this._driftState, bodyY, dt, justLanded);
    }

    // â”€â”€ Terrain-conforming body pitch/roll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // With raycast vehicle active, the physics body already pitches/rolls
    // naturally from suspension forces â€” skip the visual-only computation.
    // Still populate drift state fields for test compatibility.
    if (this._raycastVehicle) {
      // Physics body orientation already reflects terrain tilt
      if (this.localMesh.rotationQuaternion) {
        const physEuler = this.localMesh.rotationQuaternion.toEulerAngles();
        this._driftState.bodyPitch = physEuler.x;
        this._driftState.bodyRoll = physEuler.z;
      }
    } else {
      const wheelOffsPR = this._localKartEntity?.getWheelRayOffsets?.() || null;
      computeBodyPitchRoll(this._driftState, dt, wheelOffsPR);
    }

    // â”€â”€ Steering lean + acceleration lean â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const speedMS = result.hSpeed || (result.speedKPH / 3.6);
    const steerLean = computeSteerLean(this._driftState, result.steer || 0, speedMS, dt);
    const accelLean = computeAccelLean(this._driftState, result.throttle || 0, result.brake, speedMS, dt);

    // â”€â”€ Visual body orientation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // CRITICAL: Visual offsets (lean/tilt/driftYaw) must NOT feed back into
    // the physics body.  Before the next physics step the mesh rotation is
    // restored to the clean physics quat (see top of this method).
    let pitchOff = 0;
    let totalRoll = 0;
    if (this.localMesh.rotationQuaternion) {
      // Save the clean physics quaternion BEFORE adding visual offsets.
      if (!this._physicsQuat) this._physicsQuat = this.localMesh.rotationQuaternion.clone();
      else this._physicsQuat.copyFrom(this.localMesh.rotationQuaternion);

      // -- Manual yaw integration ----------------------------------------
      // The _physicsQuat restore at the top of this method overwrites the
      // body rotation that Havok integrated from angular velocity.  This
      // prevents steering from accumulating across frames.  Manually
      // integrate the yaw component so turns persist, then zero the
      // body yaw angular velocity to prevent double-integration.
      {
        const av = body.getAngularVelocity();
        if (Math.abs(av.y) > 0.001) {
          const dq = Quaternion.RotationAxis(Vector3.Up(), av.y * dt);
          this._physicsQuat.copyFrom(dq.multiply(this._physicsQuat));
          body.setAngularVelocity(new Vector3(av.x, 0, av.z));
        }
      }

      const euler = this._physicsQuat.toEulerAngles();
      const driftYaw = result.driftBodyYaw || 0;

      if (this._raycastVehicle) {
        // Physics body already includes suspension-driven pitch/roll.
        // Add only visual-only cosmetic offsets on top.
        pitchOff  = euler.x + accelLean;
        totalRoll = euler.z + steerLean + this._driftState.driftTiltAngle;
      } else {
        // Legacy: absolute visual pitch/roll from computeBodyPitchRoll
        pitchOff = (this._driftState.bodyPitch || 0) + accelLean;
        const rollOff  = (this._driftState.bodyRoll || 0) + steerLean;
        totalRoll = this._driftState.driftTiltAngle + rollOff;
      }

      const tiltedQuat = Quaternion.FromEulerAngles(
        pitchOff,               // physics pitch + cosmetic lean
        euler.y + driftYaw,     // physics yaw + drift yaw visual offset
        totalRoll               // physics roll + cosmetic lean/tilt
      );
      this.localMesh.rotationQuaternion.copyFrom(tiltedQuat);
    }

    // â”€â”€ Apply suspension WITH tilt compensation (must come AFTER quat) â”€â”€
    if (this._localKartEntity) {
      this._localKartEntity.applySuspension(this._driftState.suspTravel, pitchOff, totalRoll);
    }

    // â”€â”€ FOV shift at speed (21.4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (this.camera) {
      const speedRatio = Math.min((result.speedKPH / 3.6) / 35, 1);
      const boostFOV = boostActive ? 3 * (Math.PI / 180) : 0;
      const targetFOV = this._baseFOV + (this._maxFOV - this._baseFOV) * speedRatio + boostFOV;
      this.camera.fov += (targetFOV - this.camera.fov) * 4 * dt;

      // Smooth radius toward mode target (camera clip avoidance may override)
      if (this.camera.radius !== this._targetCamRadius) {
        this.camera.radius += (this._targetCamRadius - this.camera.radius) * 4 * dt;
      }
    }
  }

  reconcile(state) {
    if (!this.localMesh || !state?.players || !this.room) return;
    const self = state.players.get(this.room.sessionId);
    if (!self) return;

    this._syncLocalCombatState(self);

    if (!this.localInitializedFromServer) {
      const hasFinitePose =
        Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z) &&
        Number.isFinite(self.rx) && Number.isFinite(self.ry) && Number.isFinite(self.rz) && Number.isFinite(self.rw);

      if (hasFinitePose) {
        const spawnPos = new Vector3(self.x, self.y, self.z);
        const spawnRot = new Quaternion(self.rx, self.ry, self.rz, self.rw);

        this._syncAuthoritativeSpawn(self);

        this.localMesh.position.copyFrom(spawnPos);
        this.localMesh.rotationQuaternion = spawnRot;
        // Initialize clean physics quat for the visual offset system
        this._physicsQuat = spawnRot.clone();

        if (this.localKartAggregate) {
          this.localKartAggregate.dispose();
        }

        if (this.havokPlugin) {
          this.localKartAggregate = new PhysicsAggregate(
            this.localMesh,
            PhysicsShapeType.BOX,
            { mass: 800, friction: 0.8, restitution: 0.01, extents: this._localKartExtents || new Vector3(1.8, 0.5, 3.2) },
            this.scene
          );
          if (this.localKartAggregate.body) {
            this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(800, 500, 800) });
            this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
            this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
            applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
            this.localKartAggregate.body.setCollisionCallbackEnabled(true);
            // Keep STATIC until matchLive fires to prevent pre-match kart movement
            if (!this._kartReady) {
              this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
            }
            // Recreate raycast vehicle for the new physics body
            const wheelOffsets = this._localKartEntity?.getWheelRayOffsets?.() || undefined;
            this._raycastVehicle = createKartRaycastVehicle(
              this.localKartAggregate.body,
              this.havokPlugin,
              { wheelOffsets, rayCollideWith: LAYER.TRACK },
            );
          }
        }

        this.localInitializedFromServer = true;
      }
    }

    if (this._isAuthoritativeMode()) {
      this._reconcileAuthoritativeLocal(self);
    }

    const ackSeq = self.lastProcessedInput || 0;
    this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
  }

  syncRemoteMeshes(state) {
    if (!this.scene || !state?.players || !this.room) return;

    const connectedIds = new Set(state.players.keys());

    state.players.forEach((player, id) => {
      if (id === this.room.sessionId) return;

      let mesh = this.remoteMeshes.get(id);

      if (!mesh && !this.loadingPromises.has(id)) {
        // Temporary placeholder to prevent multiple loading attempts
        const placeholder = MeshBuilder.CreateBox(`remote-${id}-placeholder`, { size: 1.8 }, this.scene);
        this.remoteMeshes.set(id, placeholder);

        const playerKartId = player.kartId || "default";
        const playerColor = player.playerColor || player.color || "red";

        const loadPromise = createRemoteKartEntity(this.scene, {
          id,
          kartId: playerKartId,
          color: playerColor,
          scale: this._arenaKartScale || undefined,
        }).then((remoteEntity) => {
            const activePlaceholder = this.remoteMeshes.get(id);
            if (!this.scene || this.scene.isDisposed || !activePlaceholder || activePlaceholder !== placeholder) {
              remoteEntity.dispose();
              return;
            }
            const realMesh = remoteEntity.rootMesh;
            realMesh.position = placeholder.position.clone();
            realMesh.rotationQuaternion = placeholder.rotationQuaternion ? placeholder.rotationQuaternion.clone() : new Quaternion();

            placeholder.dispose();
            this.remoteMeshes.set(id, realMesh);
            this._remoteKartEntities.set(id, remoteEntity);

            // Ensure remote kart is visible
            remoteEntity.setVisible(true);

            // â”€â”€ Remote kart ANIMATED physics â”€â”€
            if (this.havokPlugin) {
              remoteEntity.createPhysics(this.havokPlugin, 'ANIMATED');
              if (remoteEntity.aggregate) {
                this.remoteKartAggregates.set(id, remoteEntity.aggregate);
              }
            }

            // â”€â”€ Cache wheel meshes for remote kart spin animation â”€â”€
            if (remoteEntity.wheelMeshes.length) {
              this._remoteWheelMeshes.set(id, remoteEntity.wheelMeshes);
            }

            // â”€â”€ Remote KartVFX â”€â”€
            if (this._allowRemoteVisualFlair()) {
              const remoteVFX = new KartVFX(this.scene, remoteEntity, { remote: true });
              this._remoteKartVFXs.set(id, remoteVFX);
            }

            // â”€â”€ GLO underglow for remote player â”€â”€
            if (this._allowRemoteVisualFlair()) {
              try {
                const gloKit = createGloUnderglow(this.scene, realMesh, {
                  effect: player.gloEffect || 'solid',
                  color:  player.gloColor  || '#ff0080',
                  color2: player.gloColor2 || '#00e5ff',
                  id: id,
                  isRemote: true,
                  enableLight: false,
                  trailLength: 36,
                });
                setGloVisible(gloKit, true);
                this._remoteGloKits.set(id, gloKit);
              } catch (e) { console.warn(`[realtime] Remote GLO failed for ${id}:`, e); }
            }

            console.log(`[realtime] Loaded remote kart for ${id} (KartEntity)`);
          })
          .catch((err) => {
            if (this.remoteMeshes.get(id) === placeholder) {
              try { placeholder.dispose(); } catch (_) {}
              this.remoteMeshes.delete(id);
            }
            this._remoteTargets.delete(id);
            console.error(`[realtime] Failed to load remote kart for ${id}:`, err);
          })
          .finally(() => {
            this.loadingPromises.delete(id);
          });

        this.loadingPromises.set(id, loadPromise);
      } else if (mesh && mesh.position) {
        // Store target for smooth interpolation (lerped in beforeRender)
        // Use server Y directly â€” it's authoritative. Don't override with _sampleSurfaceY.
        let target = this._remoteTargets.get(id);
        if (!target) {
          target = {
            pos: new Vector3(),
            rot: new Quaternion(),
            vel: new Vector3(),
            steer: 0,
            renderPos: mesh.position.clone(),
          };
          this._remoteTargets.set(id, target);
        }
        target.pos.set(player.x, player.y, player.z);
        target.rot.copyFromFloats(player.rx, player.ry, player.rz, player.rw);
        target.vel.set(player.vx || 0, 0, player.vz || 0); // zero Y extrap to prevent bounce
        target.steer = player.steer || 0;
        target.renderPos.copyFrom(mesh.position);

        // Remote shield forcefield bubble
        this._updateRemoteShieldBubble(id, mesh, !!player.shielded, Number(player.shieldHP || 0));
      }
    });

    // Cleanup disconnected players
    for (const [id, mesh] of this.remoteMeshes.entries()) {
      if (!connectedIds.has(id)) {
        // Dispose KartVFX first (particle systems reference the mesh)
        const remoteVFX = this._remoteKartVFXs.get(id);
        if (remoteVFX) { remoteVFX.dispose(); this._remoteKartVFXs.delete(id); }
        // Dispose KartEntity (handles materials, attach points, mesh)
        const remoteEntity = this._remoteKartEntities.get(id);
        if (remoteEntity) {
          remoteEntity.dispose();
          this._remoteKartEntities.delete(id);
        } else {
          mesh.dispose();
        }
        const remoteAgg = this.remoteKartAggregates.get(id);
        if (remoteAgg && !(remoteEntity?.aggregate === remoteAgg)) { remoteAgg.dispose(); }
        this.remoteKartAggregates.delete(id);
        const remoteGlo = this._remoteGloKits.get(id);
        if (remoteGlo) { disposeGloUnderglow(remoteGlo); this._remoteGloKits.delete(id); }
        const remoteBubble = this._remoteShieldBubbles?.get(id);
        if (remoteBubble) { this._disposeShieldParticleField(remoteBubble); this._remoteShieldBubbles.delete(id); }
        this._remoteWheelMeshes.delete(id);
        this.remoteMeshes.delete(id);
        this.loadingPromises.delete(id);
        this._remoteTargets.delete(id);
      }
    }
  }

  syncEntities(state) {
    if (!this.scene || !state?.entities) return;
    const currentEntities = new Set(state.entities.keys());
    const projectileBudget = this._getRemoteProjectileVisualBudget();
    let activeProjectileVisuals = 0;
    for (const [id, mesh] of this.entityMeshes.entries()) {
      if (!currentEntities.has(id) || !mesh?._entityType || !mesh.isEnabled?.()) continue;
      if (mesh._entityType === 'projectile' && mesh._subType !== 'bubblegum' && mesh._subType !== 'banana') {
        activeProjectileVisuals++;
      }
    }
    state.entities.forEach((entity, id) => {
      const isProjectile = entity.type === "projectile";
      const isTrap = isProjectile && (entity.subType === "bubblegum" || entity.subType === "banana");
      let mesh = this.entityMeshes.get(id);
      if (!mesh && entity.active && isProjectile && !isTrap && activeProjectileVisuals >= projectileBudget) {
        this._suppressedEntityIds.add(id);
        return;
      }
      if (!mesh && !entity.active) {
        this._suppressedEntityIds.delete(id);
        return;
      }
      if (!mesh) {
        if (entity.type === "projectile") {
          mesh = entity.subType === "gravity_well"
            ? this._createGravityWellMesh(id)
            : this._createProjectileMesh(id, entity.subType);
        } else {
          // Item boxes â€” enhanced MK-style question block
          mesh = createItemBoxModel(this.scene, {
            includeCarousel: false,
            includeSparkles: false,
          });
        }
        mesh.position = new Vector3(entity.x, entity.y, entity.z);
        // Tag mesh with entity metadata for trigger lookups
        mesh._entityId = id;
        mesh._entityType = entity.type;
        mesh._subType = entity.subType || '';
        this.entityMeshes.set(id, mesh);
        if (isProjectile && !isTrap) {
          activeProjectileVisuals++;
          this._suppressedEntityIds.delete(id);
        }

        // Attach particle trail to remote projectiles (21.30)
        if (
          entity.type === "projectile"
          && entity.subType !== "bubblegum"
          && entity.subType !== "banana"
          && entity.subType !== "missile"
          && entity.subType !== "crimson_hydra"
          && entity.subType !== "glow_thrower"
          && entity.subType !== "lightning_bolt"
          && entity.subType !== "glo_burst"
        ) {
          const trailId = createProjectileTrail(entity.subType, mesh);
          if (trailId) mesh._trailId = trailId;
        }

        // â”€â”€ Trigger physics for item boxes â”€â”€
        if (entity.type === "item_box" && this.havokPlugin) {
          try {
            const triggerAgg = new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, {
              mass: 0, radius: 2.0,  // detection radius (~4m center-to-center with kart box)
            }, this.scene);
            triggerAgg.shape.isTrigger = true;
            applyFilterToAggregate(triggerAgg, FILTER.ITEM_BOX);
            this.entityAggregates.set(id, triggerAgg);
          } catch (e) { console.warn(`[realtime] Item box trigger physics failed for ${id}:`, e); }
        }

        // â”€â”€ Trigger physics for projectiles â”€â”€
        if (entity.type === "projectile" && this.havokPlugin) {
          try {
            const isTrap = (entity.subType === "bubblegum" || entity.subType === "banana");
            const projAgg = new PhysicsAggregate(mesh, PhysicsShapeType.SPHERE, {
              mass: 0, radius: isTrap ? 1.5 : 0.8,
            }, this.scene);
            projAgg.shape.isTrigger = true;
            applyFilterToAggregate(projAgg, isTrap ? FILTER.TRAP : FILTER.PROJECTILE);
            if (!isTrap) {
              // Non-trap projectiles are ANIMATED so they move with server state
              projAgg.body.setMotionType(PhysicsMotionType.ANIMATED);
              projAgg.body.disablePreStep = false;
            }
            this.entityAggregates.set(id, projAgg);
          } catch (e) { console.warn(`[realtime] Projectile trigger physics failed for ${id}:`, e); }
        }
      }
      if (mesh && mesh.position) {
        if (entity.active) {
          this._suppressedEntityIds.delete(id);
          if (entity.type === 'item_box') {
            this._pendingPickupBoxes.delete(id);
          }
          mesh.setEnabled(true);
          const isTrap = entity.type === "projectile" && (entity.subType === "bubblegum" || entity.subType === "banana");
          const groundedEntityY = entity.type === "item_box"
            ? this._sampleSurfaceY(entity.x, entity.z, entity.y, 0.9)
            : (isTrap ? this._sampleSurfaceY(entity.x, entity.z, entity.y, 0.25) : entity.y);

          if (entity.type === "projectile" && !isTrap) {
            // Store target for smooth interpolation in beforeRender
            let pt = this._projectileTargets.get(id);
            if (!pt) {
              pt = {
                pos: new Vector3(),
                vel: new Vector3(),
                lastUpdate: 0,
                subType: entity.subType,
                spawnTime: performance.now(),
                lifespan: entity.lifespan || 0,
                maxLifespan: entity.lifespan || 0,
                targetId: entity.targetId || '',
              };
              this._projectileTargets.set(id, pt);
              // Set initial position immediately on first appearance
              mesh.position.x = entity.x;
              mesh.position.y = entity.y;
              mesh.position.z = entity.z;
            }
            pt.pos.set(entity.x, entity.y, entity.z);
            pt.vel.set(entity.vx || 0, entity.vy || 0, entity.vz || 0);
            pt.lastUpdate = performance.now();
            pt.lifespan = entity.lifespan || 0;
            pt.maxLifespan = Math.max(pt.maxLifespan || 0, entity.lifespan || 0);
            pt.targetId = entity.targetId || '';
            // Gravity well / anomaly still gets per-frame animation
            this._animateProjectileVisual(mesh, entity);
          } else {
            // Item boxes and traps: direct positioning
            mesh.position.x = entity.x;
            mesh.position.y = groundedEntityY;
            mesh.position.z = entity.z;
            if (entity.type !== "projectile") {
              // Enhanced item box animation â€” tilted spin + rainbow glow + core pulse
              const t = Date.now() * 0.001;
              mesh.rotation.y += 0.04;
              mesh.rotation.x = Math.sin(t * 0.7) * 0.12;
              mesh.position.y += Math.sin(t * 1.5) * 0.3;

              // Rainbow color cycling on item box materials
              const meta = mesh.metadata;
              if (meta?._itemBoxMat) {
                const hue = (t * 0.25) % 1.0;
                const r = Math.max(0, Math.min(1, Math.abs(hue * 6 - 3) - 1));
                const g = Math.max(0, Math.min(1, 2 - Math.abs(hue * 6 - 2)));
                const b = Math.max(0, Math.min(1, 2 - Math.abs(hue * 6 - 4)));
                meta._itemBoxMat.emissiveColor.set(r * 0.5, g * 0.5, b * 0.5);
                if (meta._glowMat) meta._glowMat.emissiveColor.set(r * 0.5, g * 0.5, b * 0.55);
                if (meta._haloMat) meta._haloMat.emissiveColor.set(r * 0.35, g * 0.35, b * 0.45);
                const pulse = 0.5 + Math.sin(t * 3.0) * 0.3;
                meta._coreMat.emissiveColor.set(0.5 + r * pulse, 0.5 + g * pulse, 0.2 + b * pulse);
                if (meta._core) meta._core.scaling.setAll(0.9 + Math.sin(t * 4.0) * 0.15);
                // Carousel: spin and periodically swap displayed weapon
                if (meta._carouselNode) {
                  meta._carouselNode.rotation.y += 0.06;
                  meta._carouselTimer = (meta._carouselTimer || 0) + 0.016;
                  if (meta._carouselTimer >= (meta._carouselSwapInterval || 0.1)) {
                    meta._carouselTimer = 0;
                    if (meta._spawnCarouselItem) meta._spawnCarouselItem();
                  }
                }
              }

              // Subtle scale breathing
              const breathe = 1.0 + Math.sin(t * 2.0) * 0.04;
              mesh.scaling.setAll(breathe);
            } else {
              // Stationary traps: gentle bob
              mesh.position.y += Math.sin(Date.now() * 0.003) * 0.05;
            }
          }
        } else {
          this._suppressedEntityIds.delete(id);
          if (entity.type === 'projectile') {
            this._removeEntityVisual(id, mesh);
          } else {
            mesh.setEnabled(false);
          }
        }
      }
    });
    for (const id of Array.from(this._suppressedEntityIds)) {
      if (!currentEntities.has(id)) this._suppressedEntityIds.delete(id);
    }
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.remoteProjectileBudget = {
        budget: projectileBudget,
        active: activeProjectileVisuals,
        suppressed: this._suppressedEntityIds.size,
      };
    }
    const pickupNow = Date.now();
    for (const [id, ts] of this._pendingPickupBoxes.entries()) {
      if (pickupNow - ts > 1500) this._pendingPickupBoxes.delete(id);
    }
    for (const [id, mesh] of this.entityMeshes.entries()) {
      if (!currentEntities.has(id)) {
        this._removeEntityVisual(id, mesh);
      }
    }
  }

  _disposeProjectileVisual(mesh) {
    if (!mesh || mesh._projectileVisualDisposed) return;
    mesh._projectileVisualDisposed = true;

    const visualRoot = mesh.metadata?.visualRoot;
    const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata || null;

    const observerKeys = ['spinObserver', 'updateObserver', 'flickerObserver', 'expandObserver'];
    for (const key of observerKeys) {
      if (!visualMeta?.[key] || !this.scene?.onBeforeRenderObservable) continue;
      this.scene.onBeforeRenderObservable.remove(visualMeta[key]);
      visualMeta[key] = null;
    }

    const disposableKeys = ['trailPS', 'debrisPS', 'sparksPS', 'mistPS', 'dripsPS'];
    for (const key of disposableKeys) {
      const resource = visualMeta?.[key];
      if (!resource) continue;
      const items = Array.isArray(resource) ? resource : [resource];
      for (const item of items) {
        if (!item || typeof item.dispose !== 'function') continue;
        try {
          if (typeof item.stop === 'function') item.stop();
          item.dispose();
        } catch (_) { /* already disposed */ }
      }
      visualMeta[key] = null;
    }

    if (visualMeta && typeof visualMeta.cleanup === 'function') {
      try { visualMeta.cleanup(); } catch (_) { /* no-op */ }
      visualMeta.cleanup = null;
    }

    if (visualRoot && typeof visualRoot.isDisposed === 'function' && !visualRoot.isDisposed()) {
      try { visualRoot.dispose(); } catch (_) { /* already disposed */ }
    }
  }

  _removeEntityVisual(id, mesh, options = {}) {
    if (!mesh) return;

    const { emitImpact = true } = options;
    const entAgg = this.entityAggregates.get(id);
    if (entAgg) {
      try {
        if (entAgg.body) {
          entAgg.body.setMotionType(PhysicsMotionType.STATIC);
          entAgg.body.setMassProperties({ mass: 0 });
        }
      } catch (_) { /* body already disposed */ }
      entAgg.dispose();
      this.entityAggregates.delete(id);
    }

    if (emitImpact) {
      if (!mesh._impactHandled && mesh._subType === 'rock_barrage' && mesh.position) {
        const now = performance.now();
        const recentImpact = this._lastRockImpactPos
          && (now - this._lastRockImpactTime) < 250
          && Vector3.DistanceSquared(mesh.position, this._lastRockImpactPos) < 9;
        if (!recentImpact && this._allowBattleImpactPolish()) {
          emitWeaponImpactVFX(mesh.position.clone ? mesh.position.clone() : mesh.position, 'rock_barrage');
        }
      }
      if (!mesh._impactHandled && mesh.position && mesh._subType === 'super_nova' && this._allowBattleImpactPolish()) {
        emitWeaponImpactVFX(mesh.position.clone ? mesh.position.clone() : mesh.position, 'super_nova');
      } else if (!mesh._impactHandled && mesh.position && (mesh._subType === 'missile' || mesh._subType === 'crimson_hydra')) {
        if (this._allowBattleImpactPolish()) {
          emitWeaponExplosion(
            mesh.position.clone ? mesh.position.clone() : mesh.position,
            30,
            mesh._subType === 'crimson_hydra' ? 0xff4a2a : 0xff7a1c,
          );
        }
      } else if (!mesh._impactHandled && mesh.position && mesh._subType === 'fireball' && this._allowBattleImpactPolish()) {
        emitWeaponImpactVFX(mesh.position.clone ? mesh.position.clone() : mesh.position, mesh._subType);
      }
    }

    if (mesh._trailId) disposeProjectileTrail(mesh._trailId);
    this._disposeProjectileVisual(mesh);
    mesh.dispose();
    this.entityMeshes.delete(id);
    this._projectileTargets.delete(id);
    this._suppressedEntityIds.delete(id);
  }

  _createProjectileMesh(id, subType) {
    const modelWeaponId = PROJECTILE_MODEL_ALIASES[subType] || subType;
    const preferLightweightMissiles = this.roomName === 'battle_room' && (subType === 'missile' || subType === 'crimson_hydra');
    if ((this.roomName === 'battle_room' || subType === 'missile' || subType === 'crimson_hydra') && !preferLightweightMissiles) {
      const visualRoot = createWeaponModel(modelWeaponId, this.scene);
      if (visualRoot) {
        const anchor = MeshBuilder.CreateSphere(`entity-${id}`, { diameter: 0.42, segments: 6 }, this.scene);
        anchor.isVisible = false;
        anchor.isPickable = false;
        anchor.doNotSyncBoundingInfo = true;
        anchor.alwaysSelectAsActiveMesh = true;

        visualRoot.parent = anchor;
        const visualMetadata = visualRoot.metadata && typeof visualRoot.metadata === 'object'
          ? visualRoot.metadata
          : null;
        anchor.metadata = {
          ...(anchor.metadata || {}),
          ...(visualMetadata || {}),
          visualRoot,
          visualMetadata,
        };
        if (visualRoot.getChildMeshes) {
          visualRoot.getChildMeshes().forEach((child) => {
            child.isPickable = false;
            child.alwaysSelectAsActiveMesh = true;
          });
        }
        if (subType === 'crimson_hydra') {
          visualRoot.scaling.scaleInPlace(0.72);
        }
        return anchor;
      }
    }

    const PROJ_VISUALS = {
      missile:      { shape: "sphere", diameter: 0.6,  diffuse: [1, 0.2, 0.1],  emissive: [1, 0.3, 0] },
      crimson_hydra:{ shape: "sphere", diameter: 0.54, diffuse: [1, 0.14, 0.12], emissive: [1, 0.24, 0.14], alpha: 0.95 },
      bowling_ball: { shape: "sphere", diameter: 0.9,  diffuse: [0.12, 0.12, 0.14], emissive: [0.05, 0.05, 0.08] },
      cake:         { shape: "box",    size: 0.6,      diffuse: [1, 0.85, 0.3], emissive: [0.6, 0.4, 0.1] },
      plunger:      { shape: "cylinder", diameter: 0.3, height: 0.8, diffuse: [0.9, 0.15, 0], emissive: [0.7, 0.1, 0] },
      nitro:        { shape: "cylinder", diameter: 0.35, height: 0.7, diffuse: [0, 0.9, 0.6], emissive: [0, 0.5, 0.3] },
      tornado:      { shape: "cylinder", diameter: 1.8, height: 4.2, diffuse: [0.45, 0.62, 0.54], emissive: [0.12, 0.2, 0.16], alpha: 0.72 },
      bubblegum:    { shape: "sphere", diameter: 0.6,  diffuse: [1, 0.4, 0.75], emissive: [0.8, 0.2, 0.5] },
      banana:       { shape: "sphere", diameter: 0.45, diffuse: [1, 0.9, 0.1],  emissive: [0.7, 0.6, 0] },
    };

    const vis = PROJ_VISUALS[subType] || { shape: "sphere", diameter: 0.5, diffuse: [0, 0.8, 1], emissive: [0, 0.4, 0.5] };
    let mesh;
    if (vis.shape === "box") {
      mesh = MeshBuilder.CreateBox(`entity-${id}`, { size: vis.size || 0.5 }, this.scene);
    } else if (vis.shape === "cylinder") {
      mesh = MeshBuilder.CreateCylinder(`entity-${id}`, { diameter: vis.diameter || 0.3, height: vis.height || 0.7, tessellation: 8 }, this.scene);
    } else {
      // (21.39) Low-poly spheres for projectiles â€” 8 segments instead of default 32
      mesh = MeshBuilder.CreateSphere(`entity-${id}`, { diameter: vis.diameter || 0.5, segments: 8 }, this.scene);
    }
    const mat = new StandardMaterial(`mat-${id}`, this.scene);
    mat.diffuseColor = new Color3(...vis.diffuse);
    if (vis.emissive) mat.emissiveColor = new Color3(...vis.emissive);
    if (typeof vis.alpha === 'number') {
      mat.alpha = vis.alpha;
    }
    mesh.material = mat;
    // (22.8) WM-style mesh optimization flags â€” skip bounding info sync,
    // exclude from picking rays, prevent frustum culling on fast projectiles
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  _createGravityWellMesh(id) {
    const core = MeshBuilder.CreateSphere(`entity-${id}`, { diameter: 1.18, segments: 18 }, this.scene);
    const coreMat = new StandardMaterial(`mat-${id}-core`, this.scene);
    coreMat.diffuseColor = new Color3(0.06, 0.02, 0.14);
    coreMat.emissiveColor = new Color3(0.42, 0.24, 0.95);
    coreMat.alpha = 0.96;
    core.material = coreMat;

    const ringOuter = MeshBuilder.CreateTorus(`entity-${id}-ring-outer`, { diameter: 2.6, thickness: 0.08, tessellation: 48 }, this.scene);
    const ringInner = MeshBuilder.CreateTorus(`entity-${id}-ring-inner`, { diameter: 1.8, thickness: 0.06, tessellation: 40 }, this.scene);
    const spikeA = MeshBuilder.CreateCylinder(`entity-${id}-spike-a`, { height: 2.2, diameterTop: 0.02, diameterBottom: 0.16, tessellation: 6 }, this.scene);
    const spikeB = MeshBuilder.CreateCylinder(`entity-${id}-spike-b`, { height: 2.2, diameterTop: 0.02, diameterBottom: 0.16, tessellation: 6 }, this.scene);

    const accentMat = new StandardMaterial(`mat-${id}-accent`, this.scene);
    accentMat.diffuseColor = new Color3(0.18, 0.08, 0.38);
    accentMat.emissiveColor = new Color3(0.74, 0.48, 1.0);
    accentMat.alpha = 0.8;
    ringOuter.material = accentMat;
    ringInner.material = accentMat;
    spikeA.material = accentMat;
    spikeB.material = accentMat;

    ringOuter.parent = core;
    ringInner.parent = core;
    spikeA.parent = core;
    spikeB.parent = core;
    ringOuter.rotation.x = Math.PI * 0.5;
    ringInner.rotation.z = Math.PI * 0.5;
    spikeA.rotation.z = Math.PI * 0.5;
    spikeB.rotation.x = Math.PI * 0.5;

    // (22.8) WM-style mesh optimization flags on gravity well + children
    [core, ringOuter, ringInner, spikeA, spikeB].forEach(m => {
      m.doNotSyncBoundingInfo = true;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
    });
    core.metadata = {
      anomalyType: 'gravity_well',
      pulseSeed: Math.random() * Math.PI * 2,
      rotatingChildren: [ringOuter, ringInner, spikeA, spikeB],
    };
    return core;
  }

  _animateProjectileVisual(mesh, entity) {
    if (!mesh?.metadata?.anomalyType) return;
    const time = Date.now() * 0.004 + (mesh.metadata.pulseSeed || 0);
    if (mesh.metadata.anomalyType === 'gravity_well') {
      const pulse = 1 + Math.sin(time * 1.6) * 0.12;
      mesh.scaling.x = pulse;
      mesh.scaling.y = 0.92 + Math.sin(time * 1.2) * 0.08;
      mesh.scaling.z = pulse;
      mesh.rotation.y += 0.08;
      const [ringOuter, ringInner, spikeA, spikeB] = mesh.metadata.rotatingChildren || [];
      if (ringOuter) ringOuter.rotation.z += 0.06;
      if (ringInner) ringInner.rotation.x -= 0.08;
      if (spikeA) spikeA.rotation.y += 0.05;
      if (spikeB) spikeB.rotation.z -= 0.05;
      if (mesh.material?.emissiveColor) {
        mesh.material.emissiveColor.set(0.42 + Math.sin(time) * 0.12, 0.22, 0.88 + Math.cos(time * 1.3) * 0.1);
      }
    }
  }

  _animateProjectileFlight(mesh, pt, dt) {
    const time = performance.now() * 0.001;
    const age = (performance.now() - pt.spawnTime) * 0.001;
    const sub = pt.subType;

    switch (sub) {
      case 'bowling_ball': {
        // Rolling â€” spin on X axis proportional to speed
        const speed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        mesh.rotation.x -= speed * dt * 0.8;
        break;
      }
      case 'cake': {
        // Tumble in arc â€” gentle end-over-end rotation
        mesh.rotation.x += dt * 4.5;
        mesh.rotation.z += dt * 2.0;
        break;
      }
      case 'missile':
      case 'crimson_hydra': {
        // Bank missiles based on actual course changes instead of an arbitrary wobble.
        const planarSpeed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        if (planarSpeed > 0.1 || Math.abs(pt.vel.y) > 0.1) {
          const targetYaw = Math.atan2(pt.vel.x, pt.vel.z);
          if (Number.isFinite(pt._lastMissileYaw)) {
            let yawDelta = targetYaw - pt._lastMissileYaw;
            while (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
            while (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
            const bankTarget = Math.max(-0.32, Math.min(0.32, -yawDelta * 3.2));
            pt._missileBank = (pt._missileBank || 0) * 0.84 + bankTarget * 0.16;
          } else {
            pt._missileBank = 0;
          }
          pt._lastMissileYaw = targetYaw;
          mesh.rotation.y = targetYaw;
          mesh.rotation.x = -Math.atan2(pt.vel.y, Math.max(planarSpeed, 0.01));
        }
        mesh.rotation.z = pt._missileBank || 0;
        if (age < 0.3) {
          const baseScale = sub === 'crimson_hydra' ? 0.72 : 1.0;
          const burst = baseScale + (0.3 - age) * (sub === 'crimson_hydra' ? 0.32 : 0.5);
          mesh.scaling.setAll(burst);
        } else {
          mesh.scaling.setAll(sub === 'crimson_hydra' ? 0.72 : 1.0);
        }
        const thrusterGlow = mesh.metadata?.thrusterGlow || mesh.metadata?.visualMetadata?.thrusterGlow;
        const thrusterMat = mesh.metadata?.thrusterMat || mesh.metadata?.visualMetadata?.thrusterMat;
        const bandMat = mesh.metadata?.bandMat || mesh.metadata?.visualMetadata?.bandMat;
        const flamePulse = 0.85 + Math.sin(time * 28) * 0.15;
        if (thrusterGlow?.scaling) {
          thrusterGlow.scaling.x = 0.9 + flamePulse * 0.18;
          thrusterGlow.scaling.y = 0.9 + flamePulse * 0.18;
          thrusterGlow.scaling.z = 1.35 + flamePulse * 0.45;
        }
        if (thrusterMat?.emissiveColor) {
          thrusterMat.emissiveColor.set(1.0, 0.34 + flamePulse * 0.18, 0.05);
        }
        if (bandMat?.emissiveColor) {
          bandMat.emissiveColor.set(0.75 + flamePulse * 0.2, 0.54 + flamePulse * 0.18, 0.12);
        }
        break;
      }
      case 'fireball': {
        // Flickering flame â€” scale oscillation + rotation
        const flicker = 1.0 + Math.sin(time * 18) * 0.08 + Math.sin(time * 27) * 0.05;
        mesh.scaling.setAll(flicker);
        mesh.rotation.z += dt * 6;
        // Emissive pulse on child meshes
        const children = mesh.getChildMeshes?.();
        if (children) {
          for (const child of children) {
            if (child.material?.emissiveColor) {
              const pulse = 0.6 + Math.sin(time * 15) * 0.4;
              child.material.emissiveColor.set(1.0, 0.35 * pulse, 0);
            }
          }
        }
        break;
      }
      case 'ice_lance': {
        // Crystal shimmer â€” gentle twist + emissive pulse
        mesh.rotation.z = Math.sin(time * 8) * 0.1;
        const children = mesh.getChildMeshes?.();
        if (children) {
          for (const child of children) {
            if (child.material?.emissiveColor) {
              const shimmer = 0.7 + Math.sin(time * 12) * 0.3;
              child.material.emissiveColor.set(0.4 * shimmer, 0.8 * shimmer, 1.0);
            }
          }
        }
        break;
      }
      case 'lightning_bolt': {
        // Radial electric plasma orb so the silhouette never skews sideways in flight.
        const spearPulse = 0.9 + Math.sin(time * 34) * 0.08;
        const uniformScale = 0.98 + spearPulse * 0.1;
        mesh.scaling.set(uniformScale, uniformScale, uniformScale);
        const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        if (visualMeta?.coreOrb?.scaling) {
          const corePulse = 0.96 + Math.sin(time * 40) * 0.08;
          visualMeta.coreOrb.scaling.setAll(corePulse);
        }
        if (visualMeta?.innerShell?.scaling) {
          const shellPulse = 0.94 + Math.cos(time * 23) * 0.06;
          visualMeta.innerShell.scaling.setAll(shellPulse);
        }
        if (visualMeta?.coronaLayers) {
          for (let i = 0; i < visualMeta.coronaLayers.length; i += 1) {
            const plane = visualMeta.coronaLayers[i];
            if (!plane) continue;
            const pulse = 0.9 + Math.sin(time * (16 + i * 4) + i) * 0.12;
            plane.scaling.x = pulse;
            plane.scaling.y = pulse;
            plane.rotation.z += dt * (4 + i * 2);
          }
        }
        if (visualMeta?.arcRings) {
          const [ringA, ringB] = visualMeta.arcRings;
          if (ringA) {
            ringA.rotation.z += dt * 8;
            ringA.scaling.setAll(0.94 + Math.sin(time * 21) * 0.08);
          }
          if (ringB) {
            ringB.rotation.x += dt * 11;
            ringB.scaling.setAll(0.92 + Math.cos(time * 24) * 0.07);
          }
        }
        if (visualMeta?.sparkNodes && visualMeta?.sparkOrbs) {
          for (let i = 0; i < visualMeta.sparkNodes.length; i += 1) {
            const node = visualMeta.sparkNodes[i];
            const spark = visualMeta.sparkOrbs[i];
            if (node) {
              node.rotation.y += dt * (9 + i * 4);
              node.rotation.x += dt * (5 + i * 2);
            }
            if (spark?.position) {
              spark.position.x = 0.29 + Math.sin(time * (18 + i * 5) + i) * 0.05;
            }
            if (spark?.material) {
              spark.material.alpha = 0.38 + Math.sin(time * (28 + i * 3) + i) * 0.16;
            }
          }
        }
        break;
      }
      case 'plunger': {
        // Spin on flight axis like a thrown plunger
        mesh.rotation.z += dt * 10;
        break;
      }
      case 'wind_slash': {
        // Spinning disc
        mesh.rotation.y += dt * 14;
        break;
      }
      case 'rock_barrage': {
        // Heavy floor-hugging boulders should roll, not pinwheel through the air.
        const rollSpeed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        mesh.rotation.x += dt * Math.max(rollSpeed * 0.7, 4.5);
        mesh.rotation.z = Math.sin(time * 6) * 0.08;
        mesh.position.y = Math.max(mesh.position.y, 0.42);
        break;
      }
      case 'toxic_spread': {
        // Bobbing + dripping effect
        const bob = Math.sin(time * 10) * 0.04;
        mesh.position.y += bob;
        mesh.rotation.y += dt * 3;
        break;
      }
      case 'tornado': {
        // Intense vortex spin â€” accelerates over time
        const spinSpeed = 22 + Math.min(age * 7, 34);
        mesh.rotation.y += dt * spinSpeed;
        // Breathing pulse â€” vertical stretch + horizontal sway
        const breathe = 1.08 + Math.sin(time * 6.5) * 0.18;
        mesh.scaling.y = breathe;
        const sway = 1.1 + Math.sin(time * 10.5) * 0.1;
        mesh.scaling.x = sway;
        mesh.scaling.z = sway;
        // Wobble â€” slight tilt oscillation for organic feel
        mesh.rotation.x = Math.sin(time * 4.6) * 0.12;
        mesh.rotation.z = Math.cos(time * 5.1) * 0.09;
        // Animate swirl rings if present
        const tornadoMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        if (tornadoMeta?.swirlRings) {
          for (let i = 0; i < tornadoMeta.swirlRings.length; i++) {
            const r = tornadoMeta.swirlRings[i];
            r.rotation.y += dt * (12 + i * 4) * (i % 2 === 0 ? 1 : -1);
            const rScale = 1.15 + Math.sin(time * 9 + i) * 0.22;
            r.scaling.setAll(rScale);
          }
        }
        break;
      }
      case 'toxic_cloud': {
        // Slow expanding rotation
        mesh.rotation.y += dt * 2;
        const expand = Math.min(runtimePressure() > 0.62 ? 1.24 : 1.5, 1.0 + age * 0.15);
        mesh.scaling.setAll(expand);
        const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        if (visualMeta?.trailPS) {
          const budget = Math.max(0.24, runtimeFXBudget() * (runtimePressure() > 0.72 ? 0.55 : 0.75));
          visualMeta.trailPS.emitRate = Math.max(10, Math.round(34 * budget));
        }
        if (visualMeta?.dripsPS) {
          const budget = Math.max(0.24, runtimeFXBudget() * 0.7);
          visualMeta.dripsPS.emitRate = Math.max(4, Math.round(9 * budget));
        }
        break;
      }
      case 'nitro': {
        // Spinning bottle
        mesh.rotation.z += dt * 8;
        break;
      }
      case 'super_nova': {
        const lifeRatio = pt.maxLifespan > 0 ? Math.max(0, Math.min(1, pt.lifespan / pt.maxLifespan)) : 1;
        const urgency = 1 - lifeRatio;
        const pulseSpeed = 3 + urgency * 11;
        const pulseAmp = 0.04 + urgency * 0.22;
        const pulse = 1.0 + Math.sin(time * pulseSpeed * Math.PI) * pulseAmp;
        mesh.scaling.setAll(pulse);
        mesh.rotation.y += dt * (1.5 + urgency * 7);
        mesh.position.y = Math.max(mesh.position.y, 0.55);
        break;
      }
      case 'glow_thrower': {
        // Firehose-style flame stream driven by particles, not stretched mesh tails.
        const flicker = 1.0 + Math.sin(time * 22) * 0.08 + Math.sin(time * 35) * 0.05;
        const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        const pressure = runtimePressure();
        const fxBudget = Math.max(0.2, runtimeFXBudget() * (pressure > 0.78 ? 0.5 : pressure > 0.58 ? 0.68 : 1));
        const simplified = pressure > 0.62;
        const baseScale = 0.96 + flicker * 0.08;
        mesh.scaling.set(baseScale, baseScale, baseScale);
        mesh.rotation.z = Math.sin(time * 8.5) * 0.015;

        if (visualMeta?.heatOrb?.scaling) {
          const heatPulse = 0.92 + Math.sin(time * 18) * 0.1;
          visualMeta.heatOrb.scaling.set(heatPulse, 0.92 + Math.cos(time * 15) * 0.08, heatPulse);
          if (visualMeta.heatOrb.material?.emissiveColor) {
            visualMeta.heatOrb.material.emissiveColor.set(1.0, 0.32 + heatPulse * 0.18, 0.04);
          }
        }
        if (visualMeta?.heatPlanes && !simplified) {
          for (let i = 0; i < visualMeta.heatPlanes.length; i += 1) {
            const plane = visualMeta.heatPlanes[i];
            if (!plane) continue;
            const wave = Math.sin(time * (8 + i * 2) + i * 0.9);
            plane.position.x = wave * (0.11 + i * 0.028);
            plane.position.y = (i - 2) * 0.04 + Math.cos(time * (6 + i * 1.8) + i) * 0.06;
            plane.position.z = 0.74 + i * 0.4 + Math.abs(wave) * 0.12;
            plane.scaling.x = 0.96 + Math.abs(wave) * 0.34;
            plane.scaling.y = 1.02 + Math.sin(time * (10 + i * 3) + i) * 0.24;
            if (plane.material?.emissiveColor) {
              const pulse = 0.68 + Math.sin(time * (16 + i * 2) + i) * 0.2;
              plane.material.emissiveColor.set(1.0, 0.4 + pulse * 0.18, 0.05);
            }
          }
        }
        if (visualMeta?.fanSheets && !simplified) {
          for (let i = 0; i < visualMeta.fanSheets.length; i += 1) {
            const sheet = visualMeta.fanSheets[i];
            if (!sheet) continue;
            const flare = Math.sin(time * (9 + i * 1.6) + i * 0.7);
            const fanWidth = 0.92 + i * 0.18 + Math.abs(flare) * (0.18 + i * 0.04);
            sheet.position.x = flare * (0.04 + i * 0.03);
            sheet.position.y = -0.03 + i * 0.026 + Math.cos(time * (7 + i * 1.4) + i) * 0.03;
            sheet.position.z = 0.54 + i * 0.58 + Math.abs(flare) * 0.08;
            sheet.scaling.x = fanWidth;
            sheet.scaling.y = 0.96 + Math.sin(time * (8.5 + i * 1.8) + i) * 0.14;
            if (sheet.material?.emissiveColor) {
              const warmth = 0.66 + Math.sin(time * (14 + i * 2.2) + i) * 0.16;
              sheet.material.emissiveColor.set(1.0, 0.34 + warmth * 0.24, 0.04);
            }
          }
        }
        if (visualMeta?.muzzleCorona) {
          const coronaPulse = 0.94 + Math.sin(time * 24) * 0.14;
          visualMeta.muzzleCorona.scaling.x = 0.92 + coronaPulse * 0.34;
          visualMeta.muzzleCorona.scaling.y = 0.92 + coronaPulse * 0.34;
          visualMeta.muzzleCorona.position.z = 0.16 + Math.sin(time * 12) * 0.03;
          visualMeta.muzzleCorona.rotation.z += dt * 5.5;
        }
        if (visualMeta?.pressureRings && !simplified) {
          for (let i = 0; i < visualMeta.pressureRings.length; i += 1) {
            const ring = visualMeta.pressureRings[i];
            if (!ring) continue;
            ring.position.z = 0.5 + i * 0.86 + Math.sin(time * (10 + i * 1.4) + i) * 0.08;
            ring.scaling.x = 0.94 + Math.sin(time * (12 + i * 2.2) + i) * 0.12;
            ring.scaling.y = 0.94 + Math.cos(time * (11 + i * 1.8) + i) * 0.12;
            ring.rotation.z += dt * (6 + i * 2);
          }
        }
        if (visualMeta?.trailPS) {
          const flameSway = Math.sin(time * 11.5) * 0.16;
          const flameLift = Math.cos(time * 9.5) * 0.09;
          visualMeta.trailPS.direction1.x = -0.52 + flameSway * 1.35;
          visualMeta.trailPS.direction2.x = 0.52 + flameSway * 1.7;
          visualMeta.trailPS.direction1.y = -0.15 + flameLift;
          visualMeta.trailPS.direction2.y = 0.36 + flameLift * 1.6;
          visualMeta.trailPS.direction1.z = 4.2 + flicker * 1.1;
          visualMeta.trailPS.direction2.z = 7.6 + flicker * 1.5;
          visualMeta.trailPS.emitRate = Math.max(42, Math.round((118 + Math.sin(time * 14) * 18) * fxBudget));
          visualMeta.trailPS.minSize = 0.28 + Math.abs(flameSway) * 0.07;
          visualMeta.trailPS.maxSize = 0.96 + Math.abs(flameLift) * 0.22;
          visualMeta.trailPS.minEmitPower = 2.7 + Math.abs(flameSway) * 0.55;
          visualMeta.trailPS.maxEmitPower = 6.8 + Math.abs(flameLift) * 0.8;
        }
        if (visualMeta?.sparksPS) {
          const emberSway = Math.sin(time * 13.2 + 0.8) * 0.12;
          visualMeta.sparksPS.direction1.x = -0.38 + emberSway * 1.25;
          visualMeta.sparksPS.direction2.x = 0.38 + emberSway * 1.35;
          visualMeta.sparksPS.direction1.y = 0.03 + Math.cos(time * 10.4) * 0.06;
          visualMeta.sparksPS.direction2.y = 0.42 + Math.sin(time * 8.2) * 0.14;
          visualMeta.sparksPS.direction1.z = 2.6 + flicker * 0.6;
          visualMeta.sparksPS.direction2.z = 4.8 + flicker * 0.8;
          visualMeta.sparksPS.emitRate = Math.max(14, Math.round((32 + Math.cos(time * 18) * 8) * fxBudget));
        }
        break;
      }
      case 'glo_burst': {
        // Tight tracer round with a bright core and a short hot wake.
        const bloom = Math.min(1, age / 0.22);
        const bloomScale = 0.8 + bloom * 0.16;
        const tracerLength = 1.08 + bloom * 0.22 + Math.sin(time * 38) * 0.04;
        mesh.scaling.set(bloomScale * 0.92, bloomScale * 0.92, tracerLength);
        const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        if (visualMeta?.tracerCore?.scaling) {
          const corePulse = 0.98 + Math.sin(time * 48) * 0.09;
          visualMeta.tracerCore.scaling.setAll(corePulse);
        }
        if (visualMeta?.tracerCoreShell?.scaling) {
          const shellPulse = 0.94 + Math.cos(time * 36) * 0.08;
          visualMeta.tracerCoreShell.scaling.set(shellPulse * 0.98, shellPulse * 0.98, 1.12 + shellPulse * 0.12);
        }
        if (visualMeta?.tracerHalo) {
          const haloPulse = 0.94 + Math.sin(time * 40) * 0.14;
          visualMeta.tracerHalo.scaling.x = 0.88 + haloPulse * 0.42;
          visualMeta.tracerHalo.scaling.y = 0.54 + haloPulse * 0.24;
          visualMeta.tracerHalo.rotation.z += dt * 11;
        }
        if (visualMeta?.tracerHaloRear) {
          const rearPulse = 0.86 + Math.cos(time * 32) * 0.12;
          visualMeta.tracerHaloRear.scaling.x = 0.62 + rearPulse * 0.24;
          visualMeta.tracerHaloRear.scaling.y = 0.42 + rearPulse * 0.16;
          visualMeta.tracerHaloRear.rotation.z -= dt * 8;
        }
        if (visualMeta?.tracerCoreGlow) {
          const corePulse = 0.94 + Math.sin(time * 46) * 0.13;
          const glowScale = 0.86 + corePulse * 0.2;
          visualMeta.tracerCoreGlow.scaling.set(glowScale, glowScale, 1.08 + corePulse * 0.12);
        }
        if (visualMeta?.shockRing) {
          visualMeta.shockRing.rotation.z += dt * 18;
          visualMeta.shockRing.scaling.set(0.9 + Math.sin(time * 42) * 0.12, 0.9 + Math.sin(time * 42) * 0.12, 1);
        }
        if (visualMeta?.tracerStreak) {
          const streakPulse = 1.02 + Math.sin(time * 52) * 0.1;
          visualMeta.tracerStreak.scaling.set(1.0, 1.0, 0.9 + streakPulse * 0.5);
          visualMeta.tracerStreak.position.z = -0.34 - streakPulse * 0.08;
        }
        if (visualMeta?.tracerWake) {
          const wakePulse = 0.92 + Math.cos(time * 44) * 0.08;
          visualMeta.tracerWake.scaling.x = 0.92 + wakePulse * 0.28;
          visualMeta.tracerWake.scaling.y = 0.8 + wakePulse * 0.16;
          visualMeta.tracerWake.position.z = -0.26 - wakePulse * 0.04;
        }
        if (visualMeta?.flarePlanes) {
          for (let i = 0; i < visualMeta.flarePlanes.length; i += 1) {
            const flare = visualMeta.flarePlanes[i];
            if (!flare) continue;
            flare.scaling.x = 1.02 + Math.sin(time * (36 + i * 5)) * 0.18;
            flare.scaling.y = 0.76 + Math.cos(time * (30 + i * 4)) * 0.08;
            flare.rotation.z += dt * (10 + i * 4);
          }
        }
        if (visualMeta?.emberNodes && visualMeta?.emberOrbs) {
          for (let i = 0; i < visualMeta.emberNodes.length; i += 1) {
            const node = visualMeta.emberNodes[i];
            const ember = visualMeta.emberOrbs[i];
            if (node) node.rotation.y += dt * (11 + i * 5);
            if (ember?.position) ember.position.x = 0.14 + Math.sin(time * (24 + i * 4) + i) * 0.035;
            if (ember?.material) ember.material.alpha = 0.42 + Math.sin(time * (34 + i * 5) + i) * 0.18;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  _playAnomalyCue(cue, intensity = 1) {
    playAnomalyCue(cue, intensity);
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.lastAnomalyCue = cue;
    }
  }

  // â”€â”€ (22.5) Shockwave Post-Process â€” WM-style screen distortion on heavy hits â”€â”€

  // â”€â”€ (22.10) Multi-Projectile Spread â€” WM toxic ball pattern â”€â”€

  /**
   * Spawn visual-only spread projectile meshes that fly outward in a fan.
   * Uses Quaternion.RotationAxis(Y, Â±5Â° Ã— i) for even angular distribution.
   * Meshes auto-dispose after 1.5s (no physics, client-side visual only).
   */
  _spawnSpreadVisuals(ownerId, subType, count) {
    if (!this.scene) return;
    const ownerMesh = ownerId === this.room?.sessionId
      ? this.localMesh
      : this.remoteMeshes.get(ownerId);
    if (!ownerMesh) return;

    const spreadAngle = 5 * (Math.PI / 180); // Â±5Â° per step
    const forward = ownerMesh.forward || new Vector3(0, 0, 1);
    const speed = 0.8;

    for (let i = 0; i < count; i++) {
      // Skip center projectile (already created by entity sync from server)
      const offset = i - Math.floor(count / 2);
      if (offset === 0 && count % 2 === 1) continue;

      const quat = Quaternion.RotationAxis(new Vector3(0, 1, 0), spreadAngle * offset);
      const dir = forward.clone();
      dir.rotateByQuaternionToRef(quat, dir);

      const spreadMesh = this._createProjectileMesh(`spread-${Date.now()}-${i}`, subType);
      spreadMesh.position = ownerMesh.position.clone().add(new Vector3(0, 0.5, 0));

      // Animate outward then dispose
      const velocity = dir.scale(speed);
      let elapsed = 0;
      const obs = this.scene.onBeforeRenderObservable.add(() => {
        elapsed += this.scene.getEngine().getDeltaTime();
        spreadMesh.position.addInPlace(velocity);
        if (elapsed > 1500) {
          this.scene.onBeforeRenderObservable.remove(obs);
          this._disposeProjectileVisual(spreadMesh);
          spreadMesh.dispose();
        }
      });
    }
  }

  /**
   * Trigger a brief screen-space shockwave distortion effect.
   * Uses a custom fragment shader with time-decaying intensity.
   * Only fires for damage >= 40 (bomb, gravity well, meteor).
   */
  _triggerShockwave(damage) {
    if (!this.scene || !this.camera) return;
    if (damage < 40) return;
    if (this._shockwaveActive) return; // don't stack

    // Register the shockwave shader if not already done
    if (!Effect.ShadersStore['shockwaveFragmentShader']) {
      Effect.ShadersStore['shockwaveFragmentShader'] = `
        precision highp float;
        varying vec2 vUV;
        uniform sampler2D textureSampler;
        uniform float intensity;
        uniform float time;
        void main(void) {
          vec2 center = vec2(0.5, 0.5);
          vec2 dir = vUV - center;
          float dist = length(dir);
          float wave = sin(dist * 30.0 - time * 15.0) * intensity * 0.02;
          float falloff = smoothstep(0.5, 0.0, dist);
          vec2 offset = normalize(dir) * wave * falloff;
          gl_FragColor = texture2D(textureSampler, vUV + offset);
        }
      `;
    }

    this._shockwaveActive = true;
    const startTime = performance.now();
    const maxIntensity = Math.min(1.0, damage / 60);
    const duration = 500; // ms

    const pp = new PostProcess(
      'shockwave', 'shockwave', ['intensity', 'time'], null, 1.0, this.camera
    );
    pp.onApply = (effect) => {
      const elapsed = performance.now() - startTime;
      const progress = Math.min(1.0, elapsed / duration);
      const currentIntensity = maxIntensity * (1.0 - progress);
      effect.setFloat('intensity', currentIntensity);
      effect.setFloat('time', elapsed * 0.001);
    };

    // Auto-remove after duration
    setTimeout(() => {
      pp.dispose();
      this._shockwaveActive = false;
    }, duration);
  }

  flashDamage() {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(255,0,0,0.35)",
      pointerEvents: "none",
      zIndex: "10000",
      transition: "opacity 0.4s",
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 450);
    });
    // Camera shake on hit
    const canvas = document.querySelector("canvas");
    if (canvas) {
      canvas.style.transition = "none";
      canvas.style.transform = "translate(4px, -3px)";
      setTimeout(() => { canvas.style.transform = "translate(-3px, 2px)"; }, 50);
      setTimeout(() => { canvas.style.transform = "translate(2px, -1px)"; }, 100);
      setTimeout(() => { canvas.style.transform = ""; }, 150);
    }
  }

  flashShield() {
    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(80,180,255,0.3)",
      pointerEvents: "none",
      zIndex: "10000",
      transition: "opacity 0.5s",
      borderRadius: "50%",
      border: "4px solid rgba(80,180,255,0.7)",
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.style.opacity = "0";
      setTimeout(() => overlay.remove(), 550);
    });
  }

  // â”€â”€ Kill feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _addKillFeedEntry(attackerName, victimName, weapon, extra = {}) {
    if (!this._killFeedEl) {
      this._killFeedEl = document.createElement("div");
      Object.assign(this._killFeedEl.style, {
        position: "fixed", top: "60px", right: "12px",
        display: "flex", flexDirection: "column", alignItems: "flex-end",
        gap: "4px", zIndex: "9900", pointerEvents: "none",
        fontFamily: "Poppins, sans-serif", fontSize: "13px",
      });
      document.body.appendChild(this._killFeedEl);
    }
    const WEAPON_ICONS = {
      missile: "ðŸš€", crimson_hydra: "ðŸ‰", bowling_ball: "ðŸŽ³", cake: "ðŸŽ‚", plunger: "ðŸª ",
      bubblegum: "ðŸ«§", banana: "ðŸŒ", swatter: "ðŸª°", nitro: "ðŸ’¥",
      parachute: "ðŸª‚", anchor: "âš“", ludicrous_mode: "ðŸ”‹", shield: "ðŸ›¡ï¸",
      fireball: "ðŸ”¥", toxic_spread: "â˜£ï¸", ice_lance: "ðŸ§Š", tornado: "ðŸŒªï¸",
      super_nova: "â˜¢ï¸", rock_barrage: "ðŸª¨", lightning_bolt: "âš¡", wind_slash: "ðŸ’¨", toxic_cloud: "ðŸ§ª",
      glow_thrower: "ðŸ”¥", glo_burst: "ðŸ’«", pirateleportation: "ðŸ´â€â˜ ï¸",
    };

    // Build callout prefix
    let callout = extra.callout || '';
    if (!callout) {
      if (extra.isFirstBlood) callout = 'ðŸ©¸ FIRST BLOOD';
      else if (extra.multiKill >= 4) callout = 'ðŸ”¥ RAMPAGE';
      else if (extra.multiKill === 3) callout = 'âš¡ TRIPLE KILL';
      else if (extra.multiKill === 2) callout = 'ðŸ’¥ DOUBLE KILL';
      if (extra.isRevenge) callout = (callout ? callout + ' Â· ' : '') + 'ðŸ”„ REVENGE';
    }

    const icon = WEAPON_ICONS[weapon] || "ðŸ’€";
    const row = document.createElement("div");
    Object.assign(row.style, {
      background: "rgba(0,0,0,0.65)", color: "#fff", padding: "4px 10px",
      borderRadius: "6px", whiteSpace: "nowrap",
      transition: "opacity 0.5s, transform 0.3s", opacity: "1",
      transform: "translateX(100%)",
    });

    let html = '';
    if (callout) html += `<span style="color:#ffcc00;font-weight:700;margin-right:6px">${callout}</span>`;
    if (attackerName && victimName) {
      html += `<span style="color:#ff6666">${this._esc(attackerName)}</span> ${icon} <span style="color:#88ccff">${this._esc(victimName)}</span>`;
    } else if (victimName) {
      html += `<span style="color:#88ccff">${this._esc(victimName)}</span>`;
    }
    row.innerHTML = html;
    this._killFeedEl.appendChild(row);

    // Slide in
    requestAnimationFrame(() => { row.style.transform = "translateX(0)"; });

    // Auto-remove after 5s
    setTimeout(() => {
      row.style.opacity = "0";
      setTimeout(() => row.remove(), 500);
    }, 5000);
    // Cap at 6 visible entries
    while (this._killFeedEl.children.length > 6) {
      this._killFeedEl.firstChild.remove();
    }
  }

  _esc(str) {
    const d = document.createElement('span');
    d.textContent = str;
    return d.innerHTML;
  }

  // â”€â”€ Balloon meshes (three-strikes mode) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _createBalloons() {
    if (this._balloonMeshes) return;
    this._balloonMeshes = [];
    const colors = [new Color3(1, 0.2, 0.2), new Color3(0.2, 0.5, 1), new Color3(0.2, 0.9, 0.3)];
    for (let i = 0; i < 3; i++) {
      const b = MeshBuilder.CreateSphere(`balloon_${i}`, { diameter: 0.6, segments: 8 }, this.scene);
      b.position.set((i - 1) * 0.5, 2.2, 0);
      const mat = new StandardMaterial(`bmat_${i}`, this.scene);
      mat.diffuseColor = colors[i];
      mat.alpha = 0.85;
      b.material = mat;
      if (this.localMesh) b.parent = this.localMesh;
      this._balloonMeshes.push(b);
    }
  }

  _popBalloon(remainingLives) {
    if (!this._balloonMeshes) return;
    const idx = remainingLives; // pop the balloon at index = remaining (0-based from end)
    const b = this._balloonMeshes[idx];
    if (!b || b.isDisposed()) return;
    // Scale to 0 over 0.3s then dispose
    const startScale = b.scaling.clone();
    const startTime = performance.now();
    const anim = () => {
      const t = Math.min(1, (performance.now() - startTime) / 300);
      const s = 1 - t;
      b.scaling.copyFromFloats(startScale.x * s, startScale.y * s, startScale.z * s);
      if (t < 1) requestAnimationFrame(anim);
      else b.dispose();
    };
    requestAnimationFrame(anim);
    playBalloonPop();
  }

  // â”€â”€ Dynamic Forcefield Shield â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _updateForceFieldShield() {
    const shielded = this._localCombatState.shielded;
    const hp = this._localCombatState.shieldHP;

    if (shielded && this.localMesh) {
      if (!this._shieldBubble) {
        this._shieldBubble = this._createShieldParticleField("shield-bubble", this.localMesh, true);
      }
      const ratio = Math.max(0, Math.min(1, hp / 100));
      const t = performance.now() * 0.003;
      this._styleShieldParticleField(this._shieldBubble, ratio, t, true);
    } else if (this._shieldBubble) {
      this._disposeShieldParticleField(this._shieldBubble);
      this._shieldBubble = null;
      this._shieldBubbleMat = null;
    }
  }

  _getShieldParticleTexture() {
    if (this._shieldParticleTexture) return this._shieldParticleTexture;
    const tex = new DynamicTexture('shield-particle-tex', 64, this.scene, true);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 64, 64);
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.28, 'rgba(220,255,248,0.95)');
    gradient.addColorStop(0.58, 'rgba(120,255,190,0.4)');
    gradient.addColorStop(1, 'rgba(120,255,190,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(32, 32, 31, 0, Math.PI * 2);
    ctx.fill();
    tex.update();
    this._shieldParticleTexture = tex;
    return tex;
  }

  _createShieldParticleField(name, parent, isLocal = false) {
    const emitter = MeshBuilder.CreateSphere(`${name}-emitter`, { diameter: 0.12, segments: 4 }, this.scene);
    emitter.parent = parent;
    emitter.position.y = 0.55;
    emitter.isVisible = false;
    emitter.isPickable = false;

    const capacity = isLocal ? 80 : 56;
    const ps = new ParticleSystem(`${name}-ps`, capacity, this.scene);
    ps.particleTexture = this._getShieldParticleTexture();
    ps.emitter = emitter;
    ps.createSphereEmitter(1.42, 0);
    ps.minEmitPower = 0.02;
    ps.maxEmitPower = 0.08;
    ps.minLifeTime = isLocal ? 0.2 : 0.24;
    ps.maxLifeTime = isLocal ? 0.48 : 0.54;
    ps.minSize = isLocal ? 0.08 : 0.09;
    ps.maxSize = isLocal ? 0.16 : 0.18;
    ps.gravity = Vector3.Zero();
    ps.direction1 = new Vector3(-0.04, -0.03, -0.04);
    ps.direction2 = new Vector3(0.04, 0.03, 0.04);
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.isBillboardBased = true;
    ps.updateSpeed = 0.012;
    ps.emitRate = isLocal ? 28 : 22;
    ps.colorDead = new Color4(0, 0, 0, 0);
    ps.start();

    return {
      emitter,
      ps,
      isLocal,
      baseRadius: 1.42,
      baseEmitRate: isLocal ? 28 : 22,
      baseMinSize: isLocal ? 0.08 : 0.09,
      baseMaxSize: isLocal ? 0.16 : 0.18,
    };
  }

  _styleShieldParticleField(field, ratio, t, isLocal = false) {
    if (!field?.ps || !field?.emitter) return;
    const r = ratio > 0.5 ? (1 - ratio) * 2 : 1;
    const g = ratio > 0.5 ? 1 : ratio * 2;
    const tint = new Color4(
      0.12 + r * 0.2,
      0.24 + g * 0.34,
      0.1 + ratio * 0.12,
      isLocal ? 0.62 : 0.74,
    );
    const hotTint = new Color4(
      Math.min(1, tint.r + 0.18),
      Math.min(1, tint.g + 0.16),
      Math.min(1, tint.b + 0.1),
      isLocal ? 0.18 : 0.24,
    );
    const pulse = ratio < 0.3 ? 1.08 + Math.sin(t * 3.2) * 0.06 : 1 + Math.sin(t * 1.8) * 0.025;
    field.emitter.scaling.set(1.02 * pulse, 0.78 * pulse, 1.02 * pulse);
    field.ps.color1 = hotTint;
    field.ps.color2 = tint;
    field.ps.emitRate = Math.round(field.baseEmitRate * pulse * (isLocal ? 1 : 0.9));
    field.ps.minSize = field.baseMinSize;
    field.ps.maxSize = field.baseMaxSize * pulse;
  }

  _updateRemoteShieldBubble(playerId, mesh, shielded, hp) {
    if (!this._remoteShieldBubbles) this._remoteShieldBubbles = new Map();

    if (shielded) {
      let bubble = this._remoteShieldBubbles.get(playerId);
      if (!bubble) {
        bubble = this._createShieldParticleField(`rshield-${playerId}`, mesh, false);
        this._remoteShieldBubbles.set(playerId, bubble);
      }
      const ratio = Math.max(0, Math.min(1, hp / 100));
      const t = performance.now() * 0.0022;
      this._styleShieldParticleField(bubble, ratio, t, false);
    } else {
      const bubble = this._remoteShieldBubbles?.get(playerId);
      if (bubble) {
        this._disposeShieldParticleField(bubble);
        this._remoteShieldBubbles.delete(playerId);
      }
    }
  }

  _disposeShieldParticleField(field) {
    if (!field) return;
    try { field.ps?.stop(); } catch (_) {}
    try { field.ps?.dispose(); } catch (_) {}
    try { field.emitter?.dispose(); } catch (_) {}
  }

  // â”€â”€ Ludicrous Mode VFX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _updateLudicrousVFX(dt) {
    const isLudicrous = this._localCombatState.effectType === 'ludicrous';

    if (isLudicrous && this.localMesh) {
      if (!this._ludicrousActive) {
        this._ludicrousActive = true;
        this._ludicrousTime = 0;
        // Create afterburner particle system
        if (!this._ludicrousParticles && typeof BABYLON !== 'undefined') {
          const ps = new BABYLON.ParticleSystem("ludicrous-trail", 120, this.scene);
          ps.emitter = this.localMesh;
          ps.minEmitBox = new Vector3(-0.4, 0.1, -1.2);
          ps.maxEmitBox = new Vector3(0.4, 0.3, -0.8);
          ps.direction1 = new Vector3(-0.3, 0.2, -2);
          ps.direction2 = new Vector3(0.3, 0.5, -1.5);
          ps.minSize = 0.15;
          ps.maxSize = 0.5;
          ps.minLifeTime = 0.15;
          ps.maxLifeTime = 0.4;
          ps.emitRate = 100;
          ps.gravity = new Vector3(0, -1, 0);
          ps.color1 = new Color4(1, 0, 1, 0.9);
          ps.color2 = new Color4(0.5, 0, 1, 0.8);
          ps.colorDead = new Color4(0.2, 0, 0.3, 0);
          ps.blendMode = BABYLON.ParticleSystem.BLEND_ONEONE;
          ps.updateSpeed = 0.016;
          ps.createPointEmitter(new Vector3(-0.3, 0, -1.5), new Vector3(0.3, 0.3, -1));
          ps.start();
          this._ludicrousParticles = ps;
        }
      }
      this._ludicrousTime = (this._ludicrousTime || 0) + dt;
      // Pulsing emissive glow on the kart mesh
      const t = this._ludicrousTime * 6;
      const glowIntensity = 0.5 + Math.sin(t) * 0.3;
      if (this.localMesh.material && this.localMesh.material.emissiveColor) {
        this.localMesh.material.emissiveColor.set(glowIntensity * 0.8, 0, glowIntensity);
      }
    } else if (this._ludicrousActive) {
      this._ludicrousActive = false;
      this._ludicrousTime = 0;
      if (this._ludicrousParticles) {
        this._ludicrousParticles.stop();
        this._ludicrousParticles.dispose();
        this._ludicrousParticles = null;
      }
      // Reset emissive
      if (this.localMesh?.material?.emissiveColor) {
        this.localMesh.material.emissiveColor.set(0, 0, 0);
      }
    }
  }

  _handlePhaseShiftSwap(msg) {
    const localId = this.room?.sessionId;
    const affectedIds = [msg.target, msg.partnerId].filter(Boolean);

    for (const playerId of affectedIds) {
      const mesh = playerId === localId ? this.localMesh : this.remoteMeshes.get(playerId);
      if (!mesh) continue;
      emitPhaseSwapBurst(mesh.position.add(new Vector3(0, 0.8, 0)));
      this._fadeKartForPhaseSwap(mesh);
    }

    if (msg.target === localId && this.localKartAggregate?.body) {
      this.localMesh.position.copyFromFloats(
        Number.isFinite(msg.sourceX) ? msg.sourceX : this.localMesh.position.x,
        Number.isFinite(msg.sourceY) ? msg.sourceY : this.localMesh.position.y,
        Number.isFinite(msg.sourceZ) ? msg.sourceZ : this.localMesh.position.z,
      );
      this.localKartAggregate.body.setLinearVelocity(Vector3.Zero());
      this.localKartAggregate.body.setAngularVelocity(Vector3.Zero());
    } else if (msg.partnerId === localId && this.localKartAggregate?.body) {
      this.localMesh.position.copyFromFloats(
        Number.isFinite(msg.partnerX) ? msg.partnerX : this.localMesh.position.x,
        Number.isFinite(msg.partnerY) ? msg.partnerY : this.localMesh.position.y,
        Number.isFinite(msg.partnerZ) ? msg.partnerZ : this.localMesh.position.z,
      );
      this.localKartAggregate.body.setLinearVelocity(Vector3.Zero());
      this.localKartAggregate.body.setAngularVelocity(Vector3.Zero());
    }
  }

  _fadeKartForPhaseSwap(mesh) {
    const materials = new Set();
    if (mesh.material) materials.add(mesh.material);
    if (typeof mesh.getChildMeshes === 'function') {
      for (const child of mesh.getChildMeshes()) {
        if (child.material) materials.add(child.material);
      }
    }
    if (!materials.size) return;

    const originals = [];
    materials.forEach((mat) => {
      originals.push({ mat, alpha: typeof mat.alpha === 'number' ? mat.alpha : 1 });
      mat.alpha = Math.min(mat.alpha ?? 1, 0.22);
    });

    window.setTimeout(() => {
      for (const { mat } of originals) {
        mat.alpha = 0.58;
      }
      window.setTimeout(() => {
        for (const { mat, alpha } of originals) {
          mat.alpha = alpha;
        }
      }, 120);
    }, 110);
  }

  _ensureStatusOverlayStyles() {
    if (document.getElementById('tk-status-overlay-style')) return;
    const styleEl = document.createElement('style');
    styleEl.id = 'tk-status-overlay-style';
    styleEl.textContent = `
      @keyframes tkStatusPulse {
        0% { transform: scale(0.96); opacity: 0.5; }
        50% { transform: scale(1.02); opacity: 0.9; }
        100% { transform: scale(0.98); opacity: 0.62; }
      }
      @keyframes tkStatusSweep {
        from { transform: translateX(-110%) skewX(-18deg); opacity: 0; }
        18% { opacity: 0.26; }
        100% { transform: translateX(160%) skewX(-18deg); opacity: 0; }
      }
      .tk-status-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: 0;
        transition: opacity 320ms ease;
      }
      .tk-status-overlay.is-visible {
        opacity: 1;
      }
      .tk-status-veil {
        position: absolute;
        inset: 0;
        background: var(--tk-status-wash, transparent);
      }
      .tk-status-edge {
        position: absolute;
        inset: -12%;
        background:
          radial-gradient(circle at 50% 0%, var(--tk-status-edge, rgba(255,255,255,0.14)), transparent 42%),
          linear-gradient(180deg, rgba(4, 6, 12, 0), rgba(4, 6, 12, 0.14));
        filter: blur(36px);
        opacity: 0.9;
        animation: tkStatusPulse 2.6s ease-in-out infinite;
      }
      .tk-status-panel {
        position: absolute;
        top: 84px;
        left: 50%;
        transform: translateX(-50%) translateY(-10px) scale(0.985);
        min-width: min(420px, calc(100vw - 32px));
        max-width: min(520px, calc(100vw - 32px));
        padding: 14px 18px 12px;
        border-radius: 22px;
        border: 1px solid var(--tk-status-border, rgba(255,255,255,0.15));
        background:
          linear-gradient(135deg, var(--tk-status-surface, rgba(10, 14, 22, 0.86)), rgba(8, 10, 18, 0.72));
        box-shadow:
          0 20px 46px rgba(0, 0, 0, 0.32),
          inset 0 1px 0 rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
        overflow: hidden;
        transition: transform 360ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease;
      }
      .tk-status-overlay.is-visible .tk-status-panel {
        transform: translateX(-50%) translateY(0) scale(1);
      }
      .tk-status-panel::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(100deg, transparent 0%, rgba(255,255,255,0.16) 48%, transparent 100%);
        transform: translateX(-110%) skewX(-18deg);
        animation: tkStatusSweep 1.9s ease forwards;
      }
      .tk-status-header {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .tk-status-icon {
        width: 42px;
        height: 42px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        color: var(--tk-status-accent, #fff);
        border: 1px solid rgba(255,255,255,0.14);
        background:
          radial-gradient(circle at 35% 35%, rgba(255,255,255,0.22), rgba(255,255,255,0) 52%),
          rgba(255,255,255,0.04);
        box-shadow:
          0 0 0 1px rgba(255,255,255,0.03),
          0 0 24px color-mix(in srgb, var(--tk-status-accent, #fff) 22%, transparent);
        font-size: 17px;
        font-weight: 700;
      }
      .tk-status-copy {
        min-width: 0;
        flex: 1 1 auto;
      }
      .tk-status-kicker {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        color: rgba(244, 247, 255, 0.7);
        font-family: "Exo 2", sans-serif;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.26em;
        text-transform: uppercase;
      }
      .tk-status-kicker::before {
        content: "";
        width: 18px;
        height: 1px;
        background: color-mix(in srgb, var(--tk-status-accent, #fff) 60%, rgba(255,255,255,0.18));
      }
      .tk-status-title {
        color: var(--tk-status-accent, #fff);
        font-family: "Exo 2", sans-serif;
        font-size: 17px;
        font-weight: 800;
        letter-spacing: 0.03em;
        text-transform: uppercase;
        text-shadow: 0 0 28px rgba(0, 0, 0, 0.34);
      }
      .tk-status-subtitle {
        margin-top: 2px;
        color: rgba(230, 236, 255, 0.76);
        font-family: "Rajdhani", "Exo 2", sans-serif;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.05em;
      }
      .tk-status-meter {
        position: relative;
        margin-top: 10px;
        height: 3px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(255,255,255,0.08);
      }
      .tk-status-meter-fill {
        position: absolute;
        inset: 0;
        transform-origin: left center;
        background: linear-gradient(90deg, var(--tk-status-accent, #fff), rgba(255,255,255,0.9));
        box-shadow: 0 0 16px color-mix(in srgb, var(--tk-status-accent, #fff) 60%, transparent);
      }
      .tk-status-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        color: rgba(255,255,255,0.62);
        font-family: "Exo 2", sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        background: rgba(255,255,255,0.04);
        flex: 0 0 auto;
      }
      @media (max-width: 720px) {
        .tk-status-panel {
          top: 72px;
          min-width: calc(100vw - 22px);
          max-width: calc(100vw - 22px);
          padding: 12px 14px 10px;
          border-radius: 18px;
        }
        .tk-status-header {
          gap: 10px;
        }
        .tk-status-icon {
          width: 36px;
          height: 36px;
          font-size: 15px;
        }
        .tk-status-title {
          font-size: 14px;
        }
        .tk-status-subtitle {
          font-size: 11px;
        }
        .tk-status-chip {
          display: none;
        }
      }
    `;
    document.head.appendChild(styleEl);
  }

  _createStatusOverlay({
    scope = 'Status',
    title,
    subtitle = '',
    chip = '',
    icon = 'â€¢',
    accent = '#ffffff',
    surface = 'rgba(10, 14, 22, 0.88)',
    border = 'rgba(255,255,255,0.14)',
    wash = 'transparent',
    edge = 'rgba(255,255,255,0.12)',
    zIndex = 10001,
    duration = 2000,
  }) {
    this._ensureStatusOverlayStyles();

    const overlay = document.createElement('div');
    overlay.className = 'tk-status-overlay';
    overlay.style.zIndex = String(zIndex);
    overlay.style.setProperty('--tk-status-accent', accent);
    overlay.style.setProperty('--tk-status-surface', surface);
    overlay.style.setProperty('--tk-status-border', border);
    overlay.style.setProperty('--tk-status-wash', wash);
    overlay.style.setProperty('--tk-status-edge', edge);

    const veil = document.createElement('div');
    veil.className = 'tk-status-veil';
    overlay.appendChild(veil);

    const edgeLayer = document.createElement('div');
    edgeLayer.className = 'tk-status-edge';
    overlay.appendChild(edgeLayer);

    const panel = document.createElement('div');
    panel.className = 'tk-status-panel';

    const header = document.createElement('div');
    header.className = 'tk-status-header';

    const iconEl = document.createElement('div');
    iconEl.className = 'tk-status-icon';
    iconEl.textContent = icon;
    header.appendChild(iconEl);

    const copy = document.createElement('div');
    copy.className = 'tk-status-copy';

    const kicker = document.createElement('div');
    kicker.className = 'tk-status-kicker';
    kicker.textContent = scope;
    copy.appendChild(kicker);

    const titleEl = document.createElement('div');
    titleEl.className = 'tk-status-title';
    titleEl.textContent = title;
    copy.appendChild(titleEl);

    if (subtitle) {
      const subtitleEl = document.createElement('div');
      subtitleEl.className = 'tk-status-subtitle';
      subtitleEl.textContent = subtitle;
      copy.appendChild(subtitleEl);
    }
    header.appendChild(copy);

    if (chip) {
      const chipEl = document.createElement('div');
      chipEl.className = 'tk-status-chip';
      chipEl.textContent = chip;
      header.appendChild(chipEl);
    }

    panel.appendChild(header);

    const meter = document.createElement('div');
    meter.className = 'tk-status-meter';
    const meterFill = document.createElement('div');
    meterFill.className = 'tk-status-meter-fill';
    meter.appendChild(meterFill);
    panel.appendChild(meter);

    overlay.appendChild(panel);

    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      requestAnimationFrame(() => {
        meterFill.style.transition = `transform ${Math.max(220, duration)}ms linear`;
        meterFill.style.transform = 'scaleX(0)';
      });
    });

    return overlay;
  }

  showEffectOverlay(effectType, duration) {
    const normalizedEffectType = String(effectType || '')
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
    if (this._effectOverlayTimer) {
      window.clearTimeout(this._effectOverlayTimer);
      this._effectOverlayTimer = null;
    }
    if (
      normalizedEffectType === 'phased'
      || normalizedEffectType === 'phase_shift_swap'
      || normalizedEffectType === 'no_weapon'
      || normalizedEffectType === 'empty_weapon'
    ) {
      return;
    }
    this.activeEffect = normalizedEffectType || effectType;

    const statusStyles = {
      blind: {
        accent: "#ff9d54",
        icon: "â—‰",
        title: "Visual Feed Interrupted",
        subtitle: "Optics degraded. Drive by instinct.",
        chip: "Impaired",
        surface: "rgba(42, 22, 10, 0.86)",
        border: "rgba(255, 157, 84, 0.22)",
        wash: "radial-gradient(circle at 50% 52%, rgba(0,0,0,0.06), rgba(7,5,3,0.72) 76%)",
        edge: "rgba(255, 124, 36, 0.2)",
      },
      stuck: {
        accent: "#ff7fd7",
        icon: "â—Ž",
        title: "Adhesion Lock",
        subtitle: "Mobility compromised by sticky residue.",
        chip: "Entrapped",
        surface: "rgba(38, 12, 32, 0.84)",
        border: "rgba(255, 127, 215, 0.22)",
        wash: "radial-gradient(circle at 50% 0%, rgba(255,127,215,0.12), rgba(14,8,14,0.04) 32%, rgba(10,6,10,0.16) 100%)",
        edge: "rgba(255, 127, 215, 0.18)",
      },
      spinout: {
        accent: "#ffd25e",
        icon: "â†º",
        title: "Handling Destabilized",
        subtitle: "Spin recovery engaged.",
        chip: "Skid",
        surface: "rgba(40, 28, 8, 0.84)",
        border: "rgba(255, 210, 94, 0.22)",
        wash: "radial-gradient(circle at 50% 0%, rgba(255,208,92,0.12), rgba(9,8,5,0.04) 32%, rgba(14,10,5,0.14) 100%)",
        edge: "rgba(255, 210, 94, 0.18)",
      },
      slow: {
        accent: "#b8beff",
        icon: "âˆ¿",
        title: "Drag Field Active",
        subtitle: "Acceleration dampened for a short burst.",
        chip: "Debuff",
        surface: "rgba(14, 18, 40, 0.84)",
        border: "rgba(184, 190, 255, 0.2)",
        wash: "radial-gradient(circle at 50% 0%, rgba(160,170,255,0.11), rgba(8,10,18,0.04) 30%, rgba(8,10,18,0.14) 100%)",
        edge: "rgba(168, 178, 255, 0.16)",
      },
      heavy: {
        accent: "#aeb8ca",
        icon: "â¬£",
        title: "Mass Surge",
        subtitle: "Weight spike detected across the chassis.",
        chip: "Burdened",
        surface: "rgba(16, 20, 28, 0.86)",
        border: "rgba(174, 184, 202, 0.18)",
        wash: "radial-gradient(circle at 50% 0%, rgba(174,184,202,0.08), rgba(8,10,16,0.02) 28%, rgba(8,10,16,0.16) 100%)",
        edge: "rgba(174, 184, 202, 0.14)",
      },
      squash: {
        accent: "#95ff6f",
        icon: "â–£",
        title: "Compression Shock",
        subtitle: "Profile reduced until the chassis rebounds.",
        chip: "Crushed",
        surface: "rgba(12, 28, 10, 0.84)",
        border: "rgba(149, 255, 111, 0.2)",
        wash: "radial-gradient(circle at 50% 0%, rgba(149,255,111,0.08), rgba(8,16,8,0.03) 30%, rgba(8,16,8,0.14) 100%)",
        edge: "rgba(149, 255, 111, 0.16)",
      },
      boost: {
        accent: "#45f5db",
        icon: "Â»",
        title: "Boost Window Open",
        subtitle: "Output elevated. Keep the throttle pinned.",
        chip: "Buff",
        surface: "rgba(8, 22, 24, 0.84)",
        border: "rgba(69, 245, 219, 0.22)",
        wash: "radial-gradient(circle at 50% 0%, rgba(69,245,219,0.1), rgba(4,10,12,0.03) 34%, rgba(4,10,12,0.12) 100%)",
        edge: "rgba(69, 245, 219, 0.18)",
      },
      ludicrous: {
        accent: "#ff69f3",
        icon: "âˆž",
        title: "Ludicrous Engaged",
        subtitle: "Overclocked thrust envelope now online.",
        chip: "Overdrive",
        surface: "rgba(28, 8, 34, 0.84)",
        border: "rgba(255, 105, 243, 0.24)",
        wash: "radial-gradient(circle at 50% 0%, rgba(255,105,243,0.12), rgba(10,4,12,0.03) 34%, rgba(10,4,12,0.16) 100%)",
        edge: "rgba(255, 105, 243, 0.2)",
      },
      shielded: {
        accent: "#6cc8ff",
        icon: "â—Œ",
        title: "Shield Matrix Stable",
        subtitle: "Deflection layer wrapped around the kart.",
        chip: "Protected",
        surface: "rgba(8, 18, 30, 0.84)",
        border: "rgba(108, 200, 255, 0.22)",
        wash: "radial-gradient(circle at 50% 0%, rgba(108,200,255,0.1), rgba(6,8,14,0.03) 34%, rgba(6,8,14,0.12) 100%)",
        edge: "rgba(108, 200, 255, 0.18)",
      },
      mirror: {
        accent: "#c4ecff",
        icon: "â—‡",
        title: "Mirror Drift",
        subtitle: "Perception bent by reflected vectors.",
        chip: "Disorient",
        surface: "rgba(10, 20, 28, 0.82)",
        border: "rgba(196, 236, 255, 0.2)",
        wash: "radial-gradient(circle at 50% 0%, rgba(196,236,255,0.1), rgba(8,10,16,0.03) 34%, rgba(8,10,16,0.12) 100%)",
        edge: "rgba(196, 236, 255, 0.16)",
      },
      pirateleportation: {
        accent: "#c58dff",
        icon: "â˜",
        title: "Signal Hijacked",
        subtitle: "Position routing was tampered with mid-match.",
        chip: "Pirated",
        surface: "rgba(22, 10, 30, 0.84)",
        border: "rgba(197, 141, 255, 0.22)",
        wash: "radial-gradient(circle at 50% 0%, rgba(197,141,255,0.11), rgba(10,6,14,0.03) 34%, rgba(10,6,14,0.14) 100%)",
        edge: "rgba(197, 141, 255, 0.18)",
      },
    };
    const statusZoneByEffect = {
      blind: 'health',
      stuck: 'health',
      spinout: 'health',
      slow: 'health',
      heavy: 'health',
      squash: 'health',
      shielded: 'health',
      boost: 'primary',
      ludicrous: 'primary',
      mirror: 'pickup',
      pirateleportation: 'pickup',
    };
    const statusStyle = statusStyles[normalizedEffectType] || {
      accent: "#ffffff",
      icon: "â€¢",
      title: String(effectType || "status").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
      subtitle: "System state updated.",
      chip: "Status",
    };
    if (this._allowBattleHudPolish()) {
      showGUIStatusLane({
        title: statusStyle.title,
        subtitle: statusStyle.subtitle,
        chip: statusStyle.chip,
        icon: statusStyle.icon,
        accent: statusStyle.accent,
        duration,
        sourceZone: statusZoneByEffect[normalizedEffectType] || 'center',
      });
    }
    return;

    // Remove existing overlay
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
    if (effectType === 'phased' || effectType === 'phase_shift_swap') {
      return;
    }
    this.activeEffect = effectType;

    const EFFECT_STYLES = {
      blind:   { bg: "rgba(60,30,0,0.85)", text: "ðŸª  BLINDED!", color: "#ff6600" },
      stuck:   { bg: "rgba(200,50,150,0.45)", text: "ðŸ«§ STUCK!", color: "#ff66cc" },
      spinout: { bg: "rgba(255,180,0,0.35)", text: "ðŸ’« SPIN OUT!", color: "#ffcc00" },
      slow:    { bg: "rgba(100,100,180,0.3)", text: "ðŸª‚ SLOWED!", color: "#aaaaff" },
      heavy:   { bg: "rgba(50,60,80,0.4)", text: "âš“ HEAVY!", color: "#8899aa" },
      squash:  { bg: "rgba(80,200,40,0.35)", text: "ðŸª° SQUASHED!", color: "#88ff44" },
      boost:   { bg: "rgba(0,255,200,0.15)", text: "âš¡ BOOST!", color: "#00ffcc" },
      ludicrous: { bg: "rgba(255,0,255,0.25)", text: "ðŸ”‹ LUDICROUS MODE!", color: "#ff00ff" },
      shielded:{ bg: "rgba(80,180,255,0.1)", text: "ðŸ›¡ï¸ FORCEFIELD ON", color: "#55bbff" },
      mirror:  { bg: "rgba(145,214,255,0.14)", text: "ðŸªž MIRROR REALM", color: "#a6dfff" },
      pirateleportation: { bg: "rgba(155,89,182,0.25)", text: "ðŸ´â€â˜ ï¸ PIRATED!", color: "#bb77dd" },
    };

    const style = EFFECT_STYLES[effectType];
    if (!style) return;

    const overlay = document.createElement("div");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      background: style.bg,
      pointerEvents: "none",
      zIndex: "10001",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      transition: `opacity ${Math.min(duration, 500)}ms`,
    });

    const label = document.createElement("div");
    Object.assign(label.style, {
      fontSize: "42px",
      fontWeight: "bold",
      fontFamily: "monospace",
      color: style.color,
      textShadow: "0 0 20px rgba(0,0,0,0.8)",
      animation: "pulse 0.5s ease-in-out infinite alternate",
    });
    label.textContent = style.text;
    overlay.appendChild(label);

    if (effectType === 'mirror') {
      for (let index = 0; index < 6; index += 1) {
        const shard = document.createElement('div');
        Object.assign(shard.style, {
          position: 'fixed',
          width: `${42 + index * 10}px`,
          height: '3px',
          top: `${18 + index * 12}%`,
          left: `${12 + index * 11}%`,
          background: 'linear-gradient(90deg, rgba(145,214,255,0), rgba(190,245,255,0.8), rgba(145,214,255,0))',
          transform: `rotate(${index % 2 === 0 ? 18 : -18}deg)`,
          opacity: '0.7',
          filter: 'blur(1px)',
        });
        overlay.appendChild(shard);
      }
    }
    // Add pulse animation if not already present
    if (!document.getElementById("effect-pulse-style")) {
      const styleEl = document.createElement("style");
      styleEl.id = "effect-pulse-style";
      styleEl.textContent = `@keyframes pulse { from { transform: scale(1); } to { transform: scale(1.1); } }`;
      document.head.appendChild(styleEl);
    }

    document.body.appendChild(overlay);
    this.effectOverlayEl = overlay;

    setTimeout(() => {
      if (this.effectOverlayEl === overlay) {
        overlay.style.opacity = "0";
        setTimeout(() => {
          overlay.remove();
          if (this.effectOverlayEl === overlay) {
            this.effectOverlayEl = null;
            this.activeEffect = "";
          }
        }, 500);
      }
    }, duration);
  }

  showArenaEffectOverlay(effectType, duration) {
    this._clearArenaEffectOverlay();

    const statusStyles = {
      arena_fog: {
        title: "Fog Bank Rolling In",
        subtitle: "Visibility softened across the arena floor.",
        chip: "Arena",
        icon: "â—Œ",
        accent: "#e6f1ff",
        surface: "rgba(10, 16, 24, 0.8)",
        border: "rgba(230, 241, 255, 0.16)",
        wash: "radial-gradient(circle at 50% 0%, rgba(230,241,255,0.08), rgba(10,14,20,0.04) 28%, rgba(10,14,20,0.22) 100%)",
        edge: "rgba(230, 241, 255, 0.12)",
      },
      arena_rain: {
        title: "Rain Slick Active",
        subtitle: "Traction is reduced on the racing line.",
        chip: "Arena",
        icon: "âˆ•",
        accent: "#a9d0ff",
        surface: "rgba(8, 18, 30, 0.8)",
        border: "rgba(169, 208, 255, 0.18)",
        wash: "linear-gradient(180deg, rgba(70,120,255,0.08), rgba(10,18,36,0.18))",
        edge: "rgba(169, 208, 255, 0.14)",
      },
    };
    const statusStyle = statusStyles[effectType] || statusStyles.arena_fog;
    if (this._allowBattleHudPolish()) {
      showGUIArenaMood({
        title: statusStyle.title,
        subtitle: statusStyle.subtitle,
        chip: statusStyle.chip,
        icon: statusStyle.icon,
        accent: statusStyle.accent,
        duration,
      });
    }

    this._arenaWeatherType = effectType || 'arena_fog';
    this._applyArenaWeatherToScene(this._arenaWeatherType);
    if (this._arenaEffectOverlayTimer) {
      window.clearTimeout(this._arenaEffectOverlayTimer);
      this._arenaEffectOverlayTimer = null;
    }
    if (!this._allowArenaAmbience()) {
      this._arenaEffectOverlayTimer = window.setTimeout(() => {
        if (this._arenaWeatherType === effectType) this._clearArenaEffectOverlay();
      }, Math.max(1200, Number(duration || 0) + 250));
      return;
    }
    const overlay = document.createElement("div");
    this._arenaEffectOverlayEl = overlay;

    const styles = {
      arena_fog: {
        background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.05), rgba(10,14,20,0.36))",
        text: "FOG BANK",
        color: "#e6f1ff",
      },
      arena_rain: {
        background: "linear-gradient(180deg, rgba(70,120,255,0.12), rgba(10,18,36,0.18))",
        text: "RAIN SLICK",
        color: "#a9d0ff",
      },
    };
    const style = styles[effectType] || styles.arena_fog;

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "70",
      background: style.background,
      opacity: "0.72",
      transition: "opacity 0.45s ease",
    });

    const label = document.createElement("div");
    Object.assign(label.style, {
      position: "fixed",
      top: "92px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "8px 12px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.14)",
      background: "rgba(10,12,18,0.56)",
      color: style.color,
      fontFamily: '"Exo 2", sans-serif',
      fontSize: "11px",
      fontWeight: "800",
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
    });
    label.textContent = style.text;
    overlay.appendChild(label);

    if (!document.getElementById('anomaly-overlay-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'anomaly-overlay-style';
      styleEl.textContent = `
        @keyframes anomalyFogDrift { from { transform: translate3d(0,0,0) scale(1); } to { transform: translate3d(40px,-16px,0) scale(1.12); } }
        @keyframes anomalyRainFall { from { transform: translate3d(0,-14px,0); opacity: 0; } 15% { opacity: 0.65; } to { transform: translate3d(-18px,100vh,0); opacity: 0; } }
      `;
      document.head.appendChild(styleEl);
    }

    if (effectType === 'arena_fog') {
      for (let index = 0; index < 8; index += 1) {
        const puff = document.createElement('div');
        Object.assign(puff.style, {
          position: 'fixed',
          width: `${140 + index * 18}px`,
          height: `${72 + index * 10}px`,
          left: `${(index * 13) % 92}%`,
          top: `${12 + (index % 4) * 18}%`,
          borderRadius: '999px',
          background: 'radial-gradient(circle, rgba(220,236,255,0.22), rgba(220,236,255,0))',
          filter: 'blur(14px)',
          animation: `anomalyFogDrift ${7 + index * 0.8}s ease-in-out infinite alternate`,
          opacity: `${0.22 + (index % 3) * 0.08}`,
        });
        overlay.appendChild(puff);
      }
    }

    if (effectType === 'arena_rain') {
      for (let index = 0; index < 28; index += 1) {
        const streak = document.createElement('div');
        Object.assign(streak.style, {
          position: 'fixed',
          width: '2px',
          height: `${18 + (index % 4) * 8}px`,
          left: `${(index * 3.5) % 100}%`,
          top: '-20px',
          background: 'linear-gradient(180deg, rgba(200,225,255,0), rgba(180,215,255,0.72), rgba(200,225,255,0))',
          boxShadow: '0 0 8px rgba(129,186,255,0.28)',
          transform: 'rotate(14deg)',
          animation: `anomalyRainFall ${0.8 + (index % 5) * 0.16}s linear infinite`,
          animationDelay: `${index * 0.06}s`,
        });
        overlay.appendChild(streak);
      }
    }
    document.body.appendChild(overlay);

    this._arenaEffectOverlayTimer = window.setTimeout(() => {
      if (this._arenaEffectOverlayEl === overlay) this._clearArenaEffectOverlay();
    }, Math.max(1200, Number(duration || 0) + 250));
  }

  _clearArenaEffectOverlay() {
    if (this._arenaEffectOverlayTimer) {
      window.clearTimeout(this._arenaEffectOverlayTimer);
      this._arenaEffectOverlayTimer = null;
    }
    this._arenaWeatherType = "";
    this._restoreArenaWeatherScene();
    clearGUIArenaMood();
    if (this._arenaEffectOverlayEl) {
      this._arenaEffectOverlayEl.classList.remove('is-visible');
      this._arenaEffectOverlayEl.remove();
      this._arenaEffectOverlayEl = null;
    }
  }

  dispose() {
    stopEngineSound();
    stopBGM();
    disposeAudio();
    stopAdaptiveMonitor();
    this._cleanupDebugScenario();
    disposeBattleVFX();
    disposeBattleAssets();
    disposeWeaponFXEnhance();
    disposeParticles();
    this._stopNetworkSync();

    this._teardownInputLoop();

    disposeControlsOverlay();

    // (21.39) Clean up perf overlay
    if (this._perfKeyHandler) window.removeEventListener('keydown', this._perfKeyHandler);
    if (this._perfOverlay) { this._perfOverlay.remove(); this._perfOverlay = null; }

    if (this._autoStartTimer) {
      clearTimeout(this._autoStartTimer);
      this._autoStartTimer = null;
    }
    if (this._effectOverlayTimer) {
      clearTimeout(this._effectOverlayTimer);
      this._effectOverlayTimer = null;
    }
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
    clearGUIStatusLane();
    if (this._stateCatchupTimer) {
      clearInterval(this._stateCatchupTimer);
      this._stateCatchupTimer = null;
    }
    if (this._timeSyncInterval) {
      clearInterval(this._timeSyncInterval);
      this._timeSyncInterval = null;
    }
    if (this._metricsPollInterval) {
      clearInterval(this._metricsPollInterval);
      this._metricsPollInterval = null;
    }
    this._clearSceneBeforeRender("_remoteInterpolationBeforeRender");
    if (this._onResize) {
      window.removeEventListener("resize", this._onResize);
      this._onResize = null;
    }

    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    // Dispose physics aggregates before meshes
    this.entityAggregates.forEach((agg) => agg.dispose());
    this.entityAggregates.clear();
    this.remoteKartAggregates.forEach((agg) => agg.dispose());
    this.remoteKartAggregates.clear();
    this._remoteTargets.clear();
    this._projectileTargets.clear();
    this._queuedProjectileFires.length = 0;
    this._queuedProjectileHits.length = 0;
    this._queuedKartCrashes.length = 0;
    this.pendingInputs.length = 0;
    this._suppressedEntityIds.clear();
    this._remoteWheelMeshes.clear();
    this._pendingPickupBoxes.clear();

    if (this._localKartVFX) {
      this._localKartVFX.dispose();
      this._localKartVFX = null;
    }
    this._remoteKartVFXs.forEach((remoteVFX) => {
      try { remoteVFX.dispose(); } catch (_) {}
    });
    this._remoteKartVFXs.clear();
    this._remoteKartEntities.forEach((remoteEntity) => {
      try { remoteEntity.dispose(); } catch (_) {}
    });
    this._remoteKartEntities.clear();
    if (this._shieldBubble) {
      this._disposeShieldParticleField(this._shieldBubble);
      this._shieldBubble = null;
      this._shieldBubbleMat = null;
    }
    if (this._remoteShieldBubbles) {
      this._remoteShieldBubbles.forEach((bubble) => {
        this._disposeShieldParticleField(bubble);
      });
      this._remoteShieldBubbles.clear();
    }

    this.remoteMeshes.forEach((mesh) => mesh.dispose());
    this.remoteMeshes.clear();
    this.loadingPromises.clear();
    this.entityMeshes.forEach((mesh) => {
      this._disposeProjectileVisual(mesh);
      mesh.dispose();
    });
    this.entityMeshes.clear();

    disposeBattleGUIHud();
    if (this._syncDebugPanelEl) {
      this._syncDebugPanelEl.remove();
      this._syncDebugPanelEl = null;
    }
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
    clearGUIStatusLane();
    this._clearArenaEffectOverlay();
    if (this._countdownEl) {
      this._countdownEl.remove();
      this._countdownEl = null;
    }
    if (this._lapHudEl) {
      this._lapHudEl.remove();
      this._lapHudEl = null;
    }
    // Dispose GLO underglow resources
    disposeGloUnderglow(this._gloKit);
    this._gloKit = null;
    for (const kit of this._remoteGloKits.values()) disposeGloUnderglow(kit);
    this._remoteGloKits.clear();
    this._wheelMeshes  = [];
    document.getElementById('_glo-match-end')?.remove();
    if (this._shieldParticleTexture) {
      try { this._shieldParticleTexture.dispose(); } catch (_) {}
      this._shieldParticleTexture = null;
    }
    if (typeof window !== 'undefined' && window.__gloDebug) {
      delete window.__gloDebug.runBattleDebugScenario;
      delete window.__gloDebug.triggerMushroomCloud;
      delete window.__gloDebug.clearBattleDebugScenario;
    }

    this.havokPlugin = null;
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }
}
