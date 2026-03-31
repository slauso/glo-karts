/**
 * extras-panel.js — Spawn points, item boxes, checkpoints, arena bounds.
 */
import * as THREE from 'three';
import { snapToGrid } from '../modules/track-placement.js';

const SPAWN_COLOR = 0x44ff88;
const ITEM_COLOR = 0xffaa22;
const CHECKPOINT_COLOR = 0x2288ff;
const MAX_SPAWNS = 8;
const MAX_ITEMS = 50;

export class ExtrasPanel {
  /**
   * @param {HTMLElement} container
   * @param {object} callbacks
   * @param {(type: string) => void} callbacks.onToolSelect
   */
  constructor(container, callbacks) {
    this._container = container;
    this._callbacks = callbacks;
    this.activeTool = null;
    this._build();
  }

  _build() {
    this._container.innerHTML = '';

    const tools = [
      { id: 'spawn',      label: '🏁 Spawn Point',  desc: 'Place player start positions' },
      { id: 'item_box',   label: '❓ Item Box',      desc: 'Place pickup item boxes' },
      { id: 'boost_pad',  label: '⚡ Boost Pad',     desc: 'Place speed boost pads' },
      { id: 'barrier',    label: '🧱 Barrier',       desc: 'Place wall barriers' },
      { id: 'checkpoint', label: '🚩 Checkpoint',    desc: 'Place checkpoint gates' },
    ];

    for (const tool of tools) {
      const btn = document.createElement('button');
      btn.className = 'bv2-extra-btn';
      btn.innerHTML = `<span class="bv2-extra-icon">${tool.label}</span><span class="bv2-extra-desc">${tool.desc}</span>`;
      btn.addEventListener('click', () => {
        this.activeTool = this.activeTool === tool.id ? null : tool.id;
        this._container.querySelectorAll('.bv2-extra-btn').forEach(b => b.classList.remove('active'));
        if (this.activeTool) btn.classList.add('active');
        this._callbacks.onToolSelect(this.activeTool);
      });
      this._container.appendChild(btn);
    }
  }

  deselect() {
    this.activeTool = null;
    this._container.querySelectorAll('.bv2-extra-btn').forEach(b => b.classList.remove('active'));
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
