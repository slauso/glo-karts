/**
 * procedural-models.js — Procedural weapon, pickup, and item model generator.
 *
 * Generates all weapon projectiles, item box meshes, pickup indicators, and
 * defensive items using Babylon.js MeshBuilder. Zero texture assets needed.
 * Meshes are cached per type for efficient reuse across the scene.
 *
 * Includes 10 EXTREME tier weapons with dramatic visual effects:
 * Shockwave Cannon, Thunderstrike, Black Hole Orb, Meteor Swarm, Frost Nova,
 * EMP Pulse, Gravity Flip, Inferno Trail, Plasma Railgun, Vortex Tornado.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Mesh } from '@babylonjs/core/Meshes/mesh';

const _cache = {};

// ── Material Helpers ────────────────────────────────────────────────────────

function _glow(scene, name, r, g, b, emissive = 0.4) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.emissiveColor = new Color3(r, g, b).scale(emissive);
  m.specularColor = new Color3(0.3, 0.3, 0.3);
  return m;
}

function _solid(scene, name, r, g, b) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r, g, b);
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  return m;
}

function _emissiveOnly(scene, name, r, g, b, intensity = 0.8) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = new Color3(r * 0.3, g * 0.3, b * 0.3);
  m.emissiveColor = new Color3(r, g, b).scale(intensity);
  m.specularColor = new Color3(0.5, 0.5, 0.5);
  return m;
}

function _ghostMat(scene, name, r, g, b, alpha = 0.4) {
  const m = _emissiveOnly(scene, name, r, g, b, 0.9);
  m.alpha = alpha;
  return m;
}

// ── Standard Weapon Models ──────────────────────────────────────────────────

function _bowling(scene) {
  const ball = MeshBuilder.CreateSphere('bowling', { diameter: 1.2, segments: 12 }, scene);
  ball.material = _solid(scene, 'bowling-mat', 0.15, 0.15, 0.2);
  const ring = MeshBuilder.CreateTorus('bowling-ring', { diameter: 0.85, thickness: 0.08, tessellation: 16 }, scene);
  ring.material = _glow(scene, 'bowling-ring-mat', 0.7, 0.1, 0.1, 0.3);
  ring.parent = ball;
  ring.position.y = 0.25;
  ring.rotation.x = Math.PI / 2;
  return ball;
}

function _cake(scene) {
  const base = MeshBuilder.CreateCylinder('cake', { diameter: 1.0, height: 0.6, tessellation: 12 }, scene);
  base.material = _glow(scene, 'cake-mat', 0.95, 0.85, 0.75, 0.2);
  const cherry = MeshBuilder.CreateSphere('cherry', { diameter: 0.25, segments: 8 }, scene);
  cherry.material = _glow(scene, 'cherry-mat', 0.9, 0.1, 0.1, 0.5);
  cherry.parent = base;
  cherry.position.y = 0.42;
  return base;
}

function _plunger(scene) {
  const stick = MeshBuilder.CreateCylinder('plunger-stick', { diameter: 0.15, height: 1.2, tessellation: 8 }, scene);
  stick.material = _solid(scene, 'plunger-stick-mat', 0.6, 0.5, 0.3);
  const cup = MeshBuilder.CreateSphere('plunger-cup', { diameter: 0.5, segments: 8, slice: 0.5 }, scene);
  cup.material = _glow(scene, 'plunger-cup-mat', 0.8, 0.2, 0.3, 0.3);
  cup.parent = stick;
  cup.position.y = -0.6;
  cup.rotation.x = Math.PI;
  return stick;
}

function _bubblegum(scene) {
  const gum = MeshBuilder.CreateSphere('bubblegum', { diameter: 0.8, segments: 10 }, scene);
  gum.scaling.y = 0.5;
  gum.material = _glow(scene, 'bubblegum-mat', 1.0, 0.4, 0.7, 0.4);
  return gum;
}

function _swatter(scene) {
  const handle = MeshBuilder.CreateCylinder('swatter-handle', { diameter: 0.12, height: 1.5, tessellation: 8 }, scene);
  handle.material = _solid(scene, 'swatter-handle-mat', 0.5, 0.4, 0.25);
  const head = MeshBuilder.CreateBox('swatter-head', { width: 0.8, height: 0.05, depth: 0.6 }, scene);
  head.material = _glow(scene, 'swatter-head-mat', 0.3, 0.8, 0.2, 0.3);
  head.parent = handle;
  head.position.y = 0.8;
  return handle;
}

// ── Pickup/Item Models ──────────────────────────────────────────────────────

function _itemBox(scene) {
  // Enhanced MK-style question block with holographic glow
  const box = MeshBuilder.CreateBox('item-box', { size: 1.5 }, scene);
  const boxMat = new StandardMaterial('item-box-mat', scene);
  boxMat.diffuseColor = new Color3(0.12, 0.35, 0.85);
  boxMat.emissiveColor = new Color3(0.12, 0.45, 0.95);
  boxMat.specularColor = new Color3(0.6, 0.6, 0.8);
  boxMat.specularPower = 64;
  boxMat.alpha = 0.82;
  boxMat.backFaceCulling = false;
  box.material = boxMat;

  // Wireframe edge overlay
  const wireBox = MeshBuilder.CreateBox('item-wire', { size: 1.54 }, scene);
  wireBox.material = _emissiveOnly(scene, 'item-wire-mat', 0.4, 0.75, 1.0, 0.7);
  wireBox.material.wireframe = true;
  wireBox.material.alpha = 0.5;
  wireBox.parent = box;

  // Inner glow core
  const inner = MeshBuilder.CreateSphere('item-inner', { diameter: 0.6, segments: 8 }, scene);
  inner.material = _emissiveOnly(scene, 'item-inner-mat', 0.9, 0.85, 0.3, 0.8);
  inner.material.alpha = 0.7;
  inner.parent = box;

  return box;
}

function _nitroPickup(scene) {
  const can = MeshBuilder.CreateCylinder('nitro', { diameter: 0.6, height: 1.0, tessellation: 10 }, scene);
  can.material = _glow(scene, 'nitro-mat', 0.1, 0.9, 0.2, 0.5);
  const cap = MeshBuilder.CreateCylinder('nitro-cap', { diameter: 0.65, height: 0.12, tessellation: 10 }, scene);
  cap.material = _glow(scene, 'nitro-cap-mat', 0.8, 0.8, 0.8, 0.3);
  cap.parent = can;
  cap.position.y = 0.5;
  return can;
}

function _shield(scene) {
  const shield = MeshBuilder.CreateSphere('shield', { diameter: 3.5, segments: 16 }, scene);
  const mat = _glow(scene, 'shield-mat', 0.2, 0.5, 1.0, 0.6);
  mat.alpha = 0.3;
  shield.material = mat;
  return shield;
}

function _boostPad(scene) {
  const pad = MeshBuilder.CreateBox('boost-pad', { width: 4, height: 0.1, depth: 6 }, scene);
  pad.material = _glow(scene, 'boost-mat', 0.0, 0.8, 1.0, 0.6);
  return pad;
}

// ── EXTREME Weapon Models ───────────────────────────────────────────────────

function _shockwaveCannon(scene) {
  // Cannon barrel + expanding energy ring
  const barrel = MeshBuilder.CreateCylinder('shockwave-barrel', { diameter: 0.6, height: 1.8, tessellation: 10 }, scene);
  barrel.material = _glow(scene, 'shockwave-barrel-mat', 0.2, 0.4, 0.9, 0.5);
  barrel.rotation.x = Math.PI / 2;
  const ring = MeshBuilder.CreateTorus('shockwave-ring', { diameter: 2.5, thickness: 0.2, tessellation: 32 }, scene);
  ring.material = _emissiveOnly(scene, 'shockwave-ring-mat', 0.3, 0.6, 1.0, 0.9);
  ring.material.alpha = 0.7;
  ring.parent = barrel;
  ring.position.z = 0.9;
  // Inner glow core
  const core = MeshBuilder.CreateSphere('shockwave-core', { diameter: 0.5, segments: 8 }, scene);
  core.material = _emissiveOnly(scene, 'shockwave-core-mat', 0.5, 0.8, 1.0, 1.0);
  core.parent = barrel;
  core.position.z = 0.6;
  return barrel;
}

function _thunderstrike(scene) {
  // Lightning bolt: stacked offset boxes simulating branching fractal geometry
  const root = MeshBuilder.CreateBox('thunder-root', { width: 0.1, height: 0.1, depth: 0.1 }, scene);
  root.isVisible = false;
  const boltMat = _emissiveOnly(scene, 'thunder-bolt-mat', 0.8, 0.9, 1.0, 1.0);
  const segments = 8;
  let prevY = 0;
  for (let i = 0; i < segments; i++) {
    const h = 1.2 + Math.sin(i * 1.7) * 0.5;
    const seg = MeshBuilder.CreateBox(`bolt-seg-${i}`, { width: 0.3 - i * 0.02, height: h, depth: 0.3 - i * 0.02 }, scene);
    seg.material = boltMat;
    seg.parent = root;
    const offX = Math.sin(i * 2.3) * 0.4;
    const offZ = Math.cos(i * 1.9) * 0.3;
    seg.position.set(offX, prevY + h / 2, offZ);
    seg.rotation.z = Math.sin(i * 1.5) * 0.3;
    prevY += h * 0.85;
  }
  // Spark ball at impact point
  const spark = MeshBuilder.CreateSphere('thunder-spark', { diameter: 1.2, segments: 8 }, scene);
  spark.material = _emissiveOnly(scene, 'thunder-spark-mat', 1.0, 1.0, 0.7, 1.0);
  spark.material.alpha = 0.6;
  spark.parent = root;
  return root;
}

function _blackHoleOrb(scene) {
  // Dark sphere with swirling accretion ring
  const orb = MeshBuilder.CreateSphere('blackhole-orb', { diameter: 1.8, segments: 16 }, scene);
  const orbMat = new StandardMaterial('blackhole-orb-mat', scene);
  orbMat.diffuseColor = new Color3(0.02, 0.0, 0.05);
  orbMat.emissiveColor = new Color3(0.15, 0.0, 0.25);
  orbMat.specularColor = new Color3(0.0, 0.0, 0.0);
  orb.material = orbMat;
  // Accretion disc (torus ring)
  const disc = MeshBuilder.CreateTorus('blackhole-disc', { diameter: 3.0, thickness: 0.15, tessellation: 32 }, scene);
  disc.material = _emissiveOnly(scene, 'blackhole-disc-mat', 0.6, 0.2, 1.0, 0.8);
  disc.material.alpha = 0.6;
  disc.parent = orb;
  disc.rotation.x = Math.PI * 0.15;
  // Second offset ring for depth
  const disc2 = MeshBuilder.CreateTorus('blackhole-disc2', { diameter: 2.5, thickness: 0.1, tessellation: 24 }, scene);
  disc2.material = _emissiveOnly(scene, 'blackhole-disc2-mat', 0.8, 0.3, 1.0, 0.7);
  disc2.material.alpha = 0.4;
  disc2.parent = orb;
  disc2.rotation.x = -Math.PI * 0.1;
  disc2.rotation.y = Math.PI * 0.3;
  return orb;
}

function _meteorSwarm(scene) {
  // Cluster of burning rocks
  const root = MeshBuilder.CreateBox('meteor-root', { width: 0.1, height: 0.1, depth: 0.1 }, scene);
  root.isVisible = false;
  const rockMat = _glow(scene, 'meteor-rock-mat', 0.4, 0.2, 0.1, 0.3);
  const fireMat = _emissiveOnly(scene, 'meteor-fire-mat', 1.0, 0.5, 0.1, 0.9);
  fireMat.alpha = 0.7;
  for (let i = 0; i < 4; i++) {
    const size = 0.6 + Math.sin(i * 2.1) * 0.3;
    const rock = MeshBuilder.CreateIcoSphere(`meteor-${i}`, { radius: size, subdivisions: 2 }, scene);
    rock.material = rockMat;
    rock.parent = root;
    rock.position.set(Math.sin(i * 1.5) * 1.5, i * 0.8, Math.cos(i * 1.5) * 1.5);
    // Fire halo around each rock
    const halo = MeshBuilder.CreateSphere(`meteor-halo-${i}`, { diameter: size * 2.2, segments: 6 }, scene);
    halo.material = fireMat;
    halo.parent = rock;
  }
  return root;
}

function _frostNova(scene) {
  // Ice crystal cluster — central spike + radiating crystals
  const root = MeshBuilder.CreateBox('frost-root', { width: 0.1, height: 0.1, depth: 0.1 }, scene);
  root.isVisible = false;
  const iceMat = _ghostMat(scene, 'frost-ice-mat', 0.4, 0.8, 1.0, 0.55);
  const crystalMat = _emissiveOnly(scene, 'frost-crystal-mat', 0.6, 0.9, 1.0, 0.7);
  crystalMat.alpha = 0.65;
  // Central spike
  const spike = MeshBuilder.CreateCylinder('frost-spike', { diameterTop: 0, diameterBottom: 1.0, height: 3.0, tessellation: 6 }, scene);
  spike.material = iceMat;
  spike.parent = root;
  spike.position.y = 1.5;
  // Radiating smaller crystals
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const h = 1.2 + Math.sin(i * 1.3) * 0.5;
    const crystal = MeshBuilder.CreateCylinder(`frost-crystal-${i}`, { diameterTop: 0, diameterBottom: 0.4, height: h, tessellation: 5 }, scene);
    crystal.material = crystalMat;
    crystal.parent = root;
    crystal.position.set(Math.cos(angle) * 1.5, h / 2, Math.sin(angle) * 1.5);
    crystal.rotation.z = (Math.PI / 6) * (i % 2 === 0 ? 1 : -1);
    crystal.rotation.y = angle;
  }
  // Frost ring on ground
  const frostRing = MeshBuilder.CreateTorus('frost-ring', { diameter: 4.0, thickness: 0.15, tessellation: 24 }, scene);
  frostRing.material = _ghostMat(scene, 'frost-ring-mat', 0.5, 0.85, 1.0, 0.35);
  frostRing.parent = root;
  frostRing.rotation.x = Math.PI / 2;
  frostRing.position.y = 0.1;
  return root;
}

function _empPulse(scene) {
  // Electric burst: central sphere + concentric spark rings
  const core = MeshBuilder.CreateSphere('emp-core', { diameter: 1.2, segments: 10 }, scene);
  core.material = _emissiveOnly(scene, 'emp-core-mat', 0.2, 0.8, 1.0, 1.0);
  core.material.alpha = 0.8;
  // Outer ring 1
  const ring1 = MeshBuilder.CreateTorus('emp-ring1', { diameter: 3.0, thickness: 0.12, tessellation: 24 }, scene);
  ring1.material = _emissiveOnly(scene, 'emp-ring1-mat', 0.0, 0.9, 1.0, 0.8);
  ring1.material.alpha = 0.5;
  ring1.parent = core;
  // Outer ring 2 offset
  const ring2 = MeshBuilder.CreateTorus('emp-ring2', { diameter: 2.2, thickness: 0.08, tessellation: 20 }, scene);
  ring2.material = _emissiveOnly(scene, 'emp-ring2-mat', 0.1, 0.6, 0.9, 0.7);
  ring2.material.alpha = 0.4;
  ring2.parent = core;
  ring2.rotation.x = Math.PI / 3;
  ring2.rotation.y = Math.PI / 4;
  // Spark tendrils (small stretched boxes)
  for (let i = 0; i < 6; i++) {
    const spark = MeshBuilder.CreateBox(`emp-spark-${i}`, { width: 0.08, height: 0.08, depth: 1.0 + Math.sin(i) * 0.5 }, scene);
    spark.material = _emissiveOnly(scene, `emp-spark-mat-${i}`, 0.3, 0.9, 1.0, 0.9);
    spark.parent = core;
    const angle = (i / 6) * Math.PI * 2;
    spark.position.set(Math.cos(angle) * 0.8, Math.sin(angle * 1.5) * 0.3, Math.sin(angle) * 0.8);
    spark.rotation.y = angle;
  }
  return core;
}

function _gravityFlip(scene) {
  // Warped gravitational field orb with swirling bands
  const orb = MeshBuilder.CreateSphere('grav-orb', { diameter: 1.5, segments: 12 }, scene);
  orb.material = _ghostMat(scene, 'grav-orb-mat', 0.7, 0.3, 1.0, 0.5);
  // Swirl bands
  for (let i = 0; i < 3; i++) {
    const band = MeshBuilder.CreateTorus(`grav-band-${i}`, { diameter: 2.0 + i * 0.4, thickness: 0.06, tessellation: 20 }, scene);
    band.material = _emissiveOnly(scene, `grav-band-mat-${i}`, 0.9, 0.5, 1.0, 0.8);
    band.material.alpha = 0.5;
    band.parent = orb;
    band.rotation.x = (i / 3) * Math.PI;
    band.rotation.z = i * 0.5;
  }
  // Arrow indicator (up/down)
  const arrow = MeshBuilder.CreateCylinder('grav-arrow', { diameterTop: 0, diameterBottom: 0.6, height: 1.0, tessellation: 4 }, scene);
  arrow.material = _emissiveOnly(scene, 'grav-arrow-mat', 1.0, 0.6, 1.0, 0.9);
  arrow.parent = orb;
  arrow.position.y = 1.2;
  return orb;
}

function _infernoTrail(scene) {
  // Fire wall segment: stacked flame-colored boxes
  const root = MeshBuilder.CreateBox('inferno-root', { width: 0.1, height: 0.1, depth: 0.1 }, scene);
  root.isVisible = false;
  const flameMats = [
    _emissiveOnly(scene, 'inferno-flame1', 1.0, 0.3, 0.0, 0.9),
    _emissiveOnly(scene, 'inferno-flame2', 1.0, 0.6, 0.1, 0.8),
    _emissiveOnly(scene, 'inferno-flame3', 1.0, 0.8, 0.2, 0.7),
  ];
  flameMats.forEach(m => { m.alpha = 0.75; });
  // Base fire wall
  const base = MeshBuilder.CreateBox('inferno-base', { width: 4.0, height: 0.3, depth: 1.5 }, scene);
  base.material = _glow(scene, 'inferno-base-mat', 0.3, 0.1, 0.0, 0.4);
  base.parent = root;
  // Flame pillars
  for (let i = 0; i < 5; i++) {
    const h = 2.0 + Math.sin(i * 1.7) * 1.0;
    const flame = MeshBuilder.CreateBox(`inferno-flame-${i}`, { width: 0.6, height: h, depth: 0.4 }, scene);
    flame.material = flameMats[i % 3];
    flame.parent = root;
    flame.position.set(-1.5 + i * 0.75, h / 2, 0);
  }
  return root;
}

function _plasmaRailgun(scene) {
  // Sleek barrel with lens flare emitter
  const barrel = MeshBuilder.CreateCylinder('railgun-barrel', { diameter: 0.35, height: 2.4, tessellation: 8 }, scene);
  barrel.material = _solid(scene, 'railgun-barrel-mat', 0.2, 0.2, 0.25);
  barrel.rotation.x = Math.PI / 2;
  // Glowing energy core along barrel
  const energyCore = MeshBuilder.CreateCylinder('railgun-core', { diameter: 0.18, height: 2.5, tessellation: 8 }, scene);
  energyCore.material = _emissiveOnly(scene, 'railgun-core-mat', 0.0, 1.0, 0.8, 1.0);
  energyCore.parent = barrel;
  // Muzzle flare
  const muzzle = MeshBuilder.CreateSphere('railgun-muzzle', { diameter: 0.5, segments: 8 }, scene);
  muzzle.material = _emissiveOnly(scene, 'railgun-muzzle-mat', 0.2, 1.0, 0.9, 1.0);
  muzzle.material.alpha = 0.6;
  muzzle.parent = barrel;
  muzzle.position.z = 1.3;
  // Heat fins
  for (let i = 0; i < 3; i++) {
    const fin = MeshBuilder.CreateBox(`railgun-fin-${i}`, { width: 0.5, height: 0.04, depth: 0.8 }, scene);
    fin.material = _glow(scene, `railgun-fin-mat-${i}`, 0.15, 0.15, 0.2, 0.2);
    fin.parent = barrel;
    fin.position.z = -0.5 + i * 0.5;
    fin.rotation.z = (i / 3) * Math.PI;
  }
  return barrel;
}

function _vortexTornado(scene) {
  // Spiraling cylinder of debris
  const root = MeshBuilder.CreateBox('vortex-root', { width: 0.1, height: 0.1, depth: 0.1 }, scene);
  root.isVisible = false;
  const vortexMat = _ghostMat(scene, 'vortex-mat', 0.6, 0.7, 0.8, 0.4);
  // Funnel: stacked rings of increasing diameter
  for (let i = 0; i < 8; i++) {
    const y = i * 1.0;
    const diam = 1.0 + i * 0.5;
    const ring = MeshBuilder.CreateTorus(`vortex-ring-${i}`, { diameter: diam, thickness: 0.12 + i * 0.02, tessellation: 16 }, scene);
    ring.material = vortexMat;
    ring.parent = root;
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
  }
  // Debris particles (small boxes orbiting)
  const debrisMat = _glow(scene, 'vortex-debris-mat', 0.5, 0.4, 0.3, 0.3);
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const y = (i / 10) * 7;
    const r = 0.8 + y * 0.18;
    const debris = MeshBuilder.CreateBox(`vortex-debris-${i}`, { size: 0.3 + Math.sin(i) * 0.15 }, scene);
    debris.material = debrisMat;
    debris.parent = root;
    debris.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
    debris.rotation.set(i * 0.5, i * 0.7, i * 0.3);
  }
  return root;
}

// ── Extreme Weapon Catalogue ────────────────────────────────────────────────

export const EXTREME_WEAPONS = {
  shockwave_cannon: {
    id: 'shockwave_cannon', name: 'SHOCKWAVE CANNON', icon: '💥',
    category: 'projectile_aoe', damage: 55, speed: 0, radius: 15, lifetime: 1.5,
    blastRadius: 15, blastForce: 20, screenShake: 0.8,
    desc: 'Expanding energy ring that flattens all karts in range',
    rarity: 0.06,
  },
  thunderstrike: {
    id: 'thunderstrike', name: 'THUNDERSTRIKE', icon: '⚡',
    category: 'targeted', damage: 45, speed: 999, radius: 3, lifetime: 2.0,
    debuff: 'pinned', debuffDuration: 2.0, screenShake: 0.5,
    desc: 'Lightning bolt pins target with sparks for 2s',
    rarity: 0.07,
  },
  black_hole: {
    id: 'black_hole', name: 'BLACK HOLE ORB', icon: '🕳️',
    category: 'area_denial', damage: 35, speed: 8, radius: 12, lifetime: 5.0,
    pullForce: 15, crushScale: 0.3, expelForce: 25, shieldBypass: true,
    desc: 'Slow vortex that pulls, crushes, and expels karts',
    rarity: 0.04,
  },
  meteor_swarm: {
    id: 'meteor_swarm', name: 'METEOR SWARM', icon: '☄️',
    category: 'zone_strike', damage: 40, speed: 30, radius: 20, lifetime: 4.0,
    meteorCount: 8, impactRadius: 4, screenShake: 0.6,
    desc: 'Rains burning rocks onto a target zone',
    rarity: 0.05,
  },
  frost_nova: {
    id: 'frost_nova', name: 'FROST NOVA', icon: '❄️',
    category: 'instant_aoe', damage: 20, speed: 0, radius: 15, lifetime: 2.5,
    debuff: 'frozen', debuffDuration: 2.5, screenShake: 0.3,
    desc: 'Instant AOE freeze with ice crystal growth',
    rarity: 0.06,
  },
  emp_pulse: {
    id: 'emp_pulse', name: 'EMP PULSE', icon: '📡',
    category: 'instant_aoe', damage: 10, speed: 0, radius: 18, lifetime: 1.5,
    debuff: 'disabled', debuffDuration: 1.5, screenShake: 0.4,
    desc: 'Disables steering and boost for all nearby karts',
    rarity: 0.07,
  },
  gravity_flip: {
    id: 'gravity_flip', name: 'GRAVITY FLIP', icon: '🔄',
    category: 'area_denial', damage: 15, speed: 0, radius: 12, lifetime: 3.0,
    debuff: 'flipped', debuffDuration: 3.0, gravityMult: -1, screenShake: 0.5,
    desc: 'Reverses gravity for caught karts',
    rarity: 0.05,
  },
  inferno_trail: {
    id: 'inferno_trail', name: 'INFERNO TRAIL', icon: '🔥',
    category: 'trap_trail', damage: 30, speed: 0, radius: 3, lifetime: 5.0,
    trailLength: 8, speedPenalty: 0.4, debuff: 'burning', debuffDuration: 1.5,
    desc: 'Drops persistent fire wall behind the kart',
    rarity: 0.06,
  },
  plasma_railgun: {
    id: 'plasma_railgun', name: 'PLASMA RAILGUN', icon: '🔫',
    category: 'instant_beam', damage: 60, speed: 999, radius: 1, lifetime: 0.5,
    piercing: true, beamLength: 200, screenShake: 0.7,
    desc: 'Instant-hit beam that pierces multiple targets',
    rarity: 0.04,
  },
  vortex_tornado: {
    id: 'vortex_tornado', name: 'VORTEX TORNADO', icon: '🌪️',
    category: 'roaming', damage: 25, speed: 12, radius: 6, lifetime: 6.0,
    liftForce: 18, spinRate: 4.0, screenShake: 0.4,
    desc: 'Wandering tornado that scoops up karts',
    rarity: 0.05,
  },
};

/** Total rarity weight for extreme tier draw */
const EXTREME_TOTAL_RARITY = Object.values(EXTREME_WEAPONS).reduce((s, w) => s + w.rarity, 0);

/**
 * Draw a random extreme weapon (weighted by rarity).
 * Call only after confirming the draw should be extreme-tier.
 */
export function drawExtremeWeapon() {
  let roll = Math.random() * EXTREME_TOTAL_RARITY;
  for (const w of Object.values(EXTREME_WEAPONS)) {
    roll -= w.rarity;
    if (roll <= 0) return { ...w };
  }
  return { ...Object.values(EXTREME_WEAPONS)[0] };
}

// ── Factory Registry ────────────────────────────────────────────────────────

const GENERATORS = {
  // Standard
  bowling: _bowling,
  cake: _cake,
  plunger: _plunger,
  bubblegum: _bubblegum,
  swatter: _swatter,
  item_box: _itemBox,
  nitro: _nitroPickup,
  shield: _shield,
  boost_pad: _boostPad,
  // Extreme
  shockwave_cannon: _shockwaveCannon,
  thunderstrike: _thunderstrike,
  black_hole: _blackHoleOrb,
  meteor_swarm: _meteorSwarm,
  frost_nova: _frostNova,
  emp_pulse: _empPulse,
  gravity_flip: _gravityFlip,
  inferno_trail: _infernoTrail,
  plasma_railgun: _plasmaRailgun,
  vortex_tornado: _vortexTornado,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get or create a procedural model for the given type.
 * Returns a cloned mesh each call for unique positioning.
 *
 * @param {string} type - Model type (bowling, cake, plunger, etc.)
 * @param {BABYLON.Scene} scene
 * @returns {BABYLON.Mesh|null}
 */
export function createProceduralModel(type, scene) {
  const gen = GENERATORS[type];
  if (!gen) return null;

  // Create template if not cached
  const cacheKey = `proc_${type}`;
  if (!_cache[cacheKey]) {
    const template = gen(scene);
    template.setEnabled(false); // Template is invisible
    _cache[cacheKey] = template;
  }

  // Clone from template
  const instance = _cache[cacheKey].clone(`${type}-${Date.now()}`, null);
  instance.setEnabled(true);

  // Clone children too
  const children = _cache[cacheKey].getChildMeshes(false);
  children.forEach(child => {
    const childClone = child.clone(child.name + '-c', instance);
    childClone.setEnabled(true);
  });

  return instance;
}

/**
 * Dispose all cached templates.
 */
export function disposeProceduralModels() {
  for (const key of Object.keys(_cache)) {
    if (_cache[key] && _cache[key].dispose) {
      _cache[key].dispose();
    }
    delete _cache[key];
  }
}

/**
 * Get available standard model types.
 */
export function getModelTypes() {
  return Object.keys(GENERATORS);
}

/**
 * Check if a weapon is extreme tier.
 */
export function isExtremeWeapon(weaponId) {
  return weaponId in EXTREME_WEAPONS;
}

/**
 * Get the extreme weapon definition, or null.
 */
export function getExtremeWeaponDef(weaponId) {
  return EXTREME_WEAPONS[weaponId] || null;
}
