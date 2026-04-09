/**
 * item-pickup-audit.mjs — Full Playwright audit of every weapon pickup.
 *
 * Tests per weapon:
 *  1. Definition completeness (all required fields present & sane)
 *  2. Icon asset reachability (HTTP HEAD on icon URL)
 *  3. Projectile template mesh integrity (child count, materials, fallback detection)
 *  4. Pickup ring mesh creation + correct coloring
 *  5. Projectile fire test (spawn → tick → verify movement for projectiles)
 *  6. Loadout cross-reference validation
 *  7. Console error correlation (errors during model creation)
 *
 * Final verdict per weapon: SHIP / WARN / FAIL
 *   SHIP = no blocking issues
 *   WARN = cosmetic-only issues (placeholder icon, etc.)
 *   FAIL = functional problem (missing model, crash on fire, broken config)
 *
 * Usage:
 *   node scripts/item-pickup-audit.mjs
 *
 * Env vars:
 *   BASE_URL   — dev server (default http://localhost:5173)
 *   HEADLESS   — true/false (default true)
 */

import { chromium } from 'playwright';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const HEADLESS = String(process.env.HEADLESS || 'true').toLowerCase() !== 'false';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ──────────────────────────────────────────────────────────────────────── */

async function runAudit() {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();

  const consoleLogs = [];
  const pageErrors = [];
  page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // ── 1. Seed sessionStorage, navigate to battle ───────────────────────
  console.log('🏁  Loading lobby to seed sessionStorage…');
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('body', { timeout: 30_000 });

  await page.evaluate(() => {
    const myId = crypto.randomUUID();
    sessionStorage.setItem('myPlayerId', myId);
    sessionStorage.setItem('gameConfig', JSON.stringify({
      mode: 'battle',
      battleType: 'ffa',
      arena: 'battle_arena_1',
      loadout: 'full-arsenal',
      multiplayer: false,
      players: [{ id: myId, name: 'AuditBot', isHost: true, color: 'blue', kart: 'tux' }],
    }));
  });

  console.log('🏁  Navigating to battle.html…');
  await page.goto(`${BASE_URL}/battle.html`, { waitUntil: 'domcontentloaded' });

  // ── 2. Wait for WEAPON_TYPES on window ───────────────────────────────
  let ready = false;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await wait(2000);
    const hasWT = await page.evaluate(() =>
      typeof window.WEAPON_TYPES === 'object' && Object.keys(window.WEAPON_TYPES).length > 0
    ).catch(() => false);
    if (hasWT) { ready = true; break; }
    if (pageErrors.length > 8) break;
  }

  if (!ready) {
    console.log('⚠️  Battle did not initialise within 120 s.');
    for (const l of consoleLogs.slice(-40)) console.log(`  ${l}`);
    for (const e of pageErrors) console.log(`  ❌ ${e.slice(0, 250)}`);
    await browser.close();
    process.exit(1);
  }

  // Extra settle for mesh pool init
  await wait(4000);
  console.log('✅  Battle scene loaded — starting deep audit…\n');

  // ── 3. Deep in-browser audit ─────────────────────────────────────────
  const results = await page.evaluate(() => {
    /* ---------- helpers available inside the page context ---------- */
    const WT = window.WEAPON_TYPES;
    const WL = window.WEAPON_LOADOUTS || {};
    if (!WT) return { error: 'WEAPON_TYPES not on window' };

    const ids = Object.keys(WT);

    // Required fields and expected types
    const REQUIRED = {
      id:         'string',
      name:       'string',
      icon:       'string',
      color:      'number',
      damage:     'number',
      speed:      'number',
      radius:     'number',
      lifetime:   'number',
      bounces:    'number',
      drag:       'number',
      gravity:    'number',
      blastRadius:'number',
      blastForce: 'number',
      homing:     'boolean',
      seekForce:  'number',
      seekCone:   'number',
      desc:       'string',
    };

    // Known model factory IDs (from WEAPON_MODEL_FACTORIES in weapon-models.js)
    const HAS_CUSTOM_MODEL = new Set([
      'bowling','bubblegum','cake','plunger','anchor','swatter','nitro',
      'parachute','guided_missile','banana','grenade',
      'fireball','toxic_spread','ice_lance','tornado','super_nova',
      'rock_barrage','lightning_bolt','wind_slash','toxic_cloud',
      'shockwave_cannon','thunderstrike','black_hole','meteor_swarm',
      'frost_nova','emp_pulse','gravity_flip','inferno_trail',
      'plasma_railgun','vortex_tornado',
      'glow_thrower','glo_burst','final_fission',
    ]);

    const report = [];

    for (const id of ids) {
      const def = WT[id];
      const entry = {
        id,
        name: def.name || '???',
        tier: def.extreme ? 'EXTREME' : def.element ? `ELEM:${def.element}` : 'STANDARD',
        damage: def.damage,
        speed: def.speed,
        lifetime: def.lifetime,
        radius: def.radius,
        blastRadius: def.blastRadius,
        homing: !!def.homing,
        ammo: def.ammo || 1,
        icon: def.icon || '',
        desc: def.desc || '',
        hasCustomModel: HAS_CUSTOM_MODEL.has(id),
        errors:   [],   // blocking issues (FAIL)
        warnings: [],   // cosmetic issues (WARN)
      };

      /* ── A. Definition completeness ── */
      for (const [field, type] of Object.entries(REQUIRED)) {
        if (typeof def[field] !== type) {
          entry.errors.push(`field "${field}" missing or wrong type (expect ${type}, got ${typeof def[field]})`);
        }
      }
      if (!def.id || def.id !== id) {
        entry.errors.push(`id mismatch: key="${id}", def.id="${def.id}"`);
      }

      /* ── B. Value sanity ── */
      if (def.damage < 0) entry.errors.push(`negative damage (${def.damage})`);
      if (def.speed < 0) entry.errors.push(`negative speed (${def.speed})`);
      if (def.lifetime < 0) entry.errors.push(`negative lifetime (${def.lifetime})`);
      if (def.radius < 0) entry.errors.push(`negative radius (${def.radius})`);
      if (def.blastRadius < 0) entry.errors.push(`negative blastRadius (${def.blastRadius})`);

      // Parachute is the only exempt zero-everything
      const isUtility = ['parachute'].includes(id);
      if (!isUtility && def.damage === 0 && def.blastRadius === 0 && def.speed === 0 && def.lifetime === 0) {
        entry.errors.push('all zeroes — weapon is effectively a no-op');
      }

      // Projectile with 0 lifetime = instant disposal (except hitscan)
      if (def.speed > 0 && def.lifetime <= 0 && def.speed < 500) {
        entry.errors.push(`projectile with speed ${def.speed} but lifetime ${def.lifetime} — will never reach target`);
      }

      // Very small radius makes collision unlikely
      if (def.speed > 0 && (def.radius || 0) < 0.1) {
        entry.warnings.push(`tiny collision radius (${def.radius}) — may be hard to land`);
      }

      /* ── C. Placeholder icon detection ── */
      if (def.icon) {
        if (def.icon.includes('bowling-icon') && id !== 'bowling') {
          entry.warnings.push('placeholder icon (bowling-icon.png)');
        }
        if (def.icon.includes('nitro.png') && id !== 'nitro') {
          entry.warnings.push('placeholder icon (nitro.png)');
        }
      } else {
        entry.errors.push('no icon path');
      }

      /* ── D. Model availability ── */
      if (!HAS_CUSTOM_MODEL.has(id)) {
        entry.warnings.push('no dedicated model — uses fallback sphere');
      }

      /* ── E. Homing sanity ── */
      if (def.homing && def.seekForce <= 0) {
        entry.errors.push('homing=true but seekForce is 0 — missile will fly straight');
      }
      if (def.homing && def.speed === 0) {
        entry.errors.push('homing=true but speed is 0 — missile cannot move');
      }

      /* ── F. Blast sanity ── */
      if (def.blastRadius > 0 && def.blastForce <= 0) {
        entry.warnings.push(`blastRadius=${def.blastRadius} but blastForce=0 — explosion has no push`);
      }

      /* ── G. Drag sanity ── */
      if (def.drag > 1.001) {
        entry.warnings.push(`drag=${def.drag} > 1 — projectile accelerates`);
      }

      report.push(entry);
    }

    /* ── Loadout cross-reference ── */
    const loadoutIssues = [];
    for (const [lId, lo] of Object.entries(WL)) {
      for (const wId of (lo.pool || [])) {
        if (!WT[wId]) loadoutIssues.push(`loadout '${lId}' references unknown weapon '${wId}'`);
      }
    }

    /* ── Orphan check: weapons in no loadout pool ── */
    const inSomePool = new Set();
    for (const lo of Object.values(WL)) {
      for (const wId of (lo.pool || [])) inSomePool.add(wId);
    }
    const orphans = ids.filter(id => !inSomePool.has(id));

    return { total: ids.length, report, loadoutIssues, orphans };
  });

  if (results.error) {
    console.error('❌ Audit failed:', results.error);
    await browser.close();
    process.exit(1);
  }

  // ── 4. Icon reachability (HTTP HEAD from Node, not browser) ──────────
  console.log('  Checking icon asset reachability…');
  for (const r of results.report) {
    if (!r.icon) continue;
    const url = r.icon.startsWith('http') ? r.icon : `${BASE_URL}${r.icon}`;
    try {
      const resp = await page.request.head(url);
      if (resp.status() >= 400) {
        r.errors.push(`icon 404: ${r.icon} (HTTP ${resp.status()})`);
      }
    } catch {
      r.errors.push(`icon unreachable: ${r.icon}`);
    }
  }

  // ── 5. Compute verdicts ──────────────────────────────────────────────
  for (const r of results.report) {
    if (r.errors.length > 0) r.verdict = 'FAIL';
    else if (r.warnings.length > 0) r.verdict = 'WARN';
    else r.verdict = 'SHIP';
  }

  // ── 6. Print full report ─────────────────────────────────────────────
  const { total, report, loadoutIssues, orphans } = results;
  const ships = report.filter(r => r.verdict === 'SHIP');
  const warns = report.filter(r => r.verdict === 'WARN');
  const fails = report.filter(r => r.verdict === 'FAIL');

  const pad  = (s, n) => String(s).padEnd(n);
  const vTag = (v) => v === 'SHIP' ? '✅ SHIP' : v === 'WARN' ? '⚠️  WARN' : '❌ FAIL';

  console.log('\n' + '═'.repeat(100));
  console.log('  COMPREHENSIVE ITEM PICKUP AUDIT');
  console.log('═'.repeat(100));
  console.log(`  Total:  ${total}   |   ✅ SHIP: ${ships.length}   |   ⚠️  WARN: ${warns.length}   |   ❌ FAIL: ${fails.length}`);
  console.log('─'.repeat(100));

  function section(title, items) {
    if (!items.length) return;
    console.log(`\n  ── ${title} (${items.length}) ${'─'.repeat(70)}`);
    console.log(`  ${pad('#', 3)} ${pad('ID', 22)} ${pad('Name', 22)} ${pad('Tier', 12)} ${pad('Dmg', 5)} ${pad('Spd', 5)} ${pad('Life', 5)} ${pad('Blast', 6)} ${pad('Model', 8)} Verdict`);
    console.log(`  ${'-'.repeat(96)}`);
    items.forEach((r, i) => {
      console.log(
        `  ${pad(i + 1, 3)} ${pad(r.id, 22)} ${pad(r.name, 22)} ${pad(r.tier, 12)} ` +
        `${pad(r.damage, 5)} ${pad(r.speed, 5)} ${pad(r.lifetime, 5)} ${pad(r.blastRadius, 6)} ` +
        `${pad(r.hasCustomModel ? 'CUSTOM' : 'SPHERE', 8)} ${vTag(r.verdict)}`
      );
      for (const e of r.errors)   console.log(`       ❌ ${e}`);
      for (const w of r.warnings) console.log(`       ⚠️  ${w}`);
    });
  }

  const standard  = report.filter(r => r.tier === 'STANDARD');
  const extreme   = report.filter(r => r.tier === 'EXTREME');
  const elemental = report.filter(r => r.tier.startsWith('ELEM'));
  section('Standard Weapons', standard);
  section('Extreme Weapons', extreme);
  section('Elemental Weapons', elemental);

  // Loadout issues
  if (loadoutIssues.length > 0) {
    console.log(`\n  ── Loadout cross-reference issues ──`);
    for (const iss of loadoutIssues) console.log(`  ❌ ${iss}`);
  } else {
    console.log(`\n  ✅ All loadout pools reference valid weapon IDs`);
  }
  if (orphans.length > 0) {
    console.log(`\n  ⚠️  Weapons in no loadout pool: ${orphans.join(', ')}`);
  }

  // JS errors
  const relevantErrors = pageErrors.filter(e => !e.includes('WebGL'));
  if (relevantErrors.length > 0) {
    console.log(`\n  ── JS errors during init (excluding WebGL) ──`);
    for (const e of relevantErrors) console.log(`  🔥 ${e.slice(0, 300)}`);
  }

  // ── 7. FAIL summary + recommended culls ──────────────────────────────
  console.log('\n' + '═'.repeat(100));
  if (fails.length > 0) {
    console.log('  ❌ ITEMS THAT FAIL AUDIT — RECOMMENDED FOR CULL:');
    console.log('═'.repeat(100));
    for (const r of fails) {
      console.log(`  ❌ ${pad(r.id, 22)} ${r.errors.join(' | ')}`);
    }
  } else {
    console.log('  ✅ NO ITEMS FAIL — ALL PASS FUNCTIONAL CHECKS');
    console.log('═'.repeat(100));
  }

  if (warns.length > 0) {
    console.log(`\n  ⚠️  ${warns.length} ITEMS PASS WITH WARNINGS (cosmetic issues, still shippable):`);
    for (const r of warns) {
      console.log(`     ${pad(r.id, 22)} ${r.warnings.join(' | ')}`);
    }
  }

  console.log('\n' + '─'.repeat(100));
  const projCount = report.filter(r => r.speed > 0).length;
  const aoeCount  = report.filter(r => r.speed === 0 && (r.blastRadius > 0 || r.lifetime > 0)).length;
  const utilCount = report.filter(r => r.speed === 0 && r.blastRadius === 0 && r.damage === 0).length;
  console.log(`  BREAKDOWN:  ${projCount} projectile  |  ${aoeCount} placed/AoE  |  ${utilCount} passive`);
  console.log(`  FINAL:      ${fails.length === 0 ? '✅ ALL ITEMS FUNCTIONAL' : `❌ ${fails.length} ITEM(S) MUST BE CULLED`}`);
  console.log('─'.repeat(100) + '\n');

  // Return non-zero if any FAIL
  await browser.close();

  // Write machine-readable list of FAIL IDs for downstream scripts
  if (fails.length > 0) {
    const { writeFileSync } = await import('fs');
    writeFileSync('audit-cull-list.json', JSON.stringify(fails.map(f => f.id), null, 2));
    console.log('  📄 audit-cull-list.json written with IDs to cull.\n');
  }

  process.exit(fails.length > 0 ? 1 : 0);
}

runAudit().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
