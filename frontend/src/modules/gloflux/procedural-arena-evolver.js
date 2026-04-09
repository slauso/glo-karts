import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { SolidParticleSystem } from '@babylonjs/core/Particles/solidParticleSystem';
import { FILTER, applyFilterToAggregate } from '../realtime/collision-layers.js';
import { FAMILY } from './glo-flux-powers.js';

class EventCombiner {
  constructor(windowMs = 4500) {
    this.windowMs = windowMs;
    this.events = [];
  }

  push(event) {
    this.events.push(event);
    this.prune(event.timestamp || Date.now());
  }

  prune(now = Date.now()) {
    this.events = this.events.filter((entry) => (now - entry.timestamp) <= this.windowMs);
  }

  countByFamily(familyId) {
    return this.events.filter((entry) => entry.familyId === familyId).length;
  }
}

class DynamicHeightmapPatch {
  constructor({ patchId, patchX, patchZ, patchSize, familyId, comboId, heights, chainStrength, generatedAt }) {
    this.patchId = patchId;
    this.patchX = patchX;
    this.patchZ = patchZ;
    this.patchSize = patchSize;
    this.familyId = familyId;
    this.comboId = comboId;
    this.heights = heights;
    this.chainStrength = chainStrength;
    this.generatedAt = generatedAt;
  }
}

class MutationStack {
  constructor(seed) {
    this.seed = seed;
    this.layers = [];
    this.version = 0;
  }

  push(patch) {
    this.layers.push(patch);
    this.version += 1;
  }

  getActivePatches() {
    return this.layers.slice();
  }
}

class PatchApplier {
  constructor(scene, adaptive) {
    this.scene = scene;
    this.adaptive = adaptive;
    this.root = new TransformNode('gf_mutation_root', scene);
    this.surface = null;
    this.surfaceMaterial = null;
    this.surfaceAggregate = null;
    this.vineSps = null;
    this.vineMesh = null;
    this.familyInstanceSources = new Map();
    this.familyThinCounts = new Map();
    this.familyFallbackInstances = new Map();
    this.patchRecords = [];
    this.lastAppliedPatch = null;
  }

  initialize() {
    this.surface = MeshBuilder.CreateGround('gf_mutation_surface', {
      width: 160,
      height: 160,
      subdivisions: this.adaptive.groundSubdivisions,
      updatable: true,
    }, this.scene);
    this.surface.position.y = 0.12;
    this.surface.parent = this.root;

    this.surfaceMaterial = new StandardMaterial('gf_mutation_surface_mat', this.scene);
    this.surfaceMaterial.diffuseColor = new Color3(0.12, 0.1, 0.16);
    this.surfaceMaterial.emissiveColor = new Color3(0.05, 0.04, 0.08);
    this.surfaceMaterial.alpha = 0.88;
    this.surface.material = this.surfaceMaterial;

    if (typeof this.scene.getPhysicsEngine === 'function' && this.scene.getPhysicsEngine()) {
      this.surfaceAggregate = new PhysicsAggregate(this.surface, PhysicsShapeType.MESH, { mass: 0, friction: 0.9 }, this.scene);
      applyFilterToAggregate(this.surfaceAggregate, FILTER.TRACK);
    }

    this._ensureThinInstanceSources();
    this._ensureVines();
  }

  _ensureThinInstanceSources() {
    const families = [
      [FAMILY.PHANTOM_HORDE, MeshBuilder.CreateSphere('gf_mutation_ghost_source', { diameter: 0.6, segments: 6 }, this.scene)],
      [FAMILY.ENTROPIC_VOID, MeshBuilder.CreateCylinder('gf_mutation_rift_source', { height: 1.2, diameterTop: 0.05, diameterBottom: 0.4, tessellation: 6 }, this.scene)],
      [FAMILY.BIOFRACTAL_AEGIS, MeshBuilder.CreateBox('gf_mutation_fractal_source', { width: 0.4, height: 0.8, depth: 0.4 }, this.scene)],
      [FAMILY.PSYCHE_APOTHEOSIS, MeshBuilder.CreateTorus('gf_mutation_psyche_source', { diameter: 0.8, thickness: 0.08, tessellation: 14 }, this.scene)],
    ];

    families.forEach(([familyId, mesh]) => {
      mesh.parent = this.root;
      mesh.isVisible = false;
      const mat = new StandardMaterial(`gf_mutation_family_${familyId}`, this.scene);
      const color = familyId === FAMILY.PHANTOM_HORDE
        ? new Color3(0.52, 0.14, 0.86)
        : familyId === FAMILY.ENTROPIC_VOID
          ? new Color3(0.38, 0.12, 0.68)
          : familyId === FAMILY.BIOFRACTAL_AEGIS
            ? new Color3(0.12, 0.75, 0.34)
            : new Color3(0.95, 0.32, 0.56);
      mat.diffuseColor = color.scale(0.4);
      mat.emissiveColor = color.scale(0.7);
      mesh.material = mat;
      this.familyInstanceSources.set(familyId, mesh);
      this.familyThinCounts.set(familyId, 0);
    });
  }

  _ensureVines() {
    this.vineSps = new SolidParticleSystem('gf_vines_sps', this.scene, { isPickable: false });
    const source = MeshBuilder.CreateCylinder('gf_vine_source', { height: 1.2, diameterTop: 0.05, diameterBottom: 0.12, tessellation: 5 }, this.scene);
    this.vineSps.addShape(source, this.adaptive.vineCount);
    source.dispose();
    this.vineMesh = this.vineSps.buildMesh();
    this.vineMesh.parent = this.root;
    this.vineMesh.isVisible = true;
    const mat = new StandardMaterial('gf_vine_mat', this.scene);
    mat.diffuseColor = new Color3(0.1, 0.35, 0.08);
    mat.emissiveColor = new Color3(0.05, 0.2, 0.04);
    this.vineMesh.material = mat;
  }

  applyPatch(patch, patchIndex) {
    if (!this.surface) return;

    const positions = this.surface.getVerticesData('position');
    const stride = 3;
    const subdivisions = this.adaptive.groundSubdivisions;
    const verticesPerSide = subdivisions + 1;
    const surfaceHalf = 80;
    const patchSpan = 160 / Math.max(1, subdivisions);

    for (let z = 0; z < patch.patchSize; z += 1) {
      for (let x = 0; x < patch.patchSize; x += 1) {
        const worldX = patch.patchX + x;
        const worldZ = patch.patchZ + z;
        const normalizedX = Math.max(0, Math.min(verticesPerSide - 1, Math.round(((worldX + surfaceHalf) / (surfaceHalf * 2)) * subdivisions)));
        const normalizedZ = Math.max(0, Math.min(verticesPerSide - 1, Math.round(((worldZ + surfaceHalf) / (surfaceHalf * 2)) * subdivisions)));
        const index = (normalizedZ * verticesPerSide + normalizedX) * stride + 1;
        positions[index] += patch.heights[z * patch.patchSize + x] * 0.18;
      }
    }

    this.surface.updateVerticesData('position', positions);
    this.surface.refreshBoundingInfo();
    this.surface.createNormals(true);

    this.patchRecords.push({
      patchId: patch.patchId,
      familyId: patch.familyId,
      comboId: patch.comboId,
      patchSize: patch.patchSize,
      patchX: patch.patchX,
      patchZ: patch.patchZ,
      appliedAt: Date.now(),
      patchVersion: patchIndex,
      patchSpan,
    });
    this.lastAppliedPatch = this.patchRecords[this.patchRecords.length - 1];

    this._rebuildThinInstances(patch, patchIndex);
    if (patch.familyId === FAMILY.BIOFRACTAL_AEGIS) {
      this._growVines(patch, patchIndex);
    }
    this.surface.metadata = {
      patchCount: this.patchRecords.length,
      patchVersion: patchIndex,
      lastFamilyId: patch.familyId,
      lastComboId: patch.comboId,
    };
  }

  _rebuildThinInstances(patch, patchIndex) {
    const source = this.familyInstanceSources.get(patch.familyId);
    if (!source) return;

    const previousFallbacks = this.familyFallbackInstances.get(patch.familyId) || [];
    previousFallbacks.forEach((instance) => instance.dispose());
    this.familyFallbackInstances.set(patch.familyId, []);

    const count = Math.min(this.adaptive.instanceBudgetPerPatch, Math.max(4, Math.round(patch.chainStrength * 6)));
    const matrices = new Float32Array(count * 16);
    for (let i = 0; i < count; i += 1) {
      const offsetX = (Math.sin(i * 1.13 + patchIndex) * patch.patchSize) * 0.3;
      const offsetZ = (Math.cos(i * 1.49 + patchIndex) * patch.patchSize) * 0.3;
      const scale = 0.5 + ((i % 5) * 0.08);
      const posX = patch.patchX + offsetX;
      const posZ = patch.patchZ + offsetZ;
      const posY = 0.5 + (i % 3) * 0.15;
      const base = i * 16;
      matrices[base + 0] = scale;
      matrices[base + 1] = 0;
      matrices[base + 2] = 0;
      matrices[base + 3] = 0;
      matrices[base + 4] = 0;
      matrices[base + 5] = scale;
      matrices[base + 6] = 0;
      matrices[base + 7] = 0;
      matrices[base + 8] = 0;
      matrices[base + 9] = 0;
      matrices[base + 10] = scale;
      matrices[base + 11] = 0;
      matrices[base + 12] = posX;
      matrices[base + 13] = posY;
      matrices[base + 14] = posZ;
      matrices[base + 15] = 1;
    }

    if (typeof source.thinInstanceSetBuffer === 'function') {
      source.thinInstanceSetBuffer('matrix', matrices, 16, true);
      source.isVisible = true;
    } else if (typeof source.createInstance === 'function') {
      const fallbacks = [];
      for (let i = 0; i < count; i += 1) {
        const instance = source.createInstance(`${source.name}_fallback_${patchIndex}_${i}`);
        const base = i * 16;
        instance.position.x = matrices[base + 12];
        instance.position.y = matrices[base + 13];
        instance.position.z = matrices[base + 14];
        instance.scaling.set(matrices[base + 0], matrices[base + 5], matrices[base + 10]);
        instance.parent = this.root;
        fallbacks.push(instance);
      }
      this.familyFallbackInstances.set(patch.familyId, fallbacks);
      source.isVisible = false;
    }

    this.familyThinCounts.set(patch.familyId, count);
  }

  _growVines(patch, patchIndex) {
    if (!this.vineSps) return;
    this.vineSps.initParticles = () => {
      for (let i = 0; i < this.vineSps.nbParticles; i += 1) {
        const particle = this.vineSps.particles[i];
        const angle = ((i + patchIndex) / Math.max(1, this.vineSps.nbParticles)) * Math.PI * 2;
        const radius = 1.4 + (i % 6) * 0.18;
        particle.position.x = patch.patchX + Math.cos(angle) * radius;
        particle.position.z = patch.patchZ + Math.sin(angle) * radius;
        particle.position.y = 0.1 + (i % 5) * 0.2;
        particle.scaling.x = 0.7;
        particle.scaling.z = 0.7;
        particle.scaling.y = 0.5 + ((i % 7) * 0.24);
        particle.rotation.y = angle;
      }
    };
    this.vineSps.initParticles();
    this.vineSps.setParticles();
  }

  getDebugState() {
    return {
      patchCount: this.patchRecords.length,
      lastAppliedPatch: this.lastAppliedPatch,
      thinInstances: Object.fromEntries(this.familyThinCounts.entries()),
      hasMutationSurface: !!this.surface,
      vineParticleCount: this.vineSps?.nbParticles || 0,
    };
  }

  dispose() {
    this.surfaceAggregate?.dispose?.();
    this.surface?.dispose?.();
    this.vineMesh?.dispose?.();
    this.vineSps?.dispose?.();
    this.familyFallbackInstances.forEach((instances) => instances.forEach((instance) => instance.dispose()));
    this.familyInstanceSources.forEach((mesh) => mesh.dispose());
    this.root.dispose();
  }
}

export class ProceduralArenaEvolver {
  constructor({ scene, havokPlugin = null, arenaData = null, seed = 0, debugBus = null } = {}) {
    this.scene = scene;
    this.havokPlugin = havokPlugin;
    this.arenaData = arenaData;
    this.seed = Number(seed || 0);
    this.debugBus = debugBus;
    this.hardwareConcurrency = typeof navigator !== 'undefined' ? Number(navigator.hardwareConcurrency || 8) : 8;
    this.lowEnd = this.hardwareConcurrency <= 4;
    this.adaptive = {
      patchSize: this.lowEnd ? 20 : 32,
      groundSubdivisions: this.lowEnd ? 32 : 64,
      vineCount: this.lowEnd ? 18 : 40,
      instanceBudgetPerPatch: this.lowEnd ? 10 : 28,
    };
    this.eventCombiner = new EventCombiner();
    this.mutationStack = new MutationStack(this.seed);
    this.patchApplier = new PatchApplier(scene, this.adaptive);
    this.worker = null;
    this.pendingPatchRequests = [];
    this.pendingSnapshots = [];
    this.patchCounter = 0;
    this.initialized = false;
  }

  async init() {
    this.patchApplier.initialize();
    this._createWorker();
    this.initialized = true;
    this._publishDebug();
  }

  _createWorker() {
    this.worker = new Worker(new URL('./procedural-arena-evolver.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event) => {
      const { type, payload } = event.data || {};
      if (type !== 'patchGenerated') return;
      this.pendingSnapshots.push(new DynamicHeightmapPatch(payload));
    };
  }

  queueMutation(chainEvent) {
    if (!this.worker || !chainEvent) return;
    const patchId = `patch_${this.patchCounter}`;
    const patchSize = Math.min(32, this.adaptive.patchSize);
    const amplitude = chainEvent.apocalypse ? 9 : 4 + chainEvent.chainStrength;
    const scale = chainEvent.familyId === FAMILY.ENTROPIC_VOID ? 0.14 : 0.09;
    const familyBias = chainEvent.familyId === FAMILY.PHANTOM_HORDE
      ? 1.2
      : chainEvent.familyId === FAMILY.ENTROPIC_VOID
        ? 1.35
        : chainEvent.familyId === FAMILY.BIOFRACTAL_AEGIS
          ? 1.1
          : 1.28;

    const angle = this.patchCounter * 0.87;
    const radius = 10 + (this.patchCounter % 6) * 5;
    const patchX = Math.round(Math.cos(angle) * radius);
    const patchZ = Math.round(Math.sin(angle) * radius);

    this.pendingPatchRequests.push({ patchId, comboId: chainEvent.comboId });
    this.worker.postMessage({
      type: 'generatePatch',
      payload: {
        patchId,
        seed: this.seed,
        patchX,
        patchZ,
        patchSize,
        amplitude,
        scale,
        familyBias,
        familyId: chainEvent.familyId,
        comboId: chainEvent.comboId,
        chainStrength: chainEvent.chainStrength,
      },
    });
    this.patchCounter += 1;
    this.eventCombiner.push({
      familyId: chainEvent.familyId,
      timestamp: chainEvent.timestamp || Date.now(),
    });
  }

  update() {
    while (this.pendingSnapshots.length > 0) {
      const patch = this.pendingSnapshots.shift();
      this.mutationStack.push(patch);
      this.patchApplier.applyPatch(patch, this.mutationStack.version);
    }
    this._publishDebug();
  }

  triggerApocalypseBurst(chainEvent) {
    this.queueMutation({
      ...chainEvent,
      apocalypse: true,
      chainStrength: Math.max(chainEvent?.chainStrength || 1, 4),
    });
  }

  getDebugState() {
    return {
      initialized: this.initialized,
      seed: this.seed,
      adaptive: this.adaptive,
      lowEnd: this.lowEnd,
      mutationStackDepth: this.mutationStack.layers.length,
      mutationStackVersion: this.mutationStack.version,
      pendingPatchRequests: this.pendingPatchRequests.length,
      activeFamilyEvents: {
        [FAMILY.PHANTOM_HORDE]: this.eventCombiner.countByFamily(FAMILY.PHANTOM_HORDE),
        [FAMILY.ENTROPIC_VOID]: this.eventCombiner.countByFamily(FAMILY.ENTROPIC_VOID),
        [FAMILY.BIOFRACTAL_AEGIS]: this.eventCombiner.countByFamily(FAMILY.BIOFRACTAL_AEGIS),
        [FAMILY.PSYCHE_APOTHEOSIS]: this.eventCombiner.countByFamily(FAMILY.PSYCHE_APOTHEOSIS),
      },
      ...this.patchApplier.getDebugState(),
    };
  }

  _publishDebug() {
    if (!this.debugBus || typeof this.debugBus !== 'object') return;
    this.debugBus.arenaEvolver = this.getDebugState();
  }

  dispose() {
    this.worker?.terminate?.();
    this.patchApplier.dispose();
  }
}