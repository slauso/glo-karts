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
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { tagMeshForGlow, createAdaptiveParticleSystem, isGPUParticleSupported } from './weapon-fx-enhance.js';
import { scaleParticles, scaleTess, gpuParticlesEnabled, runtimeFXBudget, runtimePressure } from '../perf-tier.js';
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

function heavyContinuousBudget(min = 0.2) {
  const pressure = runtimePressure();
  const pressureMul = pressure > 0.78 ? 0.55 : pressure > 0.58 ? 0.72 : 1;
  return Math.max(min, runtimeFXBudget() * pressureMul);
}

// ── Tornado "Dots-Space" shader (inspired by playground.babylonjs.com/#UYS16D) ──
// Single mesh + vertex-displaced funnel + layered rotating dot-clouds in fragment.
if (!Effect.ShadersStore.tornadoFunnelVertexShader) {
  Effect.ShadersStore.tornadoFunnelVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    uniform float time;
    varying vec2 vUV;
    varying float vHeight;
    varying float vAngle;

    void main(void) {
      vec3 p = position;
      float h = (p.y + 6.0) / 12.0;           // normalise height 0..1
      float angle = atan(p.z, p.x);
      float baseR = length(p.xz);

      // parabolic funnel: tight at bottom, flares at top
      float funnel = 0.35 + h * h * 2.2;
      // time-dependent twist increases with height
      float twist = h * 4.0 + time * 1.8;
      // fine turbulence ripples
      float turb = sin(h * 12.0 + time * 5.0 + angle * 3.0) * 0.08 * h;
      // wide low-freq wobble for organic sway
      float wobX = sin(time * 0.7 + h * 2.0) * 0.15 * h;
      float wobZ = cos(time * 0.9 + h * 2.5) * 0.15 * h;

      float r = funnel + turb;
      p.x = cos(angle + twist) * r + wobX;
      p.z = sin(angle + twist) * r + wobZ;

      vUV = uv;
      vHeight = h;
      vAngle = angle + twist;
      gl_Position = worldViewProjection * vec4(p, 1.0);
    }
  `;

  // Fragment: multi-layered rotating dots (from #UYS16D) + scrolling noise cloud
  Effect.ShadersStore.tornadoFunnelFragmentShader = `
    precision highp float;
    varying vec2 vUV;
    varying float vHeight;
    varying float vAngle;
    uniform float time;
    uniform sampler2D noiseTex;

    #define LAYERS 6.0
    #define GRID   40.0

    float rand1(float p) { return fract(sin(p * 78.233) * 43758.5453); }

    mat2 rot(float a) {
      float c = cos(a), s = sin(a);
      return mat2(c, -s, s, c);
    }

    void main(void) {
      // --- Layer 1: rotating dot cloud (playground #UYS16D technique) ---
      vec2 baseUV = vUV * 2.0 - 1.0;   // centre UV
      float dots = 0.0;
      for (float i = 0.0; i < LAYERS; i++) {
        vec2 iuv = baseUV * rot(time * (0.6 + i * 0.18));
        vec2 guv = iuv * GRID;
        vec2 gid = floor(guv);
        float iF = rand1(i);
        vec2 off = vec2(
          rand1(gid.x * iF + gid.y * 2000.0 * iF),
          rand1(gid.y * iF + gid.x * 1000.0 * iF)
        ) * 0.5 - 0.25;
        guv = fract(guv) - 0.5 - off;
        float l = length(guv);
        float pSize = rand1(gid.x * iF + gid.y * 7000.0 * iF) * 0.22;
        float showW = sqrt(length(baseUV)) * 0.55;
        float show = rand1(gid.x * 100.0 * iF + gid.y * 200.0 * iF) > showW ? 1.0 : 0.0;
        dots += smoothstep(pSize, pSize - iF * 0.3, l) * show;
      }
      dots = clamp(dots, 0.0, 1.0);

      // --- Layer 2: scrolling noise for cloud wisps ---
      vec2 uv1 = vUV + vec2(time * 0.6,  -time * 0.25);
      vec2 uv2 = vUV * vec2(4.0, 1.5) + vec2(-time * 0.4, time * 0.15);
      float n1 = texture2D(noiseTex, uv1).r;
      float n2 = texture2D(noiseTex, uv2).g;
      float cloud = smoothstep(0.3, 0.7, n1) * smoothstep(0.25, 0.65, n2);

      // --- Combine ---
      float density = dots * 0.55 + cloud * 0.65;

      // Edge / top / bottom fade
      float edgeFade = smoothstep(0.0, 0.12, vUV.x) * smoothstep(0.0, 0.12, 1.0 - vUV.x);
      float topFade  = smoothstep(0.0, 0.08, vUV.y) * smoothstep(0.0, 0.18, 1.0 - vUV.y);

      // Colour: dark grey core, lighter turbulent edges
      vec3 dark  = vec3(0.10, 0.12, 0.14);
      vec3 mid   = vec3(0.32, 0.36, 0.40);
      vec3 light = vec3(0.55, 0.62, 0.68);
      vec3 col = mix(dark, mid, cloud);
      col = mix(col, light, dots * 0.4);
      // subtle blue tint at top
      col += vec3(-0.02, 0.0, 0.06) * vHeight;

      float alpha = density * edgeFade * topFade * 0.88;
      // Lightning flash: brief full-white flicker
      float flash = step(0.97, sin(time * 23.7) * sin(time * 7.3));
      col = mix(col, vec3(1.0), flash * 0.6 * step(0.4, vHeight));

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // Ground dust disc shader
  Effect.ShadersStore.tornadoDustVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main(void) {
      vUV = uv;
      gl_Position = worldViewProjection * vec4(position, 1.0);
    }
  `;

  Effect.ShadersStore.tornadoDustFragmentShader = `
    precision highp float;
    varying vec2 vUV;
    uniform float time;
    uniform sampler2D noiseTex;

    mat2 rot(float a) {
      float c = cos(a), s = sin(a);
      return mat2(c, -s, s, c);
    }

    void main(void) {
      vec2 uv = vUV * 2.0 - 1.0;           // -1..1 centred
      float dist = length(uv);

      // Rotating dust rings
      vec2 ruv = uv * rot(time * 1.2);
      float ring1 = texture2D(noiseTex, ruv * 0.8 + 0.5 + vec2(time * 0.1, 0.0)).r;
      vec2 ruv2 = uv * rot(-time * 0.8);
      float ring2 = texture2D(noiseTex, ruv2 * 1.2 + 0.5 + vec2(0.0, time * 0.15)).g;
      float cloud = smoothstep(0.25, 0.65, ring1) * smoothstep(0.2, 0.6, ring2);

      // Radial falloff: visible in a ring from 0.15 to 0.95
      float radial = smoothstep(0.95, 0.6, dist) * smoothstep(0.08, 0.3, dist);

      vec3 col = mix(vec3(0.28, 0.24, 0.18), vec3(0.45, 0.40, 0.32), cloud);
      float alpha = cloud * radial * 0.5;

      gl_FragColor = vec4(col, alpha);
    }
  `;
}

// Legacy tornado vortex shaders (used by createTornadoModelLegacy)
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

/**
 * Tornado — shader-driven funnel (inspired by playground #UYS16D / #6Q89LE).
 * Total draw calls: 2 meshes + 1 tiny particle system.
 * All visual density comes from the GPU (layered rotating dots + noise).
 */
export function createTornadoModel(scene) {
  const root = new TransformNode('mdl_tornado', scene);

  const ownedMaterials = [];
  const ownedSystems = [];

  // ── 1. Funnel mesh — single cylinder, all visuals via shader ──
  const funnel = MeshBuilder.CreateCylinder('torn_funnel', {
    diameterTop: 2.8,
    diameterBottom: 2.8,
    height: 15.5,
    tessellation: scaleTess(24),
    subdivisions: scaleTess(18),
    arc: 1,
    enclose: false,
  }, scene);
  funnel.position.y = 0;
  funnel.parent = root;
  funnel.isPickable = false;

  const noiseTex = _getTornadoNoiseTexture(scene);

  const funnelMat = new ShaderMaterial('torn_funnelMat', scene, {
    vertex: 'tornadoFunnel',
    fragment: 'tornadoFunnel',
  }, {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'time'],
    samplers: ['noiseTex'],
    needAlphaBlending: true,
  });
  funnelMat.backFaceCulling = false;
  funnelMat.alphaMode = Engine.ALPHA_ADD;
  funnelMat.setTexture('noiseTex', noiseTex);
  funnelMat.setFloat('time', 0);
  funnel.material = funnelMat;
  ownedMaterials.push(funnelMat);

  // ── 2. Ground dust disc — flat plane with radial dust shader ──
  const dustDisc = MeshBuilder.CreateDisc('torn_dust', {
    radius: 5.8,
    tessellation: scaleTess(24),
  }, scene);
  dustDisc.rotation.x = Math.PI * 0.5;
  dustDisc.position.y = 0.05;
  dustDisc.parent = root;
  dustDisc.isPickable = false;

  const dustMat = new ShaderMaterial('torn_dustMat', scene, {
    vertex: 'tornadoDust',
    fragment: 'tornadoDust',
  }, {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'time'],
    samplers: ['noiseTex'],
    needAlphaBlending: true,
  });
  dustMat.backFaceCulling = false;
  dustMat.alphaMode = Engine.ALPHA_ADD;
  dustMat.setTexture('noiseTex', noiseTex);
  dustMat.setFloat('time', 0);
  dustDisc.material = dustMat;
  ownedMaterials.push(dustMat);

  // ── 3. Tiny debris particle system (only flying chunks, ~20 particles) ──
  const debrisEmitter = new TransformNode('torn_debrisEmit', scene);
  debrisEmitter.parent = root;
  debrisEmitter.position.y = 2.0;

  const debris = _createTornadoParticleSystem('torn_debris_v3', scene, debrisEmitter, {
    useGPU: false,
    capacity: 24,
    emitRate: 12,
    emitterShape: 'cylinder',
    emitterRadius: 2.2,
    emitterHeight: 3.0,
    radiusRange: 0.8,
    directionRandomizer: 0.3,
    minLifeTime: 0.5,
    maxLifeTime: 1.2,
    minSize: 0.12,
    maxSize: 0.4,
    sizeStart: 0.08,
    sizeMid: 0.35,
    sizeEnd: 0.04,
    minEmitPower: 2.0,
    maxEmitPower: 6.0,
    gravity: new Vector3(0, -1.5, 0),
    direction1: new Vector3(-3.5, 1.0, -3.5),
    direction2: new Vector3(3.5, 4.0, 3.5),
    color1: new Color4(0.45, 0.38, 0.28, 0.6),
    color2: new Color4(0.32, 0.28, 0.22, 0.35),
    colorDead: new Color4(0.2, 0.18, 0.16, 0),
    blendMode: ParticleSystem.BLENDMODE_STANDARD,
    angularStart: -4,
    angularEnd: 5,
  });
  ownedSystems.push(debris);

  // ── Per-frame observer: update 2 time uniforms + slow root spin ──
  root.scaling.set(1.18, 1.18, 1.18);
  let elapsed = Math.random() * Math.PI * 2;
  const spinObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = scene.getEngine().getDeltaTime() * 0.001;
    elapsed += dt;
    funnelMat.setFloat('time', elapsed);
    dustMat.setFloat('time', elapsed);
    root.rotation.y += dt * 1.25;
    // Orbit the debris emitter around the base
    debrisEmitter.position.x = Math.sin(elapsed * 2.1) * 0.85;
    debrisEmitter.position.z = Math.cos(elapsed * 2.1) * 0.85;
  });

  root.onDisposeObservable.add(() => {
    if (spinObserver) scene.onBeforeRenderObservable.remove(spinObserver);
    ownedSystems.forEach((s) => { try { s.stop(); } catch {} try { s.dispose(); } catch {} });
    ownedMaterials.forEach((m) => { try { m.dispose(); } catch {} });
  });

  root.metadata = {
    visualType: 'tornado',
    spinObserver,
    debrisPS: debris,
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

  const thrusterGlow = MeshBuilder.CreateSphere('thrusterGlow', { diameter: 0.16, segments: 8 }, scene);
  const thrusterMat = mat('thrusterMat', new Color3(1.0, 0.48, 0.05), scene, { alpha: 0.82, emissive: 0.85, backface: false });
  thrusterGlow.material = thrusterMat;
  thrusterGlow.position.z = -0.66;
  thrusterGlow.scaling.set(0.9, 0.9, 1.6);
  thrusterGlow.parent = root;

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

  // Smoke contrail — GPU particles for dense missile exhaust
  const { ps: missileTrail, isGPU: missileTrailGPU } = createAdaptiveParticleSystem('missile_trail', 1000, scene);
  missileTrail.particleTexture = _tryTex('/textures/battle/particles/smoke_04.png', scene);
  missileTrail.emitter = root;
  missileTrail.minEmitBox = new Vector3(-0.05, -0.05, -0.6);
  missileTrail.maxEmitBox = new Vector3(0.05, 0.05, -0.5);
  missileTrail.minLifeTime = 0.2;
  missileTrail.maxLifeTime = 0.6;
  missileTrail.minSize = 0.1;
  missileTrail.maxSize = 0.45;
  const missileTrailBudget = Math.max(0.28, runtimeFXBudget());
  missileTrail.emitRate = missileTrailGPU ? Math.round(24 * missileTrailBudget) : scaleParticles(14);
  missileTrail.color1 = new Color4(0.9, 0.9, 0.9, 0.7);
  missileTrail.color2 = new Color4(0.5, 0.5, 0.5, 0.3);
  missileTrail.colorDead = new Color4(0.2, 0.2, 0.2, 0);
  missileTrail.minEmitPower = 1.5;
  missileTrail.maxEmitPower = 3.5;
  missileTrail.direction1 = new Vector3(-0.2, -0.2, -2);
  missileTrail.direction2 = new Vector3(0.2, 0.2, -1);
  missileTrail.gravity = new Vector3(0, 0.8, 0);
  missileTrail.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  if (missileTrailGPU) missileTrail.maxActiveParticleCount = Math.max(18, Math.round(24 * missileTrailBudget));
  missileTrail.start();

  root.metadata = {
    weaponType: 'guided_missile',
    thrusterGlow,
    thrusterMat,
    bandMat: band.material,
    finMat,
    trailPS: missileTrail,
    isGPUTrail: missileTrailGPU,
  };

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
  const sparklePS = new ParticleSystem('itemBoxSparkles', scaleParticles(20), scene);
  sparklePS.particleTexture = new Texture(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
    scene
  );
  sparklePS.emitter = root;
  sparklePS.minEmitBox = new Vector3(-1.0, -1.0, -1.0);
  sparklePS.maxEmitBox = new Vector3(1.0, 1.0, 1.0);
  sparklePS.emitRate = scaleParticles(5);
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
 * Shield Bubble — Fresnel energy sphere with hex-glow and pulsing inner shell.
 */
export function createShieldModel(scene) {
  const root = new TransformNode('mdl_shield', scene);

  const bubble = MeshBuilder.CreateSphere('shield', { diameter: 3.0, segments: 16 }, scene);
  const shieldMat = mat('shieldMat', new Color3(0.3, 0.6, 1), scene, { alpha: 0.18, emissive: 0.4, backface: false });
  // Fresnel edge glow — visible rim brightens at glancing angles
  shieldMat.emissiveFresnelParameters = new FresnelParameters({
    bias: 0.05, power: 3.0,
    leftColor: new Color3(0.15, 0.4, 1.0),
    rightColor: new Color3(0.6, 0.9, 1.0),
  });
  shieldMat.opacityFresnelParameters = new FresnelParameters({
    bias: 0.15, power: 2.0,
  });
  bubble.material = shieldMat;
  bubble.parent = root;

  // Inner glow sphere
  const glow = MeshBuilder.CreateSphere('shieldGlow', { diameter: 2.85, segments: 12 }, scene);
  const glowMat2 = mat('glowMat', new Color3(0.5, 0.8, 1), scene, { alpha: 0.08, emissive: 0.6, backface: false });
  glowMat2.emissiveFresnelParameters = new FresnelParameters({
    bias: 0.0, power: 4.0,
    leftColor: new Color3(0.2, 0.5, 1.0),
    rightColor: new Color3(0.8, 0.95, 1.0),
  });
  glow.material = glowMat2;
  glow.parent = root;

  tagMeshForGlow(bubble, 0.4);
  tagMeshForGlow(glow, 0.6);
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
  const capacity = scaleParticles(opts.capacity ?? 96);
  const ps = useGPU
    ? new GPUParticleSystem(name, { capacity }, scene)
    : new ParticleSystem(name, capacity, scene);

  ps.particleTexture = _tryTex(opts.texture || '/textures/battle/fx/wind-sprites.png', scene);
  ps.emitter = emitter;
  ps.emitRate = scaleParticles(opts.emitRate ?? 32);
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
  const core = MeshBuilder.CreateSphere('fb_core', { diameter: 1.2, segments: 14 }, scene);
  const coreMat = mat('fb_coreMat', new Color3(1, 0.45, 0), scene, { emissive: 0.9 });
  core.material = coreMat;
  core.parent = root;

  // Outer glow shell (larger, translucent)
  const glow = MeshBuilder.CreateSphere('fb_glow', { diameter: 1.9, segments: 12 }, scene);
  const glowMat = mat('fb_glowMat', new Color3(1, 0.3, 0), scene, { emissive: 0.8, alpha: 0.35 });
  glowMat.backFaceCulling = false;
  glow.material = glowMat;
  glow.parent = root;

  const corona = MeshBuilder.CreateTorus('fb_corona', { diameter: 1.55, thickness: 0.12, tessellation: 24 }, scene);
  corona.rotation.x = Math.PI / 2;
  corona.material = mat('fb_coronaMat', new Color3(1, 0.75, 0.2), scene, { emissive: 1.0, alpha: 0.55 });
  corona.parent = root;

  // Attached fire trail — GPU particles on supported tiers, CPU fallback
  const { ps, isGPU: fbIsGPU } = createAdaptiveParticleSystem('fb_trail', 1500, scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/flame_03.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.18;
  ps.maxLifeTime = 0.55;
  ps.minSize = 0.22;
  ps.maxSize = 0.82;
  const fireballTrailBudget = Math.max(0.28, runtimeFXBudget());
  ps.emitRate = fbIsGPU ? Math.round(42 * fireballTrailBudget) : scaleParticles(18);
  ps.color1 = new Color4(1, 0.76, 0.08, 1);
  ps.color2 = new Color4(1, 0.24, 0, 0.82);
  ps.colorDead = new Color4(0.3, 0.05, 0, 0);
  ps.minEmitPower = 0.8;
  ps.maxEmitPower = 2.2;
  ps.direction1 = new Vector3(-0.45, 0.4, -1.2);
  ps.direction2 = new Vector3(0.45, 1.8, -0.35);
  ps.gravity = new Vector3(0, 2.5, 0);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  if (fbIsGPU) ps.maxActiveParticleCount = Math.max(24, Math.round(42 * fireballTrailBudget));
  ps.start();

  root.metadata = { trailPS: ps, isGPUTrail: fbIsGPU };
  tagMeshForGlow(core, 0.8);
  tagMeshForGlow(glow, 0.5);
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
  const ps = new ParticleSystem('tox_trail', scaleParticles(30), scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/smoke_04.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.3;
  ps.maxLifeTime = 0.8;
  ps.minSize = 0.15;
  ps.maxSize = 0.4;
  ps.emitRate = scaleParticles(25);
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

  // Sharp crystal shard (elongated octahedron) with Fresnel ice effect
  const shard = MeshBuilder.CreatePolyhedron('ice_shard', { type: 1, size: 0.3 }, scene);
  shard.scaling.set(0.6, 0.6, 2.0);
  const shardMat = mat('ice_shardMat', new Color3(0.5, 0.85, 1), scene, { emissive: 0.5, alpha: 0.8 });
  shardMat.backFaceCulling = false;
  // Fresnel rim-glow for icy translucency
  shardMat.emissiveFresnelParameters = new FresnelParameters({
    bias: 0.1, power: 2.0,
    leftColor: new Color3(0.3, 0.7, 1.0),
    rightColor: new Color3(0.9, 0.97, 1.0),
  });
  shardMat.opacityFresnelParameters = new FresnelParameters({
    bias: 0.4, power: 1.5,
  });
  shard.material = shardMat;
  shard.parent = root;

  // Inner glow core
  const core = MeshBuilder.CreateSphere('ice_core', { diameter: 0.3, segments: 8 }, scene);
  core.material = mat('ice_coreMat', new Color3(0.8, 0.95, 1), scene, { emissive: 0.9 });
  core.parent = root;

  // Frost particle trail
  const ps = new ParticleSystem('ice_trail', scaleParticles(35), scene);
  ps.particleTexture = _tryTex('/textures/battle/fx/ice_vfx.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.5;
  ps.minSize = 0.08;
  ps.maxSize = 0.25;
  ps.emitRate = scaleParticles(30);
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
  tagMeshForGlow(shard, 0.5);
  tagMeshForGlow(core, 0.7);
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
    tessellation: scaleTess(32),
    subdivisions: scaleTess(22),
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
    tessellation: scaleTess(28),
    subdivisions: scaleTess(20),
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
    diameterTop: 0.08, diameterBottom: 0.6, height: 8.4, tessellation: scaleTess(18),
  }, scene);
  const glowMat = mat('torn_coreGlowMat', new Color3(0.85, 0.98, 1.0), scene, { emissive: 0.9, alpha: 0.16 });
  glowMat.backFaceCulling = false;
  coreGlow.material = glowMat;
  coreGlow.position.y = 4.6;
  coreGlow.parent = root;
  coreGlow.isPickable = false;

  // Debris cloud at base — darker, heavier particles
  const debris = new ParticleSystem('torn_debris', scaleParticles(60), scene);
  debris.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  debris.emitter = root;
  debris.createCylinderEmitter(3.0, 1, 0, 0);
  debris.minLifeTime = 0.4;
  debris.maxLifeTime = 1.0;
  debris.minSize = 0.2;
  debris.maxSize = 0.6;
  debris.emitRate = scaleParticles(40);
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
  const sparks = new ParticleSystem('torn_sparks', scaleParticles(30), scene);
  sparks.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  sparks.emitter = root;
  sparks.createCylinderEmitter(1.0, 8, 0, 0);
  sparks.minLifeTime = 0.05;
  sparks.maxLifeTime = 0.15;
  sparks.minSize = 0.05;
  sparks.maxSize = 0.15;
  sparks.emitRate = scaleParticles(12);
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
  const sphere = MeshBuilder.CreateCylinder('nova_sphere', {
    diameterTop: 0.42, diameterBottom: 0.9, height: 1.75, tessellation: 18,
  }, scene);
  const novaMat = new StandardMaterial('nova_mat', scene);
  novaMat.diffuseColor = new Color3(0.18, 0.2, 0.24);
  novaMat.emissiveColor = new Color3(0.12, 0.12, 0.1);
  novaMat.specularColor = new Color3(0.35, 0.35, 0.28);
  sphere.material = novaMat;
  sphere.rotation.z = Math.PI / 2;
  sphere.parent = root;

  const nose = MeshBuilder.CreateSphere('nova_nose', { diameter: 0.5, segments: 10 }, scene);
  nose.scaling.z = 0.6;
  nose.position.x = 0.78;
  nose.material = mat('nova_noseMat', new Color3(0.14, 0.16, 0.18), scene, { specPow: 28 });
  nose.parent = root;

  const finTop = MeshBuilder.CreateBox('nova_fin_top', { width: 0.14, height: 0.54, depth: 0.18 }, scene);
  finTop.position.x = -0.62;
  finTop.position.y = 0.42;
  finTop.material = mat('nova_fin_topMat', new Color3(0.92, 0.86, 0.22), scene, { emissive: 0.18 });
  finTop.parent = root;
  const finBottom = finTop.clone('nova_fin_bottom');
  finBottom.position.y = -0.42;
  finBottom.parent = root;

  // Outer corona ring
  const corona = MeshBuilder.CreateTorus('nova_corona', {
    diameter: 2.5, thickness: 0.2, tessellation: 32,
  }, scene);
  corona.material = mat('nova_coronaMat', new Color3(1, 0.9, 0.25), scene, { emissive: 1.0, alpha: 0.22 });
  corona.parent = root;
  corona.scaling.z = 0.45;

  const beacon = MeshBuilder.CreateSphere('nova_beacon', { diameter: 0.24, segments: 8 }, scene);
  beacon.material = mat('nova_beaconMat', new Color3(1.0, 0.95, 0.35), scene, { emissive: 1.2, alpha: 0.9 });
  beacon.parent = root;

  // Fire particles — GPU path for high-count nova expansion
  const { ps: novaPS, isGPU: novaIsGPU } = createAdaptiveParticleSystem('nova_fire', 2000, scene);
  novaPS.particleTexture = _tryTex('/textures/battle/particles/flame_03.png', scene);
  novaPS.emitter = root;
  novaPS.createSphereEmitter(0.8);
  novaPS.minLifeTime = 0.15;
  novaPS.maxLifeTime = 0.42;
  novaPS.minSize = 0.12;
  novaPS.maxSize = 0.42;
  const novaTrailBudget = Math.max(0.24, runtimeFXBudget());
  novaPS.emitRate = novaIsGPU ? Math.round(38 * novaTrailBudget) : scaleParticles(12);
  novaPS.color1 = new Color4(1, 0.82, 0.16, 0.95);
  novaPS.color2 = new Color4(1, 0.42, 0.06, 0.6);
  novaPS.colorDead = new Color4(0.2, 0, 0, 0);
  novaPS.minEmitPower = 0.5;
  novaPS.maxEmitPower = 1.8;
  novaPS.gravity = new Vector3(0, 1.2, 0);
  novaPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  if (novaIsGPU) novaPS.maxActiveParticleCount = Math.max(20, Math.round(38 * novaTrailBudget));
  novaPS.start();

  // Expand animation — bounce easing like WM super-nova
  const expandObs = scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() * 0.001;
    const pulse = 1.0 + Math.sin(t * 5.4) * 0.08;
    beacon.scaling.setAll(0.82 + pulse * 0.55);
    corona.scaling.x = 1.0 + pulse * 0.22;
    corona.scaling.y = 1.0 + pulse * 0.22;
    root.rotation.x = Math.sin(t * 1.4) * 0.04;
    root.rotation.y += scene.getEngine().getDeltaTime() * 0.0015;
  });
  root.metadata = { trailPS: novaPS, isGPUTrail: novaIsGPU, expandObserver: expandObs };
  tagMeshForGlow(beacon, 0.9);
  tagMeshForGlow(corona, 0.4);

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
  const rock = MeshBuilder.CreateIcoSphere('rock_body', { radius: 0.54, subdivisions: 2 }, scene);
  rock.scaling.set(1.18, 0.92, 1.04);
  rock.material = mat('rock_bodyMat', new Color3(0.46, 0.37, 0.28), scene, { specPow: 12 });
  rock.parent = root;
  rock.position.y = 0.2;

  const rim = MeshBuilder.CreateTorus('rock_rim', { diameter: 1.28, thickness: 0.12, tessellation: 18 }, scene);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.03;
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
  const ps = new ParticleSystem('rock_trail', scaleParticles(25), scene);
  ps.particleTexture = _tryTex('/textures/battle/particles/dust.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.2;
  ps.maxLifeTime = 0.6;
  ps.minSize = 0.16;
  ps.maxSize = 0.45;
  ps.emitRate = scaleParticles(26);
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

  // Keep the silhouette radial so it reads correctly from every trajectory.
  const coreOrb = MeshBuilder.CreateSphere('lt_core_orb', { diameter: 0.34, segments: 8 }, scene);
  const coreOrbMat = mat('lt_core_orb_mat', new Color3(0.86, 0.94, 1.0), scene, { emissive: 1.2, alpha: 0.9 });
  coreOrbMat.disableLighting = true;
  coreOrb.material = coreOrbMat;
  coreOrb.parent = root;

  const innerShell = MeshBuilder.CreateSphere('lt_inner_shell', { diameter: 0.58, segments: 6 }, scene);
  const innerShellMat = mat('lt_inner_shell_mat', new Color3(0.7, 0.85, 1.0), scene, { emissive: 1.0, alpha: 0.26 });
  innerShellMat.backFaceCulling = false;
  innerShell.material = innerShellMat;
  innerShell.parent = root;

  const outer = MeshBuilder.CreateSphere('lt_outer', { diameter: 0.86, segments: 6 }, scene);
  outer.scaling.setAll(1.0);
  const outerMat = mat('lt_outerMat', new Color3(0.7, 0.8, 1), scene, { emissive: 0.9, alpha: 0.12 });
  outerMat.backFaceCulling = false;
  outer.material = outerMat;
  outer.parent = root;

  const coronaLayers = [];
  const coronaSizes = [0.9, 1.15, 1.42];
  for (let i = 0; i < coronaSizes.length; i += 1) {
    const corona = MeshBuilder.CreatePlane(`lt_corona_${i}`, { width: coronaSizes[i], height: coronaSizes[i] }, scene);
    const coronaMat = mat(`lt_corona_${i}_mat`, new Color3(0.88, 0.95, 1.0), scene, { emissive: 1.1 + i * 0.08, alpha: 0.14 - i * 0.02 });
    coronaMat.backFaceCulling = false;
    corona.material = coronaMat;
    corona.billboardMode = Mesh.BILLBOARDMODE_ALL;
    corona.parent = root;
    coronaLayers.push(corona);
  }

  const arcRingA = MeshBuilder.CreateTorus('lt_arc_ring_a', { diameter: 0.66, thickness: 0.035, tessellation: 24 }, scene);
  arcRingA.rotation.x = Math.PI / 2;
  arcRingA.material = mat('lt_arc_ring_a_mat', new Color3(0.74, 0.86, 1.0), scene, { emissive: 0.95, alpha: 0.45 });
  arcRingA.parent = root;

  const arcRingB = MeshBuilder.CreateTorus('lt_arc_ring_b', { diameter: 0.5, thickness: 0.028, tessellation: 18 }, scene);
  arcRingB.rotation.y = Math.PI / 2;
  arcRingB.material = mat('lt_arc_ring_b_mat', new Color3(0.94, 0.98, 1.0), scene, { emissive: 1.05, alpha: 0.38 });
  arcRingB.parent = root;

  const sparkNodes = [];
  const sparkOrbs = [];
  for (let i = 0; i < 3; i += 1) {
    const sparkNode = new TransformNode(`lt_spark_node_${i}`, scene);
    sparkNode.parent = root;
    sparkNode.rotation.z = (Math.PI * 2 * i) / 3;
    sparkNode.rotation.y = (Math.PI / 5) * i;
    const spark = MeshBuilder.CreateSphere(`lt_spark_${i}`, { diameter: 0.1 + i * 0.015, segments: 4 }, scene);
    spark.material = mat(`lt_spark_${i}_mat`, new Color3(0.95, 0.99, 1.0), scene, { emissive: 1.25, alpha: 0.8 });
    spark.position.x = 0.34 + i * 0.05;
    spark.parent = sparkNode;
    sparkNodes.push(sparkNode);
    sparkOrbs.push(spark);
  }

  const flickerObs = scene.onBeforeRenderObservable.add(() => {
    const flicker = Math.random() > 0.24 ? 1 : 0.34;
    coreOrbMat.alpha = 0.58 + flicker * 0.24;
    innerShellMat.alpha = 0.16 + flicker * 0.12;
    outerMat.alpha = 0.08 + flicker * 0.08;
    sparkOrbs.forEach((spark, index) => {
      if (!spark.material) return;
      spark.material.alpha = 0.28 + flicker * (0.26 + index * 0.04);
    });
  });
  root.metadata = {
    flickerObserver: flickerObs,
    coreOrb,
    innerShell,
    coronaLayers,
    arcRings: [arcRingA, arcRingB],
    sparkNodes,
    sparkOrbs,
    cleanup: () => scene.onBeforeRenderObservable.remove(flickerObs),
  };
  tagMeshForGlow(coreOrb, 0.9);
  tagMeshForGlow(innerShell, 0.6);

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
  const ps = new ParticleSystem('ws_trail', scaleParticles(30), scene);
  ps.particleTexture = _tryTex('/textures/battle/fx/wind-sprites.png', scene);
  ps.emitter = root;
  ps.minLifeTime = 0.15;
  ps.maxLifeTime = 0.4;
  ps.minSize = 0.1;
  ps.maxSize = 0.3;
  ps.emitRate = scaleParticles(25);
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

  // Toxic fog particles filling the cloud — GPU path for dense volumetric feel
  const { ps: tcPS, isGPU: tcIsGPU } = createAdaptiveParticleSystem('tc_fog', 2000, scene);
  const toxicBudget = heavyContinuousBudget(0.22);
  tcPS.particleTexture = _tryTex('/textures/battle/particles/cloud.png', scene);
  tcPS.emitter = root;
  tcPS.createSphereEmitter(3);
  tcPS.minLifeTime = 0.8;
  tcPS.maxLifeTime = 2.0;
  tcPS.minSize = 0.5;
  tcPS.maxSize = 1.5;
  tcPS.emitRate = tcIsGPU ? Math.round(44 * toxicBudget) : scaleParticles(14);
  tcPS.color1 = new Color4(0.2, 0.7, 0.1, 0.5);
  tcPS.color2 = new Color4(0.1, 0.5, 0, 0.3);
  tcPS.colorDead = new Color4(0, 0.2, 0, 0);
  tcPS.minEmitPower = 0.3;
  tcPS.maxEmitPower = 1;
  tcPS.direction1 = new Vector3(-1, 0.2, -1);
  tcPS.direction2 = new Vector3(1, 0.8, 1);
  tcPS.gravity = new Vector3(0, 0.3, 0);
  tcPS.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  if (tcIsGPU) tcPS.maxActiveParticleCount = Math.max(20, Math.round(44 * toxicBudget));
  tcPS.start();

  // Bubbling drips at ground level
  const drips = new ParticleSystem('tc_drips', scaleParticles(20), scene);
  drips.particleTexture = _tryTex('/textures/battle/particles/circle_03.png', scene);
  drips.emitter = root;
  drips.createSphereEmitter(2.5);
  drips.minLifeTime = 0.5;
  drips.maxLifeTime = 1.2;
  drips.minSize = 0.1;
  drips.maxSize = 0.3;
  drips.emitRate = scaleParticles(Math.max(6, Math.round(12 * toxicBudget)));
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

  root.metadata = { trailPS: tcPS, isGPUTrail: tcIsGPU, dripsPS: drips };

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
 * Glow Thrower — forward fire-stream segment built from flowing flame particles.
 */
export function createGlowThrowerModel(scene) {
  const root = new TransformNode('mdl_glow_thrower', scene);
  const core = MeshBuilder.CreateSphere('gt_core', { diameter: 0.22, segments: 6 }, scene);
  const coreMat = mat('gt_coreMat', new Color3(1.0, 0.92, 0.56), scene, { emissive: 1.25, alpha: 0.96 });
  core.material = coreMat;
  core.parent = root;

  const heatOrb = MeshBuilder.CreateSphere('gt_heat_orb', { diameter: 0.46, segments: 6 }, scene);
  const heatOrbMat = mat('gt_heatOrbMat', new Color3(1.0, 0.44, 0.08), scene, { emissive: 1.0, alpha: 0.18 });
  heatOrbMat.backFaceCulling = false;
  heatOrb.material = heatOrbMat;
  heatOrb.parent = root;

  const heatPlanes = [];
  for (let i = 0; i < 5; i += 1) {
    const plane = MeshBuilder.CreatePlane(`gt_heat_plane_${i}`, { width: 0.82, height: 1.7 }, scene);
    const planeMat = mat(`gt_heat_plane_${i}_mat`, new Color3(1.0, 0.58, 0.08), scene, { emissive: 1.02, alpha: 0.16 });
    planeMat.backFaceCulling = false;
    plane.material = planeMat;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    plane.parent = root;
    plane.position.z = 0.72 + i * 0.42;
    plane.position.y = (i - 2) * 0.05;
    heatPlanes.push(plane);
  }

  const fanSheets = [];
  for (let i = 0; i < 4; i += 1) {
    const width = 0.42 + i * 0.38;
    const height = 0.78 + i * 0.34;
    const sheet = MeshBuilder.CreatePlane(`gt_fan_sheet_${i}`, { width, height }, scene);
    const sheetMat = mat(`gt_fan_sheet_${i}_mat`, new Color3(1.0, 0.5, 0.08), scene, { emissive: 1.0, alpha: 0.12 - i * 0.014 });
    sheetMat.backFaceCulling = false;
    sheet.material = sheetMat;
    sheet.billboardMode = Mesh.BILLBOARDMODE_ALL;
    sheet.parent = root;
    sheet.position.z = 0.52 + i * 0.62;
    sheet.position.y = -0.02 + i * 0.03;
    fanSheets.push(sheet);
  }

  const muzzleCorona = MeshBuilder.CreatePlane('gt_muzzle_corona', { width: 0.74, height: 0.74 }, scene);
  const muzzleCoronaMat = mat('gt_muzzle_corona_mat', new Color3(1.0, 0.76, 0.22), scene, { emissive: 1.18, alpha: 0.2 });
  muzzleCoronaMat.backFaceCulling = false;
  muzzleCorona.material = muzzleCoronaMat;
  muzzleCorona.billboardMode = Mesh.BILLBOARDMODE_ALL;
  muzzleCorona.parent = root;
  muzzleCorona.position.z = 0.18;

  const pressureRings = [];
  for (let i = 0; i < 2; i += 1) {
    const ring = MeshBuilder.CreateTorus(`gt_pressure_ring_${i}`, { diameter: 0.38 + i * 0.34, thickness: 0.03, tessellation: 20 }, scene);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.54 + i * 0.9;
    ring.material = mat(`gt_pressure_ring_${i}_mat`, new Color3(1.0, 0.7, 0.12), scene, { emissive: 1.02, alpha: 0.32 - i * 0.08 });
    ring.parent = root;
    pressureRings.push(ring);
  }

  // Flame stream — GPU particles for dense volumetric fire
  const { ps: flamePS, isGPU: gtFlameGPU } = createAdaptiveParticleSystem('gt_stream', 3000, scene);
  const glowThrowerBudget = heavyContinuousBudget(0.18);
  flamePS.particleTexture = _tryTex('/textures/battle/particles/flame_03.png', scene);
  flamePS.emitter = root;
  flamePS.minEmitBox = new Vector3(-0.22, -0.12, -0.1);
  flamePS.maxEmitBox = new Vector3(0.22, 0.14, 0.24);
  flamePS.minLifeTime = 0.1;
  flamePS.maxLifeTime = 0.24;
  flamePS.minSize = 0.3;
  flamePS.maxSize = 1.02;
  flamePS.emitRate = gtFlameGPU ? Math.round(180 * glowThrowerBudget) : scaleParticles(68);
  flamePS.color1 = new Color4(1.0, 0.92, 0.35, 0.95);
  flamePS.color2 = new Color4(1.0, 0.38, 0.06, 0.72);
  flamePS.colorDead = new Color4(0.2, 0.02, 0.0, 0);
  flamePS.minEmitPower = 2.8;
  flamePS.maxEmitPower = 6.8;
  flamePS.direction1 = new Vector3(-0.5, -0.14, 4.1);
  flamePS.direction2 = new Vector3(0.5, 0.34, 7.4);
  flamePS.gravity = new Vector3(0, 0.62, 0);
  flamePS.blendMode = ParticleSystem.BLENDMODE_ADD;
  if (gtFlameGPU) flamePS.maxActiveParticleCount = Math.max(42, Math.round(180 * glowThrowerBudget));
  flamePS.start();

  // Ember sparks — GPU when available
  const { ps: emberPS, isGPU: gtEmberGPU } = createAdaptiveParticleSystem('gt_embers', 1200, scene);
  emberPS.particleTexture = _tryTex('/textures/battle/particles/spark_05.png', scene);
  emberPS.emitter = root;
  emberPS.minEmitBox = new Vector3(-0.18, -0.08, -0.04);
  emberPS.maxEmitBox = new Vector3(0.18, 0.1, 0.18);
  emberPS.minLifeTime = 0.14;
  emberPS.maxLifeTime = 0.3;
  emberPS.minSize = 0.05;
  emberPS.maxSize = 0.22;
  emberPS.emitRate = gtEmberGPU ? Math.round(48 * glowThrowerBudget) : scaleParticles(24);
  emberPS.color1 = new Color4(1.0, 0.82, 0.24, 0.85);
  emberPS.color2 = new Color4(1.0, 0.18, 0.02, 0.44);
  emberPS.colorDead = new Color4(0.18, 0.02, 0.0, 0);
  emberPS.minEmitPower = 1.6;
  emberPS.maxEmitPower = 4.4;
  emberPS.direction1 = new Vector3(-0.34, 0.02, 2.5);
  emberPS.direction2 = new Vector3(0.34, 0.46, 4.8);
  emberPS.gravity = new Vector3(0, 0.92, 0);
  emberPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  if (gtEmberGPU) emberPS.maxActiveParticleCount = Math.max(16, Math.round(48 * glowThrowerBudget));
  emberPS.start();

  root.metadata = {
    trailPS: flamePS,
    sparksPS: emberPS,
    heatOrb,
    heatPlanes,
    fanSheets,
    muzzleCorona,
    pressureRings,
  };
  tagMeshForGlow(core, 0.9);
  tagMeshForGlow(heatOrb, 0.5);
  return root;
}

/**
 * Glo Burst — machine-gun tracer round with a hot core and streak.
 */
export function createGloBurstModel(scene) {
  const root = new TransformNode('mdl_glo_burst', scene);
  const core = MeshBuilder.CreateSphere('gb_core', { diameter: 0.18, segments: 6 }, scene);
  const coreMat = mat('gb_core_mat', new Color3(1.0, 0.94, 0.72), scene, { emissive: 1.18, alpha: 0.98 });
  core.material = coreMat;
  core.parent = root;

  const innerShell = MeshBuilder.CreateSphere('gb_inner_shell', { diameter: 0.28, segments: 6 }, scene);
  innerShell.material = mat('gb_inner_shell_mat', new Color3(1.0, 0.82, 0.24), scene, { emissive: 1.08, alpha: 0.34 });
  innerShell.material.backFaceCulling = false;
  innerShell.parent = root;

  const coreGlow = MeshBuilder.CreateSphere('gb_core_glow', { diameter: 0.4, segments: 6 }, scene);
  coreGlow.material = mat('gb_coreGlowMat', new Color3(1.0, 0.88, 0.3), scene, { emissive: 1.15, alpha: 0.15 });
  coreGlow.material.backFaceCulling = false;
  coreGlow.parent = root;

  const halo = MeshBuilder.CreatePlane('gb_halo', { width: 0.5, height: 0.5 }, scene);
  halo.material = mat('gb_haloMat', new Color3(1.0, 0.92, 0.5), scene, { emissive: 1.1, alpha: 0.22 });
  halo.material.backFaceCulling = false;
  halo.billboardMode = Mesh.BILLBOARDMODE_ALL;
  halo.parent = root;

  const haloRear = MeshBuilder.CreatePlane('gb_halo_rear', { width: 0.34, height: 0.34 }, scene);
  haloRear.material = mat('gb_haloRearMat', new Color3(1.0, 0.72, 0.18), scene, { emissive: 0.95, alpha: 0.16 });
  haloRear.material.backFaceCulling = false;
  haloRear.billboardMode = Mesh.BILLBOARDMODE_ALL;
  haloRear.parent = root;

  const shockRing = MeshBuilder.CreateTorus('gb_shock_ring', { diameter: 0.34, thickness: 0.03, tessellation: 20 }, scene);
  shockRing.rotation.x = Math.PI / 2;
  shockRing.material = mat('gb_shock_ring_mat', new Color3(1.0, 0.84, 0.28), scene, { emissive: 1.06, alpha: 0.46 });
  shockRing.parent = root;

  const tracerStreak = MeshBuilder.CreateBox('gb_streak', { width: 0.08, height: 0.08, depth: 0.9 }, scene);
  tracerStreak.material = mat('gb_streak_mat', new Color3(1.0, 0.88, 0.34), scene, { emissive: 1.18, alpha: 0.24 });
  tracerStreak.parent = root;
  tracerStreak.position.z = -0.36;

  const tracerWake = MeshBuilder.CreatePlane('gb_wake', { width: 0.38, height: 0.14 }, scene);
  tracerWake.material = mat('gb_wake_mat', new Color3(1.0, 0.74, 0.22), scene, { emissive: 1.0, alpha: 0.14 });
  tracerWake.material.backFaceCulling = false;
  tracerWake.parent = root;
  tracerWake.position.z = -0.28;

  const flarePlanes = [];
  for (let i = 0; i < 2; i += 1) {
    const flare = MeshBuilder.CreatePlane(`gb_flare_${i}`, { width: 0.62, height: 0.16 }, scene);
    flare.material = mat(`gb_flare_${i}_mat`, new Color3(1.0, 0.9, 0.38), scene, { emissive: 1.04, alpha: 0.2 });
    flare.material.backFaceCulling = false;
    flare.billboardMode = Mesh.BILLBOARDMODE_ALL;
    flare.parent = root;
    flare.rotation.z = i === 0 ? 0 : Math.PI / 2;
    flarePlanes.push(flare);
  }

  const emberNodes = [];
  const emberOrbs = [];
  for (let i = 0; i < 3; i += 1) {
    const emberNode = new TransformNode(`gb_ember_node_${i}`, scene);
    emberNode.parent = root;
    emberNode.rotation.z = (Math.PI * 2 * i) / 3;
    const ember = MeshBuilder.CreateSphere(`gb_ember_${i}`, { diameter: 0.055, segments: 4 }, scene);
    ember.material = mat(`gb_ember_${i}_mat`, new Color3(1.0, 0.96, 0.76), scene, { emissive: 1.22, alpha: 0.88 });
    ember.position.x = 0.18 + i * 0.025;
    ember.parent = emberNode;
    emberNodes.push(emberNode);
    emberOrbs.push(ember);
  }

  root.metadata = {
    tracerCore: core,
    tracerCoreShell: innerShell,
    tracerHalo: halo,
    tracerHaloRear: haloRear,
    tracerCoreGlow: coreGlow,
    shockRing,
    tracerStreak,
    tracerWake,
    flarePlanes,
    emberNodes,
    emberOrbs,
  };
  tagMeshForGlow(core, 0.8);
  tagMeshForGlow(coreGlow, 0.5);
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
//  FINAL FISSION — Nuclear fission detonation weapon model
//  Glowing critical-mass sphere with pulsing Cherenkov-blue inner glow
// ═════════════════════════════════════════════════════════════════════════════

export function createFinalFissionModel(scene) {
  const root = new TransformNode('mdl_final_fission', scene);

  // Core — dense critical mass (hot white-yellow)
  const core = MeshBuilder.CreateSphere('ff_core', { diameter: 1.2, segments: 16 }, scene);
  const coreMat = new StandardMaterial('ff_coreMat', scene);
  coreMat.diffuseColor = new Color3(1.0, 0.95, 0.8);
  coreMat.emissiveColor = new Color3(1.0, 0.9, 0.6);
  coreMat.specularPower = 128;
  coreMat.alpha = 0.95;
  // Fresnel: brilliant edge glow simulating Cherenkov radiation (blue edge)
  coreMat.emissiveFresnelParameters = new FresnelParameters({
    bias: 0.15, power: 2.5,
    leftColor: new Color3(0.3, 0.5, 1.0),  // blue Cherenkov edge
    rightColor: new Color3(1.0, 0.95, 0.7), // hot white center
  });
  core.material = coreMat;
  core.parent = root;

  // Outer containment shell — semi-transparent with blue-white Fresnel
  const shell = MeshBuilder.CreateSphere('ff_shell', { diameter: 1.8, segments: 12 }, scene);
  const shellMat = new StandardMaterial('ff_shellMat', scene);
  shellMat.diffuseColor = new Color3(0.6, 0.7, 1.0);
  shellMat.emissiveColor = new Color3(0.2, 0.3, 0.8);
  shellMat.alpha = 0.2;
  shellMat.backFaceCulling = false;
  shellMat.emissiveFresnelParameters = new FresnelParameters({
    bias: 0.0, power: 4.0,
    leftColor: new Color3(0.4, 0.6, 1.0),
    rightColor: new Color3(0, 0, 0),
  });
  shellMat.opacityFresnelParameters = new FresnelParameters({
    bias: 0.1, power: 2.0,
    leftColor: Color3.White(),
    rightColor: Color3.Black(),
  });
  shell.material = shellMat;
  shell.parent = root;

  // Hazard ring — rotating warning band
  const hazardRing = MeshBuilder.CreateTorus('ff_hazard', {
    diameter: 2.2, thickness: 0.08, tessellation: 24,
  }, scene);
  hazardRing.material = mat('ff_hazardMat', new Color3(1.0, 0.8, 0.1), scene, { emissive: 0.8, alpha: 0.5 });
  hazardRing.rotation.x = Math.PI / 2;
  hazardRing.parent = root;

  // Pulse animation — single observer for critical mass throb
  const expandObs = scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() * 0.001;
    const pulse = 1.0 + Math.sin(t * 6) * 0.06;
    core.scaling.setAll(pulse);
    shell.scaling.setAll(0.95 + Math.sin(t * 3.2) * 0.05);
    hazardRing.rotation.y += scene.getEngine().getDeltaTime() * 0.003;
    // Cherenkov flicker
    coreMat.emissiveColor.r = 0.9 + Math.sin(t * 12) * 0.1;
  });

  root.metadata = { expandObserver: expandObs };
  tagMeshForGlow(core, 0.9);
  tagMeshForGlow(shell, 0.4);
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
  // Ultimate weapons
  final_fission:   createFinalFissionModel,
};

const WEAPON_MODEL_ALIASES = {
  bowling_ball: 'bowling',
  missile: 'guided_missile',
};

/**
 * Create a projectile mesh for the given weapon type.
 * Tries GLB first, falls back to procedural model factory,
 * then falls back to a colored sphere if nothing else is available.
 */
export function createWeaponModel(weaponId, scene) {
  const resolvedWeaponId = WEAPON_MODEL_ALIASES[weaponId] || weaponId;
  const factory = WEAPON_MODEL_FACTORIES[resolvedWeaponId];
  if (factory) return factory(scene);

  // Unknown weapon — return colored sphere fallback
  const mesh = MeshBuilder.CreateSphere('proj_fallback', { diameter: 0.8, segments: 10 }, scene);
  mesh.material = mat('fallbackMat', new Color3(0.8, 0.4, 0.1), scene, { emissive: 0.3 });
  return mesh;
}
