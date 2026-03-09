/**
 * glo-underglow.js — Proposal 3: ShaderMaterial Ground Decal + TrailMesh with
 * Alpha-Gradient Shader.
 *
 * Provides a unified underGLO (radial ground decal) + GLOtail (ribbon trail
 * with energy-flow shader) system that:
 *   - Syncs with the player's chosen GLO effect/color
 *   - Works for both local AND remote players
 *   - Supports configurable trail length (for future weapons integration)
 *   - Costs ~2 draw calls per kart (1 decal quad + 1 trail ribbon)
 *   - Requires NO GlowLayer — shaders handle all glow math internally
 *
 * Usage:
 *   import { createGloUnderglow, updateGloUnderglow, disposeGloUnderglow } from './glo-underglow.js';
 *   const glo = createGloUnderglow(scene, kartMesh, { effect, color, color2 });
 *   // each frame:
 *   updateGloUnderglow(glo, dt);
 *   // cleanup:
 *   disposeGloUnderglow(glo);
 */

import {
  MeshBuilder,
  Vector3,
  Color3,
  Effect,
  ShaderMaterial,
  TrailMesh,
  SpotLight,
} from "@babylonjs/core";

// ═══════════════════════════════════════════════════════════════════════════
//  SHADER SOURCE (registered once via Effect.ShadersStore)
// ═══════════════════════════════════════════════════════════════════════════

// ── underGLO accent disc shader (circular, soft radial fade) ──────────────

Effect.ShadersStore["gloDecalVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore["gloDecalFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 gloColor;
uniform float time;
uniform float intensity;

void main() {
  // CreateDisc UVs: centre = (0.5, 0.5), edge maps to radius 0.5
  vec2 c = vUV - 0.5;
  float d = length(c) * 2.0;   // 0 at centre, 1 at disc edge

  // Discard fragments outside the circle (safety — mesh is already circular)
  if (d > 1.0) discard;

  // Smooth quadratic radial falloff — strong glow at centre, invisible at edge
  float glow = 1.0 - d;
  glow *= glow;   // quadratic softness

  // Very subtle animated pulse ripple
  float pulse = 0.06 * sin(d * 12.0 - time * 2.0) * (1.0 - d);

  float a = (glow * 0.55 + pulse) * intensity;
  a = clamp(a, 0.0, 1.0);

  vec3 col = gloColor * (0.7 + glow * 0.6);
  gl_FragColor = vec4(col, a);
}
`;

// ── GLOtail ribbon shader ─────────────────────────────────────────────────

Effect.ShadersStore["gloTrailVertexShader"] = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 worldViewProjection;
varying vec2 vUV;
void main() {
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

Effect.ShadersStore["gloTrailFragmentShader"] = `
precision highp float;
varying vec2 vUV;
uniform vec3 gloColor;
uniform float time;
uniform float intensity;

void main() {
  // vUV.x: 0 at newest (head) → 1 at oldest (tail)
  float along = vUV.x;

  // Alpha fades from head to tail
  float aFade = (1.0 - along) * (1.0 - along);

  // Cross-section softness (gaussian from ribbon centre)
  float cross = vUV.y * 2.0 - 1.0; // -1..+1
  float edgeSoft = exp(-cross * cross * 4.0);

  // Animated energy flow ripple
  float flow = 0.15 * sin(along * 28.0 - time * 5.0) * (1.0 - along);

  float a = (aFade + flow) * edgeSoft * intensity;
  a = clamp(a, 0.0, 1.0);

  // Colour brightens near the head
  vec3 col = gloColor * (1.0 + (1.0 - along) * 0.5);

  gl_FragColor = vec4(col, a);
}
`;

// ═══════════════════════════════════════════════════════════════════════════
//  GLO EFFECT COLOR RESOLVER — shared between decal & trail
// ═══════════════════════════════════════════════════════════════════════════

function _hsl(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (pp, qq, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return pp + (qq - pp) * 6 * t;
      if (t < 1/2) return qq;
      if (t < 2/3) return pp + (qq - pp) * (2/3 - t) * 6;
      return pp;
    };
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

function _grad(hexArr, t) {
  const n = hexArr.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s) % n;
  const f = s - Math.floor(s);
  const a = Color3.FromHexString(hexArr[i]);
  const b = Color3.FromHexString(hexArr[(i + 1) % n]);
  return Color3.Lerp(a, b, f);
}

/**
 * Resolve GLO effect to { color: Color3, intensity: number } for the current
 * time value.  This is the single source of truth — no more duplicated switch
 * statements.
 */
export function resolveGloColor(effect, color, color2, t) {
  const c1 = Color3.FromHexString(color || '#ff0080');
  const c2 = Color3.FromHexString(color2 || '#00e5ff');
  let col = c1.clone();
  let intens = 0.85;

  switch (effect) {
    case 'solid': break;
    case 'pulse':
      intens = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'strobe':
      intens = Math.floor(t * 8) % 2 === 0 ? 1.0 : 0.1; break;
    case 'rainbow':
      col = Color3.FromArray(_hsl(((t * 60) % 360) / 360, 1, 0.5)); break;
    case 'two-color': {
      const bl = (Math.sin(t * 3) + 1) / 2;
      col = Color3.Lerp(c1, c2, bl); break;
    }
    case 'chase': {
      col = Math.floor(t * 4) % 2 === 0 ? c1 : c2; break;
    }
    case 'sunrise':
      col = _grad(['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10);
      intens = 0.75 + 0.25 * Math.sin(t * 0.4); break;
    case 'sunset':
      col = _grad(['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8);
      intens = 0.8 + 0.2 * Math.sin(t * 0.5); break;
    case 'sunset-glow':
      col = _grad(['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3);
      intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'spring':
      col = _grad(['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8);
      intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5)); break;
    case 'aurora':
      col = _grad(['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10);
      intens = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2)); break;
    case 'full-rainbow':
      col = Color3.FromArray(_hsl((t * 0.3) % 1, 1.0, 0.52));
      intens = 0.85 + 0.15 * Math.sin(t * 2.0); break;
    case 'forest':
      col = _grad(['#003300','#116611','#335522','#005500','#224422'], t / 12);
      intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7)); break;
    case 'ocean':
      col = _grad(['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8);
      intens = 0.75 + 0.25 * Math.sin(t * 1.2); break;
    case 'snowing':
      col = _grad(['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4);
      intens = (0.65 + 0.2 * Math.sin(t * 2.0)) * (Math.random() > 0.96 ? 1.45 : 1.0); break;
    case 'spring-wind':
      col = _grad(['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5);
      intens = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2)); break;
    case 'cloudy':
      col = _grad(['#667788','#778899','#99aabb','#778899'], t / 20);
      intens = 0.4 + 0.25 * Math.sin(t * 0.6); break;
    case 'firefly': {
      const fT = Math.floor(t * 7);
      const fOn = ((fT * 1013 + fT * fT * 997) % 17) < 2;
      col = fOn ? Color3.FromHexString('#ffff88') : Color3.FromHexString('#002200');
      intens = fOn ? (1.0 + 0.4 * Math.sin(t * 45)) : 0.04; break;
    }
    case 'fire':
      col = _grad(['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9);
      intens = 0.6 + 0.4 * Math.random(); break;
    case 'waterfall':
      col = _grad(['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5);
      intens = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0)); break;
    case 'falling-petals':
      col = _grad(['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6);
      intens = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5)); break;
    case 'wave':
      col = _grad(['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4);
      intens = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8)); break;
    case 'raining':
      col = _grad(['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3);
      intens = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random(); break;
    case 'falling-leaves':
      col = _grad(['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6);
      intens = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8)); break;
    case 'river':
      col = _grad(['#005566','#007788','#009999','#44aaaa','#007788'], t / 5);
      intens = 0.75 + 0.25 * Math.sin(t * 1.5); break;
    case 'water-drop': {
      const wP = (t % 1.5) / 1.5;
      col = Color3.FromHexString('#0099ee');
      intens = Math.exp(-wP * 5) * 0.95 + 0.05; break;
    }
    default: break;
  }

  return { color: col, intensity: intens };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create underGLO decal + GLOtail for a kart mesh.
 * Works for both local and remote players.
 *
 * @param {Scene}   scene
 * @param {Mesh}    kartMesh      - the root kart mesh to attach to
 * @param {object}  opts
 * @param {string}  opts.effect   - GLO effect name
 * @param {string}  opts.color    - primary hex colour
 * @param {string}  opts.color2   - secondary hex colour
 * @param {number}  opts.trailLength - ribbon history segments (default 60)
 * @param {string}  opts.id       - unique id suffix for mesh names
 * @returns {object} glo state object for updateGloUnderglow / disposeGloUnderglow
 */
export function createGloUnderglow(scene, kartMesh, opts = {}) {
  const id       = opts.id || kartMesh.name || 'local';
  const effect   = opts.effect || 'solid';
  const color    = opts.color  || '#ff0080';
  const color2   = opts.color2 || '#00e5ff';
  const trailLen = opts.trailLength || 60;

  // ── SpotLight underglow (primary — real scene illumination) ─────────────
  // A coloured SpotLight pointing straight down from the kart's underside.
  // This is how real underglow works: LEDs illuminate the ground beneath.
  // The spotlight creates a natural, circular pool of light on any surface.
  const spot = new SpotLight(
    `glo-spot-${id}`,
    new Vector3(0, 0, 0),      // position set via parent
    new Vector3(0, -1, 0),     // straight down
    Math.PI / 2.2,             // cone angle ~82° — wide spread
    2,                         // exponent — soft edge falloff
    scene,
  );
  spot.parent = kartMesh;
  spot.position.set(0, 0.1, 0);         // just above kart centre, shines down through body
  spot.diffuse  = Color3.FromHexString(color);
  spot.specular = Color3.FromHexString(color).scale(0.2);
  spot.intensity = 3.0;
  spot.range     = 6;
  // Don't illuminate the kart itself — only the ground/walls/surroundings
  spot.excludedMeshes = [kartMesh, ...kartMesh.getChildMeshes(false)];

  // ── Accent disc (secondary — subtle additive glow haze) ───────────────
  // A small circular mesh with soft radial shader. This is NOT the main effect
  // (the SpotLight is). This adds a visible "neon pool" accent beneath the kart.
  const decal = MeshBuilder.CreateDisc(`glo-decal-${id}`, { radius: 1.8, tessellation: 32 }, scene);
  decal.rotation.x = Math.PI / 2;  // lie flat on XZ plane
  decal.parent = kartMesh;
  decal.position.set(0, -0.32, 0); // just below kart body
  decal.isPickable = false;
  decal.renderingGroupId = 1;

  const decalMat = new ShaderMaterial(`glo-decal-mat-${id}`, scene, {
    vertex:   "gloDecal",
    fragment: "gloDecal",
  }, {
    attributes: ["position", "uv"],
    uniforms:   ["worldViewProjection", "gloColor", "time", "intensity"],
    needAlphaBlending: true,
  });
  decalMat.alphaMode = 1; // ALPHA_ADD
  decalMat.backFaceCulling = false;
  decalMat.setFloat("time", 0);
  decalMat.setFloat("intensity", 0.85);
  decalMat.setColor3("gloColor", Color3.FromHexString(color));
  decal.material = decalMat;

  // ── GLOtail ribbon ────────────────────────────────────────────────────
  // Pivot at the rear underside of the kart — the ribbon spawns here
  // Kart physics box is 1.8w × 0.5h × 3.2l → rear edge at z ≈ -1.6
  const pivot = MeshBuilder.CreateSphere(`glo-pivot-${id}`, { diameter: 0.01, segments: 2 }, scene);
  pivot.isPickable = false;
  pivot.isVisible  = false;
  pivot.parent     = kartMesh;
  pivot.position.set(0, -0.2, -1.5);  // rear underside of kart

  // Diameter ~1.0 = narrower than kart width so it looks like
  // it's emitted from the kart's undercarriage, not a huge slab
  const trail = new TrailMesh(`glo-trail-${id}`, pivot, scene, 1.0, trailLen, true);
  trail.isPickable = false;

  const trailMat = new ShaderMaterial(`glo-trail-mat-${id}`, scene, {
    vertex:   "gloTrail",
    fragment: "gloTrail",
  }, {
    attributes: ["position", "uv"],
    uniforms:   ["worldViewProjection", "gloColor", "time", "intensity"],
    needAlphaBlending: true,
  });
  trailMat.alphaMode = 1; // ALPHA_ADD
  trailMat.backFaceCulling = false;
  trailMat.setFloat("time", 0);
  trailMat.setFloat("intensity", 0.85);
  trailMat.setColor3("gloColor", Color3.FromHexString(color));
  trail.material = trailMat;

  // Start hidden — caller reveals at GO
  decal.isVisible = false;
  trail.isVisible = false;
  spot.setEnabled(false);

  return {
    decal, decalMat,
    trail, trailMat,
    pivot, spot,
    kartMesh,
    effect, color, color2,
    trailLength: trailLen,
    time: 0,
    visible: false,
  };
}

/**
 * Call every frame to animate the GLO system.
 *
 * @param {object} glo - state object from createGloUnderglow
 * @param {number} dt  - delta time in seconds
 */
export function updateGloUnderglow(glo, dt) {
  if (!glo || !glo.kartMesh) return;

  glo.time += dt;
  const { color, intensity } = resolveGloColor(glo.effect, glo.color, glo.color2, glo.time);

  // Update decal shader uniforms
  glo.decalMat.setFloat("time", glo.time);
  glo.decalMat.setFloat("intensity", intensity);
  glo.decalMat.setColor3("gloColor", color);

  // Update trail shader uniforms
  glo.trailMat.setFloat("time", glo.time);
  glo.trailMat.setFloat("intensity", intensity);
  glo.trailMat.setColor3("gloColor", color);

  // Update SpotLight colour + intensity
  if (glo.spot) {
    glo.spot.diffuse.copyFrom(color);
    glo.spot.specular.copyFrom(color).scaleInPlace(0.2);
    glo.spot.intensity = intensity * 3.5;
  }

  // Decal is parented to kartMesh — no world-space tracking needed.
  // It inherits the kart's position and rotation automatically.
}

/**
 * Show or hide all GLO meshes (used at matchLive vs pre-match).
 */
export function setGloVisible(glo, visible) {
  if (!glo) return;
  glo.visible = visible;
  glo.decal.isVisible = visible;
  glo.trail.isVisible = visible;
  if (glo.spot) glo.spot.setEnabled(visible);
}

/**
 * Adjust trail length at runtime (for weapons integration).
 * @param {object} glo
 * @param {number} newLength - number of ribbon segments
 */
export function setGloTrailLength(glo, newLength) {
  if (!glo || !glo.trail || newLength === glo.trailLength) return;
  // TrailMesh doesn't support dynamic length change — recreate
  const scene = glo.trail.getScene();
  const oldMat = glo.trailMat;
  glo.trail.dispose();

  const trail = new TrailMesh(`glo-trail-${glo.kartMesh.name}`, glo.pivot, scene, 1.0, newLength, true);
  trail.isPickable = false;
  trail.material = oldMat;
  trail.isVisible = glo.visible;
  glo.trail = trail;
  glo.trailLength = newLength;
}

/**
 * Dispose all GLO resources for one kart.
 */
export function disposeGloUnderglow(glo) {
  if (!glo) return;
  if (glo.trail)    { glo.trail.dispose(); }
  if (glo.decal)    { glo.decal.dispose(); }
  if (glo.pivot)    { glo.pivot.dispose(); }
  if (glo.spot)     { glo.spot.dispose(); }
  if (glo.decalMat) { glo.decalMat.dispose(); }
  if (glo.trailMat) { glo.trailMat.dispose(); }
  glo.trail = null;
  glo.decal = null;
  glo.pivot = null;
  glo.spot  = null;
  glo.decalMat = null;
  glo.trailMat = null;
}
