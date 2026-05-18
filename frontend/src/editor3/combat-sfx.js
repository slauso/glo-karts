/**
 * combat-sfx.js — tiny Web Audio one-shot player for combat events.
 *
 * Sound files live under /audio/sfx/combat/ (sourced from the v8 assets
 * SHARED/SOUNDS bank, license-cleared by the project owner). Playback
 * is fire-and-forget: each call decodes (cached after first hit) and
 * routes through a master gain so volume is consistent with the rest
 * of the kart audio rig.
 */

const SFX_BASE = '/audio/sfx/combat/';

const REGISTRY = {
  // Pickup / buff cues — the original combat-folder ogg assets were
  // never exported to /public, so map each logical name onto an
  // existing /audio/sfx/* clip that's already shipped. The '../' prefix
  // tells the loader to resolve out of /audio/sfx/combat/ → /audio/sfx/.
  pickup_get:    '../grab_collectable.ogg',
  use_buff:      '../appear.ogg',
  star_active:   '../horn.ogg',
  bullet_active: '../spaceship.ogg',
  nitro:         '../nitro.ogg',
  // Phase C/D — projectile cues sourced from /audio/sfx/* (already
  // shipped). We register them with absolute /audio/sfx/ paths so the
  // single decode/cache path serves both folders.
  shoot:         '../shoot.ogg',
  explosion:     '../explosion.ogg',
  strike:        '../strike.ogg',
  boing:         '../boing.ogg',
  metal_clang:   '../metal_clang.ogg',
  // v8 / Vigilante powerup cues — sourced from existing /audio/sfx
  // entries so no new asset conversion is required. Each maps to a
  // weapon's `sfx` key in WEAPONS (segments.js).
  v8_missile_launch: '../airplane_jetEngine.ogg',
  v8_cannon_fire:    '../crash.ogg',
  v8_rocket_fire:    '../nitro.ogg',
  v8_mortar_fire:    '../bowling_shoot.ogg',
  v8_mine_drop:      '../plopp.ogg',
  v8_dynamite_throw: '../bowling_roll.ogg',
  v8_firethrower:    '../inflate.ogg',
  // Phase 4.4 — stream weapon loops. Both stream weapons reuse a
  // looping audio cue (no new assets); client only triggers one short
  // play per fireWeapon tick to keep the cone "thrumming".
  firethrower:       '../inflate.ogg',
  glow_thrower:      '../shoot.ogg',
  v8_shield_up:      '../forcefield.ogg',
  v8_repair_use:     '../energy_bar_full.ogg',
  v8_powerup:        '../appear.ogg',
  // Phase F — surface hazard / modifier cues. All sourced from existing
  // /audio/sfx/* clips so no new audio assets are required.
  skid:              '../skid.ogg',
  swap:              '../swap.ogg',
  splash:            '../splash.ogg',
  goo:               '../goo.ogg',
  crash3:            '../crash3.ogg',
};

let _ctx = null;
let _master = null;
const _cache = new Map();   // name -> AudioBuffer
const _pending = new Map(); // name -> Promise<AudioBuffer>

function _ensureContext() {
  if (_ctx) return _ctx;
  const Ctor = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctor) return null;
  _ctx = new Ctor();
  _master = _ctx.createGain();
  _master.gain.value = 0.55;
  _master.connect(_ctx.destination);
  return _ctx;
}

function _decode(name) {
  if (_cache.has(name)) return Promise.resolve(_cache.get(name));
  if (_pending.has(name)) return _pending.get(name);
  const file = REGISTRY[name];
  if (!file) return Promise.reject(new Error(`combat-sfx: unknown sound ${name}`));
  const ctx = _ensureContext();
  if (!ctx) return Promise.reject(new Error('combat-sfx: no AudioContext'));
  const p = fetch(SFX_BASE + file)
    .then(r => r.arrayBuffer())
    .then(buf => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
    .then(audio => { _cache.set(name, audio); _pending.delete(name); return audio; })
    .catch(err => { _pending.delete(name); throw err; });
  _pending.set(name, p);
  return p;
}

/** Fire-and-forget one-shot. opts: { gain (0..1), rate (playback rate),
 *  jitter (0..1 random pitch ±jitter), loop (boolean), position ({x,y,z})
 *  for spatialised playback via PannerNode. When position is provided
 *  the cue is panned + attenuated relative to the most recent listener
 *  pose set via setListenerPose(). When loop is truthy, returns an
 *  object { stop() } that lets the caller end the loop. */
export function playCombatSfx(name, opts = {}) {
  const ctx = _ensureContext();
  if (!ctx) return null;
  // Resume on first user gesture (browser autoplay policy).
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch {} }
  let stopped = false;
  let liveSrc = null;
  const handle = opts.loop ? { stop() {
    stopped = true;
    if (liveSrc) { try { liveSrc.stop(); } catch {} liveSrc = null; }
  } } : null;
  _decode(name).then((buf) => {
    if (stopped) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Pitch jitter (P5.3) — small random rate offset so repeated cues
    // don't sound machine-perfect. Default 4% spread, opt-out via 0.
    const baseRate = opts.rate || 1.0;
    const j = (opts.jitter != null) ? opts.jitter : 0.04;
    src.playbackRate.value = baseRate * (1 + (Math.random() * 2 - 1) * j);
    src.loop = !!opts.loop;
    const g = ctx.createGain();
    g.gain.value = (opts.gain != null ? opts.gain : 0.85);
    // P5.2 — PositionalAudio. When opts.position is supplied we insert
    // a PannerNode between src and the gain so the cue is spatialised
    // around the listener (set by setListenerPose). HRTF panning is
    // expensive on Chromebooks; we use 'equalpower' + inverse distance
    // model which is cheap and "good enough" for kart combat cues.
    if (opts.position && typeof opts.position.x === 'number') {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = (opts.refDistance > 0 ? opts.refDistance : 4.0);
      panner.maxDistance = (opts.maxDistance > 0 ? opts.maxDistance : 80.0);
      panner.rolloffFactor = (opts.rolloff > 0 ? opts.rolloff : 1.0);
      try {
        if (panner.positionX) {
          panner.positionX.value = opts.position.x;
          panner.positionY.value = opts.position.y;
          panner.positionZ.value = opts.position.z;
        } else {
          panner.setPosition(opts.position.x, opts.position.y, opts.position.z);
        }
      } catch {}
      src.connect(panner).connect(g).connect(_master);
    } else {
      src.connect(g).connect(_master);
    }
    src.start();
    liveSrc = src;
  }).catch(() => {
    // P5.4 — silent fail. Missing cues should never spam the console;
    // they degrade to no-op so the game continues uninterrupted.
  });
  return handle;
}

/** P5.2 — update the AudioContext listener pose so positional cues are
 *  panned relative to the camera. Caller should invoke once per frame
 *  from the render loop. fwd / up are unit vectors. */
export function setListenerPose(position, fwd, up) {
  const ctx = _ensureContext();
  if (!ctx || !ctx.listener) return;
  const L = ctx.listener;
  try {
    if (L.positionX) {
      L.positionX.value = position.x;
      L.positionY.value = position.y;
      L.positionZ.value = position.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(position.x, position.y, position.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  } catch {}
}

/** Preload a list of sound names. */
export function preloadCombatSfx(names) {
  return Promise.allSettled((names || Object.keys(REGISTRY)).map((n) => _decode(n).catch(() => null)));
}

/** Master volume 0..1. */
export function setCombatSfxVolume(v) {
  _ensureContext();
  if (_master) _master.gain.value = Math.max(0, Math.min(1, v));
}
