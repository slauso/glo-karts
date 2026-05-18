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
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getKart, KARTS } from './kart-catalog.js';

const loader = new GLTFLoader();
const _objLoader = new OBJLoader();

/**
 * Load an OBJ kart and manually apply textures from catalog entry fields
 * `albedoPath` and `normalPath`. Used for karts sourced from .obj files.
 */
function loadObjKartTemplate(id, kartEntry) {
  return new Promise((resolve, reject) => {
    _objLoader.load(
      kartEntry.modelPath,
      (obj) => {
        const texLoader = new THREE.TextureLoader();
        obj.traverse((child) => {
          if (child.isMesh) {
            const matOpts = { roughness: 0.55, metalness: 0.25 };
            if (kartEntry.albedoPath) {
              const alb = texLoader.load(kartEntry.albedoPath);
              alb.colorSpace = THREE.SRGBColorSpace;
              alb.flipY = false;
              matOpts.map = alb;
            }
            if (kartEntry.normalPath) {
              const nrm = texLoader.load(kartEntry.normalPath);
              nrm.flipY = false;
              matOpts.normalMap = nrm;
            }
            child.material = new THREE.MeshStandardMaterial(matOpts);
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        resolve(prepareKartScene(obj, id));
      },
      undefined,
      (err) => {
        console.warn(`[kart-loader] OBJ load failed for ${id}:`, err);
        reject(err);
      },
    );
  });
}

const cache = new Map();

/**
 * Target kart proportions in world units. Matches the cannon-es chassis
 * (HX=0.6, HZ=1.0 → 1.2 wide × 2.0 long) so the visible mesh sits inside
 * the collider rather than dwarfing it.
 *
 * We bound BOTH length and width so wide kart models (cars, snowmobiles)
 * don't end up wider than the chassis just because their natural Z is short.
 */
export const KART_TARGET_LENGTH = 2.0 * 1000; // mm
export const KART_MAX_WIDTH = 1.4 * 1000;     // mm

/**
 * Physics wheel attachment points (mirrored from physics-worker.js):
 *   WX = CHASSIS_HX + 0.05 = 0.65 m  (half track width)
 *   WZ = CHASSIS_HZ * 0.75 = 0.75 m  (half wheelbase)
 * → wheel-track  = 1.30 m (centre-to-centre, left↔right)
 * → wheelbase    = 1.50 m (centre-to-centre, front↔rear)
 *
 * When a kart GLB exposes the standard `wheel-front-left` /
 * `wheel-front-right` / `wheel-rear-left` / `wheel-rear-right` pivots,
 * the loader fits the model so the visible wheel pivots match these
 * physics positions. This is what makes skid trails, suspension visuals,
 * and physics tire-contact points line up identically across every
 * kart, regardless of the kart's authored proportions.
 */
export const KART_PHYSICS_HALF_TRACK = 0.65 * 1000;  // mm
export const KART_PHYSICS_HALF_BASE  = 0.75 * 1000;  // mm

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

  const kartEntry = getKart(id);
  const path = kartEntry.modelPath;

  let promise;
  if (path.endsWith('.obj')) {
    promise = loadObjKartTemplate(id, kartEntry).catch(() => makePlaceholderKart(0xff3a00));
  } else {
    promise = new Promise((resolve, reject) => {
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
  }

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
    // Re-skin tyre meshes with a realistic dark-rubber + radial-tread
    // material so wheel rotation reads at speed. The stock STK wheels
    // ship with a pale "wood/plastic" texture that washes out under
    // arena lighting and makes the wheels look static even when they
    // are spinning at 80 km/h. We REPLACE the material rather than
    // overlay so the orange/cream wood tones don't bleed through.
    const wheelMaterial = getWheelMaterial();
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        // Anything parented under a `wheel-*` pivot — including the
        // multi-mesh splits like `wheel-front-left_0` / `_1` — gets
        // the rubber material. The pivot test walks up the parent
        // chain so child mesh names don't have to match.
        if (isWheelMesh(child)) {
          child.material = wheelMaterial;
        }
      }
    });
    // `accent` is currently unused on the per-mesh level; the GLB ships
    // with its own diffuse maps for character paint. Keep the param so
    // future tinting (e.g. an emissive underglow) can hook in here.
    void accent;
    return clone;
  } catch {
    return makePlaceholderKart(accent);
  }
}

/** Walk up parent chain looking for a `wheel-*` named pivot. */
function isWheelMesh(obj) {
  let p = obj;
  while (p) {
    if (p.name && /^wheel-(front|rear)-(left|right)$/.test(p.name)) return true;
    p = p.parent;
  }
  return false;
}

// Shared dark-rubber wheel material. Built lazily on first use; reused
// across every kart instance so we only allocate one texture + one
// material for every wheel in the scene.
let _wheelMat = null;
function getWheelMaterial() {
  if (_wheelMat) return _wheelMat;
  // Simple light-grey tread texture so wheel rotation is visible.
  // Just alternating dark-rubber + light-grey blocks around the
  // circumference — no markers, no sidewall accents. U =
  // circumferential (the spinning axis), V = axial (across the tyre).
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = 64;
  const ctx = c.getContext('2d');
  // Base dark rubber.
  ctx.fillStyle = '#1a1a1c';
  ctx.fillRect(0, 0, size, 64);
  // 14 light-grey tread blocks around the circumference.
  const blocks = 14;
  const blockW = size / blocks;
  ctx.fillStyle = '#9a9aa0';
  for (let i = 0; i < blocks; i++) {
    const x = i * blockW;
    ctx.fillRect(x + blockW * 0.22, 12, blockW * 0.56, 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _wheelMat = new THREE.MeshStandardMaterial({
    map: tex,
    color: 0xffffff,    // map provides the colour; no tint
    roughness: 0.85,    // rubber is matte
    metalness: 0.0,
  });
  return _wheelMat;
}

function prepareKartScene(scene, id) {
  const root = new THREE.Group();
  root.name = `kart-${id}`;

  // Lift every top-level child into our root so we own the hierarchy.
  while (scene.children.length) {
    root.add(scene.children[0]);
  }

  // Normalize every texture on every material before we measure / scale.
  // Per-kart overrides correct upside-down maps left over from the STK
  // .b3d/.spm → glTF conversion (see KART_TEXTURE_OVERRIDES above).
  hardenKartTextures(root, KART_TEXTURE_OVERRIDES[id] || {});

  // Compute bbox and normalize: center horizontally on origin,
  // drop to y=0, scale so longest horizontal dim = KART_TARGET_LENGTH.
  root.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bbox.getSize(size);
  bbox.getCenter(center);

  // Resolve named wheel pivots BEFORE scaling so we can measure the
  // model's authored wheel-track / wheelbase. Karts that expose the
  // standard `wheel-*` pivots will be scaled so those pivots map
  // exactly onto the physics wheel attachment points — making skid
  // trails, suspension visuals, and physics tyre-contact points line
  // up identically across every kart regardless of the GLB's
  // authored proportions. Karts without named pivots (older
  // single-mesh models like `gnu`) fall back to bbox fitting.
  const wheelPivots = {
    fl: null, fr: null, rl: null, rr: null,
  };
  root.traverse((o) => {
    switch (o.name) {
      case 'wheel-front-left':  wheelPivots.fl = o; break;
      case 'wheel-front-right': wheelPivots.fr = o; break;
      case 'wheel-rear-left':   wheelPivots.rl = o; break;
      case 'wheel-rear-right':  wheelPivots.rr = o; break;
    }
  });
  const haveAllWheels = wheelPivots.fl && wheelPivots.fr
                     && wheelPivots.rl && wheelPivots.rr;

  let scale;
  if (haveAllWheels) {
    // Measure authored wheel positions in root-local space.
    const _v = new THREE.Vector3();
    const flW = new THREE.Vector3(); wheelPivots.fl.getWorldPosition(flW);
    const frW = new THREE.Vector3(); wheelPivots.fr.getWorldPosition(frW);
    const rlW = new THREE.Vector3(); wheelPivots.rl.getWorldPosition(rlW);
    const rrW = new THREE.Vector3(); wheelPivots.rr.getWorldPosition(rrW);
    // Authored half-track = mean |x| of all four wheels.
    // Authored half-base  = mean |z| of all four wheels.
    const authoredHalfTrack = (
      Math.abs(flW.x) + Math.abs(frW.x) + Math.abs(rlW.x) + Math.abs(rrW.x)
    ) / 4;
    const authoredHalfBase = (
      Math.abs(flW.z) + Math.abs(frW.z) + Math.abs(rlW.z) + Math.abs(rrW.z)
    ) / 4;
    // Pick the scale that brings authored → physics for the LARGER
    // axis (so the kart isn't exploded past sensible bodywork size if
    // its wheels are unusually narrow). Other axis will be slightly
    // off, but skid trails track per-wheel so they still align.
    const trackScale = authoredHalfTrack > 0
      ? KART_PHYSICS_HALF_TRACK / authoredHalfTrack : 1;
    const baseScale = authoredHalfBase > 0
      ? KART_PHYSICS_HALF_BASE  / authoredHalfBase  : 1;
    // Use the geometric mean — splits the difference so neither axis
    // is dramatically off when the kart's authored proportions are
    // skewed. This keeps bodywork visually plausible while landing
    // both wheel sets within ~10% of physics positions for typical
    // STK karts.
    scale = Math.sqrt(trackScale * baseScale);
    // Final safety clamp: don't let a tiny / giant kart blow past the
    // bbox bounds. KART_TARGET_LENGTH is the visual ceiling.
    const sizeMax = Math.max(size.x, size.z) || 1;
    const ceilingScale = KART_TARGET_LENGTH / sizeMax * 1.4;
    if (scale > ceilingScale) scale = ceilingScale;
    void _v;
  } else {
    // Bbox fallback for karts without named wheel pivots: scale so
    // length fits KART_TARGET_LENGTH but width never exceeds
    // KART_MAX_WIDTH. Whichever constraint is tighter wins.
    const sizeZ = size.z || 1;
    const sizeX = size.x || 1;
    const lenScale = KART_TARGET_LENGTH / sizeZ;
    const widthScale = KART_MAX_WIDTH / sizeX;
    scale = Math.min(lenScale, widthScale);
  }

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

  // STK kart GLBs are authored facing -Z, which matches the chassis
  // forward direction once cannon-es engine force + camera offset are
  // accounted for (see play-main.js applyControls / camOffset). No
  // rotation needed by default. Per-kart overrides below for any model
  // that ships facing the opposite way.
  const flip = KART_FACING_OVERRIDES[id] === 'flip' ? Math.PI : 0;
  scaler.rotation.y = flip;

  const template = new THREE.Group();
  template.name = `kart-template-${id}`;
  template.add(scaler);

  // Resolve named wheel pivots (STK convention used by most karts).
  // Cache the names so the runtime can locate them on each clone via
  // the shared lookup helper below — the templates themselves never
  // appear in the scene, so we don't pre-resolve Object3D refs here.
  template.userData.wheelNames = {
    fl: 'wheel-front-left',
    fr: 'wheel-front-right',
    rl: 'wheel-rear-left',
    rr: 'wheel-rear-right',
  };
  return template;
}

/**
 * Resolve the four named wheel pivots on a cloned kart Group, capture
 * their authored ("base") quaternion so per-frame steer + roll
 * rotations can be re-applied from a clean reference, and switch their
 * Euler order to YXZ so y(steer) composes outside x(roll). Returns
 * null for any kart whose GLB doesn't expose the standard wheel names
 * (e.g. older single-mesh models like `gnu`); callers should fall
 * back to the debug cylinders in that case.
 *
 * @param {THREE.Object3D} kartClone
 * @returns {{ fl: THREE.Object3D, fr: THREE.Object3D, rl: THREE.Object3D, rr: THREE.Object3D } | null}
 */
export function resolveKartWheels(kartClone) {
  // Walk the entire clone — the template wraps everything in a
  // scaler/translator so the wheel nodes sit several levels deep.
  const found = { fl: null, fr: null, rl: null, rr: null };
  kartClone.traverse((o) => {
    switch (o.name) {
      case 'wheel-front-left':  found.fl = o; break;
      case 'wheel-front-right': found.fr = o; break;
      case 'wheel-rear-left':   found.rl = o; break;
      case 'wheel-rear-right':  found.rr = o; break;
    }
  });
  if (!found.fl || !found.fr || !found.rl || !found.rr) return null;
  for (const key of ['fl', 'fr', 'rl', 'rr']) {
    const w = found[key];
    w.userData.baseQuat = w.quaternion.clone();
    w.rotation.order = 'YXZ';
  }
  return found;
}

/**
 * Per-kart facing override.
 * - default: kart's authored facing matches chassis forward (no rotation)
 * - 'flip': kart is authored facing the opposite way; rotate 180°
 */
const KART_FACING_OVERRIDES = {
  // example: oem: 'flip',
};

/**
 * Per-kart TEXTURE override. Kart GLBs originate from SuperTuxKart's
 * native `.b3d`/`.spm` formats (bottom-left UV origin, OpenGL
 * convention). The glTF spec uses top-left UV origin, so during the
 * GLB conversion a texture either needs its pixel data flipped OR its
 * UVs flipped — when one of the two is done but not both (a common
 * STK→GLB tooling bug) the resulting texture renders upside-down on
 * just the affected kart while every well-converted kart looks fine.
 *
 * Rather than re-bake every offending GLB, we override the THREE.js
 * texture properties at load time. `flipY: true` re-inverts the
 * texture's pixel rows on upload, which corrects an upside-down map
 * without touching the geometry's UV coords.
 *
 * Add an entry here when a new kart ships with an obviously inverted
 * texture (the body paint/face is upside-down). Effects are scoped to
 * the named kart only — well-converted karts keep their default
 * (glTF-spec-correct) `flipY: false`.
 *
 * @type {Object<string, { flipY?: boolean, anisotropy?: number }>}
 */
const KART_TEXTURE_OVERRIDES = {
  // 'amanda' is the GLB ID for the in-game kart labelled "Grace".
  // Ships with inverted texture orientation from the STK→GLB
  // converter; this re-flips it back upright.
  amanda: { flipY: true },
};

/**
 * Hardens every texture on every material under `root`:
 *   • Color maps (.map, .emissiveMap) → sRGB color space.
 *   • Data maps (.normalMap, .roughnessMap, .metalnessMap, .aoMap,
 *     .bumpMap, .displacementMap) → Linear (THREE default for these,
 *     but we set explicitly to be defensive against loaders that left
 *     them as sRGB).
 *   • `anisotropy` raised to 8 by default (caller may override per-kart)
 *     so high-frequency detail (faces, decals) doesn't smear at
 *     glancing camera angles.
 *   • `flipY` per-kart override (see KART_TEXTURE_OVERRIDES). glTF
 *     loader defaults to false; we only TOUCH this when overridden so
 *     well-converted karts are left alone.
 *   • Filters set to trilinear (LinearMipmapLinearFilter / LinearFilter)
 *     and `generateMipmaps = true` so distant karts in chase-cam
 *     don't shimmer.
 *   • Wrap defaults to RepeatWrapping (matches STK's authoring
 *     conventions for tiled body decals).
 *   • `needsUpdate = true` flagged after any change so the GPU
 *     re-uploads with the corrected settings.
 *
 * Materials themselves are left alone (color/roughness/metalness keep
 * whatever the GLB authored). Only TEXTURES are touched.
 */
function hardenKartTextures(root, overrides = {}) {
  const flipYOverride = typeof overrides.flipY === 'boolean' ? overrides.flipY : null;
  const anisoTarget = overrides.anisotropy != null ? overrides.anisotropy : 8;

  // Texture slot → desired colour space. Anything not in this map is
  // treated as a data texture (Linear).
  const COLOR_SLOTS = new Set(['map', 'emissiveMap']);
  // All texture-bearing slots we know about on MeshStandardMaterial /
  // MeshPhysicalMaterial / MeshBasicMaterial — covers everything STK
  // karts ship.
  const ALL_SLOTS = [
    'map', 'emissiveMap',
    'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap',
    'bumpMap', 'displacementMap',
    'alphaMap', 'specularMap', 'lightMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
    'sheenColorMap', 'sheenRoughnessMap',
    'transmissionMap', 'thicknessMap',
    'iridescenceMap', 'iridescenceThicknessMap',
  ];
  // Avoid touching the same texture twice when several materials share
  // it (which they often do on STK karts — the body and the wheel
  // covers can both reference the same paint atlas).
  const seen = new WeakSet();

  root.traverse((child) => {
    if (!child.isMesh) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const slot of ALL_SLOTS) {
        const tex = mat[slot];
        if (!tex || !tex.isTexture || seen.has(tex)) continue;
        seen.add(tex);
        if (flipYOverride !== null) tex.flipY = flipYOverride;
        if (COLOR_SLOTS.has(slot)) {
          tex.colorSpace = THREE.SRGBColorSpace;
        } else {
          // Data textures must be linear — sRGB-decoding a normal map
          // produces visibly wrong shading on faces/bodywork.
          tex.colorSpace = THREE.NoColorSpace;
        }
        if (tex.anisotropy < anisoTarget) tex.anisotropy = anisoTarget;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        if (tex.wrapS === THREE.ClampToEdgeWrapping && tex.wrapT === THREE.ClampToEdgeWrapping) {
          // Leave clamp-clamp textures alone (these are usually decals
          // / face cards intentionally clamped). Otherwise default to
          // Repeat which matches STK authoring conventions.
        } else {
          tex.wrapS = THREE.RepeatWrapping;
          tex.wrapT = THREE.RepeatWrapping;
        }
        tex.needsUpdate = true;
      }
      // Force material refresh too so the renderer picks up the
      // changed texture parameters on the next draw.
      mat.needsUpdate = true;
    }
  });
}

function makePlaceholderKart(accent) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2 * 1000, 0.6 * 1000, 2.0 * 1000),
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
