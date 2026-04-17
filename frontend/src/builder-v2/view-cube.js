/**
 * view-cube.js — TinkerCad-style interactive 3D orientation cube.
 *
 * Renders a small Three.js scene inside a dedicated canvas showing a cube
 * whose faces are labelled FRONT / BACK / LEFT / RIGHT / TOP / BOTTOM.
 * The cube rotates to mirror the main camera orientation. Click a face
 * (or click-and-drag) to snap or orbit the main camera.
 *
 * Styled to match the project's liquid-glass / dark-frosted aesthetic.
 */
import * as THREE from 'three';

/* ── Palette (mirrors CSS variables) ─────────────────── */
const FACE_COLOURS = {
  front:  0x1a1a2e,
  back:   0x1a1a2e,
  left:   0x16162a,
  right:  0x16162a,
  top:    0x1e1e36,
  bottom: 0x111122,
};
const FACE_OPACITY  = 0.72;
const EDGE_COLOR    = 0xff0080;   // --bv2-accent
const EDGE_OPACITY  = 0.30;
const HOVER_COLOR   = 0xff0080;   // accent on hover
const HOVER_OPACITY = 0.92;
const SIZE = 1;

const FACE_MAP = [
  { name: 'right',  normal: new THREE.Vector3( 1, 0, 0), idx: 0 },
  { name: 'left',   normal: new THREE.Vector3(-1, 0, 0), idx: 1 },
  { name: 'top',    normal: new THREE.Vector3( 0, 1, 0), idx: 2 },
  { name: 'bottom', normal: new THREE.Vector3( 0,-1, 0), idx: 3 },
  { name: 'front',  normal: new THREE.Vector3( 0, 0, 1), idx: 4 },
  { name: 'back',   normal: new THREE.Vector3( 0, 0,-1), idx: 5 },
];

export class ViewCube {
  /**
   * @param {HTMLCanvasElement} canvas  — dedicated small canvas for the cube
   * @param {() => {azimuth: number, polar: number}} getMainAngles
   * @param {(view: string) => void} onClickFace
   */
  constructor(canvas, getMainAngles, onClickFace) {
    this._canvas = canvas;
    this._getAngles = getMainAngles;
    this._onClickFace = onClickFace;
    this._hoveredFace = null;
    this._isDragging = false;
    this._dragStart = { x: 0, y: 0 };
    this._dragLast  = { x: 0, y: 0 };
    this._onDragRotate = null; // callback: (deltaAzimuth, deltaPolar) => void

    const w = canvas.width = 140;
    const h = canvas.height = 140;

    this._renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(w, h, false);

    this._scene = new THREE.Scene();

    this._camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    this._camera.position.set(0, 0, 3.8);

    // Cube mesh — one translucent material per face (frosted glass look)
    const geo = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    this._materials = FACE_MAP.map(f =>
      new THREE.MeshPhysicalMaterial({
        color: FACE_COLOURS[f.name],
        transparent: true,
        opacity: FACE_OPACITY,
        roughness: 0.55,
        metalness: 0.1,
        clearcoat: 0.4,
        clearcoatRoughness: 0.35,
        side: THREE.FrontSide,
      })
    );
    this._cube = new THREE.Mesh(geo, this._materials);
    this._scene.add(this._cube);

    // Wireframe edges (accent glow)
    const edges = new THREE.EdgesGeometry(geo);
    const edgeMat = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
      linewidth: 1,
    });
    const line = new THREE.LineSegments(edges, edgeMat);
    this._cube.add(line);

    // Face labels (canvas textures on transparent sprites)
    this._addFaceLabels();

    // Lighting — brighter ambient for glass readability + subtle directional
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.80));
    const dir = new THREE.DirectionalLight(0xffeef4, 0.55);  // warm pink tint
    dir.position.set(2, 3, 4);
    this._scene.add(dir);

    // Raycaster for hover/click
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    canvas.addEventListener('pointermove', this._onPointerMove.bind(this));
    canvas.addEventListener('pointerdown', this._onPointerDown.bind(this));
    canvas.addEventListener('pointerup', this._onPointerUp.bind(this));
    canvas.addEventListener('pointerleave', this._onPointerLeave.bind(this));
    canvas.style.cursor = 'grab';
  }

  /** Enable click-and-drag orbit: callback receives (deltaAzimuth, deltaPolar) in radians */
  set onDragRotate(fn) { this._onDragRotate = fn; }

  _addFaceLabels() {
    const labels = [
      { text: 'RIGHT', pos: [0.501, 0, 0],  rot: [0, Math.PI / 2, 0] },
      { text: 'LEFT',  pos: [-0.501, 0, 0], rot: [0, -Math.PI / 2, 0] },
      { text: 'TOP',   pos: [0, 0.501, 0],  rot: [-Math.PI / 2, 0, 0] },
      { text: 'BTM',   pos: [0, -0.501, 0], rot: [Math.PI / 2, 0, 0] },
      { text: 'FRONT', pos: [0, 0, 0.501],  rot: [0, 0, 0] },
      { text: 'BACK',  pos: [0, 0, -0.501], rot: [0, Math.PI, 0] },
    ];

    for (const { text, pos, rot } of labels) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'rgba(255,255,255,0.70)';
      ctx.font = '700 24px "Exo 2", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 64);

      const tex = new THREE.CanvasTexture(c);
      tex.minFilter = THREE.LinearFilter;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(0.5, 0.5, 1);
      sprite.position.set(...pos);
      // Sprites auto-face camera; position them just outside face
      this._cube.add(sprite);
    }
  }

  _ndc(e) {
    const r = this._canvas.getBoundingClientRect();
    this._pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this._pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  _hitFace() {
    this._raycaster.setFromCamera(this._pointer, this._camera);
    const hits = this._raycaster.intersectObject(this._cube, false);
    if (!hits.length) return null;
    const faceIdx = Math.floor(hits[0].faceIndex / 2);
    return FACE_MAP[faceIdx] || null;
  }

  _onPointerMove(e) {
    if (this._isDragging && this._onDragRotate) {
      const dx = e.clientX - this._dragLast.x;
      const dy = e.clientY - this._dragLast.y;
      this._dragLast.x = e.clientX;
      this._dragLast.y = e.clientY;
      // Convert pixel delta to radians (sensitivity)
      this._onDragRotate(-dx * 0.008, -dy * 0.008);
      return;
    }

    this._ndc(e);
    const face = this._hitFace();
    if (face !== this._hoveredFace) {
      // Reset previous
      if (this._hoveredFace) {
        const m = this._materials[this._hoveredFace.idx];
        m.color.setHex(FACE_COLOURS[this._hoveredFace.name]);
        m.opacity = FACE_OPACITY;
      }
      this._hoveredFace = face;
      if (face) {
        const m = this._materials[face.idx];
        m.color.setHex(HOVER_COLOR);
        m.opacity = HOVER_OPACITY;
      }
      this._canvas.style.cursor = face ? 'pointer' : 'grab';
    }
  }

  _onPointerDown(e) {
    this._dragStart = { x: e.clientX, y: e.clientY };
    this._dragLast  = { x: e.clientX, y: e.clientY };
    this._isDragging = true;
    this._dragFace = this._hoveredFace;
    this._canvas.setPointerCapture(e.pointerId);
    this._canvas.style.cursor = 'grabbing';
  }

  _onPointerUp(e) {
    const wasDrag = this._isDragging;
    this._isDragging = false;
    this._canvas.style.cursor = this._hoveredFace ? 'pointer' : 'grab';

    // If minimal movement, treat as a click
    const dx = Math.abs(e.clientX - this._dragStart.x);
    const dy = Math.abs(e.clientY - this._dragStart.y);
    if (wasDrag && dx < 4 && dy < 4 && this._dragFace) {
      this._onClickFace(this._dragFace.name);
    }
  }

  _onPointerLeave() {
    if (this._hoveredFace) {
      const m = this._materials[this._hoveredFace.idx];
      m.color.setHex(FACE_COLOURS[this._hoveredFace.name]);
      m.opacity = FACE_OPACITY;
      this._hoveredFace = null;
    }
    this._isDragging = false;
    this._canvas.style.cursor = 'grab';
  }

  /** Call every frame — syncs cube orientation to main camera */
  update() {
    const { azimuth, polar } = this._getAngles();
    // Rotate the cube to match the main camera's spherical angles
    // azimuth = rotation around Y, polar = tilt toward/away from Y
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler(-(polar - Math.PI / 2), -azimuth, 0, 'YXZ');
    q.setFromEuler(euler);
    this._cube.quaternion.copy(q);

    this._renderer.render(this._scene, this._camera);
  }

  dispose() {
    this._renderer.dispose();
    this._materials.forEach(m => m.dispose());
  }
}
