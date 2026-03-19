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
} from "@babylonjs/core";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import {
  createGloUnderglow, updateGloUnderglow, setGloVisible, disposeGloUnderglow,
} from './glo-underglow.js';
import "@babylonjs/loaders/glTF";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import HavokPhysics from "@babylonjs/havok";
import { resolveTrackAsset, resolveArenaAsset, resolveKartAsset } from "../content-registry.js";
import { FILTER, LAYER, applyFilterToAggregate } from './collision-layers.js';
import { createMinimap, updateMinimapPlayers, createBattleMinimap, updateBattleMinimapPlayers } from '../minimap.js';
import { initParticles, updateParticles, disposeParticles, emitWeaponExplosion, emitShieldBreak, createProjectileTrail, disposeProjectileTrail, resetParticleBudget, emitItemBoxShatter } from '../babylon-particles.js';
import { initGamepad, pollGamepad } from '../gamepad-input.js';
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
  playBattleMusic, setBattleMusicIntensity, setBattleMusicDead,
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
} from '../battle-gui-hud.js';
import * as PrematchLobby from './prematch-lobby.js';
import { generateMapDefinition } from '../map-definition-generator.js';
import {
  loadBattleAssets, disposeBattleAssets, playWeaponFireSound, playWeaponHitSound,
  playBattleSound, areBattleAssetsLoaded,
} from '../battle/battle-assets.js';
import {
  initBattleVFX, disposeBattleVFX, emitMuzzleFlash, emitBattleExplosion,
  emitFrostImpact, emitLightningStrike, emitBlackHoleVortex, emitKillCelebration,
  emitFireBurst, emitShockwaveRing, shakeCamera, showHitMarkerVFX,
  showMultiKillBanner, flashDamageVignette, emitWeaponImpactVFX,
} from '../battle/battle-vfx.js';
import { createWeaponModel, createItemBoxModel } from '../battle/weapon-models.js';

const HAVOK_WASM_PUBLIC_PATH = `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`;
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

const WEAPON_DISPLAY = {
  missile: { icon: "🚀", hue: "#ff7448", accent: "#ffd1b8", category: "Projectile" },
  bowling_ball: { icon: "🎳", hue: "#9aa3b7", accent: "#eef3ff", category: "Projectile" },
  shield: { icon: "🛡️", hue: "#55bbff", accent: "#c7efff", category: "Defence" },
  cake: { icon: "🎂", hue: "#ffb347", accent: "#fff0c8", category: "Projectile" },
  plunger: { icon: "🪠", hue: "#f85b44", accent: "#ffd7cc", category: "Projectile" },
  nitro: { icon: "💥", hue: "#12d59c", accent: "#d8fff2", category: "Projectile" },
  bubblegum: { icon: "🫧", hue: "#ff73cb", accent: "#ffe2f5", category: "Trap" },
  banana: { icon: "🍌", hue: "#f6d53f", accent: "#fff6ba", category: "Trap" },
  swatter: { icon: "🪰", hue: "#ff8f6b", accent: "#ffe0d6", category: "Melee" },
  parachute: { icon: "🪂", hue: "#8fb6ff", accent: "#e2ecff", category: "Debuff" },
  anchor: { icon: "⚓", hue: "#83a7c8", accent: "#e0eef9", category: "Debuff" },
  ludicrous_mode: { icon: "🔋", hue: "#ff00ff", accent: "#ff99ff", category: "Buff" },
  pirateleportation: { icon: "🏴‍☠️", hue: "#9b59b6", accent: "#e8d5f5", category: "Utility" },
  mirror_realm: { icon: "🪞", hue: "#91d6ff", accent: "#e8f8ff", category: "Defence" },
  phase_shift: { icon: "👻", hue: "#9ef2d0", accent: "#ebfff8", category: "Defence" },
  memory_leak: { icon: "🧠", hue: "#ff9ca8", accent: "#ffe6ea", category: "Utility" },
  weather_dominion: { icon: "⛈️", hue: "#7ab4ff", accent: "#e2f0ff", category: "Utility" },
  fireball: { icon: "🔥", hue: "#ff7a30", accent: "#ffd6bf", category: "Elemental" },
  toxic_spread: { icon: "☣️", hue: "#6fd34a", accent: "#e6ffd9", category: "Elemental" },
  ice_lance: { icon: "🧊", hue: "#74d3ff", accent: "#e6f8ff", category: "Elemental" },
  tornado: { icon: "🌪️", hue: "#93e0c2", accent: "#e8fff4", category: "Elemental" },
  super_nova: { icon: "☀️", hue: "#ffb347", accent: "#fff1ce", category: "Elemental" },
  rock_barrage: { icon: "🪨", hue: "#b08b67", accent: "#f2e6d9", category: "Elemental" },
  lightning_bolt: { icon: "⚡", hue: "#c6ccff", accent: "#f0f2ff", category: "Elemental" },
  wind_slash: { icon: "💨", hue: "#9de7c8", accent: "#eefff7", category: "Elemental" },
  toxic_cloud: { icon: "🧪", hue: "#5bb33d", accent: "#dbffd0", category: "Elemental" },
  glow_thrower: { icon: "🔥", hue: "#ff0080", accent: "#ff99cc", category: "Stream" },
  glo_burst: { icon: "💠", hue: "#00e5ff", accent: "#b3f5ff", category: "Stream" },
};

const PROJECTILE_MODEL_ALIASES = {
  bowling_ball: 'bowling',
  missile: 'guided_missile',
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

export class ColyseusBabylonClient {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "ws://localhost:2567";
    this.roomName = options.roomName || "race_room";
    this.playerName = options.playerName || "Player";
    this.maxPlayers = options.maxPlayers || 12;
    this.gameType = options.gameType || "deathmatch";

    this.client = new Client(this.endpoint);
    this.room = null;

    this.engine = null;
    this.scene = null;
    this.localMesh = null;
    this.remoteMeshes = new Map();
    this.entityMeshes = new Map();
    this.loadingPromises = new Map();
    this.entityAggregates = new Map();      // entityId → PhysicsAggregate
    this.remoteKartAggregates = new Map();  // playerId → PhysicsAggregate
    this._remoteTargets = new Map();           // playerId → { pos: Vector3, rot: Quaternion }
    this._remoteWheelMeshes = new Map();       // playerId → mesh[] (wheel child meshes)
    this._projectileTargets = new Map();       // entityId → { pos, vel, lastUpdate, subType }
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

    // Weapon state — dual weapon system + reserve
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
    this._missileLockTargetId = null;
    this._missileLockProgress = 0;
    this._missileLockScreenX = null;
    this._missileLockScreenY = null;
    this._lastRockImpactTime = 0;
    this._lastRockImpactPos = null;

    // Active effect state
    this.activeEffect = "";      // current effect type on local player
    this.effectOverlayEl = null;  // DOM overlay for blind/status effects
    this._arenaEffectOverlayEl = null;

    // Keyboard input state
    this._keys = {};
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._debugWeaponCycleIndex = 0;

    // Lap / race progress
    this._lapHudEl = null;
    this._lapCount = 0;
    this._totalLaps = 3;
    this._raceFinished = false;
    this._lapCooldownUntil = 0;   // timestamp — ignore finish-line triggers before this

    // ── Mini-turbo drift state ──────────────────────────────────────────────
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

    // ── Automated-test debug bus ─────────────────────────────────────────────
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
      };
    }

    // GLO underglow system (shader decal + trail)
    this._gloKit = null;           // local player's GLO kit
    this._remoteGloKits = new Map(); // sessionId → GLO kit for remote players

    // Kart pre-match state
    this._kartReady       = false;   // true only after matchLive fires
    this._matchLiveHandled = false;
    this._autoStartTimer = null;
    this._stateCatchupTimer = null;
    this._clientReadySent = false;
    this._countdownStartAt = 0;
    this._countdownAudioTimer = null;
    this._countdownVisualTimer = null;
    this._lowLevelTraceInstalled = false;
    this._wheelMeshes     = [];      // child meshes whose name contains "wheel" — rotated by speed
    this._targetCamRadius = 12;      // camera's ideal follow radius (may shorten for wall-clip avoidance)
    this._arenaKartScale  = null;    // per-arena kart scale override from content-registry

    // ── Camera view modes (C key cycles) ──────────────────────────────
    // 0 = default, 1 = close/low chase
    this._cameraMode = 0;
    this._cameraModes = [
      { name: 'Chase',  radius: 12, height: 6,   fovBase: 75, accel: 0.035, maxSpeed: 12 },
      { name: 'Close',  radius: 6,  height: 2.5, fovBase: 80, accel: 0.06,  maxSpeed: 18 },
    ];
  }

  async initBabylon(canvas) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true; // Phase 1: STK uses right-handed

    // GLO animation — no longer needs GlowLayer (shaders handle glow internally)
    this._gloTime = 0;

    // Setup FollowCamera
    this.camera = new FollowCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.radius = 12;
    this.camera.heightOffset = 6;        // slightly higher for better terrain clearance
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.035;
    this.camera.maxCameraSpeed = 12;
    this.camera.minZ = 0.1;             // prevent near-clip artifacts inside tunnels/walls
    this.camera.fov = this._baseFOV;    // Phase 21: dynamic FOV starts at base
    this._targetCamRadius = 12;
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

    // ── Smooth interpolation for remote karts + GLO animation ──
    this.scene.registerBeforeRender(() => {
      resetParticleBudget(); // (21.39) reset per-frame particle emission budget
      const dtSeconds = this.engine.getDeltaTime() / 1000;
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
        // ── Wheel spin for remote karts ──
        const wheels = this._remoteWheelMeshes.get(id);
        if (wheels) {
          const rotAmt = preLerpDist * lerpAlpha * 2.5;
          for (const w of wheels) w.rotation.x -= rotAmt;
        }
        // ── Steering visuals for remote karts (synced steer input) ──
        const remoteEntity = this._remoteKartEntities.get(id);
        if (remoteEntity) {
          const speed = target.vel ? Math.sqrt(target.vel.x ** 2 + target.vel.z ** 2) : 0;
          remoteEntity.applySteerVisuals(target.steer || 0, speed);
        }
      }

      // Animate GLO underglow each frame (local + remote)
      const dt = dtSeconds;
      if (this._gloKit) updateGloUnderglow(this._gloKit, dt);
      for (const kit of this._remoteGloKits.values()) {
        updateGloUnderglow(kit, dt);
      }

      // ── Smooth projectile interpolation — velocity extrapolation + facing ──
      for (const [id, pt] of this._projectileTargets.entries()) {
        const mesh = this.entityMeshes.get(id);
        if (!mesh || !mesh.isEnabled()) continue;

        const isTrap = pt.subType === 'bubblegum' || pt.subType === 'banana';
        if (isTrap) continue; // traps don't move

        // Extrapolate position using velocity
        mesh.position.x += pt.vel.x * dtSeconds;
        mesh.position.y += pt.vel.y * dtSeconds;
        mesh.position.z += pt.vel.z * dtSeconds;

        // Smooth correction toward last-known server position
        const correctionAlpha = Math.min(1, dtSeconds * 8);
        const timeSinceUpdate = (performance.now() - pt.lastUpdate) / 1000;
        // Server-extrapolated position (where server thinks it is now)
        const serverX = pt.pos.x + pt.vel.x * timeSinceUpdate;
        const serverY = Math.max(0.35, pt.pos.y + pt.vel.y * timeSinceUpdate);
        const serverZ = pt.pos.z + pt.vel.z * timeSinceUpdate;
        mesh.position.x += (serverX - mesh.position.x) * correctionAlpha;
        mesh.position.y += (serverY - mesh.position.y) * correctionAlpha;
        mesh.position.z += (serverZ - mesh.position.z) * correctionAlpha;

        // Clamp Y to arena floor — prevent projectiles from visually sinking below ground
        if (mesh.position.y < 0.35) mesh.position.y = 0.35;

        // Face direction of travel (Y-axis rotation from XZ velocity)
        const speed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        if (speed > 0.5) {
          const targetYaw = Math.atan2(pt.vel.x, pt.vel.z);
          mesh.rotation.y = targetYaw;
          // Pitch for arced projectiles
          if (Math.abs(pt.vel.y) > 0.5) {
            mesh.rotation.x = -Math.atan2(pt.vel.y, speed);
          }
        }

        // Per-weapon flight animations
        this._animateProjectileFlight(mesh, pt, dtSeconds);

        // Sync physics body if present
        const agg = this.entityAggregates.get(id);
        if (agg?.body) {
          try { agg.body.setTargetTransform(mesh.position, mesh.rotationQuaternion || Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)); } catch (_) {}
        }
      }

      // Update minimap (builds opponents map from remoteMeshes)
      if (this.localMesh) {
        if (this._joinOptions?.gameMode === 'battle') {
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

    // (21.39) Lightweight debug FPS overlay — toggle with F3
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
        this._perfOverlay.textContent = `FPS: ${fps} | Draw: ${drawCalls} | Mesh: ${activeMeshes} | Ptcl: ${particles}`;
      }
    });
    window.addEventListener("resize", () => this.engine?.resize());
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
      console.warn("[realtime] No physics engine — skipping track physics");
      this._createFallbackGround();
      return;
    }

    // Collect all geometry-bearing meshes (broader filter for GLTF imports).
    // GLTF __root__ is a TransformNode with no geometry — skip it.
    // InstancedMesh shares geometry via sourceMesh — include those too.
    // Do NOT filter by isVisible — STK exports set isVisible=false on some geometry children.
    const geometryMeshes = importResult.meshes.filter((m) => {
      if (!m.getTotalVertices) return false;
      if (m.getTotalVertices() > 0) return true;
      if (m.sourceMesh && m.sourceMesh.getTotalVertices && m.sourceMesh.getTotalVertices() > 0) return true;
      return false;
    });

    console.log(`[realtime] Geometry meshes found: ${geometryMeshes.length} / ${importResult.meshes.length} total`);

    if (geometryMeshes.length === 0) {
      console.warn("[realtime] Track has zero geometry meshes – using fallback ground");
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
        // Non-fatal — some decorative meshes may fail
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

  // ── Per-arena environment: skybox color, fog, lighting tuning ──────
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

    console.log(`[realtime] Arena environment set for '${arenaId}'`);
  }

  _createFallbackGround() {
    console.warn("[realtime] Creating debug arena (100×100, flat floor + 4 walls)");
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

    // ── Materials ──
    const matGround = new StandardMaterial("dbg-ground-mat", this.scene);
    // Procedural checkerboard grid texture for spatial reference & VFX visibility
    const GRID_RES = 1024;
    const CELLS = 20;           // 20×20 = 5m per cell at 100×100 arena
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

    // ── Ground slab (thick box so Havok has a solid collision surface) ──
    const GROUND_THICKNESS = 2;
    const ground = MeshBuilder.CreateBox("dbg-ground", { width: SIZE, height: GROUND_THICKNESS, depth: SIZE }, this.scene);
    ground.position.y = -GROUND_THICKNESS / 2; // top surface at y=0
    ground.material = matGround;
    ground.receiveShadows = true;
    if (hasPhysics) {
      const gAgg = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.02 }, this.scene);
      applyFilterToAggregate(gAgg, FILTER.TRACK);
    }

    // ── 4 Walls (use TRACK filter for solid collision, not BOUNDARY which is for triggers) ──
    _box("dbg-wall-N", SIZE + WALL_T * 2, WALL_H, WALL_T, 0, WALL_H / 2, -(HALF + WALL_T / 2), matWall, FILTER.TRACK);
    _box("dbg-wall-S", SIZE + WALL_T * 2, WALL_H, WALL_T, 0, WALL_H / 2,  (HALF + WALL_T / 2), matWall, FILTER.TRACK);
    _box("dbg-wall-E", WALL_T, WALL_H, SIZE + WALL_T * 2,  (HALF + WALL_T / 2), WALL_H / 2, 0, matWall, FILTER.TRACK);
    _box("dbg-wall-W", WALL_T, WALL_H, SIZE + WALL_T * 2, -(HALF + WALL_T / 2), WALL_H / 2, 0, matWall, FILTER.TRACK);

    // ── Corner markers for orientation (small colored pillars) ──
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

    if (!hasPhysics) console.warn('[realtime] Physics not available — arena created without collision');

    // Store arena half-size for game-level bounds enforcement
    this._arenaBoundsHalf = HALF;
  }

  async loadSceneAssets(options) {
    let trackInfo;
    let customTrackParsed = null;

    // Check for custom track data from Track Builder
    if (options.customTrackData) {
      try {
        customTrackParsed = typeof options.customTrackData === 'string'
          ? JSON.parse(options.customTrackData) : options.customTrackData;
      } catch (_) { /* ignore parse errors */ }
    }

    if (options.gameMode === "battle") {
      trackInfo = resolveArenaAsset(options.trackId);
    } else {
      trackInfo = resolveTrackAsset(options.trackId);
    }

    // ── DEBUG: skip GLB loading, use procedural debug arena ──
    const USE_DEBUG_ARENA = true;
    if (USE_DEBUG_ARENA) {
      console.log('[realtime] DEBUG ARENA mode — skipping GLB load');
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
        this._createFallbackGround();
        const { generateSegmentGeometry, SEGMENT_TYPES } = await import('../../modules/track-editor.js');
        for (const seg of (customTrackParsed.segments || [])) {
          const typeDef = SEGMENT_TYPES.find(t => t.id === seg.type);
          if (!typeDef) continue;
          const geom = generateSegmentGeometry(seg.type, seg.position, seg.rotation || 0);
          const mesh = MeshBuilder.CreateBox('cseg', { width: geom.width, height: geom.height, depth: geom.depth }, this.scene);
          mesh.position = new Vector3(geom.center.x, geom.center.y, geom.center.z);
          if (seg.rotation) mesh.rotation.y = seg.rotation;
          const mat = new StandardMaterial('cseg_mat', this.scene);
          mat.diffuseColor = new Color3(0.3, 0.5, 0.9);
          mesh.material = mat;
          const agg = new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, this.scene);
          applyFilterToAggregate(agg, FILTER.TRACK);
        }
      } else {
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
          console.warn("[realtime] No track/arena path found — using fallback ground");
          this._createFallbackGround();
        }
      }
    } catch (e) {
      console.error("[realtime] Map loading failed:", e);
      this._createFallbackGround();
    }
    } // end else (non-debug arena path)

    if (!USE_DEBUG_ARENA) {
    // ── Spawn positions ──
    // Priority: custom track data > track-data.js registry > auto-generated from mesh
    const customSpawns = customTrackParsed?.startPositions;
    let spawnPositions;
      
      function normalizeSpawn(sp) {
        if (!sp) return { x: 0, y: 5, z: 0 };
        if (sp.position && Array.isArray(sp.position)) return { x: sp.position[0], y: sp.position[1], z: sp.position[2], heading: sp.heading };
        if (sp.position && typeof sp.position.x === 'number') return { x: sp.position.x, y: sp.position.y || 0, z: sp.position.z, heading: sp.heading };
        if (Array.isArray(sp)) return { x: sp[0], y: sp[1], z: sp[2] };
        return { x: sp.x || 0, y: sp.y || 0, z: sp.z || 0 };
      }

      if (customSpawns?.length) {
        spawnPositions = customSpawns.map(normalizeSpawn);
      } else if (trackInfo.startPositions?.length > 1) {
        spawnPositions = trackInfo.startPositions.map(normalizeSpawn);
      } else if (this._autoMapDef?.spawnPositions?.length) {
        spawnPositions = this._autoMapDef.spawnPositions.map(normalizeSpawn);
        console.log(`[realtime] Using ${spawnPositions.length} auto-generated spawn points`);
      } else {
        spawnPositions = [ normalizeSpawn(trackInfo.start || { x: 0, y: 5, z: 0 }) ];
        }

      // ── Kill-plane boundary below the track ──
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

    // Per-arena kart scale override (e.g. blockfort needs much smaller karts)
    this._arenaKartScale = trackInfo.kartScale || null;
    } // end !USE_DEBUG_ARENA spawn/kill-plane section

    const kartInfo = resolveKartAsset(options.kartId);
    try {
      console.log(`[realtime] Loading local player kart (id: ${kartInfo.id}, color: ${options.playerColor})...`);

      // ── KartEntity: isolated materials, auto-detected wheels, attach points ──
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

      // ── KartVFX: all effects parented to attachment points ──
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

        // ── Raycast vehicle: force-based suspension on the physics body ──
        if (this.localKartAggregate?.body) {
          const wheelOffsets = localKartEntity.getWheelRayOffsets?.() || undefined;
          this._raycastVehicle = createKartRaycastVehicle(
            this.localKartAggregate.body,
            this.havokPlugin,
            { wheelOffsets, rayCollideWith: LAYER.TRACK },
          );
        }
      }

      // ── Pre-match: hide kart & freeze physics until matchLive fires ──
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
    const joinOptions = {
        playerName: options.playerName || this.playerName,
        maxPlayers: options.maxPlayers || this.maxPlayers,
        gameMode: options.gameMode || "race",
        gameType: options.gameType || this.gameType,
        trackId: options.trackId || "test_box",
        scoreLimit: options.scoreLimit || 5,
        partyCode: options.partyCode || "",
        kartId: options.kartId || "tux",
        playerColor: options.playerColor || "red",
        gloEffect: options.gloEffect || "solid",
        gloColor: options.gloColor || "#ff0080",
        gloColor2: options.gloColor2 || "#00e5ff",
    };

    // Load visual assets before connecting
    console.log('[realtime] connect: loading scene assets...');
    await this.loadSceneAssets(joinOptions);
    console.log('[realtime] connect: scene assets loaded OK');

    // Per-arena environment (sky, fog, lighting)
    this._setupArenaEnvironment(joinOptions.trackId || (true ? 'debug_arena' : 'glo_arena'));

    // Init particle system for drift sparks / boost flames (Task 3.3.4)
    initParticles(this.scene);

    // Init battle VFX + preload wizard-masters assets for battle mode
    if (joinOptions.gameMode === 'battle') {
      initBattleVFX(this.scene);
      loadBattleAssets(this.scene).catch(e => console.warn('[battle-assets] preload error:', e));
      createBattleGUIHud(this.scene);
      createScoreDisplay();
      createLockReticle();
    }

    // Init minimap
    if (joinOptions.gameMode !== "battle") {
      try { createMinimap(joinOptions.trackId || 'test_box', this.scene); } catch (_) {}
    } else if (this._autoMapDef?.aabb) {
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

    // ── Show prematch lobby (hides loading screen) ──
    {
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

    // ── Havok trigger observable — physics-based item pickup + projectile/trap hits ──
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
        this.reserveAmmo = Number(msg.ammo || 1);
        this._localCombatState = {
          ...this._localCombatState,
          weapon3: msg.weapon || "",
          ammo3: Number(msg.ammo || 1),
        };
      } else {
        // Item went to secondary (active) slot
        this.currentWeapon2 = msg.weapon || "";
        this._localCombatState = {
          ...this._localCombatState,
          weapon2: msg.weapon || "",
          ammo2: Number(msg.ammo || 1),
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
      playSFX('pickup');
      window.dispatchEvent(new CustomEvent("weaponEquipped", { detail: msg }));
      // Quick green screen flash — confirms the pickup without any extra assets
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
      console.log("[colyseus] Projectile fired:", msg.subType, "by", msg.ownerId);
      playWeaponFireSFX(msg.subType);
      if (areBattleAssetsLoaded()) playWeaponFireSound(msg.subType);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastWeaponFired = msg.subType;

      // Muzzle flash VFX at firer position
      const firerMesh = (msg.ownerId === this.room?.sessionId)
        ? this.localMesh
        : this.remoteMeshes.get(msg.ownerId);
      if (firerMesh) emitMuzzleFlash(firerMesh.position, msg.subType);

      // Spread projectiles are now replicated individually by the server.
    });

    this.room.onMessage("projectileHit", (msg) => {
      console.log("[colyseus] Projectile hit:", msg.victimId, "for", msg.damage, "dmg", msg.subType);
      playWeaponHitSFX(msg.subType);
      playWeaponImpactSynth(msg.subType, msg.damage || 30);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastHitVictimId = msg.victimId;

      // Emit explosion VFX at victim position (enhanced + legacy)
      const victimMesh = (msg.victimId === this.room?.sessionId)
        ? this.localMesh
        : this.remoteMeshes.get(msg.victimId);
      const impactPosition = Number.isFinite(msg.hitX) && Number.isFinite(msg.hitY) && Number.isFinite(msg.hitZ)
        ? new Vector3(msg.hitX, msg.hitY, msg.hitZ)
        : victimMesh?.position;
      if (msg.subType === 'rock_barrage' && impactPosition) {
        this._lastRockImpactTime = performance.now();
        this._lastRockImpactPos = impactPosition.clone ? impactPosition.clone() : new Vector3(impactPosition.x, impactPosition.y, impactPosition.z);
      }
      if (victimMesh) {
        const pos = impactPosition || victimMesh.position;
        emitWeaponExplosion(pos, msg.damage || 30);
        emitBattleExplosion(pos, msg.subType);
        emitWeaponImpactVFX(pos, msg.subType);
        // Use KartEntity flash (cloned materials — safe per-instance)
        if (msg.victimId === this.room?.sessionId && this._localKartEntity) {
          this._localKartEntity.flashWhite(150);
          this._localKartVFX?.emitHitBurst();
        } else {
          const remoteEntity = this._remoteKartEntities.get(msg.victimId);
          if (remoteEntity) {
            remoteEntity.flashWhite(150);
            this._remoteKartVFXs.get(msg.victimId)?.emitHitBurst();
          }
        }
      }
      if (areBattleAssetsLoaded()) playWeaponHitSound(msg.subType);

      // If we got hit, flash the screen red briefly + camera shake
      if (this.room && msg.victimId === this.room.sessionId) {
        this.flashDamage();
        flashDamageVignette();
        playSFX('crash');
        if (this.localMesh) {
          emitWeaponExplosion(this.localMesh.position, msg.damage || 30);
          emitBattleExplosion(this.localMesh.position, msg.subType);
        }
        // Camera shake scaled by damage
        const shakeIntensity = Math.min(1.0, (msg.damage || 30) / 50);
        shakeCamera(this.camera, shakeIntensity, 400);
        // (22.5) Shockwave post-process on heavy hits
        this._triggerShockwave(msg.damage || 30);
        // Track health from server
        if (typeof msg.remainingHealth === 'number') {
          this._localHealth = msg.remainingHealth;
          updateGUIHealthBar(this._localHealth);
          flashGUIHealthDamage();
          updateLowHealthWarning(this._localHealth);
        }
        // Damage direction indicator — element-colored arc pointing toward attacker (22.4)
        const atkMesh = this.remoteMeshes.get(msg.attackerId);
        if (atkMesh && this.localMesh) {
          const dx = atkMesh.position.x - this.localMesh.position.x;
          const dz = atkMesh.position.z - this.localMesh.position.z;
          const angle = Math.atan2(dx, dz);
          showDamageDirection(angle, msg.subType);
          // (22.9) Offscreen arrow pointing toward attacker
          showOffscreenDamageArrow(angle);
        }
      }

      // Attacker gets hit-confirm indicator
      if (this.room && msg.attackerId === this.room.sessionId) {
        showHitConfirm(msg.damage || 30);
        showHitMarkerVFX();
        playHitConfirmSFX();
      }
    });

    this.room.onMessage("kartCrash", (msg) => {
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

      if (impactPosition) {
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

      playSFX('crash');
      if (localDamage > 0 || severity >= 2) {
        this.flashDamage();
        flashDamageVignette();
        shakeCamera(this.camera, Math.min(0.95, 0.22 + severity * 0.05), 320);
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
        showDamageDirection(angle, 'wind_slash');
      }
    });

    this.room.onMessage("effectApplied", (msg) => {
      console.log("[colyseus] Effect applied:", msg.type, "on", msg.target);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastEffect = msg.type;
      if (msg.type === 'mirror') this._playAnomalyCue('mirror_realm_ready', 0.9);
      if (msg.type === 'phased') this._playAnomalyCue('phase_shift_ready', 0.9);
      if (msg.type === 'memory_leak') this._playAnomalyCue('memory_leak_cast', 0.95);
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

    // ── Kill feed for battle mode ─────────────────────────────────────────
    this.room.onMessage("playerKilled", (msg) => {
      this._addKillFeedEntry(msg.attackerName, msg.victimName, msg.weapon, msg);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastKill = msg;

      // Kill celebration VFX + multi-kill banner for local attacker
      if (this.room && msg.attackerId === this.room.sessionId) {
        if (this.localMesh) emitKillCelebration(this.localMesh.position);
        playBattleSound('sparkle_hit');
        const streak = msg.killStreak || 1;
        if (streak >= 2) showMultiKillBanner(streak);
      }
      // Death VFX at victim position
      const killVictimMesh = this.remoteMeshes.get(msg.victimId);
      if (killVictimMesh) {
        emitBattleExplosion(killVictimMesh.position, msg.weapon);
        playBattleSound('death');
      }
    });

    // ── Death sequence trigger ────────────────────────────────────────────
    this.room.onMessage("playerDied", (msg) => {
      if (this.room && msg.victimId === this.room.sessionId) {
        shakeCamera(this.camera, 0.5, 600);
        flashDamageVignette();
        playBattleSound('death');
        this._startDeathSequence(msg);
      }
    });

    // ── Elimination (balloon mode) ─────────────────────────────────────
    this.room.onMessage("playerEliminated", (msg) => {
      this._addKillFeedEntry('', msg.playerName, '', { callout: '☠️ ELIMINATED' });
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
      this._showMatchEndScreen(msg);
    });

    // ── Race lap messages ─────────────────────────────────────────────────
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
      // Extend cooldown — don't re-trigger finish line for 18s
      this._lapCooldownUntil = Date.now() + 18000;
    });

    this.room.onMessage("lapComplete", (msg) => {
      // Another player completed a lap — update leaderboard if exposed
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

    console.log("[realtime] Start sequence — match begins in", durationMs, "ms");
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

  _sendClientReadySignal() {
    if (this._clientReadySent || !this.room || this.roomName !== 'battle_room') return;
    this.room.send('clientReady', { sentAt: Date.now() });
    this._clientReadySent = true;
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

    if (PrematchLobby.isVisible() && state?.players) {
      PrematchLobby.updatePlayers(state, this.room.sessionId);
    }

    if (this.started && !this._audioStarted) {
      this._audioStarted = true;
      startEngineSound();
      if (joinOptions.gameMode === 'battle') {
        playBattleMusic(joinOptions.trackId || 'glo_arena');
        startAmbientLoop(joinOptions.trackId || 'glo_arena');
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
    const panel = document.createElement('div');
    panel.id = 'sync-debug-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '16px',
      left: '16px',
      zIndex: '90',
      width: '220px',
      padding: '12px 14px',
      borderRadius: '14px',
      background: 'rgba(12, 12, 18, 0.62)',
      border: '1px solid rgba(255,255,255,0.12)',
      color: '#ffffff',
      fontFamily: '"Exo 2", "Poppins", sans-serif',
      fontSize: '12px',
      lineHeight: '1.35',
      boxShadow: '0 18px 44px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
      backdropFilter: 'blur(18px) saturate(135%)',
      WebkitBackdropFilter: 'blur(18px) saturate(135%)',
      pointerEvents: 'none',
      opacity: '0.98',
    });
    document.body.appendChild(panel);
    this._syncDebugPanelEl = panel;
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
        <div style="font-size:10px;font-weight:800;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.62);">Sync Monitor</div>
        <div style="font-size:11px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:${this._networkStats.authoritative ? '#8fe6ff' : '#ff9db6'};">${this.roomName.replace('_room', '').toUpperCase()}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;column-gap:14px;row-gap:5px;">
        ${rows.map(([label, value]) => `<div style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.56);">${label}</div><div style="font-size:12px;font-weight:700;color:#f6fbff;text-align:right;">${value}</div>`).join('')}
      </div>
    `;
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
    updateGUIScore(Number(self.score || 0), this.gameType === 'balloon' ? 'KOs' : 'Kills');
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
        this.havokPlugin.raycast(from, to, hit);
        if (hit.hasHit && Number.isFinite(hit.hitDistance)) {
          return from.y - hit.hitDistance + clearance;
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

    if (PrematchLobby.isVisible()) PrematchLobby.hide();
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
      // C: cycle camera view (Chase → Close → Chase …)
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
        this._showCameraModeBanner(mode.name);
      }
    };
    this._onKeyUp = (e) => {
      this._keys[e.code] = false;
      if (e.code === 'Tab') hideScoreboard();
    };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);

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

    // Per-frame input polling → sendInput()
    this.scene.registerBeforeRender(() => {
      if (!this.localMesh || !this.room) return;

      // Block all input/physics until the match goes LIVE (avoids pre-match kart movement)
      if (!this._kartReady) return;

      // ── Death/respawn state machine ─────────────────────────────────
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

      // ── Invulnerability blink ────────────────────────────────────────
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

      // ── Low health heartbeat ─────────────────────────────────────────
      if (this._localHealth <= 25 && this._localHealth > 0) {
        this._heartbeatTimer -= this.engine.getDeltaTime() / 1000;
        if (this._heartbeatTimer <= 0) {
          playHeartbeat();
          this._heartbeatTimer = 1.2;
        }
      }
      updateLowHealthWarning(this._localHealth);

      // ── Battle music intensity (21.26) ──────────────────────────────
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

      // Status effect VFX — use KartVFX state machine (parented to kart, follows movement)
      if (this._localKartVFX && this._localCombatState.effectType) {
        const eff = this._localCombatState.effectType;
        if (eff === 'stunned' || eff === 'stun' || eff === 'spinout' || eff === 'knockback') {
          this._localKartVFX.setState(VFXState.STUNNED);
        } else if (eff === 'frozen' || eff === 'freeze') {
          this._localKartVFX.setState(VFXState.FROZEN);
        } else if (eff === 'burning' || eff === 'burn') {
          this._localKartVFX.setState(VFXState.BURNING);
        }
      } else if (this._localKartVFX && !this._localCombatState.effectType) {
        // Clear effect state when server clears the effect
        if (this._localKartVFX.state === VFXState.STUNNED ||
            this._localKartVFX.state === VFXState.FROZEN ||
            this._localKartVFX.state === VFXState.BURNING) {
          this._localKartVFX.setState(VFXState.IDLE);
        }
      }

      // ── Dynamic forcefield shield (HP-based, green→red) ─────────────
      this._updateForceFieldShield();

      // ── KartVFX per-frame update ─────────────────────────────────────
      const dtVFX = this.engine.getDeltaTime() / 1000;
      if (this._localKartVFX) {
        const speed = this.localKartAggregate?.body
          ? this.localKartAggregate.body.getLinearVelocity().length()
          : 0;
        this._localKartVFX.update(dtVFX, speed, this._localHealth);
      }

      // ── Ludicrous Mode VFX ──────────────────────────────────────────
      this._updateLudicrousVFX(dtVFX);

      // Spectator mode — ignore normal inputs, fire cycles target
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
      if (hasInput || this._wasSendingInput) {
        this.sendInput({ throttle, steer, brake, firePrimary, fireSecondary, drift });
        this._wasSendingInput = hasInput;
        this._lastInputSendTime = performance.now();
      } else if (!this._lastInputSendTime || performance.now() - this._lastInputSendTime > 200) {
        this.sendInput({ throttle: 0, steer: 0, brake: false, firePrimary: false, fireSecondary: false, drift: false });
        this._lastInputSendTime = performance.now();
      }

      // Engine pitch reflects speed
      if (this.localKartAggregate?.body) {
        const vel = this.localKartAggregate.body.getLinearVelocity();
        const speed = vel ? Math.sqrt(vel.x * vel.x + vel.z * vel.z) : 0;
        updateEnginePitch(speed);
        // Legacy wheel spin removed — handled in applyLocalPrediction via KartEntity.spinWheels()
      }

      // Out-of-bounds respawn (arena-aware threshold)
      const fallY = this._fallThreshold ?? -60;
      if (this.localMesh && this.localMesh.position.y < fallY && this._spawnPos) {
        // Pick nearest spawn to where the player fell (XZ only)
        const nearest = this._getNearestSpawn(this.localMesh.position);
        this._respawnLocalKart(nearest);
      }

      // ── Finish-line detection (race mode) ────────────────────────────────
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

      // ── Camera clip avoidance ─────────────────────────────────────────────
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
        } catch (_) { /* raycast API unavailable — skip clip avoidance this frame */ }
      }
    });
  }

  /** Brief on-screen banner when camera mode changes. */
  _showCameraModeBanner(name) {
    let el = document.getElementById('tk-cam-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tk-cam-banner';
      Object.assign(el.style, {
        position: 'fixed', top: '12%', left: '50%', transform: 'translateX(-50%)',
        padding: '6px 18px', borderRadius: '6px',
        background: 'rgba(0,0,0,0.65)', color: '#fff',
        fontSize: '18px', fontFamily: 'sans-serif', pointerEvents: 'none',
        zIndex: '9999', transition: 'opacity 0.3s',
      });
      document.body.appendChild(el);
    }
    el.textContent = `Camera: ${name}`;
    el.style.opacity = '1';
    clearTimeout(this._camBannerTimer);
    this._camBannerTimer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
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

  /** Trigger death animation — hide kart, show debris + KO overlay */
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
    playEliminationSFX();

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

  // ── 21.32 Spectator Mode ─────────────────────────────────────────────────

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

  // ── Lap HUD ─────────────────────────────────────────────────────────────

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

      const screen = document.createElement('div');
      screen.id = '_glo-match-end';
      Object.assign(screen.style, {
        position: 'fixed', inset: '0', zIndex: '10010',
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Bungee', Impact, sans-serif",
        color: '#fff',
        padding: '32px',
        gap: '16px',
        opacity: '0',
        transition: 'opacity 0.6s ease-in',
      });

      // Title
      const title = document.createElement('div');
      const isRace = msg?.mode === 'race';
      const isSelfWinner = msg?.winnerId === this.room?.sessionId;
      title.textContent = isRace ? '🏁 RACE OVER' : (isSelfWinner ? '🏆 VICTORY!' : '⚔️  MATCH OVER');
      Object.assign(title.style, {
        fontSize: 'clamp(2rem, 7vw, 4rem)',
        textShadow: '0 0 30px rgba(255,200,0,0.7)',
        marginBottom: '8px',
        color: isSelfWinner ? '#ffd700' : '#fff',
      });
      screen.appendChild(title);

      // Winner banner
      if (msg?.winner || (msg?.standings?.[0]?.name)) {
        const winnerName = msg?.winner || msg?.standings?.[0]?.name;
        const winBanner = document.createElement('div');
        winBanner.textContent = `🏆 ${winnerName}`;
        Object.assign(winBanner.style, {
          fontSize: 'clamp(1.4rem, 5vw, 2.8rem)',
          color: '#ffd700',
          textShadow: '0 0 20px rgba(255,200,0,0.8)',
          background: 'rgba(255,200,0,0.1)',
          padding: '8px 24px',
          borderRadius: '8px',
          border: '2px solid rgba(255,200,0,0.4)',
        });
        screen.appendChild(winBanner);
      }

      // Win reason
      if (msg?.winReason) {
        const reason = document.createElement('div');
        reason.textContent = msg.winReason;
        Object.assign(reason.style, {
          fontSize: 'clamp(0.8rem, 2vw, 1rem)',
          color: 'rgba(255,255,255,0.6)',
          fontStyle: 'italic',
        });
        screen.appendChild(reason);
      }

      // Enhanced standings table with K/D ratio
      const standings = msg?.standings || [];
      if (standings.length > 0) {
        const table = document.createElement('div');
        Object.assign(table.style, {
          display: 'flex', flexDirection: 'column', gap: '4px',
          marginTop: '8px', width: '100%', maxWidth: '520px',
        });

        // Header row
        const header = document.createElement('div');
        Object.assign(header.style, {
          display: 'grid',
          gridTemplateColumns: '40px 1fr 60px 60px 50px',
          gap: '8px',
          padding: '6px 16px',
          fontSize: 'clamp(0.65rem, 1.5vw, 0.8rem)',
          color: 'rgba(255,255,255,0.4)',
          fontWeight: '700',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
        });
        header.innerHTML = '<span></span><span>Player</span><span style="text-align:center">Kills</span><span style="text-align:center">Deaths</span><span style="text-align:center">K/D</span>';
        table.appendChild(header);

        standings.forEach((entry, i) => {
          const row = document.createElement('div');
          const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
          const kills = entry.score ?? 0;
          const deaths = entry.deaths ?? 0;
          const kd = deaths === 0 ? kills.toFixed(1) : (kills / deaths).toFixed(1);
          const isSelf = entry.sessionId === this.room?.sessionId;
          Object.assign(row.style, {
            display: 'grid',
            gridTemplateColumns: '40px 1fr 60px 60px 50px',
            gap: '8px',
            background: isSelf ? 'rgba(0,200,100,0.15)' : (i === 0 ? 'rgba(255,200,0,0.12)' : 'rgba(255,255,255,0.05)'),
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: 'clamp(0.9rem, 2.5vw, 1.1rem)',
            color: i === 0 ? '#ffd700' : (isSelf ? '#00ff88' : '#ccc'),
            alignItems: 'center',
            border: isSelf ? '1px solid rgba(0,255,100,0.3)' : 'none',
          });
          row.innerHTML = `<span>${medal}</span><span>${entry.name || '?'}</span><span style="text-align:center">${kills}</span><span style="text-align:center">${deaths}</span><span style="text-align:center;color:rgba(255,255,255,0.5)">${kd}</span>`;
          table.appendChild(row);
        });
        screen.appendChild(table);
      }

      // Button row
      const btnRow = document.createElement('div');
      Object.assign(btnRow.style, { display: 'flex', gap: '16px', marginTop: '24px', flexWrap: 'wrap', justifyContent: 'center' });

      // Play Again button
      const btnAgain = document.createElement('button');
      btnAgain.textContent = 'PLAY AGAIN';
      Object.assign(btnAgain.style, {
        padding: '12px 32px',
        fontSize: 'clamp(0.9rem, 2.5vw, 1.3rem)',
        fontFamily: "'Bungee', Impact, sans-serif",
        background: 'linear-gradient(135deg, #00cc66, #009944)',
        color: '#fff',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
        letterSpacing: '0.05em',
        boxShadow: '0 0 20px rgba(0,200,100,0.4)',
      });
      btnAgain.addEventListener('click', () => {
        screen.remove();
        // Re-trigger start in the same room
        if (this.room) this.room.send('triggerStart', {});
      });
      btnRow.appendChild(btnAgain);

      // Change Arena button
      const btnLobby = document.createElement('button');
      btnLobby.textContent = 'CHANGE ARENA';
      Object.assign(btnLobby.style, {
        padding: '12px 32px',
        fontSize: 'clamp(0.9rem, 2.5vw, 1.3rem)',
        fontFamily: "'Bungee', Impact, sans-serif",
        background: 'linear-gradient(135deg, #ff0080, #7700ff)',
        color: '#fff',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
        letterSpacing: '0.05em',
        boxShadow: '0 0 20px rgba(255,0,128,0.4)',
      });
      btnLobby.addEventListener('click', () => { window.location.href = '/index.html'; });
      btnRow.appendChild(btnLobby);
      screen.appendChild(btnRow);

      document.body.appendChild(screen);
      // Fade in
      requestAnimationFrame(() => { screen.style.opacity = '1'; });

      // Victory/defeat audio stinger
      if (isSelfWinner) {
        playSFX('race_win');
      } else {
        playSFX('race_finish');
      }
    }, 1200);
  }

  /** Visual countdown overlay: 3 → 2 → 1 → GO! with scale-pulse */
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
    }
    this.room.send("input", payload);

    if (options.emitWeaponEvents === false) {
      return;
    }

    // ── Primary fire (Space) — glo_burst, continuous stream with overheat ──
    if (input.firePrimary && this.currentWeapon && !this._localCombatState.overheated) {
      const now = performance.now();
      if (!this._lastStreamFireTime || now - this._lastStreamFireTime > 45) {
        this.room.send("fireWeapon", { ...this._buildFirePayload("primary"), slot: "primary" });
        this._lastStreamFireTime = now;
      }
    }

    // ── Secondary fire (E) — pickup weapon ──
    if (input.fireSecondary && this.currentWeapon2) {
      const isStream2 = this.currentWeapon2 === 'glow_thrower';
      if (isStream2) {
        const now = performance.now();
        if (!this._lastStream2FireTime || now - this._lastStream2FireTime > 45) {
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

    const aimDir = this._getMissileAimDirection();

    origin.addInPlace(new Vector3(aimDir.x * 2.8, Math.max(0, aimDir.y) * 1.2, aimDir.z * 2.8));

    const payload = {
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      dirX: aimDir.x,
      dirY: aimDir.y,
      dirZ: aimDir.z,
    };

    if (slot === 'secondary' && this.currentWeapon2 === 'missile' && this._missileLockTargetId && this._missileLockProgress >= 1) {
      payload.targetId = this._missileLockTargetId;
    }

    return payload;
  }

  _getMissileAimDirection() {
    let aimDir = this.localMesh?.forward?.scale?.(-1) || new Vector3(0, 0, 1);
    if (aimDir.lengthSquared() < 0.0001) {
      aimDir = new Vector3(0, 0, 1);
    }
    aimDir.normalize();

    const camRay = this.camera?.getForwardRay?.(120);
    if (camRay?.direction) {
      const projected = camRay.direction.clone();
      projected.y = Math.max(-0.2, Math.min(0.35, projected.y));
      if (projected.lengthSquared() > 0.0001) {
        projected.normalize();
        aimDir = projected;
      }
    }

    return aimDir;
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
    if (this.currentWeapon2 !== 'missile' || !this.localMesh || !this.authoritativeState?.players || !this.camera) {
      this._missileLockTargetId = null;
      this._missileLockProgress = 0;
      this._missileLockScreenX = null;
      this._missileLockScreenY = null;
      updateLockReticle(null, null, false);
      return;
    }

    const localPos = this.localMesh.position;
    const aimDir = this._getMissileAimDirection();
    let bestTargetId = null;
    let bestScreenPos = null;
    let bestScore = -Infinity;

    this.authoritativeState.players.forEach((player, playerId) => {
      if (playerId === this.room?.sessionId) return;
      if (Number(player.health || 0) <= 0) return;

      const targetPos = new Vector3(player.x || 0, (player.y || 0) + 1.4, player.z || 0);
      const toTarget = targetPos.subtract(localPos);
      const distance = toTarget.length();
      if (distance < 0.001 || distance > 70) return;

      toTarget.scaleInPlace(1 / distance);
      const facing = Vector3.Dot(aimDir, toTarget);
      if (facing < 0.72) return;

      const screenPos = this._projectWorldToScreen(targetPos);
      if (!screenPos) return;

      const score = facing * 2.2 - distance * 0.025;
      if (score > bestScore) {
        bestScore = score;
        bestTargetId = playerId;
        bestScreenPos = screenPos;
      }
    });

    if (!bestTargetId || !bestScreenPos) {
      this._missileLockTargetId = null;
      this._missileLockProgress = Math.max(0, this._missileLockProgress - dt * 2.5);
      updateLockReticle(null, null, false);
      return;
    }

    if (bestTargetId === this._missileLockTargetId) {
      this._missileLockProgress = Math.min(1, this._missileLockProgress + dt * 1.8);
    } else {
      this._missileLockTargetId = bestTargetId;
      this._missileLockProgress = 0.2;
    }

    this._missileLockScreenX = bestScreenPos.x;
    this._missileLockScreenY = bestScreenPos.y;
    updateLockReticle(bestScreenPos.x, bestScreenPos.y, this._missileLockProgress >= 1);
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

    // ── Restore clean physics quaternion before running physics ────────
    // The previous frame may have added visual offsets (pitch/roll/lean).
    // We must restore the physics-only orientation so Havok doesn't
    // integrate on top of visual tilt and cause runaway accumulation.
    if (this._physicsQuat && this.localMesh.rotationQuaternion) {
      this.localMesh.rotationQuaternion.copyFrom(this._physicsQuat);
    }

    // ── Force-based raycast suspension + ground detection ───────────────
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

    // ── Delegate to shared kart-physics.js (eliminates inline duplication) ──
    const result = applyKartDriving(body, transform, input, dt, this._driftState, { spdMult, strMult });

    // ── Arena bounds enforcement ─────────────────────────────────────────
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

    // ── Drift / boost audiovisual feedback ──────────────────────────────
    const driftTier = result.driftTier;
    const boostActive = result.miniBoostActive;
    const isDrifting = driftTier > 0 || this._driftState.wasDrifting;
    if (driftTier > 0 && driftTier !== this._prevDriftTier) playSFX('skid', 0.5);
    if (boostActive && !this._prevBoostActive) playSFX('boost', 0.7);
    this._prevDriftTier = driftTier;
    this._prevBoostActive = boostActive;

    // Update particles (sparks / flames) for local kart
    if (this.localMesh) {
      updateParticles(dt, this.localMesh, {
        isDrifting: this._driftState.wasDrifting,
        sparksLevel: driftTier,
        isBoosting: boostActive,
        speed: result.speedKPH,
      });
    }

    // ── KartVFX drift integration ────────────────────────────────────────
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

    // ── MK3.js per-frame kart entity visuals ────────────────────────────
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

    // ── Terrain-conforming body pitch/roll ─────────────────────────────
    // With raycast vehicle active, the physics body already pitches/rolls
    // naturally from suspension forces — skip the visual-only computation.
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

    // ── Steering lean + acceleration lean ───────────────────────────────
    const speedMS = result.hSpeed || (result.speedKPH / 3.6);
    const steerLean = computeSteerLean(this._driftState, result.steer || 0, speedMS, dt);
    const accelLean = computeAccelLean(this._driftState, result.throttle || 0, result.brake, speedMS, dt);

    // ── Visual body orientation ──────────────────────────────────────────
    // CRITICAL: Visual offsets (lean/tilt/driftYaw) must NOT feed back into
    // the physics body.  Before the next physics step the mesh rotation is
    // restored to the clean physics quat (see top of this method).
    let pitchOff = 0;
    let totalRoll = 0;
    if (this.localMesh.rotationQuaternion) {
      // Save the clean physics quaternion BEFORE adding visual offsets.
      if (!this._physicsQuat) this._physicsQuat = this.localMesh.rotationQuaternion.clone();
      else this._physicsQuat.copyFrom(this.localMesh.rotationQuaternion);

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

    // ── Apply suspension WITH tilt compensation (must come AFTER quat) ──
    if (this._localKartEntity) {
      this._localKartEntity.applySuspension(this._driftState.suspTravel, pitchOff, totalRoll);
    }

    // ── FOV shift at speed (21.4) ───────────────────────────────────────
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

    const connectedIds = Array.from(state.players.keys());

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
            const realMesh = remoteEntity.rootMesh;
            realMesh.position = placeholder.position.clone();
            realMesh.rotationQuaternion = placeholder.rotationQuaternion ? placeholder.rotationQuaternion.clone() : new Quaternion();

            placeholder.dispose();
            this.remoteMeshes.set(id, realMesh);
            this._remoteKartEntities.set(id, remoteEntity);

            // Ensure remote kart is visible
            remoteEntity.setVisible(true);

            // ── Remote kart ANIMATED physics ──
            if (this.havokPlugin) {
              remoteEntity.createPhysics(this.havokPlugin, 'ANIMATED');
              if (remoteEntity.aggregate) {
                this.remoteKartAggregates.set(id, remoteEntity.aggregate);
              }
            }

            // ── Cache wheel meshes for remote kart spin animation ──
            if (remoteEntity.wheelMeshes.length) {
              this._remoteWheelMeshes.set(id, remoteEntity.wheelMeshes);
            }

            // ── Remote KartVFX ──
            const remoteVFX = new KartVFX(this.scene, remoteEntity);
            this._remoteKartVFXs.set(id, remoteVFX);

            // ── GLO underglow for remote player ──
            try {
              const gloKit = createGloUnderglow(this.scene, realMesh, {
                effect: player.gloEffect || 'solid',
                color:  player.gloColor  || '#ff0080',
                color2: player.gloColor2 || '#00e5ff',
                id: id,
              });
              setGloVisible(gloKit, true);
              this._remoteGloKits.set(id, gloKit);
            } catch (e) { console.warn(`[realtime] Remote GLO failed for ${id}:`, e); }

            console.log(`[realtime] Loaded remote kart for ${id} (KartEntity)`);
          })
          .catch((err) => {
            console.error(`[realtime] Failed to load remote kart for ${id}:`, err);
          });

        this.loadingPromises.set(id, loadPromise);
      } else if (mesh && mesh.position) {
        // Store target for smooth interpolation (lerped in beforeRender)
        // Use server Y directly — it's authoritative. Don't override with _sampleSurfaceY.
        this._remoteTargets.set(id, {
          pos: new Vector3(player.x, player.y, player.z),
          rot: new Quaternion(player.rx, player.ry, player.rz, player.rw),
          vel: new Vector3(player.vx || 0, 0, player.vz || 0), // zero Y extrap to prevent bounce
          steer: player.steer || 0,
          renderPos: mesh.position.clone(),
        });

        // Remote shield forcefield bubble
        this._updateRemoteShieldBubble(id, mesh, !!player.shielded, Number(player.shieldHP || 0));
      }
    });

    // Cleanup disconnected players
    for (const [id, mesh] of this.remoteMeshes.entries()) {
      if (!connectedIds.includes(id)) {
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
        if (remoteBubble) { remoteBubble.sphere.dispose(); this._remoteShieldBubbles.delete(id); }
        this._remoteWheelMeshes.delete(id);
        this.remoteMeshes.delete(id);
        this.loadingPromises.delete(id);
        this._remoteTargets.delete(id);
      }
    }
  }

  syncEntities(state) {
    if (!this.scene || !state?.entities) return;
    const currentEntities = Array.from(state.entities.keys());
    state.entities.forEach((entity, id) => {
      let mesh = this.entityMeshes.get(id);
      if (!mesh) {
        if (entity.type === "projectile") {
          mesh = entity.subType === "gravity_well"
            ? this._createGravityWellMesh(id)
            : this._createProjectileMesh(id, entity.subType);
        } else {
          // Item boxes — enhanced MK-style question block
          mesh = createItemBoxModel(this.scene);
        }
        mesh.position = new Vector3(entity.x, entity.y, entity.z);
        // Tag mesh with entity metadata for trigger lookups
        mesh._entityId = id;
        mesh._entityType = entity.type;
        mesh._subType = entity.subType || '';
        this.entityMeshes.set(id, mesh);

        // Attach particle trail to remote projectiles (21.30)
        if (entity.type === "projectile" && entity.subType !== "bubblegum" && entity.subType !== "banana") {
          const trailId = createProjectileTrail(entity.subType, mesh);
          if (trailId) mesh._trailId = trailId;
        }

        // ── Trigger physics for item boxes ──
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

        // ── Trigger physics for projectiles ──
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
              pt = { pos: new Vector3(), vel: new Vector3(), lastUpdate: 0, subType: entity.subType, spawnTime: performance.now() };
              this._projectileTargets.set(id, pt);
              // Set initial position immediately on first appearance
              mesh.position.x = entity.x;
              mesh.position.y = entity.y;
              mesh.position.z = entity.z;
            }
            pt.pos.set(entity.x, entity.y, entity.z);
            pt.vel.set(entity.vx || 0, entity.vy || 0, entity.vz || 0);
            pt.lastUpdate = performance.now();
            // Gravity well / anomaly still gets per-frame animation
            this._animateProjectileVisual(mesh, entity);
          } else {
            // Item boxes and traps: direct positioning
            mesh.position.x = entity.x;
            mesh.position.y = groundedEntityY;
            mesh.position.z = entity.z;
            if (entity.type !== "projectile") {
              // Enhanced item box animation — tilted spin + rainbow glow + core pulse
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
          mesh.setEnabled(false);
        }
      }
    });
    const pickupNow = Date.now();
    for (const [id, ts] of this._pendingPickupBoxes.entries()) {
      if (pickupNow - ts > 1500) this._pendingPickupBoxes.delete(id);
    }
    for (const [id, mesh] of this.entityMeshes.entries()) {
      if (!currentEntities.includes(id)) {
        const entAgg = this.entityAggregates.get(id);
        if (entAgg) {
          // (22.3) WM-style: switch body to STATIC before dispose to stop
          // physics sim immediately on spent projectiles
          try {
            if (entAgg.body) {
              entAgg.body.setMotionType(PhysicsMotionType.STATIC);
              entAgg.body.setMassProperties({ mass: 0 });
            }
          } catch (_) { /* body already disposed */ }
          entAgg.dispose();
          this.entityAggregates.delete(id);
        }
        if (mesh._subType === 'rock_barrage' && mesh.position) {
          const now = performance.now();
          const recentImpact = this._lastRockImpactPos
            && (now - this._lastRockImpactTime) < 250
            && Vector3.DistanceSquared(mesh.position, this._lastRockImpactPos) < 9;
          if (!recentImpact) {
            emitWeaponImpactVFX(mesh.position.clone ? mesh.position.clone() : mesh.position, 'rock_barrage');
          }
        }
        if (mesh._trailId) disposeProjectileTrail(mesh._trailId);
        this._disposeProjectileVisual(mesh);
        mesh.dispose();
        this.entityMeshes.delete(id);
        this._projectileTargets.delete(id);
      }
    }
  }

  _disposeProjectileVisual(mesh) {
    if (!mesh || mesh._projectileVisualDisposed) return;
    mesh._projectileVisualDisposed = true;

    const visualRoot = mesh.metadata?.visualRoot;
    const visualMeta = mesh.metadata?.visualMetadata || mesh.metadata || null;

    if (visualMeta?.spinObserver && this.scene?.onBeforeRenderObservable) {
      this.scene.onBeforeRenderObservable.remove(visualMeta.spinObserver);
      visualMeta.spinObserver = null;
    }
    if (visualMeta?.updateObserver && this.scene?.onBeforeRenderObservable) {
      this.scene.onBeforeRenderObservable.remove(visualMeta.updateObserver);
      visualMeta.updateObserver = null;
    }

    const disposableKeys = ['trailPS', 'debrisPS', 'sparksPS', 'mistPS'];
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

  _createProjectileMesh(id, subType) {
    const modelWeaponId = PROJECTILE_MODEL_ALIASES[subType] || subType;
    if (this.roomName === 'battle_room') {
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
        return anchor;
      }
    }

    const PROJ_VISUALS = {
      missile:      { shape: "sphere", diameter: 0.6,  diffuse: [1, 0.2, 0.1],  emissive: [1, 0.3, 0] },
      bowling_ball: { shape: "sphere", diameter: 0.9,  diffuse: [0.12, 0.12, 0.14], emissive: [0.05, 0.05, 0.08] },
      cake:         { shape: "box",    size: 0.6,      diffuse: [1, 0.85, 0.3], emissive: [0.6, 0.4, 0.1] },
      plunger:      { shape: "cylinder", diameter: 0.3, height: 0.8, diffuse: [0.9, 0.15, 0], emissive: [0.7, 0.1, 0] },
      nitro:        { shape: "cylinder", diameter: 0.35, height: 0.7, diffuse: [0, 0.9, 0.6], emissive: [0, 0.5, 0.3] },
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
      // (21.39) Low-poly spheres for projectiles — 8 segments instead of default 32
      mesh = MeshBuilder.CreateSphere(`entity-${id}`, { diameter: vis.diameter || 0.5, segments: 8 }, this.scene);
    }
    const mat = new StandardMaterial(`mat-${id}`, this.scene);
    mat.diffuseColor = new Color3(...vis.diffuse);
    if (vis.emissive) mat.emissiveColor = new Color3(...vis.emissive);
    mesh.material = mat;
    // (22.8) WM-style mesh optimization flags — skip bounding info sync,
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
        // Rolling — spin on X axis proportional to speed
        const speed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        mesh.rotation.x -= speed * dt * 0.8;
        break;
      }
      case 'cake': {
        // Tumble in arc — gentle end-over-end rotation
        mesh.rotation.x += dt * 4.5;
        mesh.rotation.z += dt * 2.0;
        break;
      }
      case 'missile': {
        // Keep missiles readable and aggressive instead of floaty.
        const planarSpeed = Math.sqrt(pt.vel.x * pt.vel.x + pt.vel.z * pt.vel.z);
        if (planarSpeed > 0.1 || Math.abs(pt.vel.y) > 0.1) {
          mesh.rotation.y = Math.atan2(pt.vel.x, pt.vel.z);
          mesh.rotation.x = -Math.atan2(pt.vel.y, Math.max(planarSpeed, 0.01));
        }
        mesh.rotation.z = Math.sin(time * 18) * 0.03;
        if (age < 0.3) {
          const burst = 1.0 + (0.3 - age) * 0.5;
          mesh.scaling.setAll(burst);
        } else {
          mesh.scaling.setAll(1.0);
        }
        break;
      }
      case 'fireball': {
        // Flickering flame — scale oscillation + rotation
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
        // Crystal shimmer — gentle twist + emissive pulse
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
        // Rapid flicker + slight jitter
        mesh.rotation.z = (Math.random() - 0.5) * 0.15;
        const children = mesh.getChildMeshes?.();
        if (children) {
          for (const child of children) {
            if (child.material) {
              child.material.alpha = 0.7 + Math.random() * 0.3;
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
        // Intense vortex spin — accelerates over time
        const spinSpeed = 12 + Math.min(age * 4, 20);
        mesh.rotation.y += dt * spinSpeed;
        // Breathing pulse — vertical stretch + horizontal sway
        const breathe = 1.0 + Math.sin(time * 5) * 0.12;
        mesh.scaling.y = breathe;
        const sway = 1.0 + Math.sin(time * 8) * 0.06;
        mesh.scaling.x = sway;
        mesh.scaling.z = sway;
        // Wobble — slight tilt oscillation for organic feel
        mesh.rotation.x = Math.sin(time * 3.5) * 0.08;
        mesh.rotation.z = Math.cos(time * 4.2) * 0.06;
        // Animate swirl rings if present
        const tornadoMeta = mesh.metadata?.visualMetadata || mesh.metadata;
        if (tornadoMeta?.swirlRings) {
          for (let i = 0; i < tornadoMeta.swirlRings.length; i++) {
            const r = tornadoMeta.swirlRings[i];
            r.rotation.y += dt * (6 + i * 2) * (i % 2 === 0 ? 1 : -1);
            const rScale = 1.0 + Math.sin(time * 7 + i) * 0.15;
            r.scaling.setAll(rScale);
          }
        }
        break;
      }
      case 'toxic_cloud': {
        // Slow expanding rotation
        mesh.rotation.y += dt * 2;
        const expand = Math.min(1.5, 1.0 + age * 0.15);
        mesh.scaling.setAll(expand);
        break;
      }
      case 'nitro': {
        // Spinning bottle
        mesh.rotation.z += dt * 8;
        break;
      }
      case 'super_nova': {
        // Pulsing expanding sphere
        const expand = Math.min(2.5, 1.0 + age * 0.8);
        const pulse = expand + Math.sin(time * 10) * 0.1;
        mesh.scaling.setAll(pulse);
        mesh.rotation.y += dt * 4;
        break;
      }
      case 'glow_thrower': {
        // Stretch stream segments into a continuous flame tongue.
        const flicker = 1.0 + Math.sin(time * 22) * 0.08 + Math.sin(time * 35) * 0.05;
        mesh.scaling.x = 0.85 + flicker * 0.2;
        mesh.scaling.y = 0.85 + flicker * 0.18;
        mesh.scaling.z = 1.6 + flicker * 0.7;
        mesh.rotation.z = Math.sin(time * 14) * 0.06;
        const children = mesh.getChildMeshes?.();
        if (children) {
          for (const child of children) {
            if (child.material?.emissiveColor) {
              const pulse = 0.7 + Math.sin(time * 18) * 0.3;
              child.material.emissiveColor.set(1.0, 0.45 * pulse, 0.05);
            }
          }
        }
        break;
      }
      case 'glo_burst': {
        // Tracer rounds stay thin and fast with a hard launch flash.
        mesh.scaling.x = 0.7;
        mesh.scaling.y = 0.7;
        mesh.scaling.z = age < 0.08 ? 2.6 : 1.8;
        mesh.rotation.z = Math.sin(time * 40) * 0.02;
        if (age < 0.15) {
          mesh.scaling.z += (0.15 - age) * 5;
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

  // ── (22.5) Shockwave Post-Process — WM-style screen distortion on heavy hits ──

  // ── (22.10) Multi-Projectile Spread — WM toxic ball pattern ──

  /**
   * Spawn visual-only spread projectile meshes that fly outward in a fan.
   * Uses Quaternion.RotationAxis(Y, ±5° × i) for even angular distribution.
   * Meshes auto-dispose after 1.5s (no physics, client-side visual only).
   */
  _spawnSpreadVisuals(ownerId, subType, count) {
    if (!this.scene) return;
    const ownerMesh = ownerId === this.room?.sessionId
      ? this.localMesh
      : this.remoteMeshes.get(ownerId);
    if (!ownerMesh) return;

    const spreadAngle = 5 * (Math.PI / 180); // ±5° per step
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

  // ── Kill feed ──────────────────────────────────────────────────────────
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
      missile: "🚀", bowling_ball: "🎳", cake: "🎂", plunger: "🪠",
      bubblegum: "🫧", banana: "🍌", swatter: "🪰", nitro: "💥",
      parachute: "🪂", anchor: "⚓", ludicrous_mode: "🔋", shield: "🛡️",
      fireball: "🔥", toxic_spread: "☣️", ice_lance: "🧊", tornado: "🌪️",
      super_nova: "☀️", rock_barrage: "🪨", lightning_bolt: "⚡", wind_slash: "💨", toxic_cloud: "🧪",
      glow_thrower: "🔥", glo_burst: "💫", pirateleportation: "🏴‍☠️",
    };

    // Build callout prefix
    let callout = extra.callout || '';
    if (!callout) {
      if (extra.isFirstBlood) callout = '🩸 FIRST BLOOD';
      else if (extra.multiKill >= 4) callout = '🔥 RAMPAGE';
      else if (extra.multiKill === 3) callout = '⚡ TRIPLE KILL';
      else if (extra.multiKill === 2) callout = '💥 DOUBLE KILL';
      if (extra.isRevenge) callout = (callout ? callout + ' · ' : '') + '🔄 REVENGE';
    }

    const icon = WEAPON_ICONS[weapon] || "💀";
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

  // ── Balloon meshes (three-strikes mode) ────────────────────────────────
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

  // ── Dynamic Forcefield Shield ──────────────────────────────────────
  _updateForceFieldShield() {
    const shielded = this._localCombatState.shielded;
    const hp = this._localCombatState.shieldHP;

    if (shielded && this.localMesh) {
      if (!this._shieldBubble) {
        const sphere = MeshBuilder.CreateSphere("shield-bubble", { diameter: 4.2, segments: 16 }, this.scene);
        const mat = new StandardMaterial("shield-bubble-mat", this.scene);
        mat.alpha = 0.28;
        mat.backFaceCulling = false;
        mat.emissiveColor = new Color3(0, 1, 0);
        mat.diffuseColor = new Color3(0, 0, 0);
        mat.specularColor = new Color3(0.6, 0.6, 0.6);
        mat.wireframe = false;
        sphere.material = mat;
        sphere.parent = this.localMesh;
        sphere.position.y = 0.4;
        sphere.isPickable = false;
        this._shieldBubble = sphere;
        this._shieldBubbleMat = mat;
      }
      // Color: green → yellow → red based on HP ratio
      const ratio = Math.max(0, Math.min(1, hp / 100));
      const r = ratio > 0.5 ? (1 - ratio) * 2 : 1;
      const g = ratio > 0.5 ? 1 : ratio * 2;
      this._shieldBubbleMat.emissiveColor.set(r, g, 0);
      // Pulse alpha slightly based on time
      const t = performance.now() * 0.003;
      this._shieldBubbleMat.alpha = 0.22 + Math.sin(t) * 0.06;
      // Scale pulse on low HP
      const pulse = ratio < 0.3 ? 1 + Math.sin(t * 3) * 0.05 : 1;
      this._shieldBubble.scaling.setAll(pulse);
    } else if (this._shieldBubble) {
      this._shieldBubble.dispose();
      this._shieldBubble = null;
      this._shieldBubbleMat = null;
    }
  }

  _updateRemoteShieldBubble(playerId, mesh, shielded, hp) {
    if (!this._remoteShieldBubbles) this._remoteShieldBubbles = new Map();

    if (shielded) {
      let bubble = this._remoteShieldBubbles.get(playerId);
      if (!bubble) {
        const sphere = MeshBuilder.CreateSphere(`rshield-${playerId}`, { diameter: 4.2, segments: 12 }, this.scene);
        const mat = new StandardMaterial(`rshield-mat-${playerId}`, this.scene);
        mat.alpha = 0.22;
        mat.backFaceCulling = false;
        mat.emissiveColor = new Color3(0, 1, 0);
        mat.diffuseColor = new Color3(0, 0, 0);
        sphere.material = mat;
        sphere.parent = mesh;
        sphere.position.y = 0.4;
        sphere.isPickable = false;
        bubble = { sphere, mat };
        this._remoteShieldBubbles.set(playerId, bubble);
      }
      const ratio = Math.max(0, Math.min(1, hp / 100));
      const r = ratio > 0.5 ? (1 - ratio) * 2 : 1;
      const g = ratio > 0.5 ? 1 : ratio * 2;
      bubble.mat.emissiveColor.set(r, g, 0);
    } else {
      const bubble = this._remoteShieldBubbles?.get(playerId);
      if (bubble) {
        bubble.sphere.dispose();
        this._remoteShieldBubbles.delete(playerId);
      }
    }
  }

  // ── Ludicrous Mode VFX ─────────────────────────────────────────────
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

  showEffectOverlay(effectType, duration) {
    // Remove existing overlay
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
    this.activeEffect = effectType;

    const EFFECT_STYLES = {
      blind:   { bg: "rgba(60,30,0,0.85)", text: "🪠 BLINDED!", color: "#ff6600" },
      stuck:   { bg: "rgba(200,50,150,0.45)", text: "🫧 STUCK!", color: "#ff66cc" },
      spinout: { bg: "rgba(255,180,0,0.35)", text: "💫 SPIN OUT!", color: "#ffcc00" },
      slow:    { bg: "rgba(100,100,180,0.3)", text: "🪂 SLOWED!", color: "#aaaaff" },
      heavy:   { bg: "rgba(50,60,80,0.4)", text: "⚓ HEAVY!", color: "#8899aa" },
      squash:  { bg: "rgba(80,200,40,0.35)", text: "🪰 SQUASHED!", color: "#88ff44" },
      boost:   { bg: "rgba(0,255,200,0.15)", text: "⚡ BOOST!", color: "#00ffcc" },
      ludicrous: { bg: "rgba(255,0,255,0.25)", text: "🔋 LUDICROUS MODE!", color: "#ff00ff" },
      shielded:{ bg: "rgba(80,180,255,0.1)", text: "🛡️ FORCEFIELD ON", color: "#55bbff" },
      mirror:  { bg: "rgba(145,214,255,0.14)", text: "🪞 MIRROR REALM", color: "#a6dfff" },
      phased:  { bg: "rgba(158,242,208,0.14)", text: "👻 PHASE SHIFT", color: "#b8ffe6" },
      memory_leak: { bg: "rgba(255,156,168,0.15)", text: "🧠 MEMORY LEAK", color: "#ffc2ca" },
      pirateleportation: { bg: "rgba(155,89,182,0.25)", text: "🏴‍☠️ PIRATED!", color: "#bb77dd" },
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
    if (effectType === 'phased') {
      for (let index = 0; index < 9; index += 1) {
        const line = document.createElement('div');
        Object.assign(line.style, {
          position: 'fixed',
          left: '0',
          right: '0',
          top: `${8 + index * 10}%`,
          height: '1px',
          background: 'linear-gradient(90deg, rgba(158,242,208,0), rgba(184,255,230,0.72), rgba(158,242,208,0))',
          opacity: '0.4',
        });
        overlay.appendChild(line);
      }
    }
    if (effectType === 'memory_leak') {
      for (let index = 0; index < 10; index += 1) {
        const glitch = document.createElement('div');
        Object.assign(glitch.style, {
          position: 'fixed',
          width: `${18 + (index % 4) * 26}px`,
          height: '9px',
          left: `${5 + index * 9}%`,
          top: `${20 + (index % 5) * 11}%`,
          background: 'rgba(255,182,193,0.42)',
          boxShadow: '0 0 14px rgba(255,156,168,0.5)',
          opacity: `${0.22 + (index % 3) * 0.16}`,
        });
        overlay.appendChild(glitch);
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

    window.setTimeout(() => {
      if (this._arenaEffectOverlayEl === overlay) this._clearArenaEffectOverlay();
    }, duration);
  }

  _clearArenaEffectOverlay() {
    if (this._arenaEffectOverlayEl) {
      this._arenaEffectOverlayEl.remove();
      this._arenaEffectOverlayEl = null;
    }
  }

  dispose() {
    stopEngineSound();
    stopBGM();
    disposeAudio();
    disposeParticles();
    this._stopNetworkSync();

    // Remove keyboard listeners
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp)   window.removeEventListener("keyup",   this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._keys = {};

    disposeControlsOverlay();

    // (21.39) Clean up perf overlay
    if (this._perfKeyHandler) window.removeEventListener('keydown', this._perfKeyHandler);
    if (this._perfOverlay) { this._perfOverlay.remove(); this._perfOverlay = null; }

    if (this._autoStartTimer) {
      clearTimeout(this._autoStartTimer);
      this._autoStartTimer = null;
    }
    if (this._stateCatchupTimer) {
      clearInterval(this._stateCatchupTimer);
      this._stateCatchupTimer = null;
    }
    if (this._inputKeepaliveInterval) {
      window.clearInterval(this._inputKeepaliveInterval);
      this._inputKeepaliveInterval = null;
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
    this._remoteWheelMeshes.clear();

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

    this.havokPlugin = null;
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }
}


