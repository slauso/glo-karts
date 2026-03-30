import assert from 'node:assert/strict';

import { handleFireWeapon } from '../src/combat.js';

function createPlayer(overrides = {}) {
  return {
    id: 'attacker',
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    rw: 1,
    health: 100,
    weapon: 'glo_burst',
    ammo: 100,
    fireCooldown: 0,
    overheated: false,
    overheat: 0,
    weapon2: 'crimson_hydra',
    ammo2: 1,
    fireCooldown2: 0,
    weapon3: '',
    ammo3: 0,
    ...overrides,
  };
}

function createTarget(overrides = {}) {
  return {
    id: 'target',
    x: 0,
    y: 0,
    z: 20,
    vx: 0,
    vy: 0,
    vz: 0,
    health: 100,
    ...overrides,
  };
}

function fireHydra(lockStrength, lockLocked = false) {
  const attacker = createPlayer();
  const target = createTarget();
  const entitiesMap = new Map();
  const playersMap = new Map([
    [attacker.id, attacker],
    [target.id, target],
  ]);

  const result = handleFireWeapon(attacker, entitiesMap, playersMap, {
    slot: 'secondary',
    fireInput: {
      dirX: 0,
      dirY: 0,
      dirZ: 1,
      targetId: target.id,
      lockStrength,
      lockLocked,
    },
  });

  assert(result, 'Hydra shot should produce a result');
  assert(result.projectile, 'Hydra shot should create a primary projectile');
  assert.equal(result.extraProjectiles?.length, 2, 'Hydra shot should create two extra projectiles');

  const volley = [result.projectile, ...(result.extraProjectiles || [])];
  const guidedCount = volley.filter((projectile) => projectile.targetId === target.id).length;

  return {
    guidedCount,
    volleyCount: volley.length,
    ammo2: attacker.ammo2,
    weapon2: attacker.weapon2,
    projectileIds: volley.map((projectile) => projectile.id),
  };
}

function run() {
  const scenarios = [
    { name: 'no_lock', lockStrength: 0, lockLocked: false, expectedGuided: 0 },
    { name: 'green_lock', lockStrength: 0.2, lockLocked: false, expectedGuided: 1 },
    { name: 'amber_lock', lockStrength: 0.7, lockLocked: false, expectedGuided: 2 },
    { name: 'red_lock', lockStrength: 1, lockLocked: true, expectedGuided: 3 },
  ];

  const summary = {};

  for (const scenario of scenarios) {
    const outcome = fireHydra(scenario.lockStrength, scenario.lockLocked);
    assert.equal(outcome.volleyCount, 3, `${scenario.name}: expected a 3-missile volley`);
    assert.equal(outcome.guidedCount, scenario.expectedGuided, `${scenario.name}: guided missile count mismatch`);
    assert.equal(outcome.ammo2, 0, `${scenario.name}: hydra ammo should be consumed`);
    assert.equal(outcome.weapon2, '', `${scenario.name}: hydra slot should clear after single-use ammo is spent`);
    summary[scenario.name] = outcome;
  }

  console.log('HYDRA_LOCK_REGRESSION', JSON.stringify({ ok: true, summary }, null, 2));
}

try {
  run();
} catch (error) {
  console.error('HYDRA_LOCK_REGRESSION', JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exit(1);
}