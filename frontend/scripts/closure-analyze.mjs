import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.click('#bv2-land-new');
  await page.waitForSelector('.bv2-asset-btn', { timeout: 15000 });
  await page.waitForTimeout(800);

  const result = await page.evaluate(async () => {
    const { loadModel, getModelMeta } = await import('/src/builder-v2/asset-loader.js');
    const { oppositeDir } = await import('/src/builder-v2/grid-placement.js');
    const sg = window.__builderDebug.sceneGraph;
    const gs = window.__builderDebug.gridState;

    function rotateXZ(x, z, rotDeg) {
      const steps = Math.round((((rotDeg % 360) + 360) % 360) / 90);
      if (steps === 0) return { x, z };
      if (steps === 1) return { x: -z, z: x };
      if (steps === 2) return { x: -x, z: -z };
      return { x: z, z: -x };
    }

    function getConnectors(entity) {
      const meta = getModelMeta(entity.type);
      return Object.entries(meta.portAnchors).map(([baseDirStr, anchor]) => {
        const baseDir = Number(baseDirStr);
        const steps = Math.round((((entity.rotation % 360) + 360) % 360) / 90);
        const dir = (baseDir + steps) % 4;
        const rotated = rotateXZ(anchor.x * meta.scale, anchor.z * meta.scale, entity.rotation);
        return { entityId: entity.id, type: entity.type, dir, x: entity.position.x + rotated.x, z: entity.position.z + rotated.z };
      });
    }

    async function place(type, x, z, rotation) {
      await loadModel(type);
      const model = await loadModel(type);
      model.position.set(x, 0, z);
      model.rotation.y = -(rotation * Math.PI / 180);
      const entity = sg.add({ id: 0, type, category: 'segment', modelKey: type, object3D: model, position: { x, y: 0, z }, rotation, scale: 1 });
      gs.set(Math.round(x / 10) * 10, Math.round(z / 10) * 10, type, rotation, 'entity', entity.id);
      return entity;
    }

    gs.clear();
    sg.clear();

    // Build a near-closed loop similar to the screenshot.
    const layout = [
      ['straight', 0, 0, 90],
      ['straight', 10, 0, 90],
      ['straight', 20, 0, 90],
      ['straight', 30, 0, 90],
      ['corner-large', 40, 0, 90],
      ['straight', 50, 10, 0],
      ['curve', 50, 20, 180],
      ['curve', 60, 30, 270],
      ['straight', 50, 40, 90],
      ['straight', 40, 40, 90],
      ['curve', 30, 40, 0],
      ['corner-large', 20, 30, 180],
      ['straight', 10, 20, 0],
      ['straight', 10, 10, 0],
      ['curve', 10, -10, 90],
    ];

    const entities = [];
    for (const [type, x, z, rotation] of layout) {
      entities.push(await place(type, x, z, rotation));
    }

    const connectors = entities.flatMap(getConnectors);
    const open = [];
    for (let i = 0; i < connectors.length; i++) {
      const a = connectors[i];
      let matched = false;
      for (let j = 0; j < connectors.length; j++) {
        if (i === j) continue;
        const b = connectors[j];
        if (a.entityId === b.entityId) continue;
        if (b.dir !== oppositeDir(a.dir)) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < 0.35) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        open.push({ type: a.type, dir: a.dir, x: +a.x.toFixed(3), z: +a.z.toFixed(3) });
      }
    }

    let bestPair = null;
    for (let i = 0; i < open.length; i++) {
      for (let j = i + 1; j < open.length; j++) {
        const a = open[i];
        const b = open[j];
        if (b.dir !== oppositeDir(a.dir)) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!bestPair || d < bestPair.distance) {
          bestPair = { a, b, distance: +d.toFixed(3) };
        }
      }
    }

    return { open, bestPair, entities: entities.map((e) => ({ type: e.type, x: e.position.x, z: e.position.z, rotation: e.rotation })) };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
