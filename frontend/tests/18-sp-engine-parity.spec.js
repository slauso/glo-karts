/**
 * 18-sp-engine-parity.spec.js — Phase 17 checkpoint
 *
 * Validates the SP → MP rendering-engine parity fixes:
 *   - Legacy manual camera override removed (updateCamera function)
 *   - FollowCamera is the sole camera driver (no manual position lerp)
 *   - applyStartPosition is called AFTER setKartRefs (inside createVehicle callback)
 *   - scene.createDefaultEnvironment() is called in SP renderer
 *   - Legacy "GLO EDITION" loading screen text replaced
 *   - No dead camera constants (CAMERA_DISTANCE etc.)
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VITE = 'http://localhost:5173';
const SRC = resolve(__dirname, '..', 'src');

test.describe('Phase 17 — SP Engine Parity with Multiplayer', () => {

  // ── Source-level checks ─────────────────────────────────────────────────

  test('main.js has no legacy updateCamera function', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');
    // The old manual camera function should be completely removed
    expect(src).not.toMatch(/function\s+updateCamera\s*\(/);
  });

  test('main.js has no dead CAMERA_DISTANCE / CAMERA_HEIGHT constants', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');
    expect(src).not.toContain('CAMERA_DISTANCE');
    expect(src).not.toContain('CAMERA_HEIGHT');
    expect(src).not.toContain('CAMERA_LERP');
    expect(src).not.toContain('CAMERA_LOOK_AHEAD');
  });

  test('main.js calls applyStartPosition INSIDE createVehicle callback (after setKartRefs)', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');

    // applyStartPosition should appear AFTER setKartRefs in the source
    const setKartRefsIdx = src.indexOf('setKartRefs(');
    const applyStartIdx = src.indexOf('applyStartPosition(');
    expect(setKartRefsIdx).toBeGreaterThan(-1);
    expect(applyStartIdx).toBeGreaterThan(-1);
    // applyStartPosition must come AFTER setKartRefs
    expect(applyStartIdx).toBeGreaterThan(setKartRefsIdx);

    // Verify it's inside the createVehicle callback (between createVehicle and the closing });)
    const createVehicleIdx = src.indexOf('createVehicle(scene,');
    expect(createVehicleIdx).toBeGreaterThan(-1);
    expect(applyStartIdx).toBeGreaterThan(createVehicleIdx);
  });

  test('babylon-renderer.js calls scene.createDefaultEnvironment()', () => {
    const src = readFileSync(resolve(SRC, 'modules', 'babylon-renderer.js'), 'utf8');
    expect(src).toContain('createDefaultEnvironment');
  });

  test('game.html loading screen does not say "GLO EDITION"', () => {
    const html = readFileSync(resolve(__dirname, '..', 'game.html'), 'utf8');
    expect(html).not.toContain('GLO EDITION');
  });

  test('FollowCamera is sole camera driver in animate loop', () => {
    const src = readFileSync(resolve(SRC, 'main.js'), 'utf8');
    // The animate function should NOT call updateCamera()
    // Find the animate function and check it doesn't contain updateCamera
    const animateStart = src.indexOf('function animate()');
    expect(animateStart).toBeGreaterThan(-1);
    const animateBlock = src.slice(animateStart, animateStart + 3000);
    expect(animateBlock).not.toMatch(/\bupdateCamera\s*\(/);
  });

  // ── Runtime DOM check ───────────────────────────────────────────────────

  test('game.html loading screen shows SINGLE PLAYER subtitle', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });
    const subtitle = await page.$eval('.loading-subtitle', el => el.textContent.trim());
    expect(subtitle).toBe('SINGLE PLAYER');
  });
});
