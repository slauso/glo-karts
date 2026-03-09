/**
 * post-processing.js
 * Three.js EffectComposer pipeline for GLO KARTS.
 *
 * Effects (in order):
 *  1. RenderPass   – standard scene render
 *  2. UnrealBloomPass – subtle glow on bright headlights / fire / boost FX
 *  3. SMAAPass     – fast sub-pixel morphological anti-aliasing
 *  4. OutputPass   – ACESFilmic tone-mapping + sRGB colour-space conversion
 *
 * Usage:
 *   const pp = initPostProcessing(renderer, scene, camera);
 *   // in animate loop:
 *   pp.composer.render();
 *   // in resize handler:
 *   pp.resize(innerWidth, innerHeight);
 */

import * as THREE from 'three';
import { EffectComposer }  from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass }        from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { OutputPass }      from 'three/examples/jsm/postprocessing/OutputPass.js';

export function initPostProcessing(renderer, scene, camera) {
  // Switch to ACESFilmic tone-mapping for punchy colours
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  // Modern Three.js colour-space (replaces deprecated outputEncoding)
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);

  // 1. Standard scene render
  composer.addPass(new RenderPass(scene, camera));

  // 2. Subtle bloom – only very bright objects glow (headlights, boost sparks)
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.28,   // strength  – keep subtle so it doesn't look washed-out
    0.55,   // radius
    0.84    // threshold – only pixels brighter than this bloom
  );
  composer.addPass(bloomPass);

  // 3. SMAA anti-aliasing (better quality than FXAA, free at kart resolution)
  const smaaPass = new SMAAPass(w * dpr, h * dpr);
  composer.addPass(smaaPass);

  // 4. Tone-map + colour-space output (replaces the old renderer.outputEncoding path)
  composer.addPass(new OutputPass());

  /** Call this whenever the canvas is resized */
  function resize(width, height) {
    composer.setSize(width, height);
    bloomPass.resolution.set(width, height);
    smaaPass.setSize(width * dpr, height * dpr);
  }

  return { composer, bloomPass, smaaPass, resize };
}
