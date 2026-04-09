/**
 * bot-controller.js — AI opponent controller for solo racing modes.
 *
 * Each bot instance follows the driveline quads from track-data.json,
 * producing a Three.js mesh that moves along the track path with basic
 * racing behaviour (acceleration, braking for corners, rubber-banding).
 *
 * Usage:
 *   const bots = createRaceBots(scene, trackData, numBots, kartAssets);
 *   // in game loop:
 *   updateRaceBots(bots, dt, playerProgress);
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { getDriveline, getStartGrid, getLapCount, getGraph } from './track-data-loader.js';
import { ALL_KARTS, resolveKartAsset } from './content-registry.js';

// ── Tuning constants ────────────────────────────────────────────────────────

const BOT_MAX_SPEED       = 30;   // m/s — slightly below player max (35)
const BOT_ACCEL           = 18;   // m/s²
const BOT_BRAKE_FACTOR    = 0.85; // multiplier when braking for curves
const BOT_COAST_DRAG      = 0.98;
const BOT_LOOK_AHEAD      = 6;    // quads ahead to steer toward
const BOT_CURVE_LOOK      = 12;   // quads ahead for curve detection
const BOT_HEIGHT_OFFSET   = 0.4;  // lift above driveline center Y
const BOT_STEER_SPEED     = 4.0;  // radians/sec slerp factor
const BOT_CURVE_THRESHOLD = 0.35; // radians — sharper → brake

// Rubber-banding: bots speed up when behind, slow when far ahead
const RUBBER_BAND_BEHIND  = 1.18; // speed multiplier when behind player
const RUBBER_BAND_AHEAD   = 0.82; // speed multiplier when far ahead
const RUBBER_BAND_RANGE   = 0.15; // progress fraction threshold

// Bot-player collision
const BOT_COLLISION_RADIUS = 2.8; // center-to-center distance for bump
const BOT_BUMP_FORCE       = 6.0; // nudge impulse m/s

// Difficulty tiers (set per-bot to create a spread)
const DIFFICULTY = [
  { speedMul: 0.78, wobble: 1.8, label: 'easy' },
  { speedMul: 0.85, wobble: 1.2, label: 'medium' },
  { speedMul: 0.92, wobble: 0.7, label: 'hard' },
  { speedMul: 0.97, wobble: 0.3, label: 'expert' },
];

// Pool of kart IDs to assign to bots
const BOT_KART_IDS = Object.keys(ALL_KARTS).filter(k => k !== 'default');

// ── Bot creation ────────────────────────────────────────────────────────────

/**
 * Create AI opponent bots for a race.
 *
 * @param {THREE.Scene} scene        The Three.js scene to add bot meshes to
 * @param {object}      trackData    Loaded track-data.json object
 * @param {number}      numBots      Number of bots (1–11)
 * @param {string}      playerKartId Player's kart ID (excluded from bot selection)
 * @returns {Array<BotState>}
 */
export function createRaceBots(scene, trackData, numBots = 7, playerKartId = 'tux') {
  const driveline = getDriveline(trackData);
  const startGrid = getStartGrid(trackData);
  const totalLaps = getLapCount(trackData);
  const graph     = getGraph(trackData);

  if (!driveline.length) {
    console.warn('Bot controller: no driveline data, cannot create bots');
    return [];
  }

  const mainLoopSize = graph?.mainLoop ? graph.mainLoop[1] : driveline.length;
  const bots = [];

  // Pick karts for bots (exclude player's kart)
  const available = BOT_KART_IDS.filter(k => k !== playerKartId);
  const shuffled = shuffleArray([...available]);

  for (let i = 0; i < Math.min(numBots, 11); i++) {
    const kartId = shuffled[i % shuffled.length];
    const diff = DIFFICULTY[Math.min(i, DIFFICULTY.length - 1)];

    // Assign start position from grid (player takes slot 0)
    const gridSlot = startGrid[i + 1] || startGrid[0];
    const startPos = gridSlot.position;
    const startHeading = gridSlot.heading || 0;

    // Create a placeholder mesh immediately; GLTF model loads async
    const group = new TransformNode(`raceBot${i}`, scene);
    group.position.copyFromFloats(startPos[0], startPos[1] + BOT_HEIGHT_OFFSET, startPos[2]);
    group.rotation.copyFromFloats(0, startHeading, 0);

    // Create a simple box as fallback (visible until GLTF loads)
    const placeholder = MeshBuilder.CreateBox(`botPlaceholder${i}`, {
      width: 1.5, height: 0.8, depth: 3.0,
    }, scene);
    const phMat = new StandardMaterial(`botPhMat${i}`, scene);
    phMat.diffuseColor = getColorForIndex(i);
    phMat.alpha = 0.6;
    placeholder.material = phMat;
    placeholder.parent = group;
    // 13.8.2: placeholder participates in shadows
    placeholder.receiveShadows = true;

    const bot = {
      id: `bot-${i}`,
      kartId,
      difficulty: diff,
      mesh: group,
      placeholder,
      speed: 0,
      quadIndex: findNearestQuad(driveline, startPos),
      targetQuadIndex: 0,
      currentLap: 0,
      raceFinished: false,
      quadsTraversed: 0,
      minQuadsForLap: Math.floor(mainLoopSize * 0.6),
      driveline,
      totalLaps,
      mainLoopSize,
      wobbleOffset: (Math.random() - 0.5) * diff.wobble * 2,
      wobblePhase: Math.random() * Math.PI * 2,
      position: new Vector3(startPos[0], startPos[1] + BOT_HEIGHT_OFFSET, startPos[2]),
      heading: startHeading,
      stuckTimer: 0,
    };

    // Load GLTF model async
    loadBotKartModel(bot, kartId, scene);

    bots.push(bot);
  }

  console.log(`Created ${bots.length} racing bots`);
  return bots;
}

// ── Per-frame update ────────────────────────────────────────────────────────

/**
 * Update all bots for one frame.
 *
 * @param {Array<BotState>} bots
 * @param {number}          dt              Delta time in seconds
 * @param {number}          playerProgress  Player's race progress [0, totalLaps]
 * @param {boolean}         raceStarted     Whether race countdown has finished
 */
export function updateRaceBots(bots, dt, playerProgress = 0, raceStarted = false) {
  for (const bot of bots) {
    if (bot.raceFinished || !raceStarted) continue;
    updateSingleBot(bot, dt, playerProgress);
  }
}

function updateSingleBot(bot, dt, playerProgress) {
  const { driveline, difficulty, mainLoopSize, totalLaps } = bot;

  // Target quad ahead of current position
  const lookAhead = BOT_LOOK_AHEAD;
  const targetIdx = (bot.quadIndex + lookAhead) % driveline.length;
  const targetQuad = driveline[targetIdx];
  const targetPos = new Vector3(
    targetQuad.center[0] + bot.wobbleOffset,
    targetQuad.center[1] + BOT_HEIGHT_OFFSET,
    targetQuad.center[2],
  );

  // Wobble (slight lateral variation to look natural)
  bot.wobblePhase += dt * 0.5;
  bot.wobbleOffset = Math.sin(bot.wobblePhase) * difficulty.wobble;

  // Curve detection — check if the path curves sharply ahead
  const curveAngle = getCurveAngle(driveline, bot.quadIndex, BOT_CURVE_LOOK);
  const isCurve = curveAngle > BOT_CURVE_THRESHOLD;

  // Rubber-banding
  const botProgress = getBotProgress(bot);
  const progressDelta = playerProgress - botProgress;
  let rubberBand = 1.0;
  if (progressDelta > RUBBER_BAND_RANGE) {
    rubberBand = RUBBER_BAND_BEHIND; // player is ahead → speed up
  } else if (progressDelta < -RUBBER_BAND_RANGE) {
    rubberBand = RUBBER_BAND_AHEAD;  // player is behind → slow down
  }

  // Speed control
  const effectiveMaxSpeed = BOT_MAX_SPEED * difficulty.speedMul * rubberBand;

  if (isCurve && bot.speed > effectiveMaxSpeed * 0.6) {
    bot.speed *= BOT_BRAKE_FACTOR;
  } else if (bot.speed < effectiveMaxSpeed) {
    bot.speed += BOT_ACCEL * dt;
  }
  bot.speed = Math.min(bot.speed, effectiveMaxSpeed);
  bot.speed *= BOT_COAST_DRAG;

  // Steering — rotate toward target
  const dirToTarget = targetPos.subtract(bot.position);
  dirToTarget.y = 0;
  dirToTarget.normalize();
  const targetHeading = Math.atan2(dirToTarget.x, dirToTarget.z);

  // Smooth heading interpolation
  let headingDiff = targetHeading - bot.heading;
  // Normalize to [-PI, PI]
  while (headingDiff > Math.PI)  headingDiff -= Math.PI * 2;
  while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
  bot.heading += headingDiff * Math.min(BOT_STEER_SPEED * dt, 1.0);

  // Move forward
  const forward = new Vector3(
    Math.sin(bot.heading),
    0,
    Math.cos(bot.heading),
  );
  const step = bot.speed * dt;
  bot.position.x += forward.x * step;
  bot.position.y += forward.y * step;
  bot.position.z += forward.z * step;

  // Y position: interpolate toward driveline Y
  const nearestQuad = driveline[bot.quadIndex];
  const targetY = nearestQuad.center[1] + BOT_HEIGHT_OFFSET;
  bot.position.y += (targetY - bot.position.y) * Math.min(dt * 8, 1.0);

  // Update mesh
  bot.mesh.position.copyFrom(bot.position);
  bot.mesh.rotation.copyFromFloats(0, bot.heading, 0);

  // Update quad index
  const newQuad = findNearestQuad(driveline, [bot.position.x, bot.position.y, bot.position.z]);
  if (newQuad !== bot.quadIndex) {
    bot.quadIndex = newQuad;
    bot.quadsTraversed++;
  }

  // Lap detection
  const nearLapLine = bot.quadIndex <= 3 || bot.quadIndex >= mainLoopSize - 3;
  if (nearLapLine && bot.quadsTraversed >= bot.minQuadsForLap) {
    bot.currentLap++;
    bot.quadsTraversed = 0;

    if (bot.currentLap >= totalLaps) {
      bot.raceFinished = true;
    }
  }

  // Stuck detection — if speed very low for too long, teleport ahead
  if (bot.speed < 1.0) {
    bot.stuckTimer += dt;
    if (bot.stuckTimer > 3.0) {
      const resetIdx = (bot.quadIndex + 5) % driveline.length;
      const resetQuad = driveline[resetIdx];
      bot.position.copyFromFloats(resetQuad.center[0], resetQuad.center[1] + BOT_HEIGHT_OFFSET, resetQuad.center[2]);
      bot.quadIndex = resetIdx;
      bot.speed = effectiveMaxSpeed * 0.5;
      bot.stuckTimer = 0;
    }
  } else {
    bot.stuckTimer = 0;
  }
}

// ── Progress & ranking ──────────────────────────────────────────────────────

/**
 * Get bot race progress as a comparable number.
 * Same scale as checkpoints.js getRaceProgress() => [0, totalLaps].
 */
export function getBotProgress(bot) {
  const lapFraction = bot.mainLoopSize > 0 ? bot.quadIndex / bot.mainLoopSize : 0;
  return bot.currentLap + Math.min(lapFraction, 0.999);
}

/**
 * Get sorted race positions (all bots + player).
 * Returns array of { id, name, progress, lap, finished }.
 */
export function getRacePositions(bots, playerProgress, playerName = 'You') {
  const entries = [
    { id: 'player', name: playerName, progress: playerProgress, lap: Math.floor(playerProgress), finished: false },
  ];

  for (const bot of bots) {
    entries.push({
      id: bot.id,
      name: ALL_KARTS[bot.kartId]?.label || bot.kartId,
      progress: getBotProgress(bot),
      lap: bot.currentLap,
      finished: bot.raceFinished,
    });
  }

  // Sort descending by progress (finished bots ranked by completion order)
  entries.sort((a, b) => {
    if (a.finished && !b.finished) return -1;
    if (!a.finished && b.finished) return 1;
    return b.progress - a.progress;
  });

  return entries;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Remove all bot meshes from the scene and release references.
 */
export function disposeRaceBots(bots) {
  for (const bot of bots) {
    if (bot.mesh) {
      bot.mesh.dispose(false, true);
    }
  }
  bots.length = 0;
}

// ── Bot–player proximity collision ──────────────────────────────────────────

/**
 * Check all bots for proximity collision with the player kart.
 * Returns a nudge vector to apply to the player (or null if no collision).
 *
 * @param {Array<BotState>} bots
 * @param {import('@babylonjs/core').Vector3} playerPos  Player kart position
 * @returns {{ nudge: import('@babylonjs/core').Vector3, botId: string } | null}
 */
export function checkBotPlayerCollision(bots, playerPos) {
  if (!playerPos) return null;
  for (const bot of bots) {
    if (bot.raceFinished) continue;
    const dx = playerPos.x - bot.position.x;
    const dz = playerPos.z - bot.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < BOT_COLLISION_RADIUS && dist > 0.01) {
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = BOT_COLLISION_RADIUS - dist;
      // Push both apart: player gets a nudge, bot speed briefly drops
      bot.speed *= 0.85;
      return {
        nudge: new Vector3(nx * BOT_BUMP_FORCE * overlap, 0, nz * BOT_BUMP_FORCE * overlap),
        botId: bot.id,
      };
    }
  }
  return null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function findNearestQuad(driveline, pos) {
  const px = Array.isArray(pos) ? pos[0] : pos.x;
  const pz = Array.isArray(pos) ? pos[2] : pos.z;

  let bestDist = Infinity;
  let bestIdx = 0;

  for (let i = 0; i < driveline.length; i++) {
    const c = driveline[i].center;
    const dx = px - c[0];
    const dz = pz - c[2];
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Measure the cumulative angular change in heading over `lookAhead` quads.
 * Returns the absolute angle in radians — larger = sharper curve.
 */
function getCurveAngle(driveline, currentIdx, lookAhead) {
  const n = driveline.length;
  let totalAngle = 0;

  for (let i = 0; i < lookAhead - 1; i++) {
    const a = (currentIdx + i) % n;
    const b = (currentIdx + i + 1) % n;
    const c = (currentIdx + i + 2) % n;

    const ca = driveline[a].center;
    const cb = driveline[b].center;
    const cc = driveline[c].center;

    const dx1 = cb[0] - ca[0];
    const dz1 = cb[2] - ca[2];
    const dx2 = cc[0] - cb[0];
    const dz2 = cc[2] - cb[2];

    const h1 = Math.atan2(dx1, dz1);
    const h2 = Math.atan2(dx2, dz2);
    let diff = h2 - h1;
    while (diff > Math.PI)  diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    totalAngle += Math.abs(diff);
  }

  return totalAngle;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getColorForIndex(i) {
  const colors = [
    new Color3(1, 0.27, 0.27), new Color3(0.27, 1, 0.27), new Color3(0.27, 0.27, 1),
    new Color3(1, 1, 0.27), new Color3(1, 0.27, 1), new Color3(0.27, 1, 1),
    new Color3(1, 0.53, 0), new Color3(0.53, 0, 1), new Color3(0, 1, 0.53),
    new Color3(1, 0, 0.53), new Color3(0, 0.53, 1),
  ];
  return colors[i % colors.length];
}

function loadBotKartModel(bot, kartId, scene) {
  const kartInfo = resolveKartAsset(kartId);
  const modelPath = kartInfo.modelPath;
  const lastSlash = modelPath.lastIndexOf('/');
  const dir = modelPath.substring(0, lastSlash + 1);
  const file = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync("", dir, file, scene).then((result) => {
    const model = result.meshes[0];
    model.scaling.setAll(kartInfo.scale || 2.2);
    result.meshes.forEach(mesh => {
      if (mesh.getTotalVertices && mesh.getTotalVertices() > 0) {
        mesh.receiveShadows = true;
      }
    });

    // Remove placeholder
    if (bot.placeholder) {
      bot.placeholder.dispose();
      bot.placeholder = null;
    }
    // STK kart GLBs face -Z locally; rotate 180° so they face +Z (forward)
    model.rotation.y = Math.PI;
    model.parent = bot.mesh;
  }).catch((err) => {
    console.warn(`Failed to load bot kart ${kartId}, trying default:`, err.message);
    // Fallback to default kart model
    if (kartId !== 'default') loadBotKartModel(bot, 'default', scene);
  });
}
