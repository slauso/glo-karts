/**
 * 16-sp-rebuild.spec.js — Phase 15 checkpoint
 *
 * Validates the single-player and local 2P mode rebuild:
 *   - All tracks/arenas are procedural (addon-track / addon-arena)
 *   - New game modes registered (Follow-the-Leader, Soccer, 3-Strikes)
 *   - SP modes route through page-specific runtimes
 *   - Ghost recorder module exports
 *   - Splitscreen battle mode flag detection
 *   - All mode pages load without fatal errors
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 15 — SP & Local 2P Rebuild', () => {

  // ── Content Registry Cleanup ──────────────────────────────────────────────

  test('content-registry has all procedural track entries', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const trackIds = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.keys(mod.ALL_TRACKS);
    });

    expect(trackIds).toContain('test_box');
    expect(trackIds.length).toBeGreaterThan(1);
    // All non-test_box tracks should be addon-track type (procedural)
    const types = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.values(mod.ALL_TRACKS).filter(t => t.id !== 'test_box').map(t => t.type);
    });
    for (const t of types) expect(t).toBe('addon-track');
  });

  test('content-registry has all procedural arena entries', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const arenaIds = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.keys(mod.ALL_ARENAS);
    });

    expect(arenaIds).toContain('test_box');
    expect(arenaIds.length).toBeGreaterThan(1);
    // All non-test_box arenas should be addon-arena type (procedural)
    const types = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return Object.values(mod.ALL_ARENAS).filter(a => a.id !== 'test_box').map(a => a.type);
    });
    for (const t of types) expect(t).toBe('addon-arena');
  });

  test('VERIFIED_RACE_TRACK_IDS includes test_box and procedural tracks', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const ids = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return mod.VERIFIED_RACE_TRACK_IDS;
    });

    expect(ids).toContain('test_box');
    expect(ids.length).toBeGreaterThan(1);
  });

  test('resolvePlayableRaceTrack defaults to test_box', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/modules/content-registry.js');
      return mod.resolvePlayableRaceTrack();
    });

    expect(result).toBe('test_box');
  });

  // ── New Game Modes Registered ─────────────────────────────────────────────

  test('game-modes.js defines follow_the_leader', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const has = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return !!mod.MODE_REGISTRY.follow_the_leader;
    });

    expect(has).toBe(true);
  });

  test('game-modes.js defines soccer', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const has = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return !!mod.MODE_REGISTRY.soccer;
    });

    expect(has).toBe(true);
  });

  test('game-modes.js defines three_strikes', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const has = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return !!mod.MODE_REGISTRY.three_strikes;
    });

    expect(has).toBe(true);
  });

  test('follow_the_leader routes to game.html', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const page_url = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return mod.getPageForMode('follow_the_leader');
    });

    expect(page_url).toBe('game.html');
  });

  test('three_strikes routes to battle.html', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const page_url = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      return mod.getPageForMode('three_strikes');
    });

    expect(page_url).toBe('battle.html');
  });

  // ── Module Exports ────────────────────────────────────────────────────────

  test('ghost-recorder.js exports recording API', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/ghost-recorder.js');
      return {
        startRecording: typeof mod.startRecording,
        recordFrame: typeof mod.recordFrame,
        stopRecording: typeof mod.stopRecording,
        loadGhost: typeof mod.loadGhost,
        spawnGhostKart: typeof mod.spawnGhostKart,
        updateGhostPlayback: typeof mod.updateGhostPlayback,
        disposeGhost: typeof mod.disposeGhost,
        hasGhostFor: typeof mod.hasGhostFor,
      };
    });

    expect(exports.startRecording).toBe('function');
    expect(exports.recordFrame).toBe('function');
    expect(exports.stopRecording).toBe('function');
    expect(exports.loadGhost).toBe('function');
    expect(exports.spawnGhostKart).toBe('function');
    expect(exports.updateGhostPlayback).toBe('function');
    expect(exports.disposeGhost).toBe('function');
    expect(exports.hasGhostFor).toBe('function');
  });

  test('follow-the-leader.js exports FTL API', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/modes/follow-the-leader.js');
      return {
        initFTL: typeof mod.initFTL,
        updateFTL: typeof mod.updateFTL,
        isFTLActive: typeof mod.isFTLActive,
        disposeFTL: typeof mod.disposeFTL,
      };
    });

    expect(exports.initFTL).toBe('function');
    expect(exports.updateFTL).toBe('function');
    expect(exports.isFTLActive).toBe('function');
    expect(exports.disposeFTL).toBe('function');
  });

  test('soccer.js exports Soccer API', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/modes/soccer.js');
      return {
        initSoccer: typeof mod.initSoccer,
        updateSoccer: typeof mod.updateSoccer,
        isSoccerActive: typeof mod.isSoccerActive,
        disposeSoccer: typeof mod.disposeSoccer,
        getBallMesh: typeof mod.getBallMesh,
      };
    });

    expect(exports.initSoccer).toBe('function');
    expect(exports.updateSoccer).toBe('function');
    expect(exports.isSoccerActive).toBe('function');
    expect(exports.disposeSoccer).toBe('function');
    expect(exports.getBallMesh).toBe('function');
  });

  test('three-strikes.js exports 3-Strikes API', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/modes/three-strikes.js');
      return {
        initThreeStrikes: typeof mod.initThreeStrikes,
        onStrikeDamage: typeof mod.onStrikeDamage,
        isPlayerAlive: typeof mod.isPlayerAlive,
        getStrikesStatus: typeof mod.getStrikesStatus,
        disposeThreeStrikes: typeof mod.disposeThreeStrikes,
      };
    });

    expect(exports.initThreeStrikes).toBe('function');
    expect(exports.onStrikeDamage).toBe('function');
    expect(exports.isPlayerAlive).toBe('function');
    expect(exports.getStrikesStatus).toBe('function');
    expect(exports.disposeThreeStrikes).toBe('function');
  });

  // ── Page Load Smoke Tests ─────────────────────────────────────────────────

  test('game.html loads without fatal errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(1);

    const fatalErrors = errors.filter(e =>
      e.includes('traverse') || e.includes('isMesh') || e.includes('THREE') ||
      e.includes('Cannot read properties of null')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('battle.html loads without fatal errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/battle.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(1);

    const fatalErrors = errors.filter(e =>
      e.includes('traverse') || e.includes('isMesh') || e.includes('THREE') ||
      e.includes('Cannot read properties of null')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('splitscreen.html loads without fatal errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/splitscreen.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const canvasCount = await page.locator('canvas').count();
    expect(canvasCount).toBeGreaterThanOrEqual(1);

    const fatalErrors = errors.filter(e =>
      e.includes('traverse') || e.includes('isMesh') || e.includes('THREE') ||
      e.includes('Cannot read properties of null')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  // ── No STK references in source ───────────────────────────────────────────

  test('no stkTrack() or stkArena() factory calls in content-registry', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const source = await page.evaluate(async () => {
      const resp = await fetch('/src/modules/content-registry.js');
      return resp.text();
    });

    expect(source).not.toContain('stkTrack(');
    expect(source).not.toContain('stkArena(');
  });
});
