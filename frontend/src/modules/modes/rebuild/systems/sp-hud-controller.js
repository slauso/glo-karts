/**
 * sp-hud-controller.js — Unified HUD controller for SP/local modes.
 *
 * Manages the weapon display, mode info, score, timer, and toast notifications.
 */

export class SPHudController {
  constructor(deps = {}) {
    this.canvas = deps.canvas;
    this._weaponEl = null;
    this._toastEl = null;
    this._modeInfoEl = null;
    this._toastTimeout = null;
    this._createBaseHUD();
  }

  _createBaseHUD() {
    // Weapon slot display (bottom center)
    this._weaponEl = document.createElement('div');
    this._weaponEl.id = 'sp-weapon-slot';
    this._weaponEl.style.cssText = `
      position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
      width:64px; height:64px; background:rgba(0,0,0,0.7);
      border:2px solid rgba(255,255,255,0.3); border-radius:12px;
      display:flex; align-items:center; justify-content:center;
      font-size:36px; z-index:150; pointer-events:none;
      transition: border-color 0.2s;
    `;
    document.body.appendChild(this._weaponEl);

    // Toast notification bar (top center)
    this._toastEl = document.createElement('div');
    this._toastEl.id = 'sp-toast';
    this._toastEl.style.cssText = `
      position:fixed; top:60px; left:50%; transform:translateX(-50%);
      color:#fff; font-family:'Poppins',sans-serif; font-size:18px;
      background:rgba(0,0,0,0.7); padding:8px 24px; border-radius:10px;
      z-index:200; pointer-events:none; opacity:0;
      transition: opacity 0.3s;
    `;
    document.body.appendChild(this._toastEl);

    // Mode info (top-right)
    this._modeInfoEl = document.createElement('div');
    this._modeInfoEl.id = 'sp-mode-info';
    this._modeInfoEl.style.cssText = `
      position:fixed; top:10px; right:10px;
      color:#fff; font-family:'Poppins',sans-serif; font-size:12px;
      background:rgba(0,0,0,0.5); padding:4px 10px; border-radius:6px;
      z-index:150; pointer-events:none;
    `;
    document.body.appendChild(this._modeInfoEl);
  }

  /** Show a weapon icon in the HUD slot. */
  showWeapon(icon) {
    if (this._weaponEl) {
      this._weaponEl.textContent = icon || '';
      this._weaponEl.style.borderColor = icon ? 'rgba(255,204,0,0.8)' : 'rgba(255,255,255,0.3)';
    }
  }

  /** Clear the weapon slot. */
  clearWeapon() {
    this.showWeapon('');
  }

  /** Display a toast notification. */
  showToast(message, durationMs = 2000) {
    if (!this._toastEl) return;
    this._toastEl.textContent = message;
    this._toastEl.style.opacity = '1';
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
    this._toastTimeout = setTimeout(() => {
      if (this._toastEl) this._toastEl.style.opacity = '0';
    }, durationMs);
  }

  /** Update mode info text. */
  setModeInfo(text) {
    if (this._modeInfoEl) this._modeInfoEl.textContent = text;
  }

  /** Per-frame update (for animated elements). */
  update(dt) {
    // Future: animate weapon slot glow, score popups, etc.
    void dt;
  }

  dispose() {
    if (this._weaponEl) { this._weaponEl.remove(); this._weaponEl = null; }
    if (this._toastEl) { this._toastEl.remove(); this._toastEl = null; }
    if (this._modeInfoEl) { this._modeInfoEl.remove(); this._modeInfoEl = null; }
    if (this._toastTimeout) clearTimeout(this._toastTimeout);
  }
}
