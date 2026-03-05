// gen-gifs.cjs — generates 120-frame animated GIFs for every track and arena
// by recording a Three.js orbital flythrough via Playwright, then converting
// the captured WebM to an optimised GIF with ffmpeg.
//
// No internet connection required — uses the local GLB model files.
// Prerequisites: Vite dev server running on :5173
//   cd frontend && node gen-gifs.cjs

const { chromium }   = require('playwright');
const { execSync }   = require('child_process');
const path           = require('path');
const fs             = require('fs');
const os             = require('os');

// ── Rosters (must match lobby.js STK_TRACKS / STK_ARENAS) ──────────────────
const MAPS = [
  // Race tracks
  { id: 'cocoa_temple',         mode: 'race' },
  { id: 'hacienda',             mode: 'race' },
  { id: 'minigolf',             mode: 'race' },
  { id: 'sandtrack',            mode: 'race' },
  { id: 'snowtuxpeak',          mode: 'race' },
  { id: 'zengarden',            mode: 'race' },
  { id: 'lighthouse',           mode: 'race' },
  { id: 'olivermath',           mode: 'race' },
  { id: 'black_forest',         mode: 'race' },
  { id: 'xr591',                mode: 'race' },
  { id: 'oasis',                mode: 'race' },
  { id: 'gran_paradiso_island', mode: 'race' },
  { id: 'mines',                mode: 'race' },
  { id: 'snowmountain',         mode: 'race' },
  { id: 'abyss',                mode: 'race' },
  { id: 'cornfield_crossing',   mode: 'race' },
  { id: 'volcano_island',       mode: 'race' },
  { id: 'ravenbridge_mansion',  mode: 'race' },
  // Battle arenas
  { id: 'blockfort',                   mode: 'battle' },
  { id: 'battleisland',                mode: 'battle' },
  { id: 'lasdunasarena',               mode: 'battle' },
  { id: 'cave',                        mode: 'battle' },
  { id: 'pumpkin_park',                mode: 'battle' },
  { id: 'arena_candela_city',          mode: 'battle' },
  { id: 'ancient_colosseum_labyrinth', mode: 'battle' },
  { id: 'stadium',                     mode: 'battle' },
  { id: 'alien_signal',                mode: 'battle' },
  { id: 'temple',                      mode: 'battle' },
];

// ── Locate ffmpeg (winget installs to a non-PATH location) ───────────────────
function findFfmpeg() {
  // 1. Try whatever is on PATH already
  try { execSync('ffmpeg -version', { stdio: 'pipe', windowsHide: true }); return 'ffmpeg'; } catch {}
  // 2. Walk WinGet packages for Gyan.FFmpeg
  const wingetBase = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft', 'WinGet', 'Packages'
  );
  try {
    for (const pkg of fs.readdirSync(wingetBase)) {
      if (!pkg.startsWith('Gyan.FFmpeg')) continue;
      const pkgDir = path.join(wingetBase, pkg);
      for (const ver of fs.readdirSync(pkgDir)) {
        const bin = path.join(pkgDir, ver, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(bin)) return `"${bin}"`;
      }
    }
  } catch {}
  // 3. Try Shutter Encoder / Ardour bundled copies
  const extras = [
    'C:\\Program Files\\Shutter Encoder\\Library\\ffmpeg.exe',
    'C:\\Program Files\\Ardour9\\video\\harvid\\ffmpeg.exe',
  ];
  for (const p of extras) if (fs.existsSync(p)) return `"${p}"`;
  return 'ffmpeg'; // last resort
}

const FFMPEG = findFfmpeg();
console.log(`ffmpeg: ${FFMPEG}`);

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL   = 'http://localhost:5173';
const OUT_DIR    = path.join(__dirname, 'public', 'thumbs');
const TMP_DIR    = path.join(os.tmpdir(), 'glo-kart-gif-tmp');
const GIF_W      = 400;
const GIF_H      = 250;
const GIF_FPS    = 8;         // 8 fps × 15 s = 120 frames
const GIF_DUR    = 15;        // seconds of orbit footage to encode
const PAGE_TIMEOUT  = 35_000; // max time to wait for ORBIT_DONE signal

// ── ffmpeg: WebM → 120-frame palette-optimised GIF ───────────────────────────
function webmToGif(webmPath, outPath) {
  // Single-pass with split filter: no temp palette file needed
  const filter = [
    `fps=${GIF_FPS}`,
    `scale=${GIF_W}:${GIF_H}:flags=lanczos`,
    'split[s0][s1]',
    '[s0]palettegen=max_colors=128:stats_mode=diff[p]',
    '[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  ].join(',');

  const cmd = [
    FFMPEG + ' -y',
    `-i "${webmPath}"`,
    `-t ${GIF_DUR}`,
    `-vf "${filter}"`,
    '-loop 0',
    `"${outPath}"`,
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'pipe', windowsHide: true });
    return true;
  } catch (e) {
    process.stderr.write(`    [ffmpeg] ${e.stderr?.toString().slice(-200) || e.message}\n`);
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-webgl',
      '--use-gl=angle',
      '--ignore-gpu-blocklist',
      '--enable-accelerated-2d-canvas',
    ],
  });

  let ok = 0, fail = 0;
  const failed = [];

  for (const { id, mode } of MAPS) {
    const outGif    = path.join(OUT_DIR, `${mode}-${id}.gif`);
    const webmStash = path.join(TMP_DIR, `${mode}-${id}.webm`);
    process.stdout.write(`  ${mode}/${id} … `);

    // Each map gets its own context so recordVideo creates a fresh file
    const context = await browser.newContext({
      recordVideo: {
        dir:  TMP_DIR,
        size: { width: GIF_W, height: GIF_H },
      },
    });
    const page = await context.newPage();

    let success = false;
    try {
      await page.goto(
        `${BASE_URL}/thumbgif-render.html?id=${id}&mode=${mode}`,
        { waitUntil: 'domcontentloaded', timeout: 10_000 }
      );

      // Wait for ORBIT_START (warmup done) then ORBIT_DONE (15 s orbit complete)
      await page.waitForFunction(
        () => document.title === 'ORBIT_START' || document.title === 'ERROR',
        { timeout: PAGE_TIMEOUT }
      );

      if (await page.title() === 'ERROR') throw new Error('model load failed');

      await page.waitForFunction(
        () => document.title === 'ORBIT_DONE',
        { timeout: PAGE_TIMEOUT }
      );

      success = true;
    } catch (e) {
      process.stderr.write(`\n    [page] ${e.message.slice(0, 80)}\n`);
    }

    // Capture the recorded video path before closing
    const video = page.video();
    await page.close();
    await context.close();

    if (!success || !video) {
      fail++;
      failed.push({ id, mode, reason: 'page error' });
      process.stdout.write('FAIL\n');
      continue;
    }

    // Move the webm to our stash dir with a predictable name for ffmpeg
    try {
      const rawPath = await video.path();
      fs.copyFileSync(rawPath, webmStash);

      const gifOk = webmToGif(webmStash, outGif);
      if (gifOk && fs.existsSync(outGif) && fs.statSync(outGif).size > 5_000) {
        const kb = Math.round(fs.statSync(outGif).size / 1024);
        process.stdout.write(`✓ (${kb} KB)\n`);
        ok++;
      } else {
        process.stdout.write('FAIL (ffmpeg)\n');
        fail++;
        failed.push({ id, mode, reason: 'ffmpeg error' });
        if (fs.existsSync(outGif)) fs.unlinkSync(outGif);
      }

      fs.unlinkSync(webmStash);
    } catch (e) {
      process.stdout.write(`FAIL (${e.message.slice(0, 60)})\n`);
      fail++;
      failed.push({ id, mode, reason: e.message });
    }
  }

  await browser.close();

  // Clean up any leftover Playwright webm files in the tmp dir
  try {
    fs.readdirSync(TMP_DIR).forEach(f => {
      if (f.endsWith('.webm')) fs.unlinkSync(path.join(TMP_DIR, f));
    });
  } catch { /* ignore */ }

  console.log(`\nDone — ${ok} GIFs  |  ${fail} failed`);
  if (failed.length) {
    console.log('Failed:');
    failed.forEach(f => console.log(`  ${f.mode}/${f.id} — ${f.reason}`));
  }
  console.log(`Output: ${OUT_DIR}`);
})();
