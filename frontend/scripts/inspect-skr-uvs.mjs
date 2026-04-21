/**
 * inspect-skr-uvs.mjs — Dump UV coordinate ranges from SKR models
 * to understand which palette colors map to road surface, curbs, etc.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const MODULE_CODE = `
import * as THREE from 'three';
import { loadModel } from './asset-loader.js';

const keys = ['skr-straight', 'skr-corner', 'skr-finish', 'skr-bump'];
const out = {};

for (const key of keys) {
  try {
    const m = await loadModel(key);
    const meshData = [];
    m.traverse((child) => {
      if (!child.isMesh) return;
      const geo = child.geometry;
      const pos = geo.attributes.position;
      const uv = geo.attributes.uv;
      const idx = geo.index;
      
      if (!uv || !pos) return;

      // Group faces by their UV region (palette swatch)
      const SWATCH_COLS = 8;
      const SWATCH_ROWS = 4;
      const faceGroups = {};
      
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      for (let tri = 0; tri < triCount; tri++) {
        const i0 = idx ? idx.getX(tri * 3) : tri * 3;
        const i1 = idx ? idx.getX(tri * 3 + 1) : tri * 3 + 1;
        const i2 = idx ? idx.getX(tri * 3 + 2) : tri * 3 + 2;
        
        // Average UV of triangle
        const avgU = (uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3;
        const avgV = (uv.getY(i0) + uv.getY(i1) + uv.getY(i2)) / 3;
        
        // Which swatch?
        const col = Math.floor(avgU * SWATCH_COLS);
        const row = Math.floor(avgV * SWATCH_ROWS);
        const swatchKey = col + ',' + row;
        
        if (!faceGroups[swatchKey]) {
          faceGroups[swatchKey] = { col, row, triCount: 0, avgU: 0, avgV: 0, 
            yMin: Infinity, yMax: -Infinity, xMin: Infinity, xMax: -Infinity,
            zMin: Infinity, zMax: -Infinity };
        }
        const g = faceGroups[swatchKey];
        g.triCount++;
        g.avgU += avgU;
        g.avgV += avgV;
        
        // Track position bounds of faces in this swatch group
        for (const vi of [i0, i1, i2]) {
          const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
          g.xMin = Math.min(g.xMin, x);
          g.xMax = Math.max(g.xMax, x);
          g.yMin = Math.min(g.yMin, y);
          g.yMax = Math.max(g.yMax, y);
          g.zMin = Math.min(g.zMin, z);
          g.zMax = Math.max(g.zMax, z);
        }
      }
      
      // Finalize averages
      const groups = [];
      for (const [sk, g] of Object.entries(faceGroups)) {
        g.avgU = +(g.avgU / g.triCount).toFixed(4);
        g.avgV = +(g.avgV / g.triCount).toFixed(4);
        g.xMin = +g.xMin.toFixed(3); g.xMax = +g.xMax.toFixed(3);
        g.yMin = +g.yMin.toFixed(3); g.yMax = +g.yMax.toFixed(3);
        g.zMin = +g.zMin.toFixed(3); g.zMax = +g.zMax.toFixed(3);
        groups.push(g);
      }

      // Also get texture info
      const mat = child.material;
      const texInfo = mat.map ? {
        image: mat.map.image ? { w: mat.map.image.width, h: mat.map.image.height } : null,
        wrapS: mat.map.wrapS,
        wrapT: mat.map.wrapT,
      } : null;

      meshData.push({
        name: child.name,
        vertCount: pos.count,
        triCount,
        texture: texInfo,
        swatchGroups: groups,
      });
    });
    out[key] = meshData;
  } catch(e) {
    out[key] = { error: e.message };
  }
}

window.__uvResults = out;
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_inspect_uv_temp.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.error('Page error:', e.message));

    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_inspect_uv_temp.js' });
    await page.waitForFunction(() => window.__uvResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__uvResults);

    for (const [key, meshes] of Object.entries(results)) {
      console.log(`\\n=== ${key} ===`);
      if (meshes.error) { console.log('  ERROR:', meshes.error); continue; }
      for (const mesh of meshes) {
        console.log(`  Mesh: "${mesh.name}" (${mesh.vertCount} verts, ${mesh.triCount} tris)`);
        if (mesh.texture) console.log(`  Texture: ${mesh.texture.image?.w}x${mesh.texture.image?.h}`);
        console.log('  Swatch groups:');
        for (const g of mesh.swatchGroups) {
          console.log(`    Palette[${g.col},${g.row}] ${g.triCount} tris  uv=(${g.avgU},${g.avgV})  y=[${g.yMin}..${g.yMax}]  x=[${g.xMin}..${g.xMax}]  z=[${g.zMin}..${g.zMax}]`);
        }
      }
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
