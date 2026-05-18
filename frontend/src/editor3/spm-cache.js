/**
 * spm-cache.js — Loader + clone cache for SuperTuxKart `.spm` mesh files.
 *
 * The SPM binary format is documented in the SuperTuxKart source
 * (`src/graphics/sp_mesh_loader.cpp`). This implementation supports the
 * common SPMN (static, non-animated) variant used by every prop in the
 * `stk-assets/library/` collection. Skinned (SPMA) animated variants are
 * skipped — for static editor props that's exactly what we need.
 *
 * Public API:
 *   loadStkSpm(path)      → Promise<THREE.Group>  (also caches)
 *   instanceStkSpm(path)  → THREE.Group | null    (synchronous clone)
 */

import * as THREE from 'three';

const _meshCache = new Map();   // path → THREE.Group (template)
const _pending   = new Map();   // path → Promise<THREE.Group>
const _texCache  = new Map();   // texUrl → THREE.Texture

const _texLoader = new THREE.TextureLoader();

function encPath(p) {
  // Encode each segment, preserve slashes and leading slash.
  return p.split('/').map((s, i) => {
    if (s === '' && i === 0) return '';
    return encodeURIComponent(s);
  }).join('/');
}

// Decode an IEEE 754 half-precision float (16-bit) → 32-bit float.
function _half2float(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7C00) >> 10;
  const f =  h & 0x03FF;
  if (e === 0)        return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1F)     return f ? NaN : ((s ? -1 : 1) * Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

// Decode a packed 3*10+2-bit normal (uint32) → THREE.Vector3.
function _unpackNormal(packed, out) {
  const xRaw = packed         & 0x3FF;
  const yRaw = (packed >> 10) & 0x3FF;
  const zRaw = (packed >> 20) & 0x3FF;
  const sx = xRaw & 0x200 ? xRaw - 0x400 : xRaw;
  const sy = yRaw & 0x200 ? yRaw - 0x400 : yRaw;
  const sz = zRaw & 0x200 ? zRaw - 0x400 : zRaw;
  out[0] = sx / 511;
  out[1] = sy / 511;
  out[2] = sz / 511;
}

/**
 * Parse a `.spm` ArrayBuffer into a list of geometry groups + material refs.
 */
function _parseSpm(buffer) {
  const view = new DataView(buffer);
  let off = 0;
  const readU8  = () => { const v = view.getUint8(off);          off += 1; return v; };
  const readU16 = () => { const v = view.getUint16(off, true);   off += 2; return v; };
  const readU32 = () => { const v = view.getUint32(off, true);   off += 4; return v; };
  const readF32 = () => { const v = view.getFloat32(off, true);  off += 4; return v; };
  const readBytes = (n) => { const r = new Uint8Array(buffer, off, n); off += n; return r; };

  // Magic
  if (readU8() !== 0x53 || readU8() !== 0x50) throw new Error('Not an SPM file');

  // Header byte: bits>>3 = version, low 3 bits → header type.
  const hb = readU8();
  const version = hb >> 3;
  if (version !== 1) throw new Error(`Unsupported SPM version: ${version}`);
  const headerType = hb & 0x07;
  // 0=SPMS (deprecated), 1=SPMA (animated), 2=SPMN (normal)
  if (headerType === 0) throw new Error('SPMS (space-partitioned) variant not supported');
  const isSkinned = headerType === 1;

  // Vertex flags
  const vflags = readU8();
  const readNormal  = !!(vflags       & 0x01);
  const readVColor  = !!(vflags >> 1  & 0x01);
  const readTangent = !!(vflags >> 2  & 0x01);

  // Bounding box (6 floats) — read but unused; renderer recomputes.
  for (let i = 0; i < 6; i++) readF32();

  // Materials
  const matCount = readU16();
  const materials = [];
  for (let i = 0; i < matCount; i++) {
    const t1Len = readU8();
    const tex1  = t1Len > 0 ? new TextDecoder().decode(readBytes(t1Len)) : '';
    const t2Len = readU8();
    const tex2  = t2Len > 0 ? new TextDecoder().decode(readBytes(t2Len)) : '';
    materials.push({ tex1, tex2, uvOne: tex1.length > 0, uvTwo: tex2.length > 0 });
  }

  // Sectors (typically 1 for SPMN)
  const sectorCount = readU16();
  const groups = [];
  for (let s = 0; s < sectorCount; s++) {
    const matSize = readU16();
    for (let m = 0; m < matSize; m++) {
      const vCount = readU32();
      if (vCount > 65535) throw new Error('32-bit indices not supported');
      const iCount = readU32();
      const matId  = readU16();
      const mat = materials[matId] || { uvOne: false, uvTwo: false };

      const positions = new Float32Array(vCount * 3);
      const normals   = new Float32Array(vCount * 3);
      const uvs       = mat.uvOne ? new Float32Array(vCount * 2) : null;
      const colors    = readVColor ? new Float32Array(vCount * 3) : null;
      const tmpN = [0, 0, 0];

      for (let v = 0; v < vCount; v++) {
        positions[v * 3 + 0] = readF32();
        positions[v * 3 + 1] = readF32();
        positions[v * 3 + 2] = readF32();
        if (readNormal) {
          _unpackNormal(readU32(), tmpN);
          normals[v * 3 + 0] = tmpN[0];
          normals[v * 3 + 1] = tmpN[1];
          normals[v * 3 + 2] = tmpN[2];
        } else {
          normals[v * 3 + 1] = 1;
        }
        if (readVColor) {
          const ci = readU8();
          if (ci === 128) {
            colors[v * 3 + 0] = 1;
            colors[v * 3 + 1] = 1;
            colors[v * 3 + 2] = 1;
          } else {
            colors[v * 3 + 0] = readU8() / 255;
            colors[v * 3 + 1] = readU8() / 255;
            colors[v * 3 + 2] = readU8() / 255;
          }
        }
        if (mat.uvOne) {
          uvs[v * 2 + 0] = _half2float(readU16());
          uvs[v * 2 + 1] = _half2float(readU16());
          if (mat.uvTwo) { readU16(); readU16(); }      // skip uv2
          if (readTangent) readU32();                   // skip tangent
        }
        if (isSkinned) {
          off += 16;     // joint_idx (4 shorts) + weights (4 half floats)
        }
      }

      // Indices
      const idxArr = new Uint16Array(iCount);
      const idxSize = vCount > 255 ? 2 : 1;
      if (idxSize === 2) {
        for (let i = 0; i < iCount; i++) idxArr[i] = readU16();
      } else {
        for (let i = 0; i < iCount; i++) idxArr[i] = readU8();
      }

      // Flip UV V (Irrlicht / SPM convention vs Three.js)
      if (uvs) {
        for (let i = 1; i < uvs.length; i += 2) uvs[i] = 1 - uvs[i];
      }

      groups.push({ positions, normals, uvs, colors, indices: idxArr, materialId: matId, tex1: mat.tex1, tex2: mat.tex2 });
    }
  }
  return { groups, materials };
}

// Shared fallback texture directories for STK assets. SPM materials usually
// contain bare texture filenames. Most library props keep those files beside
// the model, while a few reuse the global STK texture bank.
const _STK_TEXTURE_FALLBACKS = [
  '/stk assets/textures',
  '/stk assets/library',
];

const _STK_LIBRARY_LOCAL_TEXTURES = new Set([
  'stktex_aztekgirlbody_a.png',
  'stktex_aztekgirlface_a.png',
  'stktex_beachguyswimshort_a.png',
  'stktex_beachguyswimshort_a_mask.png',
  'stktex_beachwomenbody_a.png',
  'stktex_beachwomenbody_a_gloss.png',
  'stktex_beachwomenbody_a_mask.png',
  'stktex_beachwomeneye_a.png',
  'stklib_bird_a.jpg',
  'stklib_bird_a_glossy.jpg',
  'stklib_bird_a_nm.jpg',
  'stktex_fern_diff_a.png',
  'stklib_fitchbarrel_ao_a.png',
  'stk_gramaphone_a.png',
  'stklib_liana_diff_a.png',
  'stklib_lovelantern_heart_a.png',
  'stklib_oldlantern_ao_a.png',
  'stklib_oldlantern_glow_a.png',
  'stklib_oldlantern_lensflare_a.png',
  'stktex_generic_wooda_nm.jpg',
  'stklib_pinetree_c.png',
  'stklib_pintree_low.png',
  'stktex_treebark_c.jpg',
  'stktex_treebark_n_nm.jpg',
  'stktex_pinkribbonfabric_diff_a.png',
  'stklib_pumpkin_diff_a.png',
  'stktex_greenbrush_a.png',
  'stktex_redflower_a.png',
  'stktex_redparrot_a.png',
  'stktex_bushsagebrush_diff_a.png',
  'stktex_flowersagebrush_diff_a.png',
  'stklib_oceanlantern_glow_a.png',
  'stktex_silviangirlbody_a.png',
  'stktex_silviangirlface_a.png',
  'stklib_steamlocomotive_a.png',
  'stktex_tropicalplant_a.png',
  'stktex_tvvan_a.png',
  'stktex_tvvan_a_gloss.png',
  'stktex_wilbersecurityguy_a.png',
]);

function _prefersSharedTexture(bare) {
  const lower = String(bare).toLowerCase();
  if (_STK_LIBRARY_LOCAL_TEXTURES.has(lower)) return false;
  return /^(stk|stktex_|stkflag_|stklama_|gfx|wood_|water|blackrock|tarmac|oceanic|oasis-|junglewater|caustics|sandgrass)/i.test(bare);
}

function _appendUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function _textureNameAliases(bare, basePath) {
  const names = [bare];
  if (/\/hd_modernStreetLamp_a$/i.test(basePath) && /^texture_Lamp_a_/i.test(bare)) {
    names.push(bare.replace(/^texture_Lamp_a_/i, 'hd_modernStreetLamp_a_'));
  }
  return names;
}

function _decodeSegment(segment) {
  try { return decodeURIComponent(segment); }
  catch (_) { return segment; }
}

function _loadImageBlob(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('SPM texture image decode failed'));
    };
    img.src = objectUrl;
  });
}

function _loadTextureWithFallbacks(candidates) {
  const cacheKey = candidates.join('|');
  if (_texCache.has(cacheKey)) return _texCache.get(cacheKey);
  const t = new THREE.Texture();
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  _texCache.set(cacheKey, t);
  (async () => {
    for (const url of candidates) {
      try {
        const response = await fetch(encPath(url));
        if (!response.ok) continue;
        const img = await _loadImageBlob(await response.blob());
        t.image = img;
        t.needsUpdate = true;
        try {
          window.dispatchEvent(new CustomEvent('stk-spm-texture-loaded', { detail: { url } }));
        } catch (_) { /* non-browser */ }
        return;
      } catch (_) { /* try the next candidate silently */ }
    }
  })();
  return t;
}

function _loadTexture(url) {
  // Back-compat wrapper: try the literal URL first, then STK fallbacks.
  if (_texCache.has(url)) return _texCache.get(url);
  const basePath = url.substring(0, url.lastIndexOf('/'));
  const bare = _decodeSegment(url.substring(url.lastIndexOf('/') + 1));
  const candidates = [];
  for (const name of _textureNameAliases(bare, basePath)) {
    if (_prefersSharedTexture(name)) {
      for (const dir of _STK_TEXTURE_FALLBACKS) {
        _appendUnique(candidates, `${dir}/${name}`);
      }
      _appendUnique(candidates, `${basePath}/${name}`);
    } else {
      _appendUnique(candidates, `${basePath}/${name}`);
      for (const dir of _STK_TEXTURE_FALLBACKS) {
        _appendUnique(candidates, `${dir}/${name}`);
      }
    }
  }
  const t = _loadTextureWithFallbacks(candidates);
  _texCache.set(url, t);
  return t;
}

function _buildGroup(parsed, basePath) {
  const root = new THREE.Group();
  for (const g of parsed.groups) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(g.positions, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(g.normals,   3));
    if (g.uvs)    geo.setAttribute('uv',    new THREE.BufferAttribute(g.uvs,    2));
    if (g.colors) geo.setAttribute('color', new THREE.BufferAttribute(g.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(g.indices, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();

    const matOpts = {
      roughness: 0.85,
      metalness: 0.05,
      side: THREE.DoubleSide,
      vertexColors: !!g.colors,
    };
    if (g.tex1) {
      matOpts.map = _loadTexture(`${basePath}/${String(g.tex1).replace(/\\/g, '/')}`);
      matOpts.transparent = /\.png$/i.test(g.tex1);
      matOpts.alphaTest = matOpts.transparent ? 0.4 : 0;
    } else {
      matOpts.color = 0xc0c0c0;
    }
    const mat = new THREE.MeshStandardMaterial(matOpts);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

/**
 * Load a `.spm` mesh from a URL and cache it.
 * `path` should be an absolute browser path, e.g. "/stk assets/library/stklib_mushroom_a/stklib_mushroom_a_main.spm".
 */
export function loadStkSpm(path) {
  if (_meshCache.has(path)) return Promise.resolve(_meshCache.get(path));
  if (_pending.has(path))   return _pending.get(path);

  const basePath = path.substring(0, path.lastIndexOf('/'));
  const url = encPath(path);
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`SPM fetch failed: ${r.status} ${url}`);
    return r.arrayBuffer();
  }).then((buf) => {
    const parsed = _parseSpm(buf);
    const grp = _buildGroup(parsed, basePath);
    _meshCache.set(path, grp);
    _pending.delete(path);
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('stk-spm-loaded', { detail: { path } }));
      }
    } catch (_) { /* no-op */ }
    return grp;
  }).catch((err) => {
    _pending.delete(path);
    throw err;
  });
  _pending.set(path, p);
  return p;
}

/**
 * Returns a clone of a previously-loaded SPM mesh, or null if not yet cached.
 */
export function instanceStkSpm(path) {
  const tpl = _meshCache.get(path);
  if (!tpl) return null;
  // Deep clone — geometry/material are shared, only transforms are new.
  return tpl.clone(true);
}
