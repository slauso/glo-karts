// thumbnail-entry.js — renders one track/arena to <canvas> for screenshot capture.
// Loaded by thumbnail-render.html, which is hit by gen-thumbs.cjs.
// Sets document.title = 'READY' when the frame is rendered.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = 600, H = 380;
const params = new URLSearchParams(window.location.search);
const id   = params.get('id')   || 'cocoa_temple';
const mode = params.get('mode') || 'race';

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x0d0d12, 1);
document.body.appendChild(renderer.domElement);

// ── Scene / lights ──────────────────────────────────────────────────────────
const scene = new THREE.Scene();
{
  const ambient = new THREE.AmbientLight(0xffffff, 1.4);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xc0d8ff, 0.6);
  fill.position.set(-4, 2, -6);
  scene.add(fill);

  const under = new THREE.DirectionalLight(0xffffff, 0.25);
  under.position.set(0, -1, 0);
  scene.add(under);
}

// ── Camera ──────────────────────────────────────────────────────────────────
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);

// ── Load model ───────────────────────────────────────────────────────────────
const modelPath = mode === 'battle'
  ? `/models/stk/arenas/${id}/arena.glb`
  : `/models/stk/tracks/${id}/track.glb`;

const loader = new GLTFLoader();
loader.load(
  modelPath,
  (gltf) => {
    const model = gltf.scene;

    // Fix materials
    model.traverse(child => {
      if (!child.isMesh) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(mat => {
        if (!mat) return;
        mat.side = THREE.DoubleSide;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      });
    });

    // Normalise to 18 world-units
    const box0  = new THREE.Box3().setFromObject(model);
    const size0 = box0.getSize(new THREE.Vector3());
    const maxDim0 = Math.max(size0.x, size0.y, size0.z);
    model.scale.setScalar(18 / (maxDim0 || 1));

    // Recompute after scale
    const box1    = new THREE.Box3().setFromObject(model);
    const size1   = box1.getSize(new THREE.Vector3());
    const center1 = box1.getCenter(new THREE.Vector3());
    const maxDim1 = Math.max(size1.x, size1.y, size1.z);

    // Anchor focal point to driving-surface layer (bottom 15 % of Y extent)
    const surfaceY = box1.min.y + size1.y * 0.15;
    model.position.set(-center1.x, -surfaceY, -center1.z);
    scene.add(model);

    // Camera: snug framing (1.2×) shows the whole layout with a small margin
    const halfFovRad = (camera.fov * 0.5) * (Math.PI / 180);
    const fitDist    = (maxDim1 * 0.5 / Math.tan(halfFovRad)) * 1.2;

    // Tracks: 55° elevation (layout readable from above)
    // Arenas: 48° elevation (slightly more front-on, 3-D feel)
    const elevDeg = mode === 'battle' ? 48 : 55;
    const elevRad = elevDeg * (Math.PI / 180);
    camera.position.set(0, fitDist * Math.sin(elevRad), fitDist * Math.cos(elevRad));
    camera.lookAt(0, 0, 0);
    camera.near = fitDist * 0.01;
    camera.far  = fitDist * 4;
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);

    // Render 5 more frames so GPU texture uploads finish before we signal READY.
    // (Single render calls can produce blank/washed-out output for texture-heavy GLBs.)
    let warmFrames = 0;
    function warmup() {
      renderer.render(scene, camera);
      warmFrames++;
      if (warmFrames < 5) {
        requestAnimationFrame(warmup);
      } else {
        document.title = 'READY';
      }
    }
    requestAnimationFrame(warmup);
  },
  undefined,
  (err) => {
    console.error('[thumb] Failed:', id, err);
    document.title = 'ERROR';
  }
);
