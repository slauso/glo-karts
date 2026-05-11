// SP vs MP parity probe.
//
// Boots three Chromium pages on the SAME track (Tutorial Loop = the
// closest bundled template to an "oval"):
//   page[0] = single-player playtest (/play.html) — direct cannon-es
//   page[1] = MP host  (/multiplayer-editor3.html)  — server-authoritative
//   page[2] = MP guest (/multiplayer-editor3.html)  — server-authoritative
// Drives an identical scripted input sequence on every page (rest →
// full forward → coast → full left + forward → brake → reverse) and
// samples chassis state at 50 ms intervals throughout. Aggregates per
// segment (max speed, time-to-50%-speed, sustained-turn yaw rate,
// stopping distance) and computes the SP↔MP delta for each metric.
// A delta beyond the SOFT budgets flips `pass = false`.
//
// Run: node frontend/scripts/sp-vs-mp-parity-probe.mjs
// Env: BASE_URL (default http://localhost:5174)
//      HEADLESS=true|false

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const HEADLESS = String(process.env.HEADLESS ?? 'true').toLowerCase() === 'true';
const REPORT_PATH = path.resolve(process.cwd(), 'reports', 'sp-vs-mp-parity.json');

// Soft budgets on SP↔MP delta. Treat as "this much divergence is
// acceptable feel-wise"; tighter delta = more identical handling.
const BUDGETS = {
  topSpeedRelDelta: 0.25,        // ±25 % top speed (mp can lag SP slightly via interp)
  timeToHalfSpeedDeltaS: 0.6,    // 600 ms grace
  yawRateRelDelta: 0.40,         // ±40 % sustained-turn yaw rate
  stoppingDistRelDelta: 0.40,    // ±40 % stopping distance
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Track loader ─────────────────────────────────────────────────
// Pulls the bundled "Tutorial Loop" template, encodes it the same
// way the editor's `encodeTrack()` does (UTF-8 → base64-url), and
// returns the encoded string suitable for `?track=<code>` or
// sessionStorage `gloKartsStudio.playtest`.
function loadOvalTemplateCode() {
  const file = path.resolve(process.cwd(), 'public', 'templates', 'bundled.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Crossroads Circuit is flat (no ramps/jumps), so brake/reverse
  // measurements aren't poisoned by airborne segments. Sprint Drag
  // had a ramp_up→plateau→ramp_down that launched the kart.
  const tpl = raw.find((t) => /crossroads/i.test(t?.fields?.name || ''))
    || raw.find((t) => /sprint\s*drag/i.test(t?.fields?.name || ''))
    || raw.find((t) => /tutorial/i.test(t?.fields?.name || ''));
  if (!tpl) throw new Error('No suitable template found in bundled.json');
  const trackJson = tpl.fields.track_data?.track;
  if (!trackJson) throw new Error('Template has no track_data.track');
  const json = JSON.stringify(trackJson);
  const b64 = Buffer.from(json, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { code: b64, name: tpl.fields.name };
}

// ── Page setup ──────────────────────────────────────────────────
async function setupPage(browser, label, log) {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 } });
  await ctx.addInitScript(`
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  `);
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') log.push(`[${label}] err: ${msg.text()}`);
  });
  return { ctx, page };
}

// ── SP boot ─────────────────────────────────────────────────────
async function bootSP(browser, code, log) {
  const { ctx, page } = await setupPage(browser, 'sp', log);
  await page.goto(`${BASE_URL}/play.html?track=${code}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForSelector('#canvas', { timeout: 30000 });
  // Wait for play-main to publish the global; that means physics + bridge are live.
  await page.waitForFunction(() => !!window.__play?.chassisBody, null, { timeout: 60000 });
  log.push('[sp] booted');
  return { ctx, page };
}

// ── MP boot (host + guest, same template) ───────────────────────
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
async function pickTutorial(page) {
  await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('.lsp-tile'));
    const tut = tiles.find((t) => /crossroads/i.test(t.textContent || ''))
      || tiles.find((t) => /sprint\s*drag/i.test(t.textContent || ''))
      || tiles.find((t) => /tutorial/i.test(t.textContent || ''));
    (tut || tiles[0])?.click();
  });
  await wait(400);
}
async function hostLobby(page) {
  await page.evaluate(() => document.getElementById('play-btn').click());
  await page.waitForFunction(() => {
    const code = (document.querySelector('#party-code')?.textContent || '').trim();
    return code && code.length >= 5 && code !== '------';
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
  // Local kart must be in the schema before we sample.
  await page.waitForFunction(() => {
    const sid = window.__mySid;
    return sid && window.__roomRef?.state?.karts?.get(sid);
  }, null, { timeout: 30000 });
  log.push(`[${label}] mp loaded`);
}

// ── Input scripting ─────────────────────────────────────────────
// Each entry: { label, dur (ms), keys: Set<string> }. We dispatch
// keydown for newly-held keys, keyup for newly-released keys, and
// re-fire keydown every 100 ms to keep auto-repeat alive (mirrors a
// human holding the key down).
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
async function releaseAll(page) { return applyKeys(page, []); }

// ── Snapshot reader ─────────────────────────────────────────────
// Each page runs its OWN sampling loop via setInterval so we can pull
// 20 Hz traces without paying the per-tick CDP round-trip (which was
// throttling samples to ~3 Hz in v1 of this probe).
const SP_SAMPLE_FN = `() => {
  const p = window.__play;
  if (!p?.chassisBody) return null;
  const cb = p.chassisBody;
  const q = cb.quaternion;
  const sinyCosp = 2 * (q.w * q.y + q.x * q.z);
  const cosyCosp = 1 - 2 * (q.y * q.y + q.x * q.x);
  return {
    t: performance.now(),
    x: cb.position.x, y: cb.position.y, z: cb.position.z,
    vx: cb.velocity.x, vy: cb.velocity.y, vz: cb.velocity.z,
    yaw: Math.atan2(sinyCosp, cosyCosp),
    throttle: p.controlState?.throttle || 0,
    steer: p.controlState?.steer || 0,
    brake: p.controlState?.brake || 0,
  };
}`;
const MP_SAMPLE_FN = `() => {
  const sid = window.__mySid;
  const k = sid ? window.__roomRef?.state?.karts?.get(sid) : null;
  if (!k) return null;
  const sinyCosp = 2 * ((k.qw || 1) * (k.qy || 0) + (k.qx || 0) * (k.qz || 0));
  const cosyCosp = 1 - 2 * ((k.qy || 0) * (k.qy || 0) + (k.qx || 0) * (k.qx || 0));
  return {
    t: performance.now(),
    x: k.x, y: k.y, z: k.z,
    vx: k.vx || 0, vy: k.vy || 0, vz: k.vz || 0,
    yaw: Math.atan2(sinyCosp, cosyCosp),
    throttle: k.throttleIn || 0,
    steer: k.steerIn || 0,
    brake: k.brakeIn || 0,
  };
}`;
async function startInPageSampler(page, sampleFnSrc, hz = 30) {
  await page.evaluate(({ src, hz }) => {
    window.__probeTrace = [];
    window.__probeSeg = '';
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    const fn = eval(`(${src})`);
    window.__probeTimer = setInterval(() => {
      const s = fn();
      if (s) { s.seg = window.__probeSeg; window.__probeTrace.push(s); }
    }, Math.round(1000 / hz));
  }, { src: sampleFnSrc, hz });
}
async function setProbeSeg(page, seg) {
  await page.evaluate((s) => { window.__probeSeg = s; }, seg);
}
async function dumpTrace(page) {
  return page.evaluate(() => {
    if (window.__probeTimer) clearInterval(window.__probeTimer);
    return window.__probeTrace || [];
  });
}

// ── Drive (sampling happens IN-PAGE) ────────────────────────────
async function driveScript(pages, segments, log) {
  for (const seg of segments) {
    log.push(`segment ${seg.label} (${seg.durMs}ms) keys=[${seg.keys.join(',')}]`);
    await Promise.all(pages.map((p) => setProbeSeg(p, seg.label)));
    await Promise.all(pages.map((p) => applyKeys(p, seg.keys)));
    await wait(seg.durMs);
  }
  await Promise.all(pages.map(releaseAll));
}

// ── Aggregate metrics from a trace ──────────────────────────────
// For each named segment, compute the headline "feel" numbers.
function metricsFor(trace, segName) {
  // Drop off-track samples (kart fell into the void) so they don't
  // skew speed/yaw/stop-distance metrics.
  const rows = trace.filter((r) => r.seg === segName && (r.y ?? 0) > 100);
  if (rows.length < 3) return { samples: rows.length, offTrack: true };
  const speed = rows.map((r) => Math.hypot(r.vx, r.vy, r.vz));
  const maxSpeed = Math.max(...speed);
  // Time to reach 50 % of THIS segment's max speed (a proxy for
  // throttle responsiveness). Returned in seconds, relative to
  // segment start.
  const half = maxSpeed * 0.5;
  let timeToHalf = null;
  const t0 = rows[0].t;
  for (const r of rows) {
    const s = Math.hypot(r.vx, r.vy, r.vz);
    if (s >= half) { timeToHalf = (r.t - t0) / 1000; break; }
  }
  // Sustained-turn yaw rate = average |dyaw/dt| over the second half
  // of the segment (after the kart has settled into the turn).
  const halfIdx = Math.floor(rows.length / 2);
  const yawSamples = rows.slice(halfIdx);
  let yawRate = 0;
  for (let i = 1; i < yawSamples.length; i += 1) {
    let dy = yawSamples[i].yaw - yawSamples[i - 1].yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    const dt = (yawSamples[i].t - yawSamples[i - 1].t) / 1000;
    if (dt > 0) yawRate += Math.abs(dy / dt);
  }
  yawRate = yawSamples.length > 1 ? yawRate / (yawSamples.length - 1) : 0;
  // Stopping distance = distance from segment-start position to
  // segment-end position, projected on horizontal plane.
  const a = rows[0]; const b = rows[rows.length - 1];
  const stopDist = Math.hypot(b.x - a.x, b.z - a.z);
  return {
    samples: rows.length,
    maxSpeed,
    timeToHalfSpeedS: timeToHalf,
    yawRate,
    stopDist,
    avgY: rows.reduce((s, r) => s + r.y, 0) / rows.length,
  };
}

// Compare two metric blocks; produce a {delta, relDelta, withinBudget?}
function diff(spVal, mpVal, key, budgetRel, budgetAbs) {
  if (typeof spVal !== 'number' || typeof mpVal !== 'number' || !Number.isFinite(spVal) || !Number.isFinite(mpVal)) {
    return { key, spVal, mpVal, delta: null, ok: false, reason: 'missing' };
  }
  const delta = mpVal - spVal;
  const rel = Math.abs(spVal) > 1e-6 ? Math.abs(delta) / Math.abs(spVal) : Math.abs(delta);
  const ok = budgetAbs != null
    ? Math.abs(delta) <= budgetAbs
    : rel <= budgetRel;
  return { key, spVal, mpVal, delta, relDelta: rel, ok };
}

// ── Main ────────────────────────────────────────────────────────
async function main() {
  const log = [];
  const { code: trackCode, name: trackName } = loadOvalTemplateCode();
  log.push(`track: ${trackName} (code len ${trackCode.length})`);

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
    ],
  });

  const failures = [];
  let report = { pass: false, log, failures };

  try {
    // Shorter segments so neither kart overshoots the small Crossroads
    // loop. Forward burst is held just long enough to reach a stable
    // mid-speed (~25 m/s); brake then has a clear runway to stop on a
    // FLAT surface (no ramp jumps).
    const segments = [
      { label: 'rest',          durMs: 600,  keys: [] },
      { label: 'forward',       durMs: 1800, keys: ['KeyW'] },
      { label: 'coast',         durMs: 800,  keys: [] },
      { label: 'brake',         durMs: 1200, keys: ['Space'] },
      { label: 'reverse',       durMs: 1500, keys: ['KeyS'] },
    ];

    // ── PHASE 1: SP solo (only one tab so it stays foregrounded) ─
    const sp = await bootSP(browser, trackCode, log);
    await sp.page.bringToFront();
    await wait(800);
    await startInPageSampler(sp.page, SP_SAMPLE_FN, 30);
    await driveScript([sp.page], segments, log);
    const spTrace = await dumpTrace(sp.page);
    log.push(`sp samples=${spTrace.length}`);
    await sp.ctx.close().catch(() => null);

    // ── PHASE 2: MP host + guest (host stays foregrounded) ─────
    const mpH = await setupPage(browser, 'mp-host', log);
    const mpG = await setupPage(browser, 'mp-guest', log);
    await openLobby(mpH.page, 'parity-host');
    await pickTutorial(mpH.page);
    const lobbyCode = await hostLobby(mpH.page);
    log.push(`mp lobby code: ${lobbyCode}`);
    await openLobby(mpG.page, 'parity-guest');
    await joinLobby(mpG.page, lobbyCode);
    await wait(500);
    await startMatch(mpH.page, mpG.page);
    await waitForMpGameLoad(mpH.page, 'mp-host', log);
    await waitForMpGameLoad(mpG.page, 'mp-guest', log);
    await mpH.page.bringToFront();
    // Wait for the countdown overlay to first become visible (race
    // started) and then hide again (countdown done). The naive
    // wait-for-hidden returns immediately because the overlay starts
    // out hidden in markup.
    await mpH.page.waitForFunction(() => {
      const o = document.getElementById('overlay-countdown');
      return o && !o.classList.contains('hidden');
    }, null, { timeout: 20000 }).catch(() => null);
    await mpH.page.waitForFunction(() => {
      const o = document.getElementById('overlay-countdown');
      return o && o.classList.contains('hidden');
    }, null, { timeout: 20000 }).catch(() => null);
    await wait(800); // small buffer after GO!
    log.push('mp live, beginning parity script');

    await startInPageSampler(mpH.page, MP_SAMPLE_FN, 30);
    await driveScript([mpH.page], segments, log);
    const mpTrace = await dumpTrace(mpH.page);
    log.push(`mp samples=${mpTrace.length}`);

    const traces = [spTrace, mpTrace];
    const labels = ['sp', 'mp-host'];
    const perPage = traces.map((tr, i) => {
      const out = {};
      for (const seg of segments) out[seg.label] = metricsFor(tr, seg.label);
      return { idx: i, label: labels[i], metrics: out };
    });

    // ── Compute SP vs MP-host deltas on the headline numbers ──
    const sp_m = perPage[0].metrics;
    const mp_m = perPage[1].metrics;
    const cmp = {};
    cmp.topSpeed_forward = diff(
      sp_m['forward']?.maxSpeed, mp_m['forward']?.maxSpeed,
      'topSpeed_forward', BUDGETS.topSpeedRelDelta, null,
    );
    cmp.responsiveness_forward = diff(
      sp_m['forward']?.timeToHalfSpeedS, mp_m['forward']?.timeToHalfSpeedS,
      'responsiveness_forward', null, BUDGETS.timeToHalfSpeedDeltaS,
    );
    cmp.stoppingDist_brake = diff(
      sp_m['brake']?.stopDist, mp_m['brake']?.stopDist,
      'stoppingDist_brake', BUDGETS.stoppingDistRelDelta, null,
    );
    cmp.topSpeed_reverse = diff(
      sp_m['reverse']?.maxSpeed, mp_m['reverse']?.maxSpeed,
      'topSpeed_reverse', BUDGETS.topSpeedRelDelta, null,
    );

    for (const k of Object.keys(cmp)) {
      const c = cmp[k];
      if (!c.ok) failures.push(`${k}: sp=${(+c.spVal||0).toFixed(2)} mp=${(+c.mpVal||0).toFixed(2)} relΔ=${(c.relDelta||0).toFixed(2)}`);
    }

    report = { pass: failures.length === 0, track: trackName, segments, perPage, comparison: cmp, log, failures, traces };
  } catch (err) {
    failures.push(`fatal: ${err.message}`);
    report.failures = failures;
    report.error = err.stack;
  } finally {
    await browser.close().catch(() => null);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\n=== sp-vs-mp parity ===`);
  console.log('pass:', report.pass);
  if (report.comparison) {
    for (const k of Object.keys(report.comparison)) {
      const c = report.comparison[k];
      console.log(`  ${k}: sp=${(+c.spVal||0).toFixed(2)} mp=${(+c.mpVal||0).toFixed(2)} relΔ=${(c.relDelta||0).toFixed(2)} ${c.ok ? 'OK' : 'FAIL'}`);
    }
  }
  for (const f of failures) console.log('FAIL:', f);
  console.log('report:', REPORT_PATH);
  process.exit(report.pass ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
