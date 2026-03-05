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
  // Custom maps → deterministic picks from race pool
  map1:  CUSTOM_RACE_POOL[0],
  map2:  CUSTOM_RACE_POOL[1],
  // STK tracks → continuing race pool picks
  cocoa_temple:       CUSTOM_RACE_POOL[2],
  cornfield_crossing: CUSTOM_RACE_POOL[3],
  zengarden:          CUSTOM_RACE_POOL[4],
  // STK arenas
  battleisland:       CUSTOM_RACE_POOL[5],
  stadium:            CUSTOM_RACE_POOL[6],
  blockfort:          CUSTOM_RACE_POOL[7],
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
  zipper:       "boost",
  parachute:    "parachute",
  anchor:       "strike",
};

// Map weapon subType → hit SFX
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
}

/**
 * Play weapon-specific hit SFX.
 */
export function playWeaponHitSFX(weaponSubType) {
  const event = WEAPON_HIT_SFX[weaponSubType];
  if (event) playSFX(event);
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

// ── Cleanup ───────────────────────────────────────────────────────────────

export function disposeAudio() {
  stopBGM();
  stopEngineSound();
  _sfxBufferCache.clear();
}

// ── Convenience re-exports for mapping ────────────────────────────────────
export { TRACK_MUSIC, SFX, WEAPON_FIRE_SFX, WEAPON_HIT_SFX };
