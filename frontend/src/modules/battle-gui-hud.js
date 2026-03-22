/**
 * battle-gui-hud.js — Living Bar HUD (Dynamic Island–inspired)
 *
 * A single unified pill at bottom-center that morphs and responds in
 * real-time to game events.  Inspired by Apple's Dynamic Island:
 *   - One cohesive container that breathes, pulses, and reacts
 *   - Spring-physics transitions (pure Babylon.js GUI, no CSS)
 *   - Event expansion grows upward for status notifications
 *   - Zones flow left→right: Score | Health | Primary | Item | Speed
 */

import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { TextBlock } from "@babylonjs/gui/2D/controls/textBlock";
import { Image } from "@babylonjs/gui/2D/controls/image";
import { Rectangle } from "@babylonjs/gui/2D/controls/rectangle";
import { Ellipse } from "@babylonjs/gui/2D/controls/ellipse";
import { StackPanel } from "@babylonjs/gui/2D/controls/stackPanel";
import { Control } from "@babylonjs/gui/2D/controls/control";
import { Container } from "@babylonjs/gui/2D/controls/container";
import { Grid } from "@babylonjs/gui/2D/controls/grid";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

// ═══════════════════════════════════════════════════════════════════════════
//  SPRING PHYSICS — organic, physically-based animation
// ═══════════════════════════════════════════════════════════════════════════

const SP_TENSION = 220;
const SP_DAMPING = 18;
const SP_SNAP    = 0.35;

function _mkSp(v) { return { value: v, target: v, vel: 0 }; }

function _tickSp(s, dt) {
  const dx = s.target - s.value;
  s.vel += (dx * SP_TENSION - s.vel * SP_DAMPING) * dt;
  s.value += s.vel * dt;
  if (Math.abs(dx) < SP_SNAP && Math.abs(s.vel) < SP_SNAP) {
    s.value = s.target; s.vel = 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LAYOUT CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const BAR_W      = 620;        // island width (px)
const BAR_H      = 56;         // island height — compact
const BAR_R      = 28;         // corner-radius (full pill = H/2)
const BAR_GAP    = 22;         // px from screen bottom
const EV_H       = 46;         // extra height when event is visible
const BAR_BG     = "rgba(6,8,18,0.95)";

// Zone layout — [leftOffset, width] inside barContent
const Z_SCORE     = [10, 52];
const Z_HEALTH    = [70, 242];
const Z_PRIMARY   = [320, 92];
const Z_PICKUP    = [420, 104];
const Z_SPEED     = [532, 62];
const DIV_X       = [64, 314, 414, 526]; // divider x-positions

// ═══════════════════════════════════════════════════════════════════════════
//  MODULE STATE
// ═══════════════════════════════════════════════════════════════════════════

let _guiTexture   = null;
let _scene        = null;
let _hudResizeHandler = null;
let _tickObserver = null;
let _lastTickMs   = 0;

// Spring accumulators
let _sp = {
  barH:  _mkSp(BAR_H),   // island height
  evA:   _mkSp(0),        // event-area alpha
  dmg:   _mkSp(0),        // damage flash intensity
};

// ── Structure ──
let _island      = null;   // outer pill
let _barContent  = null;   // lower section (always visible)
let _eventArea   = null;   // upper section (event expansion)
let _borderRect  = null;   // animated border overlay

// ── Score zone ──
let _scoreBadge     = null;
let _scoreValueText = null;
let _scoreLabelText = null;

// ── Lives (inside health zone) ──
let _livesMarbles = [];

// ── Health zone ──
let _healthBarBg        = null;
let _healthBarDamageGhost = null;
let _healthBarFill      = null;
let _healthText         = null;

// ── Primary weapon zone ──
let _weaponRingBg       = null;
let _weaponIconText     = null;
let _weaponStatusText   = null;
let _weaponCooldownBg   = null;
let _weaponCooldownFill = null;
let _weaponReadyText    = null;

// ── Pickup weapon zone ──
let _weapon2RingBg      = null;
let _weapon2IconText    = null;
let _weapon2NameText    = null;
let _weapon2AmmoText    = null;
let _weapon2EmptyText   = null;

// ── Reserve badge (overlay on pickup ring) ──
let _weapon3RingBg      = null;
let _weapon3IconText    = null;
let _weapon3LabelText   = null;

// ── Lock-on meter (inside pickup zone) ──
let _lockMeterBg   = null;
let _lockMeterFill = null;
let _lockTitleText = null;
let _lockValueText = null;

// ── Speed zone ──
let _speedValueText = null;
let _speedUnitText  = null;
let _speedStateText = null;

// ── Event expansion content ──
let _evIcon        = null;
let _evTitle       = null;
let _evSub         = null;
let _evChip        = null;
let _evChipText    = null;
let _evBarBg       = null;
let _evBarFill     = null;

// ── Dividers ──
let _divs = [];

// ── Telemetry (per-frame) ──
let _telemetryState = {
  speedKPH: 0, driftTier: 0, miniBoostTier: 0,
  boostActive: false, isGrounded: true, isReversing: false,
  targetName: "", lockProgress: 0, locked: false, lockWeapon: "",
};

// ── Status events ──
let _personalStatusState = null;
let _arenaStatusState    = null;

// ── Change tracking ──
let _lastHealth = -1, _lastMaxHealth = -1, _lastLives = -1, _lastScore = -1;

// ═══════════════════════════════════════════════════════════════════════════
//  COLOUR / MATH UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

function _safeHudHex(v, fb) {
  return typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v)
    ? (v.startsWith("#") ? v : `#${v}`) : fb;
}

function _rgbaFromHex(hex, a = 1) {
  const h = _safeHudHex(hex, "#ffffff").slice(1);
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${Math.max(0,Math.min(1,a))})`;
}

function _mixHudHex(cA, cB, t = 0.5) {
  const m = _clamp01(t);
  const a = _safeHudHex(cA, "#ffffff").slice(1);
  const b = _safeHudHex(cB, "#ffffff").slice(1);
  const ch = (i) => Math.round(parseInt(a.slice(i,i+2),16)*(1-m) + parseInt(b.slice(i,i+2),16)*m).toString(16).padStart(2,"0");
  return `#${ch(0)}${ch(2)}${ch(4)}`;
}

function _clamp01(v) { return Math.max(0, Math.min(1, v)); }
function _easeOutCubic(v) { const t = 1 - _clamp01(v); return 1 - t*t*t; }

function _setControlWidthPercent(ctrl, pct) {
  if (ctrl) ctrl.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function _getHudGloPalette() {
  return {
    primary:   _safeHudHex(sessionStorage.getItem("gloColor"),  "#ff0080"),
    secondary: _safeHudHex(sessionStorage.getItem("gloColor2"), "#00e5ff"),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  MARBLE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function _applyMarbleVisual(marble, glow, on) {
  if (!marble) return;
  const md = marble.metadata;
  marble.background   = on ? _rgbaFromHex(glow, 0.92) : "rgba(60,60,80,0.18)";
  marble.color        = on ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.08)";
  marble.alpha        = on ? 1 : 0.25;
  marble.scaleX       = on ? 1 : 0.7;
  marble.scaleY       = on ? 1 : 0.7;
  marble.thickness    = on ? 1.5 : 1;
  marble.shadowBlur   = on ? 14 : 0;
  marble.shadowColor  = on ? _rgbaFromHex(glow, 0.55) : "transparent";
  if (md?.shell) md.shell.background = on ? _rgbaFromHex(glow, 0.75) : "rgba(80,80,100,0.12)";
  if (md?.core)  md.core.background  = on ? _rgbaFromHex(_mixHudHex(glow,"#ffffff",0.4), 0.7) : "rgba(255,255,255,0.06)";
  if (md?.halo)  md.halo.alpha       = on ? 0.85 : 0.15;
  if (md?.glint) md.glint.alpha      = on ? 0.85 : 0.1;
}

// ═══════════════════════════════════════════════════════════════════════════
//  RESPONSIVE SCALE
// ═══════════════════════════════════════════════════════════════════════════

function _applyHudScale() {
  if (!_scene) return;
  const eng = _scene.getEngine?.();
  const rw = eng?.getRenderWidth?.()  || (typeof window !== "undefined" ? window.innerWidth  : 1280);
  const rh = eng?.getRenderHeight?.() || (typeof window !== "undefined" ? window.innerHeight : 720);
  const s = Math.max(0.58, Math.min(1.25, Math.min(rw / 1280, rh / 720) * 1.25));
  if (_island) { _island.scaleX = s; _island.scaleY = s; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  AMBIENT ANIMATION TICK — breathing, glow, marble wobble, telemetry
// ═══════════════════════════════════════════════════════════════════════════

function _tickTelemetry(now, pulse) {
  if (_speedValueText) {
    const mph = Math.max(0, Math.round(Number(_telemetryState.speedKPH || 0) * 0.621371));
    _speedValueText.text = String(mph);
    const dt2 = Number(_telemetryState.driftTier || 0);
    const mb  = Number(_telemetryState.miniBoostTier || 0);
    let state = "", accent = "#d8e5ff";
    if (!_telemetryState.isGrounded && mph > 12)         { state = "AIR";       accent = "#9fdcff"; }
    else if (_telemetryState.isReversing && mph > 3)     { state = "REV";       accent = "#f5c97a"; }
    else if (_telemetryState.boostActive)                { state = mb>=3?"BOOST III":mb===2?"BOOST II":"BOOST"; accent = mb>=3?"#ff66d6":mb===2?"#ffd75f":"#5cf7d7"; }
    else if (dt2 > 0)                                    { state = dt2>=3?"DRIFT III":dt2===2?"DRIFT II":"DRIFT"; accent = dt2>=3?"#b689ff":dt2===2?"#ffd75f":"#68c9ff"; }
    if (_speedStateText) { _speedStateText.text = state; _speedStateText.color = accent; }
    _speedValueText.color = accent;
    _speedValueText.shadowColor = _rgbaFromHex(accent, 0.25 + pulse * 0.15);
  }

  if (_lockTitleText && _lockValueText && _lockMeterFill) {
    const prog = _clamp01(_telemetryState.lockProgress || 0);
    const wn = String(_telemetryState.lockWeapon || "").replace(/_/g," ").toUpperCase();
    const hasLockContext = wn || prog > 0.01 || _telemetryState.locked;
    if (!hasLockContext) {
      _lockTitleText.text = "";
      _lockValueText.text = "";
    } else {
    const raw = _telemetryState.targetName || (wn ? `${wn} LINK` : "SCAN");
    const name = raw.length > 12 ? `${raw.slice(0,11)}.` : raw;
    const lk = _telemetryState.locked;
    const ac = lk ? "#ff6d96" : prog > 0.01 ? "#7ee0ff" : "rgba(228,236,255,0.45)";
    _lockTitleText.text  = lk ? "LOCKED" : prog > 0.01 ? "ACQ" : "";
    _lockValueText.text  = name.toUpperCase();
    _lockTitleText.color = ac;
    _lockValueText.color = ac;
    _lockMeterFill.background = _rgbaFromHex(lk ? "#ff6d96" : "#67d6ff", 0.9);
    _lockMeterFill.alpha = prog > 0.01 ? 1 : 0.08;
    _setControlWidthPercent(_lockMeterFill, Math.max(6, prog * 100));
    }
  }
}

function _tickIslandChrome(now, pulse) {
  const pal = _getHudGloPalette();
  const accent = _mixHudHex(pal.primary, pal.secondary, 0.3);

  // ── Island border glow ──
  if (_borderRect) {
    _borderRect.color = _rgbaFromHex(accent, 0.12 + pulse * 0.08);
    _borderRect.shadowBlur = 18 + pulse * 10;
    _borderRect.shadowColor = _rgbaFromHex(accent, 0.08 + pulse * 0.06);
  }

  // ── Score badge glow ──
  if (_scoreBadge) {
    _scoreBadge.shadowBlur = 10 + pulse * 6;
    _scoreBadge.shadowColor = _rgbaFromHex(pal.primary, 0.3 + pulse * 0.15);
  }
  if (_scoreValueText) {
    _scoreValueText.shadowColor = _rgbaFromHex(pal.primary, 0.35 + pulse * 0.2);
  }

  // ── Primary weapon ring breathing ──
  if (_weaponRingBg) {
    _weaponRingBg.shadowBlur = 12 + pulse * 8;
    _weaponRingBg.shadowColor = _rgbaFromHex(_weaponRingBg.color || pal.secondary, 0.25 + pulse * 0.12);
    const breathe = Math.sin(now * 0.004) * 0.006;
    _weaponRingBg.scaleX = 1 + breathe;
    _weaponRingBg.scaleY = 1 + breathe;
  }

  // ── Pickup ring ──
  if (_weapon2RingBg) {
    const active = !!_weapon2NameText?.text;
    _weapon2RingBg.shadowBlur = active ? (10 + pulse * 6) : 3;
    _weapon2RingBg.shadowColor = active
      ? _rgbaFromHex(_weapon2RingBg.color || pal.primary, 0.2 + pulse * 0.1)
      : "rgba(255,255,255,0.03)";
  }

  // ── Reserve badge ──
  if (_weapon3RingBg) {
    const active = !!_weapon3LabelText?.text;
    _weapon3RingBg.shadowBlur = active ? (6 + pulse * 3) : 0;
    _weapon3RingBg.shadowColor = active
      ? _rgbaFromHex(_weapon3RingBg.color || pal.secondary, 0.15 + pulse * 0.08)
      : "transparent";
  }

  // ── Life marble wobble ──
  for (let i = 0; i < _livesMarbles.length; i++) {
    const m = _livesMarbles[i];
    if (!m || m.alpha < 0.35) continue;
    const w = Math.sin((now * 0.005) + i * 1.3) * 0.035;
    m.scaleX  = 1 + w;
    m.scaleY  = 1 - w * 0.3;
    m.rotation = Math.sin((now * 0.0012) + i) * 0.05;
    if (m.metadata?.halo) {
      m.metadata.halo.scaleX = 0.92 + Math.sin((now * 0.004) + i) * 0.05;
      m.metadata.halo.scaleY = 0.92 + Math.cos((now * 0.003) + i) * 0.05;
    }
    if (m.metadata?.glint) {
      m.metadata.glint.left = `${-2 + Math.sin((now * 0.0035) + i) * 2}px`;
      m.metadata.glint.top  = `${-3 + Math.cos((now * 0.004) + i) * 1.5}px`;
    }
  }

  // ── Damage flash spring ──
  if (_sp.dmg.value > 0.01) {
    if (_borderRect) _borderRect.color = _rgbaFromHex("#ff2244", _sp.dmg.value * 0.6);
    if (_healthBarBg) _healthBarBg.color = _rgbaFromHex("#ff2244", _sp.dmg.value * 0.7);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  STATUS EVENT SYSTEM — events morph the island height upward
// ═══════════════════════════════════════════════════════════════════════════

function _applyEventContent(st) {
  if (!_evTitle || !_evSub || !_evIcon || !_evChip || !_evChipText) return;
  const ac = _safeHudHex(st?.accent, "#ffffff");
  _evIcon.text  = st?.icon || "•";
  _evIcon.color = ac;
  _evTitle.text  = st?.title || "";
  _evTitle.color = ac;
  _evSub.text    = st?.subtitle || "";
  _evSub.alpha   = st?.subtitle ? 1 : 0;
  _evSub.color   = _rgbaFromHex(ac, 0.7);
  _evChip.isVisible = !!st?.chip;
  _evChip.background = _rgbaFromHex(ac, 0.14);
  _evChip.color = _rgbaFromHex(ac, 0.4);
  _evChipText.text  = String(st?.chip || "").toUpperCase();
  _evChipText.color = _rgbaFromHex(ac, 0.9);
}

function _clearEventVisuals() {
  if (_evTitle) _evTitle.text = "";
  if (_evSub)   { _evSub.text = ""; _evSub.alpha = 0; }
  if (_evIcon)  _evIcon.text = "";
  if (_evChip)  _evChip.isVisible = false;
}

function _tickStatusSystem(now, pulse) {
  let activeSt = null;
  let progress = 0;

  if (_personalStatusState) {
    if (now >= _personalStatusState.endsAt) { _personalStatusState = null; }
    else {
      progress = _clamp01((now - _personalStatusState.startedAt) / Math.max(1, _personalStatusState.duration));
      activeSt = _personalStatusState;
    }
  }
  if (!activeSt && _arenaStatusState) {
    if (now >= _arenaStatusState.endsAt) { _arenaStatusState = null; }
    else if (now <= _arenaStatusState.headlineUntil) {
      const span = Math.max(1, _arenaStatusState.headlineUntil - _arenaStatusState.startedAt);
      progress = _clamp01((now - _arenaStatusState.startedAt) / span);
      activeSt = _arenaStatusState;
    }
  }

  // Morph the island height via spring
  const wantEvent = !!activeSt;
  _sp.barH.target = wantEvent ? (BAR_H + EV_H) : BAR_H;
  _sp.evA.target  = wantEvent ? 1 : 0;

  // Update event content
  if (activeSt) {
    const remaining = 1 - progress;
    const fadeIn  = _easeOutCubic(Math.min(1, progress / 0.15));
    const fadeOut = _easeOutCubic(Math.min(1, remaining / 0.18));
    _applyEventContent(activeSt);
    if (_eventArea) _eventArea.alpha = _sp.evA.value * Math.min(fadeIn, fadeOut);

    // Progress bar
    if (_evBarBg)   _evBarBg.alpha = _sp.evA.value * 0.5;
    if (_evBarFill) {
      _evBarFill.background = _rgbaFromHex(activeSt.accent, 0.85);
      _setControlWidthPercent(_evBarFill, Math.max(6, remaining * 100));
      _evBarFill.alpha = _sp.evA.value;
    }
  } else {
    _clearEventVisuals();
    if (_eventArea) _eventArea.alpha = _sp.evA.value;
    if (_evBarBg) _evBarBg.alpha = 0;
    if (_evBarFill) { _evBarFill.alpha = 0; _setControlWidthPercent(_evBarFill, 0); }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  MASTER TICK — runs every frame via onBeforeRenderObservable
// ═══════════════════════════════════════════════════════════════════════════

function _tickLivingBar() {
  const now = performance.now();
  const rawDt = (now - _lastTickMs) / 1000;
  const dt = Math.min(0.033, rawDt || 0.016);
  _lastTickMs = now;

  // Step springs
  _tickSp(_sp.barH, dt);
  _tickSp(_sp.evA,  dt);
  _tickSp(_sp.dmg,  dt);

  // Apply bar height morph
  if (_island) {
    _island.height = `${Math.round(_sp.barH.value)}px`;
    _island.cornerRadius = BAR_R;
  }

  const pulseClock = now * 0.0045;
  const pulse = 0.55 + Math.sin(pulseClock) * 0.45;

  _tickIslandChrome(now, pulse);
  _tickTelemetry(now, pulse);
  _tickStatusSystem(now, pulse);
}

function _ensureTickObserver() {
  if (!_scene || _tickObserver) return;
  _lastTickMs = performance.now();
  _tickObserver = _scene.onBeforeRenderObservable.add(() => { _tickLivingBar(); });
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUILD — construct the Living Bar and all internal zones
// ═══════════════════════════════════════════════════════════════════════════

export function createBattleGUIHud(scene) {
  if (_guiTexture) return;
  _scene = scene;
  _guiTexture = AdvancedDynamicTexture.CreateFullscreenUI("BattleHUD", true, scene);

  _buildIsland();
  _applyHudScale();
  _ensureTickObserver();

  if (typeof window !== "undefined" && !_hudResizeHandler) {
    _hudResizeHandler = () => _applyHudScale();
    window.addEventListener("resize", _hudResizeHandler);
  }
}

function _buildIsland() {
  const pal = _getHudGloPalette();
  const accent = _mixHudHex(pal.primary, pal.secondary, 0.3);

  // ── Outer pill ──
  _island = new Rectangle("livingBar");
  _island.width        = `${BAR_W}px`;
  _island.height       = `${BAR_H}px`;
  _island.cornerRadius = BAR_R;
  _island.thickness    = 0;
  _island.background   = BAR_BG;
  _island.verticalAlignment   = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _island.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
  _island.top          = `-${BAR_GAP}px`;
  _island.shadowBlur   = 32;
  _island.shadowColor  = "rgba(0,0,0,0.45)";
  _island.isPointerBlocker = false;
  _guiTexture.addControl(_island);

  // ── Animated border ring (separate for clean glow) ──
  _borderRect = new Rectangle("islandBorder");
  _borderRect.width        = "100%";
  _borderRect.height       = "100%";
  _borderRect.cornerRadius = BAR_R;
  _borderRect.thickness    = 1.5;
  _borderRect.color        = _rgbaFromHex(accent, 0.18);
  _borderRect.background   = "transparent";
  _borderRect.shadowBlur   = 20;
  _borderRect.shadowColor  = _rgbaFromHex(accent, 0.1);
  _borderRect.isPointerBlocker = false;
  _island.addControl(_borderRect);

  // ── Bar content (lower portion — always visible) ──
  _barContent = new Rectangle("barContent");
  _barContent.width              = "100%";
  _barContent.height             = `${BAR_H}px`;
  _barContent.thickness          = 0;
  _barContent.verticalAlignment  = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _barContent.isPointerBlocker   = false;
  _island.addControl(_barContent);

  // ── Event area (upper portion — fades in during events) ──
  _eventArea = new Rectangle("eventArea");
  _eventArea.width             = "100%";
  _eventArea.height            = `${EV_H}px`;
  _eventArea.thickness         = 0;
  _eventArea.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  _eventArea.alpha             = 0;
  _eventArea.isPointerBlocker  = false;
  _island.addControl(_eventArea);

  _buildDividers();
  _buildScoreZone(pal);
  _buildHealthZone(pal);
  _buildPrimaryZone(pal);
  _buildPickupZone(pal);
  _buildSpeedZone();
  _buildEventContent(pal);
}

// ── Dividers ────────────────────────────────────────────────────────────────

function _buildDividers() {
  for (const x of DIV_X) {
    const d = new Rectangle("div" + x);
    d.width             = "1px";
    d.height            = "55%";
    d.thickness         = 0;
    d.background        = "rgba(255,255,255,0.07)";
    d.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
    d.left              = `${x}px`;
    d.isPointerBlocker  = false;
    _barContent.addControl(d);
    _divs.push(d);
  }
}

// ── Score Zone ──────────────────────────────────────────────────────────────

function _buildScoreZone(pal) {
  const zone = new Rectangle("zScore");
  zone.width             = `${Z_SCORE[1]}px`;
  zone.height            = "100%";
  zone.thickness         = 0;
  zone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  zone.left              = `${Z_SCORE[0]}px`;
  zone.isPointerBlocker  = false;
  zone.clipContent       = true;
  _barContent.addControl(zone);

  // KO badge circle
  _scoreBadge = new Ellipse("koBadge");
  _scoreBadge.width      = "36px";
  _scoreBadge.height     = "36px";
  _scoreBadge.thickness  = 2.5;
  _scoreBadge.color      = _rgbaFromHex(pal.primary, 0.55);
  _scoreBadge.background = _rgbaFromHex(pal.primary, 0.12);
  _scoreBadge.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _scoreBadge.top        = "-4px";
  _scoreBadge.shadowBlur = 12;
  _scoreBadge.shadowColor = _rgbaFromHex(pal.primary, 0.3);
  _scoreBadge.isPointerBlocker = false;
  zone.addControl(_scoreBadge);

  _scoreValueText = new TextBlock("koNum", "0");
  _scoreValueText.color      = "white";
  _scoreValueText.fontSize   = 18;
  _scoreValueText.fontFamily = "'Exo 2', 'Rajdhani', sans-serif";
  _scoreValueText.fontWeight = "900";
  _scoreValueText.shadowColor = _rgbaFromHex(pal.primary, 0.4);
  _scoreValueText.shadowBlur = 6;
  _scoreValueText.isPointerBlocker = false;
  _scoreBadge.addControl(_scoreValueText);

  // "KO" micro-label below badge
  _scoreLabelText = new TextBlock("koLabel", "KO");
  _scoreLabelText.color      = "rgba(255,255,255,0.4)";
  _scoreLabelText.fontSize   = 7;
  _scoreLabelText.fontFamily = "'Rajdhani', 'Exo 2', sans-serif";
  _scoreLabelText.fontWeight = "800";
  _scoreLabelText.letterSpacing = 1;
  _scoreLabelText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _scoreLabelText.top        = "-4px";
  _scoreLabelText.isPointerBlocker = false;
  zone.addControl(_scoreLabelText);
}

// ── Health Zone ─────────────────────────────────────────────────────────────

function _buildHealthZone(pal) {
  const zone = new Rectangle("zHealth");
  zone.width             = `${Z_HEALTH[1]}px`;
  zone.height            = "100%";
  zone.thickness         = 0;
  zone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  zone.left              = `${Z_HEALTH[0]}px`;
  zone.isPointerBlocker  = false;
  zone.clipContent       = true;
  _barContent.addControl(zone);

  // Life marbles (left side of health zone)
  const livesRow = new StackPanel("livesRow");
  livesRow.isVertical = false;
  livesRow.height    = "14px";
  livesRow.width     = "48px";
  livesRow.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  livesRow.verticalAlignment   = Control.VERTICAL_ALIGNMENT_CENTER;
  livesRow.left      = "2px";
  livesRow.isPointerBlocker = false;
  zone.addControl(livesRow);

  for (let i = 0; i < 3; i++) {
    const glow = i === 1 ? pal.secondary : pal.primary;
    const marble = new Ellipse("life" + i);
    marble.width       = "12px";
    marble.height      = "12px";
    marble.paddingLeft  = "2px";
    marble.paddingRight = "2px";
    marble.background  = glow;
    marble.color       = "rgba(255,255,255,0.8)";
    marble.thickness   = 1.5;
    marble.shadowBlur  = 12;
    marble.shadowColor = _rgbaFromHex(glow, 0.5);
    marble.isPointerBlocker = false;

    const shell = new Ellipse("lsh" + i);
    shell.width = "100%"; shell.height = "100%"; shell.thickness = 0;
    shell.background = _rgbaFromHex(glow, 0.75);
    shell.isPointerBlocker = false;
    marble.addControl(shell);

    const halo = new Ellipse("lha" + i);
    halo.width = "86%"; halo.height = "86%"; halo.thickness = 0;
    halo.background = _rgbaFromHex(_mixHudHex(glow,"#ffffff",0.2), 0.2);
    halo.isPointerBlocker = false;
    marble.addControl(halo);

    const core = new Ellipse("lco" + i);
    core.width = "56%"; core.height = "56%"; core.thickness = 0;
    core.background = _rgbaFromHex(_mixHudHex(glow,"#ffffff",0.4), 0.65);
    core.top = "1px"; core.left = "1px";
    core.isPointerBlocker = false;
    marble.addControl(core);

    const glint = new Ellipse("lgl" + i);
    glint.width = "22%"; glint.height = "22%"; glint.thickness = 0;
    glint.background = "rgba(255,255,255,0.9)";
    glint.left = "-2px"; glint.top = "-3px";
    glint.isPointerBlocker = false;
    marble.addControl(glint);

    marble.metadata = { glow, shell, core, halo, glint };
    _applyMarbleVisual(marble, glow, true);
    livesRow.addControl(marble);
    _livesMarbles.push(marble);
  }

  // Health bar background
  _healthBarBg = new Rectangle("hpBg");
  _healthBarBg.width       = "178px";
  _healthBarBg.height      = "16px";
  _healthBarBg.cornerRadius = 8;
  _healthBarBg.thickness   = 1;
  _healthBarBg.color       = "rgba(255,255,255,0.1)";
  _healthBarBg.background  = "rgba(0,0,0,0.5)";
  _healthBarBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  _healthBarBg.left        = "-4px";
  _healthBarBg.verticalAlignment   = Control.VERTICAL_ALIGNMENT_CENTER;
  _healthBarBg.top         = "-1px";
  _healthBarBg.isPointerBlocker = false;
  zone.addControl(_healthBarBg);

  // Damage ghost
  _healthBarDamageGhost = new Rectangle("hpGhost");
  _healthBarDamageGhost.width       = "100%";
  _healthBarDamageGhost.height      = "100%";
  _healthBarDamageGhost.cornerRadius = 7;
  _healthBarDamageGhost.thickness   = 0;
  _healthBarDamageGhost.background  = "rgba(255,60,60,0.3)";
  _healthBarDamageGhost.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _healthBarDamageGhost.isPointerBlocker = false;
  _healthBarBg.addControl(_healthBarDamageGhost);

  // Health fill
  _healthBarFill = new Rectangle("hpFill");
  _healthBarFill.width       = "100%";
  _healthBarFill.height      = "100%";
  _healthBarFill.cornerRadius = 7;
  _healthBarFill.thickness   = 0;
  _healthBarFill.background  = "#22ff44";
  _healthBarFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _healthBarFill.isPointerBlocker = false;
  _healthBarBg.addControl(_healthBarFill);

  // Health text
  _healthText = new TextBlock("hpTxt", "100/100");
  _healthText.color      = "white";
  _healthText.fontSize   = 10;
  _healthText.fontFamily = "'Rajdhani', 'Exo 2', sans-serif";
  _healthText.fontWeight = "900";
  _healthText.shadowColor = "rgba(0,0,0,0.9)";
  _healthText.shadowOffsetY = 1;
  _healthText.isPointerBlocker = false;
  _healthBarBg.addControl(_healthText);
}

// ── Primary Weapon Zone ─────────────────────────────────────────────────────

function _buildPrimaryZone(pal) {
  const zone = new Rectangle("zPrimary");
  zone.width             = `${Z_PRIMARY[1]}px`;
  zone.height            = "100%";
  zone.thickness         = 0;
  zone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  zone.left              = `${Z_PRIMARY[0]}px`;
  zone.isPointerBlocker  = false;
  zone.clipContent       = true;
  _barContent.addControl(zone);

  // Weapon ring
  _weaponRingBg = new Ellipse("priRing");
  _weaponRingBg.width      = "34px";
  _weaponRingBg.height     = "34px";
  _weaponRingBg.thickness  = 3;
  _weaponRingBg.color      = "#00e5ff";
  _weaponRingBg.background = "rgba(4,6,14,0.9)";
  _weaponRingBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponRingBg.left       = "4px";
  _weaponRingBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _weaponRingBg.top        = "-4px";
  _weaponRingBg.shadowBlur = 14;
  _weaponRingBg.shadowColor = _rgbaFromHex("#00e5ff", 0.3);
  _weaponRingBg.isPointerBlocker = false;
  zone.addControl(_weaponRingBg);

  _weaponIconText = new TextBlock("priIcon", "💠");
  _weaponIconText.fontSize = 14;
  _weaponIconText.color    = "white";
  _weaponIconText.isPointerBlocker = false;
  _weaponRingBg.addControl(_weaponIconText);

  // Status label
  _weaponStatusText = new TextBlock("priStatus", "READY");
  _weaponStatusText.color      = "#9cf6c6";
  _weaponStatusText.fontSize   = 8;
  _weaponStatusText.fontFamily = "'Exo 2', sans-serif";
  _weaponStatusText.fontWeight = "800";
  _weaponStatusText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponStatusText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponStatusText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  _weaponStatusText.left   = "42px";
  _weaponStatusText.top    = "8px";
  _weaponStatusText.isPointerBlocker = false;
  zone.addControl(_weaponStatusText);

  // Heat bar
  _weaponCooldownBg = new Rectangle("heatBg");
  _weaponCooldownBg.width       = "44px";
  _weaponCooldownBg.height      = "4px";
  _weaponCooldownBg.cornerRadius = 2;
  _weaponCooldownBg.thickness   = 0;
  _weaponCooldownBg.background  = "rgba(255,255,255,0.07)";
  _weaponCooldownBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponCooldownBg.verticalAlignment   = Control.VERTICAL_ALIGNMENT_CENTER;
  _weaponCooldownBg.left = "42px";
  _weaponCooldownBg.top  = "2px";
  _weaponCooldownBg.isPointerBlocker = false;
  zone.addControl(_weaponCooldownBg);

  _weaponCooldownFill = new Rectangle("heatFill");
  _weaponCooldownFill.width       = "0%";
  _weaponCooldownFill.height      = "100%";
  _weaponCooldownFill.cornerRadius = 2;
  _weaponCooldownFill.thickness   = 0;
  _weaponCooldownFill.background  = "#00e5ff";
  _weaponCooldownFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponCooldownFill.isPointerBlocker = false;
  _weaponCooldownBg.addControl(_weaponCooldownFill);

  // Heat % text
  _weaponReadyText = new TextBlock("heatPct", "0%");
  _weaponReadyText.color      = "rgba(255,255,255,0.35)";
  _weaponReadyText.fontSize   = 7;
  _weaponReadyText.fontFamily = "'Exo 2', sans-serif";
  _weaponReadyText.fontWeight = "700";
  _weaponReadyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponReadyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weaponReadyText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _weaponReadyText.left = "42px";
  _weaponReadyText.top  = "-6px";
  _weaponReadyText.isPointerBlocker = false;
  zone.addControl(_weaponReadyText);
}

// ── Pickup (Item) Zone ──────────────────────────────────────────────────────

function _buildPickupZone(pal) {
  const zone = new Rectangle("zPickup");
  zone.width             = `${Z_PICKUP[1]}px`;
  zone.height            = "100%";
  zone.thickness         = 0;
  zone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  zone.left              = `${Z_PICKUP[0]}px`;
  zone.isPointerBlocker  = false;
  zone.clipContent       = true;
  _barContent.addControl(zone);

  // Pickup ring
  _weapon2RingBg = new Ellipse("secRing");
  _weapon2RingBg.width      = "28px";
  _weapon2RingBg.height     = "28px";
  _weapon2RingBg.thickness  = 2.5;
  _weapon2RingBg.color      = "rgba(255,255,255,0.1)";
  _weapon2RingBg.background = "rgba(4,6,14,0.88)";
  _weapon2RingBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2RingBg.left       = "4px";
  _weapon2RingBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _weapon2RingBg.top        = "-4px";
  _weapon2RingBg.isPointerBlocker = false;
  zone.addControl(_weapon2RingBg);

  _weapon2IconText = new TextBlock("secIcon", "·");
  _weapon2IconText.fontSize = 13;
  _weapon2IconText.color    = "white";
  _weapon2IconText.isPointerBlocker = false;
  _weapon2RingBg.addControl(_weapon2IconText);

  // Reserve badge (tucked under pickup ring)
  _weapon3RingBg = new Ellipse("resBadge");
  _weapon3RingBg.width      = "14px";
  _weapon3RingBg.height     = "14px";
  _weapon3RingBg.thickness  = 1.5;
  _weapon3RingBg.color      = "rgba(255,255,255,0.08)";
  _weapon3RingBg.background = "rgba(4,6,14,0.85)";
  _weapon3RingBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon3RingBg.verticalAlignment   = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _weapon3RingBg.left       = "24px";
  _weapon3RingBg.top        = "-8px";
  _weapon3RingBg.isPointerBlocker = false;
  zone.addControl(_weapon3RingBg);

  _weapon3IconText = new TextBlock("resIcon", "");
  _weapon3IconText.fontSize = 7;
  _weapon3IconText.color    = "white";
  _weapon3IconText.isPointerBlocker = false;
  _weapon3RingBg.addControl(_weapon3IconText);

  _weapon3LabelText = new TextBlock("resLabel", "");
  _weapon3LabelText.color = "transparent";
  _weapon3LabelText.fontSize = 1;
  _weapon3LabelText.isPointerBlocker = false;
  _weapon3RingBg.addControl(_weapon3LabelText);

  // Item name
  _weapon2NameText = new TextBlock("secName", "");
  _weapon2NameText.color      = "rgba(255,255,255,0.45)";
  _weapon2NameText.fontSize   = 9;
  _weapon2NameText.fontFamily = "'Exo 2', sans-serif";
  _weapon2NameText.fontWeight = "800";
  _weapon2NameText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2NameText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2NameText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  _weapon2NameText.left = "38px";
  _weapon2NameText.top  = "8px";
  _weapon2NameText.isPointerBlocker = false;
  zone.addControl(_weapon2NameText);

  // Ammo
  _weapon2AmmoText = new TextBlock("secAmmo", "");
  _weapon2AmmoText.color      = "rgba(255,255,255,0.3)";
  _weapon2AmmoText.fontSize   = 7;
  _weapon2AmmoText.fontFamily = "'Exo 2', sans-serif";
  _weapon2AmmoText.fontWeight = "700";
  _weapon2AmmoText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2AmmoText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2AmmoText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _weapon2AmmoText.left = "38px";
  _weapon2AmmoText.top  = "4px";
  _weapon2AmmoText.isPointerBlocker = false;
  zone.addControl(_weapon2AmmoText);

  // Empty state
  _weapon2EmptyText = new TextBlock("secEmpty", "NO ITEM");
  _weapon2EmptyText.color      = "rgba(255,255,255,0.22)";
  _weapon2EmptyText.fontSize   = 8;
  _weapon2EmptyText.fontFamily = "'Exo 2', sans-serif";
  _weapon2EmptyText.fontWeight = "800";
  _weapon2EmptyText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2EmptyText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _weapon2EmptyText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _weapon2EmptyText.left = "38px";
  _weapon2EmptyText.isPointerBlocker = false;
  zone.addControl(_weapon2EmptyText);

  // Lock-on meter (appears when a lock-on weapon is equipped)
  _lockMeterBg = new Rectangle("lockBg");
  _lockMeterBg.width       = "56px";
  _lockMeterBg.height      = "3px";
  _lockMeterBg.cornerRadius = 2;
  _lockMeterBg.thickness   = 0;
  _lockMeterBg.background  = "rgba(255,255,255,0.06)";
  _lockMeterBg.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockMeterBg.verticalAlignment   = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _lockMeterBg.left = "38px";
  _lockMeterBg.top  = "-6px";
  _lockMeterBg.alpha = 0;
  _lockMeterBg.isPointerBlocker = false;
  zone.addControl(_lockMeterBg);

  _lockMeterFill = new Rectangle("lockFill");
  _lockMeterFill.width       = "6%";
  _lockMeterFill.height      = "100%";
  _lockMeterFill.cornerRadius = 2;
  _lockMeterFill.thickness   = 0;
  _lockMeterFill.background  = _rgbaFromHex("#67d6ff", 0.9);
  _lockMeterFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockMeterFill.isPointerBlocker = false;
  _lockMeterBg.addControl(_lockMeterFill);

  // Lock text labels (positioned in speed zone vicinity)
  _lockTitleText = new TextBlock("lockTitle", "");
  _lockTitleText.color      = "rgba(228,236,255,0.45)";
  _lockTitleText.fontSize   = 7;
  _lockTitleText.fontFamily = "'Exo 2', sans-serif";
  _lockTitleText.fontWeight = "800";
  _lockTitleText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockTitleText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockTitleText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _lockTitleText.left = "38px";
  _lockTitleText.top  = "-10px";
  _lockTitleText.isPointerBlocker = false;
  zone.addControl(_lockTitleText);

  _lockValueText = new TextBlock("lockVal", "");
  _lockValueText.color      = "rgba(228,236,255,0.45)";
  _lockValueText.fontSize   = 7;
  _lockValueText.fontFamily = "'Exo 2', sans-serif";
  _lockValueText.fontWeight = "700";
  _lockValueText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockValueText.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _lockValueText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  _lockValueText.left = "38px";
  _lockValueText.top  = "8px";
  _lockValueText.isPointerBlocker = false;
  zone.addControl(_lockValueText);
}

// ── Speed Zone ──────────────────────────────────────────────────────────────

function _buildSpeedZone() {
  const zone = new Rectangle("zSpeed");
  zone.width             = `${Z_SPEED[1]}px`;
  zone.height            = "100%";
  zone.thickness         = 0;
  zone.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  zone.left              = `${Z_SPEED[0]}px`;
  zone.isPointerBlocker  = false;
  zone.clipContent       = true;
  _barContent.addControl(zone);

  _speedValueText = new TextBlock("spdNum", "0");
  _speedValueText.color      = "#d8e5ff";
  _speedValueText.fontSize   = 20;
  _speedValueText.fontFamily = "'Exo 2', sans-serif";
  _speedValueText.fontWeight = "900";
  _speedValueText.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _speedValueText.top        = "-5px";
  _speedValueText.shadowColor = "rgba(180,210,255,0.15)";
  _speedValueText.shadowBlur = 4;
  _speedValueText.isPointerBlocker = false;
  zone.addControl(_speedValueText);

  _speedUnitText = new TextBlock("spdUnit", "MPH");
  _speedUnitText.color      = "rgba(255,255,255,0.3)";
  _speedUnitText.fontSize   = 6;
  _speedUnitText.fontFamily = "'Rajdhani', sans-serif";
  _speedUnitText.fontWeight = "800";
  _speedUnitText.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _speedUnitText.top        = "-5px";
  _speedUnitText.isPointerBlocker = false;
  zone.addControl(_speedUnitText);

  _speedStateText = new TextBlock("spdState", "");
  _speedStateText.color      = "#68c9ff";
  _speedStateText.fontSize   = 7;
  _speedStateText.fontFamily = "'Exo 2', sans-serif";
  _speedStateText.fontWeight = "800";
  _speedStateText.verticalAlignment = Control.VERTICAL_ALIGNMENT_TOP;
  _speedStateText.top        = "6px";
  _speedStateText.isPointerBlocker = false;
  zone.addControl(_speedStateText);
}

// ── Event Expansion Content ─────────────────────────────────────────────────

function _buildEventContent(pal) {
  // Icon
  _evIcon = new TextBlock("evIcon", "");
  _evIcon.width      = "28px";
  _evIcon.fontSize   = 14;
  _evIcon.fontWeight = "900";
  _evIcon.color      = "white";
  _evIcon.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evIcon.left       = "18px";
  _evIcon.isPointerBlocker = false;
  _eventArea.addControl(_evIcon);

  // Title
  _evTitle = new TextBlock("evTitle", "");
  _evTitle.color      = "white";
  _evTitle.fontSize   = 12;
  _evTitle.fontFamily = "'Exo 2', sans-serif";
  _evTitle.fontWeight = "800";
  _evTitle.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evTitle.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evTitle.verticalAlignment   = Control.VERTICAL_ALIGNMENT_TOP;
  _evTitle.left = "50px";
  _evTitle.top  = "8px";
  _evTitle.isPointerBlocker = false;
  _eventArea.addControl(_evTitle);

  // Subtitle
  _evSub = new TextBlock("evSub", "");
  _evSub.color      = "rgba(235,241,255,0.6)";
  _evSub.fontSize   = 9;
  _evSub.fontFamily = "'Rajdhani', 'Exo 2', sans-serif";
  _evSub.fontWeight = "700";
  _evSub.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evSub.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evSub.verticalAlignment   = Control.VERTICAL_ALIGNMENT_TOP;
  _evSub.left  = "50px";
  _evSub.top   = "24px";
  _evSub.alpha = 0;
  _evSub.isPointerBlocker = false;
  _eventArea.addControl(_evSub);

  // Chip
  _evChip = new Rectangle("evChip");
  _evChip.width       = "80px";
  _evChip.height      = "20px";
  _evChip.cornerRadius = 10;
  _evChip.thickness   = 1;
  _evChip.background  = "rgba(255,255,255,0.06)";
  _evChip.color       = "rgba(255,255,255,0.12)";
  _evChip.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
  _evChip.left        = "-16px";
  _evChip.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
  _evChip.isVisible   = false;
  _evChip.isPointerBlocker = false;
  _eventArea.addControl(_evChip);

  _evChipText = new TextBlock("evChipTxt", "");
  _evChipText.fontSize   = 8;
  _evChipText.fontFamily = "'Exo 2', sans-serif";
  _evChipText.fontWeight = "800";
  _evChipText.color      = "white";
  _evChipText.isPointerBlocker = false;
  _evChip.addControl(_evChipText);

  // Progress bar at bottom of event area
  _evBarBg = new Rectangle("evBarBg");
  _evBarBg.width       = "85%";
  _evBarBg.height      = "3px";
  _evBarBg.cornerRadius = 2;
  _evBarBg.thickness   = 0;
  _evBarBg.background  = "rgba(255,255,255,0.06)";
  _evBarBg.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
  _evBarBg.top         = "-2px";
  _evBarBg.alpha       = 0;
  _evBarBg.isPointerBlocker = false;
  _eventArea.addControl(_evBarBg);

  _evBarFill = new Rectangle("evBarFill");
  _evBarFill.width       = "0%";
  _evBarFill.height      = "100%";
  _evBarFill.cornerRadius = 2;
  _evBarFill.thickness   = 0;
  _evBarFill.background  = "rgba(255,255,255,0.8)";
  _evBarFill.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
  _evBarFill.alpha       = 0;
  _evBarFill.isPointerBlocker = false;
  _evBarBg.addControl(_evBarFill);
}

// ── Update functions ────────────────────────────────────────────────────────

export function updateGUIHealthBar(health, maxHealth = 100) {
  if (!_healthBarFill || !_healthText) return;
  if (health === _lastHealth && maxHealth === _lastMaxHealth) return;

  // Animate damage ghost trail
  if (_healthBarDamageGhost && _lastHealth > health && _lastHealth > 0) {
    const oldPct = _clamp01(_lastHealth / _lastMaxHealth);
    _healthBarDamageGhost.width = (oldPct * 100) + "%";
    setTimeout(() => {
      if (_healthBarDamageGhost) {
        _healthBarDamageGhost.width = (_clamp01(health / maxHealth) * 100) + "%";
      }
    }, 400);
  }

  _lastHealth = health;
  _lastMaxHealth = maxHealth;

  const pct = _clamp01(health / maxHealth);
  _healthBarFill.width = (pct * 100) + "%";
  _healthText.text = `${Math.ceil(health)}/${maxHealth}`;

  // Color gradient: green → yellow → orange → red
  if (pct > 0.6)       _healthBarFill.background = "#22ff44";
  else if (pct > 0.35) _healthBarFill.background = "#ffcc00";
  else if (pct > 0.15) _healthBarFill.background = "#ff8800";
  else                  _healthBarFill.background = "#ff2222";
}

export function flashGUIHealthDamage() {
  if (!_healthBarBg) return;
  // Trigger spring-driven damage flash across entire island
  _sp.dmg.target = 1;
  _sp.dmg.vel = 8;
  _healthBarBg.color = "rgba(255,0,0,0.85)";
  _healthBarBg.thickness = 2.5;
  setTimeout(() => {
    _sp.dmg.target = 0;
    if (_healthBarBg) {
      _healthBarBg.color = "rgba(255,255,255,0.1)";
      _healthBarBg.thickness = 1;
    }
  }, 300);
}

export function updateGUILives(currentLives) {
  if (currentLives === _lastLives) return;
  _lastLives = currentLives;
  for (let i = 0; i < _livesMarbles.length; i++) {
    const marble = _livesMarbles[i];
    _applyMarbleVisual(marble, marble?.metadata?.glow || "#ffffff", i < currentLives);
  }
}

export function updateGUIWeapon(combatState, weaponDisplay) {
  const fmtName = (wid, info, max = 10) => {
    if (!wid) return "";
    const raw = (info?.displayName || wid.replace(/_/g, " ")).toUpperCase();
    return raw.length > max ? raw.slice(0, max - 1) + "." : raw;
  };

  // ── Primary slot (glo_burst) ──
  if (_weaponIconText) {
    const overheat = combatState.overheat || 0;
    const overheated = !!combatState.overheated;
    const heatPct = Math.min(100, Math.max(0, overheat));

    if (_weaponCooldownFill) {
      _weaponCooldownFill.width = heatPct + "%";
      _weaponCooldownFill.background = heatPct > 80 ? "#ff3333" : (heatPct > 50 ? "#ffaa00" : "#00e5ff");
    }

    if (_weaponStatusText) {
      if (overheated) {
        _weaponStatusText.text = "OVERHEAT";
        _weaponStatusText.color = "#ff3333";
      } else if (heatPct > 50) {
        _weaponStatusText.text = "HOT";
        _weaponStatusText.color = "#ffaa00";
      } else {
        _weaponStatusText.text = "READY";
        _weaponStatusText.color = "#9cf6c6";
      }
    }
    if (_weaponReadyText) _weaponReadyText.text = `${Math.round(heatPct)}%`;
    if (_weaponRingBg) {
      _weaponRingBg.color = overheated ? "#ff3333" : (heatPct > 50 ? "#ffaa00" : "#00e5ff");
    }
  }

  // ── Pickup slot ──
  if (_weapon2IconText) {
    const w2 = combatState.weapon2 || "";
    const info2 = (weaponDisplay && weaponDisplay[w2]) || null;

    if (w2 && info2) {
      _weapon2IconText.text = info2.icon;
      _weapon2IconText.fontSize = 13;
      _weapon2RingBg.color = info2.hue;
      _weapon2RingBg.thickness = 2.5;
      _weapon2NameText.text = fmtName(w2, info2);
      _weapon2NameText.color = info2.accent;
      _weapon2AmmoText.text = `${Math.max(0, combatState.ammo2 || 0)} USE${(combatState.ammo2 || 0) === 1 ? "" : "S"}`;
      _weapon2AmmoText.color = "rgba(255,255,255,0.5)";
      if (_weapon2EmptyText) _weapon2EmptyText.isVisible = false;
      if (_lockMeterBg) _lockMeterBg.alpha = info2.category === "lock" ? 1 : 0;
    } else {
      _weapon2IconText.text = "·";
      _weapon2IconText.fontSize = 13;
      _weapon2RingBg.color = "rgba(255,255,255,0.1)";
      _weapon2RingBg.thickness = 2;
      _weapon2NameText.text = "";
      _weapon2AmmoText.text = "";
      if (_weapon2EmptyText) _weapon2EmptyText.isVisible = true;
      if (_lockMeterBg) _lockMeterBg.alpha = 0;
    }
  }

  // ── Reserve badge ──
  if (_weapon3IconText) {
    const w3 = combatState.weapon3 || "";
    const info3 = (weaponDisplay && weaponDisplay[w3]) || null;

    if (w3 && info3) {
      _weapon3IconText.text = info3.icon;
      _weapon3IconText.fontSize = 7;
      _weapon3RingBg.color = info3.hue;
      _weapon3RingBg.thickness = 1.5;
      _weapon3LabelText.text = fmtName(w3, info3);
      _weapon3LabelText.color = info3.accent;
    } else {
      _weapon3IconText.text = "";
      _weapon3IconText.fontSize = 7;
      _weapon3RingBg.color = "rgba(255,255,255,0.08)";
      _weapon3RingBg.thickness = 1;
      _weapon3LabelText.text = "";
      _weapon3LabelText.color = "transparent";
    }
  }
}

export function updateGUIScore(score, label = "Knock Outs") {
  if (!_scoreValueText || !_scoreLabelText) return;
  if (score === _lastScore) return;
  _lastScore = score;
  _scoreValueText.text = String(score);
  // Label is always "KO" in the compact badge
}

export function updateGUIBattleTelemetry({
  speedKPH = 0,
  driftTier = 0,
  miniBoostTier = 0,
  boostActive = false,
  isGrounded = true,
  isReversing = false,
} = {}) {
  _telemetryState.speedKPH = Number(speedKPH || 0);
  _telemetryState.driftTier = Number(driftTier || 0);
  _telemetryState.miniBoostTier = Number(miniBoostTier || 0);
  _telemetryState.boostActive = !!boostActive;
  _telemetryState.isGrounded = isGrounded !== false;
  _telemetryState.isReversing = !!isReversing;
}

export function updateGUILockTelemetry({
  targetName = "",
  lockProgress = 0,
  locked = false,
  lockWeapon = "",
} = {}) {
  _telemetryState.targetName = String(targetName || "");
  _telemetryState.lockProgress = _clamp01(lockProgress || 0);
  _telemetryState.locked = !!locked;
  _telemetryState.lockWeapon = String(lockWeapon || "");
}

export function showGUIStatusLane({
  title,
  subtitle = "",
  chip = "",
  icon = "•",
  accent = "#ffffff",
  duration = 2000,
  sourceZone = "center",
} = {}) {
  if (/no[\s_-]*weapon/i.test(String(title || ""))) return;
  if (!title) return;
  const now = performance.now();
  _personalStatusState = {
    title,
    subtitle,
    chip,
    icon,
    accent: _safeHudHex(accent, "#ffffff"),
    sourceZone,
    startedAt: now,
    duration: Math.max(500, duration),
    endsAt: now + Math.max(500, duration),
  };
  _ensureTickObserver();
}

export function clearGUIStatusLane() {
  _personalStatusState = null;
}

export function showGUIArenaMood({
  title,
  subtitle = "",
  chip = "",
  icon = "•",
  accent = "#e6f1ff",
  duration = 4000,
} = {}) {
  const now = performance.now();
  const ttl = Math.max(1200, duration);
  _arenaStatusState = {
    title: title || "Arena Condition",
    subtitle,
    chip,
    icon,
    accent: _safeHudHex(accent, "#e6f1ff"),
    sourceZone: "arena",
    startedAt: now,
    headlineUntil: now + Math.min(1800, ttl * 0.55),
    duration: ttl,
    endsAt: now + ttl,
  };
  _ensureTickObserver();
}

export function clearGUIArenaMood() {
  _arenaStatusState = null;
}

// ── Pulse / flash effects ───────────────────────────────────────────────────

export function pulseGUIWeaponSlot() {
  if (!_weapon2RingBg) return;
  const prevColor = _weapon2RingBg.color;
  _weapon2RingBg.scaleX = 1.3;
  _weapon2RingBg.scaleY = 1.3;
  _weapon2RingBg.color = "rgba(0,255,100,0.9)";
  setTimeout(() => {
    if (_weapon2RingBg) {
      _weapon2RingBg.scaleX = 1;
      _weapon2RingBg.scaleY = 1;
      _weapon2RingBg.color = prevColor;
    }
  }, 300);
}

export function pulseGUIReserveSlot() {
  if (!_weapon3RingBg) return;
  const prevColor = _weapon3RingBg.color;
  _weapon3RingBg.scaleX = 1.4;
  _weapon3RingBg.scaleY = 1.4;
  _weapon3RingBg.color = "rgba(0,255,200,0.9)";
  setTimeout(() => {
    if (_weapon3RingBg) {
      _weapon3RingBg.scaleX = 1;
      _weapon3RingBg.scaleY = 1;
      _weapon3RingBg.color = prevColor;
    }
  }, 300);
}

// ── Dispose ─────────────────────────────────────────────────────────────────

export function disposeBattleGUIHud() {
  if (typeof window !== "undefined" && _hudResizeHandler) {
    window.removeEventListener("resize", _hudResizeHandler);
    _hudResizeHandler = null;
  }
  if (_scene && _tickObserver) {
    _scene.onBeforeRenderObservable.remove(_tickObserver);
    _tickObserver = null;
  }
  if (_guiTexture) {
    _guiTexture.dispose();
    _guiTexture = null;
  }
  _island = _barContent = _eventArea = _borderRect = null;
  _scoreBadge = _scoreValueText = _scoreLabelText = null;
  _livesMarbles = [];
  _healthBarBg = _healthBarFill = _healthBarDamageGhost = _healthText = null;
  _weaponRingBg = _weaponIconText = _weaponStatusText = null;
  _weaponCooldownBg = _weaponCooldownFill = _weaponReadyText = null;
  _weapon2RingBg = _weapon2IconText = null;
  _weapon2NameText = _weapon2AmmoText = _weapon2EmptyText = null;
  _weapon3RingBg = _weapon3IconText = _weapon3LabelText = null;
  _lockMeterBg = _lockMeterFill = _lockTitleText = _lockValueText = null;
  _speedValueText = _speedUnitText = _speedStateText = null;
  _evIcon = _evTitle = _evSub = _evChip = _evChipText = null;
  _evBarBg = _evBarFill = null;
  _divs = [];
  _personalStatusState = _arenaStatusState = null;
  _lastHealth = _lastMaxHealth = _lastLives = _lastScore = -1;
  _sp = {
    barH: _mkSp(BAR_H),
    evA:  _mkSp(0),
    dmg:  _mkSp(0),
  };
  _telemetryState = {
    speedKPH: 0, driftTier: 0, miniBoostTier: 0,
    boostActive: false, isGrounded: true, isReversing: false,
    targetName: "", lockProgress: 0, locked: false, lockWeapon: "",
  };
  _scene = null;
}
