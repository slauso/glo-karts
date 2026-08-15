import { getPickupIconMarkup } from './pickup-icons.js';
import { resolvePlaytestBudget, PLAYTEST_TIER } from './playtest-perf.js';

export const PICKUP_VISUALS = {
  mushroom:        { color: 0xff5577, accent: 0xffc1d2, glyph: '🍄' },
  golden_mushroom: { color: 0xffd24a, accent: 0xfff3b0, glyph: '👑' },
  star:            { color: 0xfff066, accent: 0xffffff, glyph: '★' },
  bullet_bill:     { color: 0x444855, accent: 0xa2abbd, glyph: '🚀' },
  green_shell:     { color: 0x55ff66, accent: 0xb9ffc1, glyph: '🐢' },
  red_shell:       { color: 0xff5555, accent: 0xffbeb8, glyph: '🐢' },
  blue_shell:      { color: 0x3a7bff, accent: 0xaed3ff, glyph: '🐢' },
  banana:          { color: 0xffe066, accent: 0xfff5be, glyph: '🍌' },
  bobomb:          { color: 0x222831, accent: 0x9aa7b8, glyph: '💣' },
  bowling_ball:    { color: 0x6e7788, accent: 0xc4c9d2, glyph: '🎳' },
  cake:            { color: 0xffc480, accent: 0xffe8c7, glyph: '🍰' },
  plunger:         { color: 0xe0568e, accent: 0xffbfd8, glyph: '🪠' },
  nitro:           { color: 0x66ccff, accent: 0xd2f4ff, glyph: '🧪' },
  missile:         { color: 0xff8833, accent: 0xffcfaa, glyph: '🚀' },
  bubblegum:       { color: 0xff88d8, accent: 0xffd5f1, glyph: '🫧' },
  swatter:         { color: 0xff6666, accent: 0xffd0d0, glyph: '🪰' },
  parachute:       { color: 0x99ccff, accent: 0xe3f3ff, glyph: '🪂' },
  anchor:          { color: 0x7a7f91, accent: 0xc8ceda, glyph: '⚓' },
  ludicrous_mode:  { color: 0xff66ff, accent: 0xffc7ff, glyph: '⚡' },
  shield:          { color: 0x66ccff, accent: 0xd0f5ff, glyph: '🛡' },
  coin:            { color: 0xffcc40, accent: 0xfff0b0, glyph: '🪙' },
  v8_missile:      { color: 0xc25a14, accent: 0xf0c39c, glyph: '🎯' },
  v8_cannon:       { color: 0x8a8f99, accent: 0xd4d8de, glyph: '💥' },
  v8_rocket:       { color: 0xff7a00, accent: 0xffd3aa, glyph: '🚀' },
  v8_mortar:       { color: 0x4a4a55, accent: 0xb8b8c4, glyph: '☄️' },
  v8_mine:         { color: 0x55202a, accent: 0xc9adb6, glyph: '💀' },
  v8_dynamite:     { color: 0xb04020, accent: 0xf0baa8, glyph: '🧨' },
  v8_firethrower:  { color: 0xff4400, accent: 0xffbd99, glyph: '🔥' },
  v8_shield:       { color: 0x66ccff, accent: 0xd0f5ff, glyph: '🛡' },
  v8_repair:       { color: 0x66ff99, accent: 0xd6ffe6, glyph: '💊' },
  v8_double_dmg:   { color: 0xff66cc, accent: 0xffd0ec, glyph: '✖2' },
  default:         { color: 0xcccccc, accent: 0xffffff, glyph: '❓' },
};

export function getPickupVisual(name) {
  return PICKUP_VISUALS[name] || PICKUP_VISUALS.default;
}

function _hexToCss(hex) {
  return `#${(hex >>> 0).toString(16).padStart(6, '0')}`;
}

export function stylePickupIconElement(el, name) {
  if (!el) return;
  const v = getPickupVisual(name);
  const c = _hexToCss(v.color);
  const a = _hexToCss(v.accent);
  // Hand-authored SVG silhouette (non-emoji) — color identity comes from
  // the gradient background below, not the icon itself.
  el.innerHTML = `<svg viewBox="0 0 24 24" width="64%" height="64%" style="display:block;overflow:visible;color:#fff;filter:drop-shadow(0 0 5px ${c}dd)"><g fill="currentColor">${getPickupIconMarkup(name)}</g></svg>`;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.background = `
    radial-gradient(circle at 30% 24%, ${a} 0%, ${c} 45%, #1a202a 100%),
    conic-gradient(from 90deg, ${a}55, transparent 25%, ${c}88 70%, transparent 100%)
  `;
  el.style.border = `1px solid ${a}99`;
  el.style.boxShadow = `inset 0 1px 0 ${a}66, 0 0 18px ${c}66`;
  el.style.borderRadius = '14px';
}

/** Returns raw SVG markup for a pickup (used by floaters / non-CSS hosts). */
export function buildPickupIconSvg(name, sizePx = 28) {
  const v = getPickupVisual(name);
  const c = _hexToCss(v.color);
  return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" style="display:inline-block;vertical-align:middle;overflow:visible;color:#fff;filter:drop-shadow(0 0 4px ${c}cc)"><g fill="currentColor">${getPickupIconMarkup(name)}</g></svg>`;
}

function _mkMat(THREERef, hex, emissiveMul = 0.22, metalness = 0.18, roughness = 0.36) {
  const c = new THREERef.Color(hex);
  return new THREERef.MeshStandardMaterial({
    color: c,
    emissive: c.clone().multiplyScalar(emissiveMul),
    emissiveIntensity: 1,
    metalness,
    roughness,
  });
}

// Cached device tier (LOD proxies) — resolved once per session via the
// same auto-detect/URL/forced-mode chain the playtest runtime uses, so
// world pickups, held items and projectiles all agree on device class
// without each caller re-running detection.
let _cachedTier = null;
function _autoTier() {
  if (_cachedTier == null) {
    try { _cachedTier = resolvePlaytestBudget().tier; } catch (_) { _cachedTier = PLAYTEST_TIER.HIGH; }
  }
  return _cachedTier;
}

export function buildPickupProxyModel(THREERef, name, opts = {}) {
  const {
    scale = 1,
    color = null,
    tier = _autoTier(),
  } = opts;
  const v = getPickupVisual(name);
  const baseColor = color != null ? color : v.color;
  const accentColor = v.accent;
  const root = new THREERef.Group();
  const base = _mkMat(THREERef, baseColor, 0.25, 0.2, 0.34);
  const accent = _mkMat(THREERef, accentColor, 0.18, 0.08, 0.28);
  const dark = new THREERef.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.32, roughness: 0.42 });

  // LOD — ULTRA/LOW device tiers get lighter geometry (fewer radial /
  // height segments) and drop the smallest purely-decorative sub-meshes
  // so a track full of item boxes still holds frame rate on weak
  // devices, while MED/HIGH keep the full-detail silhouette.
  const segMul = tier <= PLAYTEST_TIER.ULTRA ? 0.5 : tier === PLAYTEST_TIER.LOW ? 0.7 : 1;
  const dropMinor = tier <= PLAYTEST_TIER.ULTRA;
  const seg = (n) => (segMul === 1 ? n : Math.max(4, Math.round(n * segMul)));
  const Sphere  = (r, w, h, ...rest) => new THREERef.SphereGeometry(r, seg(w), seg(h), ...rest);
  const Cyl     = (rt, rb, h, rs, ...rest) => new THREERef.CylinderGeometry(rt, rb, h, seg(rs), ...rest);
  const Torus   = (r, t, rs, ts, ...rest) => new THREERef.TorusGeometry(r, t, seg(rs), seg(ts), ...rest);
  const Cone    = (r, h, rs, ...rest) => new THREERef.ConeGeometry(r, h, seg(rs), ...rest);
  const Capsule = (r, l, cs, rs, ...rest) => new THREERef.CapsuleGeometry(r, l, Math.max(2, Math.round(cs * segMul)), seg(rs), ...rest);

  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREERef.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  // Tiny decorative extras (finger holes, sparks, extra parachute cords)
  // that don't change silhouette identity — skipped entirely on ULTRA.
  const addMinor = (...args) => { if (!dropMinor) add(...args); };

  switch (name) {
    case 'bowling_ball': {
      add(Sphere(0.48, 28, 22), dark);
      add(Sphere(0.08, 12, 8), new THREERef.MeshStandardMaterial({ color: 0x050607 }), 0.14, 0.13, 0.39);
      addMinor(Sphere(0.07, 12, 8), new THREERef.MeshStandardMaterial({ color: 0x050607 }), 0.03, 0.23, 0.38);
      addMinor(Sphere(0.07, 12, 8), new THREERef.MeshStandardMaterial({ color: 0x050607 }), 0.22, 0.23, 0.30);
      break;
    }
    case 'cake': {
      add(Cyl(0.42, 0.42, 0.32, 24), accent, 0, -0.04, 0);
      add(Cyl(0.45, 0.45, 0.18, 24), base, 0, 0.18, 0);
      add(Sphere(0.08, 12, 8), _mkMat(THREERef, 0xff335e, 0.2), 0, 0.34, 0.14);
      break;
    }
    case 'plunger': {
      add(Cyl(0.07, 0.07, 0.72, 14), _mkMat(THREERef, 0x9a6a36, 0.08), 0, 0.14, 0);
      add(Cyl(0.24, 0.32, 0.22, 20), base, 0, -0.24, 0);
      add(Torus(0.22, 0.05, 10, 18), accent, 0, -0.14, 0, Math.PI / 2);
      break;
    }
    case 'nitro': {
      add(Cyl(0.24, 0.24, 0.62, 16), base);
      add(Cyl(0.16, 0.16, 0.12, 12), accent, 0, 0.36, 0);
      add(Torus(0.25, 0.02, 8, 24), _mkMat(THREERef, 0xffffff, 0), 0, 0.06, 0, Math.PI / 2);
      break;
    }
    case 'missile':
    case 'v8_missile':
    case 'v8_rocket': {
      add(Capsule(0.16, 0.68, 6, 16), base, 0, 0.02, 0, Math.PI / 2, 0, 0);
      add(Cone(0.16, 0.24, 14), accent, 0.42, 0.02, 0, 0, 0, -Math.PI / 2);
      add(new THREERef.BoxGeometry(0.14, 0.03, 0.28), accent, -0.18, 0.13, 0);
      add(new THREERef.BoxGeometry(0.14, 0.03, 0.28), accent, -0.18, -0.13, 0);
      break;
    }
    case 'bubblegum': {
      add(Sphere(0.42, 24, 18), base);
      add(Torus(0.28, 0.06, 10, 20), accent, 0, 0.06, 0, Math.PI / 5, Math.PI / 6, 0);
      break;
    }
    case 'swatter': {
      add(new THREERef.BoxGeometry(0.48, 0.34, 0.06), base, 0, 0.12, 0);
      add(new THREERef.BoxGeometry(0.10, 0.64, 0.08), _mkMat(THREERef, 0x2c2f38, 0.1), 0, -0.28, 0);
      add(new THREERef.RingGeometry(0.10, 0.14, 10), accent, 0.18, 0.12, 0.031);
      break;
    }
    case 'parachute': {
      add(Sphere(0.42, 22, 16, 0, Math.PI * 2, 0, Math.PI / 2), accent, 0, 0.20, 0);
      add(new THREERef.BoxGeometry(0.26, 0.16, 0.18), base, 0, -0.20, 0);
      add(Cyl(0.01, 0.01, 0.42, 6), _mkMat(THREERef, 0xffffff, 0), -0.18, 0.02, -0.08);
      add(Cyl(0.01, 0.01, 0.42, 6), _mkMat(THREERef, 0xffffff, 0), 0.18, 0.02, -0.08);
      addMinor(Cyl(0.01, 0.01, 0.42, 6), _mkMat(THREERef, 0xffffff, 0), -0.18, 0.02, 0.08);
      addMinor(Cyl(0.01, 0.01, 0.42, 6), _mkMat(THREERef, 0xffffff, 0), 0.18, 0.02, 0.08);
      break;
    }
    case 'anchor': {
      add(Cyl(0.05, 0.05, 0.62, 12), base, 0, 0.02, 0);
      add(Torus(0.14, 0.04, 10, 20), accent, 0, 0.38, 0, Math.PI / 2);
      add(new THREERef.BoxGeometry(0.35, 0.05, 0.05), base, 0, -0.12, 0);
      add(Cone(0.08, 0.18, 10), base, -0.18, -0.28, 0, 0, 0, Math.PI / 4);
      add(Cone(0.08, 0.18, 10), base, 0.18, -0.28, 0, 0, 0, -Math.PI / 4);
      break;
    }
    case 'ludicrous_mode': {
      add(new THREERef.OctahedronGeometry(0.34, 0), base);
      add(Torus(0.30, 0.05, 10, 24), accent);
      add(Torus(0.30, 0.05, 10, 24), accent, 0, 0, 0, Math.PI / 2);
      break;
    }
    case 'shield':
    case 'v8_shield': {
      add(Torus(0.30, 0.08, 14, 26), base);
      add(Sphere(0.14, 14, 12), accent);
      break;
    }
    case 'mushroom':
    case 'golden_mushroom': {
      add(Sphere(0.34, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.56), base, 0, 0.12, 0);
      add(Cyl(0.11, 0.16, 0.30, 12), accent, 0, -0.12, 0);
      break;
    }
    case 'banana': {
      add(Capsule(0.12, 0.42, 6, 12), base, 0, 0, 0, 0.4, 0, 0.2);
      add(Cone(0.04, 0.10, 8), _mkMat(THREERef, 0x65411c, 0), 0.22, 0.19, 0.06);
      break;
    }
    case 'bobomb': {
      add(Sphere(0.34, 20, 16), dark);
      add(Cyl(0.05, 0.05, 0.14, 8), accent, 0, 0.30, 0);
      addMinor(Sphere(0.07, 12, 8), _mkMat(THREERef, 0xffc63b, 0.3), 0, 0.40, 0);
      break;
    }
    default: {
      add(new THREERef.IcosahedronGeometry(0.38, dropMinor ? 0 : 1), base);
      add(Torus(0.28, 0.05, 10, 20), accent, 0, 0.02, 0, Math.PI / 2);
      break;
    }
  }

  root.scale.setScalar(scale);
  return root;
}
