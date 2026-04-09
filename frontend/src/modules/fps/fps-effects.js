/**
 * fps-effects.js — VFX and audio for the Arena FPS mode.
 * Muzzle flash, bullet trails, impact explosions, procedural sounds, screen shake.
 */

import { Vector3, Color4 } from '@babylonjs/core/Maths/math';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { PointLight } from '@babylonjs/core/Lights/pointLight';

// ── Asset URLs (BabylonJS/Assets) ──────────────────────────────────────────
const FLARE_URL = 'https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/flare.png';
const SOUND_ROOT = 'https://raw.githubusercontent.com/BabylonJS/Assets/master/sound/';
// Fallback 1×1 white pixel for particles
const FALLBACK_TEX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const SOUND_URLS = {
  fire: SOUND_ROOT + 'cannonBlast.mp3',
  impact: SOUND_ROOT + 'testing/ogg.ogg',
  reload: SOUND_ROOT + 'testing/audioV2/pulsed-1.mp3',
  hitConfirm: SOUND_ROOT + 'testing/audioV2/pulsed-2.mp3',
  footstep: SOUND_ROOT + 'testing/audioV2/pulsed-1.ogg',
};

const soundCache = new Map();

// ── Audio context (Web Audio procedural sounds) ────────────────────────────
let _ctx = null;
function audioCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

function resumeAudio() {
  const ctx = audioCtx();
  if (ctx.state === 'suspended') ctx.resume();
}

// ── Procedural sound generators ────────────────────────────────────────────
function playFireSound() {
  resumeAudio();
  const ctx = audioCtx();
  const t = ctx.currentTime;

  // Noise burst (gunshot)
  const bufLen = ctx.sampleRate * 0.12;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    const env = 1 - i / bufLen;
    data[i] = (Math.random() * 2 - 1) * env * env;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf;

  // Low thud
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.1);

  const gainNoise = ctx.createGain();
  gainNoise.gain.setValueAtTime(0.4, t);
  gainNoise.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

  const gainOsc = ctx.createGain();
  gainOsc.gain.setValueAtTime(0.3, t);
  gainOsc.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

  noise.connect(gainNoise).connect(ctx.destination);
  osc.connect(gainOsc).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.12);
  osc.start(t);
  osc.stop(t + 0.1);
}

function playImpactSound() {
  resumeAudio();
  const ctx = audioCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.25, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

function playReloadSound() {
  resumeAudio();
  const ctx = audioCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(800, t);
  osc.frequency.linearRampToValueAtTime(1200, t + 0.08);
  osc.frequency.linearRampToValueAtTime(600, t + 0.16);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.15, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.2);
}

function playHitConfirm() {
  resumeAudio();
  const ctx = audioCtx();
  const t = ctx.currentTime;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.linearRampToValueAtTime(1600, t + 0.06);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.2, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.08);
}

function playFootstep() {
  resumeAudio();
  const ctx = audioCtx();
  const t = ctx.currentTime;

  const bufLen = ctx.sampleRate * 0.04;
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen) * 0.15;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.08, t);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;

  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
}

function playAssetSound(name, fallback) {
  const url = SOUND_URLS[name];
  if (!url) {
    fallback?.();
    return;
  }

  let audio = soundCache.get(name);
  if (!audio) {
    audio = new Audio(url);
    audio.preload = 'auto';
    audio.crossOrigin = 'anonymous';
    soundCache.set(name, audio);
  }

  try {
    const voice = audio.cloneNode();
    voice.volume = name === 'footstep' ? 0.18 : 0.45;
    voice.play().catch(() => fallback?.());
  } catch {
    fallback?.();
  }
}

// ── Sound dispatcher ───────────────────────────────────────────────────────
const SOUNDS = {
  fire: () => playAssetSound('fire', playFireSound),
  impact: () => playAssetSound('impact', playImpactSound),
  reload: () => playAssetSound('reload', playReloadSound),
  hitConfirm: () => playAssetSound('hitConfirm', playHitConfirm),
  footstep: () => playAssetSound('footstep', playFootstep),
};

// ── Effects system factory ─────────────────────────────────────────────────
export function createEffectsSystem(scene, camera) {
  // Particle texture (try BabylonJS/Assets, fallback to data URL)
  let particleTex;
  try {
    particleTex = new Texture(FLARE_URL, scene);
  } catch {
    particleTex = new Texture(FALLBACK_TEX, scene);
  }

  // ── Muzzle flash pool ────────────────────────────────────────────────
  const muzzlePS = new ParticleSystem('muzzleFlash', 30, scene);
  muzzlePS.particleTexture = particleTex;
  muzzlePS.emitRate = 0;
  muzzlePS.minLifeTime = 0.04;
  muzzlePS.maxLifeTime = 0.08;
  muzzlePS.minSize = 0.1;
  muzzlePS.maxSize = 0.3;
  muzzlePS.color1 = new Color4(1, 0.9, 0.3, 1);
  muzzlePS.color2 = new Color4(1, 0.5, 0.1, 1);
  muzzlePS.colorDead = new Color4(1, 0.2, 0, 0);
  muzzlePS.blendMode = ParticleSystem.BLENDMODE_ADD;
  muzzlePS.gravity = new Vector3(0, 0, 0);
  muzzlePS.minEmitPower = 0.5;
  muzzlePS.maxEmitPower = 2;
  muzzlePS.direction1 = new Vector3(-0.3, -0.3, -0.3);
  muzzlePS.direction2 = new Vector3(0.3, 0.3, 0.3);
  muzzlePS.start();

  // ── Impact explosion pool ────────────────────────────────────────────
  const impactPS = new ParticleSystem('impact', 80, scene);
  impactPS.particleTexture = particleTex;
  impactPS.emitRate = 0;
  impactPS.minLifeTime = 0.2;
  impactPS.maxLifeTime = 0.6;
  impactPS.minSize = 0.08;
  impactPS.maxSize = 0.35;
  impactPS.color1 = new Color4(1, 0.7, 0.2, 1);
  impactPS.color2 = new Color4(1, 0.3, 0.05, 1);
  impactPS.colorDead = new Color4(0.3, 0.1, 0, 0);
  impactPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  impactPS.gravity = new Vector3(0, -6, 0);
  impactPS.minEmitPower = 2;
  impactPS.maxEmitPower = 8;
  impactPS.start();

  // ── Trail particles (reusable system) ────────────────────────────────
  const trailPS = new ParticleSystem('trail', 60, scene);
  trailPS.particleTexture = particleTex;
  trailPS.emitRate = 0;
  trailPS.minLifeTime = 0.1;
  trailPS.maxLifeTime = 0.25;
  trailPS.minSize = 0.03;
  trailPS.maxSize = 0.08;
  trailPS.color1 = new Color4(1, 0.8, 0.3, 0.8);
  trailPS.color2 = new Color4(1, 0.4, 0.1, 0.5);
  trailPS.colorDead = new Color4(0, 0, 0, 0);
  trailPS.blendMode = ParticleSystem.BLENDMODE_ADD;
  trailPS.gravity = new Vector3(0, 0, 0);
  trailPS.minEmitPower = 0;
  trailPS.maxEmitPower = 0.5;
  trailPS.start();

  // ── Screen shake state ───────────────────────────────────────────────
  let shakeIntensity = 0;
  const baseRotation = { x: 0, y: 0 };

  // ── Footstep state ──────────────────────────────────────────────────
  let footstepTimer = 0;

  return {
    muzzleFlash(position) {
      muzzlePS.emitter = position.clone();
      muzzlePS.manualEmitCount = 15;
    },

    bulletTrail(from, to) {
      const mid = Vector3.Lerp(from, to, 0.5);
      trailPS.emitter = mid;
      const dir = to.subtract(from).normalize();
      trailPS.direction1 = dir.scale(-0.5);
      trailPS.direction2 = dir.scale(0.5);
      trailPS.manualEmitCount = 8;
    },

    impactExplosion(point, normal) {
      impactPS.emitter = point.clone();
      const n = normal || new Vector3(0, 1, 0);
      impactPS.direction1 = n.add(new Vector3(-1, 0, -1)).scale(2);
      impactPS.direction2 = n.add(new Vector3(1, 2, 1)).scale(2);
      impactPS.manualEmitCount = 40;

      // Spawn a quick flash light at impact
      _spawnImpactLight(scene, point);
    },

    playSound(name) {
      const fn = SOUNDS[name];
      if (fn) fn();
    },

    screenShake(intensity = 0.03) {
      shakeIntensity = Math.max(shakeIntensity, intensity);
    },

    update(dt, isMoving, speed) {
      // Decay screen shake
      if (shakeIntensity > 0.001 && camera) {
        camera.rotation.x += (Math.random() - 0.5) * shakeIntensity;
        camera.rotation.y += (Math.random() - 0.5) * shakeIntensity;
        shakeIntensity *= 0.85;
      } else {
        shakeIntensity = 0;
      }

      // Footstep audio
      if (isMoving && speed > 1) {
        footstepTimer -= dt;
        if (footstepTimer <= 0) {
          playFootstep();
          footstepTimer = 0.4;
        }
      } else {
        footstepTimer = 0;
      }
    },
  };
}

// ── Quick impact point light ───────────────────────────────────────────────
function _spawnImpactLight(scene, point) {
  const light = new PointLight('impactFlash', point.clone(), scene);
  light.intensity = 8;
  light.diffuse = new Color3(1, 0.6, 0.2);
  light.range = 6;
  let life = 0.15;
  const obs = scene.onBeforeRenderObservable.add(() => {
    life -= scene.getEngine().getDeltaTime() / 1000;
    light.intensity = Math.max(0, life / 0.15) * 8;
    if (life <= 0) {
      scene.onBeforeRenderObservable.remove(obs);
      light.dispose();
    }
  });
}
