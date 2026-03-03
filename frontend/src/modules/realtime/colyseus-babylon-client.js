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
  PhysicsShapeType
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";
import HavokPhysics from "@babylonjs/havok";
import { resolveTrackAsset, resolveArenaAsset, resolveKartAsset } from "../content-registry.js";

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
    this.loadingPromises = new Map();

    this.inputSeq = 0;
    this.pendingInputs = [];
    this.authoritativeState = null;
    this.started = false;
    this.localInitializedFromServer = false;
  }

  async initBabylon(canvas) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.useRightHandedSystem = true; // Phase 1: STK uses right-handed

    // Setup PBR Environment lighting
    this.scene.createDefaultEnvironment({
      createSkybox: false,
      createGround: false,
      enableGroundShadow: true
    });

    // Setup FollowCamera
    this.camera = new FollowCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.radius = 10;
    this.camera.heightOffset = 4;
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.05;
    this.camera.maxCameraSpeed = 20;
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
    } catch (error) {
      console.error("[realtime] Havok init failed, continuing without physics", error);
    }

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });
    window.addEventListener("resize", () => this.engine?.resize());
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
      let pathParts;
      if (trackInfo.arenaPath) {
        pathParts = trackInfo.arenaPath.split('/');
        const filename = pathParts.pop();
        const arenaResult = await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene).catch(e => console.warn(`[realtime] Failed to load arena ${filename}:`, e));
        if (arenaResult && arenaResult.meshes) {
           arenaResult.meshes.forEach(mesh => {
              if (mesh.getTotalVertices() > 0) {
                 new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.5, restitution: 0.1 }, this.scene);
              }
           });
        }
      } else if (trackInfo.trackPath) {
        pathParts = trackInfo.trackPath.split('/');
        const filename = pathParts.pop();
        const trackResult = await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene).catch(e => console.warn(`[realtime] Failed to load track ${filename}:`, e));
        if (trackResult && trackResult.meshes) {
           trackResult.meshes.forEach(mesh => {
              if (mesh.getTotalVertices() > 0) {
                 new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: 0.5, restitution: 0.1 }, this.scene);
              }
           });
        }

        if (trackInfo.decorationsPath) {
          const decParts = trackInfo.decorationsPath.split('/');
          const decFilename = decParts.pop();
          SceneLoader.ImportMeshAsync("", decParts.join('/') + '/', decFilename, this.scene).catch(e => console.warn(`[realtime] Failed to load decorations ${decFilename}:`, e));
        }
      }
    } catch (e) {
      console.error("[realtime] Map loading failed: ", e);
      const fallbackGround = MeshBuilder.CreateGround("ground", { width: 240, height: 240 }, this.scene);
      new PhysicsAggregate(fallbackGround, PhysicsShapeType.BOX, { mass: 0 }, this.scene);
    }

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
      this.localMesh.position = new Vector3(0, 5, 0); // Drop from slightly above ground
      
      let extents = new Vector3(1.8, 0.5, 3.2); // Default kart size
      if (kartInfo.scale && kartInfo.scale !== 1) {
         this.localMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
         this.localMesh.computeWorldMatrix(true);
         extents = extents.scale(kartInfo.scale);
      }

      this._localKartExtents = extents;
      this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1, extents: extents }, this.scene);
      // Restrict unwanted tipping temporarily while mapping to primitive controls
      this.localKartAggregate.body.setMassProperties({ inertia: new Vector3(0, 500, 0) });

      this.camera.lockedTarget = this.localMesh;

    } catch (e) {
      console.error("[realtime] Kart loading failed: ", e);
      this.localMesh = MeshBuilder.CreateBox("localCar", { size: 1.8 }, this.scene);
      this.localMesh.position = new Vector3(0, 5, 0);
      this._localKartExtents = new Vector3(1.8, 0.5, 3.2);
      this.localKartAggregate = new PhysicsAggregate(this.localMesh, PhysicsShapeType.BOX, { mass: 800, friction: 0.8, restitution: 0.1 }, this.scene);
      this.camera.lockedTarget = this.localMesh;
    }
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

    this.room.onStateChange((state) => {
      this.started = !!state?.started;
      this.authoritativeState = state;
      this.reconcile(state);
      this.syncRemoteMeshes(state);
    });

    this.room.onMessage("joined", () => {
      this.localInitializedFromServer = false;
    });

    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
    });

    return this.room;
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

    this.applyLocalPrediction(payload);
    this.pendingInputs.push(payload);
    this.room.send("input", payload);
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
    
    // Console-quality kart tuning
    const MAX_SPEED = 40;
    const ACCEL_RATE = 45;
    const TURN_SPEED = 2.8; 
    const DRIFT_GRIP = 0.5;

    let speed = Math.sqrt(currentVel.x**2 + currentVel.z**2);

    // 1. Steering (Physics Angular Velocity)
    if (input.steer !== 0 && speed > 1.0) {
        const forwardDir = transform.forward.scale(-1);
        const isReversing = Vector3.Dot(currentVel, forwardDir) < -1;
        const dir = isReversing ? -1 : 1;
        const steerMult = input.brake ? 1.4 : 1.0; 
        
        let targetTurn = input.steer * TURN_SPEED * dir * steerMult;
        body.setAngularVelocity(new Vector3(currentAngVel.x, targetTurn, currentAngVel.z));
    } else {
        body.setAngularVelocity(new Vector3(currentAngVel.x, currentAngVel.y * 0.8, currentAngVel.z));
    }

    let nextVel = new Vector3(currentVel.x, currentVel.y, currentVel.z);

    // 2. Acceleration (Linear accumulation)
    const forwardDir = transform.forward.scale(-1);
    if (forwardDir.lengthSquared() > 0.00001) {
      forwardDir.normalize();
    } else {
      forwardDir.copyFromFloats(0, 0, 1);
    }
    
    if (input.throttle !== 0) {
        if (speed < MAX_SPEED || (input.throttle < 0 && speed > 2)) {
             nextVel.x += forwardDir.x * input.throttle * ACCEL_RATE * dt;
             nextVel.z += forwardDir.z * input.throttle * ACCEL_RATE * dt;
        }
    }

    // 3. Friction & Braking
    if (input.brake) {
        nextVel.x *= 0.90;
        nextVel.z *= 0.90;
    } else if (input.throttle === 0) {
        nextVel.x *= 0.98;
        nextVel.z *= 0.98;
    }

    // 4. Lateral grip (Anti-ice drifting)
    let rightDir = transform.right;
    if (rightDir.lengthSquared() > 0.00001) {
      rightDir.normalize();
    } else {
      rightDir = new Vector3(1, 0, 0);
    }
    
    let latSpeed = Vector3.Dot(nextVel, rightDir);
    let grip = input.brake ? (DRIFT_GRIP * 0.4) : DRIFT_GRIP;
    
    nextVel.x -= rightDir.x * latSpeed * grip;
    nextVel.z -= rightDir.z * latSpeed * grip;

    // Apply entire computed velocity exactly ONCE
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
            
            placeholder.dispose();
            this.remoteMeshes.set(id, realMesh);
            console.log(`[realtime] Loaded remote kart for ${id}`);
          })
          .catch((err) => {
            console.error(`[realtime] Failed to load remote kart for ${id}:`, err);
          });

        this.loadingPromises.set(id, loadPromise);
      } else if (mesh && mesh.position) {
        mesh.position.x = player.x;
        mesh.position.y = player.y;
        mesh.position.z = player.z;
        mesh.rotationQuaternion = new Quaternion(player.rx, player.ry, player.rz, player.rw);
      }
    });

    // Cleanup disconnected players
    for (const [id, mesh] of this.remoteMeshes.entries()) {
      if (!connectedIds.includes(id)) {
        mesh.dispose();
        this.remoteMeshes.delete(id);
        this.loadingPromises.delete(id);
      }
    }
  }

  dispose() {
    if (this.room) {
      this.room.leave();
      this.room = null;
    }
    this.remoteMeshes.forEach((mesh) => mesh.dispose());
    this.remoteMeshes.clear();
    this.loadingPromises.clear();

    this.scene?.dispose();
    this.engine?.dispose();
    this.scene = null;
    this.engine = null;
  }
}
