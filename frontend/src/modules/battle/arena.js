import * as THREE from 'three';

// Load a simple battle arena into the scene and physics world
// Returns { spawnPoints: Array<{x,y,z}>, bounds: {width, depth} }
export function loadArena(ammo, scene, physicsWorld, arenaId = 'box') {
  switch (arenaId) {
    case 'box':
    default:
      return createBoxArena(ammo, scene, physicsWorld);
  }
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

  // Spawn points (simple cross around center)
  const spawnPoints = [
    { x: 0, y: 3, z: 0 },
    { x: 10, y: 3, z: 0 },
    { x: -10, y: 3, z: 0 },
    { x: 0, y: 3, z: 10 },
    { x: 0, y: 3, z: -10 },
  ];

  return { spawnPoints, bounds: { width, depth } };
}
