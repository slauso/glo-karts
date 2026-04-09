/**
 * fps-environment.js — Procedural FPS arena with imported props, PBR materials,
 * HDR environment, skybox, shadows, and reactive props.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { CubeTexture } from '@babylonjs/core/Materials/Textures/cubeTexture';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { PhysicsShapeBox, PhysicsShapeContainer } from '@babylonjs/core/Physics/v2/physicsShape';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { Quaternion } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/loaders/glTF';
import {
  FPS_ARENA_COVER_BLOCKS,
  FPS_ARENA_WALLS,
  FPS_IMPORTED_COVER_PROPS,
  getImportedPropColliderBoxes,
} from './fps-arena-layout.js';

const ASSET_ROOT = 'https://raw.githubusercontent.com/BabylonJS/Assets/master/';
const PROP_ROOT = 'https://raw.githubusercontent.com/BabylonJS/Assets/master/meshes/Demos/weaponsDemo/meshes/';

// BabylonJS/Assets environment assets
const HDR_SKYBOX_URL = ASSET_ROOT + 'textures/skybox/TropicalSunnyDay';
const NORMAL_FLOOR_URL = ASSET_ROOT + 'textures/normalMap.jpg';
const ALBEDO_FLOOR_URL = ASSET_ROOT + 'textures/floor.png';

// Approved weapon repo assets used as environmental props too
const PROP_FILES = ['cannon.glb', 'frostAxe.glb', 'moltenDagger.glb'];

// Collision layers used by the FPS mode
const FPS_LAYER = {
  GROUND:     0x0001,
  PLAYER:     0x0002,
  PROJECTILE: 0x0008,
  PROP:       0x0040,
  TARGET:     0x0080,
};

export async function createFPSEnvironment(scene, shadowGen) {
  // ── HDR environment + skybox ──────────────────────────────────────────
  try {
    scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(HDR_SKYBOX_URL + '.env', scene);
  } catch (e) {
    console.warn('Failed to load .env skybox, using cube textures fallback.', e?.message || e);
    try {
      scene.createDefaultSkybox(
        CubeTexture.CreateFromImages([
          HDR_SKYBOX_URL + '_px.jpg', HDR_SKYBOX_URL + '_py.jpg', HDR_SKYBOX_URL + '_pz.jpg',
          HDR_SKYBOX_URL + '_nx.jpg', HDR_SKYBOX_URL + '_ny.jpg', HDR_SKYBOX_URL + '_nz.jpg',
        ], scene),
        true,
        1200,
        0.35,
      );
    } catch {
      /* skip if unavailable */
    }
  }

  // ── Terrain ──────────────────────────────────────────────────────────
  const ground = MeshBuilder.CreateGround('fpsGround', { width: 220, height: 220, subdivisions: 80 }, scene);
  ground.receiveShadows = true;
  ground.isPickable = true;

  // Create soft rolling hills by deforming vertices
  const positions = ground.getVerticesData('position');
  if (positions) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      positions[i + 1] = Math.sin(x * 0.06) * 1.4 + Math.cos(z * 0.05) * 1.1 + Math.sin((x + z) * 0.03) * 1.8;
    }
    ground.updateVerticesData('position', positions);
    VertexData.ComputeNormals(positions, ground.getIndices(), ground.getVerticesData('normal'));
    ground.refreshBoundingInfo();
  }

  // PBR terrain material
  const terrainMat = new PBRMaterial('terrainMat', scene);
  terrainMat.albedoTexture = new Texture(ALBEDO_FLOOR_URL, scene);
  terrainMat.bumpTexture = new Texture(NORMAL_FLOOR_URL, scene);
  terrainMat.bumpTexture.level = 0.4;
  terrainMat.metallic = 0.05;
  terrainMat.roughness = 0.95;
  terrainMat.albedoColor = new Color3(0.68, 0.58, 0.42);
  terrainMat.useAmbientOcclusionFromMetallicTextureRed = false;
  terrainMat.environmentIntensity = 0.6;
  ground.material = terrainMat;

  // Ground physics
  const groundAgg = new PhysicsAggregate(
    ground,
    PhysicsShapeType.MESH,
    { mass: 0, friction: 0.95, restitution: 0.15 },
    scene,
  );
  groundAgg.shape.filterMembershipMask = FPS_LAYER.GROUND;
  groundAgg.shape.filterCollideMask = FPS_LAYER.PLAYER | FPS_LAYER.PROJECTILE;

  // ── Arena walls / cover geometry ─────────────────────────────────────
  const staticProps = [];
  const reactiveProps = [];

  // Outer walls
  const wallMat = new PBRMaterial('wallMat', scene);
  wallMat.albedoColor = new Color3(0.18, 0.2, 0.25);
  wallMat.metallic = 0.2;
  wallMat.roughness = 0.55;
  wallMat.environmentIntensity = 1.0;

  for (const spec of FPS_ARENA_WALLS) {
    const wall = MeshBuilder.CreateBox('arenaWall', { width: spec.w, height: spec.h, depth: spec.d }, scene);
    wall.position = new Vector3(spec.x, spec.y, spec.z);
    wall.material = wallMat;
    wall.receiveShadows = true;
    wall.isPickable = true;

    const agg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.8, restitution: 0.05 }, scene);
    agg.shape.filterMembershipMask = FPS_LAYER.GROUND;
    agg.shape.filterCollideMask = FPS_LAYER.PLAYER | FPS_LAYER.PROJECTILE;
    staticProps.push({ mesh: wall, aggregate: agg });
  }

  // Procedural cover blocks
  for (let i = 0; i < FPS_ARENA_COVER_BLOCKS.length; i++) {
    const spec = FPS_ARENA_COVER_BLOCKS[i];
    const block = MeshBuilder.CreateBox('cover_' + i, {
      width: spec.w,
      height: spec.h,
      depth: spec.d,
    }, scene);
    block.position = new Vector3(spec.x, spec.y, spec.z);
    block.rotation.y = spec.rotationY;
    block.material = wallMat;
    block.receiveShadows = true;
    block.isPickable = true;

    const agg = new PhysicsAggregate(block, PhysicsShapeType.BOX, { mass: 0, friction: 0.85, restitution: 0.05 }, scene);
    agg.shape.filterMembershipMask = FPS_LAYER.GROUND;
    agg.shape.filterCollideMask = FPS_LAYER.PLAYER | FPS_LAYER.PROJECTILE;
    staticProps.push({ mesh: block, aggregate: agg });
  }

  // ── Imported props from approved repo ────────────────────────────────
  await _loadCoverProps(scene, shadowGen, reactiveProps);

  return {
    ground,
    staticProps,
    reactiveProps,
    craterAt(point, radius = 2.2, depth = 0.35) {
      _deformTerrain(ground, point, radius, depth);
    },
  };
}

async function _loadCoverProps(scene, shadowGen, reactiveProps) {
  for (let i = 0; i < FPS_IMPORTED_COVER_PROPS.length; i++) {
    const propSpec = FPS_IMPORTED_COVER_PROPS[i];
    const file = propSpec.file;
    try {
      const result = await SceneLoader.ImportMeshAsync('', PROP_ROOT, file, scene);
      const root = new TransformNode('coverImported_' + i, scene);
      root.position = new Vector3(propSpec.x, propSpec.y, propSpec.z);
      root.rotation.y = propSpec.rotationY;
      root.scaling.setAll(propSpec.scale);

      for (const mesh of result.meshes) {
        mesh.parent = root;
        mesh.isPickable = true;
        mesh.receiveShadows = true;
        _upgradeMeshToPBR(mesh, scene);
        if (shadowGen) shadowGen.addShadowCaster(mesh);
      }
      const proxy = MeshBuilder.CreateBox('coverProxy_' + i, {
        width: 0.5,
        height: 0.5,
        depth: 0.5,
      }, scene);
      proxy.position.copyFrom(root.position);
      proxy.rotation.y = root.rotation.y;
      proxy.visibility = 0;
      proxy.isPickable = true;

      root.parent = proxy;
      root.position = Vector3.Zero();

      const agg = new PhysicsAggregate(proxy, PhysicsShapeType.BOX, { mass: 0, friction: 0.72, restitution: 0.05 }, scene);
      const compound = new PhysicsShapeContainer(scene);
      const colliderBoxes = getImportedPropColliderBoxes(propSpec);
      for (const collider of colliderBoxes) {
        const childShape = new PhysicsShapeBox(
          Vector3.Zero(),
          Quaternion.Identity(),
          new Vector3(collider.size.x, collider.size.y, collider.size.z),
          scene,
        );
        compound.addChild(
          childShape,
          new Vector3(
            collider.center.x - propSpec.x,
            collider.center.y - propSpec.y,
            collider.center.z - propSpec.z,
          ),
          Quaternion.FromEulerAngles(0, collider.rotationY - propSpec.rotationY, 0),
        );
      }
      agg.body.shape = compound;
      agg.shape.filterMembershipMask = FPS_LAYER.PROP;
      agg.shape.filterCollideMask = FPS_LAYER.GROUND | FPS_LAYER.PROJECTILE | FPS_LAYER.PLAYER;

      reactiveProps.push({ root, mesh: proxy, aggregate: agg, visualRoot: root });
    } catch (e) {
      console.warn('Failed to import cover prop', file, e?.message || e);
    }
  }
}

function _computeClusterBounds(meshes) {
  let min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  let max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const info = mesh.getBoundingInfo();
    if (!info) continue;
    min = Vector3.Minimize(min, info.boundingBox.minimumWorld);
    max = Vector3.Maximize(max, info.boundingBox.maximumWorld);
  }

  const size = max.subtract(min);
  const center = min.add(size.scale(0.5));
  return { min, max, size, center };
}

function _upgradeMeshToPBR(mesh, scene) {
  if (!mesh || !mesh.material) return;
  const old = mesh.material;
  if (old instanceof PBRMaterial) return;

  const pbr = new PBRMaterial(old.name + '_pbr', scene);
  if (old.diffuseTexture) pbr.albedoTexture = old.diffuseTexture;
  if (old.bumpTexture) pbr.bumpTexture = old.bumpTexture;
  if (old.emissiveTexture) pbr.emissiveTexture = old.emissiveTexture;
  if (old.diffuseColor) pbr.albedoColor = old.diffuseColor;
  if (old.emissiveColor) pbr.emissiveColor = old.emissiveColor;
  pbr.metallic = 0.15;
  pbr.roughness = 0.65;
  pbr.environmentIntensity = 0.8;
  mesh.material = pbr;
}

function _deformTerrain(ground, point, radius, depth) {
  const positions = ground.getVerticesData('position');
  if (!positions) return;
  const world = ground.computeWorldMatrix(true);

  for (let i = 0; i < positions.length; i += 3) {
    const vx = positions[i];
    const vy = positions[i + 1];
    const vz = positions[i + 2];

    const wx = vx + ground.position.x;
    const wz = vz + ground.position.z;

    const dx = wx - point.x;
    const dz = wz - point.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < radius) {
      const t = 1 - dist / radius;
      positions[i + 1] = vy - depth * t * t;
    }
  }

  ground.updateVerticesData('position', positions);
  ground.refreshBoundingInfo();
}
