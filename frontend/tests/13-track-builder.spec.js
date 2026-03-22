/**
 * 13-track-builder.spec.js — Phase 12 checkpoint
 *
 * Validates Track Builder page loads, track-editor module exports,
 * segment placement, JSON export/import, and share code round-trips.
 */
import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Track Builder Smoke Tests', () => {

  test('builder.html loads with 3D viewport canvas', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const canvasCount = await page.locator('canvas#builder-canvas').count();
    expect(canvasCount).toBe(1);

    // No fatal errors
    const fatalErrors = errors.filter(e =>
      e.includes('Cannot read properties of null') || e.includes('is not a function')
    );
    expect(fatalErrors).toHaveLength(0);
  });

  test('builder.html has palette with segment and obstacle tools', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    const segmentBtns = await page.locator('#segment-palette .palette-btn[data-tool]').count();
    expect(segmentBtns).toBeGreaterThanOrEqual(4);

    const obstacleBtns = await page.locator('#obstacle-palette .palette-btn[data-tool]').count();
    expect(obstacleBtns).toBeGreaterThanOrEqual(2);
  });

  test('track-editor.js exports TrackEditor class and helpers', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const exports = await page.evaluate(async () => {
      const mod = await import('/src/modules/track-editor.js');
      return {
        hasTrackEditor: typeof mod.TrackEditor === 'function',
        hasSegmentTypes: !!mod.SEGMENT_TYPES && Object.keys(mod.SEGMENT_TYPES).length >= 4,
        hasObstacleTypes: !!mod.OBSTACLE_TYPES && Object.keys(mod.OBSTACLE_TYPES).length >= 2,
        hasGenerateGeometry: typeof mod.generateSegmentGeometry === 'function',
        hasExportCode: typeof mod.exportTrackCode === 'function',
        hasImportCode: typeof mod.importTrackCode === 'function',
        hasSavedTracks: typeof mod.getSavedCustomTracks === 'function',
        hasSaveTrack: typeof mod.saveCustomTrack === 'function',
      };
    });

    expect(exports.hasTrackEditor).toBe(true);
    expect(exports.hasSegmentTypes).toBe(true);
    expect(exports.hasObstacleTypes).toBe(true);
    expect(exports.hasGenerateGeometry).toBe(true);
    expect(exports.hasExportCode).toBe(true);
    expect(exports.hasImportCode).toBe(true);
    expect(exports.hasSavedTracks).toBe(true);
    expect(exports.hasSaveTrack).toBe(true);
  });

  test('TrackEditor can place and remove segments', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor } = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();

      editor.placeSegment('straight', 0, 0, 0);
      editor.placeSegment('curve_left', 10, 0, 0);
      const afterPlace = JSON.parse(editor.exportTrack()).segments.length;

      editor.removeSegment(1);
      const afterRemove = JSON.parse(editor.exportTrack()).segments.length;

      return { afterPlace, afterRemove };
    });

    expect(result.afterPlace).toBe(2);
    expect(result.afterRemove).toBe(1);
  });

  test('TrackEditor undo/redo works correctly', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor } = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();

      editor.placeSegment('straight', 0, 0, 0);
      editor.placeSegment('ramp_up', 10, 0, 0);
      const before = JSON.parse(editor.exportTrack()).segments.length;

      editor.undo();
      const afterUndo = JSON.parse(editor.exportTrack()).segments.length;

      editor.redo();
      const afterRedo = JSON.parse(editor.exportTrack()).segments.length;

      return { before, afterUndo, afterRedo };
    });

    expect(result.before).toBe(2);
    expect(result.afterUndo).toBe(1);
    expect(result.afterRedo).toBe(2);
  });

  test('JSON export/import round-trip preserves track data', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor } = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();
      editor.trackName = 'Round Trip';
      editor.trackAuthor = 'Playwright';

      editor.placeSegment('straight', 0, 0, 0);
      editor.placeSegment('curve_right', 10, 0, 0);
      editor.placeObstacle('boost_pad', 5, 0, 0);
      editor.addStartPosition(0, 1, -5, 0);

      const json = editor.exportTrack();
      const exported = JSON.parse(json);

      const editor2 = new TrackEditor();
      editor2.importTrack(json);
      const reimported = JSON.parse(editor2.exportTrack());

      return {
        segmentsMatch: reimported.segments.length === exported.segments.length,
        obstaclesMatch: reimported.obstacles.length === exported.obstacles.length,
        startsMatch: reimported.startPositions.length === exported.startPositions.length,
        nameMatch: reimported.name === exported.name,
      };
    });

    expect(result.segmentsMatch).toBe(true);
    expect(result.obstaclesMatch).toBe(true);
    expect(result.startsMatch).toBe(true);
    expect(result.nameMatch).toBe(true);
  });

  test('share code encode/decode round-trip', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor, exportTrackCode, importTrackCode } = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();

      editor.placeSegment('straight', 0, 0, 0);
      editor.placeSegment('flat_wide', 10, 0, 0);

      const trackJson = editor.exportTrack();
      const trackData = JSON.parse(trackJson);
      const code = exportTrackCode(trackJson);
      const startsWithPrefix = code.startsWith('TK1:');

      const decoded = JSON.parse(importTrackCode(code));
      const segmentsMatch = decoded.segments.length === trackData.segments.length;

      return { startsWithPrefix, segmentsMatch };
    });

    expect(result.startsWithPrefix).toBe(true);
    expect(result.segmentsMatch).toBe(true);
  });

  test('track validation rejects empty track', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor } = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();

      const validation = editor.validateTrack();
      return { valid: validation.valid, hasErrors: validation.errors.length > 0 };
    });

    expect(result.valid).toBe(false);
    expect(result.hasErrors).toBe(true);
  });

  test('game-modes.js includes track_builder in tools category', async ({ page }) => {
    await page.goto(`${VITE}/index.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const mod = await import('/src/game-modes.js');
      const registry = mod.MODE_REGISTRY || mod.default || {};
      const categories = mod.CATEGORIES || {};

      const hasToolsCat = !!categories.tools && categories.tools.id === 'tools';
      const hasBuilder = !!registry.track_builder;
      const builderCat = registry.track_builder?.category;

      return { hasToolsCat, hasBuilder, builderCat };
    });

    expect(result.hasToolsCat).toBe(true);
    expect(result.hasBuilder).toBe(true);
    expect(result.builderCat).toBe('tools');
  });

  test('localStorage custom track save/load/remove', async ({ page }) => {
    await page.goto(`${VITE}/builder.html`, { waitUntil: 'domcontentloaded' });

    const result = await page.evaluate(async () => {
      const { TrackEditor, getSavedCustomTracks, saveCustomTrack, removeCustomTrack }
        = await import('/src/modules/track-editor.js');
      const editor = new TrackEditor();

      editor.trackName = 'Test Track ' + Date.now();
      editor.trackAuthor = 'Playwright';
      editor.placeSegment('straight', 0, 0, 0);
      const trackData = JSON.parse(editor.exportTrack());

      saveCustomTrack(trackData);
      const saved = getSavedCustomTracks();
      const found = saved.some(t => t.name === trackData.name);

      removeCustomTrack(trackData.name, trackData.author);
      const afterRemove = getSavedCustomTracks();
      const stillFound = afterRemove.some(t => t.name === trackData.name);

      return { found, stillFound };
    });

    expect(result.found).toBe(true);
    expect(result.stillFound).toBe(false);
  });
});
