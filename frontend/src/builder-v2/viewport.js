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

  // Sky gradient via background
  scene.background = new THREE.Color(0x1a1a2e);
  scene.fog = new THREE.FogExp2(0x1a1a2e, 0.004);

  // Ground grid
  const grid = new THREE.GridHelper(200, 20, 0x444466, 0x2a2a3e);
  grid.name = '__grid';
  scene.add(grid);

  // Ground plane for raycasting
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x222240,
    roughness: 0.95,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = '__ground';
  scene.add(ground);

  // Ambient light
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  // Hemisphere light for natural outdoor feel
  const hemi = new THREE.HemisphereLight(0x8899cc, 0x443322, 0.4);
  scene.add(hemi);

  // Directional (sun) light
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  scene.add(sun);

  // Entity group — all placed objects go here (not grid/ground/lights)
  const entityGroup = new THREE.Group();
  entityGroup.name = '__entities';
  scene.add(entityGroup);

  return { renderer, scene, ground, grid, entityGroup };
}
