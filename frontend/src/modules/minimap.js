import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { hasTrackOutline, getTrackScale } from './track-data.js';

// Store minimap state
const minimap = {
  canvas: null,
  ctx: null,
  size: 200,
  trackData: null,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  mapId: 'test_box', // Default map ID
  worldScale: 8,  // Track world scale (8 for custom maps, 1 for STK)
  // Battle mode fields
  battleMode: false,
  aabb: null,          // { min:{x,z}, max:{x,z} }
  itemPositions: null,  // [{x,z}, ...]
  _lastUpdateMs: 0,     // throttle at ~10 fps
};

function styleMinimapCanvas(battleMode = false) {
  if (!minimap.canvas) return;
  Object.assign(minimap.canvas.style, battleMode ? {
    position: 'absolute',
    top: '98px',
    right: '22px',
    width: `${minimap.size}px`,
    height: `${minimap.size}px`,
    background: 'radial-gradient(circle at 30% 24%, rgba(255,255,255,0.12), rgba(16,22,34,0.7) 42%, rgba(8,10,16,0.88) 100%)',
    border: '1px solid rgba(228,236,255,0.18)',
    borderRadius: '24px',
    boxShadow: '0 18px 48px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.12)',
    zIndex: '1000',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  } : {
    position: 'absolute',
    top: '20px',
    right: '20px',
    width: `${minimap.size}px`,
    height: `${minimap.size}px`,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: '10px',
    boxShadow: '0 0 10px rgba(0, 0, 0, 0.5)',
    zIndex: '1000',
  });
}

// Create the minimap canvas
export function createMinimap(mapId, scene) {
  // Use provided mapId or default to test_box
  if (mapId) {
    minimap.mapId = mapId;
  }
  minimap.scene = scene || null;
  
  // Store the world scale for this track
  minimap.worldScale = getTrackScale(mapId);
  
  // Create canvas element
  minimap.canvas = document.createElement('canvas');
  minimap.canvas.id = 'minimap';
  minimap.canvas.width = minimap.size;
  minimap.canvas.height = minimap.size;
  styleMinimapCanvas(false);
  
  // Get drawing context
  minimap.ctx = minimap.canvas.getContext('2d');
  
  // Add to document
  document.body.appendChild(minimap.canvas);
  
  // Load the track curve for minimap
  loadTrackCurve(minimap.mapId);
  
  console.log(`Minimap created for map: ${minimap.mapId}`);
  return minimap;
}

// Load the Bezier curve model for the track
function loadTrackCurve(mapId) {
  // STK tracks don't have track-outline.glb — we'll use the track model fallback
  if (!hasTrackOutline(mapId)) {
    console.log(`Skipping track outline for ${mapId} (will use track model fallback)`);
    return;
  }

  const trackOutlinePath = `/models/maps/${mapId}/track-outline.glb`;
  console.log(`Loading track outline from: ${trackOutlinePath}`);

  const lastSlash = trackOutlinePath.lastIndexOf('/');
  const dir = trackOutlinePath.substring(0, lastSlash + 1);
  const file = trackOutlinePath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync("", dir, file, minimap.scene).then((result) => {
    console.log(`Track curve model loaded for minimap (${mapId})`);
    extractCurvePoints(result.meshes);
    // Dispose loaded meshes — only needed vertex data for 2D canvas
    result.meshes.forEach(m => m.dispose());
  }).catch((error) => {
    console.error(`Error loading track curve for ${mapId}:`, error);
    console.log('Will use regular track model as fallback');
  });
}

// Add a function to update the minimap if the map changes
export function updateMinimapTrack(mapId) {
  if (mapId && mapId !== minimap.mapId) {
    minimap.mapId = mapId;
    console.log(`Updating minimap for new map: ${mapId}`);
    
    // Clear existing track data
    minimap.trackData = null;
    
    // Load the new track outline
    loadTrackCurve(mapId);
  }
}

// Extract points from the Bezier curve model
function extractCurvePoints(meshes) {
  if (!meshes || meshes.length === 0) {
    console.error('No meshes available for curve extraction');
    return;
  }

  console.log('Extracting curve points for minimap...');
  const curvePoints = [];

  meshes.forEach(mesh => {
    if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) return;
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) return;

    mesh.computeWorldMatrix(true);
    const worldMatrix = mesh.getWorldMatrix();

    for (let i = 0; i < positions.length; i += 3) {
      const local = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
      const world = Vector3.TransformCoordinates(local, worldMatrix);
      curvePoints.push({ x: world.x, z: world.z });
    }
  });
  
  if (curvePoints.length === 0) {
    console.error('No curve points found in the model');
    return;
  }
  
  console.log(`Extracted ${curvePoints.length} curve points for minimap`);
  
  // Process the curve points for the minimap
  processCurvePoints(curvePoints);
}

// Process curve points to display on minimap
function processCurvePoints(curvePoints) {
  // Find the bounds of the track curve
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  curvePoints.forEach(point => {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  });
  
  // Calculate scale and offset to fit the minimap
  const trackWidth = maxX - minX;
  const trackHeight = maxZ - minZ;
  const availableSize = minimap.size - 20; // 10px padding on each side
  
  // Calculate scale to fit the track in the minimap
  const scaleX = availableSize / trackWidth;
  const scaleZ = availableSize / trackHeight;
  minimap.scale = Math.min(scaleX, scaleZ) * 0.9; // 90% of available space
  
  // Calculate offsets to center the track
  minimap.offsetX = (minimap.size / 2) - ((minX + maxX) / 2 * minimap.scale);
  minimap.offsetY = (minimap.size / 2) - ((minZ + maxZ) / 2 * minimap.scale);
  
  // Store track data
  minimap.trackData = curvePoints;
  
  console.log('Track curve data processed', {
    bounds: { minX, maxX, minZ, maxZ },
    scale: minimap.scale,
    offset: { x: minimap.offsetX, y: minimap.offsetY }
  });
  
  // Draw the track immediately
  drawTrack();
}

// Convert 3D world coordinates to minimap coordinates
function worldToMinimap(x, z) {
  return {
    x: x * minimap.scale + minimap.offsetX,
    y: z * minimap.scale + minimap.offsetY
  };
}

// Draw the track on the minimap with a gradient fill (simpler version)
function drawTrack() {
  if (!minimap.ctx || !minimap.trackData) return;
  
  // Clear the canvas
  minimap.ctx.clearRect(0, 0, minimap.size, minimap.size);
  // Shadow for glow effect
  minimap.ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  minimap.ctx.shadowBlur = 5;
  // First draw a wider stroke for the track "body"
  minimap.ctx.beginPath();
  
  let started = false;
  minimap.trackData.forEach((point, index) => {
    const { x, y } = worldToMinimap(point.x, point.z);
    
    if (!started) {
      minimap.ctx.moveTo(x, y);
      started = true;
    } else {
      minimap.ctx.lineTo(x, y);
    }
  });
  
  // Close the path if it's a loop
  if (minimap.trackData.length > 2) {
    const firstPoint = minimap.trackData[0];
    const lastPoint = minimap.trackData[minimap.trackData.length - 1];
    
    // If the first and last points are close, connect them
    const dist = Math.hypot(firstPoint.x - lastPoint.x, firstPoint.z - lastPoint.z);
    if (dist < 5) {
      minimap.ctx.closePath();
    }
  }
  
  // Create a thick stroke with gradient
  minimap.ctx.lineWidth = 10;
  
  const gradient = minimap.ctx.createLinearGradient(0, 0, minimap.size, minimap.size);
  gradient.addColorStop(0, '#4dc9ff');     // Blue (speedometer start)
  gradient.addColorStop(1, '#ff0080');     // Pink (speedometer end)
  
  minimap.ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  minimap.ctx.stroke();
  
  
  // Reset shadow
  minimap.ctx.shadowBlur = 0;
}

// Keep the original extractTrackData function as a fallback
export function extractTrackData(trackModel) {
  console.log(`Using dedicated track curve for minimap (${minimap.mapId}). Regular track model not needed.`);
  
  // If we already have track data, we don't need to extract it again
  if (minimap.trackData) {
    return minimap.trackData;
  }
  
  // If the curve model failed to load, fall back to extracting from the track model
  if (trackModel) {
    console.log("Falling back to track model for minimap extraction");
    const trackPoints = [];

    const meshes = trackModel.getChildMeshes ? trackModel.getChildMeshes() : [];
    meshes.forEach(mesh => {
      if (!mesh.getTotalVertices || mesh.getTotalVertices() === 0) return;
      const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
      if (!positions) return;

      mesh.computeWorldMatrix(true);
      const worldMatrix = mesh.getWorldMatrix();

      // Take fewer points for performance (every 20th vertex)
      for (let i = 0; i < positions.length; i += 60) {
        const local = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
        const world = Vector3.TransformCoordinates(local, worldMatrix);
        if (Math.abs(world.y) < 0.5) {
          trackPoints.push({ x: world.x, z: world.z });
        }
      }
    });
    
    // Process points
    processCurvePoints(trackPoints);
    return trackPoints;
  }
}

// Update player positions on the minimap
export function updateMinimapPlayers(localPlayer, opponents) {
  if (!minimap.ctx || !minimap.trackData) return;
  
  // Redraw the track first
  drawTrack();
  
  // Draw opponent players as white dots
  if (opponents) {
    Object.values(opponents).forEach(opponent => {
      // Only draw if the model exists and is visible
      if (opponent.model && (opponent.model.isEnabled ? opponent.model.isEnabled() : true)) {
        const ws = minimap.worldScale || 8;
        const { x, y } = worldToMinimap(opponent.model.position.x/ws, opponent.model.position.z/ws);
        
        // Draw white circle for opponents
        minimap.ctx.beginPath();
        minimap.ctx.arc(x, y, 4, 0, Math.PI * 2);
        minimap.ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        minimap.ctx.fill();
      }
    });
  }
  
  // Draw local player as a blue dot
  if (localPlayer) {
    const ws = minimap.worldScale || 8;
    const { x, y } = worldToMinimap(localPlayer.position.x/ws, localPlayer.position.z/ws);
    
    // Draw blue circle for local player
    minimap.ctx.beginPath();
    minimap.ctx.arc(x, y, 5, 0, Math.PI * 2);
    minimap.ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    minimap.ctx.fill();
    minimap.ctx.beginPath();
    minimap.ctx.arc(x, y, 4, 0, Math.PI * 2);
    minimap.ctx.fillStyle = 'rgba(43, 118, 199, 1)';
    minimap.ctx.fill();
  }
}

// ───────────────────────────────────────────────
// Battle minimap support
// ───────────────────────────────────────────────

/**
 * Create/initialise the minimap in battle mode.
 * Instead of a track outline curve we render the arena AABB rectangle.
 * @param {string} mapId
 * @param {{ min:{x:number,z:number}, max:{x:number,z:number} }} aabb
 * @param {{ x:number, z:number }[]} [itemPositions]
 */
export function createBattleMinimap(mapId, aabb, itemPositions) {
  if (minimap.canvas) return; // already created

  minimap.mapId = mapId;
  minimap.battleMode = true;
  minimap.size = 168;
  minimap.worldScale = 1; // battle uses raw world coords
  minimap.aabb = aabb;
  minimap.itemPositions = itemPositions || [];

  // Create canvas (same style as race minimap)
  minimap.canvas = document.createElement('canvas');
  minimap.canvas.id = 'minimap';
  minimap.canvas.width = minimap.size;
  minimap.canvas.height = minimap.size;
  styleMinimapCanvas(true);
  minimap.ctx = minimap.canvas.getContext('2d');
  document.body.appendChild(minimap.canvas);

  // Compute scale/offset from AABB so the rectangle fills the canvas with padding
  const pad = 20;
  const availW = minimap.size - pad * 2;
  const arenaW = aabb.max.x - aabb.min.x;
  const arenaD = aabb.max.z - aabb.min.z;
  const sx = availW / (arenaW || 1);
  const sz = availW / (arenaD || 1);
  minimap.scale = Math.min(sx, sz);
  const cx = (aabb.min.x + aabb.max.x) / 2;
  const cz = (aabb.min.z + aabb.max.z) / 2;
  minimap.offsetX = minimap.size / 2 - cx * minimap.scale;
  minimap.offsetY = minimap.size / 2 - cz * minimap.scale;

  // Mark trackData as non-null so updateMinimapPlayers path works
  minimap.trackData = [];

  drawBattleArena();
  console.log(`[minimap] Battle minimap created for ${mapId}`);
}

/** Draw the static arena rectangle + item dots */
function drawBattleArena() {
  if (!minimap.ctx || !minimap.aabb) return;
  const ctx = minimap.ctx;
  ctx.clearRect(0, 0, minimap.size, minimap.size);
  const gradient = ctx.createLinearGradient(0, 0, minimap.size, minimap.size);
  gradient.addColorStop(0, 'rgba(92, 235, 255, 0.10)');
  gradient.addColorStop(0.5, 'rgba(18, 28, 42, 0.16)');
  gradient.addColorStop(1, 'rgba(255, 94, 176, 0.11)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, minimap.size, minimap.size);

  // Arena boundary rectangle
  const tl = worldToMinimap(minimap.aabb.min.x, minimap.aabb.min.z);
  const br = worldToMinimap(minimap.aabb.max.x, minimap.aabb.max.z);
  const w = br.x - tl.x;
  const h = br.y - tl.y;

  const sweep = ((performance.now() * 0.08) % (w + 36)) - 18;
  ctx.fillStyle = 'rgba(160, 212, 255, 0.05)';
  ctx.fillRect(tl.x, tl.y, w, h);
  ctx.strokeStyle = 'rgba(232, 240, 255, 0.4)';
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x, tl.y, w, h);
  ctx.strokeStyle = 'rgba(96, 214, 255, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const x = tl.x + (w * i / 4);
    const y = tl.y + (h * i / 4);
    ctx.beginPath();
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, tl.y + h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(tl.x, y);
    ctx.lineTo(tl.x + w, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120, 228, 255, 0.12)';
  ctx.fillRect(tl.x + sweep, tl.y, 14, h);

  // Item positions — small yellow dots
  if (minimap.itemPositions) {
    for (const it of minimap.itemPositions) {
      const { x, y } = worldToMinimap(it.x, it.z);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 132, 0.12)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 220, 92, 0.86)';
      ctx.fill();
    }
  }
}

/**
 * Update battle minimap with player blips.
 * @param {object} localMesh      Babylon mesh for local kart
 * @param {string} localSessionId Session ID of local player
 * @param {Map<string, object>} remoteMeshes  sessionId→mesh
 * @param {object} [colyseusPlayers] room.state.players (for team colour)
 */
export function updateBattleMinimapPlayers(localMesh, localSessionId, remoteMeshes, colyseusPlayers) {
  if (!minimap.ctx || !minimap.battleMode) return;

  // Throttle to ~10 fps
  const now = performance.now();
  if (now - minimap._lastUpdateMs < 100) return;
  minimap._lastUpdateMs = now;

  // Redraw static elements
  drawBattleArena();

  const ctx = minimap.ctx;

  // Remote players — red (or blue for team-mates)
  const localTeam = colyseusPlayers?.get?.(localSessionId)?.team;
  if (remoteMeshes) {
    for (const [sid, mesh] of remoteMeshes.entries()) {
      if (!mesh?.position) continue;
      const { x, y } = worldToMinimap(mesh.position.x, mesh.position.z);
      const pState = colyseusPlayers?.get?.(sid);
      const sameTeam = localTeam != null && pState?.team === localTeam;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = sameTeam ? 'rgba(80, 160, 255, 0.16)' : 'rgba(255, 86, 110, 0.16)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = sameTeam ? 'rgba(80, 160, 255, 0.9)' : 'rgba(255, 70, 70, 0.9)';
      ctx.fill();
    }
  }

  // Local player — green with white outline
  if (localMesh) {
    const { x, y } = worldToMinimap(localMesh.position.x, localMesh.position.z);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(92, 245, 208, 1)';
    ctx.fill();
    const forward = localMesh.forward || null;
    if (forward) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + forward.x * 10, y + forward.z * 10);
      ctx.strokeStyle = 'rgba(235, 248, 255, 0.88)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}
