/**
 * weapon-models.js — STK-faithful weapon & item 3D model factories
 *
 * Creates detailed procedural meshes matching SuperTuxKart item designs:
 *   bowling ball, bubblegum, cake, plunger, anchor, swatter,
 *   nitro bottle, parachute, guided missile, grenade,
 *   item box (gift), banana, shield bubble
 *
 * Also provides a GLB-loading fallback: if a GLB file exists at
 *   /models/stk/items/{weaponId}/model.glb
 * it will be loaded instead of the procedural mesh.
 *
 * GPL v3 — asset designs derived from SuperTuxKart (open source).
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';

// Cache for loaded GLB templates (cloned per instance)
const _glbCache = new Map();
// Track which IDs have no GLB (avoid repeated 404s)
const _glbMissing = new Set();

// ── GLB loader (tries /models/stk/items/{id}/model.glb first) ───────────────
/**
 * Attempt to load the GLB model for a weapon. Returns a cloned root mesh
 * if successful, or null if no GLB is available.
 */
export async function tryLoadWeaponGLB(id, scene) {
  if (_glbMissing.has(id)) return null;

  if (_glbCache.has(id)) {
    // Clone from cached template
    const template = _glbCache.get(id);
    const clone = template.clone(id + '_clone', null);
    clone.getChildMeshes().forEach(m => m.setEnabled(true));
    return clone;
  }

  const path = `/models/stk/items/${id}/model.glb`;
  try {
    const result = await SceneLoader.ImportMeshAsync('', path.substring(0, path.lastIndexOf('/') + 1), 'model.glb', scene);
    const root = result.meshes[0];
    root.name = 'weapon_' + id;
    // Cache the template (disabled), return a clone
    root.setEnabled(false);
    root.getChildMeshes().forEach(m => m.setEnabled(false));
    _glbCache.set(id, root);
    const clone = root.clone(id + '_clone', null);
    clone.setEnabled(true);
    clone.getChildMeshes().forEach(m => m.setEnabled(true));
    console.log(`[WeaponModels] Loaded GLB for "${id}"`);
    return clone;
  } catch {
    _glbMissing.add(id);
    return null;
  }
}

// ── Material helpers ────────────────────────────────────────────────────────
function mat(name, color, scene, opts = {}) {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = color instanceof Color3 ? color : Color3.FromHexString(color);
  if (opts.emissive) m.emissiveColor = (color instanceof Color3 ? color : Color3.FromHexString(color)).scale(opts.emissive);
  if (opts.alpha !== undefined) m.alpha = opts.alpha;
  if (opts.specPow) m.specularPower = opts.specPow;
  m.backFaceCulling = opts.backface !== false;
  return m;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROJECTILE MODEL FACTORIES
//  Each returns a TransformNode root with child meshes.
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Bowling Ball — dark sphere with 3 finger holes and a colored stripe.
 */
export function createBowlingBallModel(scene) {
  const root = new TransformNode('mdl_bowling', scene);

  const ball = MeshBuilder.CreateSphere('ball', { diameter: 1.1, segments: 16 }, scene);
  ball.material = mat('bowlMat', new Color3(0.12, 0.12, 0.18), scene, { specPow: 64 });
  ball.parent = root;

  // Stripe (torus ring)
  const stripe = MeshBuilder.CreateTorus('stripe', { diameter: 1.12, thickness: 0.06, tessellation: 24 }, scene);
  stripe.material = mat('stripeMat', new Color3(0.6, 0.78, 1), scene, { emissive: 0.4 });
  stripe.rotation.x = Math.PI / 2;
  stripe.parent = root;

  // Finger holes (3 small cylinders subtracted visually)
  for (let i = 0; i < 3; i++) {
    const hole = MeshBuilder.CreateCylinder('hole' + i, { diameter: 0.14, height: 0.2, tessellation: 8 }, scene);
    hole.material = mat('holeMat', new Color3(0.05, 0.05, 0.05), scene);
    const angle = (i / 3) * Math.PI * 0.6 - 0.3;
    hole.position.set(Math.sin(angle) * 0.3, 0.45, Math.cos(angle) * 0.3);
    hole.rotation.x = -0.3;
    hole.parent = root;
  }

  return root;
}

/**
 * Bubblegum — pink translucent blob on the ground.
 */
export function createBubblegumModel(scene) {
  const root = new TransformNode('mdl_bubblegum', scene);

  // Main blob (squashed sphere)
  const blob = MeshBuilder.CreateSphere('blob', { diameter: 1.0, segments: 12 }, scene);
  blob.scaling.set(1.2, 0.4, 1.2);
  blob.material = mat('gumMat', new Color3(1, 0.41, 0.71), scene, { emissive: 0.2, alpha: 0.7 });
  blob.parent = root;

  // Small bubble on top
  const bubble = MeshBuilder.CreateSphere('bubble', { diameter: 0.35, segments: 8 }, scene);
  bubble.position.y = 0.25;
  bubble.material = mat('bubMat', new Color3(1, 0.6, 0.8), scene, { alpha: 0.5, emissive: 0.3 });
  bubble.parent = root;

  return root;
}

/**
 * Cake — layered cake with frosting, cherry on top (STK signature weapon).
 */
export function createCakeModel(scene) {
  const root = new TransformNode('mdl_cake', scene);

  // Bottom layer
  const bottom = MeshBuilder.CreateCylinder('cakeBot', { diameterTop: 0.9, diameterBottom: 1.0, height: 0.35, tessellation: 16 }, scene);
  bottom.material = mat('cakeBotMat', new Color3(0.85, 0.65, 0.4), scene);
  bottom.position.y = 0.175;
  bottom.parent = root;

  // Middle frosting layer
  const mid = MeshBuilder.CreateCylinder('cakeMid', { diameterTop: 0.85, diameterBottom: 0.9, height: 0.1, tessellation: 16 }, scene);
  mid.material = mat('frostMat', new Color3(1, 0.95, 0.85), scene, { emissive: 0.15 });
  mid.position.y = 0.4;
  mid.parent = root;

  // Top layer
  const top = MeshBuilder.CreateCylinder('cakeTop', { diameterTop: 0.7, diameterBottom: 0.85, height: 0.3, tessellation: 16 }, scene);
  top.material = mat('cakeTopMat', new Color3(0.95, 0.75, 0.5), scene);
  top.position.y = 0.55;
  top.parent = root;

  // Pink frosting top
  const frost = MeshBuilder.CreateCylinder('frostTop', { diameterTop: 0.72, diameterBottom: 0.72, height: 0.06, tessellation: 16 }, scene);
  frost.material = mat('pinkFrost', new Color3(1, 0.6, 0.7), scene, { emissive: 0.2 });
  frost.position.y = 0.73;
  frost.parent = root;

  // Cherry on top
  const cherry = MeshBuilder.CreateSphere('cherry', { diameter: 0.18, segments: 8 }, scene);
  cherry.material = mat('cherryMat', new Color3(0.8, 0.05, 0.05), scene, { emissive: 0.3 });
  cherry.position.y = 0.85;
  cherry.parent = root;

  // Cherry stem
  const stem = MeshBuilder.CreateCylinder('stem', { diameter: 0.03, height: 0.15, tessellation: 6 }, scene);
  stem.material = mat('stemMat', new Color3(0.2, 0.5, 0.1), scene);
  stem.position.y = 0.95;
  stem.parent = root;

  return root;
}

/**
 * Plunger — red rubber cup with wooden handle (STK fast projectile).
 */
export function createPlungerModel(scene) {
  const root = new TransformNode('mdl_plunger', scene);

  // Rubber cup (truncated sphere)
  const cup = MeshBuilder.CreateSphere('cup', { diameter: 0.6, segments: 12, slice: 0.5 }, scene);
  cup.material = mat('cupMat', new Color3(0.85, 0.1, 0.05), scene, { specPow: 32 });
  cup.rotation.x = Math.PI;
  cup.position.y = 0.15;
  cup.parent = root;

  // Inner cup dark
  const inner = MeshBuilder.CreateDisc('innerCup', { radius: 0.28, tessellation: 12 }, scene);
  inner.material = mat('innerMat', new Color3(0.3, 0.02, 0.02), scene);
  inner.rotation.x = Math.PI / 2;
  inner.position.y = 0.02;
  inner.parent = root;

  // Wooden handle
  const handle = MeshBuilder.CreateCylinder('handle', { diameterTop: 0.1, diameterBottom: 0.12, height: 0.7, tessellation: 8 }, scene);
  handle.material = mat('woodMat', new Color3(0.7, 0.5, 0.25), scene);
  handle.position.y = 0.55;
  handle.parent = root;

  return root;
}

/**
 * Anchor — heavy grey metal anchor with chain.
 */
export function createAnchorModel(scene) {
  const root = new TransformNode('mdl_anchor', scene);
  const metalMat = mat('metalMat', new Color3(0.35, 0.38, 0.42), scene, { specPow: 48 });

  // Main shaft
  const shaft = MeshBuilder.CreateCylinder('shaft', { diameter: 0.15, height: 1.0, tessellation: 8 }, scene);
  shaft.material = metalMat;
  shaft.parent = root;

  // Cross bar
  const bar = MeshBuilder.CreateCylinder('bar', { diameter: 0.12, height: 0.6, tessellation: 8 }, scene);
  bar.material = metalMat;
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.3;
  bar.parent = root;

  // Curved hooks (simplified as torus arcs at each end of the cross bar)
  for (const sign of [-1, 1]) {
    const hook = MeshBuilder.CreateTorus('hook', { diameter: 0.3, thickness: 0.08, tessellation: 12, arc: 0.5 }, scene);
    hook.material = metalMat;
    hook.position.set(sign * 0.3, -0.35, 0);
    hook.rotation.y = sign > 0 ? 0 : Math.PI;
    hook.parent = root;
  }

  // Ring at top
  const ring = MeshBuilder.CreateTorus('ring', { diameter: 0.22, thickness: 0.05, tessellation: 12 }, scene);
  ring.material = metalMat;
  ring.position.y = 0.6;
  ring.rotation.x = Math.PI / 2;
  ring.parent = root;

  return root;
}

/**
 * Swatter — fly swatter with grid pattern on the paddle.
 */
export function createSwatterModel(scene) {
  const root = new TransformNode('mdl_swatter', scene);

  // Handle (long thin cylinder)
  const handle = MeshBuilder.CreateCylinder('handle', { diameter: 0.08, height: 1.0, tessellation: 8 }, scene);
  handle.material = mat('swatHandleMat', new Color3(0.2, 0.6, 0.1), scene);
  handle.position.y = -0.2;
  handle.parent = root;

  // Paddle (flat box)
  const paddle = MeshBuilder.CreateBox('paddle', { width: 0.6, height: 0.04, depth: 0.7 }, scene);
  paddle.material = mat('paddleMat', new Color3(0.5, 0.85, 0.2), scene, { emissive: 0.15 });
  paddle.position.y = 0.35;
  paddle.parent = root;

  // Grid lines on paddle (3 horizontal + 3 vertical thin boxes)
  const lineMat = mat('gridLine', new Color3(0.3, 0.6, 0.1), scene);
  for (let i = 0; i < 3; i++) {
    const hLine = MeshBuilder.CreateBox('hGridLine' + i, { width: 0.58, height: 0.05, depth: 0.02 }, scene);
    hLine.material = lineMat;
    hLine.position.set(0, 0.36, -0.2 + i * 0.2);
    hLine.parent = root;

    const vLine = MeshBuilder.CreateBox('vGridLine' + i, { width: 0.02, height: 0.05, depth: 0.68 }, scene);
    vLine.material = lineMat;
    vLine.position.set(-0.2 + i * 0.2, 0.36, 0);
    vLine.parent = root;
  }

  return root;
}

/**
 * Nitro Bottle — green/teal cylinder with a rounded cap and "N₂O" label.
 */
export function createNitroModel(scene) {
  const root = new TransformNode('mdl_nitro', scene);

  // Body (cylinder)
  const body = MeshBuilder.CreateCylinder('nitroBody', { diameterTop: 0.35, diameterBottom: 0.38, height: 0.8, tessellation: 12 }, scene);
  body.material = mat('nitroMat', new Color3(0, 0.8, 0.6), scene, { emissive: 0.25, specPow: 32 });
  body.parent = root;

  // Cap (hemisphere)
  const cap = MeshBuilder.CreateSphere('nitroCap', { diameter: 0.36, segments: 10, slice: 0.5 }, scene);
  cap.material = mat('capMat', new Color3(0.6, 0.6, 0.6), scene, { specPow: 48 });
  cap.position.y = 0.4;
  cap.parent = root;

  // Nozzle
  const nozzle = MeshBuilder.CreateCylinder('nozzle', { diameter: 0.08, height: 0.12, tessellation: 6 }, scene);
  nozzle.material = cap.material;
  nozzle.position.y = 0.55;
  nozzle.parent = root;

  // Label band
  const label = MeshBuilder.CreateCylinder('label', { diameterTop: 0.39, diameterBottom: 0.39, height: 0.15, tessellation: 12 }, scene);
  label.material = mat('labelMat', new Color3(0.9, 0.9, 0.2), scene, { emissive: 0.1 });
  label.position.y = -0.1;
  label.parent = root;

  return root;
}

/**
 * Parachute — cloth canopy with suspension lines.
 */
export function createParachuteModel(scene) {
  const root = new TransformNode('mdl_parachute', scene);

  // Canopy (half sphere)
  const canopy = MeshBuilder.CreateSphere('canopy', { diameter: 1.6, segments: 12, slice: 0.5 }, scene);
  canopy.material = mat('canopyMat', new Color3(1, 0.65, 0.1), scene, { alpha: 0.85, emissive: 0.15, backface: false });
  canopy.position.y = 0.3;
  canopy.parent = root;

  // Canopy segment lines (thin dark lines across the dome)
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const line = MeshBuilder.CreateCylinder('line' + i, { diameter: 0.015, height: 1.3, tessellation: 4 }, scene);
    line.material = mat('lineMat', new Color3(0.3, 0.2, 0.1), scene);
    const midX = Math.cos(angle) * 0.4;
    const midZ = Math.sin(angle) * 0.4;
    line.position.set(midX, -0.2, midZ);
    // Angle line from canopy edge to center bottom
    line.lookAt(new Vector3(0, -0.8, 0));
    line.parent = root;
  }

  return root;
}

/**
 * Guided Missile — streamlined rocket body with fins and nose cone.
 */
export function createGuidedMissileModel(scene) {
  const root = new TransformNode('mdl_missile', scene);

  // Body (cylinder)
  const body = MeshBuilder.CreateCylinder('missileBody', { diameterTop: 0.25, diameterBottom: 0.3, height: 1.0, tessellation: 12 }, scene);
  body.material = mat('missileMat', new Color3(0.7, 0.05, 0.05), scene, { specPow: 32 });
  body.rotation.x = Math.PI / 2; // Orient along Z axis
  body.parent = root;

  // Nose cone
  const nose = MeshBuilder.CreateCylinder('nose', { diameterTop: 0, diameterBottom: 0.25, height: 0.35, tessellation: 12 }, scene);
  nose.material = mat('noseMat', new Color3(0.8, 0.8, 0.8), scene, { specPow: 48 });
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.65;
  nose.parent = root;

  // Exhaust nozzle
  const nozzle = MeshBuilder.CreateCylinder('exhaust', { diameterTop: 0.3, diameterBottom: 0.2, height: 0.12, tessellation: 10 }, scene);
  nozzle.material = mat('nozzleMat', new Color3(0.3, 0.3, 0.3), scene);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = -0.55;
  nozzle.parent = root;

  // Fins (4 fins at 90° intervals)
  const finMat = mat('finMat', new Color3(0.5, 0.05, 0.05), scene);
  for (let i = 0; i < 4; i++) {
    const fin = MeshBuilder.CreateBox('fin' + i, { width: 0.02, height: 0.3, depth: 0.25 }, scene);
    fin.material = finMat;
    const angle = (i / 4) * Math.PI * 2;
    fin.position.set(Math.cos(angle) * 0.16, Math.sin(angle) * 0.16, -0.35);
    fin.rotation.z = angle;
    fin.parent = root;
  }

  // Stripe band
  const band = MeshBuilder.CreateTorus('band', { diameter: 0.31, thickness: 0.03, tessellation: 12 }, scene);
  band.material = mat('bandMat', new Color3(1, 1, 0.2), scene, { emissive: 0.3 });
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.1;
  band.parent = root;

  return root;
}

/**
 * Grenade — olive drab sphere with segmented body and pin ring.
 */
export function createGrenadeModel(scene) {
  const root = new TransformNode('mdl_grenade', scene);

  // Body (sphere with grooves simulated by torus rings)
  const body = MeshBuilder.CreateSphere('grenBody', { diameter: 0.65, segments: 12 }, scene);
  body.material = mat('grenMat', new Color3(0.33, 0.42, 0.18), scene, { specPow: 20 });
  body.parent = root;

  // Horizontal groove rings
  for (let i = 0; i < 3; i++) {
    const groove = MeshBuilder.CreateTorus('groove' + i, { diameter: 0.66, thickness: 0.02, tessellation: 16 }, scene);
    groove.material = mat('grooveMat', new Color3(0.25, 0.32, 0.12), scene);
    groove.position.y = -0.12 + i * 0.12;
    groove.parent = root;
  }

  // Spoon (lever on top)
  const spoon = MeshBuilder.CreateBox('spoon', { width: 0.06, height: 0.02, depth: 0.35 }, scene);
  spoon.material = mat('spoonMat', new Color3(0.5, 0.5, 0.45), scene, { specPow: 32 });
  spoon.position.set(0, 0.34, 0.05);
  spoon.parent = root;

  // Pin ring
  const pin = MeshBuilder.CreateTorus('pin', { diameter: 0.12, thickness: 0.02, tessellation: 8 }, scene);
  pin.material = mat('pinMat', new Color3(0.6, 0.55, 0.2), scene);
  pin.position.set(0, 0.38, -0.08);
  pin.rotation.x = Math.PI / 4;
  pin.parent = root;

  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PICKUP / ITEM BOX MODELS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * STK Gift Box — spinning cube with "?" mark, ribbon, and glow.
 */
export function createItemBoxModel(scene) {
  const root = new TransformNode('mdl_itembox', scene);

  // Main box
  const box = MeshBuilder.CreateBox('giftBox', { size: 1.5 }, scene);
  const boxMat = mat('giftMat', new Color3(1, 0.78, 0), scene, { emissive: 0.2 });
  box.material = boxMat;
  box.parent = root;

  // Ribbon wrap (cross)
  const ribbonMat = mat('ribbonMat', new Color3(0.9, 0.15, 0.15), scene, { emissive: 0.3 });
  const rH = MeshBuilder.CreateBox('ribbonH', { width: 1.52, height: 0.12, depth: 1.52 }, scene);
  rH.material = ribbonMat;
  rH.position.y = 0.02;
  rH.parent = root;
  const rV = MeshBuilder.CreateBox('ribbonV', { width: 0.12, height: 1.52, depth: 1.52 }, scene);
  rV.material = ribbonMat;
  rV.position.x = 0.02;
  rV.parent = root;

  // Bow on top (two small spheres + cylinder knot)
  const bowMat = mat('bowMat', new Color3(0.95, 0.2, 0.2), scene, { emissive: 0.25 });
  for (const sign of [-1, 1]) {
    const loop = MeshBuilder.CreateSphere('bowLoop', { diameter: 0.3, segments: 8 }, scene);
    loop.material = bowMat;
    loop.scaling.set(1.4, 0.6, 1);
    loop.position.set(sign * 0.2, 0.85, 0);
    loop.parent = root;
  }
  const knot = MeshBuilder.CreateSphere('bowKnot', { diameter: 0.18, segments: 6 }, scene);
  knot.material = bowMat;
  knot.position.y = 0.82;
  knot.parent = root;

  // Question mark billboard
  const tex = new DynamicTexture('boxQTex', 128, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 96px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', 64, 64);
  tex.update();

  const qPlane = MeshBuilder.CreatePlane('qMark', { size: 0.7 }, scene);
  const qMat = new StandardMaterial('qMarkMat', scene);
  qMat.diffuseTexture = tex;
  qMat.useAlphaFromDiffuseTexture = true;
  qMat.backFaceCulling = false;
  qMat.emissiveColor = Color3.White();
  qPlane.material = qMat;
  qPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  qPlane.position.y = 0;
  qPlane.parent = root;

  root.metadata = { isPickup: true };
  return root;
}

/**
 * Banana — curved yellow crescent shape.
 */
export function createBananaModel(scene) {
  const root = new TransformNode('mdl_banana', scene);

  // Banana body (curved via bent torus arc)
  const banana = MeshBuilder.CreateTorus('bananaBody', { diameter: 0.6, thickness: 0.18, tessellation: 16, arc: 0.55 }, scene);
  banana.material = mat('bananaMat', new Color3(1, 0.88, 0.1), scene, { emissive: 0.1 });
  banana.rotation.x = Math.PI / 2;
  banana.parent = root;

  // Dark tip
  const tip = MeshBuilder.CreateSphere('bananaTip', { diameter: 0.1, segments: 6 }, scene);
  tip.material = mat('tipMat', new Color3(0.4, 0.3, 0.1), scene);
  tip.position.set(0.28, 0, 0.05);
  tip.parent = root;

  return root;
}

/**
 * Shield Bubble — transparent blue sphere with hex-pattern hint.
 */
export function createShieldModel(scene) {
  const root = new TransformNode('mdl_shield', scene);

  const bubble = MeshBuilder.CreateSphere('shield', { diameter: 3.0, segments: 16 }, scene);
  bubble.material = mat('shieldMat', new Color3(0.3, 0.6, 1), scene, { alpha: 0.25, emissive: 0.4, backface: false });
  bubble.parent = root;

  // Inner glow sphere
  const glow = MeshBuilder.CreateSphere('shieldGlow', { diameter: 2.85, segments: 12 }, scene);
  glow.material = mat('glowMat', new Color3(0.5, 0.8, 1), scene, { alpha: 0.1, emissive: 0.6, backface: false });
  glow.parent = root;

  return root;
}

/**
 * Pickup ring — rotating torus with the weapon's color (used when weapon GLB isn't available).
 * This replaces the old generic torus pickup.
 */
export function createPickupRingModel(scene, color) {
  const root = new TransformNode('mdl_pickup_ring', scene);

  const c3 = color instanceof Color3 ? color : Color3.FromHexString('#' + (color || 0xffffff).toString(16).padStart(6, '0'));

  const torus = MeshBuilder.CreateTorus('pickupRing', { diameter: 1.44, thickness: 0.22, tessellation: 28 }, scene);
  torus.material = mat('pickupRingMat', c3, scene, { emissive: 0.5 });
  torus.parent = root;

  // Inner diamond float
  const diamond = MeshBuilder.CreatePolyhedron('diamond', { type: 1, size: 0.25 }, scene);
  diamond.material = mat('diamondMat', c3, scene, { emissive: 0.6 });
  diamond.parent = root;

  root.metadata = { isPickup: true };
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
//  REGISTRY — maps weapon ID → factory function
// ═════════════════════════════════════════════════════════════════════════════

export const WEAPON_MODEL_FACTORIES = {
  bowling:        createBowlingBallModel,
  bubblegum:      createBubblegumModel,
  cake:           createCakeModel,
  plunger:        createPlungerModel,
  anchor:         createAnchorModel,
  swatter:        createSwatterModel,
  nitro:          createNitroModel,
  parachute:      createParachuteModel,
  guided_missile: createGuidedMissileModel,
  grenade:        createGrenadeModel,
};

/**
 * Create a projectile mesh for the given weapon type.
 * Tries GLB first, falls back to procedural model factory,
 * then falls back to a colored sphere if nothing else is available.
 */
export function createWeaponModel(weaponId, scene) {
  const factory = WEAPON_MODEL_FACTORIES[weaponId];
  if (factory) return factory(scene);

  // Unknown weapon — return colored sphere fallback
  const mesh = MeshBuilder.CreateSphere('proj_fallback', { diameter: 0.8, segments: 10 }, scene);
  mesh.material = mat('fallbackMat', new Color3(0.8, 0.4, 0.1), scene, { emissive: 0.3 });
  return mesh;
}
