/**
 * extras-panel.js — Spawn points, item boxes, checkpoints, arena bounds.
 */
import * as THREE from 'three';

const SPAWN_COLOR = 0x44ff88;
const ITEM_COLOR = 0xffaa22;
const CHECKPOINT_COLOR = 0x2288ff;
const MAX_SPAWNS = 8;
const MAX_ITEMS = 50;

/* ── SVG icons for each tool (24×24 viewBox) ───────────────── */
const TOOL_ICONS = {
  spawn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>',
  checkpoint: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14.4 6l-.24-1.2A1 1 0 0013.2 4H6v16h2v-6h4.4l.24 1.2a1 1 0 00.96.8H20V6h-5.6z"/></svg>',
  barrier: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>',
  boost_pad: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
  item_box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2L2 7v10l10 5 10-5V7z"/><path d="M12 12L2 7m10 5v10m0-10l10-5"/></svg>',
};

const TOOL_META = Object.freeze({
  spawn: { icon: 'spawn', label: 'Spawn' },
  item_box: { icon: 'item_box', label: 'Item Box' },
  boost_pad: { icon: 'boost_pad', label: 'Boost' },
  barrier: { icon: 'barrier', label: 'Barrier' },
  checkpoint: { icon: 'checkpoint', label: 'Gate' },
});

const DEFAULT_CONFIG = Object.freeze({
  groups: [
    { label: 'Tools', tools: ['spawn', 'item_box', 'boost_pad', 'barrier', 'checkpoint'] },
  ],
});

export class ExtrasPanel {
  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(type: string) => void} callbacks.onToolSelect
   * @param {object} [options]
   */
  constructor(container, callbacks, options = {}) {
    this._container = container;
    this._callbacks = callbacks;
    this.activeTool = null;
    this._config = DEFAULT_CONFIG;
    this.setConfig(options);
  }

  setConfig(options = {}) {
    this._config = {
      ...DEFAULT_CONFIG,
      ...options,
      groups: Array.isArray(options.groups) && options.groups.length
        ? options.groups
        : DEFAULT_CONFIG.groups,
    };
    this._build();
  }

  _build() {
    this._container.innerHTML = '';
    const previousTool = this.activeTool;

    const allowedTools = new Set();

    for (const group of this._config.groups) {
      const groupEl = document.createElement('section');
      groupEl.className = 'bv2-extra-group';

      const heading = document.createElement('div');
      heading.className = 'bv2-panel-section-head';
      heading.textContent = group.label || 'Tools';
      groupEl.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'bv2-extra-grid';

      for (const toolRef of group.tools || []) {
        const tool = typeof toolRef === 'string'
          ? { id: toolRef, ...TOOL_META[toolRef] }
          : { ...TOOL_META[toolRef?.id], ...toolRef };

        if (!tool?.id) continue;
        allowedTools.add(tool.id);

        const svgHtml = TOOL_ICONS[tool.id] || TOOL_ICONS[tool.icon] || '';

        const btn = document.createElement('button');
        btn.className = 'bv2-extra-tile';
        btn.dataset.tool = tool.id;
        btn.title = tool.label || tool.id;
        btn.innerHTML = `
          <span class="bv2-extra-icon">${svgHtml}</span>
          <span class="bv2-extra-label">${tool.label || tool.id}</span>
        `;
        btn.addEventListener('click', () => {
          this.activeTool = this.activeTool === tool.id ? null : tool.id;
          this._container.querySelectorAll('.bv2-extra-tile').forEach((button) => button.classList.remove('active'));
          if (this.activeTool) btn.classList.add('active');
          this._callbacks.onToolSelect(this.activeTool);
        });
        grid.appendChild(btn);
      }

      groupEl.appendChild(grid);
      this._container.appendChild(groupEl);
    }

    if (previousTool && allowedTools.has(previousTool)) {
      this.activeTool = previousTool;
      this._container.querySelectorAll('.bv2-extra-tile').forEach((button) => {
        if (button.dataset.tool === previousTool) {
          button.classList.add('active');
        }
      });
    } else {
      this.activeTool = null;
    }
  }

  deselect() {
    this.activeTool = null;
    this._container.querySelectorAll('.bv2-extra-tile').forEach(b => b.classList.remove('active'));
  }
}

/** Create a 3D spawn point marker. */
export function createSpawnMarker(id, x, y, z, heading = 0) {
  const group = new THREE.Group();
  group.name = `spawn_${id}`;

  // Base circle
  const ring = new THREE.RingGeometry(1.5, 2, 16);
  const ringMat = new THREE.MeshBasicMaterial({ color: SPAWN_COLOR, side: THREE.DoubleSide });
  const ringMesh = new THREE.Mesh(ring, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.y = 0.05;
  group.add(ringMesh);

  // Heading arrow
  const arrowGeo = new THREE.ConeGeometry(0.6, 2, 8);
  const arrowMat = new THREE.MeshBasicMaterial({ color: SPAWN_COLOR });
  const arrow = new THREE.Mesh(arrowGeo, arrowMat);
  arrow.rotation.x = Math.PI / 2;
  arrow.position.y = 0.8;
  arrow.position.z = -1.5;
  group.add(arrow);

  // Number label using a simple sprite
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#44ff88';
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(id), 32, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(2, 2, 1);
  sprite.position.y = 3;
  group.add(sprite);

  group.position.set(x, y, z);
  group.rotation.y = -(heading * Math.PI / 180);

  return group;
}

/** Create a 3D item box marker. */
export function createItemBoxMarker(type, x, y, z) {
  const color = type === 'boost_pad' ? 0x22ccff : type === 'barrier' ? 0xff4444 : ITEM_COLOR;
  const group = new THREE.Group();
  group.name = `item_${type}`;

  const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.7,
    emissive: color,
    emissiveIntensity: 0.3,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 1;
  mesh.castShadow = true;
  group.add(mesh);

  // Wireframe overlay
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
  );
  wire.position.y = 1;
  group.add(wire);

  group.position.set(x, y, z);
  return group;
}

/** Create a checkpoint gate visual. */
export function createCheckpointMarker(x, y, z, width = 12) {
  const group = new THREE.Group();
  group.name = 'checkpoint';

  // Two vertical poles
  const poleGeo = new THREE.CylinderGeometry(0.15, 0.15, 5, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: CHECKPOINT_COLOR });
  const leftPole = new THREE.Mesh(poleGeo, poleMat);
  leftPole.position.set(-width / 2, 2.5, 0);
  group.add(leftPole);
  const rightPole = new THREE.Mesh(poleGeo, poleMat);
  rightPole.position.set(width / 2, 2.5, 0);
  group.add(rightPole);

  // Top bar
  const barGeo = new THREE.BoxGeometry(width, 0.3, 0.3);
  const barMat = new THREE.MeshStandardMaterial({ color: CHECKPOINT_COLOR, emissive: CHECKPOINT_COLOR, emissiveIntensity: 0.3 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 5;
  group.add(bar);

  // Translucent plane
  const planeGeo = new THREE.PlaneGeometry(width, 5);
  const planeMat = new THREE.MeshBasicMaterial({
    color: CHECKPOINT_COLOR,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(planeGeo, planeMat);
  plane.position.y = 2.5;
  group.add(plane);

  group.position.set(x, y, z);
  return group;
}
