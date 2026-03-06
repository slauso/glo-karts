import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getTrackModelPath, getTrackScale, isCustomMap, getFallThreshold } from './track-data.js';
import { createTrackCollider, getKartY } from './havok-physics.js';

// Function to load the track model and add to scene
export function loadTrackModel(mapId = "map1", scene, loadingManager, callback) {
  // Use the loading manager with your loader
  const loader = new GLTFLoader(loadingManager);
  
  const modelPath = getTrackModelPath(mapId);
  const scale = getTrackScale(mapId);
  console.log(`Loading track model from: ${modelPath} (scale ${scale})`);
  
  loader.load(
    modelPath,
    (gltf) => {
      const track = gltf.scene;
      
      // Scale to match the world scale (8 for custom maps, 1 for STK tracks)
      track.scale.set(scale, scale, scale);
      
      // Position at origin
      track.position.set(0, 0, 0);
      track.rotation.set(0, 0, 0);
      
      // Make sure track casts and receives shadows
      track.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;

          // STK SPM normals are skipped in the pipeline; recompute from geometry
          // so lighting is correct.
          if (node.geometry) {
            node.geometry.computeVertexNormals();
          }

          // STK meshes use Irrlicht's left-handed winding. Even after winding
          // reversal in the pipeline, thin geometry (walls, railings, signs)
          // needs DoubleSide as a safety net to prevent holes.
          if (Array.isArray(node.material)) {
            node.material = node.material.map(m => {
              const mc = m.clone();
              mc.roughness = 0.7;
              mc.metalness = 0.3;
              mc.side = THREE.DoubleSide;
              return mc;
            });
          } else if (node.material) {
            node.material = node.material.clone();
            node.material.roughness = 0.7;
            node.material.metalness = 0.3;
            node.material.side = THREE.DoubleSide;
          }
        }
      });
      
      // Add to scene
      scene.add(track);
      console.log(`Map ${mapId} track loaded successfully`);
      
      // Add physics collider for the track (Havok)
      addTrackColliderHavok(track);
      
      // Call the callback with the track model if provided
      if (callback && typeof callback === 'function') {
        callback(track);
      }
    },
    (xhr) => {
      console.log(`Loading track: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
    },
    (error) => {
      console.error(`Error loading track for ${mapId}:`, error);
    }
  );
}

// Extract geometry from a Three.js model and create a Havok trimesh collider
function addTrackColliderHavok(trackModel) {
  const MAX_TRIANGLES = 80000;
  const positions = [];
  const indices = [];
  let vertOffset = 0;
  let triCount = 0;

  trackModel.updateMatrixWorld(true);
  const _vec = new THREE.Vector3();

  trackModel.traverse((child) => {
    if (triCount >= MAX_TRIANGLES) return;
    if (!child.isMesh || !child.geometry) return;

    const geo = child.geometry;
    const pos = geo.getAttribute('position');
    if (!pos) return;
    const mat = child.matrixWorld;
    const idx = geo.index;

    // Append world-space vertices
    const baseVert = vertOffset;
    for (let i = 0; i < pos.count; i++) {
      _vec.fromBufferAttribute(pos, i).applyMatrix4(mat);
      positions.push(_vec.x, _vec.y, _vec.z);
      vertOffset++;
    }

    // Append triangle indices
    if (idx) {
      for (let i = 0; i + 2 < idx.count && triCount < MAX_TRIANGLES; i += 3) {
        indices.push(baseVert + idx.getX(i), baseVert + idx.getX(i + 1), baseVert + idx.getX(i + 2));
        triCount++;
      }
    } else {
      for (let i = 0; i + 2 < pos.count && triCount < MAX_TRIANGLES; i += 3) {
        indices.push(baseVert + i, baseVert + i + 1, baseVert + i + 2);
        triCount++;
      }
    }
  });

  createTrackCollider(
    new Float32Array(positions),
    new Uint32Array(indices),
    1.0,
  );
  console.log(`Track physics collider (Havok): ${triCount.toLocaleString()} triangles (cap ${MAX_TRIANGLES.toLocaleString()})`);
}

// Function to load map decorations
export function loadMapDecorations(mapId = "map1", scene, renderer, camera, loadingManager) {
  // STK tracks don't have separate decorations files
  if (!isCustomMap(mapId)) {
    console.log(`Skipping decorations for ${mapId} (STK track/arena — no decorations.glb)`);
    return;
  }
  
  // Use the loading manager with your loader
  const loader = new GLTFLoader(loadingManager);
  const scale = getTrackScale(mapId);
  
  loader.load(
    `/models/maps/${mapId}/decorations.glb`,
    (gltf) => {
      const decorations = gltf.scene;
      
      // Scale to match track scale
      decorations.scale.set(scale, scale, scale);
      decorations.position.set(0, 0, 0);
      
      // Important: Process all materials in the decoration model
      const materials = new Set();
      
      decorations.traverse((node) => {
        if (node.isMesh) {
          // Critical: Clone materials to ensure unique instances
          if (node.material) {
            // Add to set to track unique materials
            materials.add(node.material);
            
            // Create a new instance of the material
            node.material = node.material.clone();
            
            // Enhance material properties
            node.material.roughness = 0.7;
            node.material.metalness = 0.2;
            node.material.needsUpdate = true;
            
            // Enable shadows
            node.castShadow = true;
            node.receiveShadow = true;
          }
        }
      });
      
      console.log(`Processed ${materials.size} unique materials in decorations`);
      
      // Add to scene
      scene.add(decorations);
      
      // Force a renderer update to ensure materials are processed
      if (renderer && camera) {
        renderer.renderLists.dispose();
        renderer.render(scene, camera);
      }
      
      console.log(`Map ${mapId} decorations loaded successfully`);
    },
    undefined,
    (error) => {
      console.error(`Error loading map decorations for ${mapId}:`, error);
    }
  );
}

// Check if the kart has fallen below the fall threshold
export function checkGroundCollision(resetFunction, fallThreshold = -50) {
  const y = getKartY();
  if (y < fallThreshold) {
    console.log('Car fell off track - resetting position');
    if (resetFunction) resetFunction();
  }
}