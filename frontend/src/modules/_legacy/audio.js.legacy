import * as THREE from 'three';

/**
 * Centralized Audio Manager for GLO KARTS
 * Handles BGM, UI SFX, and 3D Positional Audio using Three.js Web Audio API wrappers.
 */

const audioState = {
  listener: null,
  audioLoader: new THREE.AudioLoader(),
  bgm: null,
  uiSounds: new Map(),
  positionalSounds: new Map(),
  contextUnlocked: false,
  masterVolume: 0.5,
  sfxVolume: 0.8,
  bgmVolume: 0.4,
};

// Initialize the audio listener and attach it to the camera
export function initAudio(camera) {
  if (!audioState.listener) {
    audioState.listener = new THREE.AudioListener();
    // Set master volume
    audioState.listener.setMasterVolume(audioState.masterVolume);
  }
  
  // Attach to camera if provided and not already attached
  if (camera && !camera.children.includes(audioState.listener)) {
    camera.add(audioState.listener);
  }

  return audioState.listener;
}

// Unlock the AudioContext (must be called on first user interaction like a click)
export function unlockAudioContext() {
  if (audioState.contextUnlocked) return;
  
  const context = THREE.AudioContext.getContext();
  if (context.state === 'suspended') {
    context.resume().then(() => {
      console.log('✅ AudioContext unlocked');
      audioState.contextUnlocked = true;
      
      // If BGM was queued to play, play it now
      if (audioState.bgm && !audioState.bgm.isPlaying) {
        audioState.bgm.play();
      }
    });
  } else {
    audioState.contextUnlocked = true;
  }
}

// Play Background Music (BGM)
export function playBGM(filename, loop = true) {
  if (!audioState.listener) {
    console.warn('Audio listener not initialized. Call initAudio(camera) first.');
    return;
  }

  // Stop current BGM if playing
  if (audioState.bgm) {
    if (audioState.bgm.isPlaying) audioState.bgm.stop();
  } else {
    audioState.bgm = new THREE.Audio(audioState.listener);
  }

  const path = `/audio/music/${filename}`;
  
  audioState.audioLoader.load(path, (buffer) => {
    audioState.bgm.setBuffer(buffer);
    audioState.bgm.setLoop(loop);
    audioState.bgm.setVolume(audioState.bgmVolume);
    
    // Only play if context is unlocked, otherwise it will play when unlocked
    if (audioState.contextUnlocked) {
      audioState.bgm.play();
    }
  }, undefined, (err) => {
    console.error(`Failed to load BGM: ${path}`, err);
  });
}

export function stopBGM() {
  if (audioState.bgm && audioState.bgm.isPlaying) {
    audioState.bgm.stop();
  }
}

// Play a 2D UI Sound Effect
export function playUISound(filename) {
  if (!audioState.listener || !audioState.contextUnlocked) return;

  const path = `/audio/sfx/${filename}`;
  
  // Reuse audio objects if already created
  let sound = audioState.uiSounds.get(filename);
  
  if (!sound) {
    sound = new THREE.Audio(audioState.listener);
    audioState.uiSounds.set(filename, sound);
    
    audioState.audioLoader.load(path, (buffer) => {
      sound.setBuffer(buffer);
      sound.setVolume(audioState.sfxVolume);
      sound.play();
    });
  } else {
    if (sound.isPlaying) sound.stop();
    sound.play();
  }
}

// Create and attach a 3D Positional Sound to a mesh
export function createPositionalSound(mesh, filename, options = {}) {
  if (!audioState.listener) return null;

  const sound = new THREE.PositionalAudio(audioState.listener);
  const path = `/audio/sfx/${filename}`;
  
  const {
    loop = false,
    refDistance = 5,
    maxDistance = 100,
    volume = audioState.sfxVolume,
    autoplay = false
  } = options;

  audioState.audioLoader.load(path, (buffer) => {
    sound.setBuffer(buffer);
    sound.setRefDistance(refDistance);
    sound.setMaxDistance(maxDistance);
    sound.setVolume(volume);
    sound.setLoop(loop);
    
    if (autoplay && audioState.contextUnlocked) {
      sound.play();
    }
  });

  mesh.add(sound);
  return sound;
}

// Helper to update engine pitch based on speed
export function updateEngineSound(engineSound, speed, maxSpeed = 30) {
  if (!engineSound || !engineSound.isPlaying) return;
  
  // Base pitch is 0.8, max pitch is 1.8
  const normalizedSpeed = Math.min(Math.abs(speed) / maxSpeed, 1.0);
  const pitch = 0.8 + (normalizedSpeed * 1.0);
  
  engineSound.setPlaybackRate(pitch);
}
