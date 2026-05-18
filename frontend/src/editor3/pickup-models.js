/**
 * pickup-models.js — async loader + clone cache for Mario-Kart-style
 * pickup item models shipped under `frontend/public/kart assets/`.
 *
 * Mirrors glb-cache.js but uses ColladaLoader since the source assets
 * are .dae. Each registered model is loaded on first use, cached, and
 * cloned per instance. Materials are upgraded to MeshStandardMaterial
 * with the bundled Albedo PNG so the items match the editor's PBR
 * lighting.
 *
 * Callers should always create a procedural placeholder first and then
 * subscribe via `onItemModelLoaded` to swap the placeholder out when
 * the real mesh arrives — this keeps the editor responsive on cold
 * loads.
 */

import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const ASSET_BASE = '/kart assets/3D Kart/Assets/Models/Items';
const MAP_BASE = '/kart assets/3D Kart/Assets/Models';

// Spaces in URLs need to be percent-encoded for fetch. Encode each
// path segment individually so slashes survive.
function enc(p) {
  return p.split('/').map(encodeURIComponent).join('/');
}

// Logical-name → { dae, alb?, scale, defaultColor, emissive?, base?, keepMaterials? }
// Scale brings each model into "kart-cell" units (~1 m wide). Most
// source DAEs export at game-engine scale where 1 unit ≈ 1 m, so we
// use a single uniform scale per item to fit the pickup pedestal halo.
export const ITEM_MODEL_REGISTRY = {
  banana:           { dae: 'Banana/ItemBanana.dae',                  alb: 'Banana/ItemBanana_Alb.png',                  scale: 1.6 },
  blue_shell:       { dae: 'BlueShell/ItemTogezo.dae',               alb: null,                                         scale: 1.5, defaultColor: 0x3a7bff, emissive: 0x1144aa },
  bobomb:           { dae: 'Bo bomb/Bob-OmbTex/ItemBomHei.dae',      alb: 'Bo bomb/Bob-OmbTex/ItemBomHei_Alb.png',      scale: 1.4, defaultColor: 0x222831 },
  bullet_bill:      { dae: 'Bullet Bill/ItemKiller.dae',             alb: null,                                         scale: 1.4, defaultColor: 0x222831 },
  coin:             { dae: 'Coin/ItemCoin.dae',                      alb: 'Coin/itemcoin_alb.png',                      scale: 1.3 },
  golden_mushroom:  { dae: 'Golden Mushroom/ItemPowerKinoko.dae',    alb: 'Golden Mushroom/ItemPowerKinoko_Alb.png',    scale: 1.5 },
  green_shell:      { dae: 'Green Red Shell/ItemKoura.dae',          alb: 'Green Red Shell/ItemKoura_Alb.0.png',        scale: 1.5, defaultColor: 0x55ff66 },
  red_shell:        { dae: 'Green Red Shell/ItemKoura.dae',          alb: 'Green Red Shell/ItemKoura_Alb.1.png',        scale: 1.5, defaultColor: 0xff5555 },
  item_box_real:    { dae: 'Item Box/ItemBox.dae',                   alb: 'Item Box/ItemBox_Alb .png',                  scale: 1.6 },
  mushroom:         { dae: 'Mushroom/ItemKinoko.dae',                alb: 'Mushroom/ItemKinoko_Alb.png',                scale: 1.4 },
  star:             { dae: 'Starman/ItemStar.dae',                   alb: 'Starman/ItemStar_Alb.png',                   scale: 1.4, emissive: 0xffe04a },
  // 3D Kart map props (Toad Harbor / Mario Circuit / Water Park)
  // Some entries are no longer surfaced in the palette but remain used as
  // internal scenery decoration baked into specific road segment builders.
  mk8_pylon:        { base: `${MAP_BASE}/Wii U - Mario Kart 8 - Toad Harbor/Traffic Cone/Traffic Cone`, dae: 'Pylon.dae',      scale: 1.2, keepMaterials: true },
  mk8_crashbox:     { base: `${MAP_BASE}/Wii U - Mario Kart 8 - Toad Harbor/Crate`,                         dae: 'CrashBox.dae',   scale: 1.8, keepMaterials: true },
  mk8_dkbarrel:     { base: `${MAP_BASE}/Wii U - Mario Kart 8 - Toad Harbor/DK Barrel/DK Barrel`,           dae: 'DKBarrel.dae',   scale: 1.7, keepMaterials: true },
  mk8_flagrope:     { base: `${MAP_BASE}/Mario Circuit/RopeFlag`,                                             dae: 'FlagRope1.dae',  scale: 6.8, keepMaterials: true },
  mk8_fountain:     { base: `${MAP_BASE}/Water Park/Fountain`,                                                dae: 'WPFountain.dae', scale: 8.0, keepMaterials: true },
  mk8_cityboat:     { base: `${MAP_BASE}/Wii U - Mario Kart 8 - Toad Harbor/CityBoat`,                      dae: 'CityBoat.dae',   scale: 12.0, keepMaterials: true },
};

// Many of the MK8 / 3D Kart DAEs reference texture filenames with mixed
// case (e.g. "PylonR_Alb.png") while the actual files on disk are stored
// lowercase ("pylonr_alb.png"). Vite serves the public folder case-
// sensitively (and falls back to the SPA index.html for unknown paths,
// which the image element silently rejects). Install a URL modifier on
// the loading manager that lowercases the basename of texture-like
// requests so ColladaLoader's internal ImageLoader finds the asset.
const _mgr = new THREE.LoadingManager();
// Silence ColladaLoader's per-asset "loading an asset with a Z-UP
// coordinate system" warning. The MK donor DAEs are all authored Z-up
// and we already handle the rotation downstream — the warning is
// purely informational and floods the console (~17 entries every time
// a kart + item set loads), making real warnings/errors easy to miss
// in the lobby. We patch console.warn ONCE, swallow only the exact
// Three.js Z-UP message, and pass everything else through unchanged.
if (typeof console !== 'undefined' && !console.__gloColladaWarnFilter) {
  const _origWarn = console.warn.bind(console);
  console.warn = function (...args) {
    const first = args[0];
    if (typeof first === 'string' && first.indexOf('THREE.ColladaLoader: You are loading an asset with a Z-UP') !== -1) {
      return; // swallow the Z-UP info-warning; we handle the rotation already
    }
    _origWarn(...args);
  };
  console.__gloColladaWarnFilter = true;
}
_mgr.setURLModifier((url) => {
  // Lowercase the basename for both texture and model references — the
  // public/kart assets/ tree was bulk-normalized to lowercase filenames
  // so registry entries (which preserve the original mixed-case names
  // from the source assets) need a case fix to match Vite/Vercel's
  // case-sensitive static serving.
  return url.replace(
    /([^/]+)\.(png|jpe?g|tga|bmp|webp|dae|fbx|smd)(\?[^/]*)?$/i,
    (_full, name, ext, qs) => `${name.toLowerCase()}.${ext.toLowerCase()}${qs || ''}`,
  );
});
const _loader = new ColladaLoader(_mgr);
// Use the same LoadingManager so the lowercase-basename URL modifier
// applies to explicit album textures too (registry `alb` paths use the
// original mixed case from the source assets, but the on-disk files are
// normalized to lowercase to keep Vite/Vercel case-sensitive serving
// happy).
const _texLoader = new THREE.TextureLoader(_mgr);
const _cache = new Map();    // logicalName -> THREE.Group (template root)
const _pending = new Map();  // logicalName -> Promise<Group>
const _listeners = new Set();

/** Subscribe; returns an unsubscribe fn. fn(name, root). */
export function onItemModelLoaded(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _upgradeMaterials(root, entry, albTex) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (entry.keepMaterials) return;
    const mat = new THREE.MeshStandardMaterial({
      color: entry.defaultColor != null ? entry.defaultColor : 0xffffff,
      map: albTex || null,
      roughness: 0.55,
      metalness: 0.18,
      emissive: entry.emissive != null ? entry.emissive : 0x000000,
      emissiveIntensity: entry.emissive != null ? 0.55 : 0,
    });
    if (Array.isArray(o.material)) {
      o.material = o.material.map(() => mat);
    } else {
      o.material = mat;
    }
  });
}

function _normalizeTransform(root, entry) {
  // Recenter on XZ origin and put base on y=0; then apply uniform scale
  // so the model's largest horizontal dimension ≈ entry.scale.
  //
  // ColladaLoader applies the Z_UP→Y_UP correction as a node-level
  // rotation, and `setFromObject` on the *raw* loader scene can return
  // non-finite bounds before world matrices have been updated. Force a
  // full matrix update first, then fall back to scanning geometry
  // attributes directly if the Box3 is still degenerate.
  root.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(root);
  const valid = (b) =>
    isFinite(b.min.x) && isFinite(b.max.x) &&
    isFinite(b.min.y) && isFinite(b.max.y) &&
    isFinite(b.min.z) && isFinite(b.max.z) &&
    (b.max.x - b.min.x) > 1e-6;
  if (!valid(box)) {
    // Manual fallback: walk meshes, expand box from world-space
    // position attributes. Handles loaders that don't pre-compute
    // geometry.boundingBox.
    box = new THREE.Box3();
    const v = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes?.position) return;
      const pos = o.geometry.attributes.position;
      o.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
      }
    });
  }
  if (!valid(box)) return; // give up — caller falls back to raw scene
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const wrap = new THREE.Group();
  wrap.add(root);
  // Move root so its bounding box bottom-center sits at origin.
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  const widest = Math.max(size.x, size.z, 0.001);
  const target = entry.scale || 1.4;
  const s = target / widest;
  wrap.scale.setScalar(s);
  return wrap;
}

/** Load a model by logical name. Resolves to a template Group (do NOT
 *  add directly to scene — clone via `instanceItemModel`). */
export function loadItemModel(name) {
  const entry = ITEM_MODEL_REGISTRY[name];
  if (!entry) return Promise.reject(new Error(`unknown item model: ${name}`));
  if (_cache.has(name)) return Promise.resolve(_cache.get(name));
  if (_pending.has(name)) return _pending.get(name);

  const base = entry.base || ASSET_BASE;
  const daeUrl = `${base}/${enc(entry.dae)}`;
  const albUrl = entry.alb ? `${base}/${enc(entry.alb)}` : null;

  const p = new Promise((resolve) => {
    const finish = (root) => {
      _cache.set(name, root);
      _pending.delete(name);
      for (const fn of _listeners) {
        try { fn(name, root); } catch (e) { console.warn('[pickup-model listener]', e); }
      }
      resolve(root);
    };

    const onTexReady = (albTex) => {
      _loader.load(
        daeUrl,
        (collada) => {
          try {
            const scene = collada.scene;
            // ColladaLoader returns Y-up by default; some MK assets are
            // Z-up. Detect via metadata.
            if (collada.library && collada.library.images) { /* no-op */ }
            _upgradeMaterials(scene, entry, albTex);
            const wrap = _normalizeTransform(scene, entry) || scene;
            finish(wrap);
          } catch (err) {
            console.warn('[pickup-model] post-process failed', name, err);
            finish(new THREE.Group());
          }
        },
        undefined,
        (err) => {
          console.warn('[pickup-model] dae load failed', name, daeUrl, err);
          _pending.delete(name);
          finish(new THREE.Group());
        },
      );
    };

    if (albUrl) {
      _texLoader.load(
        albUrl,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          onTexReady(tex);
        },
        undefined,
        () => onTexReady(null),
      );
    } else {
      onTexReady(null);
    }
  });

  _pending.set(name, p);
  return p;
}

/** Get a clone of the cached template, or null if not loaded yet.
 *  Uses SkeletonUtils.clone() so SkinnedMesh items (mushroom, banana,
 *  shells, star, bullet bill, etc.) get properly re-bound skeletons —
 *  THREE's default Object3D.clone() shares the original skeleton/bones
 *  between clones, which makes every clone after the first render at
 *  the original template's location instead of where it was placed. */
export function instanceItemModel(name) {
  const tpl = _cache.get(name);
  if (!tpl) return null;
  return cloneSkinned(tpl);
}

/** Preload a list of models (fire-and-forget). */
export function preloadItemModels(names) {
  return Promise.allSettled((names || Object.keys(ITEM_MODEL_REGISTRY)).map(loadItemModel));
}
