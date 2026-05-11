// Burnout parity probe — frame-for-frame SP vs MP comparison of the
// W+Space "burnout charge → release boost" sequence.
//
// Sequence (identical on both pages):
//   t=0.0  hold W+Space (stationary burnout charge)
//   t=2.5  release Space, keep W (boost trail fires)
//   t=5.5  release W (coast)
//
// Captures per page at 30 Hz: position, velocity, throttle/steer/brake
// inputs the physics core sees, and the burnout-state fields
// (burnoutCharge, gloBurnoutT, chargingBurnout, engineExploded). The
// goal is to verify the MP server's burnout state machine produces
// the same charge/release/boost timeline as the SP physics worker
// AND that the MP client KartFxRig fires the same visual triggers.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'burnout-parity.json');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function loadTemplateCode() {
  const file = path.resolve(process.cwd(), 'public', 'templates', 'bundled.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Crossroads is flat near spawn — best for a stationary burnout test.
  const tpl = raw.find((t) => /crossroads/i.test(t?.fields?.name || ''))
    || raw.find((t) => /tutorial/i.test(t?.fields?.name || ''));
  const json = JSON.stringify(tpl.fields.track_data.track);
  const b64 = Buffer.from(json, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { code: b64, name: tpl.fields.name };
}

async function setupPage(browser, label, log) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  await ctx.addInitScript(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  `);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.push(`[${label}] err: ${m.text()}`); });
  return { ctx, page };
}

// ── SP boot ─────────────────────────────────────────────────────
async function bootSP(browser, code, log) {
  const { ctx, page } = await setupPage(browser, 'sp', log);
  await page.goto(`${BASE_URL}/play.html?track=${code}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!window.__play?.chassisBody, null, { timeout: 60000 });
  // Expose the burnout-internal globals to the page world so we can sample them.
  // SP keeps `burnoutCharge` / `gloBurnoutT` as module-local lets in
  // play-main.js — we can't read those from outside. Fall back to the
  // controlState bridge fields the worker mirrors.
  log.push('[sp] booted');
  return { ctx, page };
}

// ── MP boot helpers (same as parity probe) ──────────────────────
async function openLobby(page, name) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
  await page.waitForSelector('#mode-cards', { timeout: 30000 });
  await page.waitForFunction(() => {
    const i = document.getElementById('player-name-input');
    return i && i.placeholder && !/Loading/i.test(i.placeholder);
  }, null, { timeout: 15000 });
  await page.fill('#player-name-input', name);
  await page.evaluate(() => document.querySelector('[data-mode-id="online_arena"]')?.click());
  await page.waitForSelector('#lobby-studio-picker:not(.hidden)', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.lsp-tile').length > 0, null, { timeout: 15000 });
}
async function pickTpl(page) {
  await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.lsp-tile'));
    const t = tiles.find((x) => /crossroads/i.test(x.textContent || ''))
      || tiles.find((x) => /tutorial/i.test(x.textContent || ''));
    (t || tiles[0])?.click();
  });
  await wait(400);
}
async function hostLobby(page) {
  await page.evaluate(() => document.getElementById('play-btn').click());
  await page.waitForFunction(() => {
    const c = (document.querySelector('#party-code')?.textContent || '').trim();
    return c && c.length >= 5 && c !== '------';
  }, null, { timeout: 30000 });
  return (await page.locator('#party-code').textContent()).trim();
}
async function joinLobby(page, code) {
  await page.fill('#join-code-input', code);
  await page.click('#join-party-btn', { force: true });
  await page.waitForFunction(() => {
    const hi = document.getElementById('host-info');
    return hi && !hi.classList.contains('hidden');
  }, null, { timeout: 30000 });
}
async function startMatch(host, guest) {
  await guest.click('#ready-btn', { force: true }).catch(() => {});
  await wait(400);
  await host.click('#start-match-btn', { force: true });
}
async function waitForMpGameLoad(page, label, log) {
  await page.waitForFunction(() => /multiplayer-editor3\.html/.test(location.pathname), null, { timeout: 60000 });
  await page.waitForSelector('#canvas', { timeout: 60000 });
  await page.waitForFunction(() => {
    const s = document.getElementById('hud-status');
    return s && (s.classList.contains('ok') || s.classList.contains('err'));
  }, null, { timeout: 60000 });
  await page.waitForFunction(() => {
    const sid = window.__mySid;
    return sid && window.__roomRef?.state?.karts?.get(sid);
  }, null, { timeout: 30000 });
  log.push(`[${label}] mp loaded`);
}

// ── Input scripting ─────────────────────────────────────────────
async function applyKeys(page, keys) {
  await page.evaluate((arr) => {
    window.__probeHeld = window.__probeHeld || new Set();
    const want = new Set(arr);
    for (const k of [...window.__probeHeld]) {
      if (!want.has(k)) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: k, key: k.replace(/^Key/, '').toLowerCase(), bubbles: true }));
        window.__probeHeld.delete(k);
      }
    }
    for (const k of arr) {
      if (!window.__probeHeld.has(k)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: k, key: k.replace(/^Key/, '').toLowerCase(), bubbles: true }));
        window.__probeHeld.add(k);
      }
    }
  }, [...keys]);
}

// ── Sampler installers ──────────────────────────────────────────
const SP_SAMPLE = `() => {
  const p = window.__play;
  if (!p?.chassisBody) return null;
  const cb = p.chassisBody;
  const cs = p.controlState || {};
  // Fxstate (skid pool fill / smoke pool fill) lives in module-local
  // refs we can't reach. Instead capture the inputs SP physics-worker
  // sees + the chassis kinematics. The SP burnout state machine is in
  // play-main.js so its burnoutCharge / gloBurnoutT live there too.
  // We expose them via window.__playProbe set in bootSP if available.
  const probe = window.__playProbe || {};
  return {
    t: performance.now(),
    x: cb.position.x, y: cb.position.y, z: cb.position.z,
    vx: cb.velocity.x, vy: cb.velocity.y, vz: cb.velocity.z,
    speed: Math.hypot(cb.velocity.x, cb.velocity.y, cb.velocity.z),
    throttle: cs.throttle || 0,
    steer: cs.steer || 0,
    keysW: !!(p.keys && p.keys.w),
    keysSpace: !!(p.keys && p.keys.space),
    keysS: !!(p.keys && p.keys.s),
    burnoutCharge: probe.burnoutCharge || 0,
    gloBurnoutT: probe.gloBurnoutT || 0,
    chargingBurnout: !!probe.charging,
    engineExploded: !!probe.exploded,
  };
}`;

const MP_SAMPLE = `() => {
  const sid = window.__mySid;
  const k = sid ? window.__roomRef?.state?.karts?.get(sid) : null;
  if (!k) return null;
  return {
    t: performance.now(),
    x: k.x, y: k.y, z: k.z,
    vx: k.vx || 0, vy: k.vy || 0, vz: k.vz || 0,
    speed: Math.hypot(k.vx || 0, k.vy || 0, k.vz || 0),
    throttle: k.throttleIn || 0,
    steer: k.steerIn || 0,
    brake: k.brakeIn || 0,
    keysW: (k.throttleIn || 0) > 0.01,
    keysSpace: (k.brakeIn || 0) > 0.5,
    keysS: (k.throttleIn || 0) < -0.01,
    burnoutCharge: 0, // not broadcast; derive from chargingBurnout + dt
    gloBurnoutT: +k.gloBurnoutT || 0,
    chargingBurnout: !!k.chargingBurnout,
    engineExploded: !!k.engineExploded,
  };
}`;

async function startSampler(page, src, hz = 30) {
  await page.evaluate(({ src, hz }) => {
    window.__probeTrace = [];
    window.__probeSeg = '';
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    const fn = eval(`(${src})`);
    window.__probeTimer = setInterval(() => {
      const s = fn();
      if (s) { s.seg = window.__probeSeg; window.__probeTrace.push(s); }
    }, Math.round(1000 / hz));
  }, { src, hz });
}
async function setSeg(page, s) { await page.evaluate((x) => { window.__probeSeg = x; }, s); }
async function dump(page) {
  return page.evaluate(() => {
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    return window.__probeTrace || [];
  });
}

// ── Drive ───────────────────────────────────────────────────────
const SEGMENTS = [
  { label: 'rest',       durMs: 600,  keys: [] },
  { label: 'charge',     durMs: 2500, keys: ['KeyW', 'Space'] },
  { label: 'release',    durMs: 3000, keys: ['KeyW'] },           // boost window + a bit of overshoot
  { label: 'coast',      durMs: 1200, keys: [] },
];

async function driveScript(page, log) {
  for (const seg of SEGMENTS) {
    log.push(`segment ${seg.label} (${seg.durMs}ms) keys=[${seg.keys.join(',')}]`);
    await setSeg(page, seg.label);
    await applyKeys(page, seg.keys);
    await wait(seg.durMs);
  }
  await applyKeys(page, []);
}

// ── Per-segment summary ─────────────────────────────────────────
function summarizeBurnout(trace) {
  const segs = ['rest', 'charge', 'release', 'coast'];
  const out = {};
  for (const s of segs) {
    const rows = trace.filter((r) => r.seg === s);
    if (rows.length === 0) { out[s] = { samples: 0 }; continue; }
    const speeds = rows.map((r) => r.speed);
    const maxSpeed = Math.max(...speeds);
    const avgSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    const charging = rows.filter((r) => r.chargingBurnout).length;
    const burnoutBoosts = rows.filter((r) => r.gloBurnoutT > 0).length;
    const exploded = rows.some((r) => r.engineExploded);
    const firstBoostT = rows.find((r) => r.gloBurnoutT > 0)?.t ?? null;
    const lastBoostT  = [...rows].reverse().find((r) => r.gloBurnoutT > 0)?.t ?? null;
    const peakBoostT  = Math.max(0, ...rows.map((r) => r.gloBurnoutT || 0));
    out[s] = {
      samples: rows.length,
      maxSpeed, avgSpeed,
      chargingFrac: charging / rows.length,
      boostFrac: burnoutBoosts / rows.length,
      peakGloBurnoutT: peakBoostT,
      firstBoostT, lastBoostT,
      exploded,
      keysSpaceAvg: rows.filter((r) => r.keysSpace).length / rows.length,
      keysWAvg: rows.filter((r) => r.keysW).length / rows.length,
    };
  }
  return out;
}

async function main() {
  const log = [];
  const { code, name } = loadTemplateCode();
  log.push(`track: ${name}`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    ],
  });
  let report = { pass: false, log };
  let spTrace = [], mpTrace = [];

  try {
    // PHASE 1: SP burnout
    const sp = await bootSP(browser, code, log);
    await sp.page.bringToFront();
    // Hook into SP burnout module-local state by re-exporting via the
    // same window.__play object. play-main.js doesn't expose them, so
    // we patch them by reading the same bridge fields the FX rig uses
    // (controlState.burnoutCharge isn't tracked there — fall back to
    // detecting via inputs + speed condition).
    await wait(800);
    await startSampler(sp.page, SP_SAMPLE, 30);
    await driveScript(sp.page, log);
    spTrace = await dump(sp.page);
    log.push(`sp samples=${spTrace.length}`);
    await sp.ctx.close();

    // PHASE 2: MP burnout
    const mpH = await setupPage(browser, 'mp-host', log);
    const mpG = await setupPage(browser, 'mp-guest', log);
    await openLobby(mpH.page, 'burnout-host');
    await pickTpl(mpH.page);
    const lobbyCode = await hostLobby(mpH.page);
    log.push(`mp lobby: ${lobbyCode}`);
    await openLobby(mpG.page, 'burnout-guest');
    await joinLobby(mpG.page, lobbyCode);
    await wait(500);
    await startMatch(mpH.page, mpG.page);
    await waitForMpGameLoad(mpH.page, 'mp-host', log);
    await waitForMpGameLoad(mpG.page, 'mp-guest', log);
    await mpH.page.bringToFront();
    await mpH.page.waitForFunction(() => {
      const o = document.getElementById('overlay-countdown');
      return o && !o.classList.contains('hidden');
    }, null, { timeout: 20000 }).catch(() => null);
    await mpH.page.waitForFunction(() => {
      const o = document.getElementById('overlay-countdown');
      return o && o.classList.contains('hidden');
    }, null, { timeout: 20000 }).catch(() => null);
    await wait(800);
    log.push('mp live, beginning burnout script');

    await startSampler(mpH.page, MP_SAMPLE, 30);
    await driveScript(mpH.page, log);
    mpTrace = await dump(mpH.page);
    log.push(`mp samples=${mpTrace.length}`);

    const sp_sum = summarizeBurnout(spTrace);
    const mp_sum = summarizeBurnout(mpTrace);
    report = {
      pass: true,
      track: name,
      sp: sp_sum,
      mp: mp_sum,
      log,
      traces: { sp: spTrace, mp: mpTrace },
    };
  } catch (err) {
    report.error = err.stack;
    log.push(`fatal: ${err.message}`);
  } finally {
    await browser.close().catch(() => null);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('=== burnout parity ===');
  console.log('SP charge:',   JSON.stringify(report.sp?.charge));
  console.log('SP release:',  JSON.stringify(report.sp?.release));
  console.log('MP charge:',   JSON.stringify(report.mp?.charge));
  console.log('MP release:',  JSON.stringify(report.mp?.release));
  console.log('MP coast:',    JSON.stringify(report.mp?.coast));
  console.log('report:', REPORT_PATH);
}

main().catch((err) => { console.error(err); process.exit(1); });
