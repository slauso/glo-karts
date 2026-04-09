export const GRID_SIZE = 10;

export const OCCUPANCY_LAYERS = {
  surface: 'surface',
  obstacle: 'obstacle',
  start: 'start',
};

export function snapToGrid(value) {
  return Math.round(Number(value || 0) / GRID_SIZE) * GRID_SIZE;
}

export function normalizeCell(x, z) {
  return {
    x: snapToGrid(x),
    z: snapToGrid(z),
  };
}

export function cellKey(x, z) {
  const cell = normalizeCell(x, z);
  return `${cell.x}:${cell.z}`;
}

export function createOccupancyIndex({ roadCells = [], segments = [], obstacles = [], startPositions = [] } = {}) {
  const layers = {
    [OCCUPANCY_LAYERS.surface]: new Map(),
    [OCCUPANCY_LAYERS.obstacle]: new Map(),
    [OCCUPANCY_LAYERS.start]: new Map(),
  };

  roadCells.forEach((roadCell) => {
    if (!roadCell?.position) return;
    layers.surface.set(cellKey(roadCell.position.x, roadCell.position.z), {
      layer: OCCUPANCY_LAYERS.surface,
      type: 'road',
      id: roadCell.id,
    });
  });

  segments.forEach((segment) => {
    if (!segment?.position) return;
    layers.surface.set(cellKey(segment.position.x, segment.position.z), {
      layer: OCCUPANCY_LAYERS.surface,
      type: 'segment',
      id: segment.id,
    });
  });

  obstacles.forEach((obstacle) => {
    if (!obstacle?.position) return;
    layers.obstacle.set(cellKey(obstacle.position.x, obstacle.position.z), {
      layer: OCCUPANCY_LAYERS.obstacle,
      type: 'obstacle',
      id: obstacle.id,
    });
  });

  startPositions.forEach((start) => {
    if (!start?.position) return;
    layers.start.set(cellKey(start.position.x, start.position.z), {
      layer: OCCUPANCY_LAYERS.start,
      type: 'start',
      id: start.id,
    });
  });

  return layers;
}

export function getOccupant(index, layer, x, z) {
  return index?.[layer]?.get(cellKey(x, z)) || null;
}

export function canPlaceSurface(index, x, z, ignore = null) {
  const occupant = getOccupant(index, OCCUPANCY_LAYERS.surface, x, z);
  return !occupant || (ignore && occupant.type === ignore.type && occupant.id === ignore.id);
}

export function canPlaceObstacle(index, x, z, ignore = null) {
  const occupant = getOccupant(index, OCCUPANCY_LAYERS.obstacle, x, z);
  return !occupant || (ignore && occupant.type === ignore.type && occupant.id === ignore.id);
}

export function canPlaceStart(index, x, z, ignore = null) {
  const occupant = getOccupant(index, OCCUPANCY_LAYERS.start, x, z);
  return !occupant || (ignore && occupant.type === ignore.type && occupant.id === ignore.id);
}