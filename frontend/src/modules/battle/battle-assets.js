/**
 * battle-assets.js - Asset loader and battle audio orchestrator.
 *
 * Preloads battle textures, models, and Babylon Sound assets so the realtime
 * battle client can use a single cohesive sound path instead of stacking
 * multiple unrelated audio systems on top of each other.
 */

import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Sound } from '@babylonjs/core/Audio/sound';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';

const PARTICLE_TEXTURES = {
  flame_03: '/textures/battle/particles/flame_03.png',
  smoke_04: '/textures/battle/particles/smoke_04.png',
  spark_05: '/textures/battle/particles/spark_05.png',
  dust: '/textures/battle/particles/dust.png',
  cloud: '/textures/battle/particles/cloud.png',
  flare: '/textures/battle/particles/flare.png',
  sun_flare: '/textures/battle/particles/sun_flare.png',
  smoke_6: '/textures/battle/particles/smoke_6.png',
  star_04: '/textures/battle/particles/star_04.png',
  circle_03: '/textures/battle/particles/circle_03.png',
};

const FX_TEXTURES = {
  ice_vfx: '/textures/battle/fx/ice_vfx.png',
  wind_sprites: '/textures/battle/fx/wind-sprites.png',
  wind_hit: '/textures/battle/fx/wind-hit-sprites.png',
  light_burst: '/textures/battle/fx/light-burst.png',
  light_staff: '/textures/battle/fx/light-staff.png',
  kill_splash: '/textures/battle/fx/kill-splash.png',
  kill_surface: '/textures/battle/fx/kill-surface.png',
  sun_surface: '/textures/battle/fx/sun_surface.png',
  fire_surface: '/textures/battle/fx/fire.jpg',
};

const BATTLE_SOUNDS = {
  fire_hit: '/audio/sfx/battle/fire_hit.mp3',
  fire_impact: '/audio/sfx/battle/fire_impact.mp3',
  fire_whoosh: '/audio/sfx/battle/fire_whoosh.mp3',
  ice_hit: '/audio/sfx/battle/ice_hit.mp3',
  ice_tornado: '/audio/sfx/battle/ice_tornado.mp3',
  ice_whoosh: '/audio/sfx/battle/ice_whoosh.mp3',
  ice_burst: '/audio/sfx/battle/spell_ice_burst.mp3',
  wind_hit: '/audio/sfx/battle/wind-hit.mp3',
  wind_slash: '/audio/sfx/battle/wind-slash.mp3',
  wind_tornado: '/audio/sfx/battle/wind-tornado.mp3',
  wind_tornado_cast: '/audio/sfx/battle/wind-tornado-cast.mp3',
  toxic_cloud: '/audio/sfx/battle/toxic-cloud.mp3',
  toxic_explode: '/audio/sfx/battle/toxic-spell-explode.mp3',
  toxic_whoosh: '/audio/sfx/battle/toxic-whoosh.mp3',
  rock_hit: '/audio/sfx/battle/rock.mp3',
  rock_wall: '/audio/sfx/battle/rock_wall.mp3',
  light_staff: '/audio/sfx/battle/light-staff.mp3',
  light_strike: '/audio/sfx/battle/light-strike.mp3',
  thunder: '/audio/sfx/battle/light-strike-thunder.mp3',
  nova_impact: '/audio/sfx/battle/nova_impact.mp3',
  dash: '/audio/sfx/battle/dash.mp3',
  death: '/audio/sfx/battle/death.mp3',
  heartbeat: '/audio/sfx/battle/heartbeat.mp3',
  splash: '/audio/sfx/battle/splash.mp3',
  air_whoosh: '/audio/sfx/battle/air_whoosh2.mp3',
  air_whoosh_light: '/audio/sfx/battle/air_whoosh_light.mp3',
  machine_gun: '/audio/sfx/machine_sound.ogg',
  shoot_single: '/audio/sfx/shoot.ogg',
  sparkle_hit: '/audio/sfx/battle/sparkle_hit.mp3',
  countdown: '/audio/sfx/battle/countdown.mp3',
  victory: '/audio/sfx/battle/victory.mp3',
  defeat: '/audio/sfx/battle/defeat.mp3',
  coin: '/audio/sfx/battle/coin.mp3',
  pickup: '/audio/sfx/battle/collectable_finish.mp3',
  heal: '/audio/sfx/battle/collectable_hp_potion.mp3',
};

const BATTLE_MODELS = {
  tornado: '/models/battle/tornado.glb',
  bow: '/models/battle/bow.glb',
};

const DEFAULT_SOUND_PROFILE = {
  poolSize: 2,
  volume: 0.5,
  volumeJitter: 0.04,
  playbackRate: 1,
  rateJitter: 0.02,
  cooldownMs: 0,
};

const SOUND_PROFILES = {
  air_whoosh: { poolSize: 3, volume: 0.46, volumeJitter: 0.06, playbackRate: 1, rateJitter: 0.035, cooldownMs: 40 },
  air_whoosh_light: { poolSize: 3, volume: 0.36, volumeJitter: 0.05, playbackRate: 1.08, rateJitter: 0.04, cooldownMs: 40 },
  countdown: { poolSize: 1, volume: 0.58, volumeJitter: 0, playbackRate: 1, rateJitter: 0, cooldownMs: 900 },
  dash: { poolSize: 2, volume: 0.52, volumeJitter: 0.05, playbackRate: 1, rateJitter: 0.03, cooldownMs: 80 },
  death: { poolSize: 3, volume: 0.68, volumeJitter: 0.05, playbackRate: 0.96, rateJitter: 0.025, cooldownMs: 70 },
  defeat: { poolSize: 1, volume: 0.74, volumeJitter: 0, playbackRate: 1, rateJitter: 0, cooldownMs: 500 },
  fire_hit: { poolSize: 4, volume: 0.6, volumeJitter: 0.06, playbackRate: 1, rateJitter: 0.03, cooldownMs: 50 },
  fire_impact: { poolSize: 4, volume: 0.66, volumeJitter: 0.05, playbackRate: 0.96, rateJitter: 0.025, cooldownMs: 70 },
  fire_whoosh: { poolSize: 4, volume: 0.54, volumeJitter: 0.06, playbackRate: 1.02, rateJitter: 0.04, cooldownMs: 45 },
  heartbeat: { poolSize: 1, volume: 0.44, volumeJitter: 0, playbackRate: 1, rateJitter: 0, cooldownMs: 850 },
  ice_burst: { poolSize: 3, volume: 0.58, volumeJitter: 0.05, playbackRate: 1, rateJitter: 0.03, cooldownMs: 80 },
  ice_hit: { poolSize: 3, volume: 0.54, volumeJitter: 0.05, playbackRate: 1.04, rateJitter: 0.03, cooldownMs: 55 },
  ice_tornado: { poolSize: 2, volume: 0.52, volumeJitter: 0.04, playbackRate: 0.97, rateJitter: 0.02, cooldownMs: 110 },
  ice_whoosh: { poolSize: 3, volume: 0.48, volumeJitter: 0.05, playbackRate: 1.06, rateJitter: 0.04, cooldownMs: 45 },
  light_staff: { poolSize: 3, volume: 0.52, volumeJitter: 0.05, playbackRate: 0.98, rateJitter: 0.03, cooldownMs: 70 },
  light_strike: { poolSize: 3, volume: 0.62, volumeJitter: 0.05, playbackRate: 1.01, rateJitter: 0.03, cooldownMs: 80 },
  machine_gun: { poolSize: 5, volume: 0.34, volumeJitter: 0.04, playbackRate: 1.08, rateJitter: 0.05, cooldownMs: 56 },
  nova_impact: { poolSize: 3, volume: 0.78, volumeJitter: 0.05, playbackRate: 0.94, rateJitter: 0.02, cooldownMs: 150 },
  pickup: { poolSize: 2, volume: 0.5, volumeJitter: 0.03, playbackRate: 1, rateJitter: 0.02, cooldownMs: 70 },
  heal: { poolSize: 2, volume: 0.54, volumeJitter: 0.03, playbackRate: 1.02, rateJitter: 0.02, cooldownMs: 90 },
  rock_hit: { poolSize: 4, volume: 0.6, volumeJitter: 0.05, playbackRate: 0.95, rateJitter: 0.025, cooldownMs: 60 },
  rock_wall: { poolSize: 2, volume: 0.64, volumeJitter: 0.04, playbackRate: 0.92, rateJitter: 0.02, cooldownMs: 90 },
  shoot_single: { poolSize: 6, volume: 0.32, volumeJitter: 0.04, playbackRate: 1.18, rateJitter: 0.06, cooldownMs: 48 },
  sparkle_hit: { poolSize: 3, volume: 0.46, volumeJitter: 0.05, playbackRate: 1.04, rateJitter: 0.035, cooldownMs: 45 },
  splash: { poolSize: 3, volume: 0.48, volumeJitter: 0.05, playbackRate: 1, rateJitter: 0.03, cooldownMs: 45 },
  thunder: { poolSize: 3, volume: 0.76, volumeJitter: 0.05, playbackRate: 0.98, rateJitter: 0.02, cooldownMs: 140 },
  toxic_cloud: { poolSize: 3, volume: 0.5, volumeJitter: 0.05, playbackRate: 0.96, rateJitter: 0.03, cooldownMs: 110 },
  toxic_explode: { poolSize: 3, volume: 0.63, volumeJitter: 0.05, playbackRate: 0.96, rateJitter: 0.025, cooldownMs: 90 },
  toxic_whoosh: { poolSize: 3, volume: 0.48, volumeJitter: 0.05, playbackRate: 1.02, rateJitter: 0.03, cooldownMs: 50 },
  victory: { poolSize: 1, volume: 0.76, volumeJitter: 0, playbackRate: 1, rateJitter: 0, cooldownMs: 500 },
  wind_hit: { poolSize: 4, volume: 0.54, volumeJitter: 0.05, playbackRate: 1, rateJitter: 0.035, cooldownMs: 60 },
  wind_slash: { poolSize: 4, volume: 0.48, volumeJitter: 0.05, playbackRate: 1.04, rateJitter: 0.04, cooldownMs: 45 },
  wind_tornado: { poolSize: 3, volume: 0.58, volumeJitter: 0.05, playbackRate: 0.98, rateJitter: 0.03, cooldownMs: 100 },
  wind_tornado_cast: { poolSize: 2, volume: 0.56, volumeJitter: 0.04, playbackRate: 1, rateJitter: 0.03, cooldownMs: 140 },
};

const WEAPON_FIRE_SOUND = {
  bowling: { key: 'air_whoosh', volume: 0.44, playbackRate: 0.93 },
  cake: { key: 'air_whoosh_light', volume: 0.34, playbackRate: 1.06 },
  plunger: { key: 'fire_whoosh', volume: 0.48, playbackRate: 1.01 },
  nitro: { key: 'dash', volume: 0.52, playbackRate: 1.04 },
  missile: { key: 'fire_whoosh', volume: 0.58, playbackRate: 0.98, cooldownMs: 90 },
  crimson_hydra: { key: 'fire_whoosh', volume: 0.52, playbackRate: 1.08, cooldownMs: 70 },
  cannon: { key: 'rock_hit', volume: 0.6, playbackRate: 0.9, cooldownMs: 95 },
  frostAxe: { key: 'ice_whoosh', volume: 0.5, playbackRate: 1.04 },
  moltenDagger: { key: 'fire_whoosh', volume: 0.5, playbackRate: 1.06 },
  grenade: { key: 'air_whoosh', volume: 0.48, playbackRate: 0.94 },
  guided_missile: { key: 'fire_whoosh', volume: 0.58, playbackRate: 0.98, cooldownMs: 90 },
  pirateleportation: { key: 'wind_tornado', volume: 0.54, playbackRate: 0.92, cooldownMs: 180 },
  shockwave_cannon: { key: 'thunder', volume: 0.62, playbackRate: 0.94, cooldownMs: 180 },
  thunderstrike: { key: 'light_strike', volume: 0.62, playbackRate: 0.98, cooldownMs: 160 },
  black_hole: { key: 'nova_impact', volume: 0.64, playbackRate: 0.86, cooldownMs: 240 },
  meteor_swarm: {
    key: 'fire_whoosh',
    volume: 0.58,
    playbackRate: 0.88,
    cooldownMs: 140,
    layers: [
      { key: 'rock_hit', volume: 0.18, playbackRate: 0.82, cooldownMs: 140 },
    ],
  },
  frost_nova: { key: 'ice_burst', volume: 0.58, playbackRate: 0.95, cooldownMs: 180 },
  emp_pulse: {
    key: 'light_strike',
    volume: 0.52,
    playbackRate: 1.12,
    cooldownMs: 170,
    layers: [
      { key: 'sparkle_hit', volume: 0.16, playbackRate: 1.24, cooldownMs: 170 },
    ],
  },
  gravity_flip: {
    key: 'nova_impact',
    volume: 0.48,
    playbackRate: 1.12,
    cooldownMs: 180,
    layers: [
      { key: 'air_whoosh_light', volume: 0.14, playbackRate: 0.84, cooldownMs: 180 },
    ],
  },
  inferno_trail: {
    key: 'fire_whoosh',
    volume: 0.6,
    playbackRate: 0.92,
    cooldownMs: 120,
    layers: [
      { key: 'dash', volume: 0.16, playbackRate: 0.88, cooldownMs: 120 },
    ],
  },
  plasma_railgun: { key: 'light_staff', volume: 0.6, playbackRate: 1.02, cooldownMs: 120 },
  vortex_tornado: {
    key: 'wind_tornado_cast',
    volume: 0.56,
    playbackRate: 0.88,
    cooldownMs: 180,
    layers: [
      { key: 'wind_tornado', volume: 0.22, playbackRate: 0.78, cooldownMs: 180 },
    ],
  },
  fireball: { key: 'fire_whoosh', volume: 0.62, playbackRate: 0.97, cooldownMs: 70 },
  toxic_spread: { key: 'toxic_whoosh', volume: 0.5, playbackRate: 1.02 },
  ice_lance: { key: 'ice_whoosh', volume: 0.48, playbackRate: 1.1 },
  tornado: {
    key: 'wind_tornado_cast',
    volume: 0.52,
    playbackRate: 0.95,
    cooldownMs: 180,
    layers: [
      { key: 'wind_tornado', volume: 0.22, playbackRate: 0.88, cooldownMs: 180 },
    ],
  },
  super_nova: {
    key: 'light_staff',
    volume: 0.46,
    playbackRate: 0.84,
    cooldownMs: 280,
    layers: [
      { key: 'thunder', volume: 0.2, playbackRate: 0.76, cooldownMs: 280 },
    ],
  },
  rock_barrage: { key: 'rock_hit', volume: 0.62, playbackRate: 0.92, cooldownMs: 85 },
  lightning_bolt: { key: 'light_strike', volume: 0.62, playbackRate: 1.04, cooldownMs: 150 },
  wind_slash: { key: 'wind_slash', volume: 0.5, playbackRate: 1.08, cooldownMs: 80 },
  toxic_cloud: { key: 'toxic_cloud', volume: 0.48, playbackRate: 0.95, cooldownMs: 220 },
  glow_thrower: {
    key: 'fire_whoosh',
    volume: 0.24,
    playbackRate: 0.96,
    cooldownMs: 150,
    layers: [
      { key: 'air_whoosh_light', volume: 0.14, playbackRate: 1.02, cooldownMs: 150 },
    ],
  },
  glo_burst: { key: 'shoot_single', volume: 0.34, playbackRate: 1.2, cooldownMs: 60 },
};

const WEAPON_HIT_SOUND = {
  bowling: { key: 'rock_hit', volume: 0.56, playbackRate: 0.9 },
  cake: { key: 'splash', volume: 0.44, playbackRate: 1.02 },
  plunger: { key: 'splash', volume: 0.46, playbackRate: 0.96 },
  nitro: { key: 'fire_impact', volume: 0.6, playbackRate: 0.94 },
  missile: { key: 'fire_hit', volume: 0.66, playbackRate: 0.96, cooldownMs: 90 },
  crimson_hydra: { key: 'fire_hit', volume: 0.6, playbackRate: 1.05, cooldownMs: 70 },
  cannon: { key: 'fire_impact', volume: 0.68, playbackRate: 0.9, cooldownMs: 90 },
  frostAxe: { key: 'ice_hit', volume: 0.56, playbackRate: 1.02 },
  moltenDagger: { key: 'fire_hit', volume: 0.58, playbackRate: 1.02 },
  grenade: { key: 'fire_impact', volume: 0.68, playbackRate: 0.92, cooldownMs: 110 },
  guided_missile: { key: 'fire_hit', volume: 0.66, playbackRate: 0.96, cooldownMs: 90 },
  pirateleportation: { key: 'wind_hit', volume: 0.52, playbackRate: 0.96 },
  shockwave_cannon: { key: 'thunder', volume: 0.74, playbackRate: 0.96, cooldownMs: 180 },
  thunderstrike: { key: 'thunder', volume: 0.74, playbackRate: 1, cooldownMs: 180 },
  black_hole: { key: 'nova_impact', volume: 0.76, playbackRate: 0.84, cooldownMs: 240 },
  meteor_swarm: {
    key: 'fire_impact',
    volume: 0.72,
    playbackRate: 0.9,
    cooldownMs: 140,
    layers: [
      { key: 'rock_hit', volume: 0.26, playbackRate: 0.8, cooldownMs: 140 },
    ],
  },
  frost_nova: { key: 'ice_burst', volume: 0.62, playbackRate: 0.96, cooldownMs: 120 },
  emp_pulse: {
    key: 'sparkle_hit',
    volume: 0.56,
    playbackRate: 1.18,
    cooldownMs: 150,
    layers: [
      { key: 'light_strike', volume: 0.18, playbackRate: 1.08, cooldownMs: 150 },
    ],
  },
  gravity_flip: {
    key: 'wind_hit',
    volume: 0.48,
    playbackRate: 0.86,
    cooldownMs: 160,
    layers: [
      { key: 'nova_impact', volume: 0.18, playbackRate: 1.16, cooldownMs: 160 },
    ],
  },
  inferno_trail: {
    key: 'fire_hit',
    volume: 0.64,
    playbackRate: 0.96,
    cooldownMs: 110,
    layers: [
      { key: 'fire_impact', volume: 0.22, playbackRate: 0.88, cooldownMs: 110 },
    ],
  },
  plasma_railgun: { key: 'sparkle_hit', volume: 0.52, playbackRate: 1.03, cooldownMs: 95 },
  vortex_tornado: {
    key: 'wind_hit',
    volume: 0.58,
    playbackRate: 0.9,
    cooldownMs: 170,
    layers: [
      { key: 'wind_tornado', volume: 0.2, playbackRate: 0.8, cooldownMs: 170 },
    ],
  },
  fireball: { key: 'fire_impact', volume: 0.68, playbackRate: 0.94, cooldownMs: 85 },
  toxic_spread: { key: 'toxic_explode', volume: 0.62, playbackRate: 0.97, cooldownMs: 100 },
  ice_lance: { key: 'ice_hit', volume: 0.54, playbackRate: 1.05 },
  tornado: {
    key: 'wind_hit',
    volume: 0.5,
    playbackRate: 0.92,
    cooldownMs: 125,
    layers: [
      { key: 'wind_tornado', volume: 0.16, playbackRate: 0.82, cooldownMs: 125 },
    ],
  },
  super_nova: {
    key: 'nova_impact',
    volume: 0.78,
    playbackRate: 0.88,
    cooldownMs: 260,
    layers: [
      { key: 'thunder', volume: 0.24, playbackRate: 0.74, cooldownMs: 260 },
    ],
  },
  rock_barrage: { key: 'rock_hit', volume: 0.62, playbackRate: 0.92, cooldownMs: 80 },
  lightning_bolt: { key: 'thunder', volume: 0.76, playbackRate: 1, cooldownMs: 180 },
  wind_slash: { key: 'wind_hit', volume: 0.52, playbackRate: 1.04, cooldownMs: 75 },
  toxic_cloud: { key: 'toxic_explode', volume: 0.66, playbackRate: 0.94, cooldownMs: 200 },
  glow_thrower: { key: 'fire_hit', volume: 0.28, playbackRate: 1.08, cooldownMs: 150 },
  glo_burst: { key: 'sparkle_hit', volume: 0.42, playbackRate: 1.1, cooldownMs: 110 },
};

let _scene = null;
const _textures = {};
const _sounds = {};
const _models = {};
let _loaded = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function jitter(center, range = 0) {
  if (!range) return center;
  return center + ((Math.random() * 2) - 1) * range;
}

function getSoundProfile(key) {
  return {
    ...DEFAULT_SOUND_PROFILE,
    ...(SOUND_PROFILES[key] || {}),
  };
}

function getNowMs() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function createSoundVoice(key, path, scene, index) {
  return new Promise((resolve) => {
    let sound = null;
    sound = new Sound(`${key}_${index}`, path, scene, () => resolve(sound), {
      autoplay: false,
      spatialSound: false,
      volume: 0,
    });
  });
}

async function createSoundPool(key, path, scene) {
  const profile = getSoundProfile(key);
  const voices = await Promise.all(
    Array.from({ length: profile.poolSize }, (_, index) => createSoundVoice(key, path, scene, index)),
  );
  _sounds[key] = {
    cursor: 0,
    lastPlayedAt: -Infinity,
    profile,
    voices,
  };
}

function resolveWeaponSoundProfile(table, weaponId, fallbackKey) {
  const entry = table[weaponId];
  if (!entry) return { key: fallbackKey };
  if (typeof entry === 'string') return { key: entry };
  return entry;
}

function playProfiledBattleSound(profile, opts = {}) {
  const merged = {
    ...profile,
    ...opts,
  };
  const layers = Array.isArray(merged.layers) ? merged.layers : [];
  let played = false;
  if (merged.key) {
    played = playBattleSound(merged.key, merged) || played;
  }
  for (const layer of layers) {
    if (!layer?.key) continue;
    played = playBattleSound(layer.key, layer) || played;
  }
  return played;
}

export async function loadBattleAssets(scene) {
  if (_loaded) return;
  _scene = scene;

  for (const [key, path] of Object.entries(PARTICLE_TEXTURES)) {
    _textures[key] = new Texture(path, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  }
  for (const [key, path] of Object.entries(FX_TEXTURES)) {
    _textures[key] = new Texture(path, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  }

  await Promise.all(
    Object.entries(BATTLE_SOUNDS).map(([key, path]) => createSoundPool(key, path, scene)),
  );

  _loaded = true;
}

export function getBattleTexture(key) {
  return _textures[key] || null;
}

export function getAllParticleTextures() {
  const out = {};
  for (const key of Object.keys(PARTICLE_TEXTURES)) {
    if (_textures[key]) out[key] = _textures[key];
  }
  return out;
}

export function playBattleSound(key, opts = {}) {
  const pool = _sounds[key];
  if (!pool || pool.voices.length === 0) return false;

  const profile = {
    ...pool.profile,
    ...opts,
  };
  const now = getNowMs();
  const cooldownMs = Math.max(0, Number(profile.cooldownMs || 0));
  if (cooldownMs > 0 && (now - pool.lastPlayedAt) < cooldownMs) return false;
  pool.lastPlayedAt = now;

  const voice = pool.voices[pool.cursor % pool.voices.length];
  pool.cursor = (pool.cursor + 1) % pool.voices.length;

  const volume = clamp(
    jitter(Number(profile.volume ?? DEFAULT_SOUND_PROFILE.volume), Number(profile.volumeJitter || 0)),
    0,
    1,
  );
  const playbackRate = clamp(
    jitter(Number(profile.playbackRate ?? DEFAULT_SOUND_PROFILE.playbackRate), Number(profile.rateJitter || 0)),
    0.55,
    1.65,
  );

  try {
    if (voice.isPlaying) voice.stop();
  } catch (_) {}

  voice.setVolume(volume);
  voice.setPlaybackRate(playbackRate);
  voice.play();
  return true;
}

export function playWeaponFireSound(weaponId, opts = {}) {
  const profile = resolveWeaponSoundProfile(WEAPON_FIRE_SOUND, weaponId, 'air_whoosh');
  return playProfiledBattleSound(profile, opts);
}

export function playWeaponHitSound(weaponId, opts = {}) {
  const profile = resolveWeaponSoundProfile(WEAPON_HIT_SOUND, weaponId, 'fire_impact');
  return playProfiledBattleSound(profile, opts);
}

export async function loadBattleModel(key) {
  if (_models[key]) return _models[key];
  const path = BATTLE_MODELS[key];
  if (!path || !_scene) return null;

  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  const file = path.substring(path.lastIndexOf('/') + 1);
  const result = await SceneLoader.ImportMeshAsync('', dir, file, _scene);
  if (result.meshes.length > 0) {
    const root = result.meshes[0];
    root.setEnabled(false);
    _models[key] = root;
    return root;
  }
  return null;
}

export function areBattleAssetsLoaded() {
  return _loaded;
}

export function getBattleAssetManifest() {
  return {
    textures: Object.keys(PARTICLE_TEXTURES).concat(Object.keys(FX_TEXTURES)),
    sounds: Object.keys(BATTLE_SOUNDS),
    models: Object.keys(BATTLE_MODELS),
    loaded: _loaded,
  };
}

export function disposeBattleAssets() {
  for (const tex of Object.values(_textures)) {
    tex.dispose();
  }
  for (const pool of Object.values(_sounds)) {
    for (const voice of pool.voices || []) {
      voice.dispose();
    }
  }
  for (const model of Object.values(_models)) {
    model.dispose(false, true);
  }
  Object.keys(_textures).forEach((key) => delete _textures[key]);
  Object.keys(_sounds).forEach((key) => delete _sounds[key]);
  Object.keys(_models).forEach((key) => delete _models[key]);
  _loaded = false;
  _scene = null;
}
