const DEFAULT_HEADING = 0;

export const KART_HURTBOX = Object.freeze({
  halfWidth: 1.0,
  halfHeight: 0.9,
  halfLength: 1.75,
  centerYOffset: 0.8,
});

export const KART_CONTACT_BOX = Object.freeze({
  halfWidth: 1.15,
  halfLength: 1.9,
  centerYOffset: 0.0,
  maxVerticalDelta: 1.6,
});

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getPlayerHeading(player) {
  if (Number.isFinite(player?.heading)) {
    return Number(player.heading);
  }
  const ry = safeNumber(player?.ry, 0);
  const rw = safeNumber(player?.rw, 1);
  return Math.atan2(2 * rw * ry, 1 - 2 * ry * ry) || DEFAULT_HEADING;
}

export function getKartAxes(heading) {
  const yaw = safeNumber(heading, DEFAULT_HEADING);
  return {
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw),
    forwardX: Math.sin(yaw),
    forwardZ: Math.cos(yaw),
  };
}

export function getKartCenter(player, profile = KART_HURTBOX) {
  return {
    x: safeNumber(player?.x, 0),
    y: safeNumber(player?.y, 0) + safeNumber(profile?.centerYOffset, 0),
    z: safeNumber(player?.z, 0),
  };
}

function worldToKartLocal(point, player, profile = KART_HURTBOX) {
  const center = getKartCenter(player, profile);
  const heading = getPlayerHeading(player);
  const dx = safeNumber(point?.x, 0) - center.x;
  const dy = safeNumber(point?.y, 0) - center.y;
  const dz = safeNumber(point?.z, 0) - center.z;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);

  return {
    x: dx * cos - dz * sin,
    y: dy,
    z: dx * sin + dz * cos,
  };
}

export function computeDistanceSqToKart(point, player, radius = 0, profile = KART_HURTBOX) {
  const local = worldToKartLocal(point, player, profile);
  const halfWidth = safeNumber(profile?.halfWidth, KART_HURTBOX.halfWidth) + Math.max(0, safeNumber(radius, 0));
  const halfHeight = safeNumber(profile?.halfHeight, KART_HURTBOX.halfHeight) + Math.max(0, safeNumber(radius, 0));
  const halfLength = safeNumber(profile?.halfLength, KART_HURTBOX.halfLength) + Math.max(0, safeNumber(radius, 0));
  const dx = Math.max(0, Math.abs(local.x) - halfWidth);
  const dy = Math.max(0, Math.abs(local.y) - halfHeight);
  const dz = Math.max(0, Math.abs(local.z) - halfLength);
  return dx * dx + dy * dy + dz * dz;
}

function segmentIntersectsExpandedAabb(start, end, halfWidth, halfHeight, halfLength) {
  const d = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };

  let tMin = 0;
  let tMax = 1;
  const bounds = [
    { axis: "x", min: -halfWidth, max: halfWidth },
    { axis: "y", min: -halfHeight, max: halfHeight },
    { axis: "z", min: -halfLength, max: halfLength },
  ];

  for (const { axis, min, max } of bounds) {
    const startAxis = start[axis];
    const deltaAxis = d[axis];
    if (Math.abs(deltaAxis) < 1e-8) {
      if (startAxis < min || startAxis > max) {
        return false;
      }
      continue;
    }

    const inv = 1 / deltaAxis;
    let t1 = (min - startAxis) * inv;
    let t2 = (max - startAxis) * inv;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) {
      return false;
    }
  }

  return true;
}

export function segmentIntersectsKart(start, end, player, radius = 0, profile = KART_HURTBOX) {
  const localStart = worldToKartLocal(start, player, profile);
  const localEnd = worldToKartLocal(end, player, profile);
  const padding = Math.max(0, safeNumber(radius, 0));
  const halfWidth = safeNumber(profile?.halfWidth, KART_HURTBOX.halfWidth) + padding;
  const halfHeight = safeNumber(profile?.halfHeight, KART_HURTBOX.halfHeight) + padding;
  const halfLength = safeNumber(profile?.halfLength, KART_HURTBOX.halfLength) + padding;
  return segmentIntersectsExpandedAabb(localStart, localEnd, halfWidth, halfHeight, halfLength);
}

function buildKartPose(player, x, y, z) {
  return {
    x,
    y,
    z,
    heading: getPlayerHeading(player),
    rx: player?.rx,
    ry: player?.ry,
    rz: player?.rz,
    rw: player?.rw,
  };
}

export function segmentIntersectsMovingKart(start, end, player, deltaTimeMs, radius = 0, profile = KART_HURTBOX) {
  if (!player) return false;

  const dt = Math.max(0, safeNumber(deltaTimeMs, 0) / 1000);
  const moveX = safeNumber(player?.vx, 0) * dt;
  const moveY = safeNumber(player?.vy, 0) * dt;
  const moveZ = safeNumber(player?.vz, 0) * dt;
  const travelSq = moveX * moveX + moveY * moveY + moveZ * moveZ;

  if (travelSq <= 1e-6) {
    return segmentIntersectsKart(start, end, player, radius, profile);
  }

  const currentPose = buildKartPose(player, safeNumber(player?.x, 0), safeNumber(player?.y, 0), safeNumber(player?.z, 0));
  const previousPose = buildKartPose(player, currentPose.x - moveX, currentPose.y - moveY, currentPose.z - moveZ);
  const midPose = buildKartPose(
    player,
    currentPose.x - moveX * 0.5,
    currentPose.y - moveY * 0.5,
    currentPose.z - moveZ * 0.5,
  );

  return segmentIntersectsKart(start, end, currentPose, radius, profile)
    || segmentIntersectsKart(start, end, previousPose, radius, profile)
    || segmentIntersectsKart(start, end, midPose, radius, profile);
}

function projectRectOntoAxis(axisX, axisZ, rectAxes, profile) {
  return (
    safeNumber(profile?.halfWidth, KART_CONTACT_BOX.halfWidth) * Math.abs(axisX * rectAxes.rightX + axisZ * rectAxes.rightZ)
    + safeNumber(profile?.halfLength, KART_CONTACT_BOX.halfLength) * Math.abs(axisX * rectAxes.forwardX + axisZ * rectAxes.forwardZ)
  );
}

export function computeKartContact(a, b, profile = KART_CONTACT_BOX) {
  if (!a || !b) return null;
  const maxVerticalDelta = safeNumber(profile?.maxVerticalDelta, KART_CONTACT_BOX.maxVerticalDelta);
  if (Math.abs(safeNumber(a.y, 0) - safeNumber(b.y, 0)) > maxVerticalDelta) {
    return null;
  }

  const centerA = getKartCenter(a, profile);
  const centerB = getKartCenter(b, profile);
  const diffX = centerB.x - centerA.x;
  const diffZ = centerB.z - centerA.z;
  const axesA = getKartAxes(getPlayerHeading(a));
  const axesB = getKartAxes(getPlayerHeading(b));
  const testAxes = [
    { x: axesA.rightX, z: axesA.rightZ },
    { x: axesA.forwardX, z: axesA.forwardZ },
    { x: axesB.rightX, z: axesB.rightZ },
    { x: axesB.forwardX, z: axesB.forwardZ },
  ];

  let minOverlap = Infinity;
  let collisionNormal = null;

  for (const axis of testAxes) {
    const distance = Math.abs(diffX * axis.x + diffZ * axis.z);
    const radiusA = projectRectOntoAxis(axis.x, axis.z, axesA, profile);
    const radiusB = projectRectOntoAxis(axis.x, axis.z, axesB, profile);
    const overlap = radiusA + radiusB - distance;
    if (overlap <= 0) {
      return null;
    }
    if (overlap < minOverlap) {
      minOverlap = overlap;
      const sign = (diffX * axis.x + diffZ * axis.z) < 0 ? -1 : 1;
      collisionNormal = { x: axis.x * sign, z: axis.z * sign };
    }
  }

  if (!collisionNormal) {
    return null;
  }

  return {
    overlap: minOverlap,
    normalX: collisionNormal.x,
    normalZ: collisionNormal.z,
    contactX: (centerA.x + centerB.x) * 0.5,
    contactY: Math.max(centerA.y, centerB.y),
    contactZ: (centerA.z + centerB.z) * 0.5,
  };
}