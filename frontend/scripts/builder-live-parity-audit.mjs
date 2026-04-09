import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSegmentWorldConnectors, createFallbackPortAnchors } from '../src/modules/custom-arena-anchors.js';
import { GRID_SIZE } from '../src/modules/track-placement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const REPORT_DIR = join(__dirname, '..', 'reports', 'builder-live-parity');
const CONNECTOR_Y = 0.17;
const EPSILON = 0.001;

const failures = [];

function record(ok, message, details = null) {
  if (!ok) {
    failures.push({ message, details });
    console.error(`FAIL: ${message}`);
    if (details) {
      console.error(JSON.stringify(details, null, 2));
    }
  }
  return ok;
}

function approxEqual(a, b, epsilon = EPSILON) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= epsilon;
}

function sortById(items = []) {
  return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
}

function sortConnectors(connectors = []) {
  return [...connectors].sort((a, b) => Number(a.baseDir) - Number(b.baseDir));
}

function expectedConnectors(segment) {
  return sortConnectors(getSegmentWorldConnectors({
    entityId: String(segment.id),
    type: segment.type,
    rotationDeg: segment.rotation,
    position: segment.position,
    portAnchors: createFallbackPortAnchors(segment.type, GRID_SIZE, GRID_SIZE, CONNECTOR_Y),
    scale: Number(segment.scale || 1),
  }).map((connector) => ({
    baseDir: Number(connector.baseDir),
    dir: Number(connector.dir),
    position: {
      x: Number(connector.position.x.toFixed(3)),
      y: Number(connector.position.y.toFixed(3)),
      z: Number(connector.position.z.toFixed(3)),
    },
  })));
}

function compareSegmentLists(expectedSegments, actualSegments, label, { compareConnectors = false } = {}) {
  const expected = sortById(expectedSegments);
  const actual = sortById(actualSegments);

  record(expected.length === actual.length, `${label}: segment count`, {
    expected: expected.length,
    actual: actual.length,
  });

  for (const expectedSegment of expected) {
    const actualSegment = actual.find((segment) => String(segment.id) === String(expectedSegment.id));
    if (!record(!!actualSegment, `${label}: segment ${expectedSegment.id} exists`, { expectedSegment })) {
      continue;
    }

    record(actualSegment.type === expectedSegment.type, `${label}: segment ${expectedSegment.id} type`, {
      expected: expectedSegment.type,
      actual: actualSegment.type,
    });
    record(Number(actualSegment.rotation || 0) === Number(expectedSegment.rotation || 0), `${label}: segment ${expectedSegment.id} rotation`, {
      expected: expectedSegment.rotation,
      actual: actualSegment.rotation,
    });
    record(approxEqual(actualSegment.position?.x, expectedSegment.position?.x), `${label}: segment ${expectedSegment.id} pos.x`, {
      expected: expectedSegment.position?.x,
      actual: actualSegment.position?.x,
    });
    record(approxEqual(actualSegment.position?.y, expectedSegment.position?.y), `${label}: segment ${expectedSegment.id} pos.y`, {
      expected: expectedSegment.position?.y,
      actual: actualSegment.position?.y,
    });
    record(approxEqual(actualSegment.position?.z, expectedSegment.position?.z), `${label}: segment ${expectedSegment.id} pos.z`, {
      expected: expectedSegment.position?.z,
      actual: actualSegment.position?.z,
    });
    record(approxEqual(actualSegment.scale, expectedSegment.scale), `${label}: segment ${expectedSegment.id} scale`, {
      expected: expectedSegment.scale,
      actual: actualSegment.scale,
    });

    if (!compareConnectors) continue;

    const expectedSegmentConnectors = sortConnectors(expectedSegment.connectors || expectedConnectors(expectedSegment));
    const actualSegmentConnectors = sortConnectors(actualSegment.connectors || []);
    record(expectedSegmentConnectors.length === actualSegmentConnectors.length, `${label}: segment ${expectedSegment.id} connector count`, {
      expected: expectedSegmentConnectors.length,
      actual: actualSegmentConnectors.length,
    });

    for (const expectedConnector of expectedSegmentConnectors) {
      const actualConnector = actualSegmentConnectors.find((connector) => Number(connector.baseDir) === Number(expectedConnector.baseDir));
      if (!record(!!actualConnector, `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} exists`, {
        expectedConnector,
      })) {
        continue;
      }

      if ('dir' in expectedConnector) {
        record(Number(actualConnector.dir) === Number(expectedConnector.dir), `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} dir`, {
          expected: expectedConnector.dir,
          actual: actualConnector.dir,
        });
      }
      record(approxEqual(actualConnector.position?.x, expectedConnector.position?.x), `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} pos.x`, {
        expected: expectedConnector.position?.x,
        actual: actualConnector.position?.x,
      });
      record(approxEqual(actualConnector.position?.y, expectedConnector.position?.y), `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} pos.y`, {
        expected: expectedConnector.position?.y,
        actual: actualConnector.position?.y,
      });
      record(approxEqual(actualConnector.position?.z, expectedConnector.position?.z), `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} pos.z`, {
        expected: expectedConnector.position?.z,
        actual: actualConnector.position?.z,
      });
    }
  }
}

async function waitForBuilder(page) {
  await page.goto(`${BASE_URL}/builder.html?preset=arena&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.bv2-asset-btn', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__builderDebug?.getParitySnapshot, null, { timeout: 30000 });
}

async function setTopView(page, bounds = { min: { x: -50, z: -50 }, max: { x: 50, z: 50 } }) {
  await page.evaluate((nextBounds) => {
    window.__camCtrl.setView('top', nextBounds);
  }, bounds);
  await page.waitForTimeout(150);
}

async function worldToScreen(page, x, z, y = 0) {
  return page.evaluate(({ x: nextX, y: nextY, z: nextZ }) => {
    const camera = window.__camCtrl.camera;
    const canvas = document.getElementById('bv2-viewport');
    const rect = canvas.getBoundingClientRect();
    const vec = new window.__THREE.Vector3(nextX, nextY, nextZ).project(camera);
    return {
      x: rect.left + ((vec.x + 1) * 0.5 * rect.width),
      y: rect.top + ((-vec.y + 1) * 0.5 * rect.height),
    };
  }, { x, y, z });
}

async function clickWorld(page, x, z) {
  const point = await worldToScreen(page, x, z);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(50);
  await page.mouse.click(point.x, point.y);
}

async function moveWorld(page, x, z) {
  const point = await worldToScreen(page, x, z);
  await page.mouse.move(point.x, point.y);
}

async function placeAsset(page, key, x, z) {
  await page.click('#bv2-tool-place');
  await page.click(`.bv2-asset-btn[data-key="${key}"]`);
  await moveWorld(page, x, z);
  await page.waitForTimeout(80);
  await clickWorld(page, x, z);
  await page.waitForTimeout(160);
}

async function seedSegments(page, segments) {
  await page.evaluate(async (items) => {
    const { loadModel } = await import('/src/builder-v2/asset-loader.js');
    const graph = window.__builderDebug.sceneGraph;
    const grid = window.__builderDebug.gridState;
    const road = window.__builderDebug.roadPainter;
    graph.clear();
    grid.clear();
    road.clearAll();

    for (const item of items) {
      const model = await loadModel(item.type);
      model.position.set(item.position.x, item.position.y || 0, item.position.z);
      model.rotation.y = -(item.rotation * Math.PI / 180);
      const entity = graph.add({
        id: Number(item.id || 0),
        type: item.type,
        category: 'segment',
        modelKey: item.type,
        object3D: model,
        position: { ...item.position, y: Number(item.position.y || 0) },
        rotation: item.rotation,
        scale: Number(item.scale || 1),
      });
      grid.set(item.position.x, item.position.z, item.type, item.rotation, 'entity', entity.id);
    }
  }, segments);
  await page.waitForTimeout(250);
}

async function seedRoadCells(page, roadCells) {
  await page.evaluate(async (items) => {
    const graph = window.__builderDebug.sceneGraph;
    const grid = window.__builderDebug.gridState;
    const road = window.__builderDebug.roadPainter;
    graph.clear();
    grid.clear();
    road.clearAll();

    for (const item of items) {
      await road.paint(item.x, item.z);
    }
  }, roadCells);
  await page.waitForTimeout(300);
}

async function collectBuilderSnapshot(page) {
  return page.evaluate(() => window.__builderDebug.getParitySnapshot());
}

async function launchPlaytest(page, context, scenarioId) {
  const [playtestPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 30000 }),
    page.click('#bv2-play'),
  ]);
  await playtestPage.waitForFunction(() => !!window.__gloDebug, null, { timeout: 60000 });
  await playtestPage.waitForFunction(() => window.__gloDebug.customArenaBuilt === true, null, { timeout: 60000 });
  await playtestPage.waitForFunction(() => window.__gloDebug.roomJoined === true, null, { timeout: 60000 });
  await playtestPage.waitForFunction(() => Array.isArray(window.__gloDebug.customArenaSegments), null, { timeout: 60000 });
  await playtestPage.screenshot({ path: join(REPORT_DIR, `${scenarioId}-live.png`), fullPage: true }).catch(() => {});
  return playtestPage;
}

async function collectLiveSnapshot(playtestPage) {
  return playtestPage.evaluate(() => ({
    customArenaBuilt: window.__gloDebug.customArenaBuilt,
    roomJoined: window.__gloDebug.roomJoined,
    matchLive: window.__gloDebug.matchLive,
    errors: window.__gloDebug.errors || [],
    inputSegments: window.__gloDebug.customArenaInputSegments || [],
    renderedSegments: window.__gloDebug.customArenaSegments || [],
    connectorPairs: window.__gloDebug.customArenaConnectorPairs || [],
  }));
}

const scenarios = [
  {
    id: 'human-simple',
    label: 'Human-simulated simple build',
    async build(page) {
      await setTopView(page, { min: { x: -20, z: -10 }, max: { x: 40, z: 40 } });
      await placeAsset(page, 'straight', 0, 0);
      await placeAsset(page, 'straight', 0, 10);
      await placeAsset(page, 'corner-small', 0, 20);
      await placeAsset(page, 'wide', 10, 20);
      await placeAsset(page, 'bend-large', 20, 20);
      await placeAsset(page, 'cap-back', 30, 20);
    },
    compareBuilderSegments: true,
  },
  {
    id: 'segment-rotation-matrix',
    label: 'Rotation-heavy segment matrix',
    async build(page) {
      await seedSegments(page, [
        { id: 1, type: 'curve', position: { x: -30, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 2, type: 'corner-large-ramp', position: { x: -20, y: 0, z: 10 }, rotation: 180, scale: 1 },
        { id: 3, type: 'bump-up', position: { x: -10, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 4, type: 'skew-left', position: { x: 0, y: 0, z: 10 }, rotation: 270, scale: 1 },
        { id: 5, type: 'hill-complete-half', position: { x: 10, y: 0, z: 0 }, rotation: 180, scale: 1 },
        { id: 6, type: 'corner-small-ramp', position: { x: 20, y: 0, z: 10 }, rotation: 270, scale: 1 },
        { id: 7, type: 'end', position: { x: 30, y: 0, z: 0 }, rotation: 270, scale: 1 },
      ]);
      await setTopView(page, { min: { x: -40, z: -10 }, max: { x: 40, z: 20 } });
    },
    compareBuilderSegments: true,
  },
  {
    id: 'road-painter-loop',
    label: 'Road painter serialization loop',
    async build(page) {
      await seedRoadCells(page, [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 20, z: 0 },
        { x: 20, z: 10 },
        { x: 20, z: 20 },
        { x: 10, z: 20 },
        { x: 0, z: 20 },
        { x: 0, z: 10 },
        { x: 10, z: 10 },
      ]);
      await setTopView(page, { min: { x: -10, z: -10 }, max: { x: 30, z: 30 } });
    },
    compareBuilderSegments: false,
  },
];

async function runScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];

  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await waitForBuilder(page);
  await scenario.build(page);
  await page.screenshot({ path: join(REPORT_DIR, `${scenario.id}-builder.png`), fullPage: true }).catch(() => {});

  const builderSnapshot = await collectBuilderSnapshot(page);
  const playtestPage = await launchPlaytest(page, context, scenario.id);
  const liveSnapshot = await collectLiveSnapshot(playtestPage);

  record(Array.isArray(liveSnapshot.errors) && liveSnapshot.errors.length === 0, `${scenario.label}: runtime errors`, {
    errors: liveSnapshot.errors,
  });
  record(pageErrors.length === 0, `${scenario.label}: builder page errors`, { pageErrors });

  compareSegmentLists(
    builderSnapshot.playtestTrackData.segments.map((segment) => ({
      id: String(segment.id),
      type: segment.type,
      position: segment.position,
      rotation: Number(segment.rotation || 0),
      scale: Number(segment.scale || 1),
    })),
    liveSnapshot.inputSegments,
    `${scenario.label} payload -> realtime input`,
  );

  compareSegmentLists(
    liveSnapshot.inputSegments,
    liveSnapshot.renderedSegments,
    `${scenario.label} realtime input -> rendered`,
    { compareConnectors: false },
  );

  compareSegmentLists(
    liveSnapshot.inputSegments.map((segment) => ({
      ...segment,
      connectors: expectedConnectors(segment),
    })),
    liveSnapshot.renderedSegments,
    `${scenario.label} rendered connectors`,
    { compareConnectors: true },
  );

  if (scenario.compareBuilderSegments) {
    compareSegmentLists(
      builderSnapshot.segments.map((segment) => ({
        id: String(segment.id),
        type: segment.type,
        position: segment.position,
        rotation: Number(segment.rotation || 0),
        scale: Number(segment.scale || 1),
        connectors: segment.connectors?.map((connector) => ({
          baseDir: Number(connector.baseDir),
          position: connector.position,
        })),
      })),
      liveSnapshot.renderedSegments.map((segment) => ({
        ...segment,
        connectors: segment.connectors?.map((connector) => ({
          baseDir: Number(connector.baseDir),
          position: connector.position,
        })),
      })),
      `${scenario.label} builder -> rendered`,
      { compareConnectors: true },
    );
  }

  await context.close();

  return {
    scenario: scenario.id,
    label: scenario.label,
    builder: builderSnapshot,
    live: liveSnapshot,
  };
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });
  const results = [];

  try {
    for (const scenario of scenarios) {
      console.log(`Running scenario: ${scenario.label}`);
      results.push(await runScenario(browser, scenario));
    }
  } finally {
    await browser.close();
  }

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    scenarios: results,
    failures,
  };

  const reportPath = join(REPORT_DIR, 'latest.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));

  if (failures.length) {
    console.error(`builder-live-parity-audit: ${failures.length} checks failed`);
    console.error(`Report written to ${reportPath}`);
    process.exit(1);
  }

  console.log(`builder-live-parity-audit: all scenarios passed`);
  console.log(`Report written to ${reportPath}`);
}

main().catch((error) => {
  console.error('builder-live-parity-audit crashed', error);
  process.exit(1);
});
