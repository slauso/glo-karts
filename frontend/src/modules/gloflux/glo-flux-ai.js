/**
 * glo-flux-ai.js — Bot AI for gloFLUX mode.
 *
 * Bots that:
 *   - Navigate toward power-up spawns
 *   - Seek synergy-completing power-ups when possible
 *   - Avoid hazard zones and boundary edge
 *   - Use collected powers strategically
 *   - Mutation-aware targeting (prioritize high-tier players)
 *   - Basic obstacle avoidance
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { detectSynergies, FAMILY } from './glo-flux-powers.js';
import { MUTATION_TIER } from './glo-flux-mutations.js';

// ── Bot Personality Presets ─────────────────────────────────────────────────

const PERSONALITIES = [
  { name: 'Aggressive',   aggressiveness: 0.9, synAwareness: 0.3, survivalBias: 0.2 },
  { name: 'Collector',    aggressiveness: 0.3, synAwareness: 0.9, survivalBias: 0.5 },
  { name: 'Survivor',     aggressiveness: 0.4, synAwareness: 0.5, survivalBias: 0.9 },
  { name: 'Balanced',     aggressiveness: 0.6, synAwareness: 0.6, survivalBias: 0.6 },
  { name: 'Chaotic',      aggressiveness: 0.7, synAwareness: 0.2, survivalBias: 0.3 },
];

// ── Fleet Creation ──────────────────────────────────────────────────────────

/**
 * Create a bot fleet from an array of bot player objects.
 * @param {object[]} botPlayers - Array of player objects with {id, mesh, powerState, ...}
 * @param {object} arenaData - Arena data with hazardZones, spawnPoints, etc.
 * @returns {object} Fleet state
 */
export function createBotFleet(botPlayers, arenaData) {
  const bots = botPlayers.map((player, i) => ({
    playerId: player.id,
    personality: PERSONALITIES[i % PERSONALITIES.length],
    targetPos: null,
    targetType: null,    // 'power' | 'enemy' | 'wander' | 'flee'
    steerAngle: 0,
    throttle: 0,
    lastDecisionTime: 0,
    decisionInterval: 1.5 + Math.random() * 1.0, // seconds between AI decisions
    wanderAngle: Math.random() * Math.PI * 2,
  }));

  return {
    bots,
    arenaData,
    hazardCenters: (arenaData.hazardZones || []).map(h => h.center),
  };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Tick all bots.
 * @param {object} fleet - Fleet state from createBotFleet
 * @param {object[]} allPlayers - All players (bots + local)
 * @param {object[]} powerSpawns - Current power-up spawns
 * @param {number} dt - Delta time seconds
 * @param {number} now - Current timestamp
 */
export function tickBots(fleet, allPlayers, powerSpawns, dt, now) {
  for (const bot of fleet.bots) {
    const player = allPlayers.find(p => p.id === bot.playerId);
    if (!player || !player.alive) continue;

    // Decision-making at intervals
    const timeSinceDecision = (now - bot.lastDecisionTime) / 1000;
    if (timeSinceDecision >= bot.decisionInterval) {
      makeDecision(bot, player, allPlayers, powerSpawns, fleet);
      bot.lastDecisionTime = now;
    }

    // Execute steering control
    executeSteering(bot, player, dt);
  }
}

// ── Decision Making ─────────────────────────────────────────────────────────

function makeDecision(bot, player, allPlayers, powerSpawns, fleet) {
  const pos = player.mesh.position;
  const personality = bot.personality;

  // Find nearest uncollected power-up
  let nearestPower = null;
  let nearestPowerDist = Infinity;
  for (const spawn of powerSpawns) {
    if (spawn.collected) continue;
    const d = Vector3.DistanceSquared(pos, spawn.position);
    if (d < nearestPowerDist) {
      nearestPowerDist = d;
      nearestPower = spawn;
    }
  }

  // Find nearest enemy
  let nearestEnemy = null;
  let nearestEnemyDist = Infinity;
  for (const other of allPlayers) {
    if (other.id === player.id || !other.alive || other.isBot === player.isBot) continue;
    const d = Vector3.DistanceSquared(pos, other.mesh.position);
    if (d < nearestEnemyDist) {
      nearestEnemyDist = d;
      nearestEnemy = other;
    }
  }

  // Check proximity to boundary
  const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
  const nearBoundary = distFromCenter > 45; // getting close to edge

  // Decision weights
  let powerWeight = personality.synAwareness * 10;
  let attackWeight = personality.aggressiveness * 6;
  let fleeWeight = personality.survivalBias * 3;
  let wanderWeight = 2;

  // Boost power-seeking if a synergy is close
  if (nearestPower && player.powerState) {
    const testIds = Object.keys(player.powerState.active || {});
    testIds.push(nearestPower.powerId);
    const synergies = detectSynergies(testIds);
    if (synergies.length > 0) powerWeight *= 2;
  }

  // Boost flee if near boundary or low health
  if (nearBoundary) fleeWeight *= 3;
  if (player.health < 30) fleeWeight *= 2;

  // Boost attack if player has high mutation tier
  if (player.mutationState?.tier >= MUTATION_TIER.CONSUMED) attackWeight *= 1.5;

  // Prioritize high-tier enemies
  if (nearestEnemy?.mutationState?.tier >= MUTATION_TIER.EVOLVED) attackWeight *= 1.5;

  // Make decision
  const total = powerWeight + attackWeight + fleeWeight + wanderWeight;
  const roll = Math.random() * total;

  if (roll < powerWeight && nearestPower) {
    bot.targetPos = nearestPower.position.clone();
    bot.targetType = 'power';
  } else if (roll < powerWeight + attackWeight && nearestEnemy) {
    bot.targetPos = nearestEnemy.mesh.position.clone();
    bot.targetType = 'enemy';
  } else if (roll < powerWeight + attackWeight + fleeWeight && nearBoundary) {
    // Flee toward center
    bot.targetPos = new Vector3(0, pos.y, 0);
    bot.targetType = 'flee';
  } else {
    // Wander
    bot.wanderAngle += (Math.random() - 0.5) * 1.5;
    const wanderDist = 15 + Math.random() * 10;
    bot.targetPos = new Vector3(
      pos.x + Math.sin(bot.wanderAngle) * wanderDist,
      pos.y,
      pos.z + Math.cos(bot.wanderAngle) * wanderDist
    );
    bot.targetType = 'wander';
  }

  // Hazard avoidance — shift target away from hazards
  for (const hz of fleet.hazardCenters) {
    if (!hz) continue;
    const dh = Vector3.DistanceSquared(bot.targetPos, hz);
    if (dh < 100) { // within 10 units of hazard
      const away = bot.targetPos.subtract(hz).normalize().scale(12);
      bot.targetPos.addInPlace(away);
    }
  }
}

// ── Steering Execution ──────────────────────────────────────────────────────

function executeSteering(bot, player, dt) {
  if (!bot.targetPos) {
    bot.throttle = 0;
    bot.steerAngle = 0;
    return;
  }

  const pos = player.mesh.position;
  const dx = bot.targetPos.x - pos.x;
  const dz = bot.targetPos.z - pos.z;
  const targetAngle = Math.atan2(dx, dz);

  // Current heading (from mesh rotation)
  const currentAngle = player.mesh.rotation ? player.mesh.rotation.y : 0;

  // Angle difference
  let angleDiff = targetAngle - currentAngle;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  // Smooth steering
  bot.steerAngle = Math.max(-1, Math.min(1, angleDiff * 2));

  // Throttle — slow down when turning sharply
  const absTurn = Math.abs(angleDiff);
  bot.throttle = absTurn > 1.2 ? 0.3 : absTurn > 0.5 ? 0.6 : 1.0;

  // Apply to mesh (placeholder — real physics via kart-physics module)
  const speed = bot.throttle * 12 * dt;
  player.mesh.rotation.y += bot.steerAngle * 2.5 * dt;
  player.mesh.position.x += Math.sin(player.mesh.rotation.y) * speed;
  player.mesh.position.z += Math.cos(player.mesh.rotation.y) * speed;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function disposeBots(fleet) {
  fleet.bots.length = 0;
}
