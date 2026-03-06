/**
 * battle-bot-controller.js — AI opponent controller for solo battle modes.
 *
 * Each bot navigates the arena navmesh, chases or patrols, collects pickups,
 * and fires weapons at the player. Follows similar patterns to bot-controller.js.
 *
 * Usage:
 *   const bots = createBattleBots(scene, navmesh, spawnPositions, numBots);
 *   // in game loop:
 *   updateBattleBots(bots, dt, playerCar, battleState);
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import "@babylonjs/loaders/glTF";
import { ALL_KARTS } from './content-registry.js';

// ── Tuning ──────────────────────────────────────────────────────────────────

const BOT_MAX_SPEED        = 22;    // m/s — keep arenas manageable
const BOT_ACCEL            = 14;    // m/s²
const BOT_BRAKE_FACTOR     = 0.80;
const BOT_STEER_SPEED      = 5.0;   // rad/s
const BOT_HEIGHT_OFFSET    = 0.3;
const BOT_CHASE_RANGE      = 35;    // start chasing player
const BOT_FIRE_RANGE       = 18;    // fire weapon range
const BOT_FIRE_COOLDOWN    = 3.0;   // seconds between shots
const BOT_WANDER_INTERVAL  = 4.0;   // seconds between picking new patrol target
const STUCK_TIMEOUT        = 3.0;   // seconds before teleport
const RESPAWN_INVULN_SEC   = 2.0;

const DIFFICULTY = [
  { speedMul: 0.72, accuracy: 0.40, label: 'easy' },
  { speedMul: 0.82, accuracy: 0.55, label: 'medium' },
  { speedMul: 0.92, accuracy: 0.70, label: 'hard' },
  { speedMul: 1.00, accuracy: 0.85, label: 'expert' },
];

const BOT_KART_IDS = Object.keys(ALL_KARTS).filter(k => k !== 'default');

// ── Navmesh helpers ─────────────────────────────────────────────────────────

/** Compute the center of a navmesh face (quad or tri). */
function faceCenter(faceIndices, vertices) {
  let x = 0, y = 0, z = 0;
  const n = faceIndices.length;
  for (const vi of faceIndices) {
    const v = vertices[vi];
    x += v[0]; y += v[1]; z += v[2];
  }
  return [x / n, y / n, z / n];
}

/** Find the navmesh face whose center is closest to a world position. */
function findNearestFace(pos, navmesh) {
  const px = pos.x ?? pos[0];
  const pz = pos.z ?? pos[2];
  let bestDist = Infinity;
  let bestIdx = 0;
  const { faces, vertices } = navmesh;

  for (let i = 0; i < faces.length; i++) {
    const c = faceCenter(faces[i], vertices);
    const dx = px - c[0];
    const dz = pz - c[2];
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Simple BFS pathfind on the navmesh adjacency graph.
 * Returns array of face indices from `start` to `goal` (inclusive), or empty.
 */
function bfsPath(start, goal, adjacency) {
  if (start === goal) return [start];

  const visited = new Set([start]);
  const queue = [[start]];

  while (queue.length > 0) {
    const path = queue.shift();
    const current = path[path.length - 1];

    const neighbors = adjacency[current];
    if (!neighbors) continue;

    for (const next of neighbors) {
      if (next < 0 || visited.has(next)) continue;
      const newPath = [...path, next];
      if (next === goal) return newPath;
      visited.add(next);
      queue.push(newPath);
    }
  }

  // No path found — fallback: direct approach
  return [start, goal];
}

// Pre-compute face centers cache for a navmesh
let _faceCentersCache = null;
let _cachedNavmesh = null;

function getFaceCenters(navmesh) {
  if (_cachedNavmesh === navmesh && _faceCentersCache) return _faceCentersCache;
  _cachedNavmesh = navmesh;
  _faceCentersCache = navmesh.faces.map(f => faceCenter(f, navmesh.vertices));
  return _faceCentersCache;
}

// ── Bot creation ────────────────────────────────────────────────────────────

/**
 * Create AI bots for a battle arena.
 *
 * @param {THREE.Scene} scene           Three.js scene
 * @param {object}      navmesh         {vertices, faces, adjacency}
 * @param {Array}       spawnPositions  [{position, heading}]
 * @param {number}      numBots         Number of bots (1–8)
 * @param {string}      playerKartId    Player's kart to exclude
 * @returns {Array<BattleBotState>}
 */
export function createBattleBots(scene, navmesh, spawnPositions, numBots = 4, playerKartId = 'tux') {
  if (!navmesh || !navmesh.faces || navmesh.faces.length === 0) {
    console.warn('Battle bot controller: no navmesh data');
    return [];
  }

  const bots = [];
  const available = BOT_KART_IDS.filter(k => k !== playerKartId);
  const shuffled = shuffleArray([...available]);

  for (let i = 0; i < Math.min(numBots, 8); i++) {
    const kartId = shuffled[i % shuffled.length];
    const diff = DIFFICULTY[Math.min(i, DIFFICULTY.length - 1)];

    // Spawn at arena spawn points (skip slot 0 which is for the player)
    const spawnIdx = (i + 1) % spawnPositions.length;
    const spawn = spawnPositions[spawnIdx];
    const startPos = spawn.position;
    const startHeading = spawn.heading || 0;

    const group = new TransformNode('battlebot_' + i, scene);
    group.position.copyFromFloats(startPos[0], startPos[1] + BOT_HEIGHT_OFFSET, startPos[2]);
    group.rotation.copyFromFloats(0, startHeading, 0);

    // Placeholder box until model loads
    const placeholder = MeshBuilder.CreateBox('botPlaceholder_' + i, { width: 1.5, height: 0.8, depth: 3.0 }, scene);
    const phMat = new StandardMaterial('botPhMat_' + i, scene);
    const c3 = Color3.FromHexString('#' + getColorForIndex(i).toString(16).padStart(6, '0'));
    phMat.diffuseColor = c3;
    phMat.alpha = 0.6;
    placeholder.material = phMat;
    placeholder.parent = group;

    const bot = {
      id: `battlebot-${i}`,
      kartId,
      difficulty: diff,
      mesh: group,
      placeholder,

      // Position & movement
      position: new Vector3(startPos[0], startPos[1] + BOT_HEIGHT_OFFSET, startPos[2]),
      heading: startHeading,
      speed: 0,

      // Health
      health: 100,
      maxHealth: 100,
      alive: true,
      invulnTimer: 0,

      // Navmesh navigation
      currentFace: findNearestFace({ x: startPos[0], z: startPos[2] }, navmesh),
      pathStack: [],         // face indices to follow
      targetFace: -1,
      targetPos: null,       // THREE.Vector3 immediate waypoint
      wanderTimer: 0,

      // Combat
      currentWeapon: null,
      fireCooldown: BOT_FIRE_COOLDOWN * (0.5 + Math.random()),
      score: 0,

      // Stuck detection
      stuckTimer: 0,
      lastPosition: new Vector3(startPos[0], 0, startPos[2]),

      // Respawn
      spawnPositions,
    };

    // Load GLTF model async
    loadBotKartModel(bot, kartId);

    bots.push(bot);
  }

  console.log(`Created ${bots.length} battle bots`);
  return bots;
}

// ── Per-frame update ────────────────────────────────────────────────────────

/**
 * @param {Array}   bots
 * @param {number}  dt
 * @param {THREE.Object3D} playerCar  Player car mesh
 * @param {object}  battleState       {battleStarted, battleFinished}
 * @param {object}  navmesh
 * @param {Function|null} onBotFire   Callback(bot) when bot fires
 */
export function updateBattleBots(bots, dt, playerCar, battleState, navmesh, onBotFire = null) {
  if (!battleState.battleStarted || battleState.battleFinished) return;

  const faceCenters = getFaceCenters(navmesh);

  for (const bot of bots) {
    if (!bot.alive) {
      bot.invulnTimer -= dt;
      if (bot.invulnTimer <= 0) {
        respawnBot(bot, navmesh, faceCenters);
      }
      continue;
    }

    // Invulnerability countdown
    if (bot.invulnTimer > 0) {
      bot.invulnTimer -= dt;
      // Blink effect
      if (bot.mesh) bot.mesh.setEnabled(Math.floor(bot.invulnTimer * 6) % 2 === 0);
    } else {
      if (bot.mesh) bot.mesh.setEnabled(true);
    }

    updateSingleBattleBot(bot, dt, playerCar, navmesh, faceCenters, onBotFire);
  }
}

function updateSingleBattleBot(bot, dt, playerCar, navmesh, faceCenters, onBotFire) {
  const distToPlayer = playerCar
    ? Vector3.Distance(bot.position, playerCar.position)
    : Infinity;

  const chasing = distToPlayer < BOT_CHASE_RANGE && playerCar;

  // ── Navigation target selection ───────────────────────────────────────
  if (chasing) {
    // Chase player: pathfind toward player's navmesh face
    const playerFace = findNearestFace(playerCar.position, navmesh);
    if (playerFace !== bot.targetFace || bot.pathStack.length === 0) {
      bot.targetFace = playerFace;
      bot.pathStack = bfsPath(bot.currentFace, playerFace, navmesh.adjacency);
      // Skip current face in path
      if (bot.pathStack.length > 1 && bot.pathStack[0] === bot.currentFace) {
        bot.pathStack.shift();
      }
    }
  } else {
    // Wander: pick a random navmesh face periodically
    bot.wanderTimer -= dt;
    if (bot.wanderTimer <= 0 || bot.pathStack.length === 0) {
      bot.wanderTimer = BOT_WANDER_INTERVAL * (0.5 + Math.random());
      const randomFace = Math.floor(Math.random() * navmesh.faces.length);
      bot.targetFace = randomFace;
      bot.pathStack = bfsPath(bot.currentFace, randomFace, navmesh.adjacency);
      if (bot.pathStack.length > 1 && bot.pathStack[0] === bot.currentFace) {
        bot.pathStack.shift();
      }
    }
  }

  // ── Waypoint following ────────────────────────────────────────────────
  if (bot.pathStack.length > 0) {
    const nextFace = bot.pathStack[0];
    const center = faceCenters[nextFace];
    bot.targetPos = new Vector3(center[0], center[1] + BOT_HEIGHT_OFFSET, center[2]);

    // If close enough to waypoint, advance to next
    const dxz = Math.hypot(bot.position.x - center[0], bot.position.z - center[2]);
    if (dxz < 3.0) {
      bot.currentFace = nextFace;
      bot.pathStack.shift();
    }
  }

  // ── Steering ──────────────────────────────────────────────────────────
  if (bot.targetPos) {
    const dir = bot.targetPos.subtract(bot.position);
    dir.y = 0;
    dir.normalize();
    const targetHeading = Math.atan2(dir.x, dir.z);

    let headingDiff = targetHeading - bot.heading;
    while (headingDiff > Math.PI)  headingDiff -= Math.PI * 2;
    while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;

    const sharpTurn = Math.abs(headingDiff) > 1.0;
    bot.heading += headingDiff * Math.min(BOT_STEER_SPEED * dt, 1.0);

    // ── Speed control ─────────────────────────────────────────────────
    const effectiveMax = BOT_MAX_SPEED * bot.difficulty.speedMul;

    if (sharpTurn && bot.speed > effectiveMax * 0.5) {
      bot.speed *= BOT_BRAKE_FACTOR;
    } else if (bot.speed < effectiveMax) {
      bot.speed += BOT_ACCEL * dt;
    }
    bot.speed = Math.min(bot.speed, effectiveMax);
    bot.speed *= 0.98; // drag
  }

  // ── Move forward ──────────────────────────────────────────────────────
  const forward = new Vector3(Math.sin(bot.heading), 0, Math.cos(bot.heading));
  bot.position.x += forward.x * bot.speed * dt;
  bot.position.y += forward.y * bot.speed * dt;
  bot.position.z += forward.z * bot.speed * dt;

  // Y: follow nearest face center height
  const center = faceCenters[bot.currentFace];
  if (center) {
    const targetY = center[1] + BOT_HEIGHT_OFFSET;
    bot.position.y += (targetY - bot.position.y) * Math.min(dt * 8, 1.0);
  }

  // Update mesh
  bot.mesh.position.copyFrom(bot.position);
  bot.mesh.rotation.copyFromFloats(0, bot.heading, 0);

  // Update current face
  bot.currentFace = findNearestFace(bot.position, navmesh);

  // ── Combat ────────────────────────────────────────────────────────────
  bot.fireCooldown -= dt;

  if (chasing && distToPlayer < BOT_FIRE_RANGE && bot.fireCooldown <= 0) {
    // Accuracy check: only fire if accuracy roll succeeds
    if (Math.random() < bot.difficulty.accuracy) {
      if (onBotFire) onBotFire(bot);
      bot.fireCooldown = BOT_FIRE_COOLDOWN * (0.8 + Math.random() * 0.4);
    }
  }

  // ── Stuck detection ───────────────────────────────────────────────────
  const moved = Vector3.Distance(bot.position, bot.lastPosition);
  if (moved < 0.5 * dt * 10) {
    bot.stuckTimer += dt;
    if (bot.stuckTimer > STUCK_TIMEOUT) {
      // Teleport to a random face
      const randomFace = Math.floor(Math.random() * navmesh.faces.length);
      const c = faceCenters[randomFace];
      bot.position.copyFromFloats(c[0], c[1] + BOT_HEIGHT_OFFSET, c[2]);
      bot.currentFace = randomFace;
      bot.speed = BOT_MAX_SPEED * bot.difficulty.speedMul * 0.3;
      bot.stuckTimer = 0;
      bot.pathStack = [];
    }
  } else {
    bot.stuckTimer = 0;
  }
  bot.lastPosition.copyFromFloats(bot.position.x, 0, bot.position.z);
}

// ── Damage & respawn ────────────────────────────────────────────────────────

/**
 * Apply damage to a battle bot. Returns true if bot was killed.
 */
export function damageBattleBot(bot, amount) {
  if (!bot.alive || bot.invulnTimer > 0) return false;

  bot.health = Math.max(0, bot.health - amount);
  if (bot.health <= 0) {
    bot.alive = false;
    bot.invulnTimer = RESPAWN_INVULN_SEC + 1.5; // dead time + invuln
    bot.speed = 0;
    bot.mesh.setEnabled(false);
    return true;
  }
  return false;
}

function respawnBot(bot, navmesh, faceCenters) {
  // Pick a random spawn position
  const spawn = bot.spawnPositions[Math.floor(Math.random() * bot.spawnPositions.length)];
  const pos = spawn.position;

  bot.position.copyFromFloats(pos[0], pos[1] + BOT_HEIGHT_OFFSET, pos[2]);
  bot.heading = spawn.heading || 0;
  bot.health = bot.maxHealth;
  bot.alive = true;
  bot.invulnTimer = RESPAWN_INVULN_SEC;
  bot.speed = 0;
  bot.pathStack = [];
  bot.currentFace = findNearestFace(bot.position, navmesh);
  bot.mesh.position.copyFrom(bot.position);
  bot.mesh.rotation.copyFromFloats(0, bot.heading, 0);
  bot.mesh.setEnabled(true);
}

/**
 * Get scoreboard entries for all bots and the player.
 */
export function getBattleScoreboard(bots, playerScore, playerName = 'You') {
  const entries = [
    { id: 'player', name: playerName, score: playerScore, health: -1 },
  ];

  for (const bot of bots) {
    const label = ALL_KARTS[bot.kartId]?.label || bot.kartId;
    entries.push({
      id: bot.id,
      name: label,
      score: bot.score,
      health: bot.health,
    });
  }

  entries.sort((a, b) => b.score - a.score);
  return entries;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

export function disposeBattleBots(bots, scene) {
  for (const bot of bots) {
    if (bot.mesh) {
      bot.mesh.dispose(false, true);
    }
  }
  bots.length = 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getColorForIndex(i) {
  const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff,
    0xff8800, 0x8800ff, 0x00ff88, 0xff0088];
  return colors[i % colors.length];
}

function loadBotKartModel(bot, kartId) {
  const kartInfo = ALL_KARTS[kartId];
  if (!kartInfo) return;

  const modelPath = kartInfo.modelPath;
  const lastSlash = modelPath.lastIndexOf('/');
  const dir = modelPath.substring(0, lastSlash + 1);
  const file = modelPath.substring(lastSlash + 1);
  const scene = bot.mesh.getScene();

  SceneLoader.ImportMeshAsync("", dir, file, scene).then((result) => {
    const root = result.meshes[0];
    root.scaling.setAll(kartInfo.scale || 2.2);
    result.meshes.forEach(m => { if (m.getTotalVertices && m.getTotalVertices() > 0) m.receiveShadows = false; });
    if (bot.placeholder) {
      bot.placeholder.dispose();
      bot.placeholder = null;
    }
    root.parent = bot.mesh;
  }).catch((err) => {
    console.warn(`Failed to load battle bot kart ${kartId}:`, err.message);
  });
}
