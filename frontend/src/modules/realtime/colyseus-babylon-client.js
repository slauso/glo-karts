import { Client } from "colyseus.js";
import {
  Engine,
  Scene,
  Vector3,
  Quaternion,
  FreeCamera,
  HemisphericLight,
  MeshBuilder,
  HavokPlugin,
  SceneLoader
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
  }

  async initBabylon(canvas) {
    this.engine = new Engine(canvas, true);
    this.scene = new Scene(this.engine);

    this.camera = new FreeCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.setTarget(Vector3.Zero());
    this.camera.attachControl(canvas, true);

    new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);

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
      if (this.localMesh) {
         // Follow camera behind local mesh loosely
         const targetPos = this.localMesh.position.clone();
         this.camera.setTarget(targetPos);
      }
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
        await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene).catch(e => console.warn(`[realtime] Failed to load arena ${filename}:`, e));
      } else if (trackInfo.trackPath) {
        pathParts = trackInfo.trackPath.split('/');
        const filename = pathParts.pop();
        await SceneLoader.ImportMeshAsync("", pathParts.join('/') + '/', filename, this.scene).catch(e => console.warn(`[realtime] Failed to load track ${filename}:`, e));
        
        if (trackInfo.decorationsPath) {
          const decParts = trackInfo.decorationsPath.split('/');
          const decFilename = decParts.pop();
          SceneLoader.ImportMeshAsync("", decParts.join('/') + '/', decFilename, this.scene).catch(e => console.warn(`[realtime] Failed to load decorations ${decFilename}:`, e));
        }
      }
    } catch (e) {
      console.error("[realtime] Map loading failed: ", e);
      MeshBuilder.CreateGround("ground", { width: 240, height: 240 }, this.scene);
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
      this.localMesh.position = new Vector3(0, 1, 0);
      
      if (kartInfo.scale && kartInfo.scale !== 1) {
         this.localMesh.scaling = new Vector3(kartInfo.scale, kartInfo.scale, kartInfo.scale);
      }
    } catch (e) {
      console.error("[realtime] Kart loading failed: ", e);
      this.localMesh = MeshBuilder.CreateBox("localCar", { size: 1.8 }, this.scene);
      this.localMesh.position = new Vector3(0, 1, 0);
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
      this.authoritativeState = state;
      this.reconcile(state);
      this.syncRemoteMeshes(state);
    });

    this.room.onMessage("joined", () => {
      this.started = true;
    });

    this.room.onMessage("matchEnd", (msg) => {
      console.log("[colyseus] matchEnd", msg);
    });

    return this.room;
  }

  startMatch() {
    if (this.room) this.room.send("start", {});
  }

  sendInput(input) {
    if (!this.room || !this.localMesh) return;

    const seq = ++this.inputSeq;
    const payload = {
      seq,
      throttle: Number(input.throttle || 0),
      steer: Number(input.steer || 0),
      brake: Number(input.brake || 0),
      fire: !!input.fire,
    };

    this.applyLocalPrediction(payload);
    this.pendingInputs.push(payload);
    this.room.send("input", payload);
  }

  applyLocalPrediction(input) {
    if (!this.localMesh) return;
    const dt = 1 / 60;
    this.localMesh.position.x += input.steer * 18 * dt;
    this.localMesh.position.z += input.throttle * 18 * dt;
  }

  reconcile(state) {
    if (!this.localMesh || !state?.players || !this.room) return;
    const self = state.players.get(this.room.sessionId);
    if (!self) return;

    this.localMesh.position.x = self.x;
    this.localMesh.position.y = self.y;
    this.localMesh.position.z = self.z;
    this.localMesh.rotationQuaternion = new Quaternion(self.rx, self.ry, self.rz, self.rw);

    const ackSeq = self.lastProcessedInput || 0;
    this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
    for (const pending of this.pendingInputs) {
      this.applyLocalPrediction(pending);
    }
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
