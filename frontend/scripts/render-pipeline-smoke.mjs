/**
 * Render Pipeline Smoke Test — verifies the weapon-fx-enhance pipeline
 * and arena GLB loading work correctly after patches.
 * Bypasses lobby flow — injects gameConfig directly into sessionStorage.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const RT_URL = process.env.RT_URL || 'http://localhost:2567';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const results = { ok: true, phases: {} };
  const consoleLog = [];
  const pageErrors = [];

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', (msg) => consoleLog.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    // Phase 1: Set up sessionStorage with a battle config
    await page.goto(`${BASE_URL}/realtime.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((rtUrl) => {
      const gameConfig = {
        gameMode: 'battle',
        battleType: 'deathmatch',
        trackId: 'glo_arena',
        arenaId: 'glo_arena',
        modeId: 'battle_online',
        multiplayerProvider: 'colyseus',
        scoreLimit: 5,
        maxPlayers: 2,
        selectedKart: 'tux',
        lobbyCode: 'SMOKE-TEST',
        players: [
          { id: 'smoke-host', name: 'RenderTest', isHost: true, playerKart: 'tux', playerColor: 'red' },
        ],
      };
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      sessionStorage.setItem('myPlayerId', 'smoke-host');
      sessionStorage.setItem('selectedKart', 'tux');
      sessionStorage.setItem('carColor', 'red');
      // Save the colyseus endpoint
      sessionStorage.setItem('colyseusEndpoint', rtUrl);
    }, RT_URL);
    results.phases.sessionSetup = 'ok';

    // Phase 2: Reload to pick up the sessionStorage config
    await page.reload({ waitUntil: 'domcontentloaded' });
    results.phases.reload = 'ok';

    // Phase 3: Wait for Babylon engine to initialize (canvas should render)
    await page.waitForFunction(() => {
      const c = window.client || window.__gloClient;
      return c?.engine && c?.scene;
    }, { timeout: 30000 });
    results.phases.engineInit = 'ok';

    // Phase 4: Wait for scene to be loaded (even if match doesn't start, scene assets should load)
    await wait(8000); // Allow time for GLB loading

    // Phase 5: Collect rendering diagnostics
    const diag = await page.evaluate(() => {
      const d = {};
      const client = window.client || window.__gloClient;
      if (!client) { d.error = 'no client'; return d; }

      const scene = client.scene;
      const engine = client.engine;

      d.hasEngine = !!engine;
      d.hasScene = !!scene;
      d.engineDisposed = engine?.isDisposed ?? null;
      d.meshCount = scene?.meshes?.length || 0;
      d.materialCount = scene?.materials?.length || 0;
      d.lightCount = scene?.lights?.length || 0;
      d.cameraExists = !!scene?.activeCamera;
      d.clearColor = scene?.clearColor
        ? [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b, scene.clearColor.a].map(v => +v.toFixed(3))
        : null;
      d.fogEnabled = scene?.fogMode > 0;
      d.physicsEnabled = !!(scene?.getPhysicsEngine?.());
      d.renderLoopRunning = engine?._activeRenderLoops?.length > 0;

      // Check WebGL context
      try {
        const gl = engine?._gl;
        d.webglContextLost = gl?.isContextLost?.() ?? null;
        d.webglVersion = gl?.getParameter?.(gl.VERSION) ?? null;
      } catch (e) {
        d.webglError = e.message;
      }

      // Check if weapon-fx pipeline exists and is healthy
      try {
        const wfx = window.__weaponFXState;
        d.weaponFXState = wfx || null;
      } catch (_) {}

      // Check rendering pipeline on camera
      try {
        const cam = scene?.activeCamera;
        if (cam) {
          const pipelines = scene?.postProcessRenderPipelineManager?.supportedPipelines || [];
          d.pipelineCount = pipelines.length;
          d.pipelineNames = pipelines.map(p => p.name || p._name || 'unnamed');
          d.postProcessCount = cam?._postProcesses?.length || 0;
        }
      } catch (_) {}

      // Sample center pixel from canvas
      try {
        const canvas = document.getElementById('realtime-canvas');
        if (canvas) {
          d.canvasWidth = canvas.width;
          d.canvasHeight = canvas.height;
          const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
          if (gl) {
            const pixels = new Uint8Array(4);
            gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            d.centerPixel = Array.from(pixels);
            gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            d.cornerPixel = Array.from(pixels);
          }
        }
      } catch (e) {
        d.pixelError = e.message;
      }

      // Check debug hooks
      d.gloDebug = window.__gloDebug || null;

      // Check for arena meshes
      d.meshNames = (scene?.meshes || [])
        .filter(m => m.name && !m.name.startsWith('__'))
        .map(m => m.name)
        .slice(0, 40);

      return d;
    });

    results.phases.diagnostics = 'ok';
    results.diagnostics = diag;

    // Phase 6: Check for pipeline errors
    const pipelineErrors = consoleLog.filter(m =>
      /pipeline.*fail|vignette|GL_INVALID|shader.*error/i.test(m.text)
    );
    results.pipelineErrors = pipelineErrors;

    // Phase 7: Check for arena loading
    const arenaLogs = consoleLog.filter(m =>
      /arena|track|glb|GLB|DEBUG ARENA|Loading track/i.test(m.text)
    );
    results.arenaLogs = arenaLogs.slice(-20);

    // Phase 8: Determine status
    const hasPipelineError = pipelineErrors.some(m => /fail|error/i.test(m.text));
    const hasDebugArena = arenaLogs.some(m => /DEBUG ARENA mode/i.test(m.text));
    const isBlackScreen = diag.centerPixel && diag.centerPixel[0] === 0 && diag.centerPixel[1] === 0 && diag.centerPixel[2] === 0;

    results.verdicts = {
      pipelineHealthy: !hasPipelineError,
      arenaGLBLoaded: !hasDebugArena,
      rendering: !isBlackScreen,
      meshesPresent: diag.meshCount > 5,
      engineRunning: diag.renderLoopRunning,
    };

    if (hasPipelineError || isBlackScreen) {
      results.ok = false;
    }

  } catch (error) {
    results.ok = false;
    results.error = error.message;
    results.stack = error.stack?.split('\n').slice(0, 5);
  } finally {
    results.pageErrors = pageErrors;
    results.consoleErrors = consoleLog.filter(m => m.type === 'error' || m.type === 'pageerror').slice(-20);
    results.consoleWarnings = consoleLog.filter(m => m.type === 'warning').slice(-20);
    await ctx.close();
    await browser.close();
  }

  console.log('RENDER_PIPELINE_SMOKE', JSON.stringify(results, null, 2));
  if (!results.ok) process.exitCode = 1;
}

run().catch((e) => {
  console.error('RENDER_PIPELINE_SMOKE', JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
