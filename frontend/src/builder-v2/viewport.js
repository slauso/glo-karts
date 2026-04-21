/**
 * viewport.js — Three.js scene, renderer, lights, grid, ground plane.
 */
import * as THREE from 'three';

export function createViewport(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x1a1a2e);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();

  // Scene atmosphere — matches SKR aesthetic
  scene.background = new THREE.Color(0xadb2ba);
  scene.fog = new THREE.Fog(0xadb2ba, 80, 160);

  // Ground grid — aligned to GRID_SIZE=10 cells
  const grid = new THREE.GridHelper(200, 20, 0x4a7a2a, 0x4a7a2a);
  grid.name = '__grid';
  grid.position.y = -0.01;
  grid.material.opacity = 0.3;
  grid.material.transparent = true;
  grid.renderOrder = 2;
  scene.add(grid);

  // Ground plane for raycasting
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x369069,
    roughness: 0.95,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = '__ground';
  ground.position.y = -0.14;
  ground.renderOrder = 1;
  scene.add(ground);

  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  // Hemisphere light — sky/ground color
  const hemi = new THREE.HemisphereLight(0xc8d8e8, 0x7a8a5a, 1.5);
  scene.add(hemi);

  // Directional (sun) light — stronger for vibrant Kenney-style look
  const sun = new THREE.DirectionalLight(0xffffff, 5);
  sun.position.set(11.4, 15, -5.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 100;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  scene.add(sun);

  // Entity group — all placed objects go here (not grid/ground/lights)
  const entityGroup = new THREE.Group();
  entityGroup.name = '__entities';
  scene.add(entityGroup);

  return { renderer, scene, ground, grid, entityGroup };
}
