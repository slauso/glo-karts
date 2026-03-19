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
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { GPUParticleSystem } from '@babylonjs/core/Particles/gpuParticleSystem';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { NodeMaterial } from '@babylonjs/core/Materials/Node/nodeMaterial';
import { Effect } from '@babylonjs/core/Materials/effect';
import { Engine } from '@babylonjs/core/Engines/engine';
import '@babylonjs/core/Shaders/particles.vertex';
import '@babylonjs/core/Shaders/particles.fragment';

// Cache for loaded GLB templates (cloned per instance)
const _glbCache = new Map();
// Track which IDs have no GLB (avoid repeated 404s)
const _glbMissing = new Set();
const _externalGlbCache = new Map();
const _externalGlbMissing = new Set();

let _tornadoNoiseTexture = null;

if (!Effect.ShadersStore.tornadoVortexVertexShader) {
  Effect.ShadersStore.tornadoVortexVertexShader = `
    precision highp float;

    attribute vec3 position;
    attribute vec2 uv;

    uniform mat4 world;
    uniform mat4 worldViewProjection;
    uniform float time;
    uniform float parabolStrength;
    uniform float parabolOffset;
    uniform float parabolAmplitude;
    uniform float radiusScale;
    uniform float turbulence;

    varying vec2 vUV;
    varying float vHeight;

    void main(void) {
      vec3 p = position;
      float angle = atan(p.z, p.x);
      float elevation = p.y;
      float radius = (parabolStrength * pow(max(0.0, elevation - parabolOffset), 2.0) + parabolAmplitude) * radiusScale;
      radius += sin((elevation - time) * 20.0 + angle * 2.0) * turbulence;

      vec3 twisted = vec3(
        cos(angle + elevation * 0.65 + time * 0.85) * radius,
        elevation,
        sin(angle + elevation * 0.65 + time * 0.85) * radius
      );

      vUV = uv;
      vHeight = elevation;
      gl_Position = worldViewProjection * vec4(twisted, 1.0);
    }
  `;

  Effect.ShadersStore.tornadoVortexFragmentShader = `
    precision highp float;

    varying vec2 vUV;
    varying float vHeight;

    uniform sampler2D noiseTex;
    uniform vec3 emissiveColor;
    uniform float time;
    uniform float alphaScale;
    uniform float darkLayer;

    vec2 skewUv(vec2 inUv, vec2 skew) {
      return vec2(inUv.x + inUv.y * skew.x, inUv.y + inUv.x * skew.y);
    }

    void main(void) {
      vec2 uv1 = vUV + vec2(time, -time);
      uv1 = skewUv(uv1, vec2(-1.0, 0.0)) * vec2(2.0, 0.25);
      float noise1 = smoothstep(0.45, 0.7, texture2D(noiseTex, uv1).r);

      vec2 uv2 = vUV + vec2(time * 0.5, -time);
      uv2 = skewUv(uv2, vec2(-1.0, 0.0)) * vec2(5.0, 1.0);
      float noise2 = smoothstep(0.45, 0.7, texture2D(noiseTex, uv2).g);

      float outerFade = min(
        smoothstep(0.0, darkLayer > 0.5 ? 0.2 : 0.1, vUV.y),
        smoothstep(0.0, 0.4, 1.0 - vUV.y)
      );
      float radialFade = smoothstep(0.02, 0.25, vUV.x * (1.0 - vUV.x) + 0.03);
      float effect = noise1 * noise2 * outerFade * radialFade;

      vec3 color = darkLayer > 0.5 ? vec3(0.05, 0.08, 0.09) : emissiveColor;
      float alpha = smoothstep(0.0, darkLayer > 0.5 ? 0.01 : 0.1, effect) * alphaScale;
      gl_FragColor = vec4(color, alpha);
    }
  `;
}

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

async function tryLoadExternalGLB(cacheId, dir, file, scene) {
  if (_externalGlbMissing.has(cacheId)) return null;

  if (_externalGlbCache.has(cacheId)) {
    const template = _externalGlbCache.get(cacheId);
    const clone = template.clone(cacheId + '_clone', null);
    if (clone?.setEnabled) clone.setEnabled(true);
    clone?.getChildMeshes?.().forEach((mesh) => mesh.setEnabled(true));
    return clone;
  }

  try {
    const result = await SceneLoader.ImportMeshAsync('', dir, file, scene);
    const root = result.meshes[0];
    if (!root) {
      _externalGlbMissing.add(cacheId);
      return null;
    }
    root.name = cacheId;
    if (root.setEnabled) root.setEnabled(false);
    root.getChildMeshes?.().forEach((mesh) => mesh.setEnabled(false));
    _externalGlbCache.set(cacheId, root);

    const clone = root.clone(cacheId + '_clone', null);
    if (clone?.setEnabled) clone.setEnabled(true);
    clone?.getChildMeshes?.().forEach((mesh) => mesh.setEnabled(true));
    return clone;
  } catch {
    _externalGlbMissing.add(cacheId);
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

export function createTornadoModel(scene) {
  const root = new TransformNode('mdl_tornado', scene);
  root.scaling.set(0.95, 1.0, 0.95);

  const ownedMaterials = [];
  const ownedSystems = [];

  const outerShell = MeshBuilder.CreateCylinder('torn_outer_v2', {
    diameterTop: 2.2,
    diameterBottom: 2.2,
    height: 12.6,
    tessellation: 40,
    subdivisions: 28,
    arc: 1,
    enclose: false,
  }, scene);
  outerShell.position.y = 5.85;
  outerShell.parent = root;
  outerShell.isPickable = false;
  outerShell.material = _createTornadoShaderMaterial(
    'torn_outerMat_v2',
    scene,
    new Color3(0.74, 0.95, 1.0),
    {
      parabolStrength: 0.155,
      parabolOffset: 0.24,
      parabolAmplitude: 0.14,
      radiusScale: 1.06,
      turbulence: 0.08,
      alphaScale: 0.78,
      darkLayer: false,
    }
  );
  ownedMaterials.push(outerShell.material);

  const midShell = MeshBuilder.CreateCylinder('torn_mid_v2', {
    diameterTop: 1.9,
    diameterBottom: 1.9,
    height: 11.8,
    tessellation: 34,
    subdivisions: 24,
    arc: 1,
    enclose: false,
  }, scene);
  midShell.position.y = 5.55;
  midShell.scaling.x = 0.84;
  midShell.scaling.z = 0.84;
  midShell.parent = root;
  midShell.isPickable = false;
  midShell.material = _createTornadoShaderMaterial(
    'torn_midMat_v2',
    scene,
    new Color3(0.46, 0.76, 0.86),
    {
      parabolStrength: 0.148,
      parabolOffset: 0.34,
      parabolAmplitude: 0.16,
      radiusScale: 0.94,
      turbulence: 0.06,
      alphaScale: 0.54,
      darkLayer: false,
    }
  );
  ownedMaterials.push(midShell.material);

  const darkCore = MeshBuilder.CreateCylinder('torn_darkCore_v2', {
    diameterTop: 1.4,
    diameterBottom: 1.4,
    height: 10.9,
    tessellation: 26,
    subdivisions: 22,
    arc: 1,
    enclose: false,
  }, scene);
  darkCore.position.y = 5.25;
  darkCore.scaling.x = 0.62;
  darkCore.scaling.z = 0.62;
  darkCore.parent = root;
  darkCore.isPickable = false;
  darkCore.material = _createTornadoShaderMaterial(
    'torn_darkCoreMat_v2',
    scene,
    new Color3(0.08, 0.11, 0.13),
    {
      parabolStrength: 0.142,
      parabolOffset: 0.36,
      parabolAmplitude: 0.18,
      radiusScale: 0.72,
      turbulence: 0.04,
      alphaScale: 0.48,
      darkLayer: true,
    }
  );
  ownedMaterials.push(darkCore.material);

  const eyeGlow = MeshBuilder.CreateCylinder('torn_eyeGlow_v2', {
    diameterTop: 0.08,
    diameterBottom: 0.58,
    height: 8.8,
    tessellation: 18,
  }, scene);
  const eyeGlowMat = mat('torn_eyeGlowMat_v2', new Color3(0.9, 0.98, 1.0), scene, { emissive: 0.95, alpha: 0.16 });
  eyeGlowMat.backFaceCulling = false;
  eyeGlow.material = eyeGlowMat;
  ownedMaterials.push(eyeGlowMat);
  eyeGlow.position.y = 4.7;
  eyeGlow.parent = root;
  eyeGlow.isPickable = false;

  const baseCore = MeshBuilder.CreateCylinder('torn_baseCore_v2', {
    diameterTop: 1.35,
    diameterBottom: 2.9,
    height: 1.1,
    tessellation: 24,
  }, scene);
  const baseCoreMat = mat('torn_baseCoreMat_v2', new Color3(0.22, 0.34, 0.36), scene, { emissive: 0.45, alpha: 0.42 });
  baseCoreMat.backFaceCulling = false;
  baseCore.material = baseCoreMat;
  ownedMaterials.push(baseCoreMat);
  baseCore.position.y = 0.55;
  baseCore.parent = root;
  baseCore.isPickable = false;

  const shockRing = MeshBuilder.CreateTorus('torn_shockRing_v2', {
    diameter: 4.5,
    thickness: 0.12,
    tessellation: 56,
  }, scene);
  const shockRingMat = mat('torn_shockRingMat_v2', new Color3(0.86, 0.99, 0.98), scene, { emissive: 0.92, alpha: 0.3 });
  shockRingMat.backFaceCulling = false;
  shockRing.material = shockRingMat;
  ownedMaterials.push(shockRingMat);
  shockRing.parent = root;
  shockRing.position.y = 0.18;
  shockRing.rotation.x = Math.PI * 0.5;
  shockRing.isPickable = false;

  const swirlSpecs = [
    { y: 1.2, diameter: 3.3, thickness: 0.18, speed: 1.0 },
    { y: 3.6, diameter: 2.45, thickness: 0.13, speed: -1.35 },
    { y: 6.7, diameter: 1.55, thickness: 0.1, speed: 1.8 },
  ];
  const swirlRings = swirlSpecs.map((spec, index) => {
    const ring = MeshBuilder.CreateTorus(`torn_swirl_v2_${index}`, {
      diameter: spec.diameter,
      thickness: spec.thickness,
      tessellation: 40,
    }, scene);
    const ringMat = mat(
      `torn_swirlMat_v2_${index}`,
      new Color3(0.68 + index * 0.08, 0.9 + index * 0.02, 0.95 + index * 0.015),
      scene,
      { emissive: 0.85, alpha: 0.24 - index * 0.03 }
    );
    ringMat.backFaceCulling = false;
    ring.material = ringMat;
    ownedMaterials.push(ringMat);
    ring.parent = root;
    ring.position.y = spec.y;
    ring.rotation.x = Math.PI * 0.5;
    ring.rotation.z = index % 2 === 0 ? Math.PI * 0.18 : -Math.PI * 0.14;
    ring.isPickable = false;
    ring.metadata = { spinDirection: spec.speed };
    return ring;
  });

  const mistEmitter = new TransformNode('torn_mistEmitter_v2', scene);
  mistEmitter.parent = root;
  mistEmitter.position.y = 4.1;

  const sparkEmitter = new TransformNode('torn_sparkEmitter_v2', scene);
  sparkEmitter.parent = root;
  sparkEmitter.position.y = 4.7;

  const mist = _createTornadoParticleSystem('torn_mist_v2', scene, mistEmitter, {
    useGPU: true,
    capacity: 180,
    emitRate: 88,
    emitterShape: 'cylinder',
    emitterRadius: 2.25,
    emitterHeight: 8.8,
    radiusRange: 1,
    directionRandomizer: 0.2,
    minLifeTime: 0.22,
    maxLifeTime: 0.72,
    minSize: 0.2,
    maxSize: 0.72,
    sizeStart: 0.08,
    sizeMid: 0.58,
    sizeEnd: 0.14,
    minEmitPower: 1.2,
    maxEmitPower: 4.8,
    gravity: new Vector3(0, 1.2, 0),
    direction1: new Vector3(-1.9, 2.8, -1.9),
    direction2: new Vector3(1.9, 10.4, 1.9),
    color1: new Color4(0.84, 0.97, 1.0, 0.72),
    color2: new Color4(0.48, 0.82, 0.92, 0.34),
    colorDead: new Color4(0.12, 0.22, 0.28, 0),
    angularStart: -6,
    angularEnd: 8,
    velocityGradients: [[0, 0.22], [0.55, 1.0], [1, 0.34]],
  });
  ownedSystems.push(mist);

  const debris = _createTornadoParticleSystem('torn_debris_v2', scene, root, {
    useGPU: false,
    capacity: 84,
    emitRate: 34,
    emitterShape: 'cylinder',
    emitterRadius: 2.8,
    emitterHeight: 1.1,
    radiusRange: 1,
    directionRandomizer: 0.12,
    minLifeTime: 0.32,
    maxLifeTime: 0.95,
    minSize: 0.18,
    maxSize: 0.58,
    sizeStart: 0.14,
    sizeMid: 0.44,
    sizeEnd: 0.08,
    minEmitPower: 0.7,
    maxEmitPower: 3.8,
    gravity: new Vector3(0, -0.9, 0),
    direction1: new Vector3(-3.4, 0.25, -3.4),
    direction2: new Vector3(3.4, 2.1, 3.4),
    color1: new Color4(0.54, 0.46, 0.35, 0.48),
    color2: new Color4(0.38, 0.33, 0.25, 0.28),
    colorDead: new Color4(0.18, 0.18, 0.18, 0),
    blendMode: ParticleSystem.BLENDMODE_STANDARD,
    angularStart: -2,
    angularEnd: 3,
  });
  ownedSystems.push(debris);

  const sparks = _createTornadoParticleSystem('torn_sparks_v2', scene, sparkEmitter, {
    useGPU: true,
    capacity: 64,
    emitRate: 20,
    emitterShape: 'cylinder',
    emitterRadius: 0.85,
    emitterHeight: 7.6,
    radiusRange: 0.65,
    directionRandomizer: 0.08,
    minLifeTime: 0.06,
    maxLifeTime: 0.18,
    minSize: 0.05,
    maxSize: 0.16,
    sizeStart: 0.04,
    sizeMid: 0.12,
    sizeEnd: 0.02,
    minEmitPower: 6,
    maxEmitPower: 18,
    gravity: new Vector3(0, 0, 0),
    direction1: new Vector3(-0.9, -0.6, -0.9),
    direction2: new Vector3(0.9, 0.9, 0.9),
    color1: new Color4(1.0, 1.0, 1.0, 0.92),
    color2: new Color4(0.58, 0.88, 1.0, 0.6),
    colorDead: new Color4(0.2, 0.42, 0.72, 0),
    angularStart: -10,
    angularEnd: 10,
  });
  ownedSystems.push(sparks);

  const outerMat = outerShell.material;
  const midMat = midShell.material;
  const darkMat = darkCore.material;
  let elapsed = Math.random() * Math.PI * 2;
  const spinObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() * 0.001;
    elapsed += dt;

    const surge = 1.0 + Math.sin(elapsed * 3.3) * 0.05;
    const shear = 0.96 + Math.sin(elapsed * 5.8) * 0.05;

    outerMat.setFloat('time', elapsed * 1.05);
    outerMat.setFloat('radiusScale', 1.04 * surge);
    midMat.setFloat('time', elapsed * 1.42 + 1.3);
    midMat.setFloat('radiusScale', 0.92 * shear);
    darkMat.setFloat('time', elapsed * 1.86 + 2.1);
    darkMat.setFloat('radiusScale', 0.7 + Math.sin(elapsed * 4.4) * 0.03);

    root.rotation.y += dt * 0.85;
    eyeGlow.rotation.y -= dt * 3.2;
    baseCore.rotation.y += dt * 1.8;

    const ringPulse = 1.0 + Math.sin(elapsed * 8.4) * 0.08;
    shockRing.scaling.x = ringPulse;
    shockRing.scaling.y = ringPulse;
    shockRing.scaling.z = 0.86 + Math.sin(elapsed * 6.1) * 0.05;
    shockRing.position.y = 0.12 + Math.sin(elapsed * 7.2) * 0.04;

    swirlRings.forEach((ring, index) => {
      const ringTime = elapsed * (3.5 + index * 0.55);
      ring.rotation.y += dt * (5.6 + index * 2.3) * (ring.metadata?.spinDirection ?? 1);
      const pulse = 1.0 + Math.sin(ringTime) * (0.1 - index * 0.015);
      ring.scaling.x = pulse;
      ring.scaling.y = pulse;
      ring.scaling.z = pulse;
      ring.position.x = Math.sin(ringTime * 0.45) * 0.08 * (index + 1);
      ring.position.z = Math.cos(ringTime * 0.45) * 0.08 * (index + 1);
    });
  });

  root.onDisposeObservable.add(() => {
    if (spinObserver) {
      scene.onBeforeRenderObservable.remove(spinObserver);
    }
    ownedSystems.forEach((system) => {
      try {
        system.stop();
      } catch {}
      try {
        system.dispose();
      } catch {}
    });
    ownedMaterials.forEach((material) => {
      try {
        material.dispose();
      } catch {}
    });
  });

  root.metadata = {
    visualType: 'tornado',
    mistPS: mist,
    debrisPS: debris,
    sparksPS: sparks,
    spinObserver,
    swirlRings,
    shockRing,
    outerShell,
    midShell,
    darkCore,
    eyeGlow,
  };

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

// Carousel item IDs — only items that actually exist in the race draw pool
const _CAROUSEL_ITEMS = [
  'bowling', 'cake', 'plunger', 'guided_missile',
  'bubblegum', 'nitro', 'swatter', 'banana',
  'anchor', 'parachute',
];

/**
 * Spawn a random mini weapon model inside the carousel node.
 * Disposes the previous child first. Models are scaled down and made
 * semi-transparent so they look like holographic previews.
 */
function _spawnCarouselItem(carouselNode, scene) {
  // Dispose previous carousel child
  const kids = carouselNode.getChildMeshes(true);
  for (const k of kids) k.dispose(false, false);
  const oldKids = carouselNode.getChildren();
  for (const k of oldKids) { try { k.dispose(); } catch (_) { /* ok */ } }

  const weaponId = _CAROUSEL_ITEMS[Math.floor(Math.random() * _CAROUSEL_ITEMS.length)];
  const factory = WEAPON_MODEL_FACTORIES[weaponId];
  if (!factory) return;

  const model = factory(scene);
  model.parent = carouselNode;
  model.scaling.setAll(0.85);
  model.position.setAll(0);

  // Make all child meshes semi-transparent and emissive for holographic look
  for (const mesh of model.getChildMeshes(false)) {
    if (mesh.material) {
      const cloned = mesh.material.clone(mesh.material.name + '_carousel');
      cloned.alpha = Math.min(cloned.alpha ?? 1, 0.75);
      if (cloned.emissiveColor) {
        cloned.emissiveColor = cloned.emissiveColor.add(new Color3(0.2, 0.2, 0.3));
      }
      mesh.material = cloned;
    }
  }
}

/**
 * Create a DynamicTexture with a sleek tech-panel look for item box faces.
 * Radial glow, fine grid lines, corner accents — no text glyph.
 */
function _createItemBoxFaceTexture(scene) {
  const size = 256;
  const tex = new DynamicTexture('itemBoxFaceTex', size, scene, true);
  const ctx = tex.getContext();
  const cx = size / 2;

  // Deep blue-purple base
  ctx.fillStyle = '#0a1428';
  ctx.fillRect(0, 0, size, size);

  // Radial glow from center
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0, 'rgba(60,140,255,0.35)');
  grad.addColorStop(0.5, 'rgba(30,80,200,0.12)');
  grad.addColorStop(1, 'rgba(0,10,40,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Fine grid lines
  ctx.strokeStyle = 'rgba(80,160,255,0.08)';
  ctx.lineWidth = 1;
  const step = 32;
  for (let i = step; i < size; i += step) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }

  // Inset border with rounded corners
  ctx.strokeStyle = 'rgba(100,180,255,0.25)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(10, 10, size - 20, size - 20, 14);
  ctx.stroke();

  // Corner accent dots
  const dotR = 4;
  ctx.fillStyle = 'rgba(120,200,255,0.5)';
  for (const [dx, dy] of [[18, 18], [size - 18, 18], [18, size - 18], [size - 18, size - 18]]) {
    ctx.beginPath(); ctx.arc(dx, dy, dotR, 0, Math.PI * 2); ctx.fill();
  }

  // Subtle inner diamond highlight
  ctx.strokeStyle = 'rgba(140,200,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 30); ctx.lineTo(size - 30, cx);
  ctx.lineTo(cx, size - 30); ctx.lineTo(30, cx);
  ctx.closePath(); ctx.stroke();

  tex.update();
  return tex;
}

/**
 * Enhanced Item Box — holographic tech-cube with internal weapon carousel,
 * prismatic wireframe overlay, pulsing core, and orbiting sparkle particles.
 *
 * Visual design:
 *   - Translucent dark-blue cube with tech-panel face texture
 *   - Inner glowing core that pulses
 *   - Edge-highlight wireframe overlay
 *   - Internal carousel showing randomized mini weapon models
 *   - Orbiting sparkle particle system
 *   - Tilted-axis rotation for classic MK feel
 *   - Per-frame rainbow color cycling (handled by race-items.js)
 */
export function createItemBoxModel(scene) {
  const root = new TransformNode('mdl_itembox', scene);

  // ── Outer translucent cube with tech-panel faces ──────────────────────
  const faceTexture = _createItemBoxFaceTexture(scene);

  const box = MeshBuilder.CreateBox('itemBox', { size: 1.6, updatable: false }, scene);
  const boxMat = new StandardMaterial('itemBoxMat', scene);
  boxMat.diffuseTexture = faceTexture;
  boxMat.emissiveColor = new Color3(0.08, 0.3, 0.8);
  boxMat.specularColor = new Color3(0.5, 0.5, 0.7);
  boxMat.specularPower = 80;
  boxMat.alpha = 0.72;
  boxMat.backFaceCulling = false;
  box.material = boxMat;
  box.parent = root;

  // ── Soft diffused edge glow (replaces hard wireframe) ──────────────────
  // A slightly larger semi-transparent additive box creates a soft bloom
  // around edges rather than crisp wireframe lines.
  const glowBox = MeshBuilder.CreateBox('itemBoxGlow', { size: 1.72 }, scene);
  const glowMat = new StandardMaterial('itemBoxGlowMat', scene);
  glowMat.emissiveColor = new Color3(0.3, 0.6, 1.0);
  glowMat.diffuseColor = new Color3(0, 0, 0);
  glowMat.specularColor = new Color3(0, 0, 0);
  glowMat.alpha = 0.12;
  glowMat.disableLighting = true;
  glowMat.backFaceCulling = false;
  glowBox.material = glowMat;
  glowBox.parent = root;

  // Second halo layer — even larger, more diffuse for soft falloff
  const haloBox = MeshBuilder.CreateBox('itemBoxHalo', { size: 1.88 }, scene);
  const haloMat = new StandardMaterial('itemBoxHaloMat', scene);
  haloMat.emissiveColor = new Color3(0.2, 0.45, 0.9);
  haloMat.diffuseColor = new Color3(0, 0, 0);
  haloMat.specularColor = new Color3(0, 0, 0);
  haloMat.alpha = 0.06;
  haloMat.disableLighting = true;
  haloMat.backFaceCulling = false;
  haloBox.material = haloMat;
  haloBox.parent = root;

  // ── Inner glowing core sphere ─────────────────────────────────────────
  const core = MeshBuilder.CreateSphere('itemBoxCore', { diameter: 0.55, segments: 10 }, scene);
  const coreMat = new StandardMaterial('itemBoxCoreMat', scene);
  coreMat.diffuseColor = new Color3(1, 1, 1);
  coreMat.emissiveColor = new Color3(0.6, 0.75, 1.0);
  coreMat.alpha = 0.55;
  coreMat.disableLighting = true;
  core.material = coreMat;
  core.parent = root;

  // ── Internal weapon carousel ──────────────────────────────────────────
  const carouselNode = new TransformNode('itemBoxCarousel', scene);
  carouselNode.parent = root;
  _spawnCarouselItem(carouselNode, scene);

  // ── Orbiting sparkle particle system ──────────────────────────────────
  const sparklePS = new ParticleSystem('itemBoxSparkles', 20, scene);
  sparklePS.particleTexture = new Texture(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    scene
  );
  sparklePS.emitter = root;
  sparklePS.minEmitBox = new Vector3(-1.0, -1.0, -1.0);
  sparklePS.maxEmitBox = new Vector3(1.0, 1.0, 1.0);
  sparklePS.emitRate = 5;
  sparklePS.minLifeTime = 0.8;
  sparklePS.maxLifeTime = 1.4;
  sparklePS.minSize = 0.05;
  sparklePS.maxSize = 0.12;
  sparklePS.color1 = new Color4(0.5, 0.8, 1.0, 0.85);
  sparklePS.color2 = new Color4(0.3, 0.5, 1.0, 0.65);
  sparklePS.colorDead = new Color4(0.1, 0.2, 0.8, 0);
  sparklePS.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparklePS.gravity = new Vector3(0, 0.2, 0);
  sparklePS.minEmitPower = 0.2;
  sparklePS.maxEmitPower = 0.6;
  sparklePS.direction1 = new Vector3(-0.4, 0.4, -0.4);
  sparklePS.direction2 = new Vector3(0.4, 0.8, 0.4);

  sparklePS.addVelocityGradient(0, new Vector3(0.6, 0.15, 0));
  sparklePS.addVelocityGradient(0.5, new Vector3(-0.6, 0.2, 0.6));
  sparklePS.addVelocityGradient(1.0, new Vector3(0, 0.1, -0.6));

  sparklePS.start();

  // ── Metadata for per-frame animation in race-items.js ─────────────────
  root.metadata = {
    isPickup: true,
    _itemBoxMat: boxMat,
    _glowMat: glowMat,
    _haloMat: haloMat,
    _coreMat: coreMat,
    _sparklePS: sparklePS,
    _core: core,
    _glowBox: glowBox,
    _carouselNode: carouselNode,
    _carouselTimer: 0,
    _carouselSwapInterval: 0.1,
    _spawnCarouselItem: () => _spawnCarouselItem(carouselNode, scene),
  };
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
//  WIZARD-MASTERS ELEMENTAL WEAPON MODELS
//  Use WM assets: textures, GLB models, node materials, particle systems
// ═════════════════════════════════════════════════════════════════════════════

// 1x1 white fallback
const _PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function _tryTex(path, scene) {
  try { return new Texture(path, scene, false, false, Texture.BILINEAR_SAMPLINGMODE); }
  catch { return new Texture(_PIXEL, scene); }
}

function _getTornadoNoiseTexture(scene) {
  if (_tornadoNoiseTexture && !_tornadoNoiseTexture._isDisposed) {
    return _tornadoNoiseTexture;
  }

  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const index = (y * size + x) * 4;
      const n1 = Math.sin(x * 0.173 + y * 0.117) * 0.5 + 0.5;
      const n2 = Math.sin(x * 0.071 - y * 0.193 + 2.4) * 0.5 + 0.5;
      const n3 = Math.sin((x + y) * 0.133 + 5.7) * 0.5 + 0.5;
      const grain = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      data[index] = Math.max(0, Math.min(255, Math.round((n1 * 0.55 + grain * 0.45) * 255)));
      data[index + 1] = Math.max(0, Math.min(255, Math.round((n2 * 0.7 + n1 * 0.3) * 255)));
      data[index + 2] = Math.max(0, Math.min(255, Math.round((n3 * 0.65 + n2 * 0.35) * 255)));
      data[index + 3] = 255;
    }
  }

  _tornadoNoiseTexture = RawTexture.CreateRGBATexture(data, size, size, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  _tornadoNoiseTexture.wrapU = Texture.WRAP_ADDRESSMODE;
  _tornadoNoiseTexture.wrapV = Texture.WRAP_ADDRESSMODE;
  return _tornadoNoiseTexture;
}

function _createTornadoShaderMaterial(name, scene, color, opts = {}) {
  const material = new ShaderMaterial(name, scene, {
    vertex: 'tornadoVortex',
    fragment: 'tornadoVortex',
  }, {
    attributes: ['position', 'uv'],
    uniforms: ['world', 'worldViewProjection', 'time', 'parabolStrength', 'parabolOffset', 'parabolAmplitude', 'radiusScale', 'turbulence', 'emissiveColor', 'alphaScale', 'darkLayer'],
    samplers: ['noiseTex'],
    needAlphaBlending: true,
  });

  material.backFaceCulling = false;
  material.alphaMode = Engine.ALPHA_ADD;
  material.setTexture('noiseTex', _getTornadoNoiseTexture(scene));
  material.setColor3('emissiveColor', color);
  material.setFloat('parabolStrength', opts.parabolStrength ?? 0.11);
  material.setFloat('parabolOffset', opts.parabolOffset ?? 0.15);
  material.setFloat('parabolAmplitude', opts.parabolAmplitude ?? 0.2);
  material.setFloat('radiusScale', opts.radiusScale ?? 1.0);
  material.setFloat('turbulence', opts.turbulence ?? 0.06);
  material.setFloat('alphaScale', opts.alphaScale ?? 0.7);
  material.setFloat('darkLayer', opts.darkLayer ? 1.0 : 0.0);

  return material;
}

function _createTornadoParticleSystem(name, scene, emitter, opts = {}) {
  const useGPU = (opts.useGPU ?? true) && GPUParticleSystem.IsSupported;
  const capacity = opts.capacity ?? 96;
  const ps = useGPU
    ? new GPUParticleSystem(name, { capacity }, scene)
    : new ParticleSystem(name, capacity, scene);

  ps.particleTexture = _tryTex(opts.texture || '/textures/battle/fx/wind-sprites.png', scene);
  ps.emitter = emitter;
  ps.emitRate = opts.emitRate ?? 32;
  ps.minLifeTime = opts.minLifeTime ?? 0.2;
  ps.maxLifeTime = opts.maxLifeTime ?? 0.7;
  ps.minSize = opts.minSize ?? 0.12;
  ps.maxSize = opts.maxSize ?? 0.45;
  ps.color1 = opts.color1 ?? new Color4(0.85, 0.96, 1.0, 0.85);
  ps.color2 = opts.color2 ?? new Color4(0.55, 0.82, 0.95, 0.4);
  ps.colorDead = opts.colorDead ?? new Color4(0.2, 0.3, 0.35, 0);
  ps.minEmitPower = opts.minEmitPower ?? 1;
  ps.maxEmitPower = opts.maxEmitPower ?? 4;
  ps.gravity = opts.gravity ?? new Vector3(0, 0.4, 0);
  ps.direction1 = opts.direction1 ?? new Vector3(-1.4, 2.5, -1.4);
  ps.direction2 = opts.direction2 ?? new Vector3(1.4, 9.5, 1.4);
  ps.blendMode = opts.blendMode ?? ParticleSystem.BLENDMODE_ADD;

  if (opts.emitterShape === 'cylinder') {
    ps.createCylinderEmitter(
      opts.emitterRadius ?? 2.4,
      opts.emitterHeight ?? 8,
      opts.radiusRange ?? 1,
      opts.directionRandomizer ?? 0.18,
    );
  } else if (opts.emitterShape === 'sphere') {
    ps.createSphereEmitter(opts.emitterRadius ?? 1.8);
  }

  if (typeof ps.addSizeGradient === 'function') {
    ps.addSizeGradient(0, opts.sizeStart ?? Math.max(0.05, (opts.minSize ?? 0.12) * 0.65));
    ps.addSizeGradient(0.55, opts.sizeMid ?? (opts.maxSize ?? 0.45));
    ps.addSizeGradient(1, opts.sizeEnd ?? Math.max(0.02, (opts.minSize ?? 0.12) * 0.35));
  }
  if (typeof ps.addColorGradient === 'function' && Array.isArray(opts.colorGradients)) {
    opts.colorGradients.forEach(([gradient, color]) => ps.addColorGradient(gradient, color));
  }
  if (typeof ps.addVelocityGradient === 'function' && Array.isArray(opts.velocityGradients)) {
    opts.velocityGradients.forEach(([gradient, factor]) => ps.addVelocityGradient(gradient, factor));
  }
  if (typeof ps.addAngularSpeedGradient === 'function') {
    ps.addAngularSpeedGradient(0, opts.angularStart ?? -4);
    ps.addAngularSpeedGradient(1, opts.angularEnd ?? 6);
  }

  ps.start();
  return ps;
}

/**
 * Fireball — glowing ember sphere with attached fire particle trail.
 * Adapted from WM fire-ball projectile (sphere body + fire particles).
 */
export function createFireballModel(scene) {
  const root = new TransformNode('mdl_fireball', scene);

  // Core ember sphere
  const core = MeshBuilder.CreateSphere('fb_core', { diameter: 0.9, segments: 12 }, scene);
  const coreMat = mat('fb_coreMat', new Color3(1, 0.45, 0), scene, { emissive: 0.9 });
  core.material = coreMat;
  core.parent = root;

  // Outer glow shell (larger, translucent)
  const glow = MeshBuilder.CreateSphere('fb_glow', { diameter: 1.4, segments: 10 }, scene);
  const glowMat = mat('fb_glowMat', new Color3(1, 0.3, 0), scene, { emissive: 0.8, alpha: 0.35 });
  glowMat.backFaceCulling = false;
  glow.material = glowMat;
  glow.parent = root;

  // Attached fire trail particle system (follows the projectile)
  const ps = new ParticleSystem('fb_trail', 50, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/flame_03.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.45;
  ps.minSize = 0.2;
  ps.maxSize = 0.6;
  ps.emitRate = 40;
  ps.color1 = new Color4(1, 0.6, 0, 1);
  ps.color2 = new Color4(1, 0.2, 0, 0.8);
  ps.colorDead = new Color4(0.3, 0.05, 0, 0);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.5;
  ps.direction1 = new Vector3(-0.3, 0.5, -0.3);
  ps.direction2 = new Vector3(0.3, 1.5, 0.3);
  ps.gravity = new Vector3(0, 2, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  root.metadata = { trailPS: ps };
  return root;
}

/**
 * Toxic Spread projectile — green glowing orb with poison smoke trail.
 * Adapted from WM toxic triple-ball (3 shot at ±5° spread).
 */
export function createToxicSpreadModel(scene) {
  const root = new TransformNode('mdl_toxic', scene);

  const ball = MeshBuilder.CreateSphere('tox_ball', { diameter: 0.7, segments: 10 }, scene);
  const ballMat = mat('tox_ballMat', new Color3(0.2, 0.9, 0.1), scene, { emissive: 0.7, alpha: 0.85 });
  ball.material = ballMat;
  ball.parent = root;

  // Toxic drip effect (small bubbles)
  for (let i = 0; i < 3; i++) {
    const drip = MeshBuilder.CreateSphere('tox_drip' + i, { diameter: 0.15, segments: 6 }, scene);
    drip.material = mat('tox_dripMat' + i, new Color3(0.3, 1, 0.2), scene, { emissive: 0.5, alpha: 0.6 });
    const angle = (i / 3) * Math.PI * 2;
    drip.position.set(Math.cos(angle) * 0.3, -0.2, Math.sin(angle) * 0.3);
    drip.parent = root;
  }

  // Poison smoke trail
  const ps = new ParticleSystem('tox_trail', 30, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/smoke_04.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.15;
  ps.maxSize = 0.4;
  ps.emitRate = 25;
  ps.color1 = new Color4(0.2, 0.8, 0.1, 0.7);
  ps.color2 = new Color4(0.1, 0.6, 0, 0.4);
  ps.colorDead = new Color4(0, 0.2, 0, 0);
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 0.8;
  ps.direction1 = new Vector3(-0.2, -0.3, -0.2);
  ps.direction2 = new Vector3(0.2, 0.1, 0.2);
  ps.gravity = new Vector3(0, -1, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  root.metadata = { trailPS: ps };
  return root;
}

/**
 * Ice Lance — translucent ice crystal shard with frost particle trail.
 * Adapted from WM ice-arrow (fast projectile with ice_vfx particles).
 */
export function createIceLanceModel(scene) {
  const root = new TransformNode('mdl_ice_lance', scene);

  // Sharp crystal shard (elongated octahedron)
  const shard = MeshBuilder.CreatePolyhedron('ice_shard', { type: 1, size: 0.3 }, scene);
  shard.scaling.set(0.6, 0.6, 2.0);
  const shardMat = mat('ice_shardMat', new Color3(0.5, 0.85, 1), scene, { emissive: 0.5, alpha: 0.8 });
  shardMat.backFaceCulling = false;
  shard.material = shardMat;
  shard.parent = root;

  // Inner glow core
  const core = MeshBuilder.CreateSphere('ice_core', { diameter: 0.3, segments: 8 }, scene);
  core.material = mat('ice_coreMat', new Color3(0.8, 0.95, 1), scene, { emissive: 0.9 });
  core.parent = root;

  // Frost particle trail
  const ps = new ParticleSystem('ice_trail', 35, scene);
  ps.particleTexture = _tryTex('/textures/battle/fx/ice_vfx.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.5;
  ps.minSize = 0.08;
  ps.maxSize = 0.25;
  ps.emitRate = 30;
  ps.color1 = new Color4(0.5, 0.9, 1, 0.8);
  ps.color2 = new Color4(0.8, 0.95, 1, 0.5);
  ps.colorDead = new Color4(0.6, 0.8, 1, 0);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.5;
  ps.direction1 = new Vector3(-0.2, -0.1, -0.5);
  ps.direction2 = new Vector3(0.2, 0.3, -0.2);
  ps.gravity = new Vector3(0, -0.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  root.metadata = { trailPS: ps };
  return root;
}

/**
 * Tornado — Babylon-native shader funnel inspired by node/particle workflows.
 * Uses two animated shader cylinders plus a lightweight debris emitter.
 */
function createTornadoModelLegacy(scene) {
  const root = new TransformNode('mdl_tornado', scene);

  const outerShell = MeshBuilder.CreateCylinder('torn_outer', {
    diameterTop: 2.0,
    diameterBottom: 2.0,
    height: 11.5,
    tessellation: 32,
    subdivisions: 22,
    arc: 1,
    enclose: false,
  }, scene);
  outerShell.position.y = 5.25;
  outerShell.parent = root;
  outerShell.isPickable = false;
  outerShell.material = _createTornadoShaderMaterial(
    'torn_outerMat',
    scene,
    new Color3(0.72, 0.93, 1.0),
    { parabolStrength: 0.14, parabolOffset: 0.4, parabolAmplitude: 0.12, radiusScale: 1.0, turbulence: 0.05, alphaScale: 0.68, darkLayer: false }
  );

  const innerShell = MeshBuilder.CreateCylinder('torn_inner', {
    diameterTop: 2.0,
    diameterBottom: 2.0,
    height: 10.8,
    tessellation: 28,
    subdivisions: 20,
    arc: 1,
    enclose: false,
  }, scene);
  innerShell.position.y = 5.1;
  innerShell.scaling.x = 0.7;
  innerShell.scaling.z = 0.7;
  innerShell.parent = root;
  innerShell.isPickable = false;
  innerShell.material = _createTornadoShaderMaterial(
    'torn_innerMat',
    scene,
    new Color3(0.25, 0.32, 0.34),
    { parabolStrength: 0.13, parabolOffset: 0.35, parabolAmplitude: 0.18, radiusScale: 0.84, turbulence: 0.04, alphaScale: 0.5, darkLayer: true }
  );

  const coreGlow = MeshBuilder.CreateCylinder('torn_coreGlow', {
    diameterTop: 0.08, diameterBottom: 0.6, height: 8.4, tessellation: 18,
  }, scene);
  const glowMat = mat('torn_coreGlowMat', new Color3(0.85, 0.98, 1.0), scene, { emissive: 0.9, alpha: 0.16 });
  glowMat.backFaceCulling = false;
  coreGlow.material = glowMat;
  coreGlow.position.y = 4.6;
  coreGlow.parent = root;
  coreGlow.isPickable = false;

  // Debris cloud at base — darker, heavier particles
  const debris = new ParticleSystem('torn_debris', 60, scene);
  debris.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  debris.emitter = root;
  debris.createCylinderEmitter(3.0, 1, 0, 0);
  debris.minLifeTime = 0.4;
  debris.maxLifeTime = 1.0;
  debris.minSize = 0.2;
  debris.maxSize = 0.6;
  debris.emitRate = 40;
  debris.color1 = new Color4(0.5, 0.4, 0.3, 0.5);
  debris.color2 = new Color4(0.35, 0.3, 0.25, 0.3);
  debris.colorDead = new Color4(0.2, 0.2, 0.2, 0);
  debris.minEmitPower = 1;
  debris.maxEmitPower = 4;
  debris.direction1 = new Vector3(-3, 0, -3);
  debris.direction2 = new Vector3(3, 1.5, 3);
  debris.gravity = new Vector3(0, -1, 0);
  debris.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  debris.start();

  // Lightning sparks inside the funnel
  const sparks = new ParticleSystem('torn_sparks', 30, scene);
  sparks.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  sparks.emitter = root;
  sparks.createCylinderEmitter(1.0, 8, 0, 0);
  sparks.minLifeTime = 0.05;
  sparks.maxLifeTime = 0.15;
  sparks.minSize = 0.05;
  sparks.maxSize = 0.15;
  sparks.emitRate = 12;
  sparks.color1 = new Color4(1, 1, 1, 0.9);
  sparks.color2 = new Color4(0.7, 0.85, 1, 0.6);
  sparks.colorDead = new Color4(0.4, 0.6, 1, 0);
  sparks.minEmitPower = 8;
  sparks.maxEmitPower = 20;
  sparks.direction1 = new Vector3(-1, -1, -1);
  sparks.direction2 = new Vector3(1, 1, 1);
  sparks.gravity = new Vector3(0, 0, 0);
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD;
  sparks.start();

  const outerMat = outerShell.material;
  const innerMatShader = innerShell.material;
  let elapsed = 0;
  const obs = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() * 0.001;
    elapsed += dt;
    outerMat.setFloat('time', elapsed * 0.9);
    innerMatShader.setFloat('time', elapsed * 0.9 + 1.234);
    coreGlow.rotation.y += dt * 1.7;
    root.rotation.y += dt * 0.55;
  });
  root.metadata = { debrisPS: debris, sparksPS: sparks, spinObserver: obs, outerShell, innerShell, coreGlow };

  return root;
}

/**
 * Super Nova — expanding fiery sphere using sun_surface texture.
 * Adapted from WM super-nova spell (scale 0→15, bounce easing).
 */
export function createSuperNovaModel(scene) {
  const root = new TransformNode('mdl_super_nova', scene);

  // Nova sphere with sun_surface texture
  const sphere = MeshBuilder.CreateSphere('nova_sphere', { diameter: 2, segments: 16 }, scene);
  const novaMat = new StandardMaterial('nova_mat', scene);
  novaMat.diffuseTexture = _tryTex('/textures/battle/fx/sun_surface.png', scene);
  novaMat.emissiveColor = new Color3(1, 0.5, 0);
  novaMat.emissiveTexture = _tryTex('/textures/battle/fx/fire.jpg', scene);
  novaMat.alpha = 0.85;
  novaMat.backFaceCulling = false;
  novaMat.disableLighting = true;
  sphere.material = novaMat;
  sphere.parent = root;

  // Outer corona ring
  const corona = MeshBuilder.CreateTorus('nova_corona', {
    diameter: 2.5, thickness: 0.2, tessellation: 32,
  }, scene);
  corona.material = mat('nova_coronaMat', new Color3(1, 0.4, 0), scene, { emissive: 0.9, alpha: 0.6 });
  corona.parent = root;

  // Fire particles
  const ps = new ParticleSystem('nova_fire', 80, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/flame_03.png', scene);
  ps.emitter = root;
  ps.createSphereEmitter(1.5);
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.6;
  ps.minSize = 0.2;
  ps.maxSize = 0.7;
  ps.emitRate = 50;
  ps.color1 = new Color4(1, 0.6, 0, 1);
  ps.color2 = new Color4(1, 0.2, 0, 0.7);
  ps.colorDead = new Color4(0.2, 0, 0, 0);
  ps.minEmitPower = 2;
  ps.maxEmitPower = 6;
  ps.gravity = new Vector3(0, 1, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Expand animation — bounce easing like WM super-nova
  let _started = false;
  const expandObs = scene.onBeforeRenderObservable.add(() => {
    if (!_started) {
      _started = true;
      root.scaling.setAll(0.1);
    }
    const current = root.scaling.x;
    if (current < 7) {
      // Bounce easing: fast initial growth, overshoot, settle
      const target = 7;
      const speed = scene.getEngine().getDeltaTime() * 0.006;
      const overshoot = 1.2;
      const next = current + (target * overshoot - current) * speed;
      root.scaling.setAll(Math.min(next, target));
    }
  });
  root.metadata = { trailPS: ps, expandObserver: expandObs };

  // Attempt to load fire-nova node material asynchronously
  _loadFireNovaMaterial(sphere, scene);

  return root;
}

async function _loadFireNovaMaterial(mesh, scene) {
  try {
    const nodeMat = await NodeMaterial.ParseFromFileAsync('fire_nova', '/node_materials/fire-nova.json', scene);
    nodeMat.build(true);
    mesh.material.dispose();
    mesh.material = nodeMat;
  } catch {
    // Keep standard material fallback
  }
}

/**
 * Rock Barrage — rough angular boulder with dust trail.
 * Adapted from WM rock-dual (two rocks launched in parallel).
 */
export function createRockBarrageModel(scene) {
  const root = new TransformNode('mdl_rock', scene);

  // Heavy floor-rolling boulder silhouette.
  const rock = MeshBuilder.CreateIcoSphere('rock_body', { radius: 0.62, subdivisions: 2 }, scene);
  rock.scaling.set(1.35, 1.0, 1.15);
  rock.material = mat('rock_bodyMat', new Color3(0.46, 0.37, 0.28), scene, { specPow: 12 });
  rock.parent = root;
  rock.position.y = 0.2;

  const rim = MeshBuilder.CreateTorus('rock_rim', { diameter: 1.28, thickness: 0.12, tessellation: 18 }, scene);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.05;
  rim.material = mat('rock_rimMat', new Color3(0.32, 0.24, 0.18), scene, { emissive: 0.08 });
  rim.parent = root;

  // Cracks (dark lines)
  for (let i = 0; i < 4; i++) {
    const crack = MeshBuilder.CreateBox('rock_crack' + i, { width: 0.03, height: 0.72, depth: 0.03 }, scene);
    crack.material = mat('rock_crackMat', new Color3(0.2, 0.15, 0.1), scene);
    const angle = (i / 4) * Math.PI * 2;
    crack.position.set(Math.cos(angle) * 0.28, 0.16, Math.sin(angle) * 0.24);
    crack.rotation.set(Math.random() * 0.5, angle, Math.random() * 0.5);
    crack.parent = root;
  }

  // Dust trail
  const ps = new ParticleSystem('rock_trail', 25, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/dust.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.6;
  ps.minSize = 0.16;
  ps.maxSize = 0.45;
  ps.emitRate = 26;
  ps.color1 = new Color4(0.6, 0.5, 0.4, 0.7);
  ps.color2 = new Color4(0.4, 0.35, 0.25, 0.4);
  ps.colorDead = new Color4(0.3, 0.25, 0.2, 0);
  ps.minEmitPower = 0.5;
  ps.maxEmitPower = 1.8;
  ps.direction1 = new Vector3(-0.5, -0.25, -0.5);
  ps.direction2 = new Vector3(0.5, 0.12, 0.5);
  ps.gravity = new Vector3(0, -3, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  root.metadata = { trailPS: ps };
  return root;
}

/**
 * Lightning Bolt — bright electric bolt column with spark particles.
 * Adapted from WM light-strike (cylinder preview + delayed strike).
 */
export function createLightningBoltModel(scene) {
  const root = new TransformNode('mdl_lightning', scene);

  // Bright bolt core (thin cylinder pointed forward)
  const bolt = MeshBuilder.CreateCylinder('lt_bolt', {
    diameterTop: 0.05, diameterBottom: 0.15, height: 3.0, tessellation: 6,
  }, scene);
  const boltMat = mat('lt_boltMat', new Color3(0.9, 0.95, 1), scene, { emissive: 1.0 });
  boltMat.disableLighting = true;
  bolt.material = boltMat;
  bolt.rotation.x = Math.PI / 2; // Point along Z
  bolt.parent = root;

  // Outer glow tube
  const outer = MeshBuilder.CreateCylinder('lt_outer', {
    diameterTop: 0.2, diameterBottom: 0.4, height: 3.2, tessellation: 8,
  }, scene);
  const outerMat = mat('lt_outerMat', new Color3(0.7, 0.8, 1), scene, { emissive: 0.8, alpha: 0.3 });
  outerMat.backFaceCulling = false;
  outer.material = outerMat;
  outer.rotation.x = Math.PI / 2;
  outer.parent = root;

  // Spark particles
  const ps = new ParticleSystem('lt_sparks', 40, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/spark_05.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.05;
  ps.maxLifeTime = 0.2;
  ps.minSize = 0.05;
  ps.maxSize = 0.15;
  ps.emitRate = 50;
  ps.color1 = new Color4(0.9, 0.95, 1, 1);
  ps.color2 = new Color4(0.7, 0.8, 1, 0.8);
  ps.colorDead = new Color4(0.5, 0.6, 0.8, 0);
  ps.minEmitPower = 3;
  ps.maxEmitPower = 8;
  ps.direction1 = new Vector3(-1, -0.5, -1);
  ps.direction2 = new Vector3(1, 1, 1);
  ps.gravity = Vector3.Zero();
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Flicker animation
  const flickerObs = scene.onBeforeRenderObservable.add(() => {
    const flicker = Math.random() > 0.3 ? 1 : 0.3;
    boltMat.alpha = flicker;
    outerMat.alpha = 0.3 * flicker;
  });
  root.metadata = { trailPS: ps, flickerObserver: flickerObs };

  return root;
}

/**
 * Wind Slash — translucent crescent blade with wind sprite trail.
 * Adapted from WM wind-slash (quick forward line attack).
 */
export function createWindSlashModel(scene) {
  const root = new TransformNode('mdl_wind_slash', scene);

  // Crescent blade shape (torus arc)
  const blade = MeshBuilder.CreateTorus('ws_blade', {
    diameter: 1.8, thickness: 0.12, tessellation: 24, arc: 0.5,
  }, scene);
  const bladeMat = mat('ws_bladeMat', new Color3(0.65, 0.9, 0.7), scene, { emissive: 0.6, alpha: 0.65 });
  bladeMat.backFaceCulling = false;
  blade.material = bladeMat;
  blade.rotation.y = Math.PI / 2;
  blade.parent = root;

  // Sharp edge glow (inner strip)
  const edge = MeshBuilder.CreateTorus('ws_edge', {
    diameter: 1.6, thickness: 0.03, tessellation: 24, arc: 0.5,
  }, scene);
  edge.material = mat('ws_edgeMat', new Color3(0.8, 1, 0.9), scene, { emissive: 0.9 });
  edge.rotation.y = Math.PI / 2;
  edge.parent = root;

  // Wind trail particles
  const ps = new ParticleSystem('ws_trail', 30, scene);
  ps.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.4;
  ps.minSize = 0.1;
  ps.maxSize = 0.3;
  ps.emitRate = 25;
  ps.color1 = new Color4(0.7, 1, 0.8, 0.6);
  ps.color2 = new Color4(0.5, 0.9, 0.6, 0.3);
  ps.colorDead = new Color4(0.4, 0.6, 0.5, 0);
  ps.minEmitPower = 1;
  ps.maxEmitPower = 3;
  ps.direction1 = new Vector3(-0.5, 0, -1);
  ps.direction2 = new Vector3(0.5, 0.5, 0);
  ps.gravity = Vector3.Zero();
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();

  // Spin animation
  const spinObs = scene.onBeforeRenderObservable.add(() => {
    root.rotation.z += scene.getEngine().getDeltaTime() * 0.012;
  });
  root.metadata = { trailPS: ps, spinObserver: spinObs };

  return root;
}

/**
 * Toxic Cloud — green fog dome using toxic-cloud node material.
 * Adapted from WM toxic-cloud sorcery (20m trigger zone, 7.5s duration).
 */
export function createToxicCloudModel(scene) {
  const root = new TransformNode('mdl_toxic_cloud', scene);

  // Cloud dome (flattened sphere)
  const dome = MeshBuilder.CreateSphere('tc_dome', { diameter: 5, segments: 16 }, scene);
  dome.scaling.set(2, 0.8, 2);
  const domeMat = new StandardMaterial('tc_domeMat', scene);
  domeMat.diffuseColor = new Color3(0.15, 0.5, 0.05);
  domeMat.emissiveColor = new Color3(0.1, 0.4, 0.05);
  domeMat.alpha = 0.35;
  domeMat.backFaceCulling = false;
  dome.material = domeMat;
  dome.parent = root;

  // Toxic fog particles filling the cloud
  const ps = new ParticleSystem('tc_fog', 60, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/cloud.png', scene);
  ps.emitter = root;
  ps.createSphereEmitter(3);
  ps.minLifeTime = 0.8;
  ps.maxLifeTime = 2.0;
  ps.minSize = 0.5;
  ps.maxSize = 1.5;
  ps.emitRate = 25;
  ps.color1 = new Color4(0.2, 0.7, 0.1, 0.5);
  ps.color2 = new Color4(0.1, 0.5, 0, 0.3);
  ps.colorDead = new Color4(0, 0.2, 0, 0);
  ps.minEmitPower = 0.3;
  ps.maxEmitPower = 1;
  ps.direction1 = new Vector3(-1, 0.2, -1);
  ps.direction2 = new Vector3(1, 0.8, 1);
  ps.gravity = new Vector3(0, 0.3, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.start();

  // Bubbling drips at ground level
  const drips = new ParticleSystem('tc_drips', 20, scene);
  drips.particleTexture = _tryTex('/textures/battle/particles/circle_03.png', scene);
  drips.emitter = root;
  drips.createSphereEmitter(2.5);
  drips.minLifeTime = 0.5;
  drips.maxLifeTime = 1.2;
  drips.minSize = 0.1;
  drips.maxSize = 0.3;
  drips.emitRate = 15;
  drips.color1 = new Color4(0.3, 0.8, 0.1, 0.8);
  drips.color2 = new Color4(0.1, 0.5, 0, 0.5);
  drips.colorDead = new Color4(0, 0.2, 0, 0);
  drips.minEmitPower = 0.2;
  drips.maxEmitPower = 0.6;
  drips.direction1 = new Vector3(-0.5, -0.3, -0.5);
  drips.direction2 = new Vector3(0.5, 0.3, 0.5);
  drips.gravity = new Vector3(0, -2, 0);
  drips.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  drips.start();

  root.metadata = { trailPS: ps, dripsPS: drips };

  // Attempt to load toxic-cloud node material asynchronously
  _loadToxicCloudMaterial(dome, scene);

  return root;
}

async function _loadToxicCloudMaterial(mesh, scene) {
  try {
    const nodeMat = await NodeMaterial.ParseFromFileAsync('toxic_cloud', '/node_materials/toxic-cloud.json', scene);
    nodeMat.build(true);
    nodeMat.alpha = 0.35;
    nodeMat.backFaceCulling = false;
    mesh.material.dispose();
    mesh.material = nodeMat;
  } catch {
    // Keep standard material fallback
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  GLO STREAM-WEAPON MODELS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Glow Thrower — flame-plume segment with a bright core and hot wake.
 */
export function createGlowThrowerModel(scene) {
  const root = new TransformNode('mdl_glow_thrower', scene);
  const core = MeshBuilder.CreateSphere('gt_core', { diameter: 0.34, segments: 8 }, scene);
  core.scaling.set(0.7, 0.7, 2.2);
  const coreMat = mat('gt_coreMat', new Color3(1, 0.62, 0.08), scene, { emissive: 1.0, alpha: 0.95 });
  coreMat.backFaceCulling = false;
  core.material = coreMat;
  core.parent = root;

  const throat = MeshBuilder.CreateCylinder('gt_throat', { diameterTop: 0.08, diameterBottom: 0.22, height: 0.9, tessellation: 10 }, scene);
  throat.rotation.x = Math.PI / 2;
  throat.position.z = -0.28;
  throat.material = mat('gt_throatMat', new Color3(1, 0.28, 0.02), scene, { emissive: 0.8, alpha: 0.75 });
  throat.material.backFaceCulling = false;
  throat.parent = root;

  const glow = MeshBuilder.CreateSphere('gt_glow', { diameter: 0.75, segments: 6 }, scene);
  glow.scaling.set(1.0, 1.0, 2.8);
  glow.material = mat('gt_glowMat', new Color3(1, 0.22, 0.02), scene, { emissive: 0.9, alpha: 0.18 });
  glow.material.backFaceCulling = false;
  glow.parent = root;

  const ember = MeshBuilder.CreateSphere('gt_ember', { diameter: 0.18, segments: 6 }, scene);
  ember.position.z = 0.42;
  ember.material = mat('gt_emberMat', new Color3(1, 0.95, 0.5), scene, { emissive: 1.2, alpha: 0.9 });
  ember.parent = root;

  const ps = new ParticleSystem('gt_trail', 42, scene);
  ps.emitter = root;
  ps.minLifeTime = 0.06;
  ps.maxLifeTime = 0.18;
  ps.minSize = 0.12;
  ps.maxSize = 0.36;
  ps.emitRate = 68;
  ps.color1 = new Color4(1, 0.62, 0.08, 0.92);
  ps.color2 = new Color4(1, 0.18, 0.02, 0.55);
  ps.colorDead = new Color4(0.2, 0.02, 0, 0);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.2;
  ps.direction1 = new Vector3(-0.12, -0.05, -1.1);
  ps.direction2 = new Vector3(0.12, 0.18, -0.35);
  ps.gravity = new Vector3(0, 0.35, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.start();
  root.metadata = { trailPS: ps };
  return root;
}

/**
 * Glo Burst — machine-gun tracer round with a hot core and streak.
 */
export function createGloBurstModel(scene) {
  const root = new TransformNode('mdl_glo_burst', scene);
  const bullet = MeshBuilder.CreateCylinder('gb_bullet', { diameter: 0.11, height: 0.72, tessellation: 8 }, scene);
  bullet.rotation.x = Math.PI / 2;
  const bulletMat = mat('gb_bulletMat', new Color3(1, 0.92, 0.45), scene, { emissive: 1.0 });
  bullet.material = bulletMat;
  bullet.parent = root;

  const tip = MeshBuilder.CreateSphere('gb_tip', { diameter: 0.16, segments: 6 }, scene);
  tip.material = mat('gb_tipMat', new Color3(1, 1, 0.75), scene, { emissive: 1.1, alpha: 0.75 });
  tip.position.z = 0.38;
  tip.parent = root;

  const streak = MeshBuilder.CreateCylinder('gb_streak', { diameterTop: 0.02, diameterBottom: 0.09, height: 0.95, tessellation: 8 }, scene);
  streak.rotation.x = Math.PI / 2;
  streak.position.z = -0.24;
  streak.material = mat('gb_streakMat', new Color3(1, 0.7, 0.18), scene, { emissive: 0.9, alpha: 0.32 });
  streak.material.backFaceCulling = false;
  streak.parent = root;

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
  banana:         createBananaModel,
  grenade:        createGrenadeModel,
  // Wizard-Masters elemental weapons
  fireball:        createFireballModel,
  toxic_spread:    createToxicSpreadModel,
  ice_lance:       createIceLanceModel,
  tornado:         createTornadoModel,
  super_nova:      createSuperNovaModel,
  rock_barrage:    createRockBarrageModel,
  lightning_bolt:  createLightningBoltModel,
  wind_slash:      createWindSlashModel,
  toxic_cloud:     createToxicCloudModel,
  // Stream weapons
  glow_thrower:    createGlowThrowerModel,
  glo_burst:       createGloBurstModel,
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
