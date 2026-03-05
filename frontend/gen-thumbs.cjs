// gen-thumbs.cjs — generates static JPEG thumbnails for every track and arena.
// Uses Playwright to render thumbnail-render.html (Three.js + GLB) in headless Chromium,
// then screenshots the canvas and saves to public/thumbs/{mode}-{id}.jpg.
//
// Prerequisites: Vite dev server must be running on :5173
//   cd frontend && node gen-thumbs.cjs

const { chromium } = require('playwright');
const path  = require('path');
const fs    = require('fs');

// ── Rosters (must match lobby.js STK_TRACKS / STK_ARENAS) ──────────────────
const TRACKS = [
  'cocoa_temple', 'hacienda', 'minigolf', 'sandtrack', 'snowtuxpeak',
  'zengarden', 'lighthouse', 'olivermath', 'black_forest', 'xr591',
  'oasis', 'gran_paradiso_island', 'mines', 'snowmountain', 'abyss',
  'cornfield_crossing', 'volcano_island', 'ravenbridge_mansion',
];

const ARENAS = [
  'blockfort', 'battleisland', 'lasdunasarena', 'cave', 'pumpkin_park',
  'arena_candela_city', 'ancient_colosseum_labyrinth', 'stadium', 'alien_signal', 'temple',
];

// ── Config ───────────────────────────────────────────────────────────────────
const BASE_URL  = 'http://localhost:5173';
const OUT_DIR   = path.join(__dirname, 'public', 'thumbs');
const W = 600, H = 380;
const LOAD_TIMEOUT  = 90_000;  // 90 s per track (large GLBs can be slow on first load)
const SETTLE_MS     = 800;     // ms to wait after READY before screenshotting

// ── Run ───────────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const all = [
    ...TRACKS.map(id => ({ id, mode: 'race' })),
    ...ARENAS.map(id => ({ id, mode: 'battle' })),
  ];

  let ok = 0, skip = 0;

  for (const { id, mode } of all) {
    const outFile = path.join(OUT_DIR, `${mode}-${id}.jpg`);
    process.stdout.write(`  ${mode}/${id} … `);

    const page = await browser.newPage();
    await page.setViewportSize({ width: W, height: H });

    try {
      await page.goto(
        `${BASE_URL}/thumbnail-render.html?id=${id}&mode=${mode}`,
        { timeout: 15_000, waitUntil: 'domcontentloaded' }
      );

      await page.waitForFunction(
        () => document.title === 'READY' || document.title === 'ERROR',
        { timeout: LOAD_TIMEOUT }
      );

      const title = await page.title();
      if (title === 'ERROR') {
        console.log('SKIP (model error)');
        skip++;
      } else {
        // Give textures one more tick to finish uploading to GPU
        await page.waitForTimeout(SETTLE_MS);
        const canvas = await page.$('canvas');
        if (canvas) {
          await canvas.screenshot({ path: outFile, type: 'jpeg', quality: 88 });
          console.log('✓');
          ok++;
        } else {
          console.log('SKIP (no canvas)');
          skip++;
        }
      }
    } catch (e) {
      console.log(`SKIP (${e.message.slice(0, 60)})`);
      skip++;
    }

    await page.close();
  }

  await browser.close();
  console.log(`\nDone — ${ok} thumbnails saved, ${skip} skipped.`);
  console.log(`Output: ${OUT_DIR}`);
})();
