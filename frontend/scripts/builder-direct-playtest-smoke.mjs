import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSegmentWorldConnectors, createFallbackPortAnchors } from '../src/modules/custom-arena-anchors.js';
import { GRID_SIZE } from '../src/modules/track-placement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';
const REPORT_DIR = join(__dirname, '..', 'reports', 'builder-direct-playtest');
const EPSILON = 0.001;
const CONNECTOR_Y = 0.17;

const failures = [];

function record(ok, message, details = null) {
  if (!ok) {
    failures.push({ message, details });
    console.error(`FAIL: ${message}`);
    if (details) console.error(JSON.stringify(details, null, 2));
  }
  return ok;
}

function note(message, details = null) {
  console.log(`NOTE: ${message}`);
  if (details) console.log(JSON.stringify(details, null, 2));
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

function sortPlacements(items = []) {
  return [...items].sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
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

function compareSegments(expectedSegments, actualSegments, label, { compareConnectors = false } = {}) {
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

      record(Number(actualConnector.dir) === Number(expectedConnector.dir), `${label}: segment ${expectedSegment.id} connector ${expectedConnector.baseDir} dir`, {
        expected: expectedConnector.dir,
        actual: actualConnector.dir,
      });
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
  const enterButton = page.locator('button:has-text("Enter")');
  if (await enterButton.isVisible().catch(() => false)) {
    await enterButton.click();
  }
  await page.waitForFunction(() => !!window.__builderDebug?.sceneGraph && !!window.__builderDebug?.getParitySnapshot, null, { timeout: 30000 });
}

async function openBuilder(page, preset = 'arena') {
  await page.goto(`${BASE_URL}/builder.html?preset=${preset}&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.bv2-asset-btn', { timeout: 30000 });
  const enterButton = page.locator('button:has-text("Enter")');
  if (await enterButton.isVisible().catch(() => false)) {
    await enterButton.click();
  }
  await page.waitForFunction(() => !!window.__builderDebug?.sceneGraph && !!window.__builderDebug?.getParitySnapshot, null, { timeout: 30000 });
}

async function seedBuilderLayout(page, layout) {
  await page.evaluate(async ({ roadCells = [], segments, extras }) => {
    const { loadModel } = await import('/src/builder-v2/asset-loader.js');
    const graph = window.__builderDebug.sceneGraph;
    const grid = window.__builderDebug.gridState;
    const road = window.__builderDebug.roadPainter;
    const THREE = window.__THREE;

    graph.clear();
    grid.clear();
    road.clearAll();

    for (const roadCell of roadCells) {
      await road.paint(roadCell.position.x, roadCell.position.z);
    }

    const makeMarker = (colorHex = 0xffffff, width = 4, height = 2, depth = 4) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: colorHex }),
      );
      mesh.castShadow = true;
      return mesh;
    };

    for (const segment of segments) {
      const model = await loadModel(segment.type);
      model.position.set(segment.position.x, Number(segment.position.y || 0), segment.position.z);
      model.rotation.y = -(segment.rotation * Math.PI / 180);
      model.scale.setScalar(Number(segment.scale || 1));
      const entity = graph.add({
        id: Number(segment.id),
        type: segment.type,
        category: 'segment',
        modelKey: segment.type,
        object3D: model,
        position: { ...segment.position, y: Number(segment.position.y || 0) },
        rotation: Number(segment.rotation || 0),
        scale: Number(segment.scale || 1),
      });
      grid.set(segment.position.x, segment.position.z, segment.type, Number(segment.rotation || 0), 'entity', entity.id);
    }

    for (const extra of extras) {
      const object3D = extra.category === 'spawn'
        ? makeMarker(0x44ff88, 3, 2, 6)
        : extra.type === 'item_box'
          ? makeMarker(0xffcc33, 3, 3, 3)
          : makeMarker(0x7788aa, 6, 3, 2);
      object3D.position.set(extra.position.x, Number(extra.position.y || 0), extra.position.z);
      graph.add({
        id: Number(extra.id),
        type: extra.type,
        category: extra.category,
        modelKey: extra.type,
        object3D,
        position: { ...extra.position, y: Number(extra.position.y || 0) },
        rotation: Number(extra.rotation || 0),
        scale: Number(extra.scale || 1),
        heading: Number(extra.heading || extra.rotation || 0),
      });
    }
  }, layout);
}

async function collectBuilderSnapshot(page) {
  return page.evaluate(() => window.__builderDebug.getParitySnapshot());
}

async function launchPlaytest(page) {
  await page.evaluate(() => {
    const originalOpen = window.open;
    window.__builderDirectPlaytestRestoreOpen = () => {
      window.open = originalOpen;
    };
    window.open = (url) => {
      window.location.href = url;
      return null;
    };
  });

  await page.click('#bv2-play');
  await page.waitForURL(/realtime\.html/, { timeout: 30000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__gloDebug, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__gloDebug.customArenaBuilt === true, null, { timeout: 60000 });
  await page.waitForFunction(
    () => window.__gloDebug.roomJoined === true || !!window.__gloClient?.room?.sessionId,
    null,
    { timeout: 60000 },
  );
  await page.evaluate(() => {
    window.__gloClient?.triggerStart?.();
  });
  await page.waitForTimeout(2500);
  await page.waitForFunction(() => Array.isArray(window.__gloDebug.customArenaSegments) && window.__gloDebug.customArenaSegments.length > 0, null, { timeout: 60000 });
  return page;
}

async function collectLiveSnapshot(page) {
  return page.evaluate(async () => {
    const room = window.__gloClient?.room || null;
    const entityEntries = typeof room?.state?.entities?.entries === 'function'
      ? Array.from(room.state.entities.entries())
      : [];
    const itemBoxEntities = entityEntries
      .filter(([, entity]) => String(entity?.type || '') === 'item_box')
      .map(([id, entity]) => ({
        id: String(id).replace(/^box_/, ''),
        position: {
          x: Number(entity?.x || 0),
          y: Number(entity?.y || 0),
          z: Number(entity?.z || 0),
        },
        active: !!entity?.active,
      }));

    let inputCheckpoints = [];
    let resolvedCheckpoints = [];

    try {
      const rawTrack = sessionStorage.getItem('customTrackData') || '';
      const customTrack = rawTrack ? JSON.parse(rawTrack) : null;
      inputCheckpoints = (customTrack?.checkpoints || []).map((checkpoint, index) => ({
        id: String(checkpoint?.id || index + 1),
        position: {
          x: Number(checkpoint?.position?.x || 0),
          y: Number(checkpoint?.position?.y || 0),
          z: Number(checkpoint?.position?.z || 0),
        },
        width: Number(checkpoint?.width || 0),
        rotation: Number(checkpoint?.rotation || 0),
      }));

      const configRaw = sessionStorage.getItem('gameConfig') || '';
      const config = configRaw ? JSON.parse(configRaw) : null;
      if ((config?.gameMode || 'race') === 'race') {
        const { loadTrackData, getCheckpoints } = await import('/src/modules/track-data-loader.js');
        const trackData = await loadTrackData(config?.trackId || 'custom_import', 'track');
        resolvedCheckpoints = (getCheckpoints(trackData) || []).map((checkpoint, index) => ({
          id: String(index + 1),
          quadIndex: Number(checkpoint?.quadIndex || 0),
          isLapLine: !!checkpoint?.isLapLine,
          center: {
            x: Number(checkpoint?.center?.[0] || 0),
            y: Number(checkpoint?.center?.[1] || 0),
            z: Number(checkpoint?.center?.[2] || 0),
          },
          width: Number(checkpoint?.width || 0),
        }));
      }
    } catch (error) {
      window.__gloDebug = window.__gloDebug || {};
      window.__gloDebug.errors = window.__gloDebug.errors || [];
      window.__gloDebug.errors.push(`checkpoint snapshot failed: ${error?.message || error}`);
    }

    return {
      roomName: window.__gloClient?.roomName || null,
      matchLive: window.__gloDebug?.matchLive || false,
      roomStarted: window.__gloClient?.room?.state?.started || false,
      roomJoined: window.__gloDebug?.roomJoined || false,
      roomSessionId: window.__gloClient?.room?.sessionId || null,
      countdownDurationMs: window.__gloClient?.room?.state?.countdownDurationMs || null,
      customArenaBuilt: window.__gloDebug?.customArenaBuilt || false,
      errors: window.__gloDebug?.errors || [],
      inputSegments: window.__gloDebug?.customArenaInputSegments || [],
      inputSpawns: window.__gloDebug?.customArenaInputSpawns || [],
      inputObstacles: window.__gloDebug?.customArenaInputObstacles || [],
      inputCheckpoints,
      resolvedSpawns: window.__gloDebug?.customArenaResolvedSpawns || [],
      resolvedCheckpoints,
      builtObstacles: window.__gloDebug?.customArenaBuiltObstacles || [],
      renderedSegments: window.__gloDebug?.customArenaSegments || [],
      connectorPairs: window.__gloDebug?.customArenaConnectorPairs || [],
      itemBoxEntities,
    };
  });
}

function compareSpawns(expectedSpawns, actualSpawns, label) {
  const expected = sortPlacements(expectedSpawns);
  const actual = sortPlacements(actualSpawns);
  record(expected.length === actual.length, `${label}: spawn count`, {
    expected: expected.length,
    actual: actual.length,
  });

  for (const expectedSpawn of expected) {
    const actualSpawn = actual.find((spawn) => String(spawn.id) === String(expectedSpawn.id));
    if (!record(!!actualSpawn, `${label}: spawn ${expectedSpawn.id} exists`, { expectedSpawn })) {
      continue;
    }

    record(approxEqual(actualSpawn.position?.x, expectedSpawn.position?.x), `${label}: spawn ${expectedSpawn.id} pos.x`, {
      expected: expectedSpawn.position?.x,
      actual: actualSpawn.position?.x,
    });
    record(approxEqual(actualSpawn.position?.y, expectedSpawn.position?.y), `${label}: spawn ${expectedSpawn.id} pos.y`, {
      expected: expectedSpawn.position?.y,
      actual: actualSpawn.position?.y,
    });
    record(approxEqual(actualSpawn.position?.z, expectedSpawn.position?.z), `${label}: spawn ${expectedSpawn.id} pos.z`, {
      expected: expectedSpawn.position?.z,
      actual: actualSpawn.position?.z,
    });
    record(approxEqual(actualSpawn.heading, expectedSpawn.heading), `${label}: spawn ${expectedSpawn.id} heading`, {
      expected: expectedSpawn.heading,
      actual: actualSpawn.heading,
    });
  }
}

function compareObstacles(expectedObstacles, actualObstacles, label) {
  const expected = sortPlacements(expectedObstacles);
  const actual = sortPlacements(actualObstacles);
  record(expected.length === actual.length, `${label}: obstacle count`, {
    expected: expected.length,
    actual: actual.length,
  });

  for (const expectedObstacle of expected) {
    const actualObstacle = actual.find((obstacle) => String(obstacle.id) === String(expectedObstacle.id));
    if (!record(!!actualObstacle, `${label}: obstacle ${expectedObstacle.id} exists`, { expectedObstacle })) {
      continue;
    }

    record(actualObstacle.type === expectedObstacle.type, `${label}: obstacle ${expectedObstacle.id} type`, {
      expected: expectedObstacle.type,
      actual: actualObstacle.type,
    });
    record(approxEqual(actualObstacle.position?.x, expectedObstacle.position?.x), `${label}: obstacle ${expectedObstacle.id} pos.x`, {
      expected: expectedObstacle.position?.x,
      actual: actualObstacle.position?.x,
    });
    record(approxEqual(actualObstacle.position?.z, expectedObstacle.position?.z), `${label}: obstacle ${expectedObstacle.id} pos.z`, {
      expected: expectedObstacle.position?.z,
      actual: actualObstacle.position?.z,
    });
    record(approxEqual(actualObstacle.rotation, expectedObstacle.rotation), `${label}: obstacle ${expectedObstacle.id} rotation`, {
      expected: expectedObstacle.rotation,
      actual: actualObstacle.rotation,
    });
    record(approxEqual(actualObstacle.scale, expectedObstacle.scale), `${label}: obstacle ${expectedObstacle.id} scale`, {
      expected: expectedObstacle.scale,
      actual: actualObstacle.scale,
    });
  }
}

function compareItemBoxes(expectedItemBoxes, actualItemBoxes, label) {
  const expected = [...expectedItemBoxes];
  const actual = [...actualItemBoxes];
  record(expected.length === actual.length, `${label}: item box count`, {
    expected: expected.length,
    actual: actual.length,
  });

  for (const expectedItemBox of expected) {
    const actualItemBox = actual.find((itemBox) => (
      approxEqual(itemBox.position?.x, expectedItemBox.position?.x)
      && approxEqual(itemBox.position?.y, expectedItemBox.position?.y)
      && approxEqual(itemBox.position?.z, expectedItemBox.position?.z)
    ));
    if (!record(!!actualItemBox, `${label}: item box ${expectedItemBox.id} exists`, { expectedItemBox })) {
      continue;
    }

    record(approxEqual(actualItemBox.position?.x, expectedItemBox.position?.x), `${label}: item box ${expectedItemBox.id} pos.x`, {
      expected: expectedItemBox.position?.x,
      actual: actualItemBox.position?.x,
    });
    record(approxEqual(actualItemBox.position?.y, expectedItemBox.position?.y), `${label}: item box ${expectedItemBox.id} pos.y`, {
      expected: expectedItemBox.position?.y,
      actual: actualItemBox.position?.y,
    });
    record(approxEqual(actualItemBox.position?.z, expectedItemBox.position?.z), `${label}: item box ${expectedItemBox.id} pos.z`, {
      expected: expectedItemBox.position?.z,
      actual: actualItemBox.position?.z,
    });
  }
}

function compareCheckpointInputs(expectedCheckpoints, actualCheckpoints, label) {
  const expected = sortPlacements(expectedCheckpoints);
  const actual = sortPlacements(actualCheckpoints);
  record(expected.length === actual.length, `${label}: checkpoint count`, {
    expected: expected.length,
    actual: actual.length,
  });

  for (const expectedCheckpoint of expected) {
    const actualCheckpoint = actual.find((checkpoint) => String(checkpoint.id) === String(expectedCheckpoint.id));
    if (!record(!!actualCheckpoint, `${label}: checkpoint ${expectedCheckpoint.id} exists`, { expectedCheckpoint })) {
      continue;
    }

    record(approxEqual(actualCheckpoint.position?.x, expectedCheckpoint.position?.x), `${label}: checkpoint ${expectedCheckpoint.id} pos.x`, {
      expected: expectedCheckpoint.position?.x,
      actual: actualCheckpoint.position?.x,
    });
    record(approxEqual(actualCheckpoint.position?.y, expectedCheckpoint.position?.y), `${label}: checkpoint ${expectedCheckpoint.id} pos.y`, {
      expected: expectedCheckpoint.position?.y,
      actual: actualCheckpoint.position?.y,
    });
    record(approxEqual(actualCheckpoint.position?.z, expectedCheckpoint.position?.z), `${label}: checkpoint ${expectedCheckpoint.id} pos.z`, {
      expected: expectedCheckpoint.position?.z,
      actual: actualCheckpoint.position?.z,
    });
    record(approxEqual(actualCheckpoint.width, expectedCheckpoint.width), `${label}: checkpoint ${expectedCheckpoint.id} width`, {
      expected: expectedCheckpoint.width,
      actual: actualCheckpoint.width,
    });
    record(approxEqual(actualCheckpoint.rotation, expectedCheckpoint.rotation), `${label}: checkpoint ${expectedCheckpoint.id} rotation`, {
      expected: expectedCheckpoint.rotation,
      actual: actualCheckpoint.rotation,
    });
  }
}

function compareResolvedCheckpoints(expectedCheckpoints, actualCheckpoints, label) {
  record(expectedCheckpoints.length === actualCheckpoints.length, `${label}: resolved checkpoint count`, {
    expected: expectedCheckpoints.length,
    actual: actualCheckpoints.length,
  });

  if (actualCheckpoints.length) {
    record(actualCheckpoints[0].isLapLine === true, `${label}: first checkpoint remains lap line`, {
      actual: actualCheckpoints[0],
    });
  }

  for (let index = 0; index < Math.min(expectedCheckpoints.length, actualCheckpoints.length); index += 1) {
    const expectedCheckpoint = expectedCheckpoints[index];
    const actualCheckpoint = actualCheckpoints[index];
    const dx = Number(actualCheckpoint.center?.x || 0) - Number(expectedCheckpoint.position?.x || 0);
    const dz = Number(actualCheckpoint.center?.z || 0) - Number(expectedCheckpoint.position?.z || 0);
    const planarDistance = Math.sqrt((dx * dx) + (dz * dz));

    record(planarDistance <= GRID_SIZE, `${label}: checkpoint ${expectedCheckpoint.id} center proximity`, {
      expectedPosition: expectedCheckpoint.position,
      actualCenter: actualCheckpoint.center,
      planarDistance,
      maxDistance: GRID_SIZE,
    });
    record(Number(actualCheckpoint.width || 0) > 0, `${label}: checkpoint ${expectedCheckpoint.id} resolved width populated`, {
      actual: actualCheckpoint.width,
    });
  }
}

const scenarios = [
  {
    id: 'arena-authored-layout',
    preset: 'arena',
    expectedRoom: 'builder_battle_playtest',
    layout: {
      segments: [
        { id: 1, type: 'wide', position: { x: 0, y: 0, z: 0 }, rotation: 0, scale: 1 },
        { id: 2, type: 'straight', position: { x: 10, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 3, type: 'corner-small', position: { x: 20, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 4, type: 'wide', position: { x: 20, y: 0, z: 10 }, rotation: 0, scale: 1 },
        { id: 5, type: 'bend-large', position: { x: 10, y: 0, z: 10 }, rotation: 180, scale: 1 },
        { id: 6, type: 'cap-back', position: { x: 0, y: 0, z: 10 }, rotation: 270, scale: 1 },
      ],
      extras: [
        { id: 101, type: 'spawn', category: 'spawn', position: { x: -6, y: 2, z: 0 }, heading: 90, scale: 1 },
        { id: 102, type: 'spawn', category: 'spawn', position: { x: -6, y: 2, z: 8 }, heading: 90, scale: 1 },
        { id: 201, type: 'item_box', category: 'obstacle', position: { x: 11, y: 1, z: 0 }, rotation: 0, scale: 1 },
        { id: 202, type: 'barrier', category: 'obstacle', position: { x: 24, y: 1, z: 10 }, rotation: 90, scale: 1 },
        { id: 203, type: 'boost_pad', category: 'obstacle', position: { x: 8, y: 0, z: 10 }, rotation: 0, scale: 1 },
      ],
    },
  },
  {
    id: 'arena-road-layout',
    preset: 'arena',
    expectedRoom: 'builder_battle_playtest',
    layout: {
      roadCells: [
        { id: 1, position: { x: 0, y: 0, z: 0 } },
        { id: 2, position: { x: 10, y: 0, z: 0 } },
        { id: 3, position: { x: 20, y: 0, z: 0 } },
        { id: 4, position: { x: 30, y: 0, z: 0 } },
        { id: 5, position: { x: 0, y: 0, z: 10 } },
        { id: 6, position: { x: 10, y: 0, z: 10 } },
        { id: 7, position: { x: 20, y: 0, z: 10 } },
        { id: 8, position: { x: 30, y: 0, z: 10 } },
        { id: 9, position: { x: 10, y: 0, z: 20 } },
        { id: 10, position: { x: 20, y: 0, z: 20 } },
        { id: 11, position: { x: 10, y: 0, z: -10 } },
        { id: 12, position: { x: 20, y: 0, z: -10 } },
      ],
      segments: [],
      extras: [
        { id: 101, type: 'spawn', category: 'spawn', position: { x: 0, y: 2, z: 0 }, heading: 90, scale: 1 },
        { id: 201, type: 'item_box', category: 'obstacle', position: { x: 10, y: 1, z: 0 }, rotation: 0, scale: 1 },
      ],
    },
  },
  {
    id: 'race-authored-layout',
    preset: 'track',
    expectedRoom: 'builder_race_playtest',
    layout: {
      segments: [
        { id: 1, type: 'straight', position: { x: 0, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 2, type: 'straight', position: { x: 10, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 3, type: 'corner-small', position: { x: 20, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 4, type: 'straight', position: { x: 20, y: 0, z: 10 }, rotation: 0, scale: 1 },
        { id: 5, type: 'corner-small', position: { x: 20, y: 0, z: 20 }, rotation: 180, scale: 1 },
        { id: 6, type: 'wide', position: { x: 10, y: 0, z: 20 }, rotation: 0, scale: 1 },
      ],
      extras: [
        { id: 101, type: 'spawn', category: 'spawn', position: { x: -6, y: 2, z: 0 }, heading: 90, scale: 1 },
        { id: 102, type: 'spawn', category: 'spawn', position: { x: -6, y: 2, z: 6 }, heading: 90, scale: 1 },
        { id: 151, type: 'checkpoint', category: 'obstacle', position: { x: 10, y: 0, z: 0 }, rotation: 90, scale: 1 },
        { id: 152, type: 'checkpoint', category: 'obstacle', position: { x: 20, y: 0, z: 10 }, rotation: 0, scale: 1.25 },
        { id: 153, type: 'checkpoint', category: 'obstacle', position: { x: 10, y: 0, z: 20 }, rotation: 270, scale: 1 },
        { id: 201, type: 'item_box', category: 'obstacle', position: { x: 10, y: 1, z: 4 }, rotation: 0, scale: 1 },
        { id: 202, type: 'barrier', category: 'obstacle', position: { x: 10, y: 1, z: 12 }, rotation: 0, scale: 1 },
        { id: 203, type: 'boost_pad', category: 'obstacle', position: { x: 20, y: 0, z: 6 }, rotation: 90, scale: 1 },
      ],
    },
  },
];

async function runScenario(browser, scenario) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  try {
    await openBuilder(page, scenario.preset);
    await seedBuilderLayout(page, scenario.layout);

    const builderSnapshot = await collectBuilderSnapshot(page);
    const playtestPage = await launchPlaytest(page);
    const liveSnapshot = await collectLiveSnapshot(playtestPage);

    record(liveSnapshot.roomName === scenario.expectedRoom, `${scenario.id}: playtest used dedicated room`, {
      expected: scenario.expectedRoom,
      actual: liveSnapshot.roomName,
    });
    record(liveSnapshot.customArenaBuilt === true, `${scenario.id}: custom layout built in runtime shell`);
    record(liveSnapshot.roomJoined === true || !!liveSnapshot.roomSessionId, `${scenario.id}: playtest joined runtime room`, {
      roomJoined: liveSnapshot.roomJoined,
      roomSessionId: liveSnapshot.roomSessionId,
    });
    record(liveSnapshot.countdownDurationMs === 2500, `${scenario.id}: builder countdown duration`, {
      expected: 2500,
      actual: liveSnapshot.countdownDurationMs,
    });
    note(`${scenario.id}: playtest live-state snapshot`, {
      matchLive: liveSnapshot.matchLive,
      roomStarted: liveSnapshot.roomStarted,
    });
    record((liveSnapshot.errors || []).length === 0, `${scenario.id}: runtime debug error list empty`, {
      errors: liveSnapshot.errors,
    });

    compareSegments(builderSnapshot.playtestTrackData.segments || [], liveSnapshot.inputSegments || [], `${scenario.id}: handoff input`);
    compareSegments(builderSnapshot.playtestTrackData.segments || [], liveSnapshot.renderedSegments || [], `${scenario.id}: runtime render`, { compareConnectors: true });

    const expectedSpawns = (builderSnapshot.playtestTrackData.startPositions || []).map((spawn, index) => ({
      id: String(spawn?.id || index + 1),
      position: {
        x: Number(spawn?.position?.x || 0),
        y: Number(spawn?.position?.y || 0),
        z: Number(spawn?.position?.z || 0),
      },
      heading: Number(spawn?.heading || 0),
    }));
    compareSpawns(expectedSpawns, liveSnapshot.resolvedSpawns || [], `${scenario.id}: spawn parity`);

    const expectedObstacles = (builderSnapshot.playtestTrackData.obstacles || [])
      .filter((obstacle) => String(obstacle?.type || '') !== 'item_box')
      .map((obstacle, index) => ({
        id: String(obstacle?.id || index + 1),
        type: String(obstacle?.type || 'barrier'),
        position: {
          x: Number(obstacle?.position?.x || 0),
          z: Number(obstacle?.position?.z || 0),
        },
        rotation: Number(obstacle?.rotation || 0),
        scale: Number(obstacle?.scale || 1),
      }));
    compareObstacles(expectedObstacles, liveSnapshot.builtObstacles || [], `${scenario.id}: obstacle parity`);

    const expectedItemBoxes = (builderSnapshot.playtestTrackData.obstacles || [])
      .filter((obstacle) => String(obstacle?.type || '') === 'item_box')
      .map((obstacle, index) => ({
        id: String(obstacle?.id || index + 1),
        position: {
          x: Number(obstacle?.position?.x || 0),
          y: Number(obstacle?.position?.y || 0),
          z: Number(obstacle?.position?.z || 0),
        },
      }));
    compareItemBoxes(expectedItemBoxes, liveSnapshot.itemBoxEntities || [], `${scenario.id}: item box parity`);

    const expectedCheckpoints = (builderSnapshot.playtestTrackData.checkpoints || []).map((checkpoint, index) => ({
      id: String(checkpoint?.id || index + 1),
      position: {
        x: Number(checkpoint?.position?.x || 0),
        y: Number(checkpoint?.position?.y || 0),
        z: Number(checkpoint?.position?.z || 0),
      },
      width: Number(checkpoint?.width || 0),
      rotation: Number(checkpoint?.rotation || 0),
    }));
    compareCheckpointInputs(expectedCheckpoints, liveSnapshot.inputCheckpoints || [], `${scenario.id}: checkpoint handoff`);
    if (scenario.preset === 'track') {
      compareResolvedCheckpoints(expectedCheckpoints, liveSnapshot.resolvedCheckpoints || [], `${scenario.id}: checkpoint runtime`);
    }

    await page.screenshot({ path: join(REPORT_DIR, `${scenario.id}-builder.png`), fullPage: true }).catch(() => {});
    await playtestPage.screenshot({ path: join(REPORT_DIR, `${scenario.id}-runtime.png`), fullPage: true }).catch(() => {});

    const report = {
      scenario: scenario.id,
      preset: scenario.preset,
      builderSnapshot,
      liveSnapshot,
      consoleErrors,
      failures,
      passed: failures.length === 0,
    };
    await writeFile(join(REPORT_DIR, `${scenario.id}.json`), JSON.stringify(report, null, 2), 'utf8');

    if (consoleErrors.length) {
      console.error(`Console errors encountered during ${scenario.id}:`);
      consoleErrors.forEach((entry) => console.error(entry));
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

async function main() {
  await mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    for (const scenario of scenarios) {
      const beforeFailures = failures.length;
      await runScenario(browser, scenario);
      if (failures.length === beforeFailures) {
        console.log(`${scenario.id}: passed`);
      }
    }

    if (failures.length) {
      process.exitCode = 1;
    } else {
      console.log('Builder direct playtest smoke passed.');
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});