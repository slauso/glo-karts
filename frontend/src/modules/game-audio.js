/**
 * game-audio.js — Lightweight cross-engine audio manager
 *
 * Works with BOTH Three.js (main.js / battle-main.js) and Babylon.js
 * (colyseus-babylon-client.js) by using the raw Web Audio API underneath.
 *
 * Features:
 *   - Background music with per-track mapping
 *   - 2D SFX (UI, weapons, countdown, race events)
 *   - Looping engine sound with speed-reactive pitch
 *   - Drift / boost / nitro audio cues
 *   - Volume controls & mute toggle
 *   - Audio context auto-unlock on first interaction
 */

// ── Track → Music mapping ────────────────────────────────────────────────────
// Custom race pool (music 2 folder – 12 tracks)
const CUSTOM_RACE_POOL = Array.from({ length: 12 }, (_, i) => `music 2/race music ${i + 1}.mp3`);

const TRACK_MUSIC = {
  test_box:           CUSTOM_RACE_POOL[0],
  glo_arena:          CUSTOM_RACE_POOL[1],
  custom_import:      CUSTOM_RACE_POOL[2],
};

// ── SFX catalogue (keyed by event name) ───────────────────────────────────
const SFX = {
  // Race events
  countdown_tick:   "pre_start_race.ogg",
  countdown_go:     "start_race.ogg",
  race_finish:      "race_finish.ogg",
  race_win:         "race_finish_victory.ogg",
  last_lap:         "last_lap_fanfare.ogg",
  // Driving
  skid:             "skid.ogg",
  jump:             "jump.ogg",
  crash:            "crash.ogg",
  crash2:           "crash2.ogg",
  crash3:           "crash3.ogg",
  // Weapons
  shoot:            "shoot.ogg",
  pickup:           "grab_collectable.ogg",
  explosion:        "explosion.ogg",
  bowling_roll:     "bowling_roll.ogg",
  bowling_shoot:    "bowling_shoot.ogg",
  bubblegum_pop:    "bubblegum_explode.ogg",
  plunger:          "plunger.ogg",
  swatter:          "swatter.ogg",
  parachute:        "parachute.ogg",
  nitro:            "nitro.ogg",
  shield:           "forcefield.ogg",
  strike:           "strike.ogg",
  machine_gun:      "machine_sound.ogg",
  // Effects
  boost:            "nitro.ogg",
  ugh:              "ugh.ogg",
  splash:           "splash.ogg",
  horn:             "horn.ogg",
  goo:              "goo.ogg",
  boing:            "boing.ogg",
  respawn:          "boing.ogg",       // reuse boing — springy "pop back in" feel
  // UI
  click:            "grab_collectable.ogg",
  locked:           "locked.ogg",
  portal:           "portal.ogg",
};

// Map weapon subType → fire SFX
const WEAPON_FIRE_SFX = {
  missile:      "shoot",
  bowling_ball: "bowling_shoot",
  cake:         "shoot",
  plunger:      "plunger",
  nitro:        "shoot",
  bubblegum:    "goo",
  banana:       "boing",
  swatter:      "swatter",
  shield:       "shield",
  ludicrous_mode: "boost",
  parachute:    "parachute",
  anchor:       "strike",
  pirateleportation: "explosion",
  mirror_realm: "shield",
  phase_shift:  "portal",
  weather_dominion: "portal",
  glow_thrower: "shoot",
  glo_burst:    "shoot",
  fireball:     "shoot",
  ice_lance:    "shoot",
  lightning_bolt: "strike",
  tornado:      "shoot",
  super_nova:   "explosion",
  toxic_spread: "goo",
  toxic_cloud:  "goo",
  rock_barrage: "crash2",
  wind_slash:   "shoot",
  gravity_well: "portal",
  cannon:       "shoot",
};
const WEAPON_HIT_SFX = {
  missile:      "explosion",
  bowling_ball: "strike",
  cake:         "splash",
  plunger:      "ugh",
  nitro:        "explosion",
  bubblegum:    "bubblegum_pop",
  banana:       "ugh",
  swatter:      "crash",
  anchor:       "crash2",
  pirateleportation: "explosion",
  glow_thrower: "explosion",
  glo_burst:    "strike",
  fireball:     "explosion",
  ice_lance:    "crash",
  lightning_bolt: "strike",
  tornado:      "crash2",
  super_nova:   "explosion",
  toxic_spread: "splash",
  toxic_cloud:  "goo",
  rock_barrage: "crash3",
  wind_slash:   "crash",
  gravity_well: "strike",
  mirror_shield: "shield",
  shield:       "shield",
  cannon:       "explosion",
};

// ── Internal state ────────────────────────────────────────────────────────
let _ctx = null;
let _unlocked = false;
let _muted = false;
let _masterVol = 0.6;
let _bgmVol = 0.35;
let _sfxVol = 0.7;

let _bgmSource = null;
let _bgmGain = null;
let _bgmBuffer = null;
let _currentBgmFile = "";

// Battle music state (21.26)
let _battleIntensity = 'normal'; // 'normal' | 'high' | 'matchpoint'
let _battleMusicDead = false;    // muted during death sequence

// Ambient state (21.27)
let _ambientSource = null;
let _ambientGain = null;
let _ambientFile = "";
let _boundaryWarnOsc = null;
let _boundaryWarnGain = null;

let _engineSource = null;
let _engineGain = null;
let _engineBuffer = null;

const _sfxBufferCache = new Map();
const _loopingSources = new Map();

// ── Initialization ────────────────────────────────────────────────────────

function getContext() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return _ctx;
}

/**
 * Call once on first user gesture (click/keydown) to unlock Web Audio.
 */
export function unlockAudio() {
  if (_unlocked) return;
  const ctx = getContext();
  if (ctx.state === "suspended") {
    ctx.resume().then(() => {
      _unlocked = true;
      console.log("[game-audio] AudioContext unlocked");
    });
  } else {
    _unlocked = true;
  }
}

// Auto-unlock on first interaction
if (typeof window !== "undefined") {
  const autoUnlock = () => {
    unlockAudio();
    window.removeEventListener("click", autoUnlock);
    window.removeEventListener("keydown", autoUnlock);
    window.removeEventListener("touchstart", autoUnlock);
  };
  window.addEventListener("click", autoUnlock, { once: false });
  window.addEventListener("keydown", autoUnlock, { once: false });
  window.addEventListener("touchstart", autoUnlock, { once: false });
}

// ── Buffer loading ────────────────────────────────────────────────────────

async function loadBuffer(url) {
  if (_sfxBufferCache.has(url)) return _sfxBufferCache.get(url);
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await getContext().decodeAudioData(arrayBuf);
    _sfxBufferCache.set(url, audioBuf);
    return audioBuf;
  } catch (e) {
    console.warn(`[game-audio] Failed to load ${url}:`, e.message);
    return null;
  }
}

// ── Background Music ──────────────────────────────────────────────────────

/**
 * Start track-appropriate background music.
 * @param {string} trackId — map/track/arena id
 */
export async function playTrackMusic(trackId) {
  // Use explicit mapping, or pick a random track from the custom race pool
  const file = TRACK_MUSIC[trackId] ||
    CUSTOM_RACE_POOL[Math.floor(Math.random() * CUSTOM_RACE_POOL.length)];
  if (file === _currentBgmFile && _bgmSource) return; // already playing
  await playBGM(file);
}

/**
 * Play the pre-race menu music (shown while waiting for race to start).
 */
export async function playPreRaceMusic() {
  await playBGM('music 2/prerace menu.mp3');
}

/**
 * Play the post-race results music.
 */
export async function playPostRaceMusic() {
  await playBGM('music 2/post race menu.mp3');
}

export async function playBGM(filename) {
  stopBGM();
  _currentBgmFile = filename;
  // Encode each path segment so spaces become %20 (handles 'music 2/' folder)
  const url = `/audio/music/${filename.split('/').map(encodeURIComponent).join('/')}`;
  const buf = await loadBuffer(url);
  if (!buf) return;
  _bgmBuffer = buf;

  const ctx = getContext();
  _bgmGain = ctx.createGain();
  _bgmGain.gain.value = _muted ? 0 : _bgmVol * _masterVol;
  _bgmGain.connect(ctx.destination);

  _bgmSource = ctx.createBufferSource();
  _bgmSource.buffer = buf;
  _bgmSource.loop = true;
  _bgmSource.connect(_bgmGain);
  _bgmSource.start(0);
}

export function stopBGM() {
  if (_bgmSource) {
    try { _bgmSource.stop(); } catch (_) {}
    _bgmSource.disconnect();
    _bgmSource = null;
  }
  if (_bgmGain) {
    _bgmGain.disconnect();
    _bgmGain = null;
  }
  _currentBgmFile = "";
}

/**
 * Cross-fade to "fast" variant (e.g., last lap).
 * STK convention: track_fast.ogg
 */
export async function playFastVariant() {
  if (!_currentBgmFile) return;
  const fast = _currentBgmFile.replace(".ogg", "_fast.ogg");
  // Only switch if fast variant exists (will just warn on 404)
  await playBGM(fast);
}

// ── SFX ───────────────────────────────────────────────────────────────────

/**
 * Play a one-shot SFX by event name.
 * @param {string} eventName — key from SFX catalogue (e.g. "shoot", "pickup")
 * @param {number} [volume=1] — relative volume multiplier
 */
export async function playSFX(eventName, volume = 1) {
  const file = SFX[eventName];
  if (!file) return;
  const url = `/audio/sfx/${file}`;
  const buf = await loadBuffer(url);
  if (!buf) return;

  const ctx = getContext();
  const gain = ctx.createGain();
  gain.gain.value = _muted ? 0 : _sfxVol * _masterVol * volume;
  gain.connect(ctx.destination);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gain);
  src.start(0);
  // Auto-cleanup
  src.onended = () => { gain.disconnect(); };
}

/**
 * Play weapon-specific fire SFX.
 */
export function playWeaponFireSFX(weaponSubType) {
  const event = WEAPON_FIRE_SFX[weaponSubType];
  if (event) playSFX(event);
  if (weaponSubType === 'pirateleportation') playAnomalyCue('gravity_well_fire', 1);
  if (weaponSubType === 'mirror_realm') playAnomalyCue('mirror_realm_ready', 0.9);
  if (weaponSubType === 'phase_shift') playAnomalyCue('phase_shift_ready', 0.9);
  if (weaponSubType === 'weather_dominion') playAnomalyCue('weather_dominion_cast', 1);
}

/**
 * Play weapon-specific hit SFX.
 */
export function playWeaponHitSFX(weaponSubType) {
  const event = WEAPON_HIT_SFX[weaponSubType];
  if (event) playSFX(event);
  if (weaponSubType === 'pirateleportation') playAnomalyCue('gravity_well_hit', 1);
}

export function playMissileLockTone(progress = 0, locked = false) {
  const clamped = Math.max(0, Math.min(1, progress || 0));
  const baseFrequency = 540 + clamped * 260;
  playSynthTone({
    frequency: baseFrequency,
    endFrequency: locked ? baseFrequency * 1.12 : baseFrequency * (1.04 + clamped * 0.08),
    type: locked ? 'square' : 'triangle',
    duration: locked ? 0.095 : 0.078,
    volume: locked ? 0.17 : (0.09 + clamped * 0.06),
    attack: 0.002,
    release: locked ? 0.08 : 0.055,
    filterType: 'bandpass',
    filterFrequency: locked ? 1450 : (880 + clamped * 360),
    q: locked ? 2.4 : 1.6,
  });
  playSynthTone({
    frequency: baseFrequency * 1.48,
    endFrequency: baseFrequency * (locked ? 1.62 : 1.5),
    type: 'square',
    duration: locked ? 0.06 : 0.045,
    volume: locked ? 0.085 : (0.026 + clamped * 0.02),
    attack: 0.002,
    release: 0.04,
    delay: locked ? 0.016 : 0.01,
    filterType: 'lowpass',
    filterFrequency: locked ? 1850 : (1200 + clamped * 260),
    q: 0.9,
  });
  if (locked) {
    playSynthTone({
      frequency: 980,
      endFrequency: 1120,
      type: 'triangle',
      duration: 0.075,
      volume: 0.11,
      attack: 0.002,
      release: 0.07,
      delay: 0.03,
      filterType: 'bandpass',
      filterFrequency: 1600,
      q: 2.2,
    });
  }
}

/** Roulette tick - short blip during item cycle */
export function playRouletteTick() {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(_muted ? 0 : 0.08 * _sfxVol * _masterVol, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.07);
  osc.onended = () => gain.disconnect();
}

/** Roulette land — bright "ding" when item is confirmed */
export function playRouletteDing() {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const vol = _muted ? 0 : 0.18 * _sfxVol * _masterVol;
  [660, 880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now + i * 0.04);
    gain.gain.linearRampToValueAtTime(Math.max(0.0001, vol * (1 - i * 0.2)), now + i * 0.04 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + i * 0.04);
    osc.stop(now + 0.4);
    osc.onended = () => gain.disconnect();
  });
}

/** Hit confirmed — quick rising chirp for attacker feedback */
export function playHitConfirmSFX() {
  const ctx = getContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(_muted ? 0 : 0.12 * _sfxVol * _masterVol, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
  osc.onended = () => gain.disconnect();
}

/** Deep boom + shatter SFX for elimination/death (21.12) */
export function playEliminationSFX() {
  // Deep boom
  playSynthTone({ frequency: 60, endFrequency: 25, type: 'sine', duration: 0.6,
    volume: 0.25, filterType: 'lowpass', filterFrequency: 180, q: 0.8 });
  // Glass shatter
  playNoiseSweep({ duration: 0.5, volume: 0.18,
    filterFrequency: 4000, endFilterFrequency: 200 });
  // Sub-bass rumble
  playSynthTone({ frequency: 40, endFrequency: 20, type: 'triangle', duration: 0.8,
    volume: 0.15, release: 0.4 });
}

/** Low health heartbeat pulse (21.14) */
export function playHeartbeat() {
  playSynthTone({ frequency: 50, endFrequency: 40, type: 'sine', duration: 0.15,
    volume: 0.12, attack: 0.01, release: 0.1 });
  setTimeout(() => {
    playSynthTone({ frequency: 45, endFrequency: 35, type: 'sine', duration: 0.12,
      volume: 0.08, attack: 0.01, release: 0.08 });
  }, 180);
}

/** Balloon pop SFX (21.15) */
export function playBalloonPop() {
  playNoiseSweep({ duration: 0.15, volume: 0.2,
    filterFrequency: 3000, endFilterFrequency: 500 });
  playSynthTone({ frequency: 600, endFrequency: 200, type: 'sine', duration: 0.1,
    volume: 0.1 });
}

function createNoiseBuffer(durationSec = 0.25) {
  const ctx = getContext();
  const sampleRate = ctx.sampleRate;
  const frameCount = Math.max(1, Math.floor(sampleRate * durationSec));
  const buffer = ctx.createBuffer(1, frameCount, sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frameCount);
  }
  return buffer;
}

// Shared looping noise buffer (2s is enough since it loops; avoids re-allocating 8s per sound)
let _sharedLoopNoise = null;
function getLoopNoiseBuffer() {
  if (_sharedLoopNoise) return _sharedLoopNoise;
  const ctx = getContext();
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  _sharedLoopNoise = buf;
  return buf;
}

function playSynthTone({
  frequency = 220,
  endFrequency = frequency,
  type = 'sine',
  duration = 0.25,
  volume = 0.18,
  attack = 0.01,
  release = 0.18,
  detune = 0,
  delay = 0,
  filterType = '',
  filterFrequency = 1200,
  q = 0.0001,
} = {}) {
  const ctx = getContext();
  const now = ctx.currentTime + Math.max(0, delay);
  const gain = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(20, frequency), now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), now + duration);
  osc.detune.setValueAtTime(detune, now);

  let output = gain;
  if (filterType) {
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrequency, now);
    filter.Q.setValueAtTime(q, now);
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * (_muted ? 0 : _sfxVol * _masterVol)), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(attack + 0.02, duration + release));
  output.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + release + 0.02);
  osc.onended = () => gain.disconnect();
}

function playNoiseSweep({ duration = 0.4, volume = 0.16, filterFrequency = 900, endFilterFrequency = 180 } = {}) {
  const ctx = getContext();
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer(duration + 0.1);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(filterFrequency, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFilterFrequency), now + duration);
  filter.Q.setValueAtTime(1.5, now);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * (_muted ? 0 : _sfxVol * _masterVol)), now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(now);
  src.stop(now + duration + 0.02);
  src.onended = () => gain.disconnect();
}

export function playAnomalyCue(cue, intensity = 1) {
  const strength = Math.max(0.2, Math.min(1.6, intensity));
  switch (cue) {
    case 'gravity_well_fire':
      playSynthTone({ frequency: 170, endFrequency: 52, type: 'sine', duration: 0.55, volume: 0.22 * strength, filterType: 'lowpass', filterFrequency: 640, q: 0.8 });
      playNoiseSweep({ duration: 0.45, volume: 0.08 * strength, filterFrequency: 480, endFilterFrequency: 120 });
      break;
    case 'gravity_well_hit':
      playSynthTone({ frequency: 110, endFrequency: 38, type: 'triangle', duration: 0.45, volume: 0.28 * strength, filterType: 'lowpass', filterFrequency: 420, q: 0.9 });
      break;
    case 'mirror_realm_ready':
      playSynthTone({ frequency: 620, endFrequency: 1120, type: 'triangle', duration: 0.24, volume: 0.12 * strength, filterType: 'highpass', filterFrequency: 500, q: 0.4 });
      playSynthTone({ frequency: 920, endFrequency: 1480, type: 'sine', duration: 0.2, volume: 0.08 * strength, detune: 9 });
      break;
    case 'phase_shift_ready':
      playSynthTone({ frequency: 180, endFrequency: 760, type: 'sawtooth', duration: 0.35, volume: 0.1 * strength, filterType: 'bandpass', filterFrequency: 540, q: 1.2 });
      break;
    case 'memory_leak_cast':
      playSynthTone({ frequency: 460, endFrequency: 210, type: 'square', duration: 0.18, volume: 0.09 * strength });
      playSynthTone({ frequency: 310, endFrequency: 520, type: 'square', duration: 0.12, volume: 0.08 * strength, detune: -8 });
      break;
    case 'weather_dominion_cast':
      playNoiseSweep({ duration: 0.6, volume: 0.12 * strength, filterFrequency: 1400, endFilterFrequency: 180 });
      playSynthTone({ frequency: 280, endFrequency: 70, type: 'triangle', duration: 0.5, volume: 0.12 * strength });
      break;
    case 'arena_fog':
      playSynthTone({ frequency: 190, endFrequency: 150, type: 'sine', duration: 0.7, volume: 0.06 * strength, filterType: 'lowpass', filterFrequency: 340, q: 0.5 });
      break;
    case 'arena_rain':
      playNoiseSweep({ duration: 0.5, volume: 0.07 * strength, filterFrequency: 2200, endFilterFrequency: 900 });
      break;
    case 'arena_clear':
      playSynthTone({ frequency: 420, endFrequency: 760, type: 'triangle', duration: 0.22, volume: 0.08 * strength });
      break;
    default:
      break;
  }
}

// ── Engine Sound ──────────────────────────────────────────────────────────

/**
 * Start a looping engine sound. Call once at race start.
 */
export async function startEngineSound() {
  if (_engineSource) return; // already running
  const url = "/audio/sfx/engine_small.ogg";
  const buf = await loadBuffer(url);
  if (!buf) return;
  _engineBuffer = buf;

  const ctx = getContext();
  _engineGain = ctx.createGain();
  _engineGain.gain.value = _muted ? 0 : 0.15 * _masterVol;
  _engineGain.connect(ctx.destination);

  _engineSource = ctx.createBufferSource();
  _engineSource.buffer = buf;
  _engineSource.loop = true;
  _engineSource.playbackRate.value = 0.8;
  _engineSource.connect(_engineGain);
  _engineSource.start(0);
}

/**
 * Update engine pitch based on current speed.
 * @param {number} speed — current kart speed
 * @param {number} maxSpeed — max speed for normalization (default 40)
 */
export function updateEnginePitch(speed, maxSpeed = 40) {
  if (!_engineSource) return;
  const norm = Math.min(Math.abs(speed) / maxSpeed, 1.0);
  _engineSource.playbackRate.value = 0.8 + norm * 1.2; // 0.8 → 2.0
}

export function stopEngineSound() {
  if (_engineSource) {
    try { _engineSource.stop(); } catch (_) {}
    _engineSource.disconnect();
    _engineSource = null;
  }
  if (_engineGain) {
    _engineGain.disconnect();
    _engineGain = null;
  }
}

// ── Countdown Audio ───────────────────────────────────────────────────────

/**
 * Play race countdown beeps: tick at 3, 2, 1 then "go" sound.
 * Returns a promise that resolves after the full sequence.
 */
export function playCountdownSequence() {
  return new Promise((resolve) => {
    const delays = [0, 1000, 2000, 3000];
    delays.forEach((delay, i) => {
      setTimeout(() => {
        if (i < 3) {
          playSFX("countdown_tick");
        } else {
          playSFX("countdown_go");
          resolve();
        }
      }, delay);
    });
  });
}

// ── Volume Controls ───────────────────────────────────────────────────────

export function setMasterVolume(v) {
  _masterVol = Math.max(0, Math.min(1, v));
  _applyVolumes();
}

export function setBGMVolume(v) {
  _bgmVol = Math.max(0, Math.min(1, v));
  _applyVolumes();
}

export function setSFXVolume(v) {
  _sfxVol = Math.max(0, Math.min(1, v));
}

export function toggleMute() {
  _muted = !_muted;
  _applyVolumes();
  return _muted;
}

export function isMuted() {
  return _muted;
}

function _applyVolumes() {
  if (_bgmGain) _bgmGain.gain.value = _muted ? 0 : _bgmVol * _masterVol;
  if (_engineGain) _engineGain.gain.value = _muted ? 0 : 0.15 * _masterVol;
}

// ── Per-weapon synthesized audio (21.9) ───────────────────────────────────

const _flightSources = new Map();

/** Start a looping in-flight sound for a projectile. Returns an id for stopping it. */
export function startProjectileFlightSound(weaponId, id) {
  const ctx = getContext();
  if (!ctx || _muted) return;
  const vol = _sfxVol * _masterVol * 0.1;

  let osc, gain, filter;
  switch (weaponId) {
    case 'missile': {
      osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(120, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 300;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain, filter });
      break;
    }
    case 'bowling_ball': {
      osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(60, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.7;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain });
      break;
    }
    case 'fireball': {
      // Crackling flame — filtered noise + low sine
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = getLoopNoiseBuffer();
      noiseSrc.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1200;
      filter.Q.value = 0.8;
      gain = ctx.createGain();
      gain.gain.value = vol * 0.5;
      noiseSrc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noiseSrc.start();
      _flightSources.set(id, { osc: noiseSrc, gain, filter });
      break;
    }
    case 'ice_lance': {
      // High crystalline whistle
      osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2200, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.3;
      filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1800;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain, filter });
      break;
    }
    case 'tornado': {
      // Whooshing wind — modulated noise
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = getLoopNoiseBuffer();
      windSrc.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 400;
      filter.Q.value = 1.2;
      gain = ctx.createGain();
      gain.gain.value = vol * 0.6;
      windSrc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      windSrc.start();
      _flightSources.set(id, { osc: windSrc, gain, filter });
      break;
    }
    case 'lightning_bolt': {
      // Electric hum
      osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(60, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.4;
      filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 180;
      filter.Q.value = 2;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain, filter });
      break;
    }
    case 'wind_slash': {
      // Fast swoosh
      osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.35;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain });
      break;
    }
    case 'toxic_spread':
    case 'toxic_cloud': {
      // Bubbling hiss
      const toxSrc = ctx.createBufferSource();
      toxSrc.buffer = getLoopNoiseBuffer();
      toxSrc.loop = true;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      gain = ctx.createGain();
      gain.gain.value = vol * 0.35;
      toxSrc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      toxSrc.start();
      _flightSources.set(id, { osc: toxSrc, gain, filter });
      break;
    }
    case 'rock_barrage': {
      // Low rumble
      osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(45, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.5;
      filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 120;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain, filter });
      break;
    }
    case 'gravity_well': {
      // Deep pulsating hum
      osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(55, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.5;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain });
      break;
    }
    case 'super_nova': {
      // Building charge whine
      osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(800, ctx.currentTime + 2);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.4;
      filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 500;
      filter.Q.value = 1.5;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain, filter });
      break;
    }
    case 'cake':
    case 'plunger':
    case 'cannon':
    case 'nitro':
    case 'glow_thrower':
    case 'glo_burst': {
      // Generic whoosh
      osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, ctx.currentTime);
      gain = ctx.createGain();
      gain.gain.value = vol * 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _flightSources.set(id, { osc, gain });
      break;
    }
    default:
      break;
  }
}

/** Stop an in-flight projectile sound. */
export function stopProjectileFlightSound(id) {
  const entry = _flightSources.get(id);
  if (!entry) return;
  try { entry.osc.stop(); } catch (_) {}
  entry.gain.disconnect();
  if (entry.filter) entry.filter.disconnect();
  _flightSources.delete(id);
}

/** Weapon-specific impact synth (supplements file-based SFX). */
export function playWeaponImpactSynth(weaponId, damage) {
  const strength = Math.min(damage / 50, 1.5);
  switch (weaponId) {
    case 'bowling_ball':
      playSynthTone({ frequency: 90, endFrequency: 40, type: 'sine', duration: 0.35,
        volume: 0.2 * strength, filterType: 'lowpass', filterFrequency: 200, q: 0.8 });
      playNoiseSweep({ duration: 0.25, volume: 0.12 * strength,
        filterFrequency: 600, endFilterFrequency: 100 });
      break;
    case 'missile':
      playSynthTone({ frequency: 160, endFrequency: 35, type: 'sawtooth', duration: 0.45,
        volume: 0.22 * strength, filterType: 'lowpass', filterFrequency: 400, q: 1.0 });
      playNoiseSweep({ duration: 0.5, volume: 0.18 * strength,
        filterFrequency: 1200, endFilterFrequency: 100 });
      break;
    case 'cake':
      playSynthTone({ frequency: 350, endFrequency: 120, type: 'sine', duration: 0.18,
        volume: 0.12 * strength });
      playNoiseSweep({ duration: 0.2, volume: 0.1 * strength,
        filterFrequency: 2000, endFilterFrequency: 400 });
      break;
    case 'banana':
      playSynthTone({ frequency: 800, endFrequency: 200, type: 'square', duration: 0.12,
        volume: 0.08, filterType: 'bandpass', filterFrequency: 600, q: 2 });
      break;
    case 'shield':
      playSynthTone({ frequency: 1200, endFrequency: 400, type: 'triangle', duration: 0.3,
        volume: 0.15, filterType: 'highpass', filterFrequency: 600, q: 0.5 });
      playNoiseSweep({ duration: 0.35, volume: 0.1,
        filterFrequency: 3000, endFilterFrequency: 800 });
      break;
    // ── Elemental weapon impacts ───────────────────────────────────────
    case 'fireball':
      playSynthTone({ frequency: 140, endFrequency: 45, type: 'sawtooth', duration: 0.4,
        volume: 0.2 * strength, filterType: 'lowpass', filterFrequency: 350, q: 0.9 });
      playNoiseSweep({ duration: 0.45, volume: 0.15 * strength,
        filterFrequency: 1800, endFilterFrequency: 150 });
      break;
    case 'ice_lance':
      playSynthTone({ frequency: 2400, endFrequency: 600, type: 'sine', duration: 0.25,
        volume: 0.12 * strength, filterType: 'highpass', filterFrequency: 800, q: 0.6 });
      playNoiseSweep({ duration: 0.3, volume: 0.1 * strength,
        filterFrequency: 4000, endFilterFrequency: 800 });
      break;
    case 'lightning_bolt':
      playSynthTone({ frequency: 80, endFrequency: 30, type: 'square', duration: 0.2,
        volume: 0.18 * strength, filterType: 'bandpass', filterFrequency: 200, q: 1.5 });
      playNoiseSweep({ duration: 0.15, volume: 0.2 * strength,
        filterFrequency: 5000, endFilterFrequency: 300 });
      break;
    case 'tornado':
      playNoiseSweep({ duration: 0.6, volume: 0.18 * strength,
        filterFrequency: 800, endFilterFrequency: 120 });
      playSynthTone({ frequency: 200, endFrequency: 60, type: 'triangle', duration: 0.5,
        volume: 0.12 * strength });
      break;
    case 'super_nova':
      playSynthTone({ frequency: 200, endFrequency: 25, type: 'sawtooth', duration: 0.7,
        volume: 0.25 * strength, filterType: 'lowpass', filterFrequency: 500, q: 1.0 });
      playNoiseSweep({ duration: 0.7, volume: 0.22 * strength,
        filterFrequency: 2000, endFilterFrequency: 80 });
      playSynthTone({ frequency: 55, endFrequency: 20, type: 'sine', duration: 0.9,
        volume: 0.18 * strength, release: 0.4 });
      break;
    case 'toxic_spread':
    case 'toxic_cloud':
      playSynthTone({ frequency: 180, endFrequency: 80, type: 'sine', duration: 0.35,
        volume: 0.1 * strength, filterType: 'lowpass', filterFrequency: 300, q: 0.6 });
      playNoiseSweep({ duration: 0.4, volume: 0.08 * strength,
        filterFrequency: 900, endFilterFrequency: 200 });
      break;
    case 'rock_barrage':
      playSynthTone({ frequency: 70, endFrequency: 30, type: 'triangle', duration: 0.35,
        volume: 0.18 * strength, filterType: 'lowpass', filterFrequency: 200, q: 0.8 });
      playNoiseSweep({ duration: 0.3, volume: 0.14 * strength,
        filterFrequency: 600, endFilterFrequency: 100 });
      break;
    case 'wind_slash':
      playNoiseSweep({ duration: 0.25, volume: 0.1 * strength,
        filterFrequency: 1600, endFilterFrequency: 300 });
      break;
    case 'gravity_well':
      playSynthTone({ frequency: 55, endFrequency: 22, type: 'sine', duration: 0.6,
        volume: 0.2 * strength, filterType: 'lowpass', filterFrequency: 150, q: 1.0 });
      break;
    case 'glow_thrower':
      playSynthTone({ frequency: 120, endFrequency: 50, type: 'sawtooth', duration: 0.3,
        volume: 0.15 * strength, filterType: 'lowpass', filterFrequency: 280, q: 0.8 });
      playNoiseSweep({ duration: 0.35, volume: 0.12 * strength,
        filterFrequency: 1000, endFilterFrequency: 150 });
      break;
    default:
      playNoiseSweep({ duration: 0.3, volume: 0.1 * strength,
        filterFrequency: 800, endFilterFrequency: 150 });
      break;
  }
}

// ── 21.26 Battle Music System ─────────────────────────────────────────────

// Battle music uses the same BGM system but adds dynamic intensity switching.
// "normal" = standard battle track, "high" = faster/louder variant, "matchpoint" = stinger then high
const BATTLE_MUSIC_POOL = CUSTOM_RACE_POOL.slice(3, 9); // 6 battle-suitable tracks

/**
 * Start battle-specific music. Picks from the battle pool based on arena.
 */
export async function playBattleMusic(trackId) {
  _battleIntensity = 'normal';
  _battleMusicDead = false;
  const idx = Math.abs(hashStr(trackId || 'glo_arena')) % BATTLE_MUSIC_POOL.length;
  await playBGM(BATTLE_MUSIC_POOL[idx]);
  // Speed up slightly for battle energy
  if (_bgmSource) _bgmSource.playbackRate.value = 1.05;
}

/**
 * Set battle music intensity. Crossfades playback rate and volume.
 * @param {'normal'|'high'|'matchpoint'} level
 */
export function setBattleMusicIntensity(level) {
  if (level === _battleIntensity) return;
  _battleIntensity = level;
  if (!_bgmSource || !_bgmGain) return;
  const ctx = getContext();
  const now = ctx.currentTime;
  if (level === 'matchpoint') {
    // Brief stinger chord, then switch to high
    playSynthTone({ frequency: 880, endFrequency: 1200, type: 'triangle', duration: 0.4, volume: 0.15 });
    playSynthTone({ frequency: 660, endFrequency: 900, type: 'sine', duration: 0.4, volume: 0.1 });
    level = 'high'; // fall through to high
  }
  const targetRate = level === 'high' ? 1.2 : 1.05;
  const targetVol = level === 'high' ? _bgmVol * _masterVol * 1.15 : _bgmVol * _masterVol;
  _bgmSource.playbackRate.linearRampToValueAtTime(targetRate, now + 0.5);
  _bgmGain.gain.linearRampToValueAtTime(_muted ? 0 : targetVol, now + 0.5);
}

/**
 * Silence music during death sequence, resume on respawn.
 */
export function setBattleMusicDead(dead) {
  if (dead === _battleMusicDead) return;
  _battleMusicDead = dead;
  if (!_bgmGain) return;
  const ctx = getContext();
  const now = ctx.currentTime;
  if (dead) {
    _bgmGain.gain.linearRampToValueAtTime(0.001, now + 0.3);
  } else {
    _bgmGain.gain.linearRampToValueAtTime(_muted ? 0 : _bgmVol * _masterVol, now + 0.5);
  }
}

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

// ── 21.27 Ambient Sound and Environment Audio ────────────────────────────

const ARENA_AMBIENCE = {
  stadium:    { type: 'crowd',  freq: 200, bw: 400 },
  blockfort:  { type: 'wind',   freq: 300, bw: 150 },
  glo_arena:  { type: 'hum',    freq: 80,  bw: 60  },
  test_box:   { type: 'wind',   freq: 250, bw: 200 },
};

/**
 * Start ambient loop for the arena. Uses filtered noise to synthesize environment audio.
 */
export function startAmbientLoop(arenaId) {
  stopAmbientLoop();
  const ctx = getContext();
  if (!ctx) return;
  const cfg = ARENA_AMBIENCE[arenaId] || ARENA_AMBIENCE.test_box;

  // Create noise source
  const bufSize = ctx.sampleRate * 2;
  const noiseBuf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

  _ambientSource = ctx.createBufferSource();
  _ambientSource.buffer = noiseBuf;
  _ambientSource.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = cfg.freq;
  filter.Q.value = cfg.freq / (cfg.bw || 200);

  _ambientGain = ctx.createGain();
  _ambientGain.gain.value = _muted ? 0 : 0.04 * _masterVol;

  _ambientSource.connect(filter);
  filter.connect(_ambientGain);
  _ambientGain.connect(ctx.destination);
  _ambientSource.start();
  _ambientFile = arenaId;
}

export function stopAmbientLoop() {
  if (_ambientSource) {
    try { _ambientSource.stop(); } catch (_) {}
    _ambientSource.disconnect();
    _ambientSource = null;
  }
  if (_ambientGain) {
    _ambientGain.disconnect();
    _ambientGain = null;
  }
  _ambientFile = '';
}

/**
 * Play an item box proximity hum — gentle sine pulse when near an item box.
 */
export function playItemProximityHum() {
  const ctx = getContext();
  if (!ctx || _muted) return;
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(0.03 * _sfxVol * _masterVol, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.35);
  osc.onended = () => gain.disconnect();
}

/**
 * Start/stop boundary warning tone (continuous oscillator that ramps with proximity).
 * @param {number} proximity  0 = safe (no sound), 1 = at edge (full volume)
 */
export function updateBoundaryWarning(proximity) {
  const ctx = getContext();
  if (!ctx) return;
  if (proximity <= 0) {
    if (_boundaryWarnOsc) {
      try { _boundaryWarnOsc.stop(); } catch (_) {}
      _boundaryWarnGain.disconnect();
      _boundaryWarnOsc = null;
      _boundaryWarnGain = null;
    }
    return;
  }
  if (!_boundaryWarnOsc) {
    _boundaryWarnOsc = ctx.createOscillator();
    _boundaryWarnOsc.type = 'sawtooth';
    _boundaryWarnOsc.frequency.value = 200;
    _boundaryWarnGain = ctx.createGain();
    _boundaryWarnGain.gain.value = 0;
    _boundaryWarnOsc.connect(_boundaryWarnGain);
    _boundaryWarnGain.connect(ctx.destination);
    _boundaryWarnOsc.start();
  }
  const vol = _muted ? 0 : Math.min(proximity, 1) * 0.08 * _sfxVol * _masterVol;
  _boundaryWarnGain.gain.value = vol;
  _boundaryWarnOsc.frequency.value = 200 + proximity * 400;
}

// ── Cleanup ───────────────────────────────────────────────────────────────

export function disposeAudio() {
  stopBGM();
  stopEngineSound();
  stopAmbientLoop();
  updateBoundaryWarning(0);
  for (const id of _flightSources.keys()) stopProjectileFlightSound(id);
  _sfxBufferCache.clear();
}

// ── Convenience re-exports for mapping ────────────────────────────────────
export { TRACK_MUSIC, SFX, WEAPON_FIRE_SFX, WEAPON_HIT_SFX };
