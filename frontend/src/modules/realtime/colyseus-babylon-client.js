import { Client } from "colyseus.js";
import {
  Engine,
  Scene,
  Vector3,
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
} from "@babylonjs/core";
import {
  createGloUnderglow, updateGloUnderglow, setGloVisible, disposeGloUnderglow,
} from './glo-underglow.js';
import "@babylonjs/loaders/glTF";
import HavokPhysics from "@babylonjs/havok";
import { resolveTrackAsset, resolveArenaAsset, resolveKartAsset } from "../content-registry.js";
import { FILTER, applyFilterToAggregate } from './collision-layers.js';
import { createMinimap, updateMinimapPlayers } from '../minimap.js';
import { initParticles, updateParticles, disposeParticles } from '../babylon-particles.js';
import {
  playTrackMusic, playSFX, playWeaponFireSFX, playWeaponHitSFX,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playCountdownSequence, stopBGM, disposeAudio,
} from "../game-audio.js";
import * as PrematchLobby from './prematch-lobby.js';

const HAVOK_WASM_PUBLIC_PATH = `${import.meta.env.BASE_URL}havok/HavokPhysics.wasm`;

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
    this.havokPlugin = null;

    this.inputSeq = 0;
    this.pendingInputs = [];
    this.authoritativeState = null;
    this.started = false;
    this.localInitializedFromServer = false;

    // Weapon state
    this.currentWeapon = "";
    this.weaponHudEl = null;

    // Active effect state
    this.activeEffect = "";      // current effect type on local player
    this.effectOverlayEl = null;  // DOM overlay for blind/status effects

    // Keyboard input state
    this._keys = {};
    this._onKeyDown = null;
    this._onKeyUp = null;

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
        matchEnded: null,         // full matchEnd message
        errors: [],               // runtime JS errors captured internally
      };
    }

    // GLO underglow system (shader decal + trail)
    this._gloKit = null;           // local player's GLO kit
    this._remoteGloKits = new Map(); // sessionId → GLO kit for remote players

    // Kart pre-match state
    this._kartReady       = false;   // true only after matchLive fires
    this._wheelMeshes     = [];      // child meshes whose name contains "wheel" — rotated by speed
    this._targetCamRadius = 12;      // camera's ideal follow radius (may shorten for wall-clip avoidance)
    this._arenaKartScale  = null;    // per-arena kart scale override from content-registry
  }

  async initBabylon(canvas) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true; // Phase 1: STK uses right-handed

    // GLO animation — no longer needs GlowLayer (shaders handle glow internally)
    this._gloTime = 0;

    // Setup PBR Environment lighting
    this.scene.createDefaultEnvironment({
      createSkybox: false,
      createGround: false,
      enableGroundShadow: true
    });

    // Setup FollowCamera
    this.camera = new FollowCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.radius = 12;
    this.camera.heightOffset = 6;        // slightly higher for better terrain clearance
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.035;
    this.camera.maxCameraSpeed = 12;
    this.camera.minZ = 0.1;             // prevent near-clip artifacts inside tunnels/walls
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
      for (const [id, target] of this._remoteTargets.entries()) {
        const mesh = this.remoteMeshes.get(id);
        if (!mesh || !mesh.position) continue;
        const LERP = 0.25;
        // Measure distance before lerp for wheel-spin calculation
        const preLerpDist = Math.sqrt(
          (target.pos.x - mesh.position.x) ** 2 +
          (target.pos.z - mesh.position.z) ** 2
        );
        Vector3.LerpToRef(mesh.position, target.pos, LERP, mesh.position);
        if (mesh.rotationQuaternion && target.rot) {
          Quaternion.SlerpToRef(mesh.rotationQuaternion, target.rot, LERP, mesh.rotationQuaternion);
        }
        // ── Wheel spin for remote karts ──
        const wheels = this._remoteWheelMeshes.get(id);
        if (wheels) {
          const rotAmt = preLerpDist * LERP * 2.5;
          for (const w of wheels) w.rotation.x -= rotAmt;
        }
      }

      // Animate GLO underglow each frame (local + remote)
      const dt = this.engine.getDeltaTime() / 1000;
      if (this._gloKit) updateGloUnderglow(this._gloKit, dt);
      for (const kit of this._remoteGloKits.values()) {
        updateGloUnderglow(kit, dt);
      }

      // Update minimap (builds opponents map from remoteMeshes)
      if (this.localMesh) {
        const opponents = {};
        for (const [id, m] of this.remoteMeshes.entries()) {
          if (m && m.position) opponents[id] = { model: m };
        }
        updateMinimapPlayers(this.localMesh, opponents);
      }
    });

    this.engine.runRenderLoop(() => {
      this.scene.render();
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

    // Collect all geometry-bearing meshes
    const geometryMeshes = importResult.meshes.filter(
      (m) => m.getTotalVertices && m.getTotalVertices() > 0 && m.isVisible !== false
    );

    if (geometryMeshes.length === 0) {
      console.warn("[realtime] Track has zero geometry meshes – skipping physics");
      return;
    }

    // Ensure world matrices are up-to-date
    this.scene.render(); // force a frame so transforms propagate
    geometryMeshes.forEach((m) => m.computeWorldMatrix(true));

    let physicsCreated = 0;

    // Strategy: create individual static trimesh aggregates per mesh
    // with world transforms baked in to avoid hierarchy transform issues
    for (const mesh of geometryMeshes) {
      try {
        // Clone the mesh to bake world transform without altering the visual
        const clone = mesh.clone(`${mesh.name}_collider`, null);
        if (!clone) continue;

        // Bake the full world transform into vertex data
        clone.computeWorldMatrix(true);
        clone.bakeCurrentTransformIntoVertices();
        // Detach from any parent so physics body sits at world origin
        clone.parent = null;
        clone.position.copyFromFloats(0, 0, 0);
        if (clone.rotationQuaternion) {
          clone.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
        } else {
          clone.rotation.copyFromFloats(0, 0, 0);
        }
        clone.scaling.copyFromFloats(1, 1, 1);
        // Make the collision clone invisible
        clone.isVisible = false;

        const agg = new PhysicsAggregate(
          clone, PhysicsShapeType.MESH,
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

  _createFallbackGround() {
    console.warn("[realtime] Creating test box arena (200×200 floor + 4 walls)");
    const HALF = 100; // 200×200 total
    const WALL_H = 6;
    const WALL_T = 1;

    // ── Floor ──
    const ground = MeshBuilder.CreateGround("test-box-floor", { width: HALF * 2, height: HALF * 2 }, this.scene);
    const floorMat = new StandardMaterial("test-box-floor-mat", this.scene);
    floorMat.diffuseColor = new Color3(0.35, 0.35, 0.4);
    ground.material = floorMat;
    const groundAgg = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, this.scene);
    applyFilterToAggregate(groundAgg, FILTER.TRACK);

    // ── Grid lines on floor ──
    const gridMat = new StandardMaterial("test-box-grid-mat", this.scene);
    gridMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
    gridMat.alpha = 0.4;
    gridMat.wireframe = true;
    const gridPlane = MeshBuilder.CreateGround("test-box-grid", { width: HALF * 2, height: HALF * 2, subdivisions: 20 }, this.scene);
    gridPlane.position.y = 0.02;
    gridPlane.material = gridMat;

    // ── Walls ──
    const wallMat = new StandardMaterial("test-box-wall-mat", this.scene);
    wallMat.diffuseColor = new Color3(0.6, 0.15, 0.15);
    wallMat.alpha = 0.7;

    const wallDefs = [
      { name: "wall-N", w: HALF * 2, h: WALL_H, d: WALL_T, x: 0,      y: WALL_H / 2, z: -HALF },
      { name: "wall-S", w: HALF * 2, h: WALL_H, d: WALL_T, x: 0,      y: WALL_H / 2, z:  HALF },
      { name: "wall-E", w: WALL_T,   h: WALL_H, d: HALF * 2, x:  HALF, y: WALL_H / 2, z: 0     },
      { name: "wall-W", w: WALL_T,   h: WALL_H, d: HALF * 2, x: -HALF, y: WALL_H / 2, z: 0     },
    ];
    for (const wd of wallDefs) {
      const wall = MeshBuilder.CreateBox(wd.name, { width: wd.w, height: wd.h, depth: wd.d }, this.scene);
      wall.position.set(wd.x, wd.y, wd.z);
      wall.material = wallMat;
      const wallAgg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0.5 }, this.scene);
      applyFilterToAggregate(wallAgg, FILTER.TRACK);
    }
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

          this._createTrackPhysics(result);

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

    // ── Kill-plane boundary below the track ──
    const killPlane = MeshBuilder.CreateGround("kill-plane", { width: 2000, height: 2000 }, this.scene);
    killPlane.position.y = -80;
    killPlane.isVisible = false;
    const killAgg = new PhysicsAggregate(killPlane, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
    applyFilterToAggregate(killAgg, FILTER.BOUNDARY);
    killPlane._isBoundary = true;

    // Save spawn positions from track info for later use
    const customSpawns = customTrackParsed?.startPositions;
    const spawnPositions = customSpawns?.length
      ? customSpawns.map(sp => sp.position || sp)
      : (trackInfo.startPositions || [{ x: 0, y: 5, z: 0 }]);
    this._spawnPos = spawnPositions[0] || { x: 0, y: 5, z: 0 };

    // Per-arena kart scale override (e.g. blockfort needs much smaller karts)
    this._arenaKartScale = trackInfo.kartScale || null;

    const kartInfo = resolveKartAsset(options.kartId);
    try {
      console.log(`[realtime] Loading local player kart (id: ${kartInfo.id}, color: ${options.playerColor})...`);
      let pathStr = kartInfo.modelPath;
      if (kartInfo.id === "default" && options.playerColor) {
         pathStr = `/models/car_${options.playerColor}.glb`;
      }
      const pathParts = pathStr.split('/');
      const filename = pathParts.pop();
      const result = await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene);
      this.localMesh = result.meshes[0];
      this.localMesh.name = "local-player";
      this._gloKit = createGloUnderglow(this.scene, this.localMesh, {
        effect: options.gloEffect, color: options.gloColor, color2: options.gloColor2, id: 'local',
      });
      // Use track's start position (slightly above to let physics settle)
      this.localMesh.position = new Vector3(
        this._spawnPos.x,
        (this._spawnPos.y || 1) + 2,
        this._spawnPos.z
      );
      
      let extents = new Vector3(1.8, 0.5, 3.2); // Default kart size
      // Arena kartScale overrides the kart's own scale so all karts fit the map
      const effectiveScale = this._arenaKartScale || (kartInfo.scale && kartInfo.scale !== 1 ? kartInfo.scale : null);
      if (effectiveScale) {
         this.localMesh.scaling = new Vector3(effectiveScale, effectiveScale, effectiveScale);
         this.localMesh.computeWorldMatrix(true);
         extents = extents.scale(effectiveScale);
      }

      this._localKartExtents = extents;
      this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: extents }, this.scene);
      // Restrict unwanted tipping temporarily while mapping to primitive controls
      this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
      applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
      this.localKartAggregate.body.setCollisionCallbackEnabled(true);

      // ── Pre-match: hide kart & freeze physics until matchLive fires ──
      // This prevents the "kart falling from sky" visual during countdown.
      this.localMesh.isVisible = false;
      this.localMesh.getChildMeshes(false).forEach(m => { m.isVisible = false; });
      this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
      this._kartReady = false;
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.kartLoaded = true;
        window.__gloDebug.spawnPos = { x: this._spawnPos.x, y: this._spawnPos.y, z: this._spawnPos.z };
        window.__gloDebug.effectiveKartScale = effectiveScale;
      }

      // Cache wheel child meshes so we can animate their spin each frame
      this._wheelMeshes = result.meshes.filter(
        m => m.name && /wheel/i.test(m.name) && m.getTotalVertices && m.getTotalVertices() > 0
      );

      this.camera.lockedTarget = this.localMesh;

    } catch (e) {
      console.error("[realtime] Kart loading failed: ", e);
      this.localMesh = MeshBuilder.CreateBox("localCar", { size: 1.8 }, this.scene);
      this.localMesh.position = new Vector3(this._spawnPos.x, (this._spawnPos.y || 1) + 0.5, this._spawnPos.z);
      const fbScale = this._arenaKartScale || 1;
      this._localKartExtents = new Vector3(1.8 * fbScale, 0.5 * fbScale, 3.2 * fbScale);
      this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: this._localKartExtents }, this.scene);
      this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
      applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
      this.localKartAggregate.body.setCollisionCallbackEnabled(true);
      // Pre-match hide + static
      this.localMesh.isVisible = false;
      this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
      this._kartReady = false;
      this.camera.lockedTarget = this.localMesh;
      this._gloKit = createGloUnderglow(this.scene, this.localMesh, {
        effect: options.gloEffect, color: options.gloColor, color2: options.gloColor2, id: 'local',
      });
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
    await this.loadSceneAssets(joinOptions);

    // Init particle system for drift sparks / boost flames (Task 3.3.4)
    initParticles(this.scene);

    // Init minimap for race mode
    if (joinOptions.gameMode !== "battle") {
      try { createMinimap(joinOptions.trackId || 'test_box', this.scene); } catch (_) {}
    }

    this.room = await this.client.joinOrCreate(this.roomName, joinOptions);
    this._joinOptions = joinOptions;
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.roomJoined = true;
      window.__gloDebug.sessionId = this.room.sessionId;
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
          // Physics-based item pickup → replaces old manual distance check
          this.room.send("pickupItem", { entityId });
        }
        // Projectile/trap trigger hits are handled server-side (tickProjectiles)
        // but could be used for client-side prediction in Phase 2
      });
    }

    // Handle the 'joined' acknowledgment from the game room
    this.room.onMessage("joined", (msg) => {
      console.log("[realtime] Joined game room:", msg);
    });

    // Handle countdown sequence from server
    this.room.onMessage("startSequence", (msg) => {
      console.log("[realtime] Start sequence — match begins in", msg.durationMs, "ms");
      const totalSec = Math.round(msg.durationMs / 1000);
      // Prematch lobby countdown covers the full duration;
      // the classic 3-2-1 overlay fires in the last 3 seconds.
      PrematchLobby.startCountdown(totalSec);
      // Play the audio countdown beeps in the last 3 seconds (no visual overlay —
      // the prematch lobby countdown already provides the visual).
      const overlayDelay = Math.max(0, msg.durationMs - 3500);
      setTimeout(() => {
        playCountdownSequence();
      }, overlayDelay);
    });

    // Handle match going live
    this.room.onMessage("matchLive", (msg) => {
      console.log("[realtime] Match is LIVE!");
      this.started = true;
      // Hide prematch lobby if still visible
      if (PrematchLobby.isVisible()) PrematchLobby.hide();
      this._showGoOverlay();

      // ── Reveal local kart and activate physics ──
      // Snap to spawn, show mesh, switch from STATIC → DYNAMIC so physics can run.
      if (this.localMesh) {
        if (this._spawnPos) {
          this.localMesh.position.copyFromFloats(
            this._spawnPos.x,
            (this._spawnPos.y || 1) + 0.5,
            this._spawnPos.z
          );
          if (this.localMesh.rotationQuaternion) {
            this.localMesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
          }
        }
        this.localMesh.isVisible = true;
        this.localMesh.getChildMeshes(false).forEach(m => { m.isVisible = true; });
      }
      if (this.localKartAggregate?.body) {
        this.localKartAggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
        this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
        this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
        this.localKartAggregate.body.disablePreStep = false;
      }
      this._kartReady = true;
      // Reveal the GLO underglow now
      setGloVisible(this._gloKit, true);
      if (typeof window !== 'undefined' && window.__gloDebug) {
        window.__gloDebug.kartVisible = true;
        window.__gloDebug.matchLive = true;
      }
      // Initialise lap HUD for race mode; set a cooldown to avoid
      // immediate finish-line trigger from the start position.
      if (this.roomName === 'race_room') {
        this._totalLaps = this.room?.state?.totalLaps || 3;
        this._lapCount = 0;
        this._raceFinished = false;
        this._lapCooldownUntil = Date.now() + 8000; // 8s grace after GO
        this._initLapHud();
        this._updateLapHud();
      }
    });

    this.room.onStateChange((state) => {
      this.started = !!state?.started;
      this.authoritativeState = state;
      this.reconcile(state);
      this.syncRemoteMeshes(state);
      this.syncEntities(state);
      if (typeof window !== 'undefined' && window.__gloDebug && state?.players) {
        window.__gloDebug.playerCount = state.players.size;
      }

      // Keep prematch lobby player grid in sync
      if (PrematchLobby.isVisible() && state?.players) {
        PrematchLobby.updatePlayers(state, this.room.sessionId);
      }

      // Start engine sound + BGM when match begins
      if (this.started && !this._audioStarted) {
        this._audioStarted = true;
        startEngineSound();
        playTrackMusic(joinOptions.trackId || 'test_box');
      }
    });

    this.room.onMessage("itemReceived", (msg) => {
      console.log("[colyseus] Item received!", msg);
      this.currentWeapon = msg.weapon || "";
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastWeaponReceived = msg.weapon;
      this.updateWeaponHud();
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

    this.room.onMessage("projectileFired", (msg) => {
      console.log("[colyseus] Projectile fired:", msg.subType, "by", msg.ownerId);
      playWeaponFireSFX(msg.subType);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastWeaponFired = msg.subType;
    });

    this.room.onMessage("projectileHit", (msg) => {
      console.log("[colyseus] Projectile hit:", msg.victimId, "for", msg.damage, "dmg", msg.subType);
      playWeaponHitSFX(msg.subType);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastHitVictimId = msg.victimId;
      // If we got hit, flash the screen red briefly
      if (this.room && msg.victimId === this.room.sessionId) {
        this.flashDamage();
        playSFX('crash');
      }
    });

    this.room.onMessage("effectApplied", (msg) => {
      console.log("[colyseus] Effect applied:", msg.type, "on", msg.target);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastEffect = msg.type;
      if (this.room && msg.target === this.room.sessionId) {
        this.showEffectOverlay(msg.type, msg.duration || 2000);
      }
    });

    this.room.onMessage("shieldAbsorbed", (msg) => {
      console.log("[colyseus] Shield absorbed hit for", msg.victimId);
      if (this.room && msg.victimId === this.room.sessionId) {
        this.flashShield();
      }
    });

    // ── Kill feed for battle mode ─────────────────────────────────────────
    this.room.onMessage("playerKilled", (msg) => {
      this._addKillFeedEntry(msg.attackerName, msg.victimName, msg.weapon);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.lastKill = msg;
    });

    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
      if (typeof window !== 'undefined' && window.__gloDebug) window.__gloDebug.matchEnded = msg;
      stopEngineSound();
      stopBGM();
      playSFX(msg?.mode === 'race' ? 'race_win' : 'race_finish');
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

    // Auto-start the match — the server room waits for a "start" message
    // to begin the countdown. Wait 6 s so all players have time to load
    // assets, connect to Colyseus, and be present before the countdown fires.
    setTimeout(() => {
      if (this.room) {
        console.log("[realtime] Sending auto-start to game room...");
        this.room.send("start", {});
      }
    }, 6000);

    return this.room;
  }

  setupInputLoop() {
    // Track pressed keys
    this._onKeyDown = (e) => { this._keys[e.code] = true; };
    this._onKeyUp   = (e) => { this._keys[e.code] = false; };
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup",   this._onKeyUp);

    // Per-frame input polling → sendInput()
    this.scene.registerBeforeRender(() => {
      if (!this.localMesh || !this.room) return;

      // Block all input/physics until the match goes LIVE (avoids pre-match kart movement)
      if (!this._kartReady) return;

      const k = this._keys;
      const throttle = (k["KeyW"] || k["ArrowUp"] ? 1 : 0) + (k["KeyS"] || k["ArrowDown"] ? -1 : 0);
      const steer    = (k["KeyA"] || k["ArrowLeft"] ? 1 : 0) + (k["KeyD"] || k["ArrowRight"] ? -1 : 0);
      const brake    = !!(k["Space"] || k["ShiftLeft"] || k["ShiftRight"]);
      const fire     = !!(k["KeyE"] || k["Enter"]);

      // Only send if there is actual input (or we need to stop)
      if (throttle !== 0 || steer !== 0 || brake || fire || this._wasSendingInput) {
        this.sendInput({ throttle, steer, brake, fire });
        this._wasSendingInput = (throttle !== 0 || steer !== 0 || brake);
      }

      // Engine pitch reflects speed
      if (this.localKartAggregate?.body) {
        const vel = this.localKartAggregate.body.getLinearVelocity();
        const speed = vel ? Math.sqrt(vel.x * vel.x + vel.z * vel.z) : 0;
        updateEnginePitch(speed);

        // ── Wheel spin animation: rotate cached wheel meshes proportional to speed ──
        if (this._wheelMeshes.length > 0) {
          const wDt  = this.engine.getDeltaTime() / 1000;
          const rotAmt = speed * wDt * 2.5; // 2.5 rad/m — visible at low speed too
          for (const wm of this._wheelMeshes) {
            wm.rotation.x -= rotAmt;
          }
        }
      }

      // Out-of-bounds respawn
      if (this.localMesh && this.localMesh.position.y < -60 && this._spawnPos) {
        this._respawnLocalKart();
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

  /** Respawn the local kart at the spawn position */
  _respawnLocalKart() {
    if (!this.localMesh || !this.localKartAggregate?.body) return;
    const sp = this._spawnPos || { x: 0, y: 5, z: 0 };
    this.localMesh.position.copyFromFloats(sp.x, (sp.y || 1) + 3, sp.z);
    if (this.localMesh.rotationQuaternion) {
      this.localMesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
    }
    this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
    this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
    this.localKartAggregate.body.disablePreStep = false;
    console.log("[realtime] Respawned local kart at spawn position");
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
      });

      // Title
      const title = document.createElement('div');
      const isRace = msg?.mode === 'race';
      title.textContent = isRace ? '🏁 RACE OVER' : '⚔️  MATCH OVER';
      Object.assign(title.style, {
        fontSize: 'clamp(2rem, 7vw, 4rem)',
        textShadow: '0 0 30px rgba(255,200,0,0.7)',
        marginBottom: '8px',
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

      // Standings table
      const standings = msg?.standings || [];
      if (standings.length > 0) {
        const table = document.createElement('div');
        Object.assign(table.style, {
          display: 'flex', flexDirection: 'column', gap: '6px',
          marginTop: '8px', width: '100%', maxWidth: '420px',
        });
        standings.forEach((entry, i) => {
          const row = document.createElement('div');
          const medal = ['🥇','🥈','🥉'][i] || `${i+1}.`;
          const stat = isRace
            ? (entry.finished ? `Finished` : `Lap ${entry.lap}`)
            : `${entry.score ?? 0} kills`;
          row.textContent = `${medal}  ${entry.name}  —  ${stat}`;
          Object.assign(row.style, {
            background: i === 0 ? 'rgba(255,200,0,0.15)' : 'rgba(255,255,255,0.07)',
            padding: '6px 16px',
            borderRadius: '6px',
            fontSize: 'clamp(0.9rem, 2.5vw, 1.2rem)',
            color: i === 0 ? '#ffd700' : '#ccc',
          });
          table.appendChild(row);
        });
        screen.appendChild(table);
      }

      // Return to lobby button
      const btn = document.createElement('button');
      btn.textContent = 'RETURN TO LOBBY';
      Object.assign(btn.style, {
        marginTop: '24px',
        padding: '12px 36px',
        fontSize: 'clamp(1rem, 3vw, 1.5rem)',
        fontFamily: "'Bungee', Impact, sans-serif",
        background: 'linear-gradient(135deg, #ff0080, #7700ff)',
        color: '#fff',
        border: 'none',
        borderRadius: '12px',
        cursor: 'pointer',
        letterSpacing: '0.05em',
        boxShadow: '0 0 20px rgba(255,0,128,0.4)',
      });
      btn.addEventListener('click', () => { window.location.href = '/index.html'; });
      screen.appendChild(btn);

      document.body.appendChild(screen);
    }, 1200);
  }

  /** Visual countdown overlay: 3 → 2 → 1 → GO! */
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
      transition: "transform 0.3s ease-out, opacity 0.3s ease-out",
    });
    overlay.appendChild(num);
    document.body.appendChild(overlay);
    this._countdownEl = overlay;

    const steps = Math.floor(durationMs / 1000);
    let remaining = steps;

    const tick = () => {
      if (remaining <= 0) {
        overlay.remove();
        this._countdownEl = null;
        return;
      }
      num.textContent = String(remaining);
      num.style.transform = "scale(1.5)";
      num.style.opacity = "1";
      // Quick scale-down animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          num.style.transform = "scale(1)";
        });
      });
      // Fade towards end of each second
      setTimeout(() => {
        num.style.opacity = "0.3";
      }, 700);
      remaining--;
      setTimeout(tick, 1000);
    };
    tick();
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

  sendInput(input) {
    if (!this.room || !this.localMesh) return;

    const seq = ++this.inputSeq;
    const { position, rotationQuaternion } = this.localMesh;
    
    if (!rotationQuaternion) {
        this.localMesh.rotationQuaternion = new Quaternion();
    }

    const payload = {
      seq,
      throttle: Number(input.throttle || 0),
      steer: Number(input.steer || 0),
      brake: Number(input.brake || 0),
      fire: !!input.fire,
      x: position.x,
      y: position.y,
      z: position.z,
      rx: this.localMesh.rotationQuaternion.x,
      ry: this.localMesh.rotationQuaternion.y,
      rz: this.localMesh.rotationQuaternion.z,
      rw: this.localMesh.rotationQuaternion.w,
    };

    this.checkLocalCollisions();
    this.applyLocalPrediction(payload);
    this.pendingInputs.push(payload);
    this.room.send("input", payload);

    // If the fire key is pressed and we have a weapon, request firing
    if (input.fire && this.currentWeapon) {
      this.room.send("fireWeapon", {});
      this.currentWeapon = "";  // optimistic clear
      this.updateWeaponHud();
    }
  }

  checkLocalCollisions() {
    // When Havok physics triggers are active, item pickup is handled by
    // onTriggerCollisionObservable. Fall back to manual distance check
    // only when physics triggers are unavailable.
    if (this.havokPlugin) return;
    if (!this.authoritativeState?.entities || !this.localMesh) return;
    const localPos = this.localMesh.position;
    this.authoritativeState.entities.forEach((entity, id) => {
      if (entity.active && entity.type === 'item_box') {
        const dx = localPos.x - entity.x;
        const dy = localPos.y - entity.y;
        const dz = localPos.z - entity.z;
        const distSq = dx*dx + dy*dy + dz*dz;
        if (distSq < 16) { // 4m radius
           this.room.send('pickupItem', { entityId: id });
           entity.active = false;
        }
      }
    });
  }

  applyLocalPrediction(input) {
    if (!this.localMesh || !this.localKartAggregate) return;

    const body = this.localKartAggregate.body;
    const transform = this.localMesh;
    const dt = 1 / 60;

    let currentVel = body.getLinearVelocity();
    let currentAngVel = body.getAngularVelocity();
    if (
      !Number.isFinite(currentVel.x) ||
      !Number.isFinite(currentVel.y) ||
      !Number.isFinite(currentVel.z) ||
      !Number.isFinite(currentAngVel.x) ||
      !Number.isFinite(currentAngVel.y) ||
      !Number.isFinite(currentAngVel.z)
    ) {
      body.setLinearVelocity(new Vector3(0, 0, 0));
      body.setAngularVelocity(new Vector3(0, 0, 0));
      return;
    }
    
    // Ensure body continues to process forces
    body.disablePreStep = false;
    
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

    // ── Mario Kart-inspired kart tuning (modified by active effects) ──
    const MAX_SPEED      = 35 * spdMult;
    const ACCEL_FORCE    = 55 * spdMult;
    const TURN_BASE      = 3.0 * strMult;
    const TURN_MIN       = 1.0;
    const LATERAL_GRIP   = 0.70;
    const DRIFT_GRIP_MUL = 0.35;
    const DOWNFORCE      = 20;
    const COAST_DRAG     = 0.96;
    const BRAKE_DRAG     = 0.88;
    const ROLL_DAMP      = 0.85;
    const PITCH_DAMP     = 0.85;
    const YAW_COAST_DAMP = 0.70;

    const hSpeed = Math.sqrt(currentVel.x ** 2 + currentVel.z ** 2);
    const speedRatio = Math.min(hSpeed / MAX_SPEED, 1);

    // 1. ── Steering: speed-dependent (full turn at low speed, reduced at top speed) ──
    const turnSpeed = TURN_BASE - (TURN_BASE - TURN_MIN) * speedRatio;

    if (input.steer !== 0 && hSpeed > 0.5) {
      const fwd = transform.forward.scale(-1);
      const isReversing = Vector3.Dot(currentVel, fwd) < -1;
      const dir = isReversing ? -1 : 1;
      const driftBoost = input.brake ? 1.3 : 1.0;
      const targetYaw = input.steer * turnSpeed * dir * driftBoost;

      body.setAngularVelocity(new Vector3(
        currentAngVel.x * ROLL_DAMP,
        targetYaw,
        currentAngVel.z * PITCH_DAMP
      ));
    } else {
      // Smooth yaw decay + always dampen roll/pitch
      body.setAngularVelocity(new Vector3(
        currentAngVel.x * ROLL_DAMP,
        currentAngVel.y * YAW_COAST_DAMP,
        currentAngVel.z * PITCH_DAMP
      ));
    }

    let nextVel = new Vector3(currentVel.x, currentVel.y, currentVel.z);

    // ── Mini-turbo drift charge (Task 3.3) ──
    const MINI_TURBO_CHARGE_RATE = 1.5;
    const MINI_TURBO_TIER1       = 1.0;
    const MINI_TURBO_TIER2       = 2.2;
    const MINI_TURBO_BOOST_T1    = 0.4;
    const MINI_TURBO_BOOST_T2    = 0.8;
    const MINI_TURBO_SPEED_MUL   = 1.35;

    const isDrifting = input.brake && input.steer !== 0 && hSpeed > 5;
    if (isDrifting) {
      this._driftCharge += MINI_TURBO_CHARGE_RATE * dt;
    }
    if (this._wasDrifting && !isDrifting && this._driftCharge > 0) {
      if (this._driftCharge >= MINI_TURBO_TIER2) {
        this._miniBoostTimer = MINI_TURBO_BOOST_T2;
        this._miniBoostTier = 2;
      } else if (this._driftCharge >= MINI_TURBO_TIER1) {
        this._miniBoostTimer = MINI_TURBO_BOOST_T1;
        this._miniBoostTier = 1;
      }
      this._driftCharge = 0;
    }
    if (!isDrifting && !this._wasDrifting) {
      this._driftCharge = 0;
    }
    this._wasDrifting = isDrifting;
    if (this._miniBoostTimer > 0) this._miniBoostTimer -= dt;
    if (this._miniBoostTimer <= 0) { this._miniBoostTimer = 0; this._miniBoostTier = 0; }
    const boostMul = this._miniBoostTimer > 0 ? MINI_TURBO_SPEED_MUL : 1.0;

    // ── Drift / boost audiovisual feedback (Task 3.3.4) ──
    const driftTier = isDrifting
      ? (this._driftCharge >= MINI_TURBO_TIER2 ? 2 : this._driftCharge >= MINI_TURBO_TIER1 ? 1 : 0)
      : 0;
    const boostActive = this._miniBoostTimer > 0;
    if (driftTier > 0 && driftTier !== this._prevDriftTier) playSFX('skid', 0.5);
    if (boostActive && !this._prevBoostActive) playSFX('boost', 0.7);
    this._prevDriftTier = driftTier;
    this._prevBoostActive = boostActive;

    // Update particles (sparks / flames) for local kart
    if (this.localMesh) {
      updateParticles(dt, this.localMesh, {
        isDrifting,
        sparksLevel: driftTier,
        isBoosting: boostActive,
      });
    }

    // 2. ── Acceleration with progressive falloff (quadratic taper near max) ──
    let forwardDir = transform.forward.scale(-1);
    if (forwardDir.lengthSquared() > 0.00001) {
      forwardDir.normalize();
    } else {
      forwardDir.copyFromFloats(0, 0, 1);
    }

    if (input.throttle > 0 && hSpeed < MAX_SPEED * boostMul) {
      const falloff = 1 - speedRatio * speedRatio;
      const accel = ACCEL_FORCE * boostMul * Math.max(falloff, 0.08) * dt;
      nextVel.x += forwardDir.x * accel;
      nextVel.z += forwardDir.z * accel;
    } else if (input.throttle < 0) {
      // Reverse is slower
      const accel = ACCEL_FORCE * 0.4 * dt;
      nextVel.x -= forwardDir.x * accel;
      nextVel.z -= forwardDir.z * accel;
    }

    // 3. ── Braking & coasting drag ──
    if (input.brake) {
      nextVel.x *= BRAKE_DRAG;
      nextVel.z *= BRAKE_DRAG;
    } else if (input.throttle === 0) {
      nextVel.x *= COAST_DRAG;
      nextVel.z *= COAST_DRAG;
    }

    // 4. ── Lateral grip (counter-slide, planted Mario Kart feel) ──
    let rightDir = transform.right;
    if (rightDir.lengthSquared() > 0.00001) {
      rightDir.normalize();
    } else {
      rightDir = new Vector3(1, 0, 0);
    }
    const latSpeed = Vector3.Dot(nextVel, rightDir);
    const grip = input.brake ? LATERAL_GRIP * DRIFT_GRIP_MUL : LATERAL_GRIP;
    nextVel.x -= rightDir.x * latSpeed * grip;
    nextVel.z -= rightDir.z * latSpeed * grip;

    // 5. ── Downforce: keeps kart planted on terrain, reduces bouncing ──
    if (hSpeed > 3) {
      nextVel.y -= DOWNFORCE * speedRatio * dt;
    }
    // Cap upward bounce for smoother terrain transitions
    if (nextVel.y > 4) nextVel.y = 4;

    body.setLinearVelocity(nextVel);
  }

  reconcile(state) {
    if (!this.localMesh || !state?.players || !this.room) return;
    const self = state.players.get(this.room.sessionId);
    if (!self) return;

    if (!this.localInitializedFromServer) {
      const hasFinitePose =
        Number.isFinite(self.x) && Number.isFinite(self.y) && Number.isFinite(self.z) &&
        Number.isFinite(self.rx) && Number.isFinite(self.ry) && Number.isFinite(self.rz) && Number.isFinite(self.rw);

      if (hasFinitePose) {
        const spawnPos = new Vector3(self.x, self.y, self.z);
        const spawnRot = new Quaternion(self.rx, self.ry, self.rz, self.rw);

        this.localMesh.position.copyFrom(spawnPos);
        this.localMesh.rotationQuaternion = spawnRot;

        if (this.localKartAggregate) {
          this.localKartAggregate.dispose();
        }

        this.localKartAggregate = new PhysicsAggregate(
          this.localMesh,
          PhysicsShapeType.BOX,
          { mass: 800, friction: 0.8, restitution: 0.1, extents: this._localKartExtents || new Vector3(1.8, 0.5, 3.2) },
          this.scene
        );
        if (this.localKartAggregate.body) {
          this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });
          this.localKartAggregate.body.setLinearVelocity(new Vector3(0, 0, 0));
          this.localKartAggregate.body.setAngularVelocity(new Vector3(0, 0, 0));
          applyFilterToAggregate(this.localKartAggregate, FILTER.KART);
          this.localKartAggregate.body.setCollisionCallbackEnabled(true);
          // Keep STATIC until matchLive fires to prevent pre-match kart movement
          if (!this._kartReady) {
            this.localKartAggregate.body.setMotionType(PhysicsMotionType.STATIC);
          }
        }

        this.localInitializedFromServer = true;
      }
    }

    // Pure Client-Authoritative Physics:
    // We DO NOT snap the local player to the server's echoed state.
    // Instead we just keep sending our physics state, and clear old pending inputs.
    // This prevents the visual and physical engine from rubber-banding locally.
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
        
        const kartInfo = resolveKartAsset(playerKartId);
        let pathStr = kartInfo.modelPath;
        if (kartInfo.id === "default" && playerColor) {
           pathStr = `/models/car_${playerColor}.glb`;
        }
        
        const pathParts = pathStr.split('/');
        const filename = pathParts.pop();

        const loadPromise = SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene)
          .then((result) => {
            const realMesh = result.meshes[0];
            realMesh.name = `remote-${id}`;
            realMesh.position = placeholder.position.clone();
            realMesh.rotationQuaternion = placeholder.rotationQuaternion ? placeholder.rotationQuaternion.clone() : new Quaternion();
            
            if (kartInfo.scale && kartInfo.scale !== 1) {
               realMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
            }
            // Arena kartScale overrides individual kart scale for all players in this map
            const effectiveRemoteScale = this._arenaKartScale || (kartInfo.scale && kartInfo.scale !== 1 ? kartInfo.scale : null);
            if (effectiveRemoteScale) {
               realMesh.scaling = new Vector3(effectiveRemoteScale, effectiveRemoteScale, effectiveRemoteScale);
            }
            
            placeholder.dispose();
            this.remoteMeshes.set(id, realMesh);

            // ── Remote kart ANIMATED physics (pushes local kart, unaffected by forces) ──
            try {
              let remoteExtents = new Vector3(1.8, 0.5, 3.2);
              const remoteEffectiveScale = this._arenaKartScale || (kartInfo.scale && kartInfo.scale !== 1 ? kartInfo.scale : 1);
              if (remoteEffectiveScale !== 1) remoteExtents = remoteExtents.scale(remoteEffectiveScale);
              const remoteAgg = new PhysicsAggregate(realMesh, PhysicsShapeType.BOX, {
                mass: 800, friction: 0.8, restitution: 0.1, extents: remoteExtents,
              }, this.scene);
              remoteAgg.body.setMotionType(PhysicsMotionType.ANIMATED);
              remoteAgg.body.disablePreStep = false;  // body follows mesh transform
              applyFilterToAggregate(remoteAgg, FILTER.KART);
              this.remoteKartAggregates.set(id, remoteAgg);
            } catch (e) { console.warn(`[realtime] Remote kart physics failed for ${id}:`, e); }

            // ── Cache wheel meshes for remote kart spin animation ──
            const remoteWheels = result.meshes.filter(
              m => m.name && /wheel/i.test(m.name) && m.getTotalVertices && m.getTotalVertices() > 0
            );
            if (remoteWheels.length) this._remoteWheelMeshes.set(id, remoteWheels);

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

            console.log(`[realtime] Loaded remote kart for ${id}`);
          })
          .catch((err) => {
            console.error(`[realtime] Failed to load remote kart for ${id}:`, err);
          });

        this.loadingPromises.set(id, loadPromise);
      } else if (mesh && mesh.position) {
        // Store target for smooth interpolation (lerped in beforeRender)
        this._remoteTargets.set(id, {
          pos: new Vector3(player.x, player.y, player.z),
          rot: new Quaternion(player.rx, player.ry, player.rz, player.rw),
        });
      }
    });

    // Cleanup disconnected players
    for (const [id, mesh] of this.remoteMeshes.entries()) {
      if (!connectedIds.includes(id)) {
        mesh.dispose();
        const remoteAgg = this.remoteKartAggregates.get(id);
        if (remoteAgg) { remoteAgg.dispose(); this.remoteKartAggregates.delete(id); }
        const remoteGlo = this._remoteGloKits.get(id);
        if (remoteGlo) { disposeGloUnderglow(remoteGlo); this._remoteGloKits.delete(id); }
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
          mesh = this._createProjectileMesh(id, entity.subType);
        } else {
          // Item boxes — spinning golden cube
          mesh = MeshBuilder.CreateBox(`entity-${id}`, { size: 1.2 }, this.scene);
          const mat = new StandardMaterial(`mat-${id}`, this.scene);
          mat.diffuseColor = new Color3(1, 0.85, 0);
          mat.emissiveColor = new Color3(0.4, 0.3, 0);
          mesh.material = mat;
        }
        mesh.position = new Vector3(entity.x, entity.y, entity.z);
        // Tag mesh with entity metadata for trigger lookups
        mesh._entityId = id;
        mesh._entityType = entity.type;
        this.entityMeshes.set(id, mesh);

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
          mesh.setEnabled(true);
          mesh.position.x = entity.x;
          mesh.position.y = entity.y;
          mesh.position.z = entity.z;
          // Spin item boxes; bob traps gently
          if (entity.type !== "projectile") {
            mesh.rotation.y += 0.05;
          } else {
            const sub = entity.subType;
            if (sub === "bubblegum" || sub === "banana") {
              // Stationary traps: gentle bob
              mesh.position.y += Math.sin(Date.now() * 0.003) * 0.05;
            }
          }
        } else {
          mesh.setEnabled(false);
        }
      }
    });
    for (const [id, mesh] of this.entityMeshes.entries()) {
      if (!currentEntities.includes(id)) {
        const entAgg = this.entityAggregates.get(id);
        if (entAgg) { entAgg.dispose(); this.entityAggregates.delete(id); }
        mesh.dispose();
        this.entityMeshes.delete(id);
      }
    }
  }

  _createProjectileMesh(id, subType) {
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
      mesh = MeshBuilder.CreateCylinder(`entity-${id}`, { diameter: vis.diameter || 0.3, height: vis.height || 0.7, tessellation: 12 }, this.scene);
    } else {
      mesh = MeshBuilder.CreateSphere(`entity-${id}`, { diameter: vis.diameter || 0.5 }, this.scene);
    }
    const mat = new StandardMaterial(`mat-${id}`, this.scene);
    mat.diffuseColor = new Color3(...vis.diffuse);
    if (vis.emissive) mat.emissiveColor = new Color3(...vis.emissive);
    mesh.material = mat;
    return mesh;
  }

  updateWeaponHud() {
    if (!this.weaponHudEl) {
      this.weaponHudEl = document.createElement("div");
      Object.assign(this.weaponHudEl.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "10px 18px",
        background: "rgba(0,0,0,0.7)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: "18px",
        borderRadius: "8px",
        zIndex: "9999",
        pointerEvents: "none",
        transition: "opacity 0.3s",
      });
      document.body.appendChild(this.weaponHudEl);
    }
    if (this.currentWeapon) {
      const icons = {
        missile: "🚀", bowling_ball: "🎳", shield: "🛡️",
        cake: "🎂", plunger: "🪠", nitro: "💥",
        bubblegum: "🫧", banana: "🍌", swatter: "🪰",
        parachute: "🪂", anchor: "⚓", zipper: "⚡",
      };
      const icon = icons[this.currentWeapon] || "❓";
      this.weaponHudEl.textContent = `${icon} ${this.currentWeapon.replace(/_/g, " ")}`;
      this.weaponHudEl.style.opacity = "1";
    } else {
      this.weaponHudEl.style.opacity = "0";
    }
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
  _addKillFeedEntry(attackerName, victimName, weapon) {
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
      parachute: "🪂", anchor: "⚓", zipper: "⚡", shield: "🛡️",
    };
    const icon = WEAPON_ICONS[weapon] || "💀";
    const row = document.createElement("div");
    Object.assign(row.style, {
      background: "rgba(0,0,0,0.65)", color: "#fff", padding: "4px 10px",
      borderRadius: "6px", whiteSpace: "nowrap",
      transition: "opacity 0.5s", opacity: "1",
    });
    row.textContent = `${attackerName} ${icon} ${victimName}`;
    this._killFeedEl.appendChild(row);
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
      shielded:{ bg: "rgba(80,180,255,0.1)", text: "🛡️ SHIELDED", color: "#55bbff" },
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

  dispose() {
    stopEngineSound();
    stopBGM();
    disposeAudio();
    disposeParticles();

    // Remove keyboard listeners
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    if (this._onKeyUp)   window.removeEventListener("keyup",   this._onKeyUp);
    this._onKeyDown = null;
    this._onKeyUp = null;
    this._keys = {};

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
    this.entityMeshes.forEach((mesh) => mesh.dispose());
    this.entityMeshes.clear();

    if (this.weaponHudEl) {
      this.weaponHudEl.remove();
      this.weaponHudEl = null;
    }
    if (this.effectOverlayEl) {
      this.effectOverlayEl.remove();
      this.effectOverlayEl = null;
    }
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


