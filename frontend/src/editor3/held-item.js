/**
 * held-item.js — Mario-Kart-style "held item" visual that trails just
 * behind / above the kart while an item is in the inventory slot and
 * hasn't been used yet.
 *
 * Shared by the single-player playtest (play-main.js) and the online
 * client (multiplayer-editor3-main.js) so a readied banana / shell /
 * mushroom reads identically everywhere.
 *
 * The rig attaches a small anchor Group as a child of the kart group so
 * it inherits the kart's position + heading automatically. When the
 * held item changes it rebuilds the inner visual, preferring the real
 * item DAE (via pickup-models) and falling back to a tinted proxy while
 * the model streams in — mirroring projectile-runtime's holder/scale
 * convention (scale the holder by worldUnitsPerMeter, never the clone).
 *
 * Dependency-injected THREE + unitsPerM keeps this renderer-agnostic.
 */

import { instanceItemModel, loadItemModel } from './pickup-models.js';
import { buildPickupProxyModel } from './pickup-visuals.js';

// Fallback tint per item (matches the HUD glyph colours in play-main).
const HELD_TINTS = {
  mushroom: 0xff5577,
  golden_mushroom: 0xffd24a,
  star: 0xfff066,
  bullet_bill: 0x444855,
  green_shell: 0x55ff66,
  red_shell: 0xff5555,
  blue_shell: 0x3a7bff,
  banana: 0xffe066,
  bobomb: 0x222831,
  bowling_ball: 0x6e7788,
  cake: 0xffc480,
  plunger: 0xe0568e,
  nitro: 0x66ccff,
  missile: 0xff8833,
  bubblegum: 0xff88d8,
  swatter: 0xff6666,
  parachute: 0x99ccff,
  anchor: 0x7a7f91,
  ludicrous_mode: 0xff66ff,
  shield: 0x66ccff,
  coin: 0xffcc40,
  v8_missile: 0xc25a14,
  v8_cannon: 0x8a8f99,
  v8_rocket: 0xff7a00,
  v8_mortar: 0x4a4a55,
  v8_mine: 0x55202a,
  v8_dynamite: 0xb04020,
  v8_firethrower: 0xff4400,
  v8_shield: 0x66ccff,
  v8_repair: 0x66ff99,
  v8_double_dmg: 0xff66cc,
};

// Item names that have a real DAE in the pickup-models registry.
const HAS_MODEL = new Set([
  'green_shell', 'red_shell', 'blue_shell', 'banana', 'bobomb',
  'bowling_ball', 'cake', 'plunger', 'nitro', 'missile', 'bubblegum',
  'swatter', 'parachute', 'anchor', 'ludicrous_mode', 'shield',
]);

/**
 * @param {object} deps
 * @param {typeof import('three')} deps.THREE
 * @param {THREE.Object3D} deps.kartGroup - parent to attach the rig to
 * @param {number} [deps.unitsPerM=1]     - world units per authored metre
 */
export function createHeldItemRig({ THREE, kartGroup, unitsPerM = 1 }) {
  const M = (m) => m * unitsPerM;

  // Anchor sits above and slightly behind the driver. Kart local forward
  // is +Z, so "behind" is -Z. Tunable if a kart model faces the other way.
  const anchor = new THREE.Group();
  anchor.position.set(0, M(0.95), -M(1.25));
  kartGroup.add(anchor);

  let currentName = null;
  let currentMesh = null;
  let clock = 0;

  function _tint(name) {
    return HELD_TINTS[name] != null ? HELD_TINTS[name] : 0xcccccc;
  }

  function _hasMesh(obj) {
    let found = false;
    obj.traverse((o) => { if (o.isMesh) found = true; });
    return found;
  }

  function _buildProxy(name) {
    const c = _tint(name);
    const holder = buildPickupProxyModel(THREE, name, { scale: M(0.90), color: c });
    holder.userData.__proxy = true;
    return holder;
  }

  function _buildModel(name) {
    const inner = instanceItemModel(name);
    if (!inner || !_hasMesh(inner)) return null;
    const holder = new THREE.Group();
    holder.scale.setScalar(unitsPerM);
    holder.add(inner);
    return holder;
  }

  function _swap(mesh) {
    if (currentMesh) anchor.remove(currentMesh);
    currentMesh = mesh;
    if (mesh) anchor.add(mesh);
  }

  function setItem(name) {
    if (name === currentName) return;
    currentName = name;
    if (!name) { _swap(null); return; }

    if (HAS_MODEL.has(name)) {
      const model = _buildModel(name);
      if (model) { _swap(model); return; }
      // Not cached yet — show proxy and upgrade once the DAE streams in.
      _swap(_buildProxy(name));
      loadItemModel(name).then(() => {
        if (currentName === name && currentMesh && currentMesh.userData.__proxy) {
          const upgraded = _buildModel(name);
          if (upgraded) _swap(upgraded);
        }
      }).catch(() => { /* keep proxy */ });
    } else {
      _swap(_buildProxy(name));
    }
  }

  /**
   * Per-frame update.
   * @param {number} dt seconds
   * @param {string|null} name current held item name (or null/empty)
   */
  function update(dt, name) {
    setItem(name || null);
    if (!currentMesh) { anchor.visible = false; return; }
    anchor.visible = true;
    clock += dt;
    currentMesh.rotation.y += dt * 2.4;
    currentMesh.position.y = Math.sin(clock * 3.0) * M(0.06);
  }

  function dispose() {
    _swap(null);
    if (anchor.parent) anchor.parent.remove(anchor);
  }

  return { update, setItem, dispose, anchor };
}
