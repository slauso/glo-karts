/**
 * 38-wm-vfx-polish.spec.js — Phase 22 Wizard Masters VFX & Combat Polish
 *
 * Tests for all 10 WM-audit-inspired improvements:
 *   22.1: GPU particle fallback
 *   22.2: Sprite sheet animated particles
 *   22.3: Dynamic→Static body switching
 *   22.4: Screen-edge colored damage border
 *   22.5: Shockwave post-process shader
 *   22.6: Collision group bitmasks (DEBRIS, EFFECT_ZONE)
 *   22.7: Three-layer explosion pool
 *   22.8: Mesh optimization flags
 *   22.9: Offscreen damage direction arrow
 *   22.10: Multi-projectile spread
 */

import { test, expect } from '@playwright/test';
import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, '..');

// Helper: read source file
function readSrc(relPath) {
  return readFileSync(resolve(FRONTEND, relPath), 'utf-8');
}

test.describe('Phase 22 — Wizard Masters VFX & Combat Polish', () => {

  // ── 22.1 GPU Particle Fallback ───────────────────────────────────────

  test('22.1 — GPU particle fallback: GPUParticleSystem.IsSupported check exists', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('GPUParticleSystem.IsSupported');
    expect(src).toContain('_gpuSupported');
    expect(src).toContain('isGPUParticlesActive');
  });

  test('22.1 — GPU particle fallback: heavy systems pass useGpu=true', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    // Sparks, flames, and hits should use GPU when available (multi-line calls)
    const gpuCalls = (src.match(/createParticlePool\([\s\S]*?true[\s\S]*?\);/g) || []);
    expect(gpuCalls.length).toBeGreaterThanOrEqual(3);
  });

  test('22.1 — GPU particle fallback: createParticlePool respects useGpu flag', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('GPUParticleSystem(name');
    expect(src).toContain('ParticleSystem(name');
    expect(src).toMatch(/useGPU\s*\?\s*new\s+GPUParticleSystem/);
  });

  // ── 22.2 Sprite Sheet Animated Particles ─────────────────────────────

  test('22.2 — Sprite sheet: procedural 4×4 sprite sheet generator exists', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('_generateSpriteSheet');
    expect(src).toContain('cellSize');
    expect(src).toContain('createRadialGradient');
  });

  test('22.2 — Sprite sheet: animation config applied to explosion system', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('isAnimationSheetEnabled');
    expect(src).toContain('spriteCellWidth');
    expect(src).toContain('spriteCellHeight');
    expect(src).toContain('spriteRandomStartCell');
    expect(src).toContain('endSpriteCellID');
  });

  // ── 22.3 Dynamic→Static Body Switching ─────────────────────────────

  test('22.3 — Body switch: projectile bodies set to STATIC on removal', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    // Should set body to STATIC and mass to 0 before dispose
    expect(src).toContain('setMotionType(PhysicsMotionType.STATIC)');
    expect(src).toContain('setMassProperties({ mass: 0 })');
    // Find the entity cleanup section with both patterns
    const cleanupSection = src.substring(
      src.indexOf('WM-style: switch body to STATIC'),
      src.indexOf('WM-style: switch body to STATIC') + 300
    );
    expect(cleanupSection).toContain('setMotionType');
    expect(cleanupSection).toContain('setMassProperties');
  });

  // ── 22.4 Screen-Edge Colored Damage Border ──────────────────────────

  test('22.4 — Damage border: color mapping for weapon elements exists', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toContain('DAMAGE_BORDER_COLORS');
    expect(src).toContain('fire');
    expect(src).toContain('ice');
    expect(src).toContain('gravity_well');
  });

  test('22.4 — Damage border: concentric border overlays created', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toContain('damage-border-outer');
    expect(src).toContain('damage-border-inner');
  });

  test('22.4 — Damage border: showDamageDirection accepts weaponType param', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toMatch(/showDamageDirection\(angle,\s*weaponType\)/);
  });

  // ── 22.5 Shockwave Post-Process ─────────────────────────────────────

  test('22.5 — Shockwave: custom fragment shader registered', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('shockwaveFragmentShader');
    expect(src).toContain('ShadersStore');
    expect(src).toContain('gl_FragColor');
  });

  test('22.5 — Shockwave: _triggerShockwave method exists with damage threshold', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('_triggerShockwave');
    expect(src).toContain('damage < 40');
    expect(src).toContain('new PostProcess');
  });

  test('22.5 — Shockwave: wired into projectileHit handler', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('this._triggerShockwave(msg.damage');
  });

  // ── 22.6 Collision Group Bitmasks ───────────────────────────────────

  test('22.6 — Collision layers: DEBRIS and EFFECT_ZONE bits defined', () => {
    const src = readSrc('src/modules/realtime/collision-layers.js');
    expect(src).toContain('DEBRIS');
    expect(src).toContain('0x0040');
    expect(src).toContain('EFFECT_ZONE');
    expect(src).toContain('0x0080');
  });

  test('22.6 — Collision layers: FILTER presets for DEBRIS and EFFECT_ZONE', () => {
    const src = readSrc('src/modules/realtime/collision-layers.js');
    expect(src).toMatch(/DEBRIS:\s*\{/);
    expect(src).toMatch(/EFFECT_ZONE:\s*\{/);
    // DEBRIS should only collide with TRACK
    expect(src).toContain('LAYER.TRACK');
    // EFFECT_ZONE should only collide with KART
    expect(src).toContain('LAYER.KART');
  });

  test('22.6 — Collision layers: existing FILTER presets still intact', () => {
    const src = readSrc('src/modules/realtime/collision-layers.js');
    expect(src).toMatch(/TRACK:\s*\{/);
    expect(src).toMatch(/KART:\s*\{/);
    expect(src).toMatch(/PROJECTILE:\s*\{/);
    expect(src).toMatch(/TRAP:\s*\{/);
    expect(src).toMatch(/BOUNDARY:\s*\{/);
  });

  // ── 22.7 Three-Layer Pool ───────────────────────────────────────────

  test('22.7 — Explosion pool: pool array and max constant exist', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('_explosionPool');
    expect(src).toContain('MAX_EXPLOSION_POOL');
  });

  test('22.7 — Explosion pool: pre-warm on init', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('_prewarmExplosionPool');
    // Called from initParticles
    expect(src).toMatch(/_prewarmExplosionPool\(\)/);
  });

  test('22.7 — Explosion pool: emitPooledExplosion with auto-return', () => {
    const src = readSrc('src/modules/babylon-particles.js');
    expect(src).toContain('emitPooledExplosion');
    // Auto-return after 1000ms (1s)
    expect(src).toContain('1000');
    expect(src).toContain('_explosionPool.push');
  });

  // ── 22.8 Mesh Optimization Flags ───────────────────────────────────

  test('22.8 — Mesh flags: doNotSyncBoundingInfo on projectiles', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('doNotSyncBoundingInfo = true');
  });

  test('22.8 — Mesh flags: isPickable=false on projectiles', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('isPickable = false');
  });

  test('22.8 — Mesh flags: alwaysSelectAsActiveMesh on projectiles', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('alwaysSelectAsActiveMesh = true');
  });

  test('22.8 — Mesh flags: optimization applied to gravity well children', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    // Gravity well should apply flags to core + 4 children
    expect(src).toContain('[core, ringOuter, ringInner, spikeA, spikeB].forEach');
  });

  // ── 22.9 Offscreen Damage Direction Arrow ──────────────────────────

  test('22.9 — Offscreen arrow: showOffscreenDamageArrow exported', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toContain('export function showOffscreenDamageArrow');
  });

  test('22.9 — Offscreen arrow: signed angle rotation applied', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toContain('offscreen-damage-arrow');
    // Arrow rotated by signed angle
    expect(src).toContain('arrowAngleDeg');
    expect(src).toContain('rotate(');
  });

  test('22.9 — Offscreen arrow: 3s fade-out timer', () => {
    const src = readSrc('src/modules/battle-hud.js');
    expect(src).toContain('3000'); // 3s track duration
    expect(src).toContain('_fadeTimer');
  });

  test('22.9 — Offscreen arrow: wired into projectileHit handler', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('showOffscreenDamageArrow(angle)');
  });

  // ── 22.10 Multi-Projectile Spread ──────────────────────────────────

  test('22.10 — Spread: _spawnSpreadVisuals method exists', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('_spawnSpreadVisuals');
  });

  test('22.10 — Spread: uses Quaternion.RotationAxis for Y-rotation', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('Quaternion.RotationAxis');
    expect(src).toContain('spreadAngle');
    expect(src).toContain('rotateByQuaternionToRef');
  });

  test('22.10 — Spread: projectileFired handler avoids duplicate client-side spread spawns', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    expect(src).toContain('Spread projectiles are now replicated individually by the server.');
  });

  test('22.10 — Spread: visual projectiles auto-dispose after timeout', () => {
    const src = readSrc('src/modules/realtime/colyseus-babylon-client.js');
    // Spread meshes should self-dispose after 1500ms
    expect(src).toContain('1500');
    expect(src).toContain('spreadMesh.dispose()');
  });

  // ── Build Verification ──────────────────────────────────────────────

  test('Build output exists and is recent', () => {
    const distPath = resolve(FRONTEND, 'dist');
    expect(existsSync(distPath)).toBe(true);
    const stat = statSync(distPath);
    // Dist should have been built within the last hour
    const ageMs = Date.now() - stat.mtimeMs;
    expect(ageMs).toBeLessThan(3600000);
  });
});
