/**
 * babylon-glo.js — GLO underglow system for Babylon.js.
 * Replaces the Three.js-based glo-system.js with Babylon.js equivalents.
 *
 * Creates a radial-gradient ground plane + SpotLight beneath the player kart.
 * Supports 20+ animated colour effects chosen in the lobby.
 */

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { SpotLight } from '@babylonjs/core/Lights/spotLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';

// ── Dynamic texture (radial gradient) ─────────────────────────────────────
function makeGlowTexture(scene, size = 256) {
  const tex = new DynamicTexture('gloTex', { width: size, height: size }, scene, false);
  const ctx = tex.getContext();
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.80)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex.update();
  tex.hasAlpha = true;
  return tex;
}

// ── Hex → Color3 ─────────────────────────────────────────────────────────
function hexToColor3(hex) {
  return Color3.FromHexString(hex || '#ff0080');
}

/** Smooth blend through hex colour stops. */
function _gradColors(hexArr, t) {
  const n = hexArr.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s) % n;
  const a = Color3.FromHexString(hexArr[i]);
  const b = Color3.FromHexString(hexArr[(i + 1) % n]);
  return Color3.Lerp(a, b, s - Math.floor(s));
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create glo meshes and lights. Returns state for updateGloSystem.
 */
export function createGloSystem(scene) {
  const effect = sessionStorage.getItem('gloEffect')  || 'solid';
  const color  = sessionStorage.getItem('gloColor')   || '#ff0080';
  const color2 = sessionStorage.getItem('gloColor2')  || '#00e5ff';

  const tex = makeGlowTexture(scene, 256);

  // Large outer halo plane (flat on ground)
  const halo = MeshBuilder.CreatePlane('gloHalo', { width: 7.0, height: 7.0 }, scene);
  halo.rotation.x = Math.PI / 2; // Lie flat
  halo.renderingGroupId = 1;
  const haloMat = new StandardMaterial('gloHaloMat', scene);
  haloMat.diffuseTexture = tex;
  haloMat.emissiveColor = hexToColor3(color);
  haloMat.disableLighting = true;
  haloMat.backFaceCulling = false;
  haloMat.alpha = 0;
  haloMat.alphaMode = 1; // ALPHA_ADD
  haloMat.zOffset = -1;
  halo.material = haloMat;

  // Bright inner disc
  const disc = MeshBuilder.CreatePlane('gloDisc', { width: 2.8, height: 2.8 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.renderingGroupId = 1;
  const discMat = new StandardMaterial('gloDiscMat', scene);
  discMat.diffuseTexture = tex;
  discMat.emissiveColor = hexToColor3(color);
  discMat.disableLighting = true;
  discMat.backFaceCulling = false;
  discMat.alpha = 0;
  discMat.alphaMode = 1;
  discMat.zOffset = -2;
  disc.material = discMat;

  // Downward spot light
  const light = new SpotLight('gloSpot', Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 3.3, 2, scene);
  light.diffuse = hexToColor3(color);
  light.intensity = 6.0;
  light.range = 6;

  return {
    halo, disc, light,
    haloMat, discMat,
    time: 0,
    effect, color, color2,
  };
}

/**
 * Call every frame in the main animate() loop.
 */
export function updateGloSystem(gs, dt, carModel) {
  if (!gs) return;
  gs.time += dt;
  const t = gs.time;

  // ── Resolve colour + intensity for this frame ─────────────────────────
  let intensity = 1.0;
  const c1 = Color3.FromHexString(gs.color);
  const c2 = Color3.FromHexString(gs.color2);
  let col = c1.clone();

  switch (gs.effect) {
    case 'solid': intensity = 1.0; break;
    case 'pulse':
      intensity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'strobe':
      intensity = Math.floor(t * 12) % 2 === 0 ? 1.0 : 0.04; break;
    case 'rainbow': {
      col = Color3.FromHSV(((t * 0.18) % 1) * 360, 1, 0.55);
      intensity = 0.9; break;
    }
    case 'two-color': {
      const blend = 0.5 + 0.5 * Math.sin(t * 2.0);
      col = Color3.Lerp(c1, c2, blend);
      intensity = 0.95; break;
    }
    case 'chase': {
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 3.0));
      col = Color3.FromHSV(((t * 0.08) % 1) * 360, 1, 0.55);
      break;
    }
    case 'sunrise':
      col = _gradColors(['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10);
      intensity = 0.75 + 0.25 * Math.sin(t * 0.4); break;
    case 'sunset':
      col = _gradColors(['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8);
      intensity = 0.8 + 0.2 * Math.sin(t * 0.5); break;
    case 'sunset-glow':
      col = _gradColors(['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'spring':
      col = _gradColors(['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5)); break;
    case 'aurora':
      col = _gradColors(['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2)); break;
    case 'full-rainbow':
      col = Color3.FromHSV(((t * 0.3) % 1) * 360, 1, 0.52);
      intensity = 0.85 + 0.15 * Math.sin(t * 2.0); break;
    case 'forest':
      col = _gradColors(['#003300','#116611','#335522','#005500','#224422'], t / 12);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7)); break;
    case 'ocean':
      col = _gradColors(['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.2); break;
    case 'snowing': {
      col = _gradColors(['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4);
      const sp = Math.random() > 0.96 ? 1.45 : 1.0;
      intensity = (0.65 + 0.2 * Math.sin(t * 2.0)) * sp; break;
    }
    case 'spring-wind':
      col = _gradColors(['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5);
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2)); break;
    case 'cloudy':
      col = _gradColors(['#667788','#778899','#99aabb','#778899'], t / 20);
      intensity = 0.4 + 0.25 * Math.sin(t * 0.6); break;
    case 'firefly': {
      const fTick = Math.floor(t * 7);
      const fOn = ((fTick * 1013 + fTick * fTick * 997) % 17) < 2;
      col = fOn ? Color3.FromHexString('#ffff88') : Color3.FromHexString('#002200');
      intensity = fOn ? (1.0 + 0.4 * Math.sin(t * 45)) : 0.04; break;
    }
    case 'fire':
      col = _gradColors(['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9);
      intensity = 0.6 + 0.4 * Math.random(); break;
    case 'waterfall':
      col = _gradColors(['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0)); break;
    case 'falling-petals':
      col = _gradColors(['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5)); break;
    case 'wave':
      col = _gradColors(['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8)); break;
    case 'raining':
      col = _gradColors(['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3);
      intensity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random(); break;
    case 'falling-leaves':
      col = _gradColors(['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8)); break;
    case 'river':
      col = _gradColors(['#005566','#007788','#009999','#44aaaa','#007788'], t / 5);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.5); break;
    case 'water-drop': {
      const wPhase = (t % 1.5) / 1.5;
      intensity = Math.exp(-wPhase * 5) * 0.95 + 0.05;
      col = Color3.FromHexString('#0099ee'); break;
    }
    default: intensity = 1.0;
  }

  // ── Update material colours & opacity ─────────────────────────────────
  gs.discMat.emissiveColor = col;
  gs.discMat.alpha = 0.95 * intensity;
  gs.haloMat.emissiveColor = col;
  gs.haloMat.alpha = 0.72 * intensity;
  gs.light.diffuse = col;
  gs.light.intensity = 5.0 * intensity;

  // ── Track the kart position ───────────────────────────────────────────
  if (carModel) {
    const px = carModel.position.x;
    const pz = carModel.position.z;
    const py = Math.max(carModel.position.y - 0.4, 0.05);

    gs.halo.position.set(px, py + 0.02, pz);
    gs.disc.position.set(px, py + 0.01, pz);
    gs.light.position = new Vector3(px, py + 1.2, pz);
  }
}

/**
 * Remove glo meshes from the scene.
 */
export function disposeGloSystem(scene, gs) {
  if (!gs) return;
  [gs.halo, gs.disc].forEach(m => {
    if (m) m.dispose();
  });
  if (gs.light) gs.light.dispose();
}
