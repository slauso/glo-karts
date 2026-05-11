// GLO KARTS — shared underglow runtime
// ------------------------------------------------------------
// Single source of truth for the "Pick Your GLO" customization
// pipeline. The lobby (lobby-car.js) writes the user's choice
// into sessionStorage; every play-mode scene reads it from here
// and renders the same effect under the kart.
//
// Responsibilities split:
//   • getStoredGlo()        — sessionStorage → { gloEffect, gloColor, gloColor2 }
//   • computeGloLook()      — pure function: (t, state) → { color, intensity }
//                              shared by the lobby preview AND every play-scene
//                              underglow so a new effect added here lights up
//                              everywhere.
//   • createKartUnderglow() — turnkey THREE.js underglow rig (halo + disc +
//                              point light) that follows a moving kart anchor.
//                              Intended for play scenes (editor3 playtest,
//                              realtime, etc.). The lobby keeps its bespoke
//                              meshes/sparkles/pulse-ring for legacy reasons
//                              and just imports computeGloLook.
// ------------------------------------------------------------

export const DEFAULT_GLO_EFFECT = 'solid';
export const DEFAULT_GLO_COLOR  = '#ff0080';
export const DEFAULT_GLO_COLOR2 = '#00e5ff';

export function getStoredGlo() {
  let gloEffect = DEFAULT_GLO_EFFECT;
  let gloColor  = DEFAULT_GLO_COLOR;
  let gloColor2 = DEFAULT_GLO_COLOR2;
  try {
    gloEffect = sessionStorage.getItem('gloEffect') || DEFAULT_GLO_EFFECT;
    gloColor  = sessionStorage.getItem('gloColor')  || DEFAULT_GLO_COLOR;
    gloColor2 = sessionStorage.getItem('gloColor2') || DEFAULT_GLO_COLOR2;
  } catch { /* sessionStorage may be blocked in some embeds */ }
  // 'two-color' is a legacy id that was renamed; degrade gracefully.
  if (gloEffect === 'two-color') gloEffect = 'solid';
  return { gloEffect, gloColor, gloColor2 };
}

// Smoothly blend through an array of hex colour stops. Mutates and returns
// the supplied scratch THREE.Color so callers avoid per-frame allocation.
function _gradInto(THREE, hexArr, t, out) {
  const n = hexArr.length;
  const s = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(s) % n;
  const a = _scratchA(THREE).set(hexArr[i]);
  const b = _scratchB(THREE).set(hexArr[(i + 1) % n]);
  out.copy(a).lerp(b, s - Math.floor(s));
  return out;
}

let _scratchAColor = null, _scratchBColor = null;
function _scratchA(THREE) { return _scratchAColor || (_scratchAColor = new THREE.Color()); }
function _scratchB(THREE) { return _scratchBColor || (_scratchBColor = new THREE.Color()); }

/**
 * Pure: derive the current underglow colour and intensity for a given effect.
 * @param {*} THREE        - bring-your-own three.js handle (avoids hard import)
 * @param {number} t       - elapsed seconds
 * @param {{gloEffect:string,gloColor:string,gloColor2:string}} state
 * @param {THREE.Color} out- scratch colour, mutated in place
 * @returns {{color: THREE.Color, intensity: number}}
 */
export function computeGloLook(THREE, t, state, out) {
  const c1 = _scratchA(THREE).set(state.gloColor || DEFAULT_GLO_COLOR);
  const c2 = _scratchB(THREE).set(state.gloColor2 || DEFAULT_GLO_COLOR2);
  out.copy(c1);
  let intensity = 1;

  switch (state.gloEffect) {
    case 'solid':
      intensity = 1; break;
    case 'pulse':
      intensity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'strobe':
      intensity = Math.floor(t * 12) % 2 === 0 ? 1 : 0.05; break;
    case 'rainbow': {
      const hue = (t * 0.18) % 1;
      out.setHSL(hue, 1, 0.55);
      intensity = 0.85; break;
    }
    case 'chase': {
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 3));
      const hue2 = (t * 0.08) % 1;
      out.setHSL(hue2, 1, 0.55); break;
    }

    // ── Themed scene effects ───────────────────────────────────
    case 'sunrise':
      _gradInto(THREE, ['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10, out);
      intensity = 0.75 + 0.25 * Math.sin(t * 0.4); break;
    case 'sunset':
      _gradInto(THREE, ['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8, out);
      intensity = 0.8 + 0.2 * Math.sin(t * 0.5); break;
    case 'sunset-glow':
      _gradInto(THREE, ['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3, out);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5)); break;
    case 'spring':
      _gradInto(THREE, ['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8, out);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5)); break;
    case 'aurora':
      _gradInto(THREE, ['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10, out);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2)); break;
    case 'full-rainbow':
      out.setHSL((t * 0.3) % 1, 1.0, 0.52);
      intensity = 0.85 + 0.15 * Math.sin(t * 2.0); break;
    case 'forest':
      _gradInto(THREE, ['#003300','#116611','#335522','#005500','#224422'], t / 12, out);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7)); break;
    case 'ocean':
      _gradInto(THREE, ['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8, out);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.2); break;
    case 'snowing': {
      _gradInto(THREE, ['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4, out);
      const spark = Math.random() > 0.96 ? 1.45 : 1.0;
      intensity = (0.65 + 0.2 * Math.sin(t * 2.0)) * spark; break;
    }
    case 'spring-wind':
      _gradInto(THREE, ['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5, out);
      intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2)); break;
    case 'cloudy':
      _gradInto(THREE, ['#667788','#778899','#99aabb','#778899'], t / 20, out);
      intensity = 0.4 + 0.25 * Math.sin(t * 0.6); break;
    case 'firefly': {
      const fTick = Math.floor(t * 7);
      const fOn   = ((fTick * 1013 + fTick * fTick * 997) % 17) < 2;
      out.set(fOn ? '#ffff88' : '#002200');
      intensity = fOn ? (1.0 + 0.4 * Math.sin(t * 45)) : 0.04; break;
    }
    case 'fire':
      _gradInto(THREE, ['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9, out);
      intensity = 0.6 + 0.4 * Math.random(); break;
    case 'waterfall':
      _gradInto(THREE, ['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5, out);
      intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0)); break;
    case 'falling-petals':
      _gradInto(THREE, ['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6, out);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5)); break;
    case 'wave':
      _gradInto(THREE, ['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4, out);
      intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8)); break;
    case 'raining':
      _gradInto(THREE, ['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3, out);
      intensity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random(); break;
    case 'falling-leaves':
      _gradInto(THREE, ['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6, out);
      intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8)); break;
    case 'river':
      _gradInto(THREE, ['#005566','#007788','#009999','#44aaaa','#007788'], t / 5, out);
      intensity = 0.75 + 0.25 * Math.sin(t * 1.5); break;
    case 'water-drop': {
      const wPhase = (t % 1.5) / 1.5;
      intensity = Math.exp(-wPhase * 5) * 0.95 + 0.05;
      out.set('#0099ee'); break;
    }
    default:
      intensity = 1; break;
  }
  return { color: out, intensity };
}

// Soft white-to-transparent radial sprite — single CanvasTexture shared across
// all underglow rigs for cheapness; planes tint via material.color.
let _sharedGlowTex = null;
function _glowTexture(THREE) {
  if (_sharedGlowTex) return _sharedGlowTex;
  const size = 256;
  const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!canvas) return null;
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
  _sharedGlowTex = new THREE.CanvasTexture(canvas);
  return _sharedGlowTex;
}

/**
 * Build a kart underglow rig (inner disc + outer halo + soft point light)
 * scoped to any THREE scene. The rig is *not* parented to the kart group —
 * it stays world-axis-aligned (always flat against the ground) and the
 * caller drives its world position via the `anchor` argument to update().
 *
 * @param {*} THREE                  - three.js handle
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @param {number} [opts.innerRadius=1.2]   inner bright disc radius (world units)
 * @param {number} [opts.haloRadius=3.25]   outer soft halo radius
 * @param {number} [opts.groundOffsetY=0.45] distance below the kart anchor
 *                                           where the disc is rendered (so
 *                                           the underglow sits flush with
 *                                           the ground beneath the chassis,
 *                                           even on hills/banks). Pass the
 *                                           kart's chassis half-height plus
 *                                           a small bias.
 * @param {number} [opts.lightRange=4.5]    spot-light falloff range
 * @param {boolean}[opts.castLight=true]    spawn an upward-aimed coloured
 *                                          SpotLight (skip for low-perf
 *                                          budgets — pure additive disc only)
 */
export function createKartUnderglow(THREE, scene, opts = {}) {
  const innerRadius   = opts.innerRadius   ?? 1.2;
  const haloRadius    = opts.haloRadius    ?? 3.25;
  const groundOffsetY = opts.groundOffsetY ?? 0.45;
  const lightRange    = opts.lightRange    ?? 4.5;
  const castLight     = opts.castLight     ?? true;

  let state = opts.initialState ? { ...opts.initialState } : getStoredGlo();
  // When `opts.followStorage` is false (default when initialState is
  // supplied), the rig ignores global `gloChanged` events and uses
  // whatever the caller set via setState() — lets multiplayer drive a
  // distinct GLO per remote ghost.
  const followStorage = opts.followStorage ?? !opts.initialState;
  const onGloChanged = () => { if (followStorage) state = getStoredGlo(); };
  if (typeof document !== 'undefined' && followStorage) {
    document.addEventListener('gloChanged', onGloChanged);
  }

  const tex = _glowTexture(THREE);

  // ── Ground "spill" pool ────────────────────────────────────────
  // Two stacked planes laid flat on the ground:
  //   • haloMesh  — wide, low-opacity falloff that bleeds outward
  //   • discMesh  — tighter, brighter core pinned directly under the kart
  //
  // Both use additive blending against the track, but `depthTest: true`
  // so the kart's chassis depth occludes them — that's what stops the
  // "decal showing through the model" look. `polygonOffset: -4` lifts the
  // texels a hair toward the camera in z so they don't z-fight with the
  // road decking, while `depthWrite: false` lets the kart and other
  // transparent FX (smoke/exhaust) sort cleanly on top.
  const _flatMatOpts = {
    map: tex,
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  };

  const haloGeo = new THREE.PlaneGeometry(haloRadius * 2, haloRadius * 2);
  const haloMat = new THREE.MeshBasicMaterial(_flatMatOpts);
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.rotation.x = -Math.PI / 2;
  halo.frustumCulled = true;
  halo.renderOrder = 1;
  scene.add(halo);

  const discGeo = new THREE.PlaneGeometry(innerRadius * 2, innerRadius * 2);
  const discMat = new THREE.MeshBasicMaterial(_flatMatOpts);
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.renderOrder = 2;
  scene.add(disc);

  // ── Underbelly fill light ──────────────────────────────────────
  // An upward-aimed SpotLight from below the kart with a wide cone — only
  // the chassis underbelly catches it, so the body never glows uniformly
  // red the way an omnidirectional PointLight would. The cone hits the
  // floor pan, wheel wells, and a sliver of the bumper undersides; from
  // outside the kart you see a hot lip of GLO colour wrapping the chassis
  // edge instead of the entire body washing in colour. Cheap (single
  // shadow-less spot) and reads as physically motivated reflected light.
  let light = null;
  let lightTarget = null;
  if (castLight) {
    light = new THREE.SpotLight(0xffffff, 0, lightRange, Math.PI / 2.6, 0.85, 1.6);
    light.castShadow = false;
    lightTarget = new THREE.Object3D();
    scene.add(lightTarget);
    light.target = lightTarget;
    scene.add(light);
  }

  let elapsed = 0;
  let enabled = true;
  let disposed = false;
  const _color = new THREE.Color();
  // Persistent state for the visual-fidelity passes (motion-stretch + flicker).
  let _lastX = null, _lastZ = null;     // previous anchor position for velocity inference
  let _smSpeedK = 0;                     // smoothed speed factor (0..1) — drives stretch
  let _smDir = 0;                        // smoothed direction angle for stretch alignment
  // External intensity multiplier so callers (e.g. burnout charge meter)
  // can momentarily overdrive the rig without rewriting the effect.
  // Smoothed internally so a sudden 1 → 3 ramp eases visually.
  let _intensityBoostTarget = 1;
  let _intensityBoostSm = 1;

  function update(dt, anchor) {
    if (disposed) return;
    elapsed += dt;
    if (!enabled) return;

    const { color, intensity } = computeGloLook(THREE, elapsed, state, _color);

    // ── Multi-octave flicker ───────────────────────────────────
    // Two interfering sines + a high-frequency wobble give the glow a
    // living, candle-like jitter without the perf cost of noise tables.
    // Amplitude is small (±~9%) so themed effects (Strobe, Pulse) still
    // dominate the visual rhythm.
    const flicker = 1
      + 0.06 * Math.sin(elapsed * 7.3) * Math.sin(elapsed * 13.1)
      + 0.03 * Math.sin(elapsed * 31.0);
    // Ease the external boost toward its target so callers can poke it
    // without snapping the visual.
    _intensityBoostSm += (_intensityBoostTarget - _intensityBoostSm) * Math.min(1, dt * 8);
    const i = Math.max(0, intensity * flicker * _intensityBoostSm);

    // Subtle pool — the play scene is dark and the kart should remain the
    // visual focus, so the disc/halo are kept dim. Tune up via opts if a
    // brighter readout is needed (e.g. lobby preview uses 0.95/0.78).
    // Levels reduced 10% from previous (0.32/0.18/1.2 → 0.288/0.162/1.08)
    // per request to dim the underglow.
    discMat.color.copy(color);
    discMat.opacity = 0.288 * i;
    haloMat.color.copy(color);
    haloMat.opacity = 0.162 * i;
    if (light) {
      light.color.copy(color);
      // Soft underbelly fill — just enough to catch a coloured rim on the
      // chassis bottom without lighting the canopy/driver.
      light.intensity = 1.08 * i;
    }

    // Follow the kart's horizontal position — keep the disc flat regardless
    // of chassis pitch/roll/yaw so the player always sees a clean pool of
    // light pinned to the ground beneath them.
    if (anchor) {
      // anchor may be an Object3D, a Vector3-like, or a Body-like { position }
      let x = 0, y = 0, z = 0;
      if (anchor.isObject3D)        { x = anchor.position.x; y = anchor.position.y; z = anchor.position.z; }
      else if (anchor.position)     { x = anchor.position.x; y = anchor.position.y; z = anchor.position.z; }
      else                          { x = anchor.x ?? 0; y = anchor.y ?? 0; z = anchor.z ?? 0; }

      // ── Velocity-aligned anisotropic stretch ─────────────────
      // Infer per-frame velocity from anchor delta (cheaper than pulling
      // a body reference and avoids units conversion). Smooth the speed
      // factor and direction so a single jittery frame doesn't snap the
      // disc orientation. At rest the rig is perfectly round; under motion
      // it elongates along travel and squeezes laterally — sells the glow
      // as a real volume of light dragging across the ground.
      if (_lastX !== null) {
        const stepDt = Math.max(dt, 1e-4);
        const vx = (x - _lastX) / stepDt;
        const vz = (z - _lastZ) / stepDt;
        const speed = Math.hypot(vx, vz);
        // Stretch ramps to full at ~40 m/s (≈ top speed).
        const targetK = Math.min(1, speed / 40000); // world units = mm
        // Critically-damped lerp so stretch eases in/out without overshoot.
        _smSpeedK += (targetK - _smSpeedK) * Math.min(1, dt * 6);
        if (speed > 30) {
          // Only update direction when actually moving — avoids spin at rest.
          const targetDir = Math.atan2(vx, vz);
          // Wrap-aware shortest-arc lerp.
          let d = targetDir - _smDir;
          while (d >  Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          _smDir += d * Math.min(1, dt * 8);
        }
      }
      _lastX = x; _lastZ = z;
      // Stretch up to +60% along travel, squeeze 18% across.
      const along  = 1 + 0.60 * _smSpeedK;
      const across = 1 - 0.18 * _smSpeedK;

      const groundY = y - groundOffsetY;
      // Halo flush with ground; inner disc lifted a hair so the two planes
      // sort cleanly without z-fighting.
      halo.position.set(x, groundY, z);
      disc.position.set(x, groundY + innerRadius * 0.02, z);
      // Plane was rotated -π/2 around X, so local-Z is world-Y; setting
      // rotation.z yaws the disc in the ground plane. Apply stretch via
      // local X (lateral) / Y (forward).
      halo.rotation.z = -_smDir;
      disc.rotation.z = -_smDir;
      halo.scale.set(across, along, 1);
      disc.scale.set(across, along, 1);

      if (light && lightTarget) {
        // Place the source ON the ground pointing UP at the chassis center
        // so the cone fills the underbelly and falls off before reaching
        // the canopy.
        light.position.set(x, groundY + innerRadius * 0.05, z);
        lightTarget.position.set(x, y, z);
      }
    }
  }

  function setEnabled(v) {
    enabled = !!v;
    halo.visible = enabled;
    disc.visible = enabled;
    if (light) light.visible = enabled;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (typeof document !== 'undefined' && followStorage) {
      document.removeEventListener('gloChanged', onGloChanged);
    }
    scene.remove(halo); scene.remove(disc);
    haloGeo.dispose(); haloMat.dispose();
    discGeo.dispose(); discMat.dispose();
    if (light) scene.remove(light);
    if (lightTarget) scene.remove(lightTarget);
  }

  return { update, setEnabled, dispose,
    setIntensityBoost(mult) { _intensityBoostTarget = Math.max(0, mult || 0); },
    setState(next) {
      if (!next) return;
      state = {
        gloEffect: next.gloEffect || state.gloEffect,
        gloColor: next.gloColor || state.gloColor,
        gloColor2: next.gloColor2 || state.gloColor2,
      };
    },
    get state() { return state; }, get currentColor() { return _color; } };
}
