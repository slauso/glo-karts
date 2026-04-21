/**
 * Black Screen Diagnostic — targeted test to find what's causing black screen
 * after pipeline fix. Runs headed (real GPU) to reproduce the exact user scenario.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const RT_URL = process.env.RT_URL || 'http://localhost:2567';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  // Launch with real GPU (not SwiftShader) to match user experience
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-gl=angle',
      '--use-angle=default',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });
  const results = { phases: {} };
  const consoleLog = [];

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (msg) => consoleLog.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', (err) => consoleLog.push({ type: 'pageerror', text: err.message }));

  try {
    // Load realtime.html with a battle config
    await page.goto(`${BASE_URL}/realtime.html`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((rtUrl) => {
      sessionStorage.setItem('gameConfig', JSON.stringify({
        gameMode: 'battle', battleType: 'deathmatch',
        trackId: 'glo_arena', arenaId: 'glo_arena',
        modeId: 'battle_online', multiplayerProvider: 'colyseus',
        scoreLimit: 5, maxPlayers: 2, selectedKart: 'tux',
        lobbyCode: 'DIAG-TEST',
        players: [{ id: 'diag-host', name: 'DiagTest', isHost: true, playerKart: 'tux', playerColor: 'red' }],
      }));
      sessionStorage.setItem('myPlayerId', 'diag-host');
      sessionStorage.setItem('selectedKart', 'tux');
      sessionStorage.setItem('carColor', 'red');
      sessionStorage.setItem('colyseusEndpoint', rtUrl);
    }, RT_URL);
    await page.reload({ waitUntil: 'domcontentloaded' });
    results.phases.setup = 'ok';

    // Wait for engine init
    await page.waitForFunction(() => {
      const c = window.client || window.__gloClient;
      return c?.engine && c?.scene;
    }, { timeout: 45000 });
    results.phases.engineInit = 'ok';

    // Wait for scene loading
    await wait(12000);

    // Comprehensive diagnostics
    const diag = await page.evaluate(() => {
      const d = {};
      const client = window.client || window.__gloClient;
      if (!client) { d.error = 'no client'; return d; }

      const scene = client.scene;
      const engine = client.engine;
      const cam = scene?.activeCamera;

      // Engine state
      d.engineDisposed = engine?.isDisposed ?? null;
      d.renderLoopCount = engine?._activeRenderLoops?.length ?? 0;
      d.fps = engine?.getFps?.()?.toFixed(1) ?? null;

      // Scene basics
      d.meshCount = scene?.meshes?.length || 0;
      d.lightCount = scene?.lights?.length || 0;
      d.clearColor = scene?.clearColor
        ? [+scene.clearColor.r.toFixed(3), +scene.clearColor.g.toFixed(3), +scene.clearColor.b.toFixed(3), +scene.clearColor.a.toFixed(3)]
        : null;
      d.fogMode = scene?.fogMode;
      d.ambientColor = scene?.ambientColor
        ? [+scene.ambientColor.r.toFixed(3), +scene.ambientColor.g.toFixed(3), +scene.ambientColor.b.toFixed(3)]
        : null;

      // Camera inspection
      d.cameraType = cam?.getClassName?.() ?? null;
      d.cameraPosition = cam?.position
        ? { x: +cam.position.x.toFixed(2), y: +cam.position.y.toFixed(2), z: +cam.position.z.toFixed(2) }
        : null;
      d.cameraTarget = cam?.target
        ? { x: +cam.target.x.toFixed(2), y: +cam.target.y.toFixed(2), z: +cam.target.z.toFixed(2) }
        : null;
      d.cameraFOV = cam?.fov?.toFixed(3) ?? null;
      d.cameraMinZ = cam?.minZ ?? null;
      d.cameraMaxZ = cam?.maxZ ?? null;
      d.cameraRadius = cam?.radius ?? null;

      // Post-processing pipeline inspection
      d.postProcesses = [];
      if (cam?._postProcesses) {
        for (const pp of cam._postProcesses) {
          if (!pp) continue;
          d.postProcesses.push({
            name: pp.name || pp._name || 'unnamed',
            isReady: pp.isReady?.() ?? null,
            width: pp.width,
            height: pp.height,
            enabled: pp.isEnabled ?? null,
          });
        }
      }

      // Rendering pipeline manager
      const rpm = scene?.postProcessRenderPipelineManager;
      d.pipelines = [];
      if (rpm) {
        const supported = rpm.supportedPipelines || [];
        for (const p of supported) {
          const info = {
            name: p.name || p._name || 'unnamed',
            isSupported: p.isSupported ?? null,
            cameras: p.cameras?.length ?? null,
          };
          // Check if pipeline has render effects
          if (p._renderEffects) {
            info.renderEffects = Object.keys(p._renderEffects).length;
          }
          // Check DefaultRenderingPipeline specifics
          if (p.imageProcessing) {
            info.imageProcessingEnabled = p.imageProcessingEnabled;
            info.bloomEnabled = p.bloomEnabled;
            info.vignetteEnabled = p.vignetteEnabled;
            info.vignetteWeight = p.imageProcessing?.vignetteWeight;
            info.grainEnabled = p.grainEnabled;
            info.chromaticAberrationEnabled = p.chromaticAberrationEnabled;
          }
          d.pipelines.push(info);
        }
      }

      // Check for GlowLayer
      d.effectLayers = [];
      if (scene?.effectLayers) {
        for (const el of scene.effectLayers) {
          d.effectLayers.push({
            name: el.name || el.constructor?.name || 'unknown',
            isEnabled: el.isEnabled ?? null,
            intensity: el.intensity ?? null,
          });
        }
      }

      // Canvas/WebGL state
      const canvas = document.getElementById('realtime-canvas');
      d.canvasSize = canvas ? { w: canvas.width, h: canvas.height } : null;
      d.canvasClientSize = canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null;
      d.canvasDisplay = canvas?.style.display ?? null;
      d.canvasZIndex = canvas ? window.getComputedStyle(canvas).zIndex : null;

      // Check what's on top of the canvas
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const topEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        d.elementOnTop = topEl ? { tag: topEl.tagName, id: topEl.id, class: topEl.className?.substring?.(0, 80) } : null;
      }

      // Loading screen / overlay state
      const ls = document.getElementById('loading-screen');
      d.loadingScreen = ls ? {
        display: ls.style.display,
        opacity: ls.style.opacity,
        zIndex: window.getComputedStyle(ls).zIndex,
        visible: ls.offsetWidth > 0 && ls.offsetHeight > 0 && ls.style.display !== 'none',
      } : null;

      const pm = document.getElementById('prematch-lobby');
      d.prematchLobby = pm ? {
        visible: pm.classList.contains('visible'),
        display: pm.style.display,
        zIndex: window.getComputedStyle(pm).zIndex,
      } : null;

      const co = document.getElementById('countdown-overlay');
      d.countdownOverlay = co ? {
        display: co.style.display,
        visible: co.offsetWidth > 0 && co.offsetHeight > 0,
        zIndex: window.getComputedStyle(co).zIndex,
      } : null;

      // Sample pixels from the canvas via WebGL
      try {
        const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
        if (gl) {
          d.webglContextLost = gl.isContextLost();
          d.webglRenderer = gl.getParameter(gl.RENDERER);
          d.webglVendor = gl.getParameter(gl.VENDOR);
          d.webglVersion = gl.getParameter(gl.VERSION);
          d.webglErrors = [];
          let err;
          while ((err = gl.getError()) !== gl.NO_ERROR) {
            d.webglErrors.push(err);
          }

          const pixels = new Uint8Array(4);
          // Center pixel
          gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          d.centerPixel = Array.from(pixels);
          // Multiple sample points
          d.samplePixels = {};
          const points = {
            topLeft: [50, canvas.height - 50],
            topRight: [canvas.width - 50, canvas.height - 50],
            bottomLeft: [50, 50],
            bottomRight: [canvas.width - 50, 50],
            mid1: [canvas.width * 0.25, canvas.height * 0.5],
            mid2: [canvas.width * 0.75, canvas.height * 0.5],
          };
          for (const [name, [x, y]] of Object.entries(points)) {
            gl.readPixels(Math.floor(x), Math.floor(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            d.samplePixels[name] = Array.from(pixels);
          }
        }
      } catch (e) {
        d.pixelError = e.message;
      }

      // Check kart state
      d.localMesh = client.localMesh ? {
        position: { x: +client.localMesh.position.x.toFixed(2), y: +client.localMesh.position.y.toFixed(2), z: +client.localMesh.position.z.toFixed(2) },
        isVisible: client.localMesh.isVisible,
        isEnabled: client.localMesh.isEnabled(),
        scaling: { x: +client.localMesh.scaling.x.toFixed(3), y: +client.localMesh.scaling.y.toFixed(3), z: +client.localMesh.scaling.z.toFixed(3) },
      } : null;

      d.gloDebug = window.__gloDebug ? {
        matchLive: window.__gloDebug.matchLive,
        kartLoaded: window.__gloDebug.kartLoaded,
        kartVisible: window.__gloDebug.kartVisible,
        trackPhysicsCount: window.__gloDebug.trackPhysicsCount,
        requestedArenaId: window.__gloDebug.requestedArenaId,
        customArenaBuilt: window.__gloDebug.customArenaBuilt,
      } : null;

      return d;
    });

    results.diagnostics = diag;

    // Categorize console errors
    results.errors = consoleLog.filter(m => m.type === 'error' || m.type === 'pageerror').slice(-20);
    results.pipelineMessages = consoleLog.filter(m =>
      /pipeline|vignette|GL_INVALID|shader|render|post.?process|glow|bloom|grain|chroma/i.test(m.text)
    ).slice(-15);
    results.arenaMessages = consoleLog.filter(m =>
      /arena|track|glb|model|load.*scene|DEBUG ARENA/i.test(m.text)
    ).slice(-10);
    results.renderMessages = consoleLog.filter(m =>
      /render|frame|fps|clear|camera|visible|display/i.test(m.text)
    ).slice(-10);

  } catch (error) {
    results.error = error.message;
    results.stack = error.stack?.split('\n').slice(0, 5);
  } finally {
    await ctx.close();
    await browser.close();
  }

  console.log('BLACK_SCREEN_DIAG', JSON.stringify(results, null, 2));
}

run().catch((e) => {
  console.error('BLACK_SCREEN_DIAG FATAL:', e.message);
  process.exit(1);
});
