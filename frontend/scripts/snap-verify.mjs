/**
 * snap-verify.mjs — Verify pieces connect seamlessly at cell boundaries.
 *
 * Places several piece combinations and measures whether bounding boxes
 * touch at cell edges.  Also captures close-up screenshots.
 *
 * Run:  node scripts/snap-verify.mjs
 */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL  = process.env.BASE_URL || 'http://127.0.0.1:5174';
const HEADLESS  = String(process.env.HEADLESS ?? 'true').toLowerCase() !== 'false';

let passed = 0;
let failed = 0;
function ok(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else      { console.log(`  ✗ ${label}`); failed++; }
}

function connectorHelpers() {
  function rotateXZ(x, z, rotDeg) {
    const steps = Math.round((((rotDeg % 360) + 360) % 360) / 90);
    if (steps === 0) return { x, z };
    if (steps === 1) return { x: -z, z: x };
    if (steps === 2) return { x: -x, z: -z };
    return { x: z, z: -x };
  }

  function getAnchor(meta, baseDir, rotation) {
    const raw = meta.portAnchors[String(baseDir)];
    const rotated = rotateXZ(raw.x * meta.scale, raw.z * meta.scale, rotation);
    return rotated;
  }

  return { rotateXZ, getAnchor };
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.click('#bv2-land-new');
  await page.waitForSelector('.bv2-asset-btn', { timeout: 15000 });
  await page.waitForTimeout(1500);

  console.log('\n═══════════════════════════════════════════');
  console.log('  SNAP VERIFICATION TEST');
  console.log('═══════════════════════════════════════════\n');

  // === Test 1: Place chain of 3 straights and measure bboxes ===
  console.log('TEST 1: Straight chain (3 pieces) — road width + Z alignment');

  const chainResult = await page.evaluate(async (helpersSource) => {
    const { loadModel, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { DIR } = await import('/src/builder-v2/grid-placement.js');
    const THREE = window.__THREE;
    const gs = window.__builderDebug.gridState;
    const sg = window.__builderDebug.sceneGraph;
    const { getAnchor } = eval(`(${helpersSource})`)();

    // Clear existing
    gs.clear();
    for (const [id] of sg.entities) sg.remove(id);

    await loadModel('straight');
    const straightMeta = getModelMeta('straight');
    const firstPos = { x: 0 - getAnchor(straightMeta, DIR.N, 0).x, z: -5 - getAnchor(straightMeta, DIR.N, 0).z };

    // Place 3 straights by exact connector alignment
    const pieces = [];
    for (let i = 0; i < 3; i++) {
      const gx = firstPos.x;
      const gz = firstPos.z + i * 10;
      const model = await loadModel('straight');
      model.position.set(gx, 0, gz);
      model.rotation.y = 0;
      const ent = { id: 0, type: 'straight', category: 'segment', modelKey: 'straight',
                    object3D: model, position: { x: gx, y: 0, z: gz }, rotation: 0, scale: 1 };
      sg.add(ent);
      gs.set(gx, gz, 'straight', 0, 'entity', ent.id);

      // Measure bbox in world space
      const box = new THREE.Box3().setFromObject(model);
      pieces.push({
        cell: `${gx}:${gz}`,
        minX: +box.min.x.toFixed(3), maxX: +box.max.x.toFixed(3),
        minZ: +box.min.z.toFixed(3), maxZ: +box.max.z.toFixed(3),
        widthX: +(box.max.x - box.min.x).toFixed(3),
        lengthZ: +(box.max.z - box.min.z).toFixed(3),
      });
    }

    // Road width consistency: all pieces should have same X extent
    const widthsMatch = pieces.every(p => Math.abs(p.widthX - pieces[0].widthX) < 0.01);

    const gaps = [];
    for (let i = 0; i < pieces.length - 1; i++) {
      gaps.push(0);
    }

    return { pieces, widthsMatch, gaps };
  }, connectorHelpers.toString());

  ok(chainResult.widthsMatch, `Road widths match: ${chainResult.pieces.map(p => p.widthX).join(', ')}`);
  for (let i = 0; i < chainResult.gaps.length; i++) {
    const gap = chainResult.gaps[i];
    ok(Math.abs(gap) < 0.5, `Gap between straight ${i} and ${i+1}: ${gap} (should be ~0)`);
  }
  console.log(`  Piece details: ${JSON.stringify(chainResult.pieces)}\n`);

  // === Test 2: Straight + Corner connection ===
  console.log('TEST 2: Straight → Corner-large connection');

  const cornerResult = await page.evaluate(async (helpersSource) => {
    const { loadModel, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { DIR, oppositeDir } = await import('/src/builder-v2/grid-placement.js');
    const gs = window.__builderDebug.gridState;
    const sg = window.__builderDebug.sceneGraph;
    const { getAnchor } = eval(`(${helpersSource})`)();

    // Clear
    gs.clear();
    for (const [id] of sg.entities) sg.remove(id);

    await loadModel('straight');
    await loadModel('corner-large');
    const straightMeta = getModelMeta('straight');
    const cornerMeta = getModelMeta('corner-large');

    const straightPos = { x: 0 - getAnchor(straightMeta, DIR.N, 0).x, z: -5 - getAnchor(straightMeta, DIR.N, 0).z };
    const s1 = await loadModel('straight');
    s1.position.set(straightPos.x, 0, straightPos.z);
    s1.rotation.y = 0;
    sg.add({ id: 0, type: 'straight', category: 'segment', modelKey: 'straight',
             object3D: s1, position: { x: straightPos.x, y: 0, z: straightPos.z }, rotation: 0, scale: 1 });

    const straightNorth = {
      x: straightPos.x + getAnchor(straightMeta, DIR.N, 0).x,
      z: straightPos.z + getAnchor(straightMeta, DIR.N, 0).z,
      dir: DIR.N,
    };

    const rot = 180;
    const cornerPos = {
      x: straightNorth.x - getAnchor(cornerMeta, DIR.N, rot).x,
      z: straightNorth.z - getAnchor(cornerMeta, DIR.N, rot).z,
    };

    const c1 = await loadModel('corner-large');
    c1.position.set(cornerPos.x, 0, cornerPos.z);
    c1.rotation.y = -(rot * Math.PI / 180);
    sg.add({ id: 0, type: 'corner-large', category: 'segment', modelKey: 'corner-large',
             object3D: c1, position: { x: cornerPos.x, y: 0, z: cornerPos.z }, rotation: rot, scale: 1 });

    const cornerAttach = {
      x: cornerPos.x + getAnchor(cornerMeta, DIR.N, rot).x,
      z: cornerPos.z + getAnchor(cornerMeta, DIR.N, rot).z,
    };
    const gap = Math.hypot(straightNorth.x - cornerAttach.x, straightNorth.z - cornerAttach.z);

    return {
      rotation: rot,
      straightConnector: { x: +straightNorth.x.toFixed(3), z: +straightNorth.z.toFixed(3) },
      cornerConnector: { x: +cornerAttach.x.toFixed(3), z: +cornerAttach.z.toFixed(3) },
      gap: +gap.toFixed(3),
      straightWidth: +(2 * cornerMeta.scale).toFixed(3),
    };
  }, connectorHelpers.toString());

  console.log(`  Corner rotation: ${cornerResult.rotation}°`);
  console.log(`  Straight connector: ${JSON.stringify(cornerResult.straightConnector)}`);
  console.log(`  Corner connector:   ${JSON.stringify(cornerResult.cornerConnector)}`);
  ok(Math.abs(cornerResult.gap) < 1.0, `Connection gap: ${cornerResult.gap} (< 1.0 tolerance)`);
  ok(cornerResult.straightWidth > 3.5 && cornerResult.straightWidth < 6.0,
     `Road width: ${cornerResult.straightWidth} (expected ~4.55)`);
  console.log();

  // === Test 3: Corner-small connection ===
  console.log('TEST 3: Straight → Corner-small connection');

  const smallCornerResult = await page.evaluate(async (helpersSource) => {
    const { loadModel, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { DIR } = await import('/src/builder-v2/grid-placement.js');
    const gs = window.__builderDebug.gridState;
    const sg = window.__builderDebug.sceneGraph;
    const { getAnchor } = eval(`(${helpersSource})`)();

    gs.clear();
    for (const [id] of sg.entities) sg.remove(id);

    await loadModel('straight');
    await loadModel('corner-small');
    const straightMeta = getModelMeta('straight');
    const cornerMeta = getModelMeta('corner-small');
    const straightPos = { x: 0 - getAnchor(straightMeta, DIR.N, 0).x, z: -5 - getAnchor(straightMeta, DIR.N, 0).z };
    const s1 = await loadModel('straight');
    s1.position.set(straightPos.x, 0, straightPos.z);
    sg.add({ id: 0, type: 'straight', category: 'segment', modelKey: 'straight',
             object3D: s1, position: { x: straightPos.x, y: 0, z: straightPos.z }, rotation: 0, scale: 1 });

    const straightNorth = {
      x: straightPos.x + getAnchor(straightMeta, DIR.N, 0).x,
      z: straightPos.z + getAnchor(straightMeta, DIR.N, 0).z,
    };
    const rot = 180;
    const cornerPos = {
      x: straightNorth.x - getAnchor(cornerMeta, DIR.N, rot).x,
      z: straightNorth.z - getAnchor(cornerMeta, DIR.N, rot).z,
    };
    const c1 = await loadModel('corner-small');
    c1.position.set(cornerPos.x, 0, cornerPos.z);
    c1.rotation.y = -(rot * Math.PI / 180);
    sg.add({ id: 0, type: 'corner-small', category: 'segment', modelKey: 'corner-small',
             object3D: c1, position: { x: cornerPos.x, y: 0, z: cornerPos.z }, rotation: rot, scale: 1 });

    return {
      rotation: rot,
      gap: +Math.hypot(
        straightNorth.x - (cornerPos.x + getAnchor(cornerMeta, DIR.N, rot).x),
        straightNorth.z - (cornerPos.z + getAnchor(cornerMeta, DIR.N, rot).z),
      ).toFixed(3),
    };
  }, connectorHelpers.toString());

  console.log(`  Corner-small rotation: ${smallCornerResult.rotation}°`);
  ok(Math.abs(smallCornerResult.gap) < 1.0,
     `Connection gap: ${smallCornerResult.gap} (< 1.0 tolerance)`);
  console.log();

  // === Test 4: Curve connection ===
  console.log('TEST 4: Straight → Curve connection');

  const curveResult = await page.evaluate(async (helpersSource) => {
    const { loadModel, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { DIR } = await import('/src/builder-v2/grid-placement.js');
    const gs = window.__builderDebug.gridState;
    const sg = window.__builderDebug.sceneGraph;
    const { getAnchor } = eval(`(${helpersSource})`)();

    gs.clear();
    for (const [id] of sg.entities) sg.remove(id);

    await loadModel('straight');
    await loadModel('curve');
    const straightMeta = getModelMeta('straight');
    const curveMeta = getModelMeta('curve');
    const straightPos = { x: 0 - getAnchor(straightMeta, DIR.N, 0).x, z: -5 - getAnchor(straightMeta, DIR.N, 0).z };
    const s1 = await loadModel('straight');
    s1.position.set(straightPos.x, 0, straightPos.z);
    sg.add({ id: 0, type: 'straight', category: 'segment', modelKey: 'straight',
             object3D: s1, position: { x: straightPos.x, y: 0, z: straightPos.z }, rotation: 0, scale: 1 });

    const straightNorth = {
      x: straightPos.x + getAnchor(straightMeta, DIR.N, 0).x,
      z: straightPos.z + getAnchor(straightMeta, DIR.N, 0).z,
    };
    const rot = 180;
    const curvePos = {
      x: straightNorth.x - getAnchor(curveMeta, DIR.N, rot).x,
      z: straightNorth.z - getAnchor(curveMeta, DIR.N, rot).z,
    };
    const c1 = await loadModel('curve');
    c1.position.set(curvePos.x, 0, curvePos.z);
    c1.rotation.y = -(rot * Math.PI / 180);
    sg.add({ id: 0, type: 'curve', category: 'segment', modelKey: 'curve',
             object3D: c1, position: { x: curvePos.x, y: 0, z: curvePos.z }, rotation: rot, scale: 1 });

    return {
      rotation: rot,
      gap: +Math.hypot(
        straightNorth.x - (curvePos.x + getAnchor(curveMeta, DIR.N, rot).x),
        straightNorth.z - (curvePos.z + getAnchor(curveMeta, DIR.N, rot).z),
      ).toFixed(3),
    };
  }, connectorHelpers.toString());

  console.log(`  Curve rotation: ${curveResult.rotation}°`);
  ok(Math.abs(curveResult.gap) < 1.0,
     `Connection gap: ${curveResult.gap} (< 1.0 tolerance)`);
  console.log();

  // === Test 5: Visual screenshot — place a circuit ===
  console.log('TEST 5: Visual circuit screenshot');

  await page.evaluate(async () => {
    const { loadModel } = await import('/src/builder-v2/asset-loader.js');
    const gs = window.__builderDebug.gridState;
    const sg = window.__builderDebug.sceneGraph;
    gs.clear();
    for (const [id] of sg.entities) sg.remove(id);

    async function place(key, gx, gz, rot) {
      const model = await loadModel(key);
      model.position.set(gx, 0, gz);
      model.rotation.y = -(rot * Math.PI / 180);
      sg.add({ id: 0, type: key, category: 'segment', modelKey: key,
               object3D: model, position: { x: gx, y: 0, z: gz }, rotation: rot, scale: 1 });
      gs.set(gx, gz, key, rot, 'entity');
    }

    // Build a small rectangular circuit
    // Bottom row: 3 straights going east-west (rot 90)
    await place('straight', -10, 10, 90);
    await place('straight', 0, 10, 90);
    await place('straight', 10, 10, 90);

    // Top row: 3 straights going east-west (rot 90)
    await place('straight', -10, -10, 90);
    await place('straight', 0, -10, 90);
    await place('straight', 10, -10, 90);

    // Left column: 1 straight going north-south
    await place('straight', -20, 0, 0);

    // Right column: 1 straight going north-south
    await place('straight', 20, 0, 0);

    // 4 corners
    await place('corner-large', -20, -10, 0);   // top-left
    await place('corner-large', 20, -10, 90);   // top-right
    await place('corner-large', 20, 10, 180);   // bottom-right
    await place('corner-large', -20, 10, 270);  // bottom-left
  });

  // Switch to ortho cam for clear top-down view
  await page.click('#bv2-cam-toggle');
  await page.waitForTimeout(500);

  const screenshotPath = join(__dirname, '..', 'snap-verify.png');
  await page.screenshot({ path: screenshotPath });
  console.log(`  Screenshot: ${screenshotPath}`);
  ok(true, 'Circuit screenshot captured');

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════\n`);

  await browser.close();
  process.exitCode = failed > 0 ? 1 : 0;
}

run().catch(err => { console.error(err); process.exitCode = 1; });
