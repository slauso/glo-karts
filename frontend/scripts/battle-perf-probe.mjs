import { chromium } from 'playwright';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readMetrics(page, label) {
  return page.evaluate((pageLabel) => {
    const client = window.__gloClient || window.client;
    const scene = client?.scene;
    const engine = client?.engine;
    const pipelineManager = scene?.postProcessRenderPipelineManager;
    const supportedPipelines = pipelineManager?.supportedPipelines || [];
    const clustered = Array.isArray(scene?.lights)
      ? scene.lights.filter((light) => /cluster/i.test(light?.name || light?.id || '')).length
      : 0;

    const particleNameCounts = new Map();
    for (const ps of scene?.particleSystems || []) {
      const key = ps?.name || 'unnamed';
      particleNameCounts.set(key, (particleNameCounts.get(key) || 0) + 1);
    }

    return {
      label: pageLabel,
      fps: Number((engine?.getFps?.() || 0).toFixed(1)),
      drawCalls: Number(engine?._drawCalls?.current || 0),
      activeMeshes: Number(scene?.getActiveMeshes?.().length || 0),
      totalMeshes: Number(scene?.meshes?.length || 0),
      particleSystems: Number(scene?.particleSystems?.length || 0),
      activeParticles: Number(scene?.particleSystems?.reduce((sum, ps) => sum + (ps.getActiveCount?.() || 0), 0) || 0),
      particleSystemNames: Array.from(particleNameCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20),
      effectLayers: Number(scene?.effectLayers?.length || 0),
      lights: Number(scene?.lights?.length || 0),
      clusteredLights: clustered,
      pipelines: supportedPipelines.map((pipeline) => ({
        name: pipeline?.name || pipeline?._name || 'unnamed',
        bloomEnabled: pipeline?.bloomEnabled ?? null,
        imageProcessingEnabled: pipeline?.imageProcessingEnabled ?? null,
        grainEnabled: pipeline?.grainEnabled ?? null,
        vignetteEnabled: pipeline?.vignetteEnabled ?? null,
        chromaticAberrationEnabled: pipeline?.chromaticAberrationEnabled ?? null,
      })),
      perfBudget: window.__gloDebug?.performanceBudget || null,
      tier: window.__gloDebug?.performanceBudget?.tier ?? null,
    };
  }, label);
}

async function joinBattle(host, guest) {
  await host.goto('http://localhost:5173/index.html', { waitUntil: 'load' });
  await host.waitForSelector('#mode-cards', { timeout: 30000 });
  await host.waitForFunction(() => {
    const play = document.getElementById('play-btn');
    const input = document.getElementById('player-name-input');
    return play && input && input.placeholder && input.placeholder !== 'Enter Your Nickname...';
  }, null, { timeout: 15000 });
  await host.fill('#player-name-input', 'PerfHost');
  await host.evaluate(() => {
    document.querySelector('.mode-card[data-mode-id="battle_online"]')?.click();
  });
  await wait(500);

  await guest.goto('http://localhost:5173/index.html', { waitUntil: 'load' });
  await guest.waitForSelector('#mode-cards', { timeout: 30000 });
  await guest.waitForFunction(() => {
    const join = document.getElementById('join-party-btn');
    const input = document.getElementById('player-name-input');
    return join && input && input.placeholder && input.placeholder !== 'Enter Your Nickname...';
  }, null, { timeout: 15000 });
  await guest.fill('#player-name-input', 'PerfGuest');
  await wait(300);

  await host.click('#play-btn', { force: true });
  await host.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    return code && code.length >= 3;
  }, null, { timeout: 30000 });
  const code = (await host.locator('#party-code').textContent()).trim();

  await guest.fill('#join-code-input', code);
  await guest.click('#join-party-btn', { force: true });
  await guest.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 1, null, { timeout: 30000 });
  await host.waitForFunction(() => document.querySelectorAll('#player-list li').length >= 2, null, { timeout: 30000 });

  await guest.click('#ready-btn', { force: true });
  await wait(500);
  await host.click('#start-match-btn', { force: true });

  await Promise.all([
    host.waitForURL(/realtime\.html/, { timeout: 45000 }),
    guest.waitForURL(/realtime\.html/, { timeout: 45000 }),
  ]);

  await host.waitForFunction(() => (window.__gloClient || window.client)?.started === true, null, { timeout: 120000 });
  await guest.waitForFunction(() => (window.__gloClient || window.client)?.started === true, null, { timeout: 120000 });
}

async function run() {
  const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle'] });
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await joinBattle(host, guest);
    await wait(5000);
    const earlyHost = await readMetrics(host, 'host-early');
    const earlyGuest = await readMetrics(guest, 'guest-early');
    await wait(12000);
    const lateHost = await readMetrics(host, 'host-late');
    const lateGuest = await readMetrics(guest, 'guest-late');

    console.log('BATTLE_PERF_PROBE', JSON.stringify({
      earlyHost,
      earlyGuest,
      lateHost,
      lateGuest,
    }, null, 2));
  } finally {
    await hostCtx.close();
    await guestCtx.close();
    await browser.close();
  }
}

run().catch((error) => {
  console.error('BATTLE_PERF_PROBE_ERROR', error.message);
  process.exit(1);
});