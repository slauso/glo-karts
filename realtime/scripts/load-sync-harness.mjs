import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Client } from 'colyseus.js';
import { BATTLE_WEAPON_POOL } from '../src/combat.js';

const ROOM_STATE = 14;
const ROOM_STATE_PATCH = 15;

const endpoint = process.env.COLYSEUS_URL || 'ws://127.0.0.1:2567';
const roomName = process.env.COLYSEUS_ROOM || 'battle_room';
const liveDurationMs = Number(process.env.SYNC_HARNESS_LIVE_MS || 12000);
const cliArgs = new Map(
  process.argv.slice(2)
    .filter((arg) => arg.startsWith('--'))
    .map((arg) => {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      return [rawKey, rest.join('=') || 'true'];
    }),
);
const runLabel = cliArgs.get('label') || process.env.SYNC_HARNESS_LABEL || '';
const jsonOutputPath = cliArgs.get('json') || process.env.SYNC_HARNESS_OUTPUT_JSON || '';
const csvOutputPath = cliArgs.get('csv') || process.env.SYNC_HARNESS_OUTPUT_CSV || '';
const anomalyDriveEnabled = (cliArgs.get('anomalyDrive') || process.env.SYNC_HARNESS_ANOMALY_DRIVE || 'true') !== 'false';
const gloFluxApocalypseEnabled = (cliArgs.get('glofluxApocalypse') || process.env.SYNC_HARNESS_GLOFLUX_APOCALYPSE || 'false') === 'true';
const asymmetricBattleEnabled = (cliArgs.get('asymmetricBattle') || process.env.SYNC_HARNESS_ASYMMETRIC_BATTLE || 'true') !== 'false';
const forceBattleGrantsEnabled = (cliArgs.get('forceBattleGrants') || process.env.SYNC_HARNESS_FORCE_BATTLE_GRANTS || 'true') !== 'false';
const scenarios = (process.env.SYNC_HARNESS_COUNTS || '2,6,12')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value >= 2);

const ANOMALY_WEAPON_ROTATION = ['pirateleportation', 'mirror_realm', 'phase_shift', 'gravity_well', 'weather_dominion'];
const ANOMALY_EFFECT_TYPES = new Set(['mirror', 'phased', 'arena_fog', 'arena_rain']);
const BATTLE_TEST_WEAPON_ROTATION = [...BATTLE_WEAPON_POOL];
const BATTLE_OFFENSE_ROTATION = ['lightning_bolt', 'rock_barrage', 'fireball', 'ice_lance', 'wind_slash', 'super_nova', 'toxic_spread', 'tornado'];
const BATTLE_DEFENSE_ROTATION = ['shield', 'phase_shift', 'mirror_realm', 'ludicrous_mode', 'toxic_cloud', 'weather_dominion'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)));
  return sorted[index];
}

function getHeading(player = {}) {
  if (Number.isFinite(player.heading)) return player.heading;
  const rw = Number(player.rw ?? 1);
  const ry = Number(player.ry ?? 0);
  return Math.atan2(2 * rw * ry, 1 - 2 * ry * ry);
}

function distanceSq(a, b) {
  const dx = (a?.x || 0) - (b?.x || 0);
  const dz = (a?.z || 0) - (b?.z || 0);
  return dx * dx + dz * dz;
}

function normalizeAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toCsvValue(value) {
  const stringValue = String(value ?? '');
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function payloadBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload || {}), 'utf8');
}

function incrementCounter(map, key, amount = 1) {
  map[key] = Number(map[key] || 0) + amount;
}

function buildFirePayload(state, sessionId) {
  const self = state?.players?.get(sessionId);
  if (!self) return {};

  const opponents = Array.from(state?.players?.values?.() || []).filter((player) => player.id !== sessionId);
  const target = opponents.reduce((best, player) => {
    return !best || distanceSq(self, player) < distanceSq(self, best) ? player : best;
  }, null);

  const fallbackHeading = getHeading(self);
  const dx = (target?.x ?? (self.x + Math.sin(fallbackHeading) * 10)) - self.x;
  const dz = (target?.z ?? (self.z + Math.cos(fallbackHeading) * 10)) - self.z;
  const dy = target
    ? Math.max(-0.15, Math.min(0.2, ((target.y || self.y) - self.y) / Math.max(1, Math.sqrt(dx * dx + dz * dz))))
    : 0;
  const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz + dy * dy));
  const dirX = dx / len;
  const dirY = dy / len;
  const dirZ = dz / len;

  return {
    originX: self.x + dirX * 2.8,
    originY: self.y + 1.0 + Math.max(0, dirY) * 1.2,
    originZ: self.z + dirZ * 2.8,
    dirX,
    dirY,
    dirZ,
  };
}

function buildRealtimeInputPayload(state, sessionId, seq, command) {
  const self = state?.players?.get(sessionId);
  const heading = getHeading(self);
  const halfHeading = heading * 0.5;

  return {
    seq,
    throttle: command.throttle,
    steer: command.steer,
    brake: command.brake,
    drift: command.brake > 0.75,
    fire: false,
    x: Number(self?.x || 0),
    y: Number(self?.y || 2.5),
    z: Number(self?.z || 0),
    rx: Number(self?.rx || 0),
    ry: Number.isFinite(Number(self?.ry)) ? Number(self.ry) : Math.sin(halfHeading),
    rz: Number(self?.rz || 0),
    rw: Number.isFinite(Number(self?.rw)) ? Number(self.rw) : Math.cos(halfHeading),
  };
}

function getBattleRole(index, count) {
  if (!asymmetricBattleEnabled || roomName !== 'battle_room' || count < 2) {
    return { name: chooseBehavior(index), pursuitBias: 1, retreatBias: 0, preferredWeapons: BATTLE_TEST_WEAPON_ROTATION };
  }
  if (index === 0) {
    return {
      name: 'predator',
      pursuitBias: 1.4,
      retreatBias: 0,
      preferredWeapons: BATTLE_OFFENSE_ROTATION,
      aggressiveFireRange: 30,
      aggressiveAimTolerance: 0.82,
    };
  }
  return {
    name: 'prey',
    pursuitBias: 0.55,
    retreatBias: 1.1,
    preferredWeapons: BATTLE_DEFENSE_ROTATION,
    aggressiveFireRange: 18,
    aggressiveAimTolerance: 0.45,
  };
}

async function writeHarnessReport(filePath, content) {
  const resolvedPath = resolve(filePath);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, content, 'utf8');
  console.log(`[load-sync] wrote ${resolvedPath}`);
}

async function maybeWriteReports(results) {
  const generatedAt = new Date().toISOString();
  if (jsonOutputPath) {
    const jsonPayload = {
      label: runLabel,
      generatedAt,
      endpoint,
      roomName,
      liveDurationMs,
      scenarios,
      results,
    };
    await writeHarnessReport(jsonOutputPath, `${JSON.stringify(jsonPayload, null, 2)}\n`);
  }

  if (csvOutputPath) {
    const headers = [
      'label', 'generatedAt', 'roomName', 'endpoint', 'players',
      'patchAvg', 'patchP95', 'patchMax', 'patchSamples',
      'fullStateAvg', 'fullStateMax', 'fullStateSamples',
      'rttAvg', 'rttP95', 'rttMax', 'rttSamples',
      'avgTickDriftMs', 'avgInputAgeMs', 'maxInputAgeMs',
      'staleInputDrops', 'outOfOrderInputDrops', 'patchRateMs', 'authoritative', 'metricSamples',
      'battlePickups', 'battleShots', 'battleHits', 'battleDamageDealt', 'battleDamageTaken',
      'battleKills', 'battleDeaths', 'battleEffectsApplied', 'battleEffectsTaken',
      'battleShieldsBlocked', 'battleShotsBlocked',
      'anomalyEvents', 'anomalyPayloadBytes', 'anomalyProjectilesFired', 'anomalyProjectileHits',
      'anomalyEffectsApplied', 'arenaEffectsApplied', 'apocalypseBursts', 'anomalyCoreCollections', 'anomalyChainBursts',
    ];
    const rows = results.map((result) => ([
      runLabel,
      generatedAt,
      result.roomName,
      result.endpoint,
      result.players,
      result.patchBytes.avg,
      result.patchBytes.p95,
      result.patchBytes.max,
      result.patchBytes.samples,
      result.fullStateBytes.avg,
      result.fullStateBytes.max,
      result.fullStateBytes.samples,
      result.rttMs.avg,
      result.rttMs.p95,
      result.rttMs.max,
      result.rttMs.samples,
      result.serverMetrics.avgTickDriftMs,
      result.serverMetrics.avgInputAgeMs,
      result.serverMetrics.maxInputAgeMs,
      result.serverMetrics.staleInputDrops,
      result.serverMetrics.outOfOrderInputDrops,
      result.serverMetrics.patchRateMs,
      result.serverMetrics.authoritative,
      result.serverMetrics.samples,
      result.battleMetrics.pickups,
      result.battleMetrics.shotsFired,
      result.battleMetrics.hitsLanded,
      result.battleMetrics.damageDealt,
      result.battleMetrics.damageTaken,
      result.battleMetrics.kills,
      result.battleMetrics.deaths,
      result.battleMetrics.effectsApplied,
      result.battleMetrics.effectsTaken,
      result.battleMetrics.shieldsBlocked,
      result.battleMetrics.shotsBlocked,
      result.anomalyEvents.total,
      result.anomalyEvents.payloadBytes,
      result.serverMetrics.anomalyProjectilesFired,
      result.serverMetrics.anomalyProjectileHits,
      result.serverMetrics.anomalyEffectsApplied,
      result.serverMetrics.arenaEffectsApplied,
      result.serverMetrics.apocalypseBursts,
      result.serverMetrics.anomalyCoreCollections,
      result.serverMetrics.anomalyChainBursts,
    ].map(toCsvValue).join(',')));
    await writeHarnessReport(csvOutputPath, `${headers.join(',')}\n${rows.join('\n')}\n`);
  }
}

function chooseBehavior(index) {
  const behaviors = ['orbit', 'aggressive', 'collector', 'erratic'];
  return behaviors[index % behaviors.length];
}

function computeDriveCommand(room, state, behavior, index, role = null) {
  if (roomName === 'gloflux') {
    return computeGloFluxDriveCommand(room, state, behavior, index);
  }

  const self = state?.players?.get(room.sessionId);
  if (!self) {
    return { throttle: 0, steer: 0, brake: 0, fire: false, pickupEntityId: null };
  }

  const entities = state?.entities ? Array.from(state.entities.values()) : [];
  const activeBoxes = entities.filter((entity) => entity.type === 'item_box' && entity.active);
  const otherPlayers = state?.players
    ? Array.from(state.players.values()).filter((player) => player.id !== room.sessionId)
    : [];
  const isArmed = !!(self.weapon && self.ammo > 0);

  let target = null;
  if (role?.name === 'prey' && otherPlayers.length) {
    const threat = otherPlayers.reduce((best, player) => {
      return !best || distanceSq(self, player) < distanceSq(self, best) ? player : best;
    }, null);
    if (threat) {
      const awayDx = (self.x || 0) - (threat.x || 0);
      const awayDz = (self.z || 0) - (threat.z || 0);
      target = { x: (self.x || 0) + awayDx * 1.8, z: (self.z || 0) + awayDz * 1.8 };
    }
  } else if (isArmed && otherPlayers.length) {
    target = otherPlayers.reduce((best, player) => {
      return !best || distanceSq(self, player) < distanceSq(self, best) ? player : best;
    }, null);
  } else if (behavior === 'collector' && activeBoxes.length) {
    target = activeBoxes.reduce((best, entity) => {
      return !best || distanceSq(self, entity) < distanceSq(self, best) ? entity : best;
    }, null);
  } else if (behavior === 'aggressive' && otherPlayers.length) {
    target = otherPlayers.reduce((best, player) => {
      return !best || distanceSq(self, player) < distanceSq(self, best) ? player : best;
    }, null);
  } else if (behavior === 'erratic') {
    const angle = (Date.now() / 1000) * (0.8 + (index % 3) * 0.2) + index;
    target = { x: Math.cos(angle) * 8, z: Math.sin(angle * 1.3) * 8 };
  } else {
    const angle = (Date.now() / 1000) * 0.45 + (index / Math.max(1, state.players.size)) * Math.PI * 2;
    target = { x: Math.cos(angle) * 14, z: Math.sin(angle) * 14 };
  }

  const dx = (target?.x || 0) - (self.x || 0);
  const dz = (target?.z || 0) - (self.z || 0);
  const targetHeading = Math.atan2(dx, dz);
  const headingError = normalizeAngle(targetHeading - getHeading(self));
  const steer = clamp(headingError / 1.1, -1, 1);
  const targetDistance = Math.sqrt(dx * dx + dz * dz);
  const pursuitBias = Number(role?.pursuitBias || 1);
  const retreatBias = Number(role?.retreatBias || 0);
  const throttle = isArmed && otherPlayers.length
    ? (targetDistance < 4 ? 0.35 + pursuitBias * 0.08 : Math.min(1, 0.7 + pursuitBias * 0.22))
    : (targetDistance < 2.5 ? 0.25 : 1);
  const brake = role?.name === 'prey'
    ? (targetDistance < 10 && Math.abs(steer) > 0.55 ? 1 : 0)
    : (behavior === 'erratic' && Math.abs(steer) > 0.75 ? 1 : 0);
  const pickupEntityId = activeBoxes.find((entity) => distanceSq(self, entity) <= 64)?.id || null;
  const fireRange = Number(role?.aggressiveFireRange || 24) + retreatBias * -4;
  const aimTolerance = Number(role?.aggressiveAimTolerance || 0.6);
  const fire = !!(self.weapon && self.ammo > 0 && targetDistance < fireRange && Math.abs(headingError) < aimTolerance);

  return { throttle, steer, brake, fire, pickupEntityId };
}

function computeGloFluxDriveCommand(room, state, behavior, index) {
  const self = state?.players?.get(room.sessionId);
  if (!self) {
    return { throttle: 0, steer: 0, brake: 0, fire: false, collectPowerIdx: null, debugCollectPowerIdx: null, apocalypse: false };
  }

  const activeSpawns = Array.from(state?.powerSpawns || [])
    .map((spawn, idx) => ({ ...spawn, idx }))
    .filter((spawn) => !spawn.collected);
  const otherPlayers = state?.players
    ? Array.from(state.players.values()).filter((player) => player.id !== room.sessionId && player.health > 0)
    : [];

  let target = null;
  if ((behavior === 'collector' || !otherPlayers.length) && activeSpawns.length) {
    target = activeSpawns.reduce((best, spawn) => {
      return !best || distanceSq(self, spawn) < distanceSq(self, best) ? spawn : best;
    }, null);
  } else if (otherPlayers.length) {
    target = otherPlayers.reduce((best, player) => {
      return !best || distanceSq(self, player) < distanceSq(self, best) ? player : best;
    }, null);
  } else {
    const angle = (Date.now() / 1000) * 0.55 + index;
    target = { x: Math.cos(angle) * 12, z: Math.sin(angle) * 12 };
  }

  const dx = (target?.x || 0) - (self.x || 0);
  const dz = (target?.z || 0) - (self.z || 0);
  const targetHeading = Math.atan2(dx, dz);
  const headingError = normalizeAngle(targetHeading - getHeading(self));
  const steer = clamp(headingError / 1.1, -1, 1);
  const targetDistance = Math.sqrt(dx * dx + dz * dz);
  const throttle = targetDistance < 2 ? 0.35 : 1;
  const brake = Math.abs(steer) > 0.82 ? 1 : 0;
  const collectPowerIdx = activeSpawns.find((spawn) => distanceSq(self, spawn) <= 25)?.idx ?? null;
  const apocalypse = gloFluxApocalypseEnabled && otherPlayers.length > 0 && (Date.now() + index * 700) % 4200 < 220;

  const debugCollectPowerIdx = activeSpawns[0]?.idx ?? null;

  return { throttle, steer, brake, fire: false, collectPowerIdx, debugCollectPowerIdx, apocalypse };
}

async function createSyntheticClient(index, count, partyCode, scenarioStats) {
  const client = new Client(endpoint);
  const room = await client.joinOrCreate(roomName, {
    playerName: `load-${count}-${index + 1}`,
    partyCode,
    maxPlayers: count,
    countdownMs: 1000,
    gameMode: roomName === 'battle_room' ? 'battle' : 'race',
    gameType: 'deathmatch',
    scoreLimit: 99,
  });

  const wireStats = { patchBytes: [], fullStateBytes: [], rtts: [] };
  const anomalyStats = {
    total: 0,
    payloadBytes: 0,
    projectileFired: 0,
    projectileHit: 0,
    effectApplied: 0,
    arenaEffectApplied: 0,
    apocalypseTriggered: 0,
  };
  const battleStats = {
    pickups: 0,
    shotsFired: 0,
    hitsLanded: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    deaths: 0,
    eliminations: 0,
    effectsApplied: 0,
    effectsTaken: 0,
    shieldsBlocked: 0,
    shotsBlocked: 0,
    pickupWeapons: {},
    weaponShots: {},
    weaponHits: {},
  };
  const ws = room.connection?.transport?.ws;
  if (ws) {
    const previousOnMessage = ws.onmessage;
    ws.onmessage = (event) => {
      const bytes = new Uint8Array(event.data);
      const packetType = bytes[0];
      if (packetType === ROOM_STATE_PATCH) wireStats.patchBytes.push(bytes.byteLength);
      if (packetType === ROOM_STATE) wireStats.fullStateBytes.push(bytes.byteLength);
      if (previousOnMessage) previousOnMessage.call(ws, event);
    };
  }

  room.onMessage('joined', () => {});
  room.onMessage('startSequence', () => {});
  room.onMessage('countdown', () => {});
  room.onMessage('matchLive', () => {});
  room.onMessage('gameOver', () => {});
  room.onMessage('itemReceived', (msg = {}) => {
    if (roomName !== 'battle_room') return;
    battleStats.pickups += 1;
    incrementCounter(battleStats.pickupWeapons, msg.weapon || 'unknown');
  });
  room.onMessage('powerGranted', () => {});
  room.onMessage('powerDenied', () => {});
  room.onMessage('arenaEffectCleared', () => {});
  room.onMessage('effectApplied', (msg = {}) => {
    if (roomName === 'battle_room') {
      if (msg.attackerId === room.sessionId) battleStats.effectsApplied += 1;
      if (msg.target === room.sessionId) battleStats.effectsTaken += 1;
    }
    if (!ANOMALY_EFFECT_TYPES.has(msg.type) && msg.target !== 'arena') return;
    anomalyStats.total += 1;
    anomalyStats.effectApplied += 1;
    anomalyStats.payloadBytes += payloadBytes(msg);
  });
  room.onMessage('projectileFired', (msg = {}) => {
    if (roomName === 'battle_room' && msg.ownerId === room.sessionId) {
      battleStats.shotsFired += 1;
      incrementCounter(battleStats.weaponShots, msg.subType || 'unknown');
    }
    if (msg.subType !== 'pirateleportation') return;
    anomalyStats.total += 1;
    anomalyStats.projectileFired += 1;
    anomalyStats.payloadBytes += payloadBytes(msg);
  });
  room.onMessage('projectileHit', (msg = {}) => {
    if (roomName === 'battle_room') {
      if (msg.attackerId === room.sessionId) {
        battleStats.hitsLanded += 1;
        battleStats.damageDealt += Number(msg.damage || 0);
        incrementCounter(battleStats.weaponHits, msg.subType || 'unknown');
      }
      if (msg.victimId === room.sessionId) {
        battleStats.damageTaken += Number(msg.damage || 0);
      }
    }
    if (msg.subType !== 'pirateleportation') return;
    anomalyStats.total += 1;
    anomalyStats.projectileHit += 1;
    anomalyStats.payloadBytes += payloadBytes(msg);
  });
  room.onMessage('shieldAbsorbed', (msg = {}) => {
    if (roomName !== 'battle_room') return;
    if (msg.victimId === room.sessionId) battleStats.shieldsBlocked += 1;
    if (msg.attackerId === room.sessionId) battleStats.shotsBlocked += 1;
  });
  room.onMessage('playerKilled', (msg = {}) => {
    if (roomName !== 'battle_room') return;
    if (msg.attackerId === room.sessionId) battleStats.kills += 1;
  });
  room.onMessage('playerDied', (msg = {}) => {
    if (roomName !== 'battle_room') return;
    if (msg.victimId === room.sessionId) battleStats.deaths += 1;
  });
  room.onMessage('playerEliminated', (msg = {}) => {
    if (roomName !== 'battle_room') return;
    if (msg.playerId === room.sessionId) battleStats.eliminations += 1;
  });
  room.onMessage('arenaEffectApplied', (msg = {}) => {
    anomalyStats.total += 1;
    anomalyStats.arenaEffectApplied += 1;
    anomalyStats.payloadBytes += payloadBytes(msg);
  });
  room.onMessage('apocalypseTriggered', (msg = {}) => {
    anomalyStats.total += 1;
    anomalyStats.apocalypseTriggered += 1;
    anomalyStats.payloadBytes += payloadBytes(msg);
  });

  room.onMessage('timeSync', (msg = {}) => {
    const sentAt = Number(msg.clientSentAt || 0);
    if (!sentAt) return;
    wireStats.rtts.push(Math.max(0, Date.now() - sentAt));
  });

  if (index === 0) {
    room.onMessage('syncMetricsSnapshot', (msg = {}) => {
      scenarioStats.metricSnapshots.push(msg);
    });
  }

  let seq = 0;
  let inputTimer = null;
  let timeSyncTimer = null;
  let actionTimer = null;
  let anomalyTimer = null;
  const role = roomName === 'battle_room' ? getBattleRole(index, count) : null;
  const behavior = roomName === 'gloflux' ? 'collector' : (role?.name || chooseBehavior(index));

  const start = () => {
    inputTimer = setInterval(() => {
      const command = computeDriveCommand(room, room.state, behavior, index, role);
      if (roomName === 'gloflux') {
        room.send('input', {
          f: command.throttle,
          s: command.steer,
          b: command.brake,
          p: null,
        });
      } else {
        room.send('input', buildRealtimeInputPayload(room.state, room.sessionId, ++seq, command));
      }
    }, 50);

    timeSyncTimer = setInterval(() => {
      room.send('timeSync', { clientSentAt: Date.now() });
      if (index === 0) room.send('syncMetricsRequest', {});
    }, 1000);

    actionTimer = setInterval(() => {
      const command = computeDriveCommand(room, room.state, behavior, index, role);
      if (roomName === 'gloflux') {
        if (Number.isInteger(command.collectPowerIdx)) {
          room.send('collectPower', { idx: command.collectPowerIdx });
        } else if (Number.isInteger(command.debugCollectPowerIdx)) {
          room.send('debugCollectPower', { idx: command.debugCollectPowerIdx });
        }
        if (command.apocalypse) {
          room.send('apocalypse', {});
        }
      } else if (command.pickupEntityId) {
        room.send('pickupItem', { entityId: command.pickupEntityId });
      }
      if (command.fire) {
        room.send('fireWeapon', buildFirePayload(room.state, room.sessionId));
      } else if (roomName === 'battle_room' && forceBattleGrantsEnabled) {
        const self = room.state?.players?.get(room.sessionId);
        const preferredWeapons = role?.preferredWeapons?.length ? role.preferredWeapons : BATTLE_TEST_WEAPON_ROTATION;
        if ((!self?.weapon || Number(self?.ammo || 0) <= 0) && preferredWeapons.length) {
          const cadence = role?.name === 'predator' ? 900 : 1800;
          const rotationIndex = Math.floor((Date.now() + index * 350) / cadence) % preferredWeapons.length;
          room.send('debugGrantWeapon', {
            weaponId: preferredWeapons[rotationIndex],
            targetId: room.sessionId,
          });
        }
      }
    }, role?.name === 'predator' ? 120 : 200);

    if (anomalyDriveEnabled && roomName === 'battle_room' && index === 0) {
      anomalyTimer = setInterval(() => {
        const rotationIndex = Math.floor(Date.now() / 1800) % ANOMALY_WEAPON_ROTATION.length;
        room.send('debugGrantWeapon', {
          weaponId: ANOMALY_WEAPON_ROTATION[rotationIndex],
          targetId: room.sessionId,
        });
        room.send('fireWeapon', buildFirePayload(room.state, room.sessionId));
      }, 1800);
    }
  };

  const stop = async () => {
    clearInterval(inputTimer);
    clearInterval(timeSyncTimer);
    clearInterval(actionTimer);
    clearInterval(anomalyTimer);

    const leavePromise = room.leave().catch(() => undefined);
    await Promise.race([leavePromise, sleep(1000)]);

    const ws = room.connection?.transport?.ws;
    if (ws && ws.readyState < 2) {
      ws.close();
    }
  };

  return { room, wireStats, anomalyStats, battleStats, role: role?.name || behavior, start, stop };
}

async function runScenario(count) {
  const partyCode = `load-${count}-${Date.now().toString(36)}`;
  const scenarioStats = { metricSnapshots: [] };
  const clients = [];

  for (let index = 0; index < count; index += 1) {
    clients.push(await createSyntheticClient(index, count, partyCode, scenarioStats));
  }

  const host = clients[0];
  const livePromise = new Promise((resolve) => {
    host.room.onMessage('matchLive', () => resolve());
  });

  clients.forEach((client) => client.start());
  host.room.send('triggerStart', {});
  await livePromise;
  await sleep(liveDurationMs);

  for (const client of clients) {
    await client.stop();
  }

  const patchBytes = clients.flatMap((client) => client.wireStats.patchBytes);
  const fullStateBytes = clients.flatMap((client) => client.wireStats.fullStateBytes);
  const rtts = clients.flatMap((client) => client.wireStats.rtts);
  const metricSnapshots = scenarioStats.metricSnapshots;
  const battleMetrics = clients.reduce((acc, client) => {
    acc.pickups += client.battleStats.pickups;
    acc.shotsFired += client.battleStats.shotsFired;
    acc.hitsLanded += client.battleStats.hitsLanded;
    acc.damageDealt += client.battleStats.damageDealt;
    acc.damageTaken += client.battleStats.damageTaken;
    acc.kills += client.battleStats.kills;
    acc.deaths += client.battleStats.deaths;
    acc.eliminations += client.battleStats.eliminations;
    acc.effectsApplied += client.battleStats.effectsApplied;
    acc.effectsTaken += client.battleStats.effectsTaken;
    acc.shieldsBlocked += client.battleStats.shieldsBlocked;
    acc.shotsBlocked += client.battleStats.shotsBlocked;
    for (const [weapon, countValue] of Object.entries(client.battleStats.pickupWeapons)) {
      incrementCounter(acc.pickupWeapons, weapon, countValue);
    }
    for (const [weapon, countValue] of Object.entries(client.battleStats.weaponShots)) {
      incrementCounter(acc.weaponShots, weapon, countValue);
    }
    for (const [weapon, countValue] of Object.entries(client.battleStats.weaponHits)) {
      incrementCounter(acc.weaponHits, weapon, countValue);
    }
    return acc;
  }, {
    pickups: 0,
    shotsFired: 0,
    hitsLanded: 0,
    damageDealt: 0,
    damageTaken: 0,
    kills: 0,
    deaths: 0,
    eliminations: 0,
    effectsApplied: 0,
    effectsTaken: 0,
    shieldsBlocked: 0,
    shotsBlocked: 0,
    pickupWeapons: {},
    weaponShots: {},
    weaponHits: {},
  });
  const anomalyEvents = clients.reduce((acc, client) => {
    acc.total += client.anomalyStats.total;
    acc.payloadBytes += client.anomalyStats.payloadBytes;
    acc.projectileFired += client.anomalyStats.projectileFired;
    acc.projectileHit += client.anomalyStats.projectileHit;
    acc.effectApplied += client.anomalyStats.effectApplied;
    acc.arenaEffectApplied += client.anomalyStats.arenaEffectApplied;
    acc.apocalypseTriggered += client.anomalyStats.apocalypseTriggered;
    return acc;
  }, {
    total: 0,
    payloadBytes: 0,
    projectileFired: 0,
    projectileHit: 0,
    effectApplied: 0,
    arenaEffectApplied: 0,
    apocalypseTriggered: 0,
  });
  const clientSummaries = clients.map((client, index) => ({
    index,
    role: client.role,
    pickups: client.battleStats.pickups,
    shotsFired: client.battleStats.shotsFired,
    hitsLanded: client.battleStats.hitsLanded,
    damageDealt: client.battleStats.damageDealt,
    damageTaken: client.battleStats.damageTaken,
    kills: client.battleStats.kills,
    deaths: client.battleStats.deaths,
    effectsApplied: client.battleStats.effectsApplied,
    effectsTaken: client.battleStats.effectsTaken,
    pickupWeapons: client.battleStats.pickupWeapons,
    weaponShots: client.battleStats.weaponShots,
    weaponHits: client.battleStats.weaponHits,
  }));

  return {
    players: count,
    roomName,
    endpoint,
    patchBytes: {
      avg: Number(average(patchBytes).toFixed(2)),
      p95: Number(percentile(patchBytes, 0.95).toFixed(2)),
      max: Number((Math.max(...patchBytes, 0)).toFixed(2)),
      samples: patchBytes.length,
    },
    fullStateBytes: {
      avg: Number(average(fullStateBytes).toFixed(2)),
      max: Number((Math.max(...fullStateBytes, 0)).toFixed(2)),
      samples: fullStateBytes.length,
    },
    rttMs: {
      avg: Number(average(rtts).toFixed(2)),
      p95: Number(percentile(rtts, 0.95).toFixed(2)),
      max: Number((Math.max(...rtts, 0)).toFixed(2)),
      samples: rtts.length,
    },
    serverMetrics: {
      avgTickDriftMs: Number(average(metricSnapshots.map((snapshot) => Number(snapshot.avgTickDriftMs || 0))).toFixed(2)),
      avgInputAgeMs: Number(average(metricSnapshots.map((snapshot) => Number(snapshot.avgInputAgeMs || 0))).toFixed(2)),
      maxInputAgeMs: Number(Math.max(...metricSnapshots.map((snapshot) => Number(snapshot.maxInputAgeMs || 0)), 0).toFixed(2)),
      staleInputDrops: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].staleInputDrops || 0 : 0,
      outOfOrderInputDrops: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].outOfOrderInputDrops || 0 : 0,
      anomalyProjectilesFired: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].anomalyProjectilesFired || 0 : 0,
      anomalyProjectileHits: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].anomalyProjectileHits || 0 : 0,
      anomalyEffectsApplied: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].anomalyEffectsApplied || 0 : 0,
      arenaEffectsApplied: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].arenaEffectsApplied || 0 : 0,
      apocalypseBursts: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].apocalypseBursts || 0 : 0,
      anomalyCoreCollections: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].anomalyCoreCollections || 0 : 0,
      anomalyChainBursts: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].anomalyChainBursts || 0 : 0,
      patchRateMs: metricSnapshots.length ? metricSnapshots[metricSnapshots.length - 1].patchRateMs || 0 : 0,
      authoritative: metricSnapshots.length ? !!metricSnapshots[metricSnapshots.length - 1].authoritative : false,
      samples: metricSnapshots.length,
    },
    battleMetrics,
    clientSummaries,
    anomalyEvents,
  };
}

const results = [];
for (const count of scenarios) {
  console.log(`\n[load-sync] starting scenario for ${count} players on ${roomName}`);
  results.push(await runScenario(count));
}

console.log('\n[load-sync] summary');
console.table(results.map((result) => ({
  players: result.players,
  patchAvg: result.patchBytes.avg,
  patchP95: result.patchBytes.p95,
  tickDriftAvg: result.serverMetrics.avgTickDriftMs,
  inputAgeAvg: result.serverMetrics.avgInputAgeMs,
  rttAvg: result.rttMs.avg,
  pickups: result.battleMetrics.pickups,
  shots: result.battleMetrics.shotsFired,
  hits: result.battleMetrics.hitsLanded,
  damage: result.battleMetrics.damageDealt,
  kills: result.battleMetrics.kills,
  anomalyEvents: result.anomalyEvents.total,
  anomalyBytes: result.anomalyEvents.payloadBytes,
  coreCollections: result.serverMetrics.anomalyCoreCollections,
  chainBursts: result.serverMetrics.anomalyChainBursts,
  authoritative: result.serverMetrics.authoritative,
})));
console.log(JSON.stringify(results, null, 2));
await maybeWriteReports(results);
