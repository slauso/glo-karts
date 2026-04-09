const PLAYER_HEIGHT = 1.8;
const PLAYER_RADIUS = 0.4;
const ARENA_WALL_HEIGHT = 12;

export const FPS_ARENA_DIMENSIONS = {
  halfSize: 110,
  wallThickness: 4,
  playerHeight: PLAYER_HEIGHT,
  playerRadius: PLAYER_RADIUS,
};

export const FPS_ARENA_WALLS = [
  { x: 0, y: 6, z: -110, w: 220, h: ARENA_WALL_HEIGHT, d: 4 },
  { x: 0, y: 6, z: 110, w: 220, h: ARENA_WALL_HEIGHT, d: 4 },
  { x: -110, y: 6, z: 0, w: 4, h: ARENA_WALL_HEIGHT, d: 220 },
  { x: 110, y: 6, z: 0, w: 4, h: ARENA_WALL_HEIGHT, d: 220 },
];

export const FPS_ARENA_COVER_BLOCKS = [
  { x: -54, y: 1.6, z: -32, w: 8, h: 3.2, d: 4, rotationY: 0.18 },
  { x: -18, y: 1.35, z: -46, w: 6, h: 2.7, d: 5, rotationY: 0.72 },
  { x: 18, y: 1.9, z: -34, w: 10, h: 3.8, d: 4.2, rotationY: 0.28 },
  { x: 52, y: 1.45, z: -22, w: 6.5, h: 2.9, d: 6, rotationY: 1.02 },
  { x: -64, y: 1.7, z: 18, w: 9.5, h: 3.4, d: 4.4, rotationY: 1.22 },
  { x: -28, y: 1.1, z: 14, w: 5.5, h: 2.2, d: 5.2, rotationY: 0.12 },
  { x: 0, y: 2.05, z: 8, w: 12, h: 4.1, d: 4.5, rotationY: 0.62 },
  { x: 34, y: 1.4, z: 20, w: 6.2, h: 2.8, d: 6.4, rotationY: 1.44 },
  { x: 64, y: 1.75, z: 36, w: 9, h: 3.5, d: 4.8, rotationY: 0.42 },
  { x: -36, y: 1.55, z: 58, w: 8.2, h: 3.1, d: 4.1, rotationY: 1.18 },
  { x: 12, y: 1.25, z: 48, w: 5.2, h: 2.5, d: 5.6, rotationY: 0.82 },
  { x: 56, y: 1.95, z: -58, w: 10.5, h: 3.9, d: 4.4, rotationY: 1.12 },
];

const IMPORTED_PROP_COLLIDER_LIBRARY = {
  'cannon.glb': [
    { center: { x: 0, y: 0.35, z: 0.05 }, size: { x: 1.8, y: 0.7, z: 1.4 }, rotationY: 0 },
    { center: { x: 0.1, y: 0.9, z: 0.35 }, size: { x: 0.8, y: 0.8, z: 1.8 }, rotationY: 0.14 },
    { center: { x: 0.05, y: 1.45, z: 0.9 }, size: { x: 0.55, y: 0.55, z: 1.9 }, rotationY: 0.02 },
  ],
  'frostAxe.glb': [
    { center: { x: 0, y: 0.3, z: 0 }, size: { x: 1.15, y: 0.6, z: 1.15 }, rotationY: 0 },
    { center: { x: 0.12, y: 0.95, z: 0.1 }, size: { x: 0.65, y: 1.2, z: 2.6 }, rotationY: 0.38 },
    { center: { x: 0.55, y: 1.55, z: -0.25 }, size: { x: 1.6, y: 0.65, z: 1.1 }, rotationY: 0.88 },
  ],
  'moltenDagger.glb': [
    { center: { x: 0, y: 0.28, z: 0 }, size: { x: 0.95, y: 0.56, z: 0.95 }, rotationY: 0 },
    { center: { x: 0.08, y: 0.82, z: 0.22 }, size: { x: 0.46, y: 0.8, z: 2.05 }, rotationY: 0.18 },
    { center: { x: 0.22, y: 1.26, z: 0.88 }, size: { x: 0.38, y: 0.42, z: 1.45 }, rotationY: 0.08 },
  ],
};

export const FPS_IMPORTED_COVER_PROPS = [
  { file: 'cannon.glb', x: -74, y: 1.6, z: -6, rotationY: 0.62, scale: 1.05 },
  { file: 'frostAxe.glb', x: -8, y: 1.55, z: -72, rotationY: 1.14, scale: 1.08 },
  { file: 'moltenDagger.glb', x: 68, y: 1.45, z: -18, rotationY: 0.38, scale: 1.02 },
  { file: 'cannon.glb', x: -58, y: 1.5, z: 46, rotationY: 1.3, scale: 0.98 },
  { file: 'frostAxe.glb', x: 6, y: 1.55, z: 74, rotationY: 0.2, scale: 1.12 },
  { file: 'moltenDagger.glb', x: 74, y: 1.45, z: 28, rotationY: 1.54, scale: 1.05 },
];

export function getArenaGroundHeight(x, z) {
  return Math.sin(x * 0.06) * 1.4 + Math.cos(z * 0.05) * 1.1 + Math.sin((x + z) * 0.03) * 1.8;
}

function rotatePoint(point, rotationY) {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return {
    x: point.x * c - point.z * s,
    y: point.y,
    z: point.x * s + point.z * c,
  };
}

function computeRotatedAabb(center, size, rotationY = 0) {
  const hx = size.x * 0.5;
  const hy = size.y * 0.5;
  const hz = size.z * 0.5;
  const corners = [
    { x: -hx, y: -hy, z: -hz },
    { x: hx, y: -hy, z: -hz },
    { x: -hx, y: hy, z: -hz },
    { x: hx, y: hy, z: -hz },
    { x: -hx, y: -hy, z: hz },
    { x: hx, y: -hy, z: hz },
    { x: -hx, y: hy, z: hz },
    { x: hx, y: hy, z: hz },
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const rotated = rotatePoint(corner, rotationY);
    const wx = center.x + rotated.x;
    const wy = center.y + rotated.y;
    const wz = center.z + rotated.z;
    minX = Math.min(minX, wx);
    minY = Math.min(minY, wy);
    minZ = Math.min(minZ, wz);
    maxX = Math.max(maxX, wx);
    maxY = Math.max(maxY, wy);
    maxZ = Math.max(maxZ, wz);
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function getImportedPropColliderBoxes(prop) {
  const localBoxes = IMPORTED_PROP_COLLIDER_LIBRARY[prop.file] || [];
  return localBoxes.map((box) => {
    const scaledCenter = {
      x: box.center.x * prop.scale,
      y: box.center.y * prop.scale,
      z: box.center.z * prop.scale,
    };
    const rotatedCenter = rotatePoint(scaledCenter, prop.rotationY);
    return {
      center: {
        x: prop.x + rotatedCenter.x,
        y: prop.y + rotatedCenter.y,
        z: prop.z + rotatedCenter.z,
      },
      size: {
        x: box.size.x * prop.scale,
        y: box.size.y * prop.scale,
        z: box.size.z * prop.scale,
      },
      rotationY: prop.rotationY + box.rotationY,
      file: prop.file,
    };
  });
}

export function buildArenaCollisionBoxes() {
  const boxes = [];

  for (const wall of FPS_ARENA_WALLS) {
    boxes.push(computeRotatedAabb(
      { x: wall.x, y: wall.y, z: wall.z },
      { x: wall.w, y: wall.h, z: wall.d },
      0,
    ));
  }

  for (const block of FPS_ARENA_COVER_BLOCKS) {
    boxes.push(computeRotatedAabb(
      { x: block.x, y: block.y, z: block.z },
      { x: block.w, y: block.h, z: block.d },
      block.rotationY,
    ));
  }

  for (const prop of FPS_IMPORTED_COVER_PROPS) {
    for (const box of getImportedPropColliderBoxes(prop)) {
      boxes.push(computeRotatedAabb(box.center, box.size, box.rotationY));
    }
  }

  return boxes;
}

export function normalizeAngle(angle) {
  let next = angle;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

export function getDefaultFpsSpawn(index = 0) {
  const angles = [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5, Math.PI * 0.25, Math.PI * 1.25, Math.PI * 0.75, Math.PI * 1.75];
  const radii = [24, 24, 28, 28, 36, 36, 44, 44];
  const angle = angles[index % angles.length];
  const radius = radii[index % radii.length];
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return {
    x,
    z,
    y: getArenaGroundHeight(x, z) + PLAYER_HEIGHT * 0.5,
    yaw: normalizeAngle(angle + Math.PI),
  };
}