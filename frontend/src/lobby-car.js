// GLO Karts — Kart Preview (lobby-car.js)
// Renamed STK characters, 3D underglow, Pick-your-GLO system

// ── Kart roster with GLO-Karts character names ──────────────────
const STK_KARTS = [
  { id: 'tux',             name: 'Stephen' },
  { id: 'adiumy',          name: 'Angela'  },
  { id: 'nolok',           name: 'Fred'    },
  { id: 'wilber',          name: 'Mia'     },
  { id: 'xue',             name: 'Pat'     },
  { id: 'hexley',          name: 'Wes'     },
  { id: 'gavroche',        name: 'James'   },
  { id: 'emule',           name: 'Luca'    },
  { id: 'kiki',            name: 'Grace'   },
  { id: 'beastie',         name: 'John'    },
  { id: 'amanda',          name: 'Olivia'  },
  { id: 'suzanne',         name: 'Lisa'    },
  { id: 'gnu',             name: 'Christi' },
  { id: 'konqi',           name: 'Judy'    },
  { id: 'sara_the_racer',  name: 'Carrie'  },
  { id: 'sara_the_wizard', name: 'Gianna'  },
  { id: 'puffy',           name: 'Anthony' },
  { id: 'pidgin',          name: 'Zane'    },
];

// ── GLO effect definitions (saved to sessionStorage for in-game replication) ──
const GLO_EFFECTS = [
  { id: 'solid',      label: 'Solid',          desc: 'Constant single colour' },
  { id: 'pulse',      label: 'Pulse',           desc: 'Breathes in and out' },
  { id: 'strobe',     label: 'Strobe',          desc: 'Fast flash' },
  { id: 'rainbow',    label: 'Rainbow Cycle',   desc: 'HSL rotation' },
  { id: 'two-color',  label: 'Two-Color Swap',  desc: 'Alternates between two colours' },
  { id: 'chase',      label: 'Chase',           desc: 'Running light sweep' },
];

const DEFAULT_GLO_COLOR  = '#ff0080';
const DEFAULT_GLO_COLOR2 = '#00e5ff';
const DEFAULT_GLO_EFFECT = 'solid';

// ── Persistent GLO state ─────────────────────────────────────────
let gloColor   = sessionStorage.getItem('gloColor')   || DEFAULT_GLO_COLOR;
let gloColor2  = sessionStorage.getItem('gloColor2')  || DEFAULT_GLO_COLOR2;
let gloEffect  = sessionStorage.getItem('gloEffect')  || DEFAULT_GLO_EFFECT;

function saveGlo() {
  sessionStorage.setItem('gloColor',  gloColor);
  sessionStorage.setItem('gloColor2', gloColor2);
  sessionStorage.setItem('gloEffect', gloEffect);
}

// ── Colour palette for the quick-swatch row ──────────────────────
const PALETTE = [
  '#ff0080','#ff4400','#ff9900','#ffee00',
  '#00ff44','#00e5ff','#3399ff','#9933ff',
  '#ff33cc','#ffffff','#888888','#000000',
];

// ── Three.js helpers ─────────────────────────────────────────────
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  return { r, g, b };
}

// ── Main class ───────────────────────────────────────────────────
class KartPreview {
  constructor() {
    this.container = document.getElementById('car-model-container');
    this.scene     = null;
    this.camera    = null;
    this.renderer  = null;
    this.kart      = null;
    this.isInitialized    = false;
    this.kartRotation     = 0;
    this.kartRotationSpeed = 0.008;

    // Underglow meshes
    this.glowDisc      = null;   // central wide flat disc
    this.glowHalo      = null;   // outer point-light glow plane
    this.glowLight     = null;   // PointLight
    this.glowTime      = 0;

    const savedId = sessionStorage.getItem('selectedKart') || 'tux';
    this.currentIndex = STK_KARTS.findIndex(k => k.id === savedId);
    if (this.currentIndex < 0) this.currentIndex = 0;

    this.init();
    this.setupNavButtons();
    this.updateKartInfo();
    this.buildGloPicker();
  }

  // ── Three.js scene setup ────────────────────────────────────────
  init() {
    if (!this.container) return;

    this.scene = new THREE.Scene();

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 6, 4); key.castShadow = true;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xff44aa, 0.5);
    rim.position.set(-4, 2, -3); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8888ff, 0.25);
    fill.position.set(0, -2, 5); this.scene.add(fill);

    // GLO point light (dynamic colour)
    this.glowLight = new THREE.PointLight(0xff0080, 3.5, 7);
    this.glowLight.position.set(0, 0.15, 0);
    this.scene.add(this.glowLight);

    // Camera
    const w = this.container.clientWidth  || 400;
    const h = this.container.clientHeight || 300;
    this.camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 200);
    this.camera.position.set(0, 1.6, 5);
    this.camera.lookAt(0, 0.5, 0);

    // Renderer — transparent so panel glass shows behind
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.createUnderglow();
    this.loadKart(STK_KARTS[this.currentIndex].id);

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this.animate();
  }

  // ── Underglow: a layered 3D gradient disc ─────────────────────
  createUnderglow() {
    // Outer diffuse glow — large additive plane that fades at edges
    const outerGeo = new THREE.CircleGeometry(2.4, 64);
    const outerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(gloColor),
      transparent: true,
      opacity: 0,            // driven in animate()
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Vertex-colour fade: set alpha per vertex (inner=1, outer=0)
    const posAttr = outerGeo.attributes.position;
    const colArr = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i), z = posAttr.getZ(i);
      const r = Math.hypot(x, z) / 2.4;
      const v = 1 - r;
      colArr[i*3]   = v;
      colArr[i*3+1] = v;
      colArr[i*3+2] = v;
    }
    outerGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    outerMat.vertexColors = true;
    this.glowHalo = new THREE.Mesh(outerGeo, outerMat);
    this.glowHalo.rotation.x = -Math.PI / 2;
    this.glowHalo.position.y = 0.04;
    this.scene.add(this.glowHalo);

    // Inner bright core disc
    const innerGeo = new THREE.CircleGeometry(0.75, 48);
    const innerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(gloColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowDisc = new THREE.Mesh(innerGeo, innerMat);
    this.glowDisc.rotation.x = -Math.PI / 2;
    this.glowDisc.position.y = 0.02;
    this.scene.add(this.glowDisc);
  }

  // ── Animate underglow per-frame ───────────────────────────────
  updateUnderglow(dt) {
    this.glowTime += dt;
    const t = this.glowTime;
    let intensity = 1;  // 0-1 multiplier
    let c1 = new THREE.Color(gloColor);
    let c2 = new THREE.Color(gloColor2);
    let col = c1.clone();

    switch (gloEffect) {
      case 'solid':
        intensity = 1;
        break;
      case 'pulse':
        intensity = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.5));
        break;
      case 'strobe':
        intensity = Math.floor(t * 12) % 2 === 0 ? 1 : 0.05;
        break;
      case 'rainbow': {
        const hue = (t * 0.18) % 1;
        col.setHSL(hue, 1, 0.55);
        intensity = 0.85;
        break;
      }
      case 'two-color': {
        const blend = 0.5 + 0.5 * Math.sin(t * 2);
        col.lerpColors(c1, c2, blend);
        intensity = 0.9;
        break;
      }
      case 'chase': {
        intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 3));
        const hue2 = (t * 0.08) % 1;
        col.setHSL(hue2, 1, 0.55);
        break;
      }
    }

    // Apply colour & opacity
    if (this.glowDisc) {
      this.glowDisc.material.color.copy(col);
      this.glowDisc.material.opacity = 0.90 * intensity;
    }
    if (this.glowHalo) {
      this.glowHalo.material.color.copy(col);
      this.glowHalo.material.opacity = 0.55 * intensity;
    }
    if (this.glowLight) {
      this.glowLight.color.copy(col);
      this.glowLight.intensity = 3.5 * intensity;
    }
  }

  // ── Load a kart GLB ──────────────────────────────────────────
  loadKart(id) {
    const loader = new THREE.GLTFLoader();
    if (this.kart) { this.scene.remove(this.kart); this.kart = null; this.isInitialized = false; }
    const nameEl = document.getElementById('kart-name');
    if (nameEl) nameEl.textContent = '...';

    loader.load(
      `/models/stk/karts/${id}/kart.glb`,
      (gltf) => {
        this.kart = gltf.scene;
        const box    = new THREE.Box3().setFromObject(this.kart);
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = 2.2 / maxDim;
        this.kart.scale.setScalar(scale);
        const box2   = new THREE.Box3().setFromObject(this.kart);
        const center = box2.getCenter(new THREE.Vector3());
        const minY   = box2.min.y;
        this.kart.position.set(-center.x, -minY, -center.z);
        this.kart.rotation.y = this.kartRotation;
        this.kart.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        this.scene.add(this.kart);
        this.isInitialized = true;
        this.updateKartInfo();
      },
      undefined,
      (err) => {
        console.error(`[KartPreview] Failed: ${id}`, err);
        if (nameEl) nameEl.textContent = STK_KARTS[this.currentIndex].name;
      }
    );
  }

  updateKartInfo() {
    const k = STK_KARTS[this.currentIndex];
    const nameEl  = document.getElementById('kart-name');
    const indexEl = document.getElementById('kart-index');
    if (nameEl)  nameEl.textContent  = k.name;
    if (indexEl) indexEl.textContent = `${this.currentIndex + 1} / ${STK_KARTS.length}`;
    sessionStorage.setItem('selectedKart',     k.id);
    sessionStorage.setItem('selectedKartName', k.name);
    document.dispatchEvent(new CustomEvent('kartChanged', { detail: { kartId: k.id, kartName: k.name } }));
  }

  setupNavButtons() {
    const prevBtn = document.getElementById('kart-prev-btn');
    const nextBtn = document.getElementById('kart-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevKart());
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextKart());
    document.addEventListener('keydown', (e) => {
      if (document.activeElement && ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
      if (e.key === 'ArrowLeft')  this.prevKart();
      if (e.key === 'ArrowRight') this.nextKart();
    });
  }

  prevKart() { this.currentIndex = (this.currentIndex - 1 + STK_KARTS.length) % STK_KARTS.length; this.loadKart(STK_KARTS[this.currentIndex].id); }
  nextKart() { this.currentIndex = (this.currentIndex + 1) % STK_KARTS.length; this.loadKart(STK_KARTS[this.currentIndex].id); }

  onWindowResize() {
    if (!this.camera || !this.renderer || !this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    const dt = Math.min(0.05, this.renderer?.info ? 0.016 : 0.016);
    if (this.kart && this.isInitialized) { this.kartRotation += this.kartRotationSpeed; this.kart.rotation.y = this.kartRotation; }
    this.updateUnderglow(dt);
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  // ── Pick-your-GLO panel builder ───────────────────────────────
  buildGloPicker() {
    const container = document.getElementById('glo-picker-container');
    if (!container) return;

    // ── EFFECT buttons ──────────────────────────────────────────
    const effectRow = container.querySelector('#glo-effects-row');
    if (effectRow) {
      GLO_EFFECTS.forEach(ef => {
        const btn = document.createElement('button');
        btn.className = 'glo-effect-btn' + (gloEffect === ef.id ? ' active' : '');
        btn.dataset.effect = ef.id;
        btn.title = ef.desc;
        btn.textContent = ef.label;
        btn.addEventListener('click', () => {
          gloEffect = ef.id;
          saveGlo();
          effectRow.querySelectorAll('.glo-effect-btn').forEach(b => b.classList.toggle('active', b.dataset.effect === gloEffect));
          // Show second-colour row only for effects that need it
          const needs2 = ['two-color'].includes(gloEffect);
          const row2 = container.querySelector('#glo-color2-row');
          if (row2) row2.style.display = needs2 ? 'flex' : 'none';
        });
        effectRow.appendChild(btn);
      });
    }

    // ── Primary colour swatch palette ───────────────────────────
    const swatchRow = container.querySelector('#glo-swatches');
    if (swatchRow) {
      PALETTE.forEach(hex => {
        const sw = document.createElement('div');
        sw.className = 'glo-swatch' + (hex === gloColor ? ' active' : '');
        sw.style.background = hex;
        sw.dataset.color = hex;
        sw.title = hex;
        sw.addEventListener('click', () => {
          gloColor = hex;
          const picker = container.querySelector('#glo-color-picker');
          if (picker) picker.value = hex;
          saveGlo();
          swatchRow.querySelectorAll('.glo-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === hex));
        });
        swatchRow.appendChild(sw);
      });
    }

    // ── Custom colour picker (primary) ───────────────────────────
    const colorPicker = container.querySelector('#glo-color-picker');
    if (colorPicker) {
      colorPicker.value = gloColor;
      colorPicker.addEventListener('input', (e) => {
        gloColor = e.target.value;
        saveGlo();
        if (swatchRow) swatchRow.querySelectorAll('.glo-swatch').forEach(s => s.classList.remove('active'));
      });
    }

    // ── Second colour picker (for two-color effect) ───────────────
    const colorPicker2 = container.querySelector('#glo-color-picker2');
    if (colorPicker2) {
      colorPicker2.value = gloColor2;
      colorPicker2.addEventListener('input', (e) => { gloColor2 = e.target.value; saveGlo(); });
    }

    // ── Show/hide second colour row ───────────────────────────────
    const row2 = container.querySelector('#glo-color2-row');
    if (row2) row2.style.display = ['two-color'].includes(gloEffect) ? 'flex' : 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => { new KartPreview(); });
