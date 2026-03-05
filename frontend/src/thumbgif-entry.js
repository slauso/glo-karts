// thumbgif-entry.js — drives a 15-second camera orbit around a track/arena model.
// Loaded by thumbgif-render.html, captured as video by gen-gifs.cjs.
//
// Timeline:
//   t=0    model loads, warmup renders start
//   t=+3s  document.title = 'ORBIT_START' — gen-gifs begins recording
//   t=+18s document.title = 'ORBIT_DONE'  — gen-gifs stops recording (15 s of footage)

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = 400, H = 250;
const params = new URLSearchParams(window.location.search);
const id   = params.get('id')   || 'cocoa_temple';
const mode = params.get('mode') || 'race';

const WARMUP_MS  = 3_000;   // texture warm-up before recording starts
const ORBIT_MS   = 15_000;  // duration of the recording orbit
const ORBIT_REVS = 1.0;     // full rotations during orbit (1 = one 360° sweep)

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x0d0d12, 1);
document.body.appendChild(renderer.domElement);

// ── Scene / lights ──────────────────────────────────────────────────────────
const scene = new THREE.Scene();

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
    const box0    = new THREE.Box3().setFromObject(model);
    const size0   = box0.getSize(new THREE.Vector3());
    const maxDim0 = Math.max(size0.x, size0.y, size0.z);
    model.scale.setScalar(18 / (maxDim0 || 1));

    // Recompute bounding box after scale
    const box1    = new THREE.Box3().setFromObject(model);
    const size1   = box1.getSize(new THREE.Vector3());
    const center1 = box1.getCenter(new THREE.Vector3());
    const maxDim1 = Math.max(size1.x, size1.y, size1.z);

    // Anchor focal point to driving surface (bottom 15% of Y extent)
    const surfaceY = box1.min.y + size1.y * 0.15;
    model.position.set(-center1.x, -surfaceY, -center1.z);
    scene.add(model);

    // Camera distance: snug 1.2× framing so track fills the frame
    const halfFovRad = (camera.fov * 0.5) * (Math.PI / 180);
    const fitDist    = (maxDim1 * 0.5 / Math.tan(halfFovRad)) * 1.2;

    const elevDeg = mode === 'battle' ? 48 : 55;
    const elevRad = elevDeg * (Math.PI / 180);

    camera.near = fitDist * 0.01;
    camera.far  = fitDist * 4;
    camera.updateProjectionMatrix();

    // ── Animate ──────────────────────────────────────────────────────────────
    let orbitStart = null;
    let warmupStart = performance.now();

    function animate() {
      requestAnimationFrame(animate);

      const now        = performance.now();
      const warmupAge  = now - warmupStart;

      if (orbitStart === null) {
        // Warmup phase: render static frame until textures fully upload
        const angle = 0;
        camera.position.set(
          fitDist * Math.cos(elevRad) * Math.sin(angle),
          fitDist * Math.sin(elevRad),
          fitDist * Math.cos(elevRad) * Math.cos(angle)
        );
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);

        if (warmupAge >= WARMUP_MS) {
          orbitStart = now;
          document.title = 'ORBIT_START'; // signal: begin recording
        }
      } else {
        // Orbit phase
        const elapsed = now - orbitStart;
        const t = Math.min(elapsed / ORBIT_MS, 1.0);
        const angle = t * ORBIT_REVS * Math.PI * 2;

        camera.position.set(
          fitDist * Math.cos(elevRad) * Math.sin(angle),
          fitDist * Math.sin(elevRad),
          fitDist * Math.cos(elevRad) * Math.cos(angle)
        );
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);

        if (elapsed >= ORBIT_MS) {
          document.title = 'ORBIT_DONE'; // signal: stop recording
        }
      }
    }

    animate();
  },
  undefined,
  (err) => {
    console.error('[thumbgif] Failed to load:', id, err);
    document.title = 'ERROR';
  }
);
