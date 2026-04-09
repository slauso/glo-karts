/**
 * fps-weapons.js — Weapon loader, attachment, animation, and fire mechanics.
 *
 * Loads weapon GLBs from BabylonJS/Assets weaponsDemo and attaches them
 * to the FPS camera with bob/sway and fire-recoil animation.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

// ── Weapon asset base ──────────────────────────────────────────────────────
const WEAPON_MESH_BASE = 'https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/Demos/weaponsDemo/meshes/';

// ── Weapon definitions ─────────────────────────────────────────────────────
const WEAPON_DEFS = [
  {
    id: 'cannon',
    name: 'CANNON',
    file: 'cannon.glb',
    offset: new Vector3(0.32, -0.28, 0.65),
    rotation: new Vector3(0, Math.PI, 0),
    scale: 0.3,
    ammo: 8,
    reloadTime: 2.2,
    fireRate: 0.6, // seconds between shots
    projectileConfig: {
      speed: 50,
      radius: 0.2,
      mass: 2,
      damage: 40,
      lifetime: 4,
      gravity: -4,
      color: [1, 0.6, 0.1],
      explosionRadius: 3,
      type: 'cannon',
    },
  },
  {
    id: 'frostAxe',
    name: 'FROST AXE',
    file: 'frostAxe.glb',
    offset: new Vector3(0.35, -0.35, 0.6),
    rotation: new Vector3(-0.3, Math.PI * 0.9, 0.1),
    scale: 0.25,
    ammo: 15,
    reloadTime: 1.5,
    fireRate: 0.25,
    projectileConfig: {
      speed: 38,
      radius: 0.12,
      mass: 0.8,
      damage: 22,
      lifetime: 3,
      gravity: 0,
      color: [0.3, 0.7, 1],
      explosionRadius: 1.5,
      type: 'frost',
    },
  },
  {
    id: 'moltenDagger',
    name: 'MOLTEN DAGGER',
    file: 'moltenDagger.glb',
    offset: new Vector3(0.28, -0.32, 0.55),
    rotation: new Vector3(-0.2, Math.PI, 0.15),
    scale: 0.28,
    ammo: 30,
    reloadTime: 1.0,
    fireRate: 0.1,
    projectileConfig: {
      speed: 60,
      radius: 0.08,
      mass: 0.3,
      damage: 12,
      lifetime: 2,
      gravity: 0,
      color: [1, 0.3, 0.05],
      explosionRadius: 0.8,
      type: 'molten',
    },
  },
];

// ── Weapon system factory ──────────────────────────────────────────────────
export async function createWeaponSystem(scene, camera) {
  const weaponRoot = new TransformNode('weaponRoot', scene);
  weaponRoot.parent = camera;

  // ── Load all weapon models ───────────────────────────────────────────
  const weapons = [];
  for (const def of WEAPON_DEFS) {
    const wep = {
      ...def,
      meshRoot: null,
      meshes: [],
      animations: [],
      currentAmmo: def.ammo,
      fireCooldown: 0,
      loaded: false,
    };

    try {
      const result = await SceneLoader.ImportMeshAsync(
        '',
        WEAPON_MESH_BASE,
        def.file,
        scene,
      );

      const pivot = new TransformNode('wep_' + def.id, scene);
      pivot.parent = weaponRoot;
      pivot.position = def.offset.clone();
      pivot.rotation = def.rotation.clone();
      pivot.scaling.setAll(def.scale);

      for (const mesh of result.meshes) {
        mesh.parent = pivot;
        mesh.isPickable = false;
        // Enable shadow receiving on weapon
        mesh.receiveShadows = true;
      }

      wep.meshRoot = pivot;
      wep.meshes = result.meshes;
      wep.animations = result.animationGroups || [];
      wep.loaded = true;

      // Initially hide all except the first weapon
      pivot.setEnabled(false);
    } catch (err) {
      console.warn(`Failed to load weapon model ${def.file}, creating fallback:`, err.message);
      // Fallback: procedural box weapon
      const fallback = _createFallbackWeapon(scene, def);
      fallback.parent = weaponRoot;
      wep.meshRoot = fallback;
      wep.loaded = true;
      fallback.setEnabled(false);
    }

    weapons.push(wep);
  }

  // Show first weapon
  let activeIndex = 0;
  if (weapons[0]?.meshRoot) weapons[0].meshRoot.setEnabled(true);

  // ── Animation state ──────────────────────────────────────────────────
  let recoilAmount = 0;
  let bobPhase = 0;
  let isReloading = false;
  let reloadProgress = 0;
  let _reloadCompleteCb = null;
  let _reloadProgressCb = null;

  function getActive() { return weapons[activeIndex]; }

  return {
    /** Per-frame update: bob, sway, recoil decay, reload tick, fire cooldown. */
    update(dt, isMoving, velocity) {
      const wep = getActive();
      if (!wep?.meshRoot) return;

      // Fire cooldown
      if (wep.fireCooldown > 0) wep.fireCooldown -= dt;

      // Reload tick
      if (isReloading) {
        reloadProgress += dt / wep.reloadTime;
        if (_reloadProgressCb) _reloadProgressCb(Math.min(reloadProgress, 1));
        if (reloadProgress >= 1) {
          isReloading = false;
          reloadProgress = 0;
          wep.currentAmmo = wep.ammo;
          if (_reloadCompleteCb) _reloadCompleteCb();
          if (_reloadProgressCb) _reloadProgressCb(1);
        }
      }

      // Recoil decay
      recoilAmount *= Math.pow(0.05, dt * 4); // Fast decay
      if (recoilAmount < 0.001) recoilAmount = 0;

      // Bob / sway
      const speed = velocity ? Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z) : 0;
      const bobScale = Math.min(speed / MOVE_SPEED_REF, 1);
      if (isMoving && speed > 0.5) {
        bobPhase += dt * 8;
      }

      const bobX = Math.sin(bobPhase) * 0.012 * bobScale;
      const bobY = Math.abs(Math.sin(bobPhase * 2)) * 0.008 * bobScale;

      const base = wep.offset;
      wep.meshRoot.position.x = base.x + bobX;
      wep.meshRoot.position.y = base.y + bobY - recoilAmount * 0.08;
      wep.meshRoot.position.z = base.z - recoilAmount * 0.12;

      // Slight rotation recoil
      wep.meshRoot.rotation.x = wep.rotation.x - recoilAmount * 0.5;
    },

    /**
     * Fire the current weapon. Returns ammo state or null if empty.
     */
    fire() {
      let consumeAmmo = true;
      if (typeof arguments[0] === 'object' && arguments[0] !== null) {
        consumeAmmo = arguments[0].consumeAmmo !== false;
      }
      const wep = getActive();
      if (!wep || wep.fireCooldown > 0 || isReloading) return null;
      if (consumeAmmo && wep.currentAmmo <= 0) return null;

      if (consumeAmmo) wep.currentAmmo--;
      wep.fireCooldown = wep.fireRate;
      recoilAmount = 0.2;

      // Play weapon animation if available
      if (wep.animations.length > 0) {
        wep.animations[0].stop();
        wep.animations[0].start(false, 2.0);
      }

      return { current: wep.currentAmmo, max: wep.ammo };
    },

    reload() {
      const wep = getActive();
      if (!wep || isReloading || wep.currentAmmo === wep.ammo) return;
      isReloading = true;
      reloadProgress = 0;
    },

    switchWeapon(index) {
      if (index === activeIndex || index < 0 || index >= weapons.length) return;
      if (weapons[activeIndex]?.meshRoot) weapons[activeIndex].meshRoot.setEnabled(false);
      activeIndex = index;
      if (weapons[activeIndex]?.meshRoot) weapons[activeIndex].meshRoot.setEnabled(true);
      isReloading = false;
      reloadProgress = 0;
    },

    getCurrentWeapon() { return getActive(); },

    getAmmoState() {
      const wep = getActive();
      return { current: wep?.currentAmmo ?? 0, max: wep?.ammo ?? 0 };
    },

    syncLoadout(snapshot) {
      if (!snapshot?.weapons) return;
      for (const weapon of weapons) {
        const slot = snapshot.weapons[weapon.id];
        if (!slot) continue;
        weapon.currentAmmo = Number(slot.ammo ?? weapon.currentAmmo ?? 0);
        weapon.ammo = Number(slot.maxAmmo ?? weapon.ammo ?? 0);
      }
      const nextWeapon = snapshot.currentWeapon;
      const nextIndex = weapons.findIndex((weapon) => weapon.id === nextWeapon);
      if (nextIndex >= 0 && nextIndex !== activeIndex) {
        if (weapons[activeIndex]?.meshRoot) weapons[activeIndex].meshRoot.setEnabled(false);
        activeIndex = nextIndex;
        if (weapons[activeIndex]?.meshRoot) weapons[activeIndex].meshRoot.setEnabled(true);
      }
    },

    isReloading() { return isReloading; },

    onReloadComplete(cb) { _reloadCompleteCb = cb; },
    onReloadProgress(cb) { _reloadProgressCb = cb; },
  };
}

const MOVE_SPEED_REF = 8;

// ── Fallback procedural weapon ─────────────────────────────────────────────
function _createFallbackWeapon(scene, def) {
  const pivot = new TransformNode('wep_fallback_' + def.id, scene);
  pivot.position = def.offset.clone();
  pivot.rotation = def.rotation.clone();

  const barrel = MeshBuilder.CreateCylinder('barrel_' + def.id, {
    height: 0.8,
    diameter: 0.08,
    tessellation: 12,
  }, scene);
  barrel.parent = pivot;
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.3;
  barrel.isPickable = false;

  const grip = MeshBuilder.CreateBox('grip_' + def.id, { width: 0.06, height: 0.14, depth: 0.04 }, scene);
  grip.parent = pivot;
  grip.position.y = -0.05;
  grip.isPickable = false;

  const mat = new StandardMaterial('wepMat_' + def.id, scene);
  const [r, g, b] = def.projectileConfig.color;
  mat.diffuseColor = new Color3(r * 0.6, g * 0.6, b * 0.6);
  mat.emissiveColor = new Color3(r * 0.2, g * 0.2, b * 0.2);
  mat.specularColor = new Color3(0.4, 0.4, 0.4);
  barrel.material = mat;
  grip.material = mat;

  return pivot;
}
