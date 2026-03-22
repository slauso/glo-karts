import { Client } from 'colyseus.js';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';

function createOpponentMesh(scene, id) {
  const root = MeshBuilder.CreateCapsule(`remoteOpponent_${id}`, {
    height: 1.85,
    radius: 0.38,
    tessellation: 10,
    subdivisions: 4,
  }, scene);
  const bodyMat = new StandardMaterial(`remoteOpponentMat_${id}`, scene);
  bodyMat.diffuseColor = new Color3(0.22, 0.76, 0.98);
  bodyMat.emissiveColor = new Color3(0.02, 0.08, 0.12);
  root.material = bodyMat;
  root.receiveShadows = true;
  root.isPickable = false;
  return { mesh: root, material: bodyMat };
}

function createProjectileMesh(scene, id, entity) {
  const mesh = MeshBuilder.CreateSphere(`fpsProjectile_${id}`, { diameter: 0.22, segments: 10 }, scene);
  const mat = new StandardMaterial(`fpsProjectileMat_${id}`, scene);
  const palette = projectileColor(entity.subType);
  mat.emissiveColor = palette;
  mat.diffuseColor = palette.scale(0.45);
  mesh.material = mat;
  mesh.receiveShadows = false;
  mesh.isPickable = false;
  return { mesh, material: mat };
}

function projectileColor(subType = '') {
  switch (subType) {
    case 'cannon': return new Color3(1.0, 0.63, 0.16);
    case 'frostAxe': return new Color3(0.45, 0.82, 1.0);
    case 'moltenDagger': return new Color3(1.0, 0.28, 0.1);
    default: return new Color3(1.0, 0.9, 0.5);
  }
}

export class FPSNetworkClient {
  constructor({ endpoint, scene, controller, effects, hud, weaponSystem }) {
    this.endpoint = endpoint;
    this.scene = scene;
    this.controller = controller;
    this.effects = effects;
    this.hud = hud;
    this.weaponSystem = weaponSystem;

    this.client = new Client(endpoint);
    this.room = null;
    this.sessionId = '';
    this.seq = 0;
    this.lastInputAt = 0;
    this.inputIntervalMs = 33;

    this.remotePlayers = new Map();
    this.entityVisuals = new Map();
    this.loadout = null;
    this.state = null;
    this.hitCount = 0;
    this.matchLive = false;
    this.remoteProjectileReplications = 0;
    this.debug = {
      roomJoined: false,
      sessionId: '',
      matchLive: false,
      playerCount: 0,
      remotePlayerCount: 0,
      lastWeaponFired: null,
      lastHitVictimId: null,
      lastEffect: null,
      lastAuthoritativePos: null,
      activeProjectileCount: 0,
      remoteProjectileReplications: 0,
    };
  }

  async connect(options = {}) {
    this.room = await this.client.joinOrCreate(options.roomName || 'fps_arena', {
      playerName: options.playerName || `Player_${Math.floor(Math.random() * 10000)}`,
      scoreLimit: options.scoreLimit || 10,
      maxPlayers: options.maxPlayers || 8,
      partyCode: options.partyCode || '',
    });
    this.sessionId = this.room.sessionId;

    this.room.onMessage('joined', () => {
      this.debug.roomJoined = true;
      this.debug.sessionId = this.sessionId;
      this._publishDebug();
      window.setTimeout(() => {
        if (this.room) this.room.send('start', {});
      }, 1200);
    });

    this.room.onMessage('startSequence', () => {
      this._publishDebug();
    });

    this.room.onMessage('matchLive', () => {
      this.matchLive = true;
      this.debug.matchLive = true;
      this._publishDebug();
    });

    this.room.onMessage('loadoutState', (msg) => {
      this.loadout = msg;
      this.weaponSystem.syncLoadout(msg);
      this._syncHudFromLoadout();
    });

    this.room.onMessage('reloadStarted', (msg) => {
      if (msg?.weaponId === this.loadout?.currentWeapon) {
        this.weaponSystem.reload();
        this.effects.playSound('reload');
      }
    });

    this.room.onMessage('weaponReloaded', (msg) => {
      this.weaponSystem.syncLoadout(this.loadout);
      this._syncHudFromLoadout();
    });

    this.room.onMessage('projectileFired', (msg) => {
      this.debug.lastWeaponFired = msg?.subType || null;
      if (msg?.ownerId !== this.sessionId) {
        this.remoteProjectileReplications += 1;
        this.debug.remoteProjectileReplications = this.remoteProjectileReplications;
      }
      this._publishDebug();
      if (msg?.ownerId !== this.sessionId) return;
      const origin = new Vector3(msg.x, msg.y, msg.z);
      const velocity = new Vector3(msg.vx, msg.vy, msg.vz);
      this.effects.muzzleFlash(origin);
      this.effects.bulletTrail(origin, origin.add(velocity.normalize().scale(1.2)));
      this.effects.playSound('fire');
      this.effects.screenShake(0.02);
    });

    this.room.onMessage('projectileHit', (msg) => {
      this.debug.lastHitVictimId = msg?.victimId || null;
      this._publishDebug();
      if (msg?.victimId === this.sessionId) {
        this.hud.showDamageFlash();
        this.effects.playSound('impact');
      }
      if (msg?.attackerId === this.sessionId) {
        this.hitCount += 1;
        this.hud.showHitMarker();
        this.effects.playSound('hitConfirm');
      }
    });

    this.room.onMessage('effectApplied', (msg) => {
      this.debug.lastEffect = msg?.type || null;
      this._publishDebug();
      if (msg?.target === this.sessionId && msg?.type !== 'shielded') {
        this.hud.showDamageFlash();
      }
    });

    this.room.onStateChange((state) => {
      this.state = state;
      this._syncLocalPlayer(state);
      this._syncRemotePlayers(state);
      this._syncEntities(state);
    });

    return this.room;
  }

  update() {
    if (!this.room || !this.controller) return;
    const now = performance.now();
    if (now - this.lastInputAt < this.inputIntervalMs) return;
    this.lastInputAt = now;

    const intent = this.controller.getNetworkIntent();
    const rotation = Quaternion.RotationYawPitchRoll(intent.yaw, 0, 0);
    this.room.send('input', {
      seq: ++this.seq,
      moveX: intent.moveX,
      moveY: intent.moveY,
      sprint: intent.sprint,
      jump: intent.jump,
      yaw: intent.yaw,
      pitch: intent.pitch,
      rx: rotation.x,
      ry: rotation.y,
      rz: rotation.z,
      rw: rotation.w,
    });
  }

  selectWeapon(weaponId) {
    this.room?.send('selectWeapon', { weaponId });
  }

  reloadWeapon(weaponId) {
    this.room?.send('reloadWeapon', { weaponId });
  }

  fireWeapon(origin, direction) {
    this.room?.send('fireWeapon', {
      originX: origin.x,
      originY: origin.y,
      originZ: origin.z,
      dirX: direction.x,
      dirY: direction.y,
      dirZ: direction.z,
    });
  }

  getCurrentWeaponState() {
    if (!this.loadout) return null;
    return this.loadout.weapons?.[this.loadout.currentWeapon] || null;
  }

  isReloading() {
    return !!this.loadout?.reloadingWeapon;
  }

  canFire() {
    const current = this.getCurrentWeaponState();
    return !!current && !this.isReloading() && Number(current.ammo || 0) > 0;
  }

  _syncHudFromLoadout() {
    const current = this.getCurrentWeaponState();
    if (!current) return;
    this.hud.updateAmmo({ current: current.ammo, max: current.maxAmmo });
  }

  _syncLocalPlayer(state) {
    const self = state?.players?.get?.(this.sessionId);
    if (!self) return;

    this.hud.updateHealth(self.health || 0);
    this.hud.updateScore(self.score || 0, this.hitCount);

    const localPos = this.controller.capsule.position;
    const dx = self.x - localPos.x;
    const dy = self.y - localPos.y;
    const dz = self.z - localPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    this.debug.lastAuthoritativePos = { x: self.x, y: self.y, z: self.z };
    if (distSq > 9) {
      this.controller.setPosition(new Vector3(self.x, self.y, self.z));
    } else if (distSq > 0.16) {
      this.controller.nudgeTowards(new Vector3(self.x, self.y, self.z));
    }
    this._publishDebug();
  }

  _syncRemotePlayers(state) {
    const seen = new Set();
    state?.players?.forEach?.((player, id) => {
      if (id === this.sessionId) return;
      seen.add(id);
      let entry = this.remotePlayers.get(id);
      if (!entry) {
        entry = createOpponentMesh(this.scene, id);
        this.remotePlayers.set(id, entry);
      }
      entry.mesh.position.set(player.x, player.y, player.z);
      entry.mesh.rotationQuaternion = new Quaternion(player.rx, player.ry, player.rz, player.rw);
      entry.mesh.metadata = { sessionId: id, health: player.health };
    });

    this.debug.playerCount = state?.players?.size || 0;
    this.debug.remotePlayerCount = this.remotePlayers.size;
    this._publishDebug();

    for (const [id, entry] of this.remotePlayers.entries()) {
      if (seen.has(id)) continue;
      entry.mesh.dispose();
      entry.material.dispose();
      this.remotePlayers.delete(id);
    }
  }

  _syncEntities(state) {
    const seen = new Set();
    state?.entities?.forEach?.((entity, id) => {
      if (!entity?.active) return;
      seen.add(id);

      let entry = this.entityVisuals.get(id);
      if (!entry && entity.type === 'projectile') {
        entry = createProjectileMesh(this.scene, id, entity);
        this.entityVisuals.set(id, entry);
      }
      if (!entry) return;

      entry.mesh.position.set(entity.x, entity.y, entity.z);
    });

    this.debug.activeProjectileCount = this.entityVisuals.size;
    this._publishDebug();

    for (const [id, entry] of this.entityVisuals.entries()) {
      if (seen.has(id)) continue;
      entry.mesh.dispose();
      entry.material.dispose();
      this.entityVisuals.delete(id);
    }
  }

  dispose() {
    this.remotePlayers.forEach((entry) => {
      entry.mesh.dispose();
      entry.material.dispose();
    });
    this.entityVisuals.forEach((entry) => {
      entry.mesh.dispose();
      entry.material.dispose();
    });
    this.remotePlayers.clear();
    this.entityVisuals.clear();
    this.room?.leave();
  }

  debugFire(origin, direction) {
    const nextOrigin = origin || this.controller.camera.globalPosition.clone();
    const nextDirection = direction || this.controller.camera.getForwardRay().direction.clone();
    this.fireWeapon(nextOrigin, nextDirection);
  }

  debugTeleport(position) {
    if (!this.room) return;
    this.room.send('debugTeleport', {
      x: position.x,
      y: position.y,
      z: position.z,
      yaw: Number.isFinite(position.yaw) ? position.yaw : this.controller.camera.rotation.y,
    });
    this.controller.setPosition(new Vector3(position.x, position.y, position.z));
  }

  _publishDebug() {
    if (typeof window === 'undefined') return;
    window.__gloDebug = {
      ...(window.__gloDebug || {}),
      ...this.debug,
    };
    window.__gloClient = this;
  }
}