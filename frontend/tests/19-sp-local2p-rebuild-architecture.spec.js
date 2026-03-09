/**
 * Phase 14 — SP/Local2P rebuild module tests.
 *
 * Validates:
 *  1. ModeManager lifecycle (switch, update, dispose)
 *  2. All 9 mode class exports + lifecycle methods
 *  3. ProjectileSystem pooling, homing, ballistic, bounce, collision
 *  4. BotLogicService difficulty presets, decision tree, bounded outputs
 *  5. WeaponInventory equip/fire/cooldown/buff mechanics
 *  6. Mode factory mapping correctness
 *  7. Per-mode integration tests
 */
import { test, expect } from '@playwright/test';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..', 'src', 'modules');

async function importModule(relPath) {
  const file = resolve(ROOT, relPath);
  return import(pathToFileURL(file).href);
}

// Import mode classes individually (avoids SPRuntimeBridge → Babylon dep chain)
async function importModeClasses() {
  const [
    { ModeBase },
    { ModeManager },
    { NormalRaceMode },
    { QuickRaceMode },
    { TimeTrialMode },
    { GrandPrixMode },
    { FreeRoamMode },
    { FollowTheLeaderMode },
    { SoccerMode },
    { BattleMode },
    { LocalSplitScreenMode },
    { createRebuildMode },
  ] = await Promise.all([
    importModule('modes/rebuild/mode-base.js'),
    importModule('modes/rebuild/mode-manager.js'),
    importModule('modes/rebuild/normal-race-mode.js'),
    importModule('modes/rebuild/quick-race-mode.js'),
    importModule('modes/rebuild/time-trial-mode.js'),
    importModule('modes/rebuild/grand-prix-mode.js'),
    importModule('modes/rebuild/free-roam-mode.js'),
    importModule('modes/rebuild/follow-the-leader-mode.js'),
    importModule('modes/rebuild/soccer-mode.js'),
    importModule('modes/rebuild/battle-mode.js'),
    importModule('modes/rebuild/local-splitscreen-mode.js'),
    importModule('modes/rebuild/mode-factory.js'),
  ]);
  return {
    ModeBase, ModeManager,
    NormalRaceMode, QuickRaceMode, TimeTrialMode, GrandPrixMode,
    FreeRoamMode, FollowTheLeaderMode, SoccerMode, BattleMode,
    LocalSplitScreenMode, createRebuildMode,
  };
}

test.describe('Phase 14 — Core Systems', () => {

  test('mode manager switches and updates active mode', async () => {
    const { ModeManager, QuickRaceMode } = await importModeClasses();

    let updates = 0;
    const deps = {
      raceSystems: {
        initRace: () => {},
        updateRace: () => { updates += 1; },
        updateBots: () => { updates += 1; },
        updateItems: () => { updates += 1; },
        disposeRace: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: { laps: 2, botCount: 3 },
    };

    const manager = new ModeManager();
    await manager.switchMode(new QuickRaceMode(deps));
    expect(manager.activeMode?.id).toBe('quick_race');
    manager.update(1 / 60);
    expect(updates).toBeGreaterThan(0);
    await manager.dispose();
    expect(manager.activeMode).toBeNull();
  });

  test('all rebuilt mode classes are exported with lifecycle methods', async () => {
    const mod = await importModeClasses();

    const classes = [
      mod.NormalRaceMode,
      mod.TimeTrialMode,
      mod.GrandPrixMode,
      mod.FreeRoamMode,
      mod.QuickRaceMode,
      mod.FollowTheLeaderMode,
      mod.SoccerMode,
      mod.BattleMode,
      mod.LocalSplitScreenMode,
    ];

    for (const Ctor of classes) {
      expect(typeof Ctor).toBe('function');
      const instance = Ctor === mod.BattleMode ? new Ctor({}, 'ctf') : new Ctor({});
      expect(typeof instance.init).toBe('function');
      expect(typeof instance.update).toBe('function');
      expect(typeof instance.destroy).toBe('function');
      expect(typeof instance.guard).toBe('function');
    }
  });

  test('mode IDs are unique and stable', async () => {
    const mod = await importModeClasses();

    const instances = [
      new mod.NormalRaceMode({}),
      new mod.QuickRaceMode({}),
      new mod.TimeTrialMode({}),
      new mod.GrandPrixMode({}),
      new mod.FreeRoamMode({}),
      new mod.FollowTheLeaderMode({}),
      new mod.SoccerMode({}),
      new mod.BattleMode({}, 'deathmatch'),
      new mod.BattleMode({}, 'three_strikes'),
      new mod.BattleMode({}, 'ctf'),
      new mod.LocalSplitScreenMode({}),
    ];

    const ids = instances.map(m => m.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});

test.describe('Phase 14 — Projectile System', () => {

  test('pools and updates homing/ballistic projectiles', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    const ps = new ProjectileSystem({ maxProjectiles: 4 });

    const p1 = ps.spawn({ x: 0, y: 2, z: 0, vx: 8, vy: 0, vz: 0, type: 'ballistic', ownerId: 'p1' });
    const p2 = ps.spawn({ x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 8, type: 'homing', ownerId: 'p2', targetId: 'player' });
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();

    ps.update(0.016, () => ({ x: 10, y: 2, z: 10 }));
    expect(ps.getActive().length).toBe(2);
    expect(ps.getActiveCount()).toBe(2);
  });

  test('bouncing projectiles bounce on floor', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    const ps = new ProjectileSystem({ maxProjectiles: 4 });

    ps.spawn({ x: 0, y: 5, z: 0, vx: 8, vy: -10, vz: 0, type: 'bounce', ownerId: 'p1', bounces: 3, life: 10 });
    // Simulate enough frames for the projectile to hit floor and bounce
    for (let i = 0; i < 60; i++) ps.update(1/60, () => null);
    const active = ps.getActive();
    // Should still be active due to bounces
    expect(active.length).toBe(1);
    expect(active[0].bouncesLeft).toBeLessThan(3);
  });

  test('collision detection finds hits correctly', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    const ps = new ProjectileSystem({ maxProjectiles: 4 });

    ps.spawn({ x: 5, y: 1, z: 5, vx: 0, vy: 0, vz: 0, type: 'ballistic', ownerId: 'attacker', life: 10 });
    const targets = [
      { id: 'attacker', x: 5, y: 1, z: 5 }, // Self — should NOT hit
      { id: 'victim', x: 5.5, y: 1, z: 5 },  // Close — should hit
    ];
    const hits = ps.checkCollisions(targets, 2.5);
    expect(hits.length).toBe(1);
    expect(hits[0].targetId).toBe('victim');
  });

  test('pool exhaustion returns null', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    const ps = new ProjectileSystem({ maxProjectiles: 2 });

    ps.spawn({ x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, type: 'ballistic', ownerId: 'a' });
    ps.spawn({ x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, type: 'ballistic', ownerId: 'b' });
    const overflow = ps.spawn({ x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 0, type: 'ballistic', ownerId: 'c' });
    expect(overflow).toBeNull();
  });

  test('clear() deactivates all projectiles', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    const ps = new ProjectileSystem({ maxProjectiles: 8 });
    for (let i = 0; i < 5; i++) ps.spawn({ x: 0, y: 2, z: 0, vx: i, vy: 0, vz: 0, type: 'ballistic', ownerId: 'x' });
    expect(ps.getActiveCount()).toBe(5);
    ps.clear();
    expect(ps.getActiveCount()).toBe(0);
  });

  test('VFX callbacks fire on spawn and expire', async () => {
    const { ProjectileSystem } = await importModule('weapons/projectile-system.js');
    let spawnCalled = false, expireCalled = false;
    const ps = new ProjectileSystem({
      maxProjectiles: 2,
      onSpawnVFX: () => { spawnCalled = true; },
      onExpireVFX: () => { expireCalled = true; },
    });

    ps.spawn({ x: 0, y: 2, z: 0, vx: 0, vy: 0, vz: 0, type: 'ballistic', ownerId: 'a', life: 0.01 });
    expect(spawnCalled).toBe(true);
    ps.update(0.1, () => null); // Expire it
    expect(expireCalled).toBe(true);
  });
});

test.describe('Phase 14 — AI Bot Logic', () => {

  test('bounded controls across all difficulties', async () => {
    const { BotLogicService } = await importModule('ai/bot-logic.js');

    for (const diff of ['easy', 'normal', 'hard', 'expert']) {
      const ai = new BotLogicService();
      ai.setDifficulty(diff);
      ai.setPath([{ x: 12, z: 0 }, { x: 24, z: 6 }, { x: 36, z: 0 }]);

      const out = ai.think({ x: 0, z: 0, heading: 0, speed: 10 });
      expect(out.throttle).toBeGreaterThanOrEqual(0);
      expect(out.throttle).toBeLessThanOrEqual(1);
      expect(out.steer).toBeGreaterThanOrEqual(-1);
      expect(out.steer).toBeLessThanOrEqual(1);
      expect(typeof out.brake).toBe('number');
      expect(typeof out.fire).toBe('boolean');
      expect(typeof out.useItem).toBe('boolean');
    }
  });

  test('difficulty affects throttle output', async () => {
    const { BotLogicService } = await importModule('ai/bot-logic.js');
    const path = [{ x: 100, z: 0 }];

    const easyAi = new BotLogicService();
    easyAi.setDifficulty('easy');
    easyAi.setPath(path);

    const expertAi = new BotLogicService();
    expertAi.setDifficulty('expert');
    expertAi.setPath(path);

    // Heading directly toward target → max throttle for difficulty
    const easyOut = easyAi.think({ x: 0, z: 0, heading: Math.atan2(100, 0), speed: 0 });
    const expertOut = expertAi.think({ x: 0, z: 0, heading: Math.atan2(100, 0), speed: 0 });

    expect(expertOut.throttle).toBeGreaterThanOrEqual(easyOut.throttle);
  });

  test('empty path produces bounded output', async () => {
    const { BotLogicService } = await importModule('ai/bot-logic.js');
    const ai = new BotLogicService();
    ai.setPath([]);
    const out = ai.think({ x: 0, z: 0, heading: 0, speed: 5 });
    expect(out.throttle).toBeGreaterThanOrEqual(0);
    expect(out.steer).toBeGreaterThanOrEqual(-1);
    expect(out.steer).toBeLessThanOrEqual(1);
  });

  test('decision tree respects hasWeapon context', async () => {
    const { BotLogicService } = await importModule('ai/bot-logic.js');
    const ai = new BotLogicService();
    ai.setDifficulty('expert');
    ai.setPath([{ x: 10, z: 0 }]);

    // Without weapon → no fire/useItem
    const noWeapon = ai.think({ x: 0, z: 0, heading: 0, speed: 10 }, { hasWeapon: false, distToPlayer: 5 });
    expect(noWeapon.useItem).toBe(false);
  });
});

test.describe('Phase 14 — Weapon Inventory', () => {

  test('equip and fire projectile weapon', async () => {
    const { WeaponInventory } = await importModule('weapons/weapon-inventory.js');
    const inv = new WeaponInventory();
    const slot = inv.getSlot('player');

    slot.equip('missile');
    expect(slot.canFire()).toBe(true);

    const result = slot.fire({ x: 0, y: 1, z: 0, heading: 0 }, 'enemy');
    expect(result).not.toBeNull();
    expect(result.type).toBe('homing');
    expect(result.targetId).toBe('enemy');
    expect(slot.weaponId).toBeNull(); // Consumed
  });

  test('cooldown prevents immediate re-fire', async () => {
    const { WeaponInventory } = await importModule('weapons/weapon-inventory.js');
    const inv = new WeaponInventory();
    const slot = inv.getSlot('player');

    slot.equip('bowling_ball');
    slot.fire({ x: 0, y: 1, z: 0, heading: 0 });

    // Re-equip immediately
    slot.equip('bowling_ball');
    expect(slot.canFire()).toBe(false); // Still on cooldown

    // Tick past cooldown
    slot.update(1.0);
    expect(slot.canFire()).toBe(true);
  });

  test('buff items provide boost factor', async () => {
    const { WeaponInventory } = await importModule('weapons/weapon-inventory.js');
    const inv = new WeaponInventory();
    const slot = inv.getSlot('player');

    slot.equip('zipper');
    const result = slot.fire({ x: 0, y: 0, z: 0, heading: 0 });
    expect(result.type).toBe('buff');
    expect(slot.hasBoost()).toBe(true);
    expect(slot.getBoostFactor()).toBeGreaterThan(1);

    // Tick past buff duration
    for (let i = 0; i < 200; i++) slot.update(0.05);
    expect(slot.hasBoost()).toBe(false);
    expect(slot.getBoostFactor()).toBe(1.0);
  });

  test('shield item blocks damage', async () => {
    const { WeaponInventory } = await importModule('weapons/weapon-inventory.js');
    const inv = new WeaponInventory();
    const slot = inv.getSlot('player');

    slot.equip('shield');
    slot.fire({ x: 0, y: 0, z: 0, heading: 0 });
    expect(slot.hasShield()).toBe(true);
  });

  test('trap item emits behind kart', async () => {
    const { WeaponInventory } = await importModule('weapons/weapon-inventory.js');
    const inv = new WeaponInventory();
    const slot = inv.getSlot('player');

    slot.equip('banana');
    const result = slot.fire({ x: 10, y: 0, z: 10, heading: 0 });
    expect(result.type).toBe('trap');
    expect(result.weaponId).toBe('banana');
    // Trap should be placed behind the kart (z offset)
    expect(result.z).toBeLessThan(10);
  });

  test('drawWeapon returns valid weapon for all position ratios', async () => {
    const { drawWeapon, WEAPON_DEFS } = await importModule('weapons/weapon-inventory.js');
    const validIds = Object.keys(WEAPON_DEFS);

    for (const ratio of [0, 0.25, 0.5, 0.75, 1.0]) {
      const { id, def } = drawWeapon(ratio);
      expect(validIds).toContain(id);
      expect(def).toBeDefined();
      expect(def.name).toBeTruthy();
    }
  });
});

test.describe('Phase 14 — Mode Factory', () => {

  test('createRebuildMode maps all known mode IDs', async () => {
    const { createRebuildMode } = await importModeClasses();

    const modeIds = [
      'normal_race', 'quick_race', 'time_trial', 'grand_prix',
      'free_roam', 'follow_the_leader', 'soccer',
      'battle_solo', 'three_strikes', 'ctf',
      'local_2p_race', 'local_2p_battle',
    ];

    for (const modeId of modeIds) {
      const mode = createRebuildMode(modeId, {});
      expect(mode).toBeDefined();
      expect(typeof mode.init).toBe('function');
      expect(typeof mode.id).toBe('string');
    }
  });

  test('unknown mode ID falls back to QuickRaceMode', async () => {
    const { createRebuildMode } = await importModeClasses();
    const mode = createRebuildMode('nonexistent_mode_xyz', {});
    expect(mode.id).toBe('quick_race');
  });
});

test.describe('Phase 14 — Mode Integration', () => {

  test('NormalRaceMode init/update/destroy full lifecycle', async () => {
    const { ModeManager, NormalRaceMode } = await importModeClasses();

    let raceInited = false, raceUpdated = 0, raceDisposed = false;
    const deps = {
      raceSystems: {
        initRace: () => { raceInited = true; },
        updateRace: () => { raceUpdated++; },
        updateBots: () => {},
        updateItems: () => {},
        isFinished: () => false,
        disposeRace: () => { raceDisposed = true; },
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: { laps: 3 },
    };

    const mgr = new ModeManager();
    await mgr.switchMode(new NormalRaceMode(deps));
    expect(raceInited).toBe(true);

    mgr.update(1/60);
    mgr.update(1/60);
    expect(raceUpdated).toBeGreaterThan(0);

    await mgr.dispose();
    expect(raceDisposed).toBe(true);
  });

  test('BattleMode supports all 3 variants', async () => {
    const { BattleMode } = await importModeClasses();

    for (const variant of ['deathmatch', 'three_strikes', 'ctf']) {
      const mode = new BattleMode({}, variant);
      expect(mode.id).toBe(`battle_${variant}`);
      expect(mode.variant).toBe(variant);
    }
  });

  test('TimeTrialMode starts ghost recording on init', async () => {
    const { TimeTrialMode } = await importModeClasses();

    let ghostStarted = false;
    const deps = {
      raceSystems: { initRace: () => {}, updateRace: () => {}, disposeRace: () => {} },
      ghost: {
        startRecording: () => { ghostStarted = true; },
        spawnBestGhost: () => {},
        recordFrame: () => {},
        updatePlayback: () => {},
        stopRecording: () => {},
        dispose: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: {},
    };

    const mode = new TimeTrialMode(deps);
    await mode.init();
    expect(ghostStarted).toBe(true);
    await mode.destroy();
  });

  test('GrandPrixMode starts cup and reports results', async () => {
    const { GrandPrixMode } = await importModeClasses();

    let gpStarted = false, resultReported = false;
    const deps = {
      raceSystems: {
        initRace: () => {},
        updateRace: () => {},
        updateBots: () => {},
        updateItems: () => {},
        isFinished: () => true,
        getResult: () => ({ playerPosition: 1 }),
        disposeRace: () => {},
      },
      grandPrix: {
        start: () => { gpStarted = true; },
        getCurrentRaceInfo: () => ({ trackId: 'test', raceNumber: 1, laps: 3 }),
        reportRaceResult: () => { resultReported = true; },
        hasNextRace: () => false,
        showFinalResults: () => {},
        getStandings: () => [{ name: 'Player', score: 10 }],
        end: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: {},
    };

    const mode = new GrandPrixMode(deps);
    await mode.init();
    expect(gpStarted).toBe(true);
    mode.update(1/60);
    expect(resultReported).toBe(true);
    expect(mode.finished).toBe(true);
    await mode.destroy();
  });

  test('SoccerMode init creates field and updates', async () => {
    const { SoccerMode } = await importModeClasses();

    let soccerInited = false;
    const deps = {
      soccer: {
        init: () => { soccerInited = true; },
        update: () => ({ finished: false }),
        getScore: () => ({ red: 0, blue: 0 }),
        dispose: () => {},
      },
      raceSystems: { initRace: () => {}, updateBots: () => {}, disposeRace: () => {} },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: {},
    };

    const mode = new SoccerMode(deps);
    await mode.init();
    expect(soccerInited).toBe(true);
    mode.update(1/60);
    await mode.destroy();
  });

  test('FollowTheLeaderMode initializes FTL system', async () => {
    const { FollowTheLeaderMode } = await importModeClasses();

    let ftlInited = false;
    const deps = {
      raceSystems: {
        initRace: () => {},
        updateRace: () => {},
        updateBots: () => {},
        updateItems: () => {},
        getStandings: () => [],
        bots: [],
        disposeRace: () => {},
      },
      followTheLeader: {
        init: () => { ftlInited = true; },
        update: () => ({}),
        getStatus: () => ({}),
        dispose: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: {},
    };

    const mode = new FollowTheLeaderMode(deps);
    await mode.init();
    expect(ftlInited).toBe(true);
    mode.update(1/60);
    await mode.destroy();
  });

  test('FreeRoamMode runs without race constraints', async () => {
    const { FreeRoamMode } = await importModeClasses();

    let driveInited = false;
    const deps = {
      driveSystems: {
        init: () => { driveInited = true; },
        update: () => {},
        dispose: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
    };

    const mode = new FreeRoamMode(deps);
    await mode.init();
    expect(driveInited).toBe(true);
    mode.update(1/60);
    await mode.destroy();
  });

  test('LocalSplitScreenMode initializes split + race', async () => {
    const { LocalSplitScreenMode } = await importModeClasses();

    let splitInited = false, raceInited = false;
    const deps = {
      splitScreen: {
        init: (cfg) => { splitInited = true; expect(cfg.players).toBe(2); },
        update: () => {},
        dispose: () => {},
      },
      raceSystems: {
        initRace: () => { raceInited = true; },
        updateRace: () => {},
        updateBots: () => {},
        updateItems: () => {},
        isFinished: () => false,
        disposeRace: () => {},
      },
      hud: { showToast: () => {}, setModeInfo: () => {} },
      gameConfig: {},
    };

    const mode = new LocalSplitScreenMode(deps);
    await mode.init();
    expect(splitInited).toBe(true);
    expect(raceInited).toBe(true);
    mode.update(1/60);
    await mode.destroy();
  });
});
