/**
 * inspect-custom-glbs.mjs — Inspect the original custom GLB models
 * to see their geometry, materials, and dimensions.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const MODULE_CODE = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function loadGLB(url) {
  return new Promise((resolve, reject) => {
    loader.load(url, gltf => resolve(gltf), undefined, reject);
  });
}

const files = [
  'track-road-wide-straight.glb',
  'track-road-wide-corner-large.glb',
  'track-road-wide-corner-small.glb',
  'track-road-wide-curve.glb',
  'track-road-wide-straight-bump-up.glb',
  'track-road-wide-straight-hill-beginning.glb',
  'track-road-wide-straight-bend.glb',
  'track-road-wide-straight-skew-left.glb',
  'track-road-wide-cap-front.glb',
  'track-road-wide.glb',
  'track-end.glb',
];

const out = {};
for (const file of files) {
  try {
    const gltf = await loadGLB('/models/track/' + file);
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    
    const meshes = [];
    root.traverse(child => {
      if (!child.isMesh) return;
      const mat = child.material;
      const geo = child.geometry;
      const cbox = new THREE.Box3().setFromObject(child);
      const csize = cbox.getSize(new THREE.Vector3());
      
      meshes.push({
        name: child.name,
        verts: geo.attributes.position?.count,
        size: { x: +csize.x.toFixed(3), y: +csize.y.toFixed(3), z: +csize.z.toFixed(3) },
        matType: mat.type,
        color: mat.color ? '#' + mat.color.getHexString() : null,
        rough: mat.roughness,
        metal: mat.metalness,
        hasMap: !!mat.map,
        mapFlipY: mat.map?.flipY,
        mapName: mat.map?.name || null,
      });
    });

    out[file] = {
      totalSize: { x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3) },
      min: { x: +box.min.x.toFixed(3), y: +box.min.y.toFixed(3), z: +box.min.z.toFixed(3) },
      max: { x: +box.max.x.toFixed(3), y: +box.max.y.toFixed(3), z: +box.max.z.toFixed(3) },
      meshCount: meshes.length,
      meshes,
    };
  } catch(e) {
    out[file] = { error: e.message };
  }
}

window.__customGlbResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_custom_inspect.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.error('Page error:', e.message));

    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_custom_inspect.js' });
    await page.waitForFunction(() => window.__customGlbResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__customGlbResults);

    for (const [file, data] of Object.entries(results)) {
      console.log('\\n=== ' + file + ' ===');
      if (data.error) { console.log('  ERROR:', data.error); continue; }
      console.log('  Size:', data.totalSize.x, '×', data.totalSize.y, '×', data.totalSize.z);
      console.log('  Min:', JSON.stringify(data.min), '  Max:', JSON.stringify(data.max));
      for (const m of data.meshes) {
        console.log('  Mesh "' + m.name + '" (' + m.verts + ' verts)  size=' + m.size.x + '×' + m.size.y + '×' + m.size.z);
        console.log('    mat=' + m.matType + ' color=' + m.color + ' rough=' + m.rough + ' metal=' + m.metal + ' map=' + m.hasMap + ' flipY=' + m.mapFlipY);
      }
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
