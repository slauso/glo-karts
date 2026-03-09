import { test, expect } from '@playwright/test';

const VITE = 'http://localhost:5173';

test.describe('Phase 19 — Procedural generation & game systems', () => {

  // ── 19.1 Procedural Track Generator ─────────────────────────────────────
  test('procedural-track-gen exports generateTrackDataOnly and produces valid driveline', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-track-gen.js');
      const td = mod.generateTrackDataOnly('test_proc_track_42');
      return {
        hasDriveline: Array.isArray(td.driveline) && td.driveline.length > 10,
        hasCheckpoints: Array.isArray(td.checkpoints) && td.checkpoints.length >= 2,
        hasStartPositions: Array.isArray(td.startPositions) && td.startPositions.length >= 4,
        laps: td.laps,
        hasGraph: td.graph && typeof td.graph.mainLoop !== 'undefined',
      };
    });

    expect(data.hasDriveline).toBe(true);
    expect(data.hasCheckpoints).toBe(true);
    expect(data.hasStartPositions).toBe(true);
    expect(data.laps).toBe(3);
    expect(data.hasGraph).toBe(true);
  });

  // ── 19.2 Procedural Arena Generator ─────────────────────────────────────
  test('procedural-arena-gen exports generateArenaDataOnly with spawns and navmesh', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-arena-gen.js');
      const ad = mod.generateArenaDataOnly('test_proc_arena_7');
      return {
        hasSpawns: Array.isArray(ad.spawnPositions) && ad.spawnPositions.length >= 4,
        hasItems: Array.isArray(ad.items) && ad.items.length >= 2,
        hasNavmesh: ad.navmesh != null,
        hasStartPositions: Array.isArray(ad.startPositions) && ad.startPositions.length >= 4,
        laps: ad.laps,
      };
    });

    expect(data.hasSpawns).toBe(true);
    expect(data.hasItems).toBe(true);
    expect(data.hasNavmesh).toBe(true);
    expect(data.hasStartPositions).toBe(true);
    expect(data.laps).toBe(1);
  });

  // ── 19.3 Procedural Weapons & Extreme Weapons ──────────────────────────
  test('procedural-models exports EXTREME_WEAPONS catalogue with 10 entries', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-models.js');
      const keys = Object.keys(mod.EXTREME_WEAPONS);
      return {
        extremeCount: keys.length,
        hasDrawFn: typeof mod.drawExtremeWeapon === 'function',
        hasIsExtreme: typeof mod.isExtremeWeapon === 'function',
        firstId: keys[0],
      };
    });

    expect(data.extremeCount).toBe(10);
    expect(data.hasDrawFn).toBe(true);
    expect(data.hasIsExtreme).toBe(true);
    expect(data.firstId).toBeTruthy();
  });

  // ── 19.4 VFX System ────────────────────────────────────────────────────
  test('procedural-vfx exports standard and extreme effect functions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/procedural-vfx.js');
      return {
        hasExplosion: typeof mod.vfxExplosion === 'function',
        hasShockwave: typeof mod.vfxShockwave === 'function',
        hasBlackHole: typeof mod.vfxBlackHoleVortex === 'function',
        hasDispose: typeof mod.disposeAllVFX === 'function',
        hasCount: typeof mod.getActiveVFXCount === 'function',
      };
    });

    expect(data.hasExplosion).toBe(true);
    expect(data.hasShockwave).toBe(true);
    expect(data.hasBlackHole).toBe(true);
    expect(data.hasDispose).toBe(true);
    expect(data.hasCount).toBe(true);
  });

  // ── 19.5 Physics Integration ────────────────────────────────────────────
  test('kart-physics exports STATUS effects and weapon impact functions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/kart-physics.js');
      return {
        hasSTATUS: typeof mod.STATUS === 'object',
        statusCount: Object.keys(mod.STATUS).length,
        hasCreateStatusState: typeof mod.createStatusState === 'function',
        hasApplyHitImpulse: typeof mod.applyHitImpulse === 'function',
        hasApplySpinout: typeof mod.applySpinout === 'function',
        hasApplyStatusEffect: typeof mod.applyStatusEffect === 'function',
        hasTickStatusEffects: typeof mod.tickStatusEffects === 'function',
        hasClearStatusEffect: typeof mod.clearStatusEffect === 'function',
        hasHitDirection: typeof mod.hitDirection === 'function',
      };
    });

    expect(data.hasSTATUS).toBe(true);
    expect(data.statusCount).toBe(7);
    expect(data.hasCreateStatusState).toBe(true);
    expect(data.hasApplyHitImpulse).toBe(true);
    expect(data.hasApplySpinout).toBe(true);
    expect(data.hasApplyStatusEffect).toBe(true);
    expect(data.hasTickStatusEffects).toBe(true);
    expect(data.hasClearStatusEffect).toBe(true);
    expect(data.hasHitDirection).toBe(true);
  });

  // ── 19.6 Targeting System ──────────────────────────────────────────────
  test('targeting module exports lock-on, homing, arc, and raycast functions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/weapons/targeting.js');
      return {
        hasCreateLockState: typeof mod.createLockState === 'function',
        hasTickLockOn: typeof mod.tickLockOn === 'function',
        hasFindNearest: typeof mod.findNearestEnemy === 'function',
        hasCreateHoming: typeof mod.createHomingFlight === 'function',
        hasTickHoming: typeof mod.tickHomingFlight === 'function',
        hasCreateArc: typeof mod.createArcFlight === 'function',
        hasTickArc: typeof mod.tickArcFlight === 'function',
        hasRaycast: typeof mod.raycastHit === 'function',
        hasAoe: typeof mod.aoeTargets === 'function',
      };
    });

    expect(data.hasCreateLockState).toBe(true);
    expect(data.hasTickLockOn).toBe(true);
    expect(data.hasFindNearest).toBe(true);
    expect(data.hasCreateHoming).toBe(true);
    expect(data.hasTickHoming).toBe(true);
    expect(data.hasCreateArc).toBe(true);
    expect(data.hasTickArc).toBe(true);
    expect(data.hasRaycast).toBe(true);
    expect(data.hasAoe).toBe(true);
  });

  // ── 19.7 Race Flow ────────────────────────────────────────────────────
  test('race-flow state machine transitions correctly', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/race-flow.js');
      const flow = mod.createRaceFlow({ totalLaps: 3, countdownDuration: 3 });

      // Initial state
      const s0 = flow.state;
      mod.startPreRace(flow);
      const s1 = flow.state;
      mod.startCountdownFlow(flow);
      const s2 = flow.state;
      mod.startRacing(flow);
      const s3 = flow.state;

      return {
        s0, s1, s2, s3,
        isRacing: mod.isRacing(flow),
        isFinished: mod.isFinished(flow),
        formatTime: mod.getFormattedTime(65.123),
      };
    });

    expect(data.s0).toBe('LOADING');
    expect(data.s1).toBe('PRE_RACE');
    expect(data.s2).toBe('COUNTDOWN');
    expect(data.s3).toBe('RACING');
    expect(data.isRacing).toBe(true);
    expect(data.isFinished).toBe(false);
    expect(data.formatTime).toBe('01:05.123');
  });

  // ── 19.8 Battle Flow ──────────────────────────────────────────────────
  test('battle-flow state machine and damage tracking work', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/battle-flow.js');
      const flow = mod.createBattleFlow({ subMode: 'deathmatch', timeLimit: 60, scoreLimit: 5 });

      mod.addCombatant(flow, 'p1', 'Player');
      mod.addCombatant(flow, 'bot1', 'Bot 1');
      mod.startSpawn(flow);
      mod.startBattleCountdown(flow);
      mod.startBattle(flow);

      const dmg1 = mod.applyDamage(flow, 'bot1', 40, 'p1', 'bowling_ball');
      const dmg2 = mod.applyDamage(flow, 'bot1', 70, 'p1', 'shockwave_cannon');

      return {
        state: flow.state,
        dmg1Health: dmg1.health,
        dmg1Killed: dmg1.killed,
        dmg2Killed: dmg2.killed,
        p1Kills: mod.getCombatant(flow, 'p1').kills,
        killFeedLen: mod.getKillFeed(flow).length,
        isBattleActive: mod.isBattleActive(flow),
      };
    });

    expect(data.state).toBe('BATTLE');
    expect(data.dmg1Health).toBe(60);
    expect(data.dmg1Killed).toBe(false);
    expect(data.dmg2Killed).toBe(true);
    expect(data.p1Kills).toBe(1);
    expect(data.killFeedLen).toBe(1);
    expect(data.isBattleActive).toBe(true);
  });

  // ── 19.10 Pause Menu ──────────────────────────────────────────────────
  test('pause-menu exports init, pause, resume, isPaused', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/pause-menu.js');
      return {
        hasInit: typeof mod.initPauseMenu === 'function',
        hasPause: typeof mod.pause === 'function',
        hasResume: typeof mod.resume === 'function',
        hasIsPaused: typeof mod.isPaused === 'function',
        hasDispose: typeof mod.disposePauseMenu === 'function',
      };
    });

    expect(data.hasInit).toBe(true);
    expect(data.hasPause).toBe(true);
    expect(data.hasResume).toBe(true);
    expect(data.hasIsPaused).toBe(true);
    expect(data.hasDispose).toBe(true);
  });

  // ── 19.11 Bot Personality AI ──────────────────────────────────────────
  test('bot-personality exports profiles and decision functions', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/ai/bot-personality.js');
      const p = mod.pickPersonality(2);
      return {
        profileCount: Object.keys(mod.PERSONALITIES).length,
        hasPickFn: typeof mod.pickPersonality === 'function',
        hasShouldUseItem: typeof mod.shouldUseItem === 'function',
        hasCornerBrake: typeof mod.cornerBrakeDecision === 'function',
        hasShouldDrift: typeof mod.shouldDrift === 'function',
        hasAdapt: typeof mod.adaptStrategy === 'function',
        hasPickTarget: typeof mod.pickBattleTarget === 'function',
        personalityHasName: typeof p.name === 'string',
      };
    });

    expect(data.profileCount).toBe(6);
    expect(data.hasPickFn).toBe(true);
    expect(data.hasShouldUseItem).toBe(true);
    expect(data.hasCornerBrake).toBe(true);
    expect(data.hasShouldDrift).toBe(true);
    expect(data.hasAdapt).toBe(true);
    expect(data.hasPickTarget).toBe(true);
    expect(data.personalityHasName).toBe(true);
  });

  // ── 19.12 Records Manager ────────────────────────────────────────────
  test('records-manager save/load race records with PB detection', async ({ page }) => {
    await page.goto(`${VITE}/game.html`, { waitUntil: 'domcontentloaded' });

    const data = await page.evaluate(async () => {
      const mod = await import('/src/modules/records-manager.js');
      // Clear first
      mod.clearAllRecords();

      const r1 = mod.saveRaceRecord('test_track', 'normal', {
        raceTime: 90.5, bestLap: 28.3, lapTimes: [30, 29.2, 28.3], position: 1,
      });
      const r2 = mod.saveRaceRecord('test_track', 'normal', {
        raceTime: 88.0, bestLap: 27.1, lapTimes: [29, 28, 27.1], position: 1,
      });
      const record = mod.getRaceRecord('test_track', 'normal');

      mod.clearAllRecords();
      return {
        r1NewPBRace: r1.newPBRace,
        r1NewPBLap: r1.newPBLap,
        r2NewPBRace: r2.newPBRace,
        r2NewPBLap: r2.newPBLap,
        bestRace: record.bestRaceTime,
        bestLap: record.bestLapTime,
        formatTime: mod.formatTime(65.123),
      };
    });

    expect(data.r1NewPBRace).toBe(true);
    expect(data.r1NewPBLap).toBe(true);
    expect(data.r2NewPBRace).toBe(true);
    expect(data.r2NewPBLap).toBe(true);
    expect(data.bestRace).toBe(88.0);
    expect(data.bestLap).toBe(27.1);
    expect(data.formatTime).toBe('01:05.123');
  });
});
