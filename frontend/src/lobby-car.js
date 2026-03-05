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

  { id: 'konqi',           name: 'Judy'    },
  { id: 'sara_the_racer',  name: 'Carrie'  },
  { id: 'sara_the_wizard', name: 'Gianna'  },
  { id: 'puffy',           name: 'Anthony' },
  { id: 'pidgin',          name: 'Zane'    },
  { id: 'beagle_2',        name: 'Walter'  },
];

// ── GLO effect definitions (saved to sessionStorage for in-game replication) ──
const GLO_EFFECTS = [
  // ── Classic ──────────────────────────────────────────────────────
  { id: 'solid',          label: 'Solid',           category: 'Classic',         desc: 'Constant single colour' },
  { id: 'pulse',          label: 'Pulse',            category: 'Classic',         desc: 'Breathes in and out' },
  { id: 'strobe',         label: 'Strobe',           category: 'Classic',         desc: 'Fast flash' },
  { id: 'rainbow',        label: 'Rainbow Cycle',    category: 'Classic',         desc: 'HSL hue rotation' },
  { id: 'two-color',      label: 'Two-Color',        category: 'Classic',         desc: 'Alternates between two colours' },
  { id: 'chase',          label: 'Chase',            category: 'Classic',         desc: 'Running light sweep' },
  // ── Warm & Sky ─────────────────────────────────────────────────
  { id: 'sunrise',        label: 'Sunrise',          category: 'Warm & Sky',      desc: 'Warm dawn rising from deep purple to gold' },
  { id: 'sunset',         label: 'Sunset',           category: 'Warm & Sky',      desc: 'Orange to magenta to violet dusk gradient' },
  { id: 'sunset-glow',    label: 'Sunset Glow',      category: 'Warm & Sky',      desc: 'Intense amber and hot-coral pulse' },
  { id: 'fire',           label: 'Fire',             category: 'Warm & Sky',      desc: 'Rapid red, orange and yellow flicker' },
  { id: 'falling-leaves', label: 'Falling Leaves',   category: 'Warm & Sky',      desc: 'Autumn orange, red and brown flutter' },
  // ── Nature ───────────────────────────────────────────────────────
  { id: 'spring',         label: 'Spring',           category: 'Nature',          desc: 'Soft pink, mint and lavender blend' },
  { id: 'full-rainbow',   label: 'Rainbow',          category: 'Nature',          desc: 'Full colour-wheel sweep' },
  { id: 'aurora',         label: 'Aurora',           category: 'Nature',          desc: 'Northern lights — green, teal and purple shimmer' },
  { id: 'forest',         label: 'Forest',           category: 'Nature',          desc: 'Deep earthy greens with slow pulse' },
  { id: 'spring-wind',    label: 'Spring Wind',      category: 'Nature',          desc: 'Light pastel breezy cycle' },
  { id: 'falling-petals', label: 'Falling Petals',   category: 'Nature',          desc: 'Soft pink and white flutter' },
  { id: 'firefly',        label: 'Firefly',          category: 'Nature',          desc: 'Sporadic warm blinks on a dark background' },
  // ── Water & Weather ──────────────────────────────────────────────
  { id: 'ocean',          label: 'Ocean',            category: 'Water & Weather', desc: 'Deep navy to bright cyan flow' },
  { id: 'waterfall',      label: 'Waterfall',        category: 'Water & Weather', desc: 'Cascading blue-white shimmer' },
  { id: 'river',          label: 'River',            category: 'Water & Weather', desc: 'Flowing teal-blue current' },
  { id: 'wave',           label: 'Wave',             category: 'Water & Weather', desc: 'Ocean-blue sine-wave sweep' },
  { id: 'raining',        label: 'Raining',          category: 'Water & Weather', desc: 'Cool blue-grey rain shimmer' },
  { id: 'snowing',        label: 'Snowing',          category: 'Water & Weather', desc: 'Cool silver-blue with ice sparkle' },
  { id: 'cloudy',         label: 'Cloudy',           category: 'Water & Weather', desc: 'Slow grey-blue drift' },
  { id: 'water-drop',     label: 'Water Drop',       category: 'Water & Weather', desc: 'Bright blue ripple pulse' },
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
  // Tell the background canvas to immediately resync its palette
  document.dispatchEvent(new CustomEvent('gloChanged'));
}

// ── Colour palette for the quick-swatch row ──────────────────────
const PALETTE = [
  '#ff0080','#ff4400','#ff9900','#ffee00',
  '#00ff44','#00e5ff','#3399ff','#9933ff',
  '#ff33cc','#ffffff','#888888','#000000',
];

// ── Three.js helpers ─────────────────────────────────────────────

/**
 * Smoothly blend through an array of hex colours.
 * @param {string[]} hexArr - colour stops
 * @param {number}   t      - normalised time [0, 1) — use (elapsed / period)
 */
function _gradColors(hexArr, t) {
  const n  = hexArr.length;
  const s  = (((t % 1) + 1) % 1) * n;
  const i  = Math.floor(s) % n;
  const a  = new THREE.Color(hexArr[i]);
  const b  = new THREE.Color(hexArr[(i + 1) % n]);
  return a.lerp(b, s - Math.floor(s));
}

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

    // Drag-to-rotate state
    this._isDragging    = false;
    this._dragLastX     = 0;
    this._userRotating  = false; // true = user dragged, auto-rotate paused

    // Underglow meshes
    this.glowDisc      = null;   // central wide flat disc
    this.glowHalo      = null;   // outer point-light glow plane
    this.glowLight     = null;   // PointLight
    this.glowTime      = 0;

    // Showroom effects
    this._orbitLight   = null;   // orbiting accent light
    this._showTime     = 0;      // shared timer for bob + orbit
    this._kartBaseY    = 0;      // rest Y after placement
    this._lastFrame    = 0;      // for real delta-time
    this._boundAnimate = this.animate.bind(this); // avoid per-frame alloc

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
    this.camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 200);
    this.camera.position.set(0, 2.4, 4.77);
    this.camera.lookAt(0, 0.72, 0);

    // Renderer — transparent so panel glass shows behind
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this._setupDragRotation();
    this.createUnderglow();
    this._createOrbitLight();
    this.loadKart(STK_KARTS[this.currentIndex].id);

    window.addEventListener('resize', this.onWindowResize.bind(this));
    this._lastFrame = performance.now();
    this.animate();
  }

  // ── Underglow: a layered 3D gradient disc ─────────────────────
  // ── Radial gradient canvas → texture for soft glow planes ──
  _makeGlowTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0.00, 'rgba(255,255,255,1.00)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.80)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  createUnderglow() {
    const tex = this._makeGlowTexture(256);

    // Outer halo — large soft plane lying flat on the ground
    const outerGeo = new THREE.PlaneGeometry(6.5, 6.5);
    const outerMat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(gloColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowHalo = new THREE.Mesh(outerGeo, outerMat);
    this.glowHalo.rotation.x = -Math.PI / 2;
    this.glowHalo.position.y = 0.05;
    this.scene.add(this.glowHalo);

    // Inner core — bright tight pool directly under kart
    const innerGeo = new THREE.PlaneGeometry(2.4, 2.4);
    const innerMat = new THREE.MeshBasicMaterial({
      map: tex,
      color: new THREE.Color(gloColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.glowDisc = new THREE.Mesh(innerGeo, innerMat);
    this.glowDisc.rotation.x = -Math.PI / 2;
    this.glowDisc.position.y = 0.03;
    this.scene.add(this.glowDisc);
  }

  // ── Orbiting accent light (GLO-coloured, circles the kart) ──
  _createOrbitLight() {
    this._orbitLight = new THREE.PointLight(0xff0080, 1.2, 6);
    this._orbitLight.position.set(2.5, 1.2, 0);
    this.scene.add(this._orbitLight);
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

      // ── Themed scene effects ────────────────────────────────────────────
      case 'sunrise': {
        col = _gradColors(['#1a0030','#881100','#ff4400','#ff9900','#ffdd55','#ff9900','#ff4400','#881100'], t / 10);
        intensity = 0.75 + 0.25 * Math.sin(t * 0.4);
        break;
      }
      case 'sunset': {
        col = _gradColors(['#ff5500','#ff2200','#cc0055','#880033','#440011','#880033','#cc0055','#ff2200'], t / 8);
        intensity = 0.8 + 0.2 * Math.sin(t * 0.5);
        break;
      }
      case 'sunset-glow': {
        col = _gradColors(['#ffaa00','#ff5500','#ff1166','#ff8800'], t / 3);
        intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 2.5));
        break;
      }
      case 'spring': {
        col = _gradColors(['#ffaabb','#aaffbb','#ffffaa','#ccaaff','#ffaabb'], t / 8);
        intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5));
        break;
      }
      case 'aurora': {
        col = _gradColors(['#00ff88','#00bbff','#8800ff','#00ff44','#00ffaa'], t / 10);
        intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 3.5 + Math.sin(t * 1.7) * 1.2));
        break;
      }
      case 'full-rainbow': {
        col.setHSL((t * 0.3) % 1, 1.0, 0.52);
        intensity = 0.85 + 0.15 * Math.sin(t * 2.0);
        break;
      }
      case 'forest': {
        col = _gradColors(['#003300','#116611','#335522','#005500','#224422'], t / 12);
        intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.7));
        break;
      }
      case 'ocean': {
        col = _gradColors(['#001133','#002266','#0044aa','#0077cc','#44aaff','#0077cc','#0044aa'], t / 8);
        intensity = 0.75 + 0.25 * Math.sin(t * 1.2);
        break;
      }
      case 'snowing': {
        col = _gradColors(['#bbccee','#ddeeff','#ffffff','#aabbdd'], t / 4);
        const spark = Math.random() > 0.96 ? 1.45 : 1.0;
        intensity = (0.65 + 0.2 * Math.sin(t * 2.0)) * spark;
        break;
      }
      case 'spring-wind': {
        col = _gradColors(['#eeffcc','#ccffee','#ffeeff','#ffffcc','#eeffcc'], t / 5);
        intensity = 0.5 + 0.5 * Math.abs(Math.sin(t * 2.2));
        break;
      }
      case 'cloudy': {
        col = _gradColors(['#667788','#778899','#99aabb','#778899'], t / 20);
        intensity = 0.4 + 0.25 * Math.sin(t * 0.6);
        break;
      }
      case 'firefly': {
        const fTick = Math.floor(t * 7);
        const fOn   = ((fTick * 1013 + fTick * fTick * 997) % 17) < 2;
        col  = fOn ? new THREE.Color('#ffff88') : new THREE.Color('#002200');
        intensity = fOn ? (1.0 + 0.4 * Math.sin(t * 45)) : 0.04;
        break;
      }
      case 'fire': {
        col = _gradColors(['#ff0000','#ff4400','#ff8800','#ffcc00','#ff4400'], t / 0.9);
        intensity = 0.6 + 0.4 * Math.random();
        break;
      }
      case 'waterfall': {
        col = _gradColors(['#0077bb','#00aaee','#55ccff','#ffffff','#55ccff'], t / 3.5);
        intensity = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(t * 4.0));
        break;
      }
      case 'falling-petals': {
        col = _gradColors(['#ffbbcc','#ff88aa','#ffbbdd','#ffffff','#ffaabb'], t / 6);
        intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 4.5));
        break;
      }
      case 'wave': {
        col = _gradColors(['#001144','#003388','#0055aa','#0088cc','#003388'], t / 4);
        intensity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * Math.PI * 0.8));
        break;
      }
      case 'raining': {
        col = _gradColors(['#3355aa','#4466bb','#6688cc','#4466bb'], t / 3);
        intensity = 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(t * 8.0)) + 0.2 * Math.random();
        break;
      }
      case 'falling-leaves': {
        col = _gradColors(['#aa3300','#dd6600','#cc8800','#772200','#aa3300'], t / 6);
        intensity = 0.6 + 0.4 * Math.abs(Math.sin(t * 3.8));
        break;
      }
      case 'river': {
        col = _gradColors(['#005566','#007788','#009999','#44aaaa','#007788'], t / 5);
        intensity = 0.75 + 0.25 * Math.sin(t * 1.5);
        break;
      }
      case 'water-drop': {
        const wPhase = (t % 1.5) / 1.5;
        intensity = Math.exp(-wPhase * 5) * 0.95 + 0.05;
        col = new THREE.Color('#0099ee');
        break;
      }
    }

    // Apply colour & opacity
    if (this.glowDisc) {
      this.glowDisc.material.color.copy(col);
      this.glowDisc.material.opacity = 0.95 * intensity;
    }
    if (this.glowHalo) {
      this.glowHalo.material.color.copy(col);
      this.glowHalo.material.opacity = 0.78 * intensity;
    }
    if (this.glowLight) {
      this.glowLight.color.copy(col);
      this.glowLight.intensity = 5.5 * intensity;
    }
  }

  // ── Load a kart GLB ──────────────────────────────────────────
  loadKart(id) {
    const loader = new THREE.GLTFLoader();
    if (this.kart) { this.scene.remove(this.kart); this.kart = null; this.isInitialized = false; }
    const nameEl = document.getElementById('kart-name');
    if (nameEl) { nameEl.classList.add('kart-swapping'); nameEl.textContent = '...'; }

    loader.load(
      `/models/stk/karts/${id}/kart.glb`,
      (gltf) => {
        this.kart = gltf.scene;
        const box    = new THREE.Box3().setFromObject(this.kart);
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale  = 2.1 / maxDim;
        this.kart.scale.setScalar(scale);
        const box2   = new THREE.Box3().setFromObject(this.kart);
        const center = box2.getCenter(new THREE.Vector3());
        const minY   = box2.min.y;
        this.kart.position.set(-center.x, -minY, -center.z);
        this._kartBaseY = -minY;
        this.kart.rotation.y = this.kartRotation;
        this.kart.traverse(c => {
          if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            // STK SPM normals are packed 10-10-10-2 and skipped in the pipeline;
            // always recompute from geometry for correct lighting in Three.js.
            if (c.geometry) {
              c.geometry.computeVertexNormals();
            }
            // STK meshes use Irrlicht's left-handed winding; even after winding
            // reversal in the pipeline, set DoubleSide as a safety net for thin
            // geometry (spoilers, fins, cockpit shells) that may still show holes.
            if (Array.isArray(c.material)) {
              c.material = c.material.map(m => {
                const mc = m.clone();
                mc.side = THREE.DoubleSide;
                return mc;
              });
            } else if (c.material) {
              c.material = c.material.clone();
              c.material.side = THREE.DoubleSide;
            }
          }
        });
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
    if (nameEl) {
      nameEl.classList.remove('kart-swapping');
      nameEl.textContent = k.name;
    }
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

  prevKart() {
    this._userRotating = false; // resume auto-rotation on nav change
    this.currentIndex = (this.currentIndex - 1 + STK_KARTS.length) % STK_KARTS.length;
    this.loadKart(STK_KARTS[this.currentIndex].id);
  }
  nextKart() {
    this._userRotating = false;
    this.currentIndex = (this.currentIndex + 1) % STK_KARTS.length;
    this.loadKart(STK_KARTS[this.currentIndex].id);
  }

  onWindowResize() {
    if (!this.camera || !this.renderer || !this.container) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  animate() {
    requestAnimationFrame(this._boundAnimate);
    const now = performance.now();
    const dt = Math.min((now - this._lastFrame) / 1000, 0.05); // real delta, capped
    this._lastFrame = now;
    this._showTime += dt;

    // Only auto-rotate when the user isn't manually controlling the view
    if (this.kart && this.isInitialized && !this._userRotating) {
      this.kartRotation += this.kartRotationSpeed * (dt / 0.016);
      this.kart.rotation.y = this.kartRotation;
    }

    // Hover bob — subtle float
    if (this.kart && this.isInitialized) {
      this.kart.position.y = this._kartBaseY + Math.sin(this._showTime * 1.8) * 0.04;
    }

    // Orbiting accent light — circles the kart, GLO-coloured
    if (this._orbitLight) {
      const r = 2.8, speed = 0.6;
      this._orbitLight.position.x = Math.cos(this._showTime * speed) * r;
      this._orbitLight.position.z = Math.sin(this._showTime * speed) * r;
      this._orbitLight.color.copy(this.glowLight.color);
    }

    this.updateUnderglow(dt);
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }

  // ── Drag-to-rotate (mouse + touch via Pointer Events API) ─────
  _setupDragRotation() {
    const el = this.renderer.domElement;
    el.style.cursor = 'grab';
    el.style.touchAction = 'none'; // prevent scroll hijacking on touch

    el.addEventListener('pointerdown', (e) => {
      this._isDragging   = true;
      this._dragLastX    = e.clientX;
      this._userRotating = true;  // pause auto-rotation
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    });

    el.addEventListener('pointermove', (e) => {
      if (!this._isDragging) return;
      const dx = e.clientX - this._dragLastX;
      this._dragLastX = e.clientX;
      this.kartRotation += dx * 0.012;
      if (this.kart) this.kart.rotation.y = this.kartRotation;
    });

    const endDrag = (e) => {
      if (!this._isDragging) return;
      this._isDragging = false;
      try { el.releasePointerCapture(e.pointerId); } catch (_) {}
      el.style.cursor = 'grab';
    };

    el.addEventListener('pointerup',     endDrag);
    el.addEventListener('pointercancel', endDrag);
  }

  // ── Pick-your-GLO panel builder ───────────────────────────────
  buildGloPicker() {
    const carousel = document.getElementById('glo-carousel');
    if (!carousel) return;
    carousel.innerHTML = '';

    // ── Look-up tables (same gradients / anims as before) ────────
    const CHIP_BG = {
      'solid':          'var(--accent)',
      'pulse':          'linear-gradient(135deg,#ff0080,#cc0060)',
      'strobe':         'linear-gradient(90deg,#fff 50%,#111 50%)',
      'rainbow':        'linear-gradient(90deg,#f00,#ff8c00,#ff0,#0f0,#0ff,#00f,#f0f)',
      'two-color':      'linear-gradient(135deg,#ff0080 50%,#00e5ff 50%)',
      'chase':          'linear-gradient(90deg,rgba(255,0,128,0.1),#ff0080 50%,rgba(255,0,128,0.1))',
      'sunrise':        'linear-gradient(135deg,#3a0060,#e67300,#ffd700)',
      'sunset':         'linear-gradient(135deg,#ff6600,#ff0080,#7700cc)',
      'sunset-glow':    'linear-gradient(135deg,#ff8c00,#ff3300)',
      'fire':           'linear-gradient(135deg,#cc0000,#ff6600,#ffcc00)',
      'falling-leaves': 'linear-gradient(135deg,#cc5500,#994400,#dd3300)',
      'spring':         'linear-gradient(135deg,#ff99bb,#99ffcc,#cc99ff)',
      'full-rainbow':   'linear-gradient(90deg,#f00,#ff8c00,#ff0,#0f0,#0ff,#00f,#f0f)',
      'aurora':         'linear-gradient(135deg,#002a18,#00cc66,#00cccc,#5500cc)',
      'forest':         'linear-gradient(135deg,#001a00,#006600)',
      'spring-wind':    'linear-gradient(135deg,#bbddff,#ffccee,#ccffdd)',
      'falling-petals': 'linear-gradient(135deg,#ff88bb,#ffddee,#fff)',
      'firefly':        'linear-gradient(135deg,#000d1a,#003300,#aacc00)',
      'ocean':          'linear-gradient(135deg,#001f5e,#0055cc,#00ccff)',
      'waterfall':      'linear-gradient(135deg,#003399,#5599ff,#bbddff)',
      'river':          'linear-gradient(135deg,#004444,#007799,#00bbcc)',
      'wave':           'linear-gradient(135deg,#002266,#0066cc,#00bbee)',
      'raining':        'linear-gradient(135deg,#334455,#5577aa,#8899bb)',
      'snowing':        'linear-gradient(135deg,#aabbcc,#ddeeff,#f5fafe)',
      'cloudy':         'linear-gradient(135deg,#445566,#778899,#99aabb)',
      'water-drop':     'linear-gradient(135deg,#0055ee,#0099ff,#66ddff)',
    };
    const CHIP_ANIM = {
      'pulse':        'glo-anim-pulse',
      'strobe':       'glo-anim-strobe',
      'rainbow':      'glo-anim-huerot',
      'full-rainbow': 'glo-anim-huerot',
      'aurora':       'glo-anim-huerot',
      'chase':        'glo-anim-chase',
      'fire':         'glo-anim-flicker',
      'firefly':      'glo-anim-flicker',
    };
    const PALETTE = [
      '#ff0080','#ff4400','#ff9900','#ffee00',
      '#00ff88','#00e5ff','#3399ff','#9933ff',
      '#ff33cc','#ffffff','#777777','#000000',
    ];

    // ── Colour helpers ────────────────────────────────────────────
    function hslToHex(h) {
      const l = 0.5, a = Math.min(l, 1 - l);
      const f = n => {
        const k = (n + h / 30) % 12;
        return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      };
      const toH = x => Math.round(x * 255).toString(16).padStart(2, '0');
      return `#${toH(f(0))}${toH(f(8))}${toH(f(4))}`;
    }
    function hueFromHex(hex) {
      const r = parseInt(hex.slice(1,3),16)/255;
      const g = parseInt(hex.slice(3,5),16)/255;
      const b = parseInt(hex.slice(5,7),16)/255;
      const max = Math.max(r,g,b), min = Math.min(r,g,b);
      if (max === min) return 0;
      const d = max - min;
      const h = (max===r) ? ((g-b)/d + (g<b?6:0))/6
               :(max===g) ? ((b-r)/d + 2)/6
               :            ((r-g)/d + 4)/6;
      return h;
    }

    // ── 3D drum builder ───────────────────────────────────────────
    //   items      – array of any objects
    //   initIdx    – index of initially-selected item
    //   opts.label – row label text
    //   opts.fh    – face height in px (= viewport height)
    //   opts.renderFace(face, item) – populates a face element
    //   opts.onSelect(item)         – called when selection changes
    function buildDrum(items, initIdx, opts) {
      const N     = items.length;
      const DEG   = 360 / N;
      const fh    = opts.fh || 52;
      const R     = Math.ceil((fh / 2) / Math.tan(Math.PI / N));

      const row = document.createElement('div');
      row.className = 'glo-drum-row' + (opts.extraClass ? ' ' + opts.extraClass : '');

      const lbl = document.createElement('span');
      lbl.className = 'glo-drum-lbl';
      lbl.textContent = opts.label;
      row.appendChild(lbl);

      const btnPrev = document.createElement('button');
      btnPrev.type = 'button';
      btnPrev.className = 'glo-drum-arrow';
      btnPrev.textContent = '‹';
      row.appendChild(btnPrev);

      const vp = document.createElement('div');
      vp.className = 'glo-drum-vp';
      vp.style.height = fh + 'px';

      const drum = document.createElement('div');
      drum.className = 'glo-drum';

      const faces = items.map((item, i) => {
        const face = document.createElement('div');
        face.className = 'glo-drum-face';
        face.style.transform = `rotateX(${i * DEG}deg) translateZ(${R}px)`;
        opts.renderFace(face, item);
        drum.appendChild(face);
        return face;
      });

      // accDeg tracks cumulative angle so spin never visually reverses on wrap
      let accDeg = initIdx * DEG;
      let curIdx = initIdx;

      function applyRotation(animate) {
        drum.style.transition = animate
          ? 'transform 1.4s cubic-bezier(0.22,1,0.36,1)'
          : 'none';
        drum.style.transform = `rotateX(${-accDeg}deg)`;
        faces.forEach((f, i) => f.classList.toggle('active', i === curIdx));
      }

      function spin(dir) {   // dir: +1 = next, -1 = prev
        accDeg += dir * DEG;
        curIdx  = (((Math.round(accDeg / DEG)) % N) + N) % N;
        applyRotation(true);
        opts.onSelect(items[curIdx]);
      }

      // Apply without animation, then unlock transitions next frame
      applyRotation(false);
      requestAnimationFrame(() => requestAnimationFrame(() => applyRotation(false)));

      // Arrow buttons
      btnPrev.addEventListener('click', () => spin(-1));
      const btnNext = document.createElement('button');
      btnNext.type = 'button';
      btnNext.className = 'glo-drum-arrow';
      btnNext.textContent = '›';
      btnNext.addEventListener('click', () => spin(1));

      // Drag (horizontal swipe) to spin
      let dragX0 = 0;
      vp.addEventListener('pointerdown', e => {
        dragX0 = e.clientX;
        vp.setPointerCapture(e.pointerId);
      });
      vp.addEventListener('pointerup', e => {
        const dx = e.clientX - dragX0;
        if (Math.abs(dx) > 18) spin(dx < 0 ? 1 : -1);
      });

      vp.appendChild(drum);
      row.appendChild(vp);
      row.appendChild(btnNext);

      // Expose controls for cross-row coordination
      row._spin      = spin;
      row._curIdx    = () => curIdx;
      row._jumpTo    = (idx) => {
        const diff = idx - curIdx;
        if (diff === 0) return;
        accDeg += diff * DEG;
        curIdx  = ((idx % N) + N) % N;
        applyRotation(true);
        opts.onSelect(items[curIdx]);
      };
      return row;
    }

    // ── spectrum reference (set after strip is built) ─────────────
    let specThumbEl = null;

    // ── Helper: small pill header above each drum ─────────────────
    function makeHeader(text, cls) {
      const h = document.createElement('div');
      h.className = 'glo-drum-header' + (cls ? ' ' + cls : '');
      h.textContent = text;
      return h;
    }

    // ── GLO SCENES drum (all 26 effects, one unified wheel) ────────
    carousel.appendChild(makeHeader('✦ GLO Scenes', 'glo-drum-header--scenes'));
    const allEffects = GLO_EFFECTS;
    const initSceneIdx = Math.max(0, allEffects.findIndex(e => e.id === gloEffect));

    const scenesDrum = buildDrum(allEffects, initSceneIdx, {
      label:      'SCENES',
      extraClass: 'glo-drum-row--scenes',
      fh:         22,
      renderFace: (face, ef) => {
        face.classList.add('glo-drum-face--scenes');
        // Background layer gets the gradient + animation — keep it separate
        // from the label so animations (flicker/pulse/huerot) don't swallow the text
        const bg = document.createElement('div');
        bg.className = 'glo-drum-face-bg';
        bg.style.background = CHIP_BG[ef.id] || 'var(--accent)';
        if (CHIP_ANIM[ef.id]) bg.classList.add(CHIP_ANIM[ef.id]);
        face.appendChild(bg);
        // category tag
        const tag = document.createElement('div');
        tag.className = 'glo-drum-face-tag';
        tag.textContent = ef.category;
        face.appendChild(tag);
        const fLbl = document.createElement('div');
        fLbl.className = 'glo-drum-face-lbl';
        fLbl.textContent = ef.label;
        face.appendChild(fLbl);
      },
      onSelect: (ef) => {
        gloEffect = ef.id;
        saveGlo();
        const c2row = carousel.querySelector('.glo-c2-row');
        if (c2row) c2row.style.display = gloEffect === 'two-color' ? '' : 'none';
      },
    });
    carousel.appendChild(scenesDrum);

    // separator
    const sep = document.createElement('div');
    sep.className = 'glo-drum-sep';
    carousel.appendChild(sep);

    // ── SIMPLE GLO header ─────────────────────────────────────────
    carousel.appendChild(makeHeader('● Simple GLO', 'glo-drum-header--simple'));

    // ── Colour drum (row 5) ───────────────────────────────────────
    const initColorIdx = Math.max(0,
      PALETTE.findIndex(h => h.toLowerCase() === gloColor.toLowerCase()));

    const colorDrumRow = buildDrum(PALETTE, initColorIdx, {
      label:      'SOLID',
      fh:         22,
      extraClass: 'glo-drum-row--color glo-drum-row--simple',
      renderFace: (face, hex) => {
        face.classList.add('glo-drum-face--color');
        const bg = document.createElement('div');
        bg.className = 'glo-drum-face-bg';
        bg.style.background = hex;
        face.appendChild(bg);
      },
      onSelect: (hex) => {
        gloColor = hex;
        if (specThumbEl) specThumbEl.style.left =
          `${(hueFromHex(hex) * 100).toFixed(1)}%`;
        saveGlo();
      },
    });
    carousel.appendChild(colorDrumRow);

    // ── Spectrum strip (any hue picker) ───────────────────────────
    const specRow   = document.createElement('div');
    specRow.className = 'glo-spec-row';

    const specSpacer = document.createElement('span');
    specSpacer.className = 'glo-drum-lbl';
    specSpacer.textContent = '∞';
    specRow.appendChild(specSpacer);

    const specWrap  = document.createElement('div');
    specWrap.className = 'glo-spectrum';
    const specThumb = document.createElement('div');
    specThumb.className = 'glo-spectrum-thumb';
    specWrap.appendChild(specThumb);
    specThumbEl = specThumb;

    specThumb.style.left = `${(hueFromHex(gloColor) * 100).toFixed(1)}%`;

    let specDown = false;
    const onSpecMove = (e) => {
      const rect = specWrap.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      specThumb.style.left = `${(t * 100).toFixed(1)}%`;
      gloColor = hslToHex(Math.round(t * 360));
      if (gloEffect !== 'two-color') gloEffect = 'solid';
      saveGlo();
    };
    specWrap.addEventListener('pointerdown', e => {
      specDown = true; specWrap.setPointerCapture(e.pointerId); onSpecMove(e);
    });
    specWrap.addEventListener('pointermove', e => { if (specDown) onSpecMove(e); });
    specWrap.addEventListener('pointerup',     () => { specDown = false; });
    specWrap.addEventListener('pointercancel', () => { specDown = false; });

    specRow.appendChild(specWrap);
    carousel.appendChild(specRow);

    // ── 2nd colour drum (two-color effect only) ───────────────────
    const initColor2Idx = Math.max(0,
      PALETTE.findIndex(h => h.toLowerCase() === gloColor2.toLowerCase()));

    const c2row = buildDrum(PALETTE, initColor2Idx, {
      label:      '2ND',
      fh:         22,
      extraClass: 'glo-drum-row--color glo-drum-row--simple glo-c2-row',
      renderFace: (face, hex) => {
        face.classList.add('glo-drum-face--color');
        const bg = document.createElement('div');
        bg.className = 'glo-drum-face-bg';
        bg.style.background = hex;
        face.appendChild(bg);
      },
      onSelect: (hex) => { gloColor2 = hex; saveGlo(); },
    });
    c2row.style.display = gloEffect === 'two-color' ? '' : 'none';
    carousel.appendChild(c2row);
  }
}

document.addEventListener('DOMContentLoaded', () => { new KartPreview(); });
