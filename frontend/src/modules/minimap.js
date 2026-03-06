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
  mapId: 'map1', // Default map ID
  worldScale: 8,  // Track world scale (8 for custom maps, 1 for STK)
};

// Create the minimap canvas
export function createMinimap(mapId, scene) {
  // Use provided mapId or default to map1
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
  
  // Style the canvas
  minimap.canvas.style.position = 'absolute';
  minimap.canvas.style.top = '20px';
  minimap.canvas.style.right = '20px';
  minimap.canvas.style.width = `${minimap.size}px`;
  minimap.canvas.style.height = `${minimap.size}px`;
  minimap.canvas.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  minimap.canvas.style.borderRadius = '10px';
  minimap.canvas.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
  minimap.canvas.style.zIndex = '1000';
  
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