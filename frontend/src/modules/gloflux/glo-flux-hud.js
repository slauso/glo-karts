/**
 * glo-flux-hud.js — Wasteland-themed HUD for gloFLUX mode.
 *
 * Renders:
 *   - Surge Meter (segmented arc, family color segments)
 *   - Power-up slots (up to 5 active)
 *   - Chain combo counter & multiplier
 *   - Mutation tier badge
 *   - Kill feed overlay
 *   - Proximity radar (mini-map w/ threat indicators)
 *   - Timer / lap counter
 *   - Health bar (mutation-tinted)
 *   - Apocalypse Burst overlay
 */

import { FAMILY_META } from './glo-flux-powers.js';
import { SURGE_TIER } from './glo-flux-surge.js';
import { MUTATION_TIER } from './glo-flux-mutations.js';

// ── Layout Constants ────────────────────────────────────────────────────────

const HUD_PADDING       = 12;
const SURGE_METER_W     = 260;
const SURGE_METER_H     = 24;
const POWER_SLOT_SIZE   = 48;
const POWER_SLOT_GAP    = 6;
const MAX_POWER_SLOTS   = 5;
const KILL_FEED_LINES   = 5;
const KILL_FEED_TIMEOUT = 5000; // ms
const RADAR_SIZE        = 120;
const RADAR_RANGE       = 40; // world units

// ── HUD State ───────────────────────────────────────────────────────────────

/**
 * Create HUD state.
 * @returns {object}
 */
export function createHUDState() {
  return {
    visible: true,
    surgePercent: 0,
    surgeTier: SURGE_TIER.DORMANT,
    surgeDominantFamily: null,
    powerSlots: [],            // [{powerId, family, remainingSec, cooldown}]
    comboCount: 0,
    comboMultiplier: 1.0,
    comboTimer: 0,
    mutationTier: MUTATION_TIER.CLEAN,
    mutationFamily: null,
    health: 100,
    maxHealth: 100,
    killFeed: [],              // [{text, timestamp, color}]
    radarBlips: [],            // [{x, z, type}]
    timer: 0,                  // elapsed seconds
    lapCurrent: 0,
    lapTotal: 0,
    isBursting: false,
    burstProgress: 0,
    playerCount: 0,
    placement: 0,
    canvas: null,
    ctx: null,
  };
}

// ── Update Functions ────────────────────────────────────────────────────────

/**
 * Sync HUD state from game systems.
 */
export function updateSurge(hud, surgeState) {
  hud.surgePercent = surgeState.current / 100;
  hud.surgeTier = surgeState.tier;
  hud.surgeDominantFamily = surgeState.dominantContributorFamily;
  hud.isBursting = surgeState.burstActive;
  hud.burstProgress = surgeState.burstActive
    ? (Date.now() - surgeState.burstStartTime) / (surgeState.burstDuration || 4000)
    : 0;
}

export function updatePowerSlots(hud, activePowers, now) {
  hud.powerSlots = activePowers.slice(0, MAX_POWER_SLOTS).map(p => ({
    powerId: p.powerId,
    family: p.family,
    remainingSec: Math.max(0, (p.expiresAt - now) / 1000),
    cooldown: 0,
  }));
}

export function updateCombo(hud, chainLength, multiplier, comboTimer) {
  hud.comboCount = chainLength;
  hud.comboMultiplier = multiplier;
  hud.comboTimer = comboTimer;
}

export function updateMutation(hud, mutationState) {
  hud.mutationTier = mutationState.tier;
  hud.mutationFamily = mutationState.dominantFamily;
}

export function updateHealth(hud, current, max) {
  hud.health = current;
  hud.maxHealth = max;
}

export function updateRace(hud, elapsed, lap, totalLaps, placement, playerCount) {
  hud.timer = elapsed;
  hud.lapCurrent = lap;
  hud.lapTotal = totalLaps;
  hud.placement = placement;
  hud.playerCount = playerCount;
}

export function addKillFeedEntry(hud, text, color = '#ff4444') {
  hud.killFeed.push({ text, timestamp: Date.now(), color });
  if (hud.killFeed.length > KILL_FEED_LINES * 2) {
    hud.killFeed = hud.killFeed.slice(-KILL_FEED_LINES);
  }
}

export function updateRadar(hud, blips) {
  hud.radarBlips = blips; // [{x, z, type: 'enemy'|'power'|'hazard'}]
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * Get or create the HUD overlay canvas.
 * @param {object} hud
 * @returns {CanvasRenderingContext2D}
 */
export function getHUDCanvas(hud) {
  if (hud.canvas) return hud.ctx;

  const canvas = document.createElement('canvas');
  canvas.id = 'gloflux-hud';
  canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';
  document.body.appendChild(canvas);
  hud.canvas = canvas;
  hud.ctx = canvas.getContext('2d');
  resizeHUD(hud);
  return hud.ctx;
}

export function resizeHUD(hud) {
  if (!hud.canvas) return;
  hud.canvas.width = window.innerWidth;
  hud.canvas.height = window.innerHeight;
}

/**
 * Full HUD render pass. Call every frame.
 * @param {object} hud
 */
export function renderHUD(hud) {
  if (!hud.visible) return;
  const ctx = getHUDCanvas(hud);
  const W = hud.canvas.width;
  const H = hud.canvas.height;
  ctx.clearRect(0, 0, W, H);

  drawSurgeMeter(ctx, hud, W, H);
  drawPowerSlots(ctx, hud, W, H);
  drawComboCounter(ctx, hud, W, H);
  drawMutationBadge(ctx, hud, W, H);
  drawKillFeed(ctx, hud, W, H);
  drawRadar(ctx, hud, W, H);
  drawTimerLap(ctx, hud, W, H);
  drawHealthBar(ctx, hud, W, H);

  if (hud.isBursting) drawApocalypseBurstOverlay(ctx, hud, W, H);
}

// ── Individual Drawing Functions ────────────────────────────────────────────

function drawSurgeMeter(ctx, hud, W, _H) {
  const x = (W - SURGE_METER_W) / 2;
  const y = HUD_PADDING;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, SURGE_METER_W, SURGE_METER_H, 4);
  ctx.fill();
  ctx.stroke();

  // Fill
  const fillW = SURGE_METER_W * Math.min(1, hud.surgePercent);
  if (fillW > 0) {
    const famColor = getFamilyColor(hud.surgeDominantFamily);
    ctx.fillStyle = famColor;
    roundRect(ctx, x, y, fillW, SURGE_METER_H, 4);
    ctx.fill();
  }

  // Tier label
  const tierNames = ['DORMANT', 'BUILDING', 'RISING', 'CRITICAL', 'APOCALYPSE'];
  ctx.fillStyle = hud.surgeTier >= SURGE_TIER.CRITICAL ? '#ff0' : '#fff';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(tierNames[hud.surgeTier] || 'DORMANT', W / 2, y + SURGE_METER_H - 6);
}

function drawPowerSlots(ctx, hud, _W, H) {
  const startX = HUD_PADDING;
  const startY = H - HUD_PADDING - POWER_SLOT_SIZE;

  for (let i = 0; i < MAX_POWER_SLOTS; i++) {
    const x = startX + i * (POWER_SLOT_SIZE + POWER_SLOT_GAP);
    const slot = hud.powerSlots[i];

    // Slot background
    ctx.fillStyle = slot ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.3)';
    ctx.strokeStyle = slot ? getFamilyColor(slot.family) : '#444';
    ctx.lineWidth = slot ? 2 : 1;
    roundRect(ctx, x, startY, POWER_SLOT_SIZE, POWER_SLOT_SIZE, 6);
    ctx.fill();
    ctx.stroke();

    if (slot) {
      // Power icon text (abbreviation)
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      const abbr = slot.powerId.substring(0, 4).toUpperCase();
      ctx.fillText(abbr, x + POWER_SLOT_SIZE / 2, startY + POWER_SLOT_SIZE / 2 + 3);

      // Timer arc
      if (slot.remainingSec > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        ctx.fillText(slot.remainingSec.toFixed(1) + 's', x + POWER_SLOT_SIZE / 2, startY + POWER_SLOT_SIZE - 4);
      }
    }
  }
}

function drawComboCounter(ctx, hud, W, H) {
  if (hud.comboCount <= 1) return;

  const x = W / 2;
  const y = HUD_PADDING + SURGE_METER_H + 30;

  ctx.fillStyle = '#ff0';
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${hud.comboCount}x CHAIN`, x, y);

  ctx.fillStyle = '#ffa';
  ctx.font = '14px monospace';
  ctx.fillText(`×${hud.comboMultiplier.toFixed(1)} SURGE`, x, y + 20);
}

function drawMutationBadge(ctx, hud, W, _H) {
  if (hud.mutationTier === 0) return;

  const x = W - HUD_PADDING - 80;
  const y = HUD_PADDING;

  const tierLabels = ['', 'INFECTED', 'GROWING', 'CONSUMED', 'EVOLVED', 'APEX'];
  const color = getFamilyColor(hud.mutationFamily);

  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, x, y, 80, 28, 4);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, 80, 28, 4);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(tierLabels[hud.mutationTier] || '', x + 40, y + 18);
}

function drawKillFeed(ctx, hud, W, _H) {
  const now = Date.now();
  const active = hud.killFeed.filter(k => (now - k.timestamp) < KILL_FEED_TIMEOUT);
  hud.killFeed = active;

  const x = W - HUD_PADDING - 200;
  let y = 60;

  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  for (const entry of active.slice(-KILL_FEED_LINES)) {
    const age = (now - entry.timestamp) / KILL_FEED_TIMEOUT;
    ctx.globalAlpha = 1 - age;
    ctx.fillStyle = entry.color;
    ctx.fillText(entry.text, x + 200, y);
    y += 16;
  }
  ctx.globalAlpha = 1;
}

function drawRadar(ctx, hud, W, H) {
  const cx = W - HUD_PADDING - RADAR_SIZE / 2;
  const cy = H - HUD_PADDING - RADAR_SIZE / 2;
  const r = RADAR_SIZE / 2;

  // Background circle
  ctx.fillStyle = 'rgba(0,20,0,0.6)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,255,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Range rings
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * (i / 3), 0, Math.PI * 2);
    ctx.stroke();
  }

  // Center dot (player)
  ctx.fillStyle = '#0f0';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Blips
  for (const blip of hud.radarBlips) {
    const bx = cx + (blip.x / RADAR_RANGE) * r;
    const bz = cy + (blip.z / RADAR_RANGE) * r;
    const dist = Math.sqrt((bx - cx) ** 2 + (bz - cy) ** 2);
    if (dist > r) continue;

    ctx.fillStyle = blip.type === 'enemy' ? '#f00'
                  : blip.type === 'power' ? '#ff0'
                  : '#f80';
    ctx.beginPath();
    ctx.arc(bx, bz, blip.type === 'enemy' ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTimerLap(ctx, hud, _W, _H) {
  const x = HUD_PADDING;
  const y = HUD_PADDING + 4;

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'left';

  // Timer
  const mins = Math.floor(hud.timer / 60);
  const secs = Math.floor(hud.timer % 60);
  ctx.fillText(`${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`, x, y + 16);

  // Lap counter (if race variant)
  if (hud.lapTotal > 0) {
    ctx.font = '12px monospace';
    ctx.fillText(`LAP ${hud.lapCurrent}/${hud.lapTotal}`, x, y + 34);
  }

  // Placement
  if (hud.playerCount > 0) {
    ctx.font = 'bold 14px monospace';
    ctx.fillStyle = hud.placement <= 3 ? '#ff0' : '#fff';
    ctx.fillText(`#${hud.placement}/${hud.playerCount}`, x, y + 52);
  }
}

function drawHealthBar(ctx, hud, _W, H) {
  const barW = 140;
  const barH = 10;
  const x = HUD_PADDING;
  const y = H - HUD_PADDING - POWER_SLOT_SIZE - 20;

  const pct = hud.health / hud.maxHealth;

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, x, y, barW, barH, 3);
  ctx.fill();

  // Fill (color based on mutation family)
  const color = hud.mutationFamily
    ? getFamilyColor(hud.mutationFamily)
    : (pct > 0.5 ? '#0f0' : pct > 0.25 ? '#ff0' : '#f00');
  ctx.fillStyle = color;
  roundRect(ctx, x, y, barW * pct, barH, 3);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(hud.health)}`, x + barW / 2, y + barH - 1);
}

function drawApocalypseBurstOverlay(ctx, hud, W, H) {
  const p = hud.burstProgress;
  const famColor = getFamilyColor(hud.surgeDominantFamily);

  // Full-screen flash at start
  if (p < 0.15) {
    ctx.fillStyle = famColor;
    ctx.globalAlpha = (0.15 - p) / 0.15 * 0.6;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }

  // Pulsing border
  const borderW = 8 + Math.sin(p * Math.PI * 6) * 4;
  ctx.strokeStyle = famColor;
  ctx.lineWidth = borderW;
  ctx.globalAlpha = 0.7 * (1 - p);
  ctx.strokeRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  // Center text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.globalAlpha = Math.sin(p * Math.PI);
  ctx.fillText('APOCALYPSE', W / 2, H / 2);
  ctx.globalAlpha = 1;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getFamilyColor(family) {
  const c = FAMILY_META[family]?.color;
  if (!c) return '#888';
  return `rgb(${Math.floor(c[0] * 255)},${Math.floor(c[1] * 255)},${Math.floor(c[2] * 255)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function disposeHUD(hud) {
  if (hud.canvas && hud.canvas.parentNode) {
    hud.canvas.parentNode.removeChild(hud.canvas);
  }
  hud.canvas = null;
  hud.ctx = null;
}
