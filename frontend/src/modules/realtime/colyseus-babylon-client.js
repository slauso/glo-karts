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
  GlowLayer,
  TrailMesh,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import HavokPhysics from "@babylonjs/havok";
import { resolveTrackAsset, resolveArenaAsset, resolveKartAsset } from "../content-registry.js";
import { FILTER, applyFilterToAggregate } from './collision-layers.js';
import {
  playTrackMusic, playSFX, playWeaponFireSFX, playWeaponHitSFX,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playCountdownSequence, stopBGM, disposeAudio,
} from "../game-audio.js";

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

    // GLO trail (replaces flat disc)
    this._gloTrailMesh = null;
    this._gloTrailMat  = null;
    this._gloPivot     = null;

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

    // GLO trail GlowLayer — rendered at 1/4 resolution, minimal blur kernel
    // so it is safe on low-power devices.
    this.glowLayer = new GlowLayer('glo', this.scene, {
      mainTextureRatio: 0.25,
      blurKernelSize: 32,
    });
    this.glowLayer.intensity = 0.85;
    // Only glow the trail mesh, not the entire scene.
    this.glowLayer.customEmissiveColorSelector = null; // use per-mesh emissive
    this._gloDisc = null;    // legacy ref — kept null, trail replaces disc
    this._gloMat  = null;
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
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), plugin);
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
        Vector3.LerpToRef(mesh.position, target.pos, LERP, mesh.position);
        if (mesh.rotationQuaternion && target.rot) {
          Quaternion.SlerpToRef(mesh.rotationQuaternion, target.rot, LERP, mesh.rotationQuaternion);
        }
      }

      // Animate GLO trail / underglow each frame
      if ((this._gloTrailMat || this._gloMat) && this.localMesh) {
        const mat = this._gloTrailMat || this._gloMat;
        const dt = this.engine.getDeltaTime() / 1000;
        this._gloTime = (this._gloTime || 0) + dt;
        const t = this._gloTime;
        const effect  = this._gloEffect  || 'solid';
        const color   = this._gloColor   || '#ff0080';
        const color2  = this._gloColor2  || '#00e5ff';
        const c1 = Color3.FromHexString(color);
        const c2 = Color3.FromHexString(color2);

        let r = c1.r, g = c1.g, b = c1.b, intens = 0.85;
        switch (effect) {
          case 'pulse': {
            const p = (Math.sin(t * 2.5) + 1) / 2;
            intens = 0.4 + p * 0.6;
            break;
          }
          case 'strobe': {
            intens = Math.floor(t * 8) % 2 === 0 ? 1.0 : 0.1;
            break;
          }
          case 'rainbow': {
            const hue = (t * 60) % 360;
            const rgb = _hslToRgb(hue / 360, 1, 0.5);
            r = rgb[0]; g = rgb[1]; b = rgb[2];
            break;
          }
          case 'two-color': {
            const blend = (Math.sin(t * 3) + 1) / 2;
            r = c1.r + (c2.r - c1.r) * blend;
            g = c1.g + (c2.g - c1.g) * blend;
            b = c1.b + (c2.b - c1.b) * blend;
            break;
          }
          case 'chase': {
            const on = Math.floor(t * 4) % 2 === 0;
            r = on ? c1.r : c2.r;
            g = on ? c1.g : c2.g;
            b = on ? c1.b : c2.b;
            break;
          }

          // ── Themed scene effects ───────────────────────────────────────────
          case 'sunrise': {
            const _c = _bGradColors(['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.75 + 0.25 * Math.sin(t * 0.4);
            break;
          }
          case 'sunset': {
            const _c = _bGradColors(['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.8 + 0.2 * Math.sin(t * 0.5);
            break;
          }
          case 'sunset-glow': {
            const _c = _bGradColors(['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5));
            break;
          }
          case 'spring': {
            const _c = _bGradColors(['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5));
            break;
          }
          case 'aurora': {
            const _c = _bGradColors(['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2));
            break;
          }
          case 'full-rainbow': {
            const rgb = _hslToRgb((t * 0.3) % 1, 1.0, 0.52);
            r = rgb[0]; g = rgb[1]; b = rgb[2];
            intens = 0.85 + 0.15 * Math.sin(t * 2.0);
            break;
          }
          case 'forest': {
            const _c = _bGradColors(['#003300','#116611','#335522','#005500','#224422'], t / 12);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7));
            break;
          }
          case 'ocean': {
            const _c = _bGradColors(['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.75 + 0.25 * Math.sin(t * 1.2);
            break;
          }
          case 'snowing': {
            const _c = _bGradColors(['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4);
            r = _c.r; g = _c.g; b = _c.b;
            intens = (0.65 + 0.2 * Math.sin(t * 2.0)) * (Math.random() > 0.96 ? 1.45 : 1.0);
            break;
          }
          case 'spring-wind': {
            const _c = _bGradColors(['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2));
            break;
          }
          case 'cloudy': {
            const _c = _bGradColors(['#667788','#778899','#99aabb','#778899'], t / 20);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.4 + 0.25 * Math.sin(t * 0.6);
            break;
          }
          case 'firefly': {
            const fTick = Math.floor(t * 7);
            const fOn   = ((fTick * 1013 + fTick * fTick * 997) % 17) < 2;
            if (fOn) { r = 1.0; g = 1.0; b = 0.53; intens = 1.0 + 0.4 * Math.sin(t * 45); }
            else     { r = 0;   g = 0.13; b = 0;    intens = 0.04; }
            break;
          }
          case 'fire': {
            const _c = _bGradColors(['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.6 + 0.4 * Math.random();
            break;
          }
          case 'waterfall': {
            const _c = _bGradColors(['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0));
            break;
          }
          case 'falling-petals': {
            const _c = _bGradColors(['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5));
            break;
          }
          case 'wave': {
            const _c = _bGradColors(['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8));
            break;
          }
          case 'raining': {
            const _c = _bGradColors(['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random();
            break;
          }
          case 'falling-leaves': {
            const _c = _bGradColors(['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8));
            break;
          }
          case 'river': {
            const _c = _bGradColors(['#005566','#007788','#009999','#44aaaa','#007788'], t / 5);
            r = _c.r; g = _c.g; b = _c.b;
            intens = 0.75 + 0.25 * Math.sin(t * 1.5);
            break;
          }
          case 'water-drop': {
            const wPhase = (t % 1.5) / 1.5;
            r = 0; g = 0.6; b = 0.93;
            intens = Math.exp(-wPhase * 5) * 0.95 + 0.05;
            break;
          }

          default: break; // solid
        }

        mat.emissiveColor.set(r, g, b);
        this.glowLayer.intensity = intens;
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
    console.warn("[realtime] Using fallback ground plane");
    const ground = MeshBuilder.CreateGround("fallback-ground", { width: 500, height: 500 }, this.scene);
    const mat = new StandardMaterial("fallback-ground-mat", this.scene);
    mat.diffuseColor = new Color3(0.25, 0.25, 0.25);
    mat.alpha = 0.3;
    ground.material = mat;
    const agg = new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.6 }, this.scene);
    applyFilterToAggregate(agg, FILTER.TRACK);
  }

  async loadSceneAssets(options) {
    let trackInfo;
    if (options.gameMode === "battle") {
      trackInfo = resolveArenaAsset(options.trackId);
    } else {
      trackInfo = resolveTrackAsset(options.trackId);
    }

    try {
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
    const spawnPositions = trackInfo.startPositions || [{ x: 0, y: 5, z: 0 }];
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
      this._createGloUnderglow(options.gloEffect, options.gloColor, options.gloColor2);
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
      this._createGloUnderglow(options.gloEffect, options.gloColor, options.gloColor2);
    }
  }

  /**
   * Create a dynamic trailing ribbon (TrailMesh) that follows the kart's
   * rear undercarriage and glows via GlowLayer.  Far more visually appealing
   * than the previous flat disc — the trail moves with the kart and fades
   * out using alpha blending.
   */
  _createGloUnderglow(effect, color, color2) {
    const hexColor  = color  || '#ff0080';
    const hexColor2 = color2 || '#00e5ff';
    const c1 = Color3.FromHexString(hexColor);

    // Invisible pivot at the rear underside of the kart — this is the point
    // the TrailMesh traces as the kart moves.
    const pivot = MeshBuilder.CreateSphere('glo-pivot', { diameter: 0.01, segments: 2 }, this.scene);
    pivot.isPickable = false;
    pivot.isVisible  = false;
    pivot.parent     = this.localMesh;
    pivot.position.set(0, -0.28, 1.4);  // rear undercarriage

    // TrailMesh: a ribbon that records the last `length` positions of the pivot.
    // diameter = ribbon width (world-space), length = number of history segments.
    const trail = new TrailMesh('glo-trail', pivot, this.scene, 0.65, 50, true);
    trail.isPickable = false;

    const mat = new StandardMaterial('glo-trail-mat', this.scene);
    mat.emissiveColor    = c1.clone();
    mat.disableLighting  = true;
    mat.alpha            = 0.75;
    mat.backFaceCulling  = false;
    trail.material       = mat;

    // Only let the GlowLayer illuminate the trail, not the whole scene.
    this.glowLayer.addIncludedOnlyMesh(trail);

    // Pre-match: trail also hidden until GO
    trail.isVisible = false;

    this._gloTrailMesh = trail;
    this._gloTrailMat  = mat;
    this._gloPivot     = pivot;
    this._gloEffect    = effect  || 'solid';
    this._gloColor     = hexColor;
    this._gloColor2    = hexColor2;
    this._gloTime      = 0;

    // Clear legacy disc refs in case any code still checks them
    this._gloDisc = null;
    this._gloMat  = null;
  }

  async connect(options = {}) {
    const joinOptions = {
        playerName: options.playerName || this.playerName,
        maxPlayers: options.maxPlayers || this.maxPlayers,
        gameMode: options.gameMode || "race",
        gameType: options.gameType || this.gameType,
        trackId: options.trackId || "cocoa_temple",
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

    this.room = await this.client.joinOrCreate(this.roomName, joinOptions);
    if (typeof window !== 'undefined' && window.__gloDebug) {
      window.__gloDebug.roomJoined = true;
      window.__gloDebug.sessionId = this.room.sessionId;
      window.__gloClient = this;
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
      playCountdownSequence();
      this._showCountdownOverlay(msg.durationMs);
    });

    // Handle match going live
    this.room.onMessage("matchLive", (msg) => {
      console.log("[realtime] Match is LIVE!");
      this.started = true;
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
      // Reveal the GLO trail now
      if (this._gloTrailMesh) this._gloTrailMesh.isVisible = true;
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

      // Start engine sound + BGM when match begins
      if (this.started && !this._audioStarted) {
        this._audioStarted = true;
        startEngineSound();
        playTrackMusic(joinOptions.trackId || 'cocoa_temple');
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

    // 2. ── Acceleration with progressive falloff (quadratic taper near max) ──
    let forwardDir = transform.forward.scale(-1);
    if (forwardDir.lengthSquared() > 0.00001) {
      forwardDir.normalize();
    } else {
      forwardDir.copyFromFloats(0, 0, 1);
    }

    if (input.throttle > 0 && hSpeed < MAX_SPEED) {
      const falloff = 1 - speedRatio * speedRatio;
      const accel = ACCEL_FORCE * Math.max(falloff, 0.08) * dt;
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
    // Dispose GLO trail resources
    if (this._gloTrailMesh) { this._gloTrailMesh.dispose(); this._gloTrailMesh = null; }
    if (this._gloPivot)     { this._gloPivot.dispose();     this._gloPivot = null; }
    this._gloTrailMat  = null;
    this._gloDisc      = null;
    this._gloMat       = null;
    this._wheelMeshes  = [];
    document.getElementById('_glo-match-end')?.remove();

    this.havokPlugin = null;
    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }
}

/**
 * Tiny HSL→RGB helper used by the GLO rainbow effect.
 * h in [0,1], s in [0,1], l in [0,1] → [r, g, b] each in [0,1]
 */
function _hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

/**
 * Smoothly blend through an array of hex colour stops (Babylon Color3 edition).
 * @param {string[]} hexArr  - colour stops
 * @param {number}   t       - normalised time [0, 1) — use elapsed / period
 * @returns {{ r:number, g:number, b:number }}
 */
function _bGradColors(hexArr, t) {
  const n = hexArr.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const a = Color3.FromHexString(hexArr[i]);
  const bC = Color3.FromHexString(hexArr[(i + 1) % n]);
  return { r: a.r + (bC.r - a.r) * f, g: a.g + (bC.g - a.g) * f, b: a.b + (bC.b - a.b) * f };
}
