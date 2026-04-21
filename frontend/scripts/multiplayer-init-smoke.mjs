/**
 * Multiplayer Init Smoketest — diagnoses black screen on realtime.html
 * Creates a 2-player lobby and captures detailed diagnostics from both clients.
 */
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function collectDiagnostics(page, label) {
  return page.evaluate((lbl) => {
    const diag = { label: lbl, errors: [], warnings: [], sceneState: {}, canvasState: {} };

    // Scene diagnostics
    const client = window.client || window.__gloClient;
    if (client) {
      const scene = client.scene;
      const engine = client.engine;
      diag.sceneState = {
        hasEngine: !!engine,
        hasScene: !!scene,
        engineReady: engine ? !engine.isDisposed : false,
        clearColor: scene?.clearColor ? [scene.clearColor.r, scene.clearColor.g, scene.clearColor.b, scene.clearColor.a] : null,
        meshCount: scene?.meshes?.length || 0,
        materialCount: scene?.materials?.length || 0,
        lightCount: scene?.lights?.length || 0,
        cameraExists: !!scene?.activeCamera,
        cameraPosition: scene?.activeCamera?.position ? { x: scene.activeCamera.position.x, y: scene.activeCamera.position.y, z: scene.activeCamera.position.z } : null,
        fogMode: scene?.fogMode,
        environmentTexture: !!scene?.environmentTexture,
        physicsEnabled: !!(scene?.getPhysicsEngine?.()),
        localMeshExists: !!client.localMesh,
        localMeshVisible: client.localMesh?.isVisible ?? null,
        localKartEntity: !!client._localKartEntity,
        localKartEntityVisible: client._localKartEntity?.isVisible?.() ?? null,
        remoteMeshCount: client.remoteMeshes?.size || 0,
        roomConnected: !!client.room,
        roomSessionId: client.room?.sessionId || null,
        started: client.started,
        kartReady: client._kartReady ?? null,
        matchLiveHandled: client._matchLiveHandled ?? null,
        spawnPos: client._spawnPos ? { x: client._spawnPos.x, y: client._spawnPos.y, z: client._spawnPos.z } : null,
      };

      // Check render loop
      diag.sceneState.renderLoopRunning = engine ? engine._activeRenderLoops?.length > 0 : null;

      // WebGL context check
      if (engine) {
        try {
          const gl = engine._gl;
          diag.sceneState.webglContextLost = gl?.isContextLost?.() ?? null;
          diag.sceneState.webglVersion = gl?.getParameter?.(gl.VERSION) ?? null;
        } catch (e) {
          diag.sceneState.webglError = e.message;
        }
      }
    } else {
      diag.sceneState.noClientFound = true;
    }

    // Canvas pixel check
    const canvas = document.getElementById('realtime-canvas');
    if (canvas) {
      diag.canvasState.width = canvas.width;
      diag.canvasState.height = canvas.height;
      diag.canvasState.style_display = canvas.style.display;
      diag.canvasState.visible = canvas.offsetWidth > 0 && canvas.offsetHeight > 0;
      try {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (gl) {
          const pixels = new Uint8Array(4);
          // Sample center pixel
          gl.readPixels(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          diag.canvasState.centerPixel = Array.from(pixels);
          // Sample a few more points
          gl.readPixels(100, 100, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          diag.canvasState.cornerPixel = Array.from(pixels);
        }
      } catch (e) {
        diag.canvasState.pixelReadError = e.message;
      }
    }

    // Body / page transition state
    diag.bodyState = {
      gkPreload: document.documentElement.classList.contains('gk-preload'),
      bodyOpacity: getComputedStyle(document.body).opacity,
      bodyClasses: Array.from(document.body.classList),
    };

    // Loading screen state
    const ls = document.getElementById('loading-screen');
    diag.loadingScreen = {
      exists: !!ls,
      display: ls?.style.display,
      opacity: ls?.style.opacity,
      visible: ls ? (ls.style.display !== 'none' && ls.style.opacity !== '0') : false,
    };

    // Prematch lobby state
    const pm = document.getElementById('prematch-lobby');
    diag.prematchLobby = {
      exists: !!pm,
      visible: pm?.classList.contains('visible') ?? false,
      display: pm?.style.display,
    };

    // Element on top check
    const cx = Math.floor(window.innerWidth / 2);
    const cy = Math.floor(window.innerHeight / 2);
    const topEl = document.elementFromPoint(cx, cy);
    diag.elementOnTop = topEl ? { tag: topEl.tagName, id: topEl.id, class: (topEl.className?.toString?.() || '').slice(0, 80) } : null;

    // Debug hooks
    diag.gloDebug = window.__gloDebug || null;

    return diag;
  }, label);
}

async function run() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const results = { ok: true, diagnostics: [] };

  // Collect console messages from both pages
  const hostConsole = [];
  const guestConsole = [];

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  host.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    hostConsole.push(entry);
  });
  guest.on('console', (msg) => {
    const entry = { type: msg.type(), text: msg.text() };
    guestConsole.push(entry);
  });

  host.on('pageerror', (err) => hostConsole.push({ type: 'pageerror', text: err.message }));
  guest.on('pageerror', (err) => guestConsole.push({ type: 'pageerror', text: err.message }));

  try {
    // Step 1: Open lobbies, select mode
    console.log('[smoke] Step 1: Opening host page...');
    await host.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
    await host.waitForSelector('#mode-cards', { timeout: 30000 });
    // Wait for lobby JS module to fully initialize
    await host.waitForFunction(() => {
      const btn = document.getElementById('play-btn');
      const nameInput = document.getElementById('player-name-input');
      return btn && nameInput && nameInput.placeholder && nameInput.placeholder !== 'Enter Your Nickname...';
    }, { timeout: 15000 });
    await host.fill('#player-name-input', 'SmokeHost');
    await host.evaluate(() => {
      const card = document.querySelector('.mode-card[data-mode-id="battle_online"]');
      if (card) card.click();
    });
    await wait(500);

    console.log('[smoke] Step 1b: Opening guest page...');
    await guest.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
    await guest.waitForSelector('#mode-cards', { timeout: 30000 });
    // Wait for lobby JS module to fully initialize (attaches event listeners)
    await guest.waitForFunction(() => {
      const btn = document.getElementById('join-party-btn');
      // getEventListeners is not available in page context; instead check for
      // a side-effect of RacingLobby constructor (player name placeholder cycling)
      const nameInput = document.getElementById('player-name-input');
      return btn && nameInput && nameInput.placeholder && nameInput.placeholder !== 'Enter Your Nickname...';
    }, { timeout: 15000 });
    await guest.fill('#player-name-input', 'SmokeGuest');
    await wait(300);

    // Step 2: Host creates lobby
    console.log('[smoke] Step 2: Host creating lobby...');
    await host.waitForSelector('#play-btn:not([disabled])', { timeout: 10000 });
    await host.click('#play-btn', { force: true });
    await host.waitForFunction(() => {
      const code = (document.querySelector('#party-code')?.textContent || '').trim();
      const vis = !document.querySelector('#host-info')?.classList.contains('hidden');
      return vis && code && code.length >= 3;
    }, { timeout: 30000 });
    const code = await (await host.locator('#party-code').textContent());
    console.log(`[smoke] Step 2 done: party code = "${code.trim()}"`);

    // Step 3: Guest joins
    console.log('[smoke] Step 3: Guest joining...');
    // Ensure join input is visible
    const joinInputVisible = await guest.evaluate(() => {
      const input = document.getElementById('join-code-input');
      const section = document.querySelector('.join-section');
      return {
        inputExists: !!input,
        sectionExists: !!section,
        sectionHidden: section?.classList.contains('hidden') ?? null,
        inputVisible: input ? (input.offsetWidth > 0 && input.offsetHeight > 0) : false,
      };
    });
    console.log('[smoke] Guest join UI state:', JSON.stringify(joinInputVisible));

    await guest.fill('#join-code-input', code.trim());
    await guest.click('#join-party-btn', { force: true });
    console.log('[smoke] Step 3: Guest clicked join, waiting for player list...');

    await guest.waitForFunction(() => {
      const items = document.querySelectorAll('#player-list li');
      return items.length >= 1;
    }, { timeout: 30000 }).catch(async (e) => {
      // Dump guest console for debugging
      const guestJoinState = await guest.evaluate(() => {
        const input = document.getElementById('join-code-input');
        const status = document.getElementById('join-status');
        return {
          joinInputValue: input?.value || '',
          joinStatusText: status?.textContent || '',
          playerListCount: document.querySelectorAll('#player-list li').length,
        };
      });
      console.log('[smoke] Guest join FAILED state:', JSON.stringify(guestJoinState));
      console.log('[smoke] Guest console entries:', JSON.stringify(
        guestConsole.filter(m => /lobby|join|error|fail|connect/i.test(m.text)).slice(-15)
      ));
      throw e;
    });
    console.log('[smoke] Step 3: Guest sees player list. Waiting for host to see 2 players...');

    await host.waitForFunction(() => {
      const items = document.querySelectorAll('#player-list li');
      return items.length >= 2;
    }, { timeout: 30000 });
    console.log('[smoke] Step 3 done: Both players in lobby');

    // Step 4: Guest readies, host starts
    await guest.waitForSelector('#ready-btn:not(.hidden)', { timeout: 10000 });
    await guest.click('#ready-btn', { force: true });
    await wait(500);
    await host.waitForSelector('#start-match-btn:not(.hidden)', { timeout: 10000 });
    await host.click('#start-match-btn', { force: true });

    // Step 5: Wait for realtime.html
    await Promise.all([
      host.waitForURL(/realtime\.html/, { timeout: 45000 }),
      guest.waitForURL(/realtime\.html/, { timeout: 45000 }),
    ]);

    // Step 6: Wait for match to go live (10s countdown + loading time)
    console.log('[smoke] Step 6: Waiting for match to go live...');
    const startWait = Date.now();
    await host.waitForFunction(() => {
      const c = window.client || window.__gloClient;
      return c?.started === true;
    }, null, { timeout: 120000 }).catch(async (e) => {
      const elapsed = Date.now() - startWait;
      const hostState = await host.evaluate(() => {
        const c = window.client || window.__gloClient;
        return {
          started: c?.started,
          matchLiveHandled: c?._matchLiveHandled,
          roomJoined: !!c?.room,
          sessionId: c?.room?.sessionId,
          roomState_started: c?.room?.state?.started,
          roomState_readyCount: c?.room?.state?.readyCount,
          roomState_countdownActive: c?.room?.state?.countdownActive,
          spawnPos: c?._spawnPos ? { x: c._spawnPos.x, y: c._spawnPos.y, z: c._spawnPos.z } : null,
          gloDebug: window.__gloDebug || null,
        };
      });
      console.log(`[smoke] Host client.started TIMEOUT after ${elapsed}ms:`, JSON.stringify(hostState, null, 2));
      console.log('[smoke] Host console (last 30):', JSON.stringify(
        hostConsole.filter(m => /error|warn|fail|ready|live|start|count|match/i.test(m.text)).slice(-30)
      ));
      throw e;
    });
    console.log('[smoke] Step 6: Host match live!');
    await guest.waitForFunction(() => {
      const c = window.client || window.__gloClient;
      return c?.started === true;
    }, null, { timeout: 120000 }).catch(async (e) => {
      const guestState = await guest.evaluate(() => {
        const c = window.client || window.__gloClient;
        return {
          hasClient: !!c,
          started: c?.started,
          matchLiveHandled: c?._matchLiveHandled,
          roomJoined: !!c?.room,
          sessionId: c?.room?.sessionId,
          roomState_started: c?.room?.state?.started,
          roomState_readyCount: c?.room?.state?.readyCount,
          roomState_countdownActive: c?.room?.state?.countdownActive,
          gloDebug: window.__gloDebug || null,
        };
      });
      console.log('[smoke] Guest client.started TIMEOUT:', JSON.stringify(guestState, null, 2));
      console.log('[smoke] Guest console (last 30):', JSON.stringify(
        guestConsole.filter(m => /error|warn|fail|ready|live|start|count|match|connect|scene|track|arena|load/i.test(m.text)).slice(-30)
      ));
      throw e;
    });
    console.log('[smoke] Step 6: Guest match live!');

    // Step 7: Allow a few render frames, then collect diagnostics
    await wait(3000);

    const hostDiag = await collectDiagnostics(host, 'host');
    const guestDiag = await collectDiagnostics(guest, 'guest');
    results.diagnostics.push(hostDiag, guestDiag);

    // Step 8: Filter relevant console messages
    const relevantPatterns = /error|warn|fail|GL_INVALID|shader|material|load|asset|scene|track|arena|kart|mesh|clearColor|skybox|render|black|visible/i;
    results.hostConsole = hostConsole.filter(m => relevantPatterns.test(m.text)).slice(-60);
    results.guestConsole = guestConsole.filter(m => relevantPatterns.test(m.text)).slice(-60);

    // Determine if black screen
    for (const diag of results.diagnostics) {
      const px = diag.canvasState.centerPixel;
      if (px && px[0] === 0 && px[1] === 0 && px[2] === 0) {
        diag.verdict = 'BLACK_SCREEN';
        results.ok = false;
      } else if (px) {
        diag.verdict = `RENDERED (center pixel: rgba(${px.join(',')}))`;
      } else {
        diag.verdict = 'UNKNOWN (no pixel data)';
        results.ok = false;
      }
    }

  } catch (error) {
    results.ok = false;
    results.error = error.message;
    results.stack = error.stack?.split('\n').slice(0, 5);
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await browser.close();
  }

  console.log('MULTIPLAYER_INIT_SMOKE', JSON.stringify(results, null, 2));
  if (!results.ok) process.exitCode = 1;
}

run().catch((e) => {
  console.error('MULTIPLAYER_INIT_SMOKE', JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
