/**
 * glo-system.js – GLO underglow for the Three.js single-player / PeerJS game.
 *
 * Reads gloEffect / gloColor / gloColor2 from sessionStorage (written by the
 * lobby) and creates a soft radial-gradient underglow beneath the player's kart.
 * The glow tracks the kart position every frame with zero allocation overhead.
 *
 * Usage:
 *   import { createGloSystem, updateGloSystem } from './modules/glo-system.js';
 *   const gloState = createGloSystem(scene);
 *   // after car model is ready:
 *   // in animate(): updateGloSystem(gloState, dt, carModel);
 */

import * as THREE from 'three';

// ── Canvas radial-gradient texture ──────────────────────────────────────────
function makeGlowTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.80)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ── Hex → THREE.Color ────────────────────────────────────────────────────────
function hexToColor(hex) {
  return new THREE.Color(hex || '#ff0080');
}
/**
 * Smoothly blend through an array of hex colour stops.
 * @param {string[]} hexArr  - colour stops (loops back to first)
 * @param {number}   t       - normalised time in [0, 1)  —  use elapsed / period
 */
function _gradColors(hexArr, t) {
  const n = hexArr.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s) % n;
  const a = new THREE.Color(hexArr[i]);
  const b = new THREE.Color(hexArr[(i + 1) % n]);
  return a.lerp(b, s - Math.floor(s));
}
// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Create all glo meshes and add them to the scene.
 * Returns a state object to pass into updateGloSystem each frame.
 */
export function createGloSystem(scene) {
  const effect = sessionStorage.getItem('gloEffect')  || 'solid';
  const color  = sessionStorage.getItem('gloColor')   || '#ff0080';
  const color2 = sessionStorage.getItem('gloColor2')  || '#00e5ff';

  const tex = makeGlowTexture(256);

  // Large outer halo
  const haloGeo = new THREE.PlaneGeometry(7.0, 7.0);
  const haloMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: hexToColor(color),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 1;
  scene.add(halo);

  // Bright inner pool
  const discGeo = new THREE.PlaneGeometry(2.8, 2.8);
  const discMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: hexToColor(color),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 2;
  scene.add(disc);

  // Downward spot light — illuminates track surface only, never shines upward.
  // Angle: 55° cone  |  penumbra: 0.55 (soft edge)  |  range: 6 world-units
  const light = new THREE.SpotLight(hexToColor(color), 6.0, 6, Math.PI / 3.3, 0.55, 2);
  light.position.set(0, 0, 0);   // will be moved each frame
  // SpotLight needs an explicit target object in the scene to define its direction
  const lightTarget = new THREE.Object3D();
  scene.add(lightTarget);
  light.target = lightTarget;
  scene.add(light);

  return {
    halo, disc, light, lightTarget,
    time: 0,
    effect, color, color2,
  };
}

/**
 * Call every frame in the main animate() loop.
 * @param {object} gs     - state returned by createGloSystem
 * @param {number} dt     - delta time in seconds
 * @param {THREE.Object3D|null} carModel - the player's car mesh (may be null during load)
 */
export function updateGloSystem(gs, dt, carModel) {
  if (!gs) return;

  gs.time += dt;
  const t = gs.time;

  // ── Resolve colour + intensity for this frame ────────────────────────────
  let intensity = 1.0;
  const c1  = new THREE.Color(gs.color);
  const c2  = new THREE.Color(gs.color2);
  let   col = c1.clone();

  switch (gs.effect) {
    case 'solid':
      intensity = 1.0;
      break;
    case 'pulse':
      intensity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.5));
      break;
    case 'strobe':
      intensity = Math.floor(t * 12) % 2 === 0 ? 1.0 : 0.04;
      break;
    case 'rainbow': {
      const hue = (t * 0.18) % 1;
      col.setHSL(hue, 1, 0.55);
      intensity = 0.9;
      break;
    }
    case 'two-color': {
      const blend = 0.5 + 0.5 * Math.sin(t * 2.0);
      col.lerpColors(c1, c2, blend);
      intensity = 0.95;
      break;
    }
    case 'chase': {
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 3.0));
      col.setHSL((t * 0.08) % 1, 1, 0.55);
      break;
    }

    // ── Themed scene effects ──────────────────────────────────────────────
    case 'sunrise': {
      col = _gradColors(['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10);
      intensity = 0.75 + 0.25 * Math.sin(t * 0.4);
      break;
    }
    case 'sunset': {
      col = _gradColors(['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8);
      intensity = 0.8 + 0.2 * Math.sin(t * 0.5);
      break;
    }
    case 'sunset-glow': {
      col = _gradColors(['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5));
      break;
    }
    case 'spring': {
      col = _gradColors(['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5));
      break;
    }
    case 'aurora': {
      col = _gradColors(['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2));
      break;
    }
    case 'full-rainbow': {
      col.setHSL((t * 0.3) % 1, 1.0, 0.52);
      intensity = 0.85 + 0.15 * Math.sin(t * 2.0);
      break;
    }
    case 'forest': {
      col = _gradColors(['#003300','#116611','#335522','#005500','#224422'], t / 12);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7));
      break;
    }
    case 'ocean': {
      col = _gradColors(['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.2);
      break;
    }
    case 'snowing': {
      col = _gradColors(['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4);
      const sSpark = Math.random() > 0.96 ? 1.45 : 1.0;
      intensity = (0.65 + 0.2 * Math.sin(t * 2.0)) * sSpark;
      break;
    }
    case 'spring-wind': {
      col = _gradColors(['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5);
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2));
      break;
    }
    case 'cloudy': {
      col = _gradColors(['#667788','#778899','#99aabb','#778899'], t / 20);
      intensity = 0.4 + 0.25 * Math.sin(t * 0.6);
      break;
    }
    case 'firefly': {
      const fTick = Math.floor(t * 7);
      const fOn   = ((fTick * 1013 + fTick * fTick * 997) % 17) < 2;
      col       = fOn ? new THREE.Color('#ffff88') : new THREE.Color('#002200');
      intensity = fOn ? (1.0 + 0.4 * Math.sin(t * 45)) : 0.04;
      break;
    }
    case 'fire': {
      col = _gradColors(['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9);
      intensity = 0.6 + 0.4 * Math.random();
      break;
    }
    case 'waterfall': {
      col = _gradColors(['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0));
      break;
    }
    case 'falling-petals': {
      col = _gradColors(['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5));
      break;
    }
    case 'wave': {
      col = _gradColors(['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8));
      break;
    }
    case 'raining': {
      col = _gradColors(['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3);
      intensity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random();
      break;
    }
    case 'falling-leaves': {
      col = _gradColors(['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8));
      break;
    }
    case 'river': {
      col = _gradColors(['#005566','#007788','#009999','#44aaaa','#007788'], t / 5);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.5);
      break;
    }
    case 'water-drop': {
      const wPhase = (t % 1.5) / 1.5;
      intensity = Math.exp(-wPhase * 5) * 0.95 + 0.05;
      col = new THREE.Color('#0099ee');
      break;
    }

    default:
      intensity = 1.0;
  }

  // ── Update material colours & opacity ────────────────────────────────────
  gs.disc.material.color.copy(col);
  gs.disc.material.opacity  = 0.95 * intensity;

  gs.halo.material.color.copy(col);
  gs.halo.material.opacity  = 0.72 * intensity;

  gs.light.color.copy(col);
  gs.light.intensity = 5.0 * intensity;

  // ── Track the kart – position glow just below the car ───────────────────
  if (carModel) {
    const px = carModel.position.x;
    const pz = carModel.position.z;
    // Sit planes ~40 cm below the car's base; clamp to not go underground
    const py = Math.max(carModel.position.y - 0.4, 0.05);

    gs.halo.position.set(px, py + 0.02, pz);
    gs.disc.position.set(px, py + 0.01, pz);

    // SpotLight: position 1.2 units above ground plane, aim exactly at ground
    gs.light.position.set(px, py + 1.2, pz);
    gs.lightTarget.position.set(px, py - 0.1, pz);
    gs.lightTarget.updateMatrixWorld();
  }
}

/**
 * Remove glo meshes from the scene (call on game teardown).
 */
export function disposeGloSystem(scene, gs) {
  if (!gs) return;
  [gs.halo, gs.disc].forEach(m => {
    scene.remove(m);
    m.geometry.dispose();
    m.material.map?.dispose();
    m.material.dispose();
  });
  scene.remove(gs.light);
  if (gs.lightTarget) scene.remove(gs.lightTarget);
}
