/**
 * sample-palette.mjs — Extract actual RGB colors from the SKR colormap
 * at the UV coordinates used by the polished SKR models.
 */
import { chromium } from 'playwright';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

const BASE_URL = process.argv[2] || 'http://localhost:5175';

const MODULE_CODE = `
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Load the SKR straight to get the texture from the GLB (with correct flipY)
const loader = new GLTFLoader();
const gltf = await new Promise((res, rej) => loader.load('/models/skr/track-straight.glb', res, undefined, rej));

let tex = null;
gltf.scene.traverse(c => { if (c.isMesh && c.material.map) tex = c.material.map; });

if (!tex || !tex.image) {
  window.__paletteResults = { error: 'No texture found' };
} else {
  // Draw texture to canvas for pixel sampling
  const img = tex.image;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const W = img.width;
  const H = img.height;

  // flipY value from the GLB
  const flipY = tex.flipY;

  // Sample at UV coordinates (accounting for flipY)
  function sampleUV(u, v) {
    // UV to pixel: with flipY=false, v=0 is top, v=1 is bottom
    let px = Math.floor(u * W);
    let py;
    if (flipY) {
      py = Math.floor((1 - v) * H);
    } else {
      py = Math.floor(v * H);
    }
    px = Math.min(px, W - 1);
    py = Math.min(py, H - 1);
    const data = ctx.getImageData(px, py, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], hex: '#' + ((1 << 24) + (data[0] << 16) + (data[1] << 8) + data[2]).toString(16).slice(1) };
  }

  // UV coordinates from SKR model UV analysis
  const swatches = {
    ground:   { uv: [0.2188, 0.975],  desc: 'Palette[1,3] ground base' },
    road:     { uv: [0.5938, 0.875],  desc: 'Palette[4,3] road body/sides' },
    curb:     { uv: [0.4688, 0.605],  desc: 'Palette[3,2] curb detail' },
    mark:     { uv: [0.7188, 0.975],  desc: 'Palette[5,3] road markings' },
    surface:  { uv: [0.7188, 0.725],  desc: 'Palette[5,2] road surface' },
    wallGrn:  { uv: [0.093,  0.874],  desc: 'Palette[0,3] green elevated' },
    wallWrm:  { uv: [0.8438, 0.899],  desc: 'Palette[6,3] warm barrier' },
  };

  const results = { flipY, texSize: W + 'x' + H };
  for (const [name, sw] of Object.entries(swatches)) {
    const [u, v] = sw.uv;
    results[name] = { ...sampleUV(u, v), ...sw };
  }

  // Also sample the full 8×4 grid
  const grid = [];
  for (let row = 0; row < 4; row++) {
    const rowData = [];
    for (let col = 0; col < 8; col++) {
      const u = (col + 0.5) / 8;
      const v = (row + 0.5) / 4;
      rowData.push(sampleUV(u, v));
    }
    grid.push(rowData);
  }
  results.grid = grid;

  window.__paletteResults = results;
}
`;

async function main() {
  const tempFile = join(process.cwd(), 'src', 'builder-v2', '_palette_temp.js');
  writeFileSync(tempFile, MODULE_CODE);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', e => console.error('Page error:', e.message));

    await page.goto(`${BASE_URL}/builder.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);
    await page.click('#bv2-landing-new-track');
    await page.waitForTimeout(4000);

    await page.addScriptTag({ type: 'module', url: '/src/builder-v2/_palette_temp.js' });
    await page.waitForFunction(() => window.__paletteResults, { timeout: 60000 });
    const results = await page.evaluate(() => window.__paletteResults);

    if (results.error) {
      console.log('ERROR:', results.error);
      process.exit(1);
    }

    console.log('Texture flipY:', results.flipY, '  Size:', results.texSize);
    console.log('\\n=== SKR Swatch Colors ===');
    for (const [name, data] of Object.entries(results)) {
      if (name === 'flipY' || name === 'texSize' || name === 'grid') continue;
      console.log(`  ${name}: ${data.hex} (R=${data.r} G=${data.g} B=${data.b})  — ${data.desc}`);
    }

    console.log('\\n=== Full 8×4 Palette Grid ===');
    for (let row = 0; row < 4; row++) {
      const cells = results.grid[row].map((c, col) => `[${col},${row}]=${c.hex}`).join('  ');
      console.log(`  Row ${row}: ${cells}`);
    }
  } finally {
    try { unlinkSync(tempFile); } catch {}
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
