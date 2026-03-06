/**
 * babylon-renderer.js — Babylon.js rendering engine for the race/battle game.
 *
 * Replaces Three.js rendering with Babylon.js while the Havok physics already
 * runs on a separate Babylon.js NullEngine (havok-physics.js).
 *
 * This module manages:
 *   - WebGPU/WebGL engine + canvas
 *   - Scene with PBR lighting, fog, shadows
 *   - ArcRotateCamera for chase-cam
 *   - GLB/GLTF asset loading
 *   - Post-processing (bloom, FXAA)
 *   - Procedural sky
 *
 * Usage:
 *   const bRenderer = await initBabylonRenderer('app');
 *   const carMesh = await bRenderer.loadGLB('/models/stk/karts/tux/tux-kart.glb');
 *   bRenderer.runRenderLoop();
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3, Color3, Color4, Quaternion } from '@babylonjs/core/Maths/math';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { FollowCamera } from '@babylonjs/core/Cameras/followCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// Side-effect imports for format support
import '@babylonjs/loaders/glTF';
import '@babylonjs/core/Helpers/sceneHelpers';

// ── State ───────────────────────────────────────────────────────────────────

let _engine = null;
let _scene = null;
let _camera = null;
let _shadowGen = null;
let _pipeline = null;
let _canvas = null;
let _sunLight = null;

// ── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize the Babylon.js rendering engine.
 *
 * @param {string} canvasId  ID of the container element (will create canvas inside)
 * @param {object} opts      Optional overrides
 * @returns {BabylonRenderer}
 */
export async function initBabylonRenderer(canvasId = 'app', opts = {}) {
  const container = document.getElementById(canvasId);
  if (!container) throw new Error(`Container #${canvasId} not found`);

  // Create canvas
  _canvas = document.createElement('canvas');
  _canvas.id = 'renderCanvas';
  _canvas.style.width = '100%';
  _canvas.style.height = '100%';
  _canvas.style.display = 'block';
  _canvas.tabIndex = 1;
  container.appendChild(_canvas);

  // Create engine
  _engine = new Engine(_canvas, true, {
    preserveDrawingBuffer: false,
    stencil: true,
    antialias: true,
  });
  _engine.setHardwareScalingLevel(1 / window.devicePixelRatio);

  // Create scene
  _scene = new Scene(_engine);
  _scene.clearColor = new Color4(0.67, 0.87, 1.0, 1.0); // sky blue

  // Fog
  _scene.fogMode = Scene.FOGMODE_LINEAR;
  _scene.fogColor = new Color3(0.67, 0.87, 1.0);
  _scene.fogStart = 250;
  _scene.fogEnd = 900;

  // Ambient color for the scene
  _scene.ambientColor = new Color3(0.8, 0.8, 0.8);

  // ── Lighting ──────────────────────────────────────────────────────────

  // Hemisphere light (ambient fill)
  const hemiLight = new HemisphericLight('hemi', new Vector3(0, 1, 0), _scene);
  hemiLight.intensity = 0.9;
  hemiLight.groundColor = new Color3(0.27, 0.27, 0.27);

  // Directional (sun) light with shadows
  _sunLight = new DirectionalLight('sun', new Vector3(-0.3, -1, -0.5).normalize(), _scene);
  _sunLight.intensity = 2.5;
  _sunLight.position = new Vector3(40, 250, 30);

  // Shadow generator
  _shadowGen = new ShadowGenerator(2048, _sunLight);
  _shadowGen.usePercentageCloserFiltering = true;
  _shadowGen.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;

  // ── Camera ────────────────────────────────────────────────────────────

  _camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3, 12, Vector3.Zero(), _scene);
  _camera.minZ = 0.1;
  _camera.maxZ = 2000;
  _camera.lowerRadiusLimit = 5;
  _camera.upperRadiusLimit = 30;
  _camera.attachControl(_canvas, false);

  // ── Post-processing ───────────────────────────────────────────────────

  _pipeline = new DefaultRenderingPipeline('default', true, _scene, [_camera]);
  _pipeline.bloomEnabled = true;
  _pipeline.bloomThreshold = 0.84;
  _pipeline.bloomWeight = 0.28;
  _pipeline.bloomKernel = 64;
  _pipeline.fxaaEnabled = true;
  _pipeline.imageProcessingEnabled = true;
  _pipeline.imageProcessing.toneMappingEnabled = true;
  _pipeline.imageProcessing.toneMappingType = 1; // ACES
  _pipeline.imageProcessing.exposure = 1.0;

  // ── Resize ────────────────────────────────────────────────────────────

  window.addEventListener('resize', () => {
    _engine.resize();
  });

  // ── Procedural sky ────────────────────────────────────────────────────

  createProceduralSky();

  return renderer;
}

// ── Renderer API object ─────────────────────────────────────────────────────

const renderer = {
  get engine()      { return _engine; },
  get scene()       { return _scene; },
  get camera()      { return _camera; },
  get canvas()      { return _canvas; },
  get shadowGen()   { return _shadowGen; },
  get sunLight()    { return _sunLight; },

  /** Start the render loop. */
  runRenderLoop() {
    _engine.runRenderLoop(() => {
      _scene.render();
    });
  },

  /** Stop the render loop. */
  stopRenderLoop() {
    _engine.stopRenderLoop();
  },

  /**
   * Load a GLB/GLTF model into the scene.
   * @param {string} url     Path to the .glb file
   * @param {object} opts    { scale, castShadows, receiveShadows, position }
   * @returns {Promise<TransformNode>} Root node of the loaded model
   */
  async loadGLB(url, opts = {}) {
    const result = await SceneLoader.ImportMeshAsync('', url, '', _scene);
    const root = new TransformNode('glbRoot_' + Date.now(), _scene);

    for (const mesh of result.meshes) {
      mesh.parent = root;

      if (opts.castShadows !== false) {
        _shadowGen.addShadowCaster(mesh);
      }
      if (opts.receiveShadows !== false) {
        mesh.receiveShadows = true;
      }
    }

    const s = opts.scale ?? 1;
    root.scaling = new Vector3(s, s, s);

    if (opts.position) {
      root.position = new Vector3(opts.position.x ?? 0, opts.position.y ?? 0, opts.position.z ?? 0);
    }

    return root;
  },

  /**
   * Update the chase camera to follow a target node.
   * @param {TransformNode} target
   * @param {number} distance
   * @param {number} height
   * @param {number} lerpFactor
   */
  updateChaseCamera(target, distance = 12, height = 6, lerpFactor = 0.1) {
    if (!target || !_camera) return;

    const pos = target.position;
    // Get forward direction from the target mesh
    const forward = target.forward ?? new Vector3(0, 0, 1);
    const behindOffset = forward.scale(-distance);

    const desiredPos = pos.add(behindOffset).add(new Vector3(0, height, 0));
    _camera.position = Vector3.Lerp(_camera.position, desiredPos, lerpFactor);
    _camera.setTarget(pos.add(forward.scale(2))); // Look ahead
  },

  /**
   * Create a simple box mesh.
   */
  createBox(name, size = { width: 1, height: 1, depth: 1 }, position = Vector3.Zero()) {
    const mesh = MeshBuilder.CreateBox(name, size, _scene);
    mesh.position = position;
    return mesh;
  },

  /**
   * Create a standard PBR material.
   */
  createPBRMaterial(name, opts = {}) {
    const mat = new PBRMaterial(name, _scene);
    if (opts.color) mat.albedoColor = Color3.FromHexString(opts.color);
    mat.roughness = opts.roughness ?? 0.7;
    mat.metallic = opts.metallic ?? 0.3;
    return mat;
  },

  /**
   * Dispose all resources.
   */
  dispose() {
    if (_pipeline) _pipeline.dispose();
    if (_scene) _scene.dispose();
    if (_engine) _engine.dispose();
    _engine = null;
    _scene = null;
    _camera = null;
    _pipeline = null;
    _shadowGen = null;
  },
};

// ── Procedural sky ──────────────────────────────────────────────────────────

function createProceduralSky() {
  const skyMat = new StandardMaterial('skyMat', _scene);
  skyMat.backFaceCulling = false;
  skyMat.disableLighting = true;
  skyMat.emissiveColor = new Color3(0.67, 0.87, 1.0);

  const skybox = MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 24 }, _scene);
  skybox.material = skyMat;
  skybox.infiniteDistance = true;
  skybox.renderingGroupId = 0;
}

export default renderer;
