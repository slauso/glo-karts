import { KART_CONTACT_BOX, computeKartContact } from "./kart-combat.js";

const DEFAULT_SIMULATION_HZ = 60;
const DEFAULT_STALE_INPUT_MS = 500;
const DEFAULT_COUNTDOWN_MS = 10000;
const METRIC_ALPHA = 0.2;

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeUnit(value, fallback = 0) {
  return Math.max(-1, Math.min(1, safeNumber(value, fallback)));
}

export function getSimulationIntervalMs(simulationHz = DEFAULT_SIMULATION_HZ) {
  const hz = Math.max(1, safeNumber(simulationHz, DEFAULT_SIMULATION_HZ));
  return 1000 / hz;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function updateEwma(current, next, alpha = METRIC_ALPHA) {
  if (!Number.isFinite(next)) return current || 0;
  if (!Number.isFinite(current) || current === 0) return next;
  return current + (next - current) * alpha;
}

function roundMetric(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function createRoomMetrics(room, syncConfig) {
  return {
    roomName: room.roomName,
    authoritative: !!syncConfig.authoritative,
    patchRateMs: syncConfig.patchRateMs,
    interpolationBaseDelayMs: syncConfig.interpolationBaseDelayMs,
    staleInputMs: syncConfig.staleInputMs,
    expectedTickMs: syncConfig.tickRateMs,
    tickCount: 0,
    patchCycles: 0,
    patchCount: 0,
    playerCount: 0,
    lastTickDriftMs: 0,
    avgTickDriftMs: 0,
    lastInputAgeMs: 0,
    avgInputAgeMs: 0,
    maxInputAgeMs: 0,
    staleInputDrops: 0,
    outOfOrderInputDrops: 0,
    anomalyProjectilesFired: 0,
    anomalyProjectileHits: 0,
    anomalyEffectsApplied: 0,
    arenaEffectsApplied: 0,
    apocalypseBursts: 0,
    anomalyCoreCollections: 0,
    anomalyChainBursts: 0,
    lastPatchAt: 0,
    lastSyncAt: 0,
  };
}

const ANOMALY_COUNTERS = new Set([
  "anomalyProjectilesFired",
  "anomalyProjectileHits",
  "anomalyEffectsApplied",
  "arenaEffectsApplied",
  "apocalypseBursts",
  "anomalyCoreCollections",
  "anomalyChainBursts",
]);

export function getRealtimeCountdownMs(options = {}) {
  return clamp(
    safeNumber(options.countdownMs ?? process.env.COLYSEUS_COUNTDOWN_MS, DEFAULT_COUNTDOWN_MS),
    500,
    30000,
  );
}

export function getInterpolationBaseDelayMs(patchRateMs) {
  return clamp(Math.round(safeNumber(patchRateMs, 1000 / 20) * 2.5), 75, 220);
}

export function getRecommendedPatchRateMs(maxClients) {
  const count = Math.max(2, Math.min(12, safeNumber(maxClients, 12)));
  if (count <= 4) return 1000 / 60;
  if (count <= 8) return 1000 / 45;
  return 1000 / 30;
}

export function configureRealtimeRoom(room, options = {}, config = {}) {
  const maxClients = Math.max(2, Math.min(12, safeNumber(options.maxPlayers, 12)));
  const patchRateMs = Math.max(
    1000 / 60,
    safeNumber(
      options.patchRateMs ?? process.env.COLYSEUS_PATCH_RATE_MS,
      getRecommendedPatchRateMs(maxClients),
    ),
  );

  const staleInputMs = clamp(
    safeNumber(options.staleInputMs ?? process.env.COLYSEUS_STALE_INPUT_MS, DEFAULT_STALE_INPUT_MS),
    50,
    1000,
  );
  const tickRateMs = getSimulationIntervalMs(DEFAULT_SIMULATION_HZ);
  const interpolationBaseDelayMs = getInterpolationBaseDelayMs(patchRateMs);
  room.maxClients = maxClients;
  room.setPatchRate(patchRateMs);
  room.syncConfig = {
    maxClients,
    patchRateMs,
    simulationHz: DEFAULT_SIMULATION_HZ,
    tickRateMs,
    staleInputMs,
    interpolationBaseDelayMs,
    authoritative: !!config.authoritative,
  };
  room.syncMetrics = createRoomMetrics(room, room.syncConfig);

  if (!room.__syncMessagesInstalled) {
    room.__syncMessagesInstalled = true;
    room.onMessage("timeSync", (client, payload = {}) => {
      client.send("timeSync", {
        clientSentAt: safeNumber(payload.clientSentAt, 0),
        serverReceivedAt: Date.now(),
        serverSentAt: Date.now(),
        serverTime: Date.now(),
        patchRateMs: room.syncConfig.patchRateMs,
        interpolationBaseDelayMs: room.syncConfig.interpolationBaseDelayMs,
        authoritative: !!room.syncConfig.authoritative,
        roomName: room.roomName,
      });
    });
    room.onMessage("syncMetricsRequest", (client) => {
      client.send("syncMetricsSnapshot", getRealtimeMetricsSnapshot(room));
    });
  }

  if (!room.__syncPatchWrapped) {
    room.__syncPatchWrapped = true;
    const baseBroadcastPatch = room.broadcastPatch.bind(room);
    room.broadcastPatch = function wrappedBroadcastPatch() {
      const metrics = room.syncMetrics;
      if (metrics) {
        metrics.patchCycles += 1;
        metrics.playerCount = room.clients?.length || 0;
      }
      const hasChanges = baseBroadcastPatch();
      if (metrics && hasChanges) {
        metrics.patchCount += 1;
        metrics.lastPatchAt = Date.now();
      }
      return hasChanges;
    };
  }

  room.setMetadata({
    ...room.metadata,
    maxClients,
    patchRateMs,
    authoritative: !!config.authoritative,
    simulationHz: DEFAULT_SIMULATION_HZ,
  });

  return room.syncConfig;
}

export function buildRealtimeInput(data, now = Date.now()) {
  return {
    seq: Math.max(0, Math.floor(safeNumber(data?.seq, 0))),
    throttle: safeUnit(data?.throttle, 0),
    steer: safeUnit(data?.steer, 0),
    brake: safeUnit(data?.brake, 0),
    drift: !!data?.drift,
    fire: !!data?.fire,
    x: safeNumber(data?.x, 0),
    y: safeNumber(data?.y, 1),
    z: safeNumber(data?.z, 0),
    rx: safeNumber(data?.rx, 0),
    ry: safeNumber(data?.ry, 0),
    rz: safeNumber(data?.rz, 0),
    rw: safeNumber(data?.rw, 1),
    receivedAt: now,
  };
}

export function storeLatestRealtimeInput(inputBySession, sessionId, input) {
  const existing = inputBySession.get(sessionId);
  if (existing && input.seq <= existing.seq) {
    return false;
  }
  inputBySession.set(sessionId, input);
  return true;
}

export function isRealtimeInputFresh(input, now = Date.now(), staleInputMs = DEFAULT_STALE_INPUT_MS) {
  if (!input) return false;
  return now - safeNumber(input.receivedAt, 0) <= staleInputMs;
}

export function getRealtimeControlInput(input, now = Date.now(), staleInputMs = DEFAULT_STALE_INPUT_MS) {
  if (isRealtimeInputFresh(input, now, staleInputMs)) {
    return input;
  }
  return {
    seq: safeNumber(input?.seq, 0),
    throttle: 0,
    steer: 0,
    brake: 0,
    drift: false,
    fire: false,
    x: safeNumber(input?.x, 0),
    y: safeNumber(input?.y, 1),
    z: safeNumber(input?.z, 0),
    rx: safeNumber(input?.rx, 0),
    ry: safeNumber(input?.ry, 0),
    rz: safeNumber(input?.rz, 0),
    rw: safeNumber(input?.rw, 1),
    receivedAt: safeNumber(input?.receivedAt, now),
  };
}

export function noteRealtimeTick(room, deltaTime, now = Date.now()) {
  const metrics = room?.syncMetrics;
  if (!metrics) return;
  const drift = Math.abs(safeNumber(deltaTime, 0) - safeNumber(room.syncConfig?.tickRateMs, 1000 / 60));
  metrics.tickCount += 1;
  metrics.lastTickDriftMs = roundMetric(drift);
  metrics.avgTickDriftMs = roundMetric(updateEwma(metrics.avgTickDriftMs, drift));
  metrics.playerCount = room.state?.players?.size || room.clients?.length || 0;
  metrics.lastSyncAt = now;
}

export function noteProcessedInput(room, input, now = Date.now()) {
  const metrics = room?.syncMetrics;
  if (!metrics || !input) return;
  const age = Math.max(0, now - safeNumber(input.receivedAt, now));
  metrics.lastInputAgeMs = roundMetric(age);
  metrics.avgInputAgeMs = roundMetric(updateEwma(metrics.avgInputAgeMs, age));
  metrics.maxInputAgeMs = roundMetric(Math.max(metrics.maxInputAgeMs || 0, age));
}

export function noteRejectedInput(room, reason) {
  const metrics = room?.syncMetrics;
  if (!metrics) return;
  if (reason === "stale") metrics.staleInputDrops += 1;
  if (reason === "out_of_order") metrics.outOfOrderInputDrops += 1;
}

export function noteRealtimeAnomalyEvent(room, counter, amount = 1) {
  const metrics = room?.syncMetrics;
  if (!metrics || !ANOMALY_COUNTERS.has(counter)) return;
  metrics[counter] = Math.max(0, Number(metrics[counter] || 0) + Number(amount || 0));
}

export function getRealtimeMetricsSnapshot(room) {
  const metrics = room?.syncMetrics;
  const config = room?.syncConfig;
  const state = room?.state;
  return {
    roomId: room?.roomId || "",
    roomName: room?.roomName || "",
    authoritative: !!config?.authoritative,
    patchRateMs: roundMetric(config?.patchRateMs || 0),
    interpolationBaseDelayMs: roundMetric(config?.interpolationBaseDelayMs || 0),
    staleInputMs: roundMetric(config?.staleInputMs || 0),
    expectedTickMs: roundMetric(config?.tickRateMs || 0),
    playerCount: metrics?.playerCount || 0,
    tickCount: metrics?.tickCount || 0,
    patchCycles: metrics?.patchCycles || 0,
    patchCount: metrics?.patchCount || 0,
    lastTickDriftMs: roundMetric(metrics?.lastTickDriftMs || 0),
    avgTickDriftMs: roundMetric(metrics?.avgTickDriftMs || 0),
    lastInputAgeMs: roundMetric(metrics?.lastInputAgeMs || 0),
    avgInputAgeMs: roundMetric(metrics?.avgInputAgeMs || 0),
    maxInputAgeMs: roundMetric(metrics?.maxInputAgeMs || 0),
    staleInputDrops: metrics?.staleInputDrops || 0,
    outOfOrderInputDrops: metrics?.outOfOrderInputDrops || 0,
    anomalyProjectilesFired: metrics?.anomalyProjectilesFired || 0,
    anomalyProjectileHits: metrics?.anomalyProjectileHits || 0,
    anomalyEffectsApplied: metrics?.anomalyEffectsApplied || 0,
    arenaEffectsApplied: metrics?.arenaEffectsApplied || 0,
    apocalypseBursts: metrics?.apocalypseBursts || 0,
    anomalyCoreCollections: metrics?.anomalyCoreCollections || 0,
    anomalyChainBursts: metrics?.anomalyChainBursts || 0,
    anomalyLongestChain: Number(state?.longestChain || 0),
    activeAnomalyCores: Number(state?.activeCoreCount || 0),
    activeAnomalyChainPeak: Number(state?.activeChainPeak || 0),
    arenaSeed: Number(state?.arenaSeed || 0),
    lastPatchAt: metrics?.lastPatchAt || 0,
    lastSyncAt: metrics?.lastSyncAt || 0,
    serverNow: Date.now(),
  };
}

export function getRealtimeJoinPayload(room) {
  const config = room?.syncConfig || {};
  return {
    patchRateMs: roundMetric(config.patchRateMs || 0),
    simulationHz: roundMetric(config.simulationHz || DEFAULT_SIMULATION_HZ),
    staleInputMs: roundMetric(config.staleInputMs || DEFAULT_STALE_INPUT_MS),
    interpolationBaseDelayMs: roundMetric(config.interpolationBaseDelayMs || getInterpolationBaseDelayMs(config.patchRateMs || 50)),
    authoritative: !!config.authoritative,
  };
}

function setYawQuaternion(player, yaw) {
  const halfYaw = yaw * 0.5;
  player.heading = yaw;
  player.rx = 0;
  player.ry = Math.sin(halfYaw);
  player.rz = 0;
  player.rw = Math.cos(halfYaw);
}

export function initializeAuthoritativeKart(player, spawn = {}) {
  const x = safeNumber(spawn.x, 0);
  const y = safeNumber(spawn.y, 2.5);
  const z = safeNumber(spawn.z, 0);
  player.x = x;
  player.y = y;
  player.z = z;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  const heading = Number.isFinite(spawn.heading)
    ? spawn.heading
    : Math.atan2(-x, -z);
  setYawQuaternion(player, heading);
}

export function applyAuthoritativeKartStep(player, input, deltaTime, sanitizePosition) {
  const dt = Math.max(0.001, safeNumber(deltaTime, 0) / 1000);
  const spdMult = safeNumber(player.speedMultiplier, 1) || 1;
  const strMult = safeNumber(player.steerMultiplier, 1) || 1;
  const maxSpeed = 36 * spdMult;
  const accelForce = 60 * spdMult;
  const turnBase = 3.25 * strMult;
  const turnMin = 1.1;
  const lateralGrip = 0.8;
  const driftGripMul = 0.42;
  const coastDrag = 0.968;
  const brakeDrag = 0.84;
  const heading = Number.isFinite(player.heading)
    ? player.heading
    : Math.atan2(2 * safeNumber(player.rw, 1) * safeNumber(player.ry, 0), 1 - 2 * safeNumber(player.ry, 0) * safeNumber(player.ry, 0));

  let nextHeading = heading;
  let vx = safeNumber(player.vx, 0);
  let vz = safeNumber(player.vz, 0);
  const hSpeed = Math.sqrt(vx * vx + vz * vz);
  const speedRatio = maxSpeed > 0 ? Math.min(hSpeed / maxSpeed, 1) : 0;
  const turnSpeed = turnBase - (turnBase - turnMin) * speedRatio;
  const forwardX = Math.sin(nextHeading);
  const forwardZ = Math.cos(nextHeading);
  const facingDot = vx * forwardX + vz * forwardZ;
  const isReversing = facingDot < -1;
  const isDrifting = !!input?.drift;

  if (safeNumber(input?.steer, 0) !== 0 && hSpeed > 0.5) {
    const direction = isReversing ? -1 : 1;
    const driftBoost = isDrifting ? 1.26 : 1.0;
    nextHeading += safeNumber(input?.steer, 0) * turnSpeed * direction * driftBoost * dt;
  }

  const nextForwardX = Math.sin(nextHeading);
  const nextForwardZ = Math.cos(nextHeading);
  if (safeNumber(input?.throttle, 0) > 0 && hSpeed < maxSpeed) {
    const falloff = 1 - speedRatio * speedRatio;
    const accel = accelForce * Math.max(falloff, 0.08) * dt;
    vx += nextForwardX * accel;
    vz += nextForwardZ * accel;
  } else if (safeNumber(input?.throttle, 0) < 0) {
    const accel = accelForce * 0.4 * dt;
    vx -= nextForwardX * accel;
    vz -= nextForwardZ * accel;
  }

  if (safeNumber(input?.brake, 0)) {
    vx *= brakeDrag;
    vz *= brakeDrag;
  } else if (safeNumber(input?.throttle, 0) === 0) {
    vx *= coastDrag;
    vz *= coastDrag;
  }

  const rightX = Math.cos(nextHeading);
  const rightZ = -Math.sin(nextHeading);
  const latSpeed = vx * rightX + vz * rightZ;
  const grip = isDrifting ? lateralGrip * driftGripMul : lateralGrip;
  vx -= rightX * latSpeed * grip;
  vz -= rightZ * latSpeed * grip;

  if (Math.abs(vx) < 0.001) vx = 0;
  if (Math.abs(vz) < 0.001) vz = 0;

  const previous = { x: player.x, y: player.y, z: player.z };
  const next = sanitizePosition(previous, {
    x: previous.x + vx * dt,
    y: previous.y,
    z: previous.z + vz * dt,
  });
  if (!next) return false;

  player.x = next.x;
  player.y = next.y;
  player.z = next.z;
  player.vx = vx;
  player.vy = 0;
  player.vz = vz;
  setYawQuaternion(player, nextHeading);
  player.lastProcessedInput = safeNumber(input?.seq, player.lastProcessedInput || 0);
  return true;
}

export function applyRealtimeTransform(player, input, deltaTime, sanitizePosition) {
  if (!player || !input) return false;
  if (
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y) ||
    !Number.isFinite(input.z) ||
    !Number.isFinite(input.rx) ||
    !Number.isFinite(input.ry) ||
    !Number.isFinite(input.rz) ||
    !Number.isFinite(input.rw)
  ) {
    return false;
  }

  const prev = { x: player.x, y: player.y, z: player.z };
  const next = sanitizePosition(prev, { x: input.x, y: input.y, z: input.z });
  if (!next) return false;

  const dtSeconds = Math.max(0.001, safeNumber(deltaTime, 0) / 1000);
  player.vx = (next.x - prev.x) / dtSeconds;
  player.vy = (next.y - prev.y) / dtSeconds;
  player.vz = (next.z - prev.z) / dtSeconds;
  player.x = next.x;
  player.y = next.y;
  player.z = next.z;
  player.rx = input.rx;
  player.ry = input.ry;
  player.rz = input.rz;
  player.rw = input.rw;
  player.heading = Math.atan2(2 * input.rw * input.ry, 1 - 2 * input.ry * input.ry);
  player.lastProcessedInput = input.seq;
  return true;
}

export function resolveAuthoritativeKartContacts(playersMap, deltaTime, sanitizePosition) {
  const dt = Math.max(0.001, safeNumber(deltaTime, 0) / 1000);
  const players = [];
  playersMap.forEach((player) => {
    if (!player) return;
    players.push(player);
  });

  const impacts = [];
  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const a = players[i];
      const b = players[j];
      if (!a || !b || a.phased || b.phased) continue;

      const contact = computeKartContact(a, b, KART_CONTACT_BOX);
      if (!contact) continue;

      const separation = Math.max(0.02, contact.overlap + 0.04) * 0.5;
      const prevA = { x: a.x, y: a.y, z: a.z };
      const prevB = { x: b.x, y: b.y, z: b.z };
      const nextA = sanitizePosition(prevA, {
        x: prevA.x - contact.normalX * separation,
        y: prevA.y,
        z: prevA.z - contact.normalZ * separation,
      }) || prevA;
      const nextB = sanitizePosition(prevB, {
        x: prevB.x + contact.normalX * separation,
        y: prevB.y,
        z: prevB.z + contact.normalZ * separation,
      }) || prevB;

      a.x = nextA.x;
      a.y = nextA.y;
      a.z = nextA.z;
      b.x = nextB.x;
      b.y = nextB.y;
      b.z = nextB.z;

      const normalX = contact.normalX;
      const normalZ = contact.normalZ;
      const velocityAlongNormalA = safeNumber(a.vx, 0) * normalX + safeNumber(a.vz, 0) * normalZ;
      const velocityAlongNormalB = safeNumber(b.vx, 0) * normalX + safeNumber(b.vz, 0) * normalZ;
      const approachA = Math.max(0, velocityAlongNormalA);
      const approachB = Math.max(0, -velocityAlongNormalB);
      const closingSpeed = Math.max(0, approachA + approachB);
      const impulse = Math.min(14, Math.max(0.3, closingSpeed * 0.55 + contact.overlap * 9));

      a.vx = safeNumber(a.vx, 0) - normalX * impulse;
      a.vz = safeNumber(a.vz, 0) - normalZ * impulse;
      b.vx = safeNumber(b.vx, 0) + normalX * impulse;
      b.vz = safeNumber(b.vz, 0) + normalZ * impulse;

      const severity = Math.max(0, closingSpeed - 4.5) + contact.overlap * 3.2;
      const damageBasis = Math.max(0, closingSpeed - 7.5);
      const baseDamage = damageBasis > 0 ? Math.min(18, Math.round(damageBasis * 1.7)) : 0;
      const closingTotal = Math.max(0.001, approachA + approachB);
      const damageA = baseDamage > 0
        ? Math.min(18, Math.round(baseDamage * (0.35 + 0.65 * (approachB / closingTotal))))
        : 0;
      const damageB = baseDamage > 0
        ? Math.min(18, Math.round(baseDamage * (0.35 + 0.65 * (approachA / closingTotal))))
        : 0;
      impacts.push({
        playerA: a,
        playerB: b,
        aggressorA: approachA > approachB + 0.75,
        aggressorB: approachB > approachA + 0.75,
        closingSpeed,
        approachA,
        approachB,
        severity,
        damageA,
        damageB,
        hitX: contact.contactX,
        hitY: Math.max(a.y, b.y) + 0.75,
        hitZ: contact.contactZ,
        normalX,
        normalZ,
        separationDistance: separation,
        deltaTime: dt,
      });
    }
  }

  return impacts;
}

export const REALTIME_SYNC_DEFAULTS = {
  simulationHz: DEFAULT_SIMULATION_HZ,
  staleInputMs: DEFAULT_STALE_INPUT_MS,
  countdownMs: DEFAULT_COUNTDOWN_MS,
};