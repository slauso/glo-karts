import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { isSTKArena, getTrackModelPath, getTrackScale, getStartPosition } from '../track-data.js';

// Load a battle arena into the scene and physics world
// Returns { spawnPoints: Array<{x,y,z}>, bounds: {width, depth} }
export function loadArena(ammo, scene, physicsWorld, arenaId = 'box') {
  // Load STK arena .glb models when an STK arena id is provided
  if (isSTKArena(arenaId)) {
    return loadSTKArena(ammo, scene, physicsWorld, arenaId);
  }

  switch (arenaId) {
    case 'box':
    default:
      return createBoxArena(ammo, scene, physicsWorld);
  }
}

// ---------------------------------------------------------------------------
// STK Arena loader — loads .glb model, creates Ammo.js trimesh collider,
// generates spawn points in a ring around the track-data start position.
// ---------------------------------------------------------------------------
function loadSTKArena(ammo, scene, physicsWorld, arenaId) {
  const modelPath = getTrackModelPath(arenaId);
  const scale = getTrackScale(arenaId);
  const center = getStartPosition(arenaId);

  // Spawn points — 12 evenly spaced on a ring around center
  const spawnPoints = [];
  const spawnRadius = 25;
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const angle = (i / spawnCount) * Math.PI * 2;
    spawnPoints.push({
      x: center.x + Math.cos(angle) * spawnRadius,
      y: center.y,
      z: center.z + Math.sin(angle) * spawnRadius,
    });
  }

  const loader = new GLTFLoader();
  loader.load(
    modelPath,
    (gltf) => {
      const arenaModel = gltf.scene;

      arenaModel.scale.set(scale, scale, scale);
      arenaModel.position.set(0, 0, 0);

      arenaModel.traverse((node) => {
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

      scene.add(arenaModel);
      console.log(`STK arena "${arenaId}" model loaded`);

      // Build Ammo.js triangle-mesh collider
      addArenaCollider(arenaModel, ammo, physicsWorld);
    },
    undefined,
    (error) => {
      console.error(`Error loading STK arena ${arenaId}:`, error);
    }
  );

  // Return synchronously so battle-main can use spawnPoints immediately
  return { spawnPoints, bounds: { width: 200, depth: 200 } };
}

function addArenaCollider(model, ammo, physicsWorld) {
  const vertices = [];
  const indices = [];
  let indexOffset = 0;

  model.updateMatrixWorld(true);

  model.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const positionAttr = child.geometry.getAttribute('position');
      const vertexCount = positionAttr.count;
      const worldMatrix = child.matrixWorld;

      for (let i = 0; i < vertexCount; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
        v.applyMatrix4(worldMatrix);
        vertices.push(v.x, v.y, v.z);
      }

      if (child.geometry.index) {
        const idx = child.geometry.index.array;
        for (let i = 0; i < idx.length; i++) {
          indices.push(idx[i] + indexOffset);
        }
      } else {
        for (let i = 0; i < vertexCount; i++) {
          indices.push(i + indexOffset);
        }
      }
      indexOffset += vertexCount;
    }
  });

  const triangleMesh = new ammo.btTriangleMesh();
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i] * 3;
    const i2 = indices[i + 1] * 3;
    const i3 = indices[i + 2] * 3;
    const v1 = new ammo.btVector3(vertices[i1], vertices[i1 + 1], vertices[i1 + 2]);
    const v2 = new ammo.btVector3(vertices[i2], vertices[i2 + 1], vertices[i2 + 2]);
    const v3 = new ammo.btVector3(vertices[i3], vertices[i3 + 1], vertices[i3 + 2]);
    triangleMesh.addTriangle(v1, v2, v3, false);
    ammo.destroy(v1);
    ammo.destroy(v2);
    ammo.destroy(v3);
  }

  const shape = new ammo.btBvhTriangleMeshShape(triangleMesh, true, true);
  const transform = new ammo.btTransform();
  transform.setIdentity();
  const motionState = new ammo.btDefaultMotionState(transform);
  const rbInfo = new ammo.btRigidBodyConstructionInfo(
    0, motionState, shape, new ammo.btVector3(0, 0, 0)
  );
  const body = new ammo.btRigidBody(rbInfo);
  body.setFriction(1.0);
  physicsWorld.addRigidBody(body);

  console.log(`Arena physics collider created (${indices.length / 3} triangles)`);
}

function createBoxArena(ammo, scene, physicsWorld) {
  // Dimensions
  const width = 100;
  const depth = 100;
  const wallHeight = 5;

  // Ground
  const groundGeometry = new THREE.PlaneGeometry(width, depth);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x4a4a4a,
    roughness: 0.8,
    metalness: 0.2
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Physics ground
  const groundShape = new ammo.btBoxShape(new ammo.btVector3(width/2, 0.5, depth/2));
  const groundTransform = new ammo.btTransform();
  groundTransform.setIdentity();
  groundTransform.setOrigin(new ammo.btVector3(0, -0.5, 0));
  const groundMotionState = new ammo.btDefaultMotionState(groundTransform);
  const groundRbInfo = new ammo.btRigidBodyConstructionInfo(
    0,
    groundMotionState,
    groundShape,
    new ammo.btVector3(0,0,0)
  );
  const groundBody = new ammo.btRigidBody(groundRbInfo);
  groundBody.setFriction(0.9);
  physicsWorld.addRigidBody(groundBody);

  // Walls
  const wallMaterial = new THREE.MeshStandardMaterial({ 
    color: 0xff6b6b,
    roughness: 0.7
  });

  const walls = [
    { pos: [0, wallHeight/2, depth/2], rotY: 0, size: [width, wallHeight, 1] },
    { pos: [0, wallHeight/2, -depth/2], rotY: 0, size: [width, wallHeight, 1] },
    { pos: [width/2, wallHeight/2, 0], rotY: Math.PI/2, size: [depth, wallHeight, 1] },
    { pos: [-width/2, wallHeight/2, 0], rotY: Math.PI/2, size: [depth, wallHeight, 1] },
  ];

  walls.forEach(w => {
    const wallGeo = new THREE.BoxGeometry(w.size[0], w.size[1], w.size[2]);
    const wallMesh = new THREE.Mesh(wallGeo, wallMaterial);
    wallMesh.position.set(w.pos[0], w.pos[1], w.pos[2]);
    wallMesh.rotation.y = w.rotY;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    const wallShape = new ammo.btBoxShape(new ammo.btVector3(w.size[0]/2, w.size[1]/2, w.size[2]/2));
    const wallTransform = new ammo.btTransform();
    wallTransform.setIdentity();
    wallTransform.setOrigin(new ammo.btVector3(w.pos[0], w.pos[1], w.pos[2]));
    const quat = new THREE.Quaternion();
    quat.setFromAxisAngle(new THREE.Vector3(0,1,0), w.rotY);
    wallTransform.setRotation(new ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
    const wallMotion = new ammo.btDefaultMotionState(wallTransform);
    const wallBodyInfo = new ammo.btRigidBodyConstructionInfo(0, wallMotion, wallShape, new ammo.btVector3(0,0,0));
    const wallBody = new ammo.btRigidBody(wallBodyInfo);
    physicsWorld.addRigidBody(wallBody);
  });

  // Visual grid
  const gridHelper = new THREE.GridHelper(width, 20, 0x000000, 0x000000);
  gridHelper.material.opacity = 0.2;
  gridHelper.material.transparent = true;
  scene.add(gridHelper);

  // Spawn points: 12 evenly spaced points on a safe inner ring
  const spawnPoints = [];
  const spawnRadius = 28;
  const spawnCount = 12;
  for (let i = 0; i < spawnCount; i++) {
    const angle = (i / spawnCount) * Math.PI * 2;
    spawnPoints.push({
      x: Math.cos(angle) * spawnRadius,
      y: 3,
      z: Math.sin(angle) * spawnRadius,
    });
  }

  return { spawnPoints, bounds: { width, depth } };
}
