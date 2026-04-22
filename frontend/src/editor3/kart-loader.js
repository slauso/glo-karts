/**
 * kart-loader.js — Shared kart GLB loader for editor3 / play3.
 *
 * Uses a singleton GLTFLoader + per-id promise cache. Auto-scales each
 * loaded kart so its longest horizontal dimension matches a target length
 * (so every STK model fits the same physics chassis regardless of its
 * native scale). Returns a fresh cloneable group per call.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getKart, KARTS } from './kart-catalog.js';

const loader = new GLTFLoader();
/** @type {Map<string, Promise<THREE.Group>>} */
const cache = new Map();

/**
 * Target kart proportions in world units. Matches the cannon-es chassis
 * (HX=0.6, HZ=1.0 → 1.2 wide × 2.0 long) so the visible mesh sits inside
 * the collider rather than dwarfing it.
 *
 * We bound BOTH length and width so wide kart models (cars, snowmobiles)
 * don't end up wider than the chassis just because their natural Z is short.
 */
export const KART_TARGET_LENGTH = 2.0;
export const KART_MAX_WIDTH = 1.4;

/**
 * Load + prep a kart template. Resolves to a THREE.Group that has been
 * normalized so the model sits on y=0 (wheels on ground), faces -Z
 * (driving forward), and fits within KART_TARGET_LENGTH along its
 * longest horizontal axis.
 *
 * Caller should clone (via cloneKart) before adding to scene — do NOT
 * add the template itself to the scene graph.
 * @param {string} kartId
 * @returns {Promise<THREE.Group>}
 */
export function loadKartTemplate(kartId) {
  const id = getKart(kartId).id;
  if (cache.has(id)) return cache.get(id);

  const promise = new Promise((resolve, reject) => {
    const path = getKart(id).modelPath;
    loader.load(
      path,
      (gltf) => resolve(prepareKartScene(gltf.scene, id)),
      undefined,
      (err) => {
        console.warn(`[kart-loader] failed to load ${id} at ${path}:`, err);
        reject(err);
      },
    );
  });

  cache.set(id, promise);
  return promise;
}

/**
 * Returns a fresh clone suitable for adding to the scene. Uses
 * SkeletonUtils so skinned meshes (many STK karts have skeletons) clone
 * correctly. Falls back to a placeholder box if the load failed.
 * @param {string} kartId
 * @param {THREE.ColorRepresentation} [accent]
 * @returns {Promise<THREE.Group>}
 */
export async function cloneKart(kartId, accent = 0xff3aa1) {
  try {
    const template = await loadKartTemplate(kartId);
    const clone = cloneSkinned(template);
    clone.userData.kartId = kartId;
    // Enable shadow casting on every mesh in the clone
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return clone;
  } catch {
    return makePlaceholderKart(accent);
  }
}

function prepareKartScene(scene, id) {
  const root = new THREE.Group();
  root.name = `kart-${id}`;

  // Lift every top-level child into our root so we own the hierarchy.
  while (scene.children.length) {
    root.add(scene.children[0]);
  }

  // Compute bbox and normalize: center horizontally on origin,
  // drop to y=0, scale so longest horizontal dim = KART_TARGET_LENGTH.
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  // Scale so length fits KART_TARGET_LENGTH but width never exceeds
  // KART_MAX_WIDTH. Whichever constraint is tighter wins.
  const sizeZ = size.z || 1;
  const sizeX = size.x || 1;
  const lenScale = KART_TARGET_LENGTH / sizeZ;
  const widthScale = KART_MAX_WIDTH / sizeX;
  const scale = Math.min(lenScale, widthScale);

  // Wrap in scaler + translator groups so downstream clones inherit transforms.
  const scaler = new THREE.Group();
  scaler.scale.setScalar(scale);

  // Translate so horizontal center sits at origin and base sits on y=0.
  root.position.set(
    -center.x,
    -bbox.min.y,
    -center.z,
  );

  scaler.add(root);

  // RaycastVehicle forward axis is +Z in our world (indexForwardAxis=2).
  // STK kart GLBs are authored facing -Z (their nose points toward -Z),
  // so by default we rotate them 180° so visual forward matches physics
  // forward. Per-kart overrides below if a model differs.
  const baseFlip = KART_FACING_OVERRIDES[id] === 'no-flip' ? 0 : Math.PI;
  scaler.rotation.y = baseFlip;

  const template = new THREE.Group();
  template.name = `kart-template-${id}`;
  template.add(scaler);
  return template;
}

/**
 * Per-kart facing override.
 * - default: kart is rotated 180° so its visual nose points along +Z (forward)
 * - 'no-flip': kart is already authored facing +Z; skip the rotation
 */
const KART_FACING_OVERRIDES = {
  // example: oem: 'no-flip',
};

function makePlaceholderKart(accent) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.6, 2.0),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.2 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x00e5ff }),
  );
  head.position.set(0, 0.5, -0.2);
  head.castShadow = true;
  group.add(head);
  return group;
}

/** Preload every kart listed in the catalog. Fire-and-forget. */
export function preloadAllKarts(ids) {
  const targets = Array.isArray(ids) ? ids : KARTS.map((k) => k.id);
  for (const id of targets) loadKartTemplate(id).catch(() => {});
}
