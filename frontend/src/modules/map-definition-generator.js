/**
 * map-definition-generator.js — Auto-generate missing map definitions from imported mesh geometry.
 *
 * Falls back for STK or custom-imported .glb maps lacking metadata (boundaries, spawns,
 * driveline, item positions, physics colliders, surface properties).
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Ray } from '@babylonjs/core/Culling/ray';
import { PhysicsAggregate } from '@babylonjs/core/Physics/v2/physicsAggregate';
import { PhysicsShapeType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import { FILTER, applyFilterToAggregate } from './realtime/collision-layers.js';

function getGeometryMeshes(mesh) {
  const meshes = Array.isArray(mesh) ? mesh : [mesh];
  return meshes.filter((m) => {
    if (!m?.getTotalVertices) return false;
    if (m.getTotalVertices() > 0) return true;
    if (m.sourceMesh?.getTotalVertices && m.sourceMesh.getTotalVertices() > 0) return true;
    return false;
  });
}

/**
 * Computes AABB for a given mesh or array of meshes.
 */
function getMeshAABB(mesh) {
  let meshes = Array.isArray(mesh) ? mesh : [mesh];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let found = 0;

  for (const m of meshes) {
    if (!m.getBoundingInfo) continue;
    m.computeWorldMatrix(true);
    const bi = m.getBoundingInfo();
    const wMin = bi.boundingBox.minimumWorld;
    const wMax = bi.boundingBox.maximumWorld;
    if (wMin.x < minX) minX = wMin.x;
    if (wMin.y < minY) minY = wMin.y;
    if (wMin.z < minZ) minZ = wMin.z;
    if (wMax.x > maxX) maxX = wMax.x;
    if (wMax.y > maxY) maxY = wMax.y;
    if (wMax.z > maxZ) maxZ = wMax.z;
    found++;
  }

  if (found === 0) return null;
  const min = new Vector3(minX, minY, minZ);
  const max = new Vector3(maxX, maxY, maxZ);
  return { min, max, center: Vector3.Center(min, max), size: max.subtract(min) };
}

/**
 * Use mesh bounding info + raycasting/extrusion to create outer/inner walls (Havok BoxImpostors)
 */
export function generateBoundariesFromMesh(mesh) {
  const scene = Array.isArray(mesh) ? mesh[0].getScene() : mesh.getScene();
  const aabb = getMeshAABB(mesh);
  if (!aabb) return [];

  const margin = 2; // Extra padding
  const wallH = Math.max(50, aabb.size.y + 20); // Make them tall enough
  const halfW = aabb.size.x / 2 + margin;
  const halfD = aabb.size.z / 2 + margin;
  const cx = aabb.center.x;
  const cy = aabb.min.y + wallH / 2 - 10;
  const cz = aabb.center.z;
  const THICK = 2;

  const wallMat = new StandardMaterial('gen-wall-mat', scene);
  wallMat.diffuseColor = new Color3(1, 0, 0);
  wallMat.alpha = 0; // invisible in prod

  const wallDefs = [
    { name: 'bwall-N', w: halfW * 2, h: wallH, d: THICK, x: cx, y: cy, z: cz - halfD },
    { name: 'bwall-S', w: halfW * 2, h: wallH, d: THICK, x: cx, y: cy, z: cz + halfD },
    { name: 'bwall-E', w: THICK, h: wallH, d: halfD * 2, x: cx + halfW, y: cy, z: cz },
    { name: 'bwall-W', w: THICK, h: wallH, d: halfD * 2, x: cx - halfW, y: cy, z: cz },
  ];

  const walls = [];
  for (const wd of wallDefs) {
    const wall = MeshBuilder.CreateBox(wd.name, { width: wd.w, height: wd.h, depth: wd.d }, scene);
    wall.position.set(wd.x, wd.y, wd.z);
    wall.material = wallMat;
    wall.isVisible = false; // Intentionally invisible
    const agg = new PhysicsAggregate(wall, PhysicsShapeType.BOX, { mass: 0, friction: 0.3, restitution: 0.5 }, scene);
    applyFilterToAggregate(agg, FILTER.BOUNDARY || FILTER.TRACK);
    walls.push(wall);
  }
  
  console.log(`[map-gen] Generated ${walls.length} boundaries.`);
  return walls;
}

/**
 * Sample points along mesh surface (y+1 offset), stagger in grid
 */
export function generateSpawnPointsFromMesh(mesh, numPlayers = 12) {
  const scene = Array.isArray(mesh) ? mesh[0].getScene() : mesh.getScene();
  const aabb = getMeshAABB(mesh);
  const geometryMeshes = getGeometryMeshes(mesh);
  const spawns = [];
  if (!aabb) return spawns;

  const cx = aabb.center.x;
  const cz = aabb.center.z;
  const startRadius = Math.max(5, Math.min(aabb.size.x, aabb.size.z) * 0.15);
  const rayHeight = aabb.max.y + 50;

  for (let i = 0; i < numPlayers; i++) {
    const angle = (i / numPlayers) * Math.PI * 2;
    // Stagger distance
    const r = startRadius + (i % 2 === 0 ? 0 : 4);
    const px = cx + Math.cos(angle) * r;
    const pz = cz + Math.sin(angle) * r;

    // Raycast down to find ground
    const ray = new Ray(new Vector3(px, rayHeight, pz), new Vector3(0, -1, 0), rayHeight * 2);
    const hit = scene.pickWithRay(ray, (m) => geometryMeshes.includes(m) || geometryMeshes.includes(m?.sourceMesh));
    
    let py = aabb.min.y + 0.35;
    if (hit && hit.hit && hit.pickedPoint) {
      py = hit.pickedPoint.y + 0.45;
    }
    
    spawns.push({ position: [px, py, pz], heading: -angle + Math.PI / 2 });
  }

  console.log(`[map-gen] Generated ${spawns.length} spawn points.`);
  return spawns;
}

/**
 * Approximate center path using mesh bounding box + centroid sampling (BezierCurve3 fallback).
 * Returns array of { position: [x,y,z] } for checkpoints/laps.
 */
export function generateDrivelineFromMesh(mesh) {
  const aabb = getMeshAABB(mesh);
  const driveline = [];
  if (!aabb) return driveline;

  const cx = aabb.center.x;
  const cz = aabb.center.z;
  const cy = aabb.min.y + 0.25;
  const radiusX = Math.max(10, aabb.size.x * 0.3);
  const radiusZ = Math.max(10, aabb.size.z * 0.3);
  
  const steps = 16;
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    // creating a simple oval/loop path
    const px = cx + Math.cos(angle) * radiusX;
    const pz = cz + Math.sin(angle) * radiusZ;
    driveline.push({
      center: [px, cy, pz],
      width: 25
    });
  }

  console.log(`[map-gen] Generated driveline with ${driveline.length} nodes.`);
  return driveline;
}

/**
 * Sample along driveline with random offset
 */
export function generateItemSpawnPoints(path, numPoints = 10) {
  const items = [];
  if (!path || path.length === 0) return items;

  for (let i = 0; i < numPoints; i++) {
    // Pick a random segment along path
    const segIdx = Math.floor((i / numPoints) * path.length);
    const p = path[segIdx].center;
    // Add random sideways offset
    const offsetX = (Math.random() - 0.5) * 15;
    const offsetZ = (Math.random() - 0.5) * 15;
    
    items.push({
      type: 'item',
      position: [p[0] + offsetX, p[1] + 0.35, p[2] + offsetZ],
      heading: 0
    });
  }
  
  console.log(`[map-gen] Generated ${items.length} item spawn points.`);
  return items;
}

/**
 * Simple 2D grid + walkable surface check (for AI)
 */
export function generateNavGridFromMesh(mesh) {
  const aabb = getMeshAABB(mesh);
  if (!aabb) return null;

  // Extremely basic bounding-box based navgrid
  const navGrid = {
    origin: [aabb.min.x, aabb.min.y, aabb.min.z],
    cellSize: 5,
    width: Math.max(10, Math.ceil(aabb.size.x / 5)),
    height: Math.max(10, Math.ceil(aabb.size.z / 5)),
    data: []
  };
  
  // Fill data with 1 (walkable everywhere in bounding box to prevent AI crash)
  for (let i = 0; i < navGrid.width * navGrid.height; i++) {
    navGrid.data.push(1);
  }

  console.log(`[map-gen] Generated nav grid ${navGrid.width}x${navGrid.height}.`);
  return navGrid;
}

/**
 * Assign materials/friction (e.g., asphalt = 0.8 friction, ice = 0.2)
 * Creates PhysicsAggregates on mesh geometry if none exists.
 */
export function applySurfaceTypes(mesh) {
  const scene = Array.isArray(mesh) ? mesh[0].getScene() : mesh.getScene();
  const meshes = Array.isArray(mesh) ? mesh : [mesh];
  let physCount = 0;
  
  // Broader filter: include InstancedMesh, don't filter by isVisible
  const geometryMeshes = getGeometryMeshes(meshes);

  // Ensure world matrices up-to-date
  scene.render();
  geometryMeshes.forEach((m) => m.computeWorldMatrix(true));

  for (const m of geometryMeshes) {
    m.isPickable = true; // allow raycasts
    
    // Guess surface type from name or material
    let friction = 0.8; // Default asphalt/dry
    let restitution = 0.1;
    const nameStr = (m.name + ' ' + (m.material ? m.material.name : '')).toLowerCase();
    
    if (nameStr.includes('ice') || nameStr.includes('snow')) { friction = 0.2; }
    else if (nameStr.includes('dirt') || nameStr.includes('sand') || nameStr.includes('grass')) { friction = 0.6; }
    else if (nameStr.includes('boost')) { friction = 0.9; restitution = 0.0; } 
    
    // Check if there's already a collider cloned. In our unified engine, we clone meshes.
    // If not cloned directly on m, we'll clone it here.
    if (!m.physicsBody) {
      try {
        const sourceMesh = m.sourceMesh || m;
        const clone = sourceMesh.clone(`${m.name}_collider`, null);
        if (!clone) continue;

        if (m.sourceMesh) {
          clone.position.copyFrom(m.absolutePosition);
          if (m.absoluteRotationQuaternion) {
            clone.rotationQuaternion = m.absoluteRotationQuaternion.clone();
          }
          clone.scaling.copyFrom(m.absoluteScaling);
        }

        clone.computeWorldMatrix(true);
        clone.bakeCurrentTransformIntoVertices();
        clone.parent = null;
        clone.isVisible = false;
        clone.isPickable = false;

        const agg = new PhysicsAggregate(clone, PhysicsShapeType.MESH, { mass: 0, friction, restitution }, scene);
        applyFilterToAggregate(agg, FILTER.TRACK);
        physCount++;
      } catch (e) {
        console.warn(`[map-gen] Failed applying physics to surface ${m.name}`, e);
      }
    }
  }

  console.log(`[map-gen] Applied surface types/colliders to ${physCount} meshes.`);
}

/**
 * Main orchestrator: generate whole MapDefinition object
 */
export function generateMapDefinition(scene, importResult, opts = {}) {
  const meshes = importResult?.meshes || [];
  if (meshes.length === 0) return null;
  
  const aabb = getMeshAABB(meshes);
  if (!aabb) return null;

  console.log(`[map-gen] Found track geometry, running auto-generation...`);
  
  if (opts.generateWalls !== false) {
    generateBoundariesFromMesh(meshes); // adds walls to scene
  }
  
  if (opts.applyPhysics !== false) {
    applySurfaceTypes(meshes); // adds Havok collisions & materials to meshes
  }
  
  const driveline = generateDrivelineFromMesh(meshes);
  const spawnPositions = generateSpawnPointsFromMesh(meshes, opts.numPlayers || 12);
  const items = generateItemSpawnPoints(driveline, opts.numItems || 10);
  const navmesh = generateNavGridFromMesh(meshes);
  
  const floorY = aabb ? aabb.min.y : -10;

  // Formatted for `track-data-loader.js` fallback
  return {
    aabb,
    floorY,
    driveline,
    startPositions: spawnPositions,
    spawnPositions: spawnPositions, // battle compat
    items,
    navmesh,
    laps: 3
  };
}
