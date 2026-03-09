// ── Babylon.js core imports ─────────────────────────────────────────────────
import { Vector3, Quaternion, Color3 } from '@babylonjs/core/Maths/math';
import { Scene } from '@babylonjs/core/scene';
import { PhysicsMotionType } from '@babylonjs/core/Physics/v2/IPhysicsEnginePlugin';
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/loaders/glTF";
import "./style.css";

// ── Error capture (must be early) ───────────────────────────────────────────
import { initErrorCapture } from './modules/error-capture.js';
initErrorCapture();

// ── Babylon.js rendering engine ─────────────────────────────────────────────
import { initBabylonRenderer } from './modules/babylon-renderer.js';

// ── Game modules (Babylon.js ports) ─────────────────────────────────────────
import { createVehicle, resetCarPosition } from './modules/babylon-car.js';
import { loadTrackModel, loadMapDecorations, checkGroundCollision } from './modules/babylon-track.js';
import { applyStartPosition, getFallThreshold, hasGates, hasDecorations } from './modules/track-data.js';
import { resetKart, setKartRefs } from './modules/havok-physics.js';
import { 
  loadGates, 
  updateGateFading, 
  checkGateProximity, 
  showFinishMessage, 
} from './modules/gates.js';
import { loadTrackData } from './modules/track-data-loader.js';
import {
  initCheckpoints,
  updateCheckpoints,
  getCurrentQuadCenter,
  getCurrentQuadHeading,
  getRaceProgress,
} from './modules/checkpoints.js';
import { 
  initMultiplayer, 
  updateMarkers, 
  sendCarData,
} from './modules/multiplayer.js';
import { initPhysics, updatePhysics, FIXED_PHYSICS_STEP, setPhysicsKartRefs } from './modules/physics.js';
import { createMinimap, extractTrackData, updateMinimapPlayers } from './modules/minimap.js';
import {
  playTrackMusic, playSFX, playFastVariant,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playCountdownSequence, stopBGM, disposeAudio,
  playPreRaceMusic, playPostRaceMusic,
} from './modules/game-audio.js';
import { initParticles, updateParticles, disposeParticles } from './modules/babylon-particles.js';
import { createGloSystem, updateGloSystem, disposeGloSystem } from './modules/babylon-glo.js';
import { createRaceBots, updateRaceBots, getRacePositions, getBotProgress, disposeRaceBots } from './modules/bot-controller.js';
import {
  initRaceItems, updateRaceItems, useCurrentItem,
  getCurrentItem, getActiveEffect, getProjectiles, disposeRaceItems,
  onItemCollected,
} from './modules/race-items.js';
import {
  startGrandPrix, reportRaceResult, hasNextRace, advanceToNextRace,
  getStandings, getCurrentRaceInfo, isGrandPrixActive, endGrandPrix,
  showStandingsOverlay, showFinalResultsOverlay, restoreGrandPrixState,
} from './modules/grand-prix.js';
import { SINGLE_PLAYER_CUPS } from './modules/content-registry.js';
import {
  createPositionBadge, updatePositionBadge,
  createNitroGauge, updateNitroGauge,
  createWrongWayIndicator, showWrongWay,
  playItemRoulette, getWeaponIconHTML,
  createTrafficLight, animateTrafficLight,
  triggerScreenShake, updateScreenShake,
  createDamageVignette, flashDamageVignette,
  disposeHUD,
} from './modules/race-hud.js';
import {
  startRecording, recordFrame, stopRecording,
  loadGhost, spawnGhostKart, updateGhostPlayback, disposeGhost,
} from './modules/ghost-recorder.js';
import {
  initFTL, updateFTL, isFTLActive, getFTLStatus, disposeFTL,
} from './modules/modes/follow-the-leader.js';
import {
  initSoccer, updateSoccer, isSoccerActive, getSoccerScore, disposeSoccer,
} from './modules/modes/soccer.js';
import { publishDebugSnapshot } from './modules/debug-telemetry.js';

// Check for game config from lobby
let gameConfig = null;
let isHost = false;
let allPlayers = [];

try {
  const savedConfig = sessionStorage.getItem('gameConfig');
  if (savedConfig) {
    gameConfig = JSON.parse(savedConfig);
    
    // Check if we're the host
    const myPlayerId = localStorage.getItem('myPlayerId');
    isHost = gameConfig?.players?.some(player => player.id === myPlayerId && player.isHost) ?? false;
    
    console.log('Game config loaded:', gameConfig);
    console.log('Playing as host:', isHost);
    
    // Store player list
    allPlayers = gameConfig?.players || [];
  }
} catch (e) {
  console.error('Error loading game config:', e);
}

// ── Update loading screen with resolved content info ──
{
  const sub = document.querySelector('.loading-subtitle');
  const trackEl = document.getElementById('loading-track');
  const infoEl = document.getElementById('loading-info');
  if (sub && gameConfig) {
    const modeLabels = { quick_race: 'Quick Race', time_trial: 'Time Trial', grand_prix: 'Grand Prix', free_roam: 'Free Roam', follow_the_leader: 'Follow the Leader', soccer: 'Soccer' };
    sub.textContent = modeLabels[gameConfig.modeId || gameConfig.mode] || gameConfig.subMode || 'SINGLE PLAYER';
  }
  if (trackEl && gameConfig) {
    trackEl.textContent = gameConfig.trackLabel || gameConfig.trackId || '';
  }
  if (infoEl && gameConfig) {
    const parts = [];
    const bots = gameConfig.botCount ?? gameConfig.opponents;
    if (typeof bots === 'number') parts.push(`${bots} Opponents`);
    if (gameConfig.cupId) parts.push(`Cup: ${gameConfig.cupLabel || gameConfig.cupId}`);
    if (gameConfig.cupRace) parts.push(`Race ${gameConfig.cupRace}/${gameConfig.cupTotal || 4}`);
    if (parts.length) infoEl.textContent = parts.join('  ·  ');
  }
}

publishDebugSnapshot(gameConfig);

const useColyseusRealtime = Boolean(gameConfig?.multiplayer)
  && String(gameConfig?.multiplayerProvider || '').toLowerCase() === 'colyseus';

if (useColyseusRealtime) {
  window.location.replace('realtime.html');
}

// Global variables
let camera, scene, renderer, controls;
let bRenderer = null; // Babylon.js renderer instance
let debugObjects = [];

// Simple clock replacement (was THREE.Clock)
const clock = { _prev: 0, _started: false, getDelta() {
  const now = performance.now() / 1000;
  if (!this._started) { this._started = true; this._prev = now; return 0; }
  const dt = now - this._prev;
  this._prev = now;
  return dt;
}};

// Car components
let wheelMeshes = [];
let carModel;

// GLO underglow state (created after car loads)
let gloSystem = null;

// Car flip detection
let carFlippedTime = 0;
let carIsFlipped = false;
let prevUpDot = 1.0; // Start assuming car is upright
let upDotDelta = 0;

// Control state
const keyState = {
  w: false, s: false, a: false, d: false
};

// Drift / boost visual feedback state (Task 3.3.4)
const _kartState = { isDrifting: false, sparksLevel: 0, isBoosting: false, _prevDriftTier: 0, _prevBoostActive: false };

// Multiplayer variables
let multiplayerState;

let gateData = null;
let currentGatePosition = new Vector3(0, 2, 0);
let currentGateQuaternion = new Quaternion();
let _stkTrackData = null;  // Loaded track-data.json for STK tracks
let _useCheckpoints = false; // true when STK driveline checkpoints are active

// Race state variables
let raceState = {
  isMultiplayer: false,
  allPlayersConnected: false,
  countdownStarted: false,
  raceStarted: false,
  raceFinished: false,  
  countdownValue: 3
};

// Timer variables
let raceTimer;
let raceStartTime = 0;
let timerInterval;

// Make raceState globally accessible for multiplayer.js
window.raceState = raceState;

// UI Elements
let countdownOverlay;
let waitingForPlayersOverlay;

let leaderboard;
let playerPositions = [];

// Add these spectator variables to your global declarations
let spectatorMode = false;
let spectatedPlayerIndex = -1;
let spectatorUI;
let activeRacers = [];

// Add this variable to your global variables section
let minimapState;

let finalLeaderboardShown = false;

// Grand Prix state
let gpBotNames = []; // names of bot competitors for GP scoring

let playerFinishTimes = {};
window.playerFinishTimes = playerFinishTimes;

let loadingManager;

// Bot AI state
let raceBots = [];


// Create the waiting and countdown UI elements
function createRaceUI() {
  // Create waiting for players overlay
  waitingForPlayersOverlay = document.createElement('div');
  waitingForPlayersOverlay.style.position = 'absolute';
  waitingForPlayersOverlay.style.top = '50%';
  waitingForPlayersOverlay.style.left = '50%';
  waitingForPlayersOverlay.style.transform = 'translate(-50%, -50%)';
  
  // Updated to match speedometer
  waitingForPlayersOverlay.style.background = 'rgba(0, 0, 0, 0.5)'; 
  waitingForPlayersOverlay.style.color = '#fff'; 
  waitingForPlayersOverlay.style.padding = '30px 40px';
  waitingForPlayersOverlay.style.borderRadius = '10px';
  waitingForPlayersOverlay.style.fontFamily = "'Poppins', sans-serif";
  waitingForPlayersOverlay.style.fontSize = '24px';
  waitingForPlayersOverlay.style.textAlign = 'center';
  waitingForPlayersOverlay.style.zIndex = '1000';
  
  waitingForPlayersOverlay.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  
  // Updated HTML with styled title
  waitingForPlayersOverlay.innerHTML = `
    <h2 style="margin-top: 0; color: #fff; text-shadow: 0 0 10px rgba(255, 255, 255, 0.5);">Waiting for players...</h2>
    <div id="player-list" style="margin-top:20px; text-align:left;"></div>
  `;
  
  // Countdown overlay — hidden state tracker only (traffic light handles visuals)
  countdownOverlay = document.createElement('div');
  countdownOverlay.style.display = 'none';
  
  if (raceState.isMultiplayer) {
    document.body.appendChild(waitingForPlayersOverlay);
  }
  
  // Make countdown overlay globally accessible for multiplayer.js
  window.countdownOverlay = countdownOverlay; 
}

// Create the timer UI
function createRaceTimer() {
  // Create timer element
  raceTimer = document.createElement('div');
  raceTimer.id = "race-timer"; 
  raceTimer.style.position = 'absolute';
  raceTimer.style.top = '20px';
  raceTimer.style.left = '50%';
  
  // Create a nested container for content that will be centered
  const timerContent = document.createElement('div');
  timerContent.style.position = 'relative';
  timerContent.style.left = '-50%'; // Center by shifting left instead of using transform
  
  // Match the styling of other UI elements
  timerContent.style.background = 'rgba(0, 0, 0, 0.5)';
  timerContent.style.color = '#fff';
  timerContent.style.padding = '10px 20px';
  timerContent.style.borderRadius = '10px';
  timerContent.style.fontFamily = "'Poppins', sans-serif";
  timerContent.style.fontSize = '28px';
  timerContent.style.fontWeight = 'bold';
  timerContent.style.textAlign = 'center';
  timerContent.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  timerContent.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  
  timerContent.innerText = '00:00';
  
  // Add content to container
  raceTimer.appendChild(timerContent);
  raceTimer.style.display = 'none';
  raceTimer.style.zIndex = '1000';
  
  document.body.appendChild(raceTimer);
  
  // Keep a reference to the content element for updating the timer
  raceTimer.contentElement = timerContent;
}

// In createLeaderboard() function
function createLeaderboard() {
  // Create leaderboard container
  leaderboard = document.createElement('div');
  leaderboard.id = "leaderboard"; 
  leaderboard.style.position = 'absolute';
  leaderboard.style.top = '20px';
  leaderboard.style.left = '20px';
  
  // Match the styling of other UI elements
  leaderboard.style.background = 'rgba(0, 0, 0, 0.5)';
  leaderboard.style.color = '#fff';
  leaderboard.style.padding = '15px';
  leaderboard.style.borderRadius = '10px';
  leaderboard.style.fontFamily = "'Poppins', sans-serif";
  leaderboard.style.fontSize = '18px';
  leaderboard.style.fontWeight = 'bold';
  leaderboard.style.textAlign = 'left';
  leaderboard.style.zIndex = '1000';
  leaderboard.style.minWidth = '220px';
  
  leaderboard.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  leaderboard.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.3)';
  
  // Initial content
  leaderboard.innerHTML = `
    <div style="margin-bottom: 10px; text-align: center; font-size: 20px; border-bottom: 1px solid rgba(255,255,255,0.3); padding-bottom: 5px;">
      LEADERBOARD
    </div>
    <div id="leaderboard-positions"></div>
  `;
  
  leaderboard.style.display = 'none';
  
  document.body.appendChild(leaderboard);
}

// Update the updateLeaderboard function to preserve finish times
function updateLeaderboard() {
  if (!leaderboard) return;
  
  const leaderboardPositions = document.getElementById('leaderboard-positions');
  if (!leaderboardPositions) return;
  
  // Before clearing the array, save any finish times to our permanent store
  playerPositions.forEach(player => {
    if (player.finishTime) {
      playerFinishTimes[player.id] = player.finishTime;
    }
  });
  
  // Clear the player positions array
  playerPositions = [];
  
  // Get my player info
  const myPlayerId = localStorage.getItem('myPlayerId');
  const myPlayerInfo = allPlayers.find(p => p.id === myPlayerId);
  const myName = myPlayerInfo?.name || 'You';
  const myColor = myPlayerInfo?.playerColor || 'blue';
  
  // Get my gate progress
  const myGateIndex = gateData ? gateData.currentGateIndex : 0;
  let myDistanceToNextGate = 1000000;
  
  if (gateData && gateData.gates && gateData.gates.length > myGateIndex && carModel) {
    const nextGate = gateData.gates[myGateIndex];
    if (nextGate) {
      const gatePos = nextGate.position || Vector3.Zero();
      // gates.js may use getWorldPosition — handle both Babylon and fallback
      if (nextGate.getAbsolutePosition) {
        const abs = nextGate.getAbsolutePosition();
        gatePos.x = abs.x; gatePos.y = abs.y; gatePos.z = abs.z;
      }
      
      const dx = carModel.position.x - gatePos.x;
      const dy = carModel.position.y - gatePos.y;
      const dz = carModel.position.z - gatePos.z;
      myDistanceToNextGate = dx * dx + dy * dy + dz * dz;
    }
  }
  
  playerPositions.push({
    id: myPlayerId,
    name: myName,
    color: myColor,
    gateIndex: myGateIndex,
    distanceToNextGate: myDistanceToNextGate
  });
  
  // Only add opponents in multiplayer mode
  if (raceState.isMultiplayer) {
    Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
      // Only add if updated recently
      if (Date.now() - opponent.lastUpdate < 5000) {
        // Extract and validate race progress data
        const gateIndex = (opponent.raceProgress && 
                           typeof opponent.raceProgress.currentGateIndex === 'number') ? 
                           opponent.raceProgress.currentGateIndex : 0;
        
        const distanceToNextGate = (opponent.raceProgress && 
                                    typeof opponent.raceProgress.distanceToNextGate === 'number') ?
                                    opponent.raceProgress.distanceToNextGate : 1000000;
        
        playerPositions.push({
          id: playerId,
          name: opponent.name || 'Player',
          color: opponent.color || 'red',
          gateIndex: gateIndex,
          distanceToNextGate: distanceToNextGate
        });
      }
    });
    
    // Sort players by progress in multiplayer mode
    playerPositions.sort((a, b) => {
      // First by gate index (higher is better)
      if (b.gateIndex !== a.gateIndex) {
        return b.gateIndex - a.gateIndex;
      }
      // Then by distance to next gate 
      const distA = isFinite(a.distanceToNextGate) ? a.distanceToNextGate : 1000000;
      const distB = isFinite(b.distanceToNextGate) ? b.distanceToNextGate : 1000000;
      return distA - distB;
    });
  }

  // Add AI bots to leaderboard in single-player mode
  if (!raceState.isMultiplayer && raceBots.length > 0 && _useCheckpoints) {
    const playerProg = getRaceProgress();
    const positions = getRacePositions(raceBots, playerProg, myName);
    // Replace the simple array with the full ranked list
    playerPositions.length = 0;
    for (const entry of positions) {
      playerPositions.push({
        id: entry.id,
        name: entry.name,
        color: entry.id === 'player' ? myColor : '#aaa',
        gateIndex: Math.floor(entry.progress * 100),
        distanceToNextGate: 0,
        progress: entry.progress,
      });
    }
  } else if (!raceState.isMultiplayer && !_useCheckpoints) {
    // Legacy single-player without checkpoints: no sort needed
  } else {
    // Multiplayer sort already done above
  }
  
  // Restore saved finish times from our permanent store
  playerPositions.forEach(player => {
    if (playerFinishTimes[player.id]) {
      player.finishTime = playerFinishTimes[player.id];
    }
  });
  
  // Generate HTML for leaderboard
  let leaderboardHTML = '';
  playerPositions.forEach((player, index) => {
    // In single player mode, always show as position 1
    const position = raceState.isMultiplayer ? (index + 1) : (index + 1);
    const positionLabel = getPositionLabel(position);
    const isCurrentPlayer = player.id === myPlayerId;
    
    leaderboardHTML += `
      <div style="display: flex; align-items: center; margin-bottom: 8px; 
          ${isCurrentPlayer ? 'font-weight: bold; text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);' : ''}">
        <span style="color: ${getPositionColor(position)}; min-width: 30px;">${positionLabel}</span>
        <span style="${isCurrentPlayer ? 'text-decoration: underline;' : ''}; margin-left: 10px;">
          ${player.name}
        </span>
      </div>
    `;
  });
  
  leaderboardPositions.innerHTML = leaderboardHTML;
}

// Helper function to get position label
function getPositionLabel(position) {
  switch (position) {
    case 1: return '1st';
    case 2: return '2nd';
    case 3: return '3rd';
    default: return `${position}th`;
  }
}

// Helper function to get position color
function getPositionColor(position) {
  switch (position) {
    case 1: return 'gold';
    case 2: return 'silver';
    case 3: return '#cd7f32'; 
    default: return 'white';
  }
}

// Make updateLeaderboard available globally for multiplayer.js
window.updateLeaderboard = updateLeaderboard;

// Item HUD — shows current weapon/item in corner
function updateItemHUD() {
  let el = document.getElementById('race-item-hud');
  const item = getCurrentItem();
  const effect = getActiveEffect();

  if (!item && !effect) {
    if (el) el.style.display = 'none';
    return;
  }

  if (!el) {
    el = document.createElement('div');
    el.id = 'race-item-hud';
    el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;font-family:Poppins,sans-serif;padding:10px 18px;border-radius:12px;z-index:100;text-align:center;pointer-events:none;font-size:16px;border:2px solid rgba(255,255,255,0.2);';
    document.body.appendChild(el);
  }

  el.style.display = 'block';

  if (item) {
    const iconHTML = getWeaponIconHTML(item.id, item.icon || '🎯', 36);
    el.innerHTML = `${iconHTML}<br><span style="font-size:12px">${item.name} [SPACE]</span>`;
    el.style.borderColor = 'rgba(255,204,0,0.6)';
  } else if (effect) {
    const icon = effect.type === 'boost' ? '⚡' : effect.type === 'shield' ? '🛡️' : '✨';
    const secs = effect.timer.toFixed(1);
    el.innerHTML = `<span style="font-size:28px">${icon}</span><br><span style="font-size:12px">${effect.type} ${secs}s</span>`;
    el.style.borderColor = 'rgba(0,255,100,0.6)';
  }
}

// ── Grand Prix race finish handler ──────────────────────────────────────────

async function handleGrandPrixRaceEnd() {
  // Build finish order from bot positions + player
  const playerProg = _useCheckpoints ? getRaceProgress() : 0;
  const positions = getRacePositions(raceBots, playerProg, 'You');
  const finishOrder = positions.map(p => ({ id: p.id, name: p.name }));

  reportRaceResult(finishOrder);

  // Wait a moment for the finish message, then show standings
  await new Promise(r => setTimeout(r, 3000));

  const action = await showStandingsOverlay();

  if (action === 'final' || !hasNextRace()) {
    // Show final results
    await showFinalResultsOverlay();
    endGrandPrix();
    // Return to lobby
    window.location.href = 'index.html';
  } else {
    // Advance to next race — reload page with updated config
    const next = advanceToNextRace();
    if (next && gameConfig) {
      gameConfig.trackId = next.trackId;
      gameConfig.resolvedContentId = next.trackId;
      gameConfig.cupRace = next.raceNumber;
      gameConfig._gpRaceIdx = next.raceNumber - 1;
      gameConfig._gpStandings = getStandings();
      sessionStorage.setItem('gameConfig', JSON.stringify(gameConfig));
      // Reload the page to start fresh for the next race
      window.location.reload();
    }
  }
}

// ── Grand Prix initializer (called after bots are created) ──────────────────

function initGrandPrixIfNeeded() {
  if (!gameConfig || gameConfig.subMode !== 'grand_prix') return;

  const cupId = gameConfig.cupId || 'starter';
  const cup = SINGLE_PLAYER_CUPS[cupId];
  if (!cup) return;

  // Competitor names: player + bot names
  const competitorNames = ['You', ...gpBotNames];

  // If resuming a GP (race 2+), restore standings
  if (gameConfig._gpRaceIdx > 0 && gameConfig._gpStandings) {
    startGrandPrix(cupId, competitorNames, null);
    restoreGrandPrixState(gameConfig._gpRaceIdx, gameConfig._gpStandings);
    console.log(`Grand Prix: Resuming ${cup.label}, race ${gameConfig._gpRaceIdx + 1}`);
  } else {
    startGrandPrix(cupId, competitorNames, null);
    console.log(`Grand Prix: Starting ${cup.label} (${cup.trackIds.length} races)`);
  }

  // Show GP banner
  showGPBanner();
}

function showGPBanner() {
  const info = getCurrentRaceInfo();
  if (!info) return;

  let banner = document.getElementById('gp-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'gp-banner';
    banner.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.7);color:#fff;font-family:Poppins,sans-serif;padding:6px 18px;border-radius:8px;z-index:100;text-align:center;pointer-events:none;font-size:14px;';
    document.body.appendChild(banner);
  }
  banner.innerHTML = `${info.cupIcon} <strong>${info.cupLabel}</strong> — Race ${info.raceNumber}/${info.totalRaces}`;
}

// Function to start the timer
function startRaceTimer() {
  if (raceTimer) {
    raceTimer.style.display = 'block';
    raceStartTime = Date.now();
    
    // Clear any existing interval
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    
    // Update the timer immediately
    updateRaceTimer();
    
    // Set interval to update timer every 100ms
    timerInterval = setInterval(updateRaceTimer, 100);
  }
}

// Function to update the timer display
function updateRaceTimer() {
  if (!raceTimer || !raceTimer.contentElement) return;
  
  const elapsedMilliseconds = Date.now() - raceStartTime;
  const elapsedSeconds = Math.floor(elapsedMilliseconds / 1000);
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  
  // Format with leading zeros
  const formattedMinutes = String(minutes).padStart(2, '0');
  const formattedSeconds = String(seconds).padStart(2, '0');
  
  raceTimer.contentElement.innerText = `${formattedMinutes}:${formattedSeconds}`;
}

// Update the waiting for players UI
function updateWaitingUI() {
  if (!waitingForPlayersOverlay || !raceState.isMultiplayer) return;
  
  const playerListEl = waitingForPlayersOverlay.querySelector('#player-list');
  if (!playerListEl) return;
  
  let playerListHTML = '';
  allPlayers.forEach(player => {
    // Check if this player is connected 
    const isConnected = multiplayerState.playerConnections.some(conn => conn.peer === player.id) || 
                        player.id === localStorage.getItem('myPlayerId');
    
    // Updated dot colors to match the white theme
    const connectionStatus = isConnected ? 
      '<span style="color:#90ff90; text-shadow: 0 0 5px rgba(144, 255, 144, 0.7);">● Connected</span>' : 
      '<span style="color:#ff9090; text-shadow: 0 0 5px rgba(255, 144, 144, 0.7);">○ Waiting...</span>';
    
    playerListHTML += `<div style="margin-bottom: 8px;">${player.name} (${player.playerColor}) - ${connectionStatus}</div>`;
  });
  
  playerListEl.innerHTML = playerListHTML;
}

// Improve the startCountdown function with better logging and state handling
function startCountdown() {
  console.log('startCountdown called, display state:', countdownOverlay.style.display);
  
  if (countdownOverlay.style.display === 'block') {
    console.log('Countdown already in progress, ignoring call');
    return; // Already counting down
  }
  
  // Hide waiting overlay
  if (waitingForPlayersOverlay) {
    waitingForPlayersOverlay.style.display = 'none';
  }
  
  console.log('Starting countdown sequence...');
  
  // Mark overlay as active (for re-entry guard; element is not in the DOM)
  countdownOverlay.style.display = 'block';
  raceState.countdownStarted = true;
  
  // Play countdown audio SFX (3-2-1-GO)
  playCountdownSequence();
  
  // Use STK-style traffic light countdown
  createTrafficLight();
  
  raceState.countdownValue = 3;
  countdownOverlay.innerHTML = raceState.countdownValue.toString();
  
  animateTrafficLight(() => {
    // This fires at GO — start the race
    countdownOverlay.style.display = 'none';
    raceState.raceStarted = true;
    console.log('Race started!', raceState);

    // ── Unfreeze kart physics on GO! ──
    if (window._kartAggregate) {
      try {
        window._kartAggregate.body.setMotionType(PhysicsMotionType.DYNAMIC);
      } catch (e) { console.warn('Unfreeze kart failed:', e); }
    }

    // Start engine sound & track BGM
    startEngineSound();
    playTrackMusic(window._currentMapId || 'test_box');

    // ── Start ghost recording for Time Trial ──
    if (gameConfig?.subMode === 'time_trial') {
      startRecording(window._currentMapId || 'test_box');
      // Also spawn saved ghost if one exists
      const saved = loadGhost(window._currentMapId || 'test_box');
      if (saved && saved.frames) {
        spawnGhostKart(scene, saved.frames);
      }
    }

    // ── Init Follow-the-Leader mode ──
    // Moved to loadTrackData callback (after bot creation) to avoid race condition

    // ── Init Soccer mode ──
    if (gameConfig?.subMode === 'soccer') {
      initSoccer(scene);
    }

    // Show leaderboard when race starts for BOTH single player and multiplayer
    leaderboard.style.display = 'block';
    
    // Start the race timer
    startRaceTimer();
    
    // Broadcast race start to other players if host
    if (isHost) {
      console.log('Broadcasting race start as host');
      multiplayerState.broadcastRaceStart();
    }
  });

  // Also run the legacy text countdown in parallel (for sync/fallback)
  const countdownInterval = setInterval(() => {
    raceState.countdownValue--;
    if (raceState.countdownValue > 0) {
      countdownOverlay.innerHTML = raceState.countdownValue.toString();
    } else if (raceState.countdownValue === 0) {
      countdownOverlay.innerHTML = 'GO!';
    } else {
      clearInterval(countdownInterval);
      countdownOverlay.style.display = 'none';
    }
  }, 1000);
}

// Make startCountdown globally accessible for the multiplayer module
window.startCountdown = startCountdown;

// Create spectator UI elements
function createSpectatorUI() {
  spectatorUI = document.createElement('div');
  spectatorUI.id = 'spectator-ui';
  spectatorUI.style.position = 'absolute';
  spectatorUI.style.bottom = '20px';
  spectatorUI.style.left = '50%';
  spectatorUI.style.transform = 'translateX(-50%)';
  spectatorUI.style.background = 'rgba(0, 0, 0, 0.5)';
  spectatorUI.style.color = '#fff';
  spectatorUI.style.padding = '10px 20px';
  spectatorUI.style.borderRadius = '10px';
  spectatorUI.style.fontFamily = "'Poppins', sans-serif";
  spectatorUI.style.fontSize = '18px';
  spectatorUI.style.fontWeight = 'bold';
  spectatorUI.style.textAlign = 'center';
  spectatorUI.style.zIndex = '1000';
  spectatorUI.style.display = 'none';
  spectatorUI.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  spectatorUI.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  
  // Create container for player name and navigation arrows
  spectatorUI.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center;">
      <div id="prev-player" style="cursor: pointer; margin-right: 15px; font-size: 24px;">◀</div>
      <div id="spectated-player-name">Spectating: Player</div>
      <div id="next-player" style="cursor: pointer; margin-left: 15px; font-size: 24px;">▶</div>
    </div>
  `;
  
  document.body.appendChild(spectatorUI);
  
  // Add event listeners to the navigation arrows
  document.getElementById('prev-player').addEventListener('click', () => {
    switchSpectatedPlayer(-1);
  });
  
  document.getElementById('next-player').addEventListener('click', () => {
    switchSpectatedPlayer(1);
  });
  
  // Also allow keyboard navigation with left/right arrows
  document.addEventListener('keydown', (event) => {
    if (!spectatorMode) return;
    
    if (event.key === 'ArrowLeft') {
      switchSpectatedPlayer(-1);
    } else if (event.key === 'ArrowRight') {
      switchSpectatedPlayer(1);
    }
  });
}

// Function to enter spectator mode
function enterSpectatorMode() {
  if (!raceState.isMultiplayer) return;
  
  console.log("Entering spectator mode");
  spectatorMode = true;
  
  // Get all active racers (players who haven't finished yet)
  updateActiveRacers();
  
  // If there are active racers, start spectating the first one
  if (activeRacers.length > 0) {
    spectatedPlayerIndex = 0;
    updateSpectatorUI();
    spectatorUI.style.display = 'block';
  } else {
    console.log("No active racers to spectate");
  }
}

// Update the list of active racers
function updateActiveRacers() {
  activeRacers = [];
  
  // Add all opponents who have updated recently and haven't finished
  Object.entries(multiplayerState.opponentCars).forEach(([playerId, opponent]) => {
    // Only include players who have updated in the last 5 seconds and aren't finished
    if (Date.now() - opponent.lastUpdate < 5000 && !opponent.raceFinished) {
      activeRacers.push({
        id: playerId,
        name: opponent.name || 'Player',
        model: opponent.model
      });
    }
  });
  
  console.log(`Found ${activeRacers.length} active racers`);
}

// Switch to next/previous spectated player
function switchSpectatedPlayer(direction) {
  if (activeRacers.length === 0) return;
  
  // Update active racers list first
  updateActiveRacers();
  
  // If no more active racers, exit spectator mode
  if (activeRacers.length === 0) {
    exitSpectatorMode();
    return;
  }
  
  // Update spectated player index
  spectatedPlayerIndex = (spectatedPlayerIndex + direction + activeRacers.length) % activeRacers.length;
  updateSpectatorUI();
}

// Update spectator UI with current player name
function updateSpectatorUI() {
  if (!spectatorMode || activeRacers.length === 0) return;
  
  const spectatedPlayer = activeRacers[spectatedPlayerIndex];
  document.getElementById('spectated-player-name').textContent = `Spectating: ${spectatedPlayer.name}`;
}

// Exit spectator mode
function exitSpectatorMode() {
  spectatorMode = false;
  spectatedPlayerIndex = -1;
  spectatorUI.style.display = 'none';
}

// Update the spectator camera position
function updateSpectatorCamera() {
  if (!spectatorMode || activeRacers.length === 0) return;
  
  const targetCar = activeRacers[spectatedPlayerIndex].model;
  if (!targetCar) return;
  
  // Use FollowCamera's built-in tracking by switching the lockedTarget
  if (camera.lockedTarget !== targetCar) {
    camera.lockedTarget = targetCar;
  }
}

function showFinalLeaderboard() {
  // Hide all existing UI elements
  if (raceTimer) raceTimer.style.display = 'none';
  if (leaderboard) leaderboard.style.display = 'none';
  if (spectatorUI) spectatorUI.style.display = 'none';
  if (minimapState && minimapState.canvas) minimapState.canvas.style.display = 'none';
  
  // Create final leaderboard container
  const finalLeaderboard = document.createElement('div');
  finalLeaderboard.id = 'final-leaderboard';
  finalLeaderboard.style.position = 'absolute';
  finalLeaderboard.style.top = '50%';
  finalLeaderboard.style.left = '50%';
  finalLeaderboard.style.transform = 'translate(-50%, -50%)';
  finalLeaderboard.style.background = 'rgba(0, 0, 0, 0.5)';
  finalLeaderboard.style.backdropFilter = 'blur(10px)';
  finalLeaderboard.style.color = '#fff';
  finalLeaderboard.style.padding = '40px';
  finalLeaderboard.style.borderRadius = '15px';
  finalLeaderboard.style.fontFamily = "'Poppins', sans-serif";
  finalLeaderboard.style.fontSize = '20px';
  finalLeaderboard.style.textAlign = 'center';
  finalLeaderboard.style.zIndex = '2000';
  finalLeaderboard.style.minWidth = '400px';
  finalLeaderboard.style.boxShadow = '0 0 30px rgba(0, 0, 0, 0.7)';
  finalLeaderboard.style.opacity = '0';
  finalLeaderboard.style.transform = 'translate(-150%, -50%)'; // Start off-screen to the left
  finalLeaderboard.style.transition = 'transform 1s cubic-bezier(0.12, 0.93, 0.27, 0.98), opacity 1s ease';
  
  // Create title
  const title = document.createElement('h2');
  title.textContent = 'RACE RESULTS';
  title.style.fontSize = '36px';
  title.style.fontWeight = '900';
  title.style.marginBottom = '30px';
  title.style.color = '#ffffff';
  title.style.textShadow = '0 0 15px rgba(255, 255, 255, 0.5)';
  title.style.letterSpacing = '3px';
  
  // Helper function to convert MM:SS time string to seconds
  function timeToSeconds(timeString) {
    const [minutes, seconds] = timeString.split(':').map(Number);
    return minutes * 60 + seconds;
  }
  
  // Find finished players (who have finish times)
  const finishedPlayers = playerPositions.filter(player => {
    const finishTime = playerFinishTimes[player.id] || player.finishTime;
    return finishTime && finishTime !== "00:00" && finishTime !== "DNF";
  });
  
  // Sort players by their finish time (lowest first)
  const sortedPlayers = finishedPlayers.sort((a, b) => {
    const timeA = playerFinishTimes[a.id] || a.finishTime || "99:99";
    const timeB = playerFinishTimes[b.id] || b.finishTime || "99:99";
    
    // Convert time strings to seconds for comparison
    return timeToSeconds(timeA) - timeToSeconds(timeB);
  });
  
  // Take only top 3 players
  const topPlayers = sortedPlayers.slice(0, 3);
  
  // Create leaderboard table
  const table = document.createElement('table');
  table.style.width = '100%';
  table.style.borderCollapse = 'collapse';
  table.style.marginBottom = '30px';
  
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = `
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">POSITION</th>
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">PLAYER</th>
    <th style="padding: 10px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.3);">TIME</th>
  `;
  table.appendChild(headerRow);
  
  // Add player rows for top 3 only
  topPlayers.forEach((player, index) => {
    const row = document.createElement('tr');
    
    // Determine position indicator and style
    const position = index + 1;
    const positionLabel = getPositionLabel(position);
    const positionColor = getPositionColor(position);
    
    // Get finish time
    const finishTime = playerFinishTimes[player.id] || player.finishTime || "00:00";
    
    row.innerHTML = `
      <td style="padding: 12px; text-align: center; color: ${positionColor}; font-weight: bold;">${positionLabel}</td>
      <td style="padding: 12px; text-align: left;">
        <div style="display: flex; align-items: center;">
          <div style="width: 15px; height: 15px; background-color: ${getPlayerColorHex(player.color)}; margin-right: 10px; border-radius: 50%;"></div>
          ${player.name}
        </div>
      </td>
      <td style="padding: 12px; text-align: right; font-weight: bold; color: #ffffff;">${finishTime}</td>
    `;
    
    table.appendChild(row);
  });
  
  // Show a message if no players finished yet
  if (topPlayers.length === 0) {
    const noResultsRow = document.createElement('tr');
    noResultsRow.innerHTML = `
      <td colspan="3" style="padding: 30px; text-align: center; color: #aaaaaa;">
        No players have finished the race yet.
      </td>
    `;
    table.appendChild(noResultsRow);
  }
  
  // Create home button
  const homeButton = document.createElement('button');
  homeButton.textContent = 'HOME';
  homeButton.style.fontFamily = "'Poppins', sans-serif";
  homeButton.style.fontWeight = '900';
  homeButton.style.fontSize = '1.1rem';
  homeButton.style.padding = '10px 30px';
  homeButton.style.backgroundColor = '#ff0080';
  homeButton.style.border = '2px solid #b30059';
  homeButton.style.color = 'white';
  homeButton.style.borderRadius = '5px';
  homeButton.style.cursor = 'pointer';
  homeButton.style.boxShadow = '0 4px 0 #b30059';
  homeButton.style.transition = 'all 0.2s ease';
  homeButton.style.marginTop = '10px';
  
  // Add hover and active effects using event listeners
  homeButton.addEventListener('mouseover', () => {
    homeButton.style.backgroundColor = '#f5007c';
    homeButton.style.transform = 'translateY(2px)';
    homeButton.style.boxShadow = '0 2px 0 #b30059';
  });
  
  homeButton.addEventListener('mouseout', () => {
    homeButton.style.backgroundColor = '#ff0080';
    homeButton.style.transform = 'translateY(0)';
    homeButton.style.boxShadow = '0 4px 0 #b30059';
  });
  
  homeButton.addEventListener('mousedown', () => {
    homeButton.style.transform = 'translateY(4px)';
    homeButton.style.boxShadow = '0 0 0 #b30059';
  });
  
  homeButton.addEventListener('mouseup', () => {
    homeButton.style.transform = 'translateY(2px)';
    homeButton.style.boxShadow = '0 2px 0 #b30059';
  });
  
  // Add click handler to return to lobby
  homeButton.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
  
  // Assemble final leaderboard
  finalLeaderboard.appendChild(title);
  finalLeaderboard.appendChild(table);
  finalLeaderboard.appendChild(homeButton);
  document.body.appendChild(finalLeaderboard);
  
  // Trigger the animation after a short delay
  setTimeout(() => {
    finalLeaderboard.style.opacity = '1';
    finalLeaderboard.style.transform = 'translate(-50%, -50%)';
  }, 100);
  
  return finalLeaderboard;
}

// Helper function to convert player color name to hex color
function getPlayerColorHex(colorName) {
  const colorMap = {
    red: '#ff7070',
    orange: '#ffb766',
    yellow: '#ffffa7',
    green: '#429849',
    blue: '#447bc9',
    indigo: '#cc57d0',
    violet: '#7c37b1'
  };
  return colorMap[colorName] || '#ff7070';
}

window.showFinalLeaderboard = showFinalLeaderboard;

function setupCartoonySkybox(_scene) {
  // Sky is now created by babylon-renderer.js (createProceduralSky)
  // This stub is kept for call-site compatibility.
}

/** Dispose all subsystems for solo race / GP modes (14.4.1 cross-mode cleanup) */
function cleanupSoloRace() {
  disposeHUD();
  disposeRaceItems();
  disposeRaceBots(raceBots);
  disposeParticles();
  disposeGhost();
  disposeAudio();
}

// Initialize everything
async function init() {
  // Check and handle orientation
  handleOrientationChange();
  window.addEventListener('orientationchange', handleOrientationChange);
  window.addEventListener('resize', handleOrientationChange);
  window.addEventListener('beforeunload', () => cleanupSoloRace());

  // Start pre-race ambient music (plays while loading / waiting for countdown)
  playPreRaceMusic();

  // Babylon.js doesn't use a LoadingManager — use a simple counter instead
  loadingManager = null; // kept for API compat with gates.js etc.

  // Inline asset-count observers (replaced THREE.LoadingManager)
  window.loadingManager = loadingManager;

  console.log("Main module loaded");
  const loadingEl = document.createElement('div');
  loadingEl.style.position = 'absolute';
  loadingEl.style.left = '0';
  loadingEl.style.backgroundColor = '#000';
  loadingEl.style.color = '#fff';
  loadingEl.style.display = 'flex';
  loadingEl.style.alignItems = 'center';
  loadingEl.style.justifyContent = 'center';
  loadingEl.style.zIndex = '999';
  loadingEl.style.fontSize = '24px';
  loadingEl.textContent = 'Loading Physics Engine...';
  document.body.appendChild(loadingEl);

  // ── Babylon.js renderer, scene, camera, lighting, post-processing ──────
  // initBabylonRenderer creates: Engine, Scene, Camera, Lights, Shadows,
  // DefaultRenderingPipeline (bloom + FXAA + tone-mapping), procedural sky,
  // fog, and returns a renderer API object.
  bRenderer = await initBabylonRenderer('app');
  scene    = bRenderer.scene;
  camera   = bRenderer.camera;
  renderer = bRenderer.engine; // kept for API compat

  // Initialize particle pools in the Babylon.js scene
  initParticles(scene);
  

  
  console.log("About to initialise Havok physics");
  // Initialize Havok and setup physics
  initPhysics().then(() => {
    console.log("Havok physics initialised");
    
    document.body.removeChild(loadingEl);

    // Fallback: hide the loading screen after 15 s even if car loading stalls
    const _loadingTimeout = setTimeout(() => hideLoadingScreen(), 15000);
    
    // Load the track as a single model
    // ── Track selection ──────────────────────────────────────────────────
    let mapToLoad = gameConfig?.trackId || gameConfig?.arenaId || 'test_box';

    // Custom track from Track Builder (via ?customTrack=session or online gameConfig)
    const urlParams = new URLSearchParams(window.location.search);
    const isCustomTrack = urlParams.get('customTrack') === 'session'
      || Boolean(gameConfig?.customTrackData);
    let customTrackData = null;

    if (isCustomTrack) {
      try {
        // Online multiplayer: customTrackData is inside gameConfig
        const raw = gameConfig?.customTrackData
          || sessionStorage.getItem('customTrackData');
        if (raw) customTrackData = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (e) {
        console.warn('Failed to load custom track data:', e);
      }
    }
    window._currentMapId = mapToLoad; // Store for fall-threshold lookups

    if (isCustomTrack && customTrackData) {
      // Build custom track from TrackData JSON instead of loading GLB
      import('./modules/track-editor.js').then(({ generateSegmentGeometry, SEGMENT_TYPES }) => {
        buildCustomTrackScene(customTrackData, scene, SEGMENT_TYPES, generateSegmentGeometry, bRenderer);

        // Apply start position from custom track
        if (customTrackData.startPositions && customTrackData.startPositions.length > 0) {
          const sp = customTrackData.startPositions[0];
          resetKart({ x: sp.position.x, y: sp.position.y + 2, z: sp.position.z }, sp.heading || 0);
        }
      });
    } else {
      loadTrackModel(mapToLoad, scene, loadingManager, (trackModel) => {
        console.log(`Track model loaded (${mapToLoad}), extracting for minimap`);
        extractTrackData(trackModel);
      }, bRenderer.shadowGen);
    }
    
    // Apply track-specific sky colors
    bRenderer.applyTrackSky(mapToLoad);
    
    // Load map decorations (skipped automatically for STK tracks by track-data)
    loadMapDecorations(mapToLoad, scene, renderer, camera, loadingManager, bRenderer.shadowGen);
    
    // Load gates (returns empty data for STK tracks via track-data)
    gateData = loadGates(mapToLoad, scene, loadingManager, (loadedGateData) => {
      // Store the reference when gates are fully loaded
      gateData = loadedGateData;
      // Make gate data globally available for multiplayer
      window.gateData = gateData;
      console.log(`Gates loaded for ${mapToLoad}. Total gates: ${gateData.totalGates}`);
    });

    // Load track auxiliary data (driveline, checkpoints, start grid)
    loadTrackData(mapToLoad, gameConfig?.contentType || 'track').then(td => {
      if (td && td.driveline && td.driveline.length > 0) {
        _stkTrackData = td;
        _useCheckpoints = true;
        initCheckpoints(td);
        console.log(`Track data loaded for ${mapToLoad}: ${td.driveline.length} quads, ${td.checkpoints.length} checkpoints`);

        if (td.startPositions && td.startPositions.length > 0) {
          const sp = td.startPositions[0];
          const pos = { x: sp.position[0], y: sp.position[1] + 1, z: sp.position[2] };
          const heading = sp.heading || 0;
          resetKart(pos, heading);
          console.log(`Start grid applied: pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}), heading=${heading.toFixed(2)}`);
        }

        if (!raceState.isMultiplayer && !gameConfig?.noOpponents) {
          const botCount = gameConfig?.botCount || 7;
          const playerKart = sessionStorage.getItem('kartId') || 'tux';
          raceBots = createRaceBots(scene, td, botCount, playerKart);
          gpBotNames = raceBots.map((bot) => bot.kartId.charAt(0).toUpperCase() + bot.kartId.slice(1));
          initGrandPrixIfNeeded();

          // Init Follow-the-Leader after bots exist (avoids countdown race condition)
          if (gameConfig?.subMode === 'follow_the_leader' && raceBots.length > 0) {
            initFTL(scene, raceBots, carModel);
          }
        }
      }

      if (td?.items?.length > 0 && !gameConfig?.noItems) {
        initRaceItems(scene, td.items);
        onItemCollected((weaponId) => playItemRoulette(weaponId));
      }
    }).catch((error) => {
      console.warn(`Track data unavailable for ${mapToLoad}:`, error);
    });
    
    console.log("About to create vehicle");

    // Create the kart physics body + load the visual model
    createVehicle(scene, (loadedComponents) => {
      
      // Now set all the global variables
      wheelMeshes = loadedComponents.wheelMeshes;
      carModel = loadedComponents.carModel;
      
      // ── Wire unified-scene kart refs for physics shims ──
      const kartAgg = loadedComponents.kartAggregate;
      if (kartAgg) {
        setKartRefs(kartAgg.body, carModel);
        setPhysicsKartRefs(kartAgg.body, carModel);
        window._kartAggregate = kartAgg; // debug access
      }

      // ── Position kart at track start (MUST be after setKartRefs) ──
      applyStartPosition(mapToLoad);
      console.log(`Car spawned at start position for ${mapToLoad}`);

      // ── Wire FollowCamera to kart ──
      if (bRenderer && bRenderer.setLockedTarget) {
        bRenderer.setLockedTarget(carModel);
      }

      // Initialise GLO underglow using the settings chosen in the lobby
      gloSystem = createGloSystem(scene);

      multiplayerState.carModel = carModel;
      
      // For single player, start the countdown immediately
      if (!raceState.isMultiplayer) {
        console.log("Single player mode - starting countdown");
        setTimeout(() => startCountdown(), 500);
      }
      
      // Now that the car is fully loaded, we can start the animation loop
      animate();
      clearTimeout(_loadingTimeout);
      hideLoadingScreen();
    });
    
    // Set up controls early so they work when the car loads
    setupKeyControls();
    
    // Initialize peer connection for multiplayer
    multiplayerState = initMultiplayer({
      scene: scene,
      camera: camera,
      carModel: null // Will be set later when loaded
    });
    
    // Animation will start in the callback when the car is fully loaded
  });

  // Check if this is a multiplayer game
  raceState.isMultiplayer = gameConfig && gameConfig.players && gameConfig.players.length > 1;

  createRaceUI();
  createRaceTimer();
  createLeaderboard();
  createSpectatorUI(); // Add this line
  
  // Create STK-style HUD overlays
  createPositionBadge();
  createNitroGauge();
  createWrongWayIndicator();
  createDamageVignette();
  
  // Create minimap
  const mapToLoad = gameConfig?.trackId || gameConfig?.arenaId || 'test_box'; 
  minimapState = createMinimap(mapToLoad, scene);

  // Make spectator functions globally available
  window.enterSpectatorMode = enterSpectatorMode;
  window.exitSpectatorMode = exitSpectatorMode;

  // Create mobile controls
  createMobileControls();
}

// Add this function to hide the loading screen
function hideLoadingScreen() {
  // Wait a small amount of time to ensure UI is ready
  setTimeout(() => {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      
      // Remove from DOM after fade out
      setTimeout(() => {
        loadingScreen.style.display = 'none';
      }, 500);
    }
  }, 500);
}

// Setup key controls for vehicle
function setupKeyControls() {
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = true;
    if (event.key.toLowerCase() === 's') keyState.s = true;
    if (event.key.toLowerCase() === 'a') keyState.a = true;
    if (event.key.toLowerCase() === 'd') keyState.d = true;

    // Replace the keydown R handler with this improved version:
    if (event.key.toLowerCase() === 'r') {
        if (_useCheckpoints) {
          const center = getCurrentQuadCenter();
          const heading = getCurrentQuadHeading();
          const pos = new Vector3(center[0], center[1] + 1, center[2]);
          const quat = Quaternion.RotationAxis(new Vector3(0, 1, 0), heading);
          resetCarPosition(pos, quat);
        } else if (gateData) {
          resetCarPosition(
            gateData.currentGatePosition, gateData.currentGateQuaternion
          );
        }
    }

    // Add spectator mode toggle
    if (event.key.toLowerCase() === 'p') {
      if (spectatorMode) {
        exitSpectatorMode();
      } else {
        enterSpectatorMode();
      }
    }

    // Fire/use current race item (Space key)
    if (event.key === ' ' && raceState.raceStarted && !raceState.raceFinished && carModel) {
      const used = useCurrentItem(carModel);
      if (used) {
        playSFX('crash'); // weapon fire sfx
      }
      event.preventDefault();
    }
  });
  
  document.addEventListener('keyup', (event) => {
    if (event.key.toLowerCase() === 'w') keyState.w = false;
    if (event.key.toLowerCase() === 's') keyState.s = false;
    if (event.key.toLowerCase() === 'a') keyState.a = false;
    if (event.key.toLowerCase() === 'd') keyState.d = false;
  });
}

// Add this new camera update function
// FollowCamera handles chase-cam for both normal and spectator modes.
// (see bRenderer.setLockedTarget in createVehicle callback)

// Replace your physics update in animate() with this
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;
  
  if (carModel) {
    // Run physics at fixed intervals
    while (accumulator >= FIXED_PHYSICS_STEP) {
      accumulator -= FIXED_PHYSICS_STEP;
      const carState = {
        carModel, 
        wheelMeshes,
        keyState,
      };

      let physicsResult;
      try {
        physicsResult = updatePhysics(
          FIXED_PHYSICS_STEP, 
          carState, 
          raceState
        );
      } catch (e) {
        console.warn('Physics tick error:', e.message);
        continue;
      }

      // Update speed
      const speedKPH = physicsResult.currentSpeed;
      // Update engine pitch based on speed
      updateEnginePitch(speedKPH);

      // ── Drift / boost state for particles & audio (Task 3.3.4) ──
      _kartState.isDrifting = physicsResult.driftTier > 0;
      _kartState.sparksLevel = physicsResult.driftTier;          // 0=none, 1=blue, 2=orange
      _kartState.isBoosting = physicsResult.miniBoostActive;

      // Drift SFX: play skid on charge-tier transition, boost on release
      if (physicsResult.driftTier > 0 && physicsResult.driftTier !== _kartState._prevDriftTier) {
        playSFX('skid', 0.5);
      }
      if (physicsResult.miniBoostActive && !_kartState._prevBoostActive) {
        playSFX('boost', 0.7);
      }
      _kartState._prevDriftTier   = physicsResult.driftTier;
      _kartState._prevBoostActive = physicsResult.miniBoostActive;

      // ── Fall-off respawn (shared by both systems) ──
      checkGroundCollision(() => {
        if (_useCheckpoints) {
          // Respawn at nearest quad on the driveline
          const center = getCurrentQuadCenter();
          const heading = getCurrentQuadHeading();
          const pos = new Vector3(center[0], center[1] + 1, center[2]);
          const quat = Quaternion.RotationAxis(new Vector3(0, 1, 0), heading);
          resetCarPosition(pos, quat);
        } else {
          resetCarPosition(
            gateData.currentGatePosition, gateData.currentGateQuaternion
          );
        }
      }, getFallThreshold(window._currentMapId || 'test_box'), carModel);

      // Check if car is flipped
      if (carModel && !raceState.raceFinished) {
        checkCarFlipped(FIXED_PHYSICS_STEP);
      }

      // Update AI bots
      if (raceBots.length > 0) {
        const playerProg = _useCheckpoints ? getRaceProgress() : 0;
        updateRaceBots(raceBots, FIXED_PHYSICS_STEP, playerProg, raceState.raceStarted);
      }

      // Update race items (item boxes, nitros, traps, projectiles)
      if (carModel && raceState.raceStarted && !raceState.raceFinished) {
        const posRatio = raceBots.length > 0
          ? (() => {
              const positions = getRacePositions(raceBots, _useCheckpoints ? getRaceProgress() : 0);
              const myIdx = positions.findIndex(e => e.id === 'player');
              return myIdx >= 0 ? myIdx / Math.max(positions.length - 1, 1) : 0.5;
            })()
          : 0.5;
        const itemResult = updateRaceItems(FIXED_PHYSICS_STEP, carModel, posRatio);

        // Apply item effects
        if (itemResult.boost > 0) {
          window._raceItemBoost = itemResult.boost;
        } else {
          window._raceItemBoost = 0;
        }
        if (itemResult.spinout) {
          // Spin the car briefly
          playSFX('crash');
          if (carModel && carModel.rotationQuaternion) {
            const spin = (Math.random() > 0.5 ? 1 : -1) * Math.PI;
            const yRot = Quaternion.RotationYawPitchRoll(spin, 0, 0);
            carModel.rotationQuaternion.multiplyInPlace(yRot);
          }
        }
      }
      
      if (spectatorMode) {
        updateSpectatorCamera();
      }
      // FollowCamera handles chase-cam automatically via lockedTarget
      // (set by bRenderer.setLockedTarget in createVehicle callback)

      // ── Ghost recording (Time Trial) ──
      if (gameConfig?.subMode === 'time_trial' && carModel) {
        recordFrame(FIXED_PHYSICS_STEP, carModel);
      }

      // ── Ghost playback ──
      if (gameConfig?.subMode === 'time_trial') {
        updateGhostPlayback(FIXED_PHYSICS_STEP);
      }

      // ── Follow-the-Leader tick ──
      if (gameConfig?.subMode === 'follow_the_leader' && isFTLActive() && raceBots.length > 0) {
        const playerProg = _useCheckpoints ? getRaceProgress() : 0;
        const standings = getRacePositions(raceBots, playerProg);
        const ftlResult = updateFTL(FIXED_PHYSICS_STEP, playerProg, standings);
        if (ftlResult.eliminated) {
          raceState.raceFinished = true;
          showFinishMessage(0, 'ELIMINATED!');
          stopEngineSound(); stopBGM();
          playSFX('crash');
        } else if (ftlResult.winner) {
          raceState.raceFinished = true;
          showFinishMessage(0, 'YOU WIN!');
          stopEngineSound(); stopBGM();
          playSFX('race_win');
          setTimeout(() => playPostRaceMusic(), 2500);
        }
      }

      // ── Soccer tick ──
      if (gameConfig?.subMode === 'soccer' && isSoccerActive()) {
        const soccerResult = updateSoccer(FIXED_PHYSICS_STEP);
        if (soccerResult.goal) {
          playSFX(soccerResult.goal === 'red' ? 'race_win' : 'crash');
        }
        if (soccerResult.finished) {
          raceState.raceFinished = true;
          const w = soccerResult.winner;
          const msg = w === 'red' ? 'RED WINS!' : w === 'blue' ? 'BLUE WINS!' : 'DRAW!';
          showFinishMessage(0, msg);
          stopEngineSound(); stopBGM();
          setTimeout(() => playPostRaceMusic(), 2500);
        }
      }

      // ── Checkpoint / Gate progress ──
      if (_useCheckpoints && carModel && !raceState.raceFinished) {
        const cpResult = updateCheckpoints(carModel.position);

        // Update lap counter HUD (create dynamically if needed)
        let lapEl = document.getElementById('lap-counter');
        if (!lapEl) {
          lapEl = document.createElement('div');
          lapEl.id = 'lap-counter';
          document.body.appendChild(lapEl);
        }
        lapEl.textContent = `Lap ${Math.min(cpResult.currentLap + 1, cpResult.totalLaps)} / ${cpResult.totalLaps}`;
        lapEl.style.display = 'block';

        // Last-lap fast music variant (STK convention)
        if (cpResult.lapCompleted && cpResult.currentLap === cpResult.totalLaps - 1 && !cpResult.raceFinished) {
          playSFX('last_lap');
          playFastVariant();
        }

        if (cpResult.raceFinished && !raceState.raceFinished) {
          showFinishMessage(cpResult.totalLaps, null);
          stopEngineSound();
          stopBGM();
          playSFX('race_win');
          setTimeout(() => playPostRaceMusic(), 2500);
          if (timerInterval) clearInterval(timerInterval);

          // Stop ghost recording for Time Trial
          if (gameConfig?.subMode === 'time_trial') {
            const elapsed = raceStartTime ? (Date.now() - raceStartTime) / 1000 : 0;
            stopRecording(elapsed);
          }

          // Grand Prix: report result and handle progression
          if (isGrandPrixActive()) {
            handleGrandPrixRaceEnd();
          }
        }
      } else if (gateData) {
        // Check if player passed through a gate
        const raceFinished = checkGateProximity(carModel, gateData);
        
        // IMPORTANT: Update our local copies of the gate position for resets
        currentGatePosition.copyFrom(gateData.currentGatePosition);
        currentGateQuaternion.copyFrom(gateData.currentGateQuaternion);
        
        // Make sure global reference is updated
        window.gateData = gateData;
        
        // Show finish message if race is complete
        if (raceFinished) {
          // Only show finish message if we haven't already shown it
          if (!raceState.raceFinished) {
            showFinishMessage(gateData.totalGates, null);

            // Stop engine & BGM, play finish fanfare
            stopEngineSound();
            stopBGM();
            playSFX('race_win');
            // Play post-race results music after fanfare SFX finishes
            setTimeout(() => playPostRaceMusic(), 2500);
            
            // Stop the race timer
            if (timerInterval) {
              clearInterval(timerInterval);
            }
            
            // In multiplayer mode, broadcast that you've finished
            if (raceState.isMultiplayer && isHost) {
              // Use existing broadcast mechanism or add a new one for race finish
              multiplayerState.broadcastRaceStart(); 
            }
          }
        }
        
        // Update gate fade effects
        updateGateFading(gateData.fadingGates);
      }
    }
    
    updateMarkers();

    // Update leaderboard for both single and multiplayer when race has started
    if (raceState.raceStarted) {
      updateLeaderboard();
      
      // Update minimap player positions
      if (carModel) {
        updateMinimapPlayers(carModel, multiplayerState?.opponentCars);
      }
    }

    // Send car data as before - only in multiplayer
    if (raceState.isMultiplayer) {
      sendCarData({carModel});
    }

    // Check if all players are connected in multiplayer
    if (raceState.isMultiplayer && !raceState.allPlayersConnected) {
      // Update waiting UI
      updateWaitingUI();
      
      // Check if all players are connected
      if (multiplayerState.checkAllPlayersConnected()) {
        raceState.allPlayersConnected = true;
        
        // Host triggers synchronized countdown
        if (isHost) {
          console.log("All players connected! Broadcasting countdown start...");
          // First broadcast countdown signal to all clients
          multiplayerState.broadcastCountdownStart();
          // Then start countdown locally (after a tiny delay to ensure network messages go out first)
          setTimeout(startCountdown, 50);
        }
      }
    }
    
    // Update leaderboard
    updateLeaderboard();

    // Update item HUD
    updateItemHUD();

    // Update position badge (large "1st" overlay)
    if (playerPositions.length > 0) {
      const myPlayerId = localStorage.getItem('myPlayerId');
      const myIdx = playerPositions.findIndex(p => p.id === myPlayerId || p.id === 'player');
      updatePositionBadge(myIdx >= 0 ? myIdx + 1 : playerPositions.length);
    }

    // Update nitro gauge (show boost remaining)
    const activeEff = getActiveEffect();
    if (activeEff && activeEff.type === 'boost') {
      updateNitroGauge(activeEff.timer / (activeEff.factor > 1.5 ? 2.0 : 1.5), true);
    } else {
      updateNitroGauge(0, false);
    }

    // Screen shake (per-frame)
    updateScreenShake(deltaTime, bRenderer?.canvas);

    // Check if all players have finished the race
    if (raceState.isMultiplayer && raceState.raceStarted && !finalLeaderboardShown) {
      const allFinished = checkAllPlayersFinished();
      
      if (allFinished) {
        finalLeaderboardShown = true;
        // Wait a moment to show the final leaderboard (after individual finish messages fade)
        setTimeout(showFinalLeaderboard, 5000);
      }
    }
  }

  // Update particles (drift sparks, boost flames, etc.)
  updateParticles(deltaTime, carModel, _kartState);

  // Update GLO underglow (colour, intensity, position tracking)
  updateGloSystem(gloSystem, deltaTime, carModel);
  
  // Render through Babylon.js engine (post-processing is built into DefaultRenderingPipeline)
  if (bRenderer && bRenderer.scene) {
    bRenderer.scene.render();
  }
}

// Add this new function to check if the car is flipped and auto-reset if needed
function checkCarFlipped(deltaTime) {
  // Get the car's up direction (Y axis in local space)
  const carUpVector = new Vector3(0, 1, 0);
  if (carModel.rotationQuaternion) {
    // Babylon.js: rotate via matrix
    const m = new (Vector3.Zero().constructor === Vector3 ? Object : Object);
    // Simple approach: use Quaternion to rotate the up vector
    const q = carModel.rotationQuaternion;
    // Manual quaternion rotation of (0,1,0)
    const ix = q.w * 0 + q.y * 0 - q.z * 1;
    const iy = q.w * 1 + q.z * 0 - q.x * 0;
    const iz = q.w * 0 + q.x * 1 - q.y * 0;
    const iw = -q.x * 0 - q.y * 1 - q.z * 0;
    carUpVector.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    carUpVector.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    carUpVector.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  }
  
  // World up vector
  const worldUp = new Vector3(0, 1, 0);
  
  // Dot product between car's up and world up
  const upDot = Vector3.Dot(carUpVector, worldUp);
  
  // Calculate change in dot product since last frame
  upDotDelta = Math.abs(upDot - prevUpDot);
  
  // Store current dot product for next frame
  prevUpDot = upDot;
  
  // Thresholds for flipped state
  const FLIPPED_THRESHOLD = 0.5;   // How upright the car is (smaller value = more tilted)
  const DOT_DELTA_THRESHOLD = 0.01; // How much the orientation is changing
  
  // Check if car is flipped or on its side AND not significantly changing orientation
  if (upDot < FLIPPED_THRESHOLD && upDotDelta < DOT_DELTA_THRESHOLD) {
    // If car wasn't previously flipped, start the timer
    if (!carIsFlipped) {
      carIsFlipped = true;
      carFlippedTime = 0;
    } else {
      // Car was already flipped, increase timer
      carFlippedTime += deltaTime;
      
      // If car has been flipped for more than 1 second, reset it
      if (carFlippedTime > 1) {
        console.log("Car was flipped for too long, auto-resetting");
        console.log(`upDot: ${upDot.toFixed(3)}, upDotDelta: ${upDotDelta.toFixed(5)}`);
        carIsFlipped = false;
        carFlippedTime = 0;
        
        // Reset car to last checkpoint
        if (gateData) {
          resetCarPosition(
            gateData.currentGatePosition, 
            gateData.currentGateQuaternion
          );
        }
      }
    }
  } else {
    // Car is not flipped or is actively changing orientation, reset the timer
    carIsFlipped = false;
    carFlippedTime = 0;
  }
}

// Enhanced lighting system - add this function
function setupEnhancedLighting() {
  // Lighting is now handled by babylon-renderer.js (initBabylonRenderer)
  // This stub is kept for call-site compatibility.
}



// Add this new function to check if all players have finished
function checkAllPlayersFinished() {
  // If no multiplayer or no players, return false
  if (!raceState.isMultiplayer || !multiplayerState || !allPlayers || allPlayers.length === 0) {
    return false;
  }
  
  // Count active players (excluding disconnected ones)
  let activePlayers = 0;
  let finishedCount = 0;
  
  // Count myself if I've finished
  if (raceState.raceFinished) {
    finishedCount++;
  }
  activePlayers++; 
  
  // Check opponents
  Object.values(multiplayerState.opponentCars).forEach(opponent => {
    // Only count opponents that are active (have been updated recently)
    const isActive = opponent.lastUpdate && (Date.now() - opponent.lastUpdate < 10000);
    
    if (isActive) {
      activePlayers++;
      
      // Check if this opponent has finished
      if (opponent.raceProgress && opponent.raceProgress.currentGateIndex >= gateData.totalGates) {
        finishedCount++;
      }
    }
  });
  console.log(`Active players: ${activePlayers}, Finished count: ${finishedCount}`); 
  // All players have finished when finished count equals active players
  return finishedCount === activePlayers && activePlayers > 0;
}

// Add this function to your main.js
function handleOrientationChange() {
  const rotateMessage = document.getElementById('rotate-message');
  const canvas = document.querySelector('canvas');
  const joystickContainer = document.getElementById('joystick-container');
  
  if (window.innerHeight > window.innerWidth) {
    // Portrait mode
    if (rotateMessage) rotateMessage.style.display = 'flex';
    if (canvas) canvas.style.display = 'none';
    if (joystickContainer) joystickContainer.style.display = 'none';
    
    // Hide all game UI
    const gameElements = document.querySelectorAll('#leaderboard');
    gameElements.forEach(el => {
      if (el) el.style.display = 'none';
    });
  } else {
    // Landscape mode
    if (rotateMessage) rotateMessage.style.display = 'none';
    if (canvas) canvas.style.display = 'block';
    
    // Restore game UI visibility
    const leaderboard = document.getElementById('leaderboard');
    if (leaderboard) leaderboard.style.display = 'block';
    
    // Show joystick only on mobile in landscape mode
    if (joystickContainer) {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
      joystickContainer.style.display = isMobile ? 'block' : 'none';
    }
  }
  
  // If Babylon engine exists, trigger resize (engine handles projection automatically)
  if (bRenderer) {
    bRenderer.engine.resize();
  }
}

// Add after the init() function and before animate()

function createMobileControls() {
  // Create joystick container
  const joystickContainer = document.createElement('div');
  joystickContainer.id = 'joystick-container';
  joystickContainer.style.position = 'fixed';
  joystickContainer.style.bottom = '100px';
  joystickContainer.style.left = '20px';
  joystickContainer.style.width = '120px';
  joystickContainer.style.height = '120px';
  joystickContainer.style.borderRadius = '50%';
  joystickContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  joystickContainer.style.border = '2px solid rgba(255, 255, 255, 0.3)';
  joystickContainer.style.display = 'none'; // Hidden by default, shown on mobile
  joystickContainer.style.zIndex = '1000';
  joystickContainer.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  joystickContainer.style.touchAction = 'none'; // Prevent scrolling on touch
  
  // Create joystick knob
  const joystickKnob = document.createElement('div');
  joystickKnob.id = 'joystick-knob';
  joystickKnob.style.position = 'absolute';
  joystickKnob.style.top = '50%';
  joystickKnob.style.left = '50%';
  joystickKnob.style.width = '50px';
  joystickKnob.style.height = '50px';
  joystickKnob.style.borderRadius = '50%';
  joystickKnob.style.backgroundColor = '#ff0080';
  joystickKnob.style.border = '2px solid #b30059';
  joystickKnob.style.transform = 'translate(-50%, -50%)';
  joystickKnob.style.boxShadow = '0 0 10px rgba(255, 0, 128, 0.5)';
  
  // Add knob to container
  joystickContainer.appendChild(joystickKnob);
  document.body.appendChild(joystickContainer);
  
  // Variables to track joystick state
  let isJoystickActive = false;
  let centerX, centerY;
  const maxDistance = 40; // Maximum distance the knob can move from center
  
  // Function to update knob position
  function updateKnobPosition(x, y) {
    // Calculate distance from center
    const deltaX = x - centerX;
    const deltaY = y - centerY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Normalize if distance exceeds maximum
    let moveX = deltaX;
    let moveY = deltaY;
    if (distance > maxDistance) {
      moveX = (deltaX / distance) * maxDistance;
      moveY = (deltaY / distance) * maxDistance;
    }
    
    // Update knob position
    joystickKnob.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    
    // Update keyState based on joystick position
    const thresholdPercent = 0.3; // How far the joystick needs to move to trigger a key press
    const threshold = maxDistance * thresholdPercent;
    
    // Clear previous state
    keyState.w = false;
    keyState.s = false;
    keyState.a = false;
    keyState.d = false;
    
    // Set new state based on position
    if (moveY < -threshold) keyState.w = true;
    if (moveY > threshold) keyState.s = true;
    if (moveX < -threshold) keyState.a = true;
    if (moveX > threshold) keyState.d = true;
  }
  
  // Function to reset knob position
  function resetKnobPosition() {
    joystickKnob.style.transform = 'translate(-50%, -50%)';
    // Reset keyState
    keyState.w = false;
    keyState.s = false;
    keyState.a = false;
    keyState.d = false;
  }
  
  // Touch event handlers
  joystickContainer.addEventListener('touchstart', function(e) {
    isJoystickActive = true;
    
    // Get container position
    const rect = joystickContainer.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    
    // Update knob position immediately
    updateKnobPosition(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  });
  
  joystickContainer.addEventListener('touchmove', function(e) {
    if (!isJoystickActive) return;
    updateKnobPosition(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  });
  
  const touchEndHandler = function() {
    if (!isJoystickActive) return;
    isJoystickActive = false;
    resetKnobPosition();
  };
  
  joystickContainer.addEventListener('touchend', touchEndHandler);
  joystickContainer.addEventListener('touchcancel', touchEndHandler);
  
  // Show joystick on mobile devices
  function checkMobile() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    joystickContainer.style.display = isMobile ? 'block' : 'none';
  }
  
  // Check on load and when window resizes
  checkMobile();
  window.addEventListener('resize', checkMobile);
  
  return joystickContainer;
}

// ── Custom track builder ────────────────────────────────────────
async function buildCustomTrackScene(trackData, babylonScene, SEGMENT_TYPES, generateSegmentGeometry, bRenderer) {
  const BABYLON = window.BABYLON || {};
  // Dynamically resolve Babylon from the scene's engine
  const engine = babylonScene.getEngine();

  // Ground plane
  const ground = BABYLON.MeshBuilder
    ? BABYLON.MeshBuilder.CreateGround('customGround', { width: 400, height: 400 }, babylonScene)
    : (() => { console.warn('BABYLON.MeshBuilder not available'); return null; })();

  if (ground) {
    const groundMat = new BABYLON.StandardMaterial('groundMat', babylonScene);
    groundMat.diffuseColor = new BABYLON.Color3(0.08, 0.08, 0.15);
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;
    ground.receiveShadows = true;
    ground.position.y = -0.05;

    // Ground physics collider (unified scene — PhysicsAggregate on the visual mesh)
    try {
      const { PhysicsAggregate } = await import('@babylonjs/core/Physics/v2/physicsAggregate');
      const { PhysicsShapeType } = await import('@babylonjs/core/Physics/v2/IPhysicsEnginePlugin');
      new PhysicsAggregate(ground, PhysicsShapeType.BOX, { mass: 0, friction: 0.8 }, babylonScene);
    } catch { /* physics may not be ready */ }
  }

  // Build track segments as Babylon meshes with colliders
  if (trackData.segments && trackData.segments.length > 0) {
    for (const seg of trackData.segments) {
      const st = SEGMENT_TYPES[seg.type];
      if (!st) continue;

      const w = (st.width || 10);
      const l = (st.length || 10);
      const h = Math.abs(st.height || 0.3);

      // Create a simple box or ramp mesh for each segment
      let mesh;
      if (BABYLON.MeshBuilder) {
        if (seg.type === 'ramp_up' || seg.type === 'ramp_down') {
          // Ramp: angled box
          mesh = BABYLON.MeshBuilder.CreateBox(`seg_${seg.id}`, { width: w, height: h + 0.3, depth: l }, babylonScene);
        } else {
          mesh = BABYLON.MeshBuilder.CreateBox(`seg_${seg.id}`, { width: w, height: 0.3, depth: l }, babylonScene);
        }
      }

      if (mesh) {
        mesh.position.set(seg.position.x, seg.position.y + 0.15, seg.position.z);
        mesh.rotation.y = (seg.rotation || 0) * Math.PI / 180;

        const mat = new BABYLON.StandardMaterial(`segMat_${seg.id}`, babylonScene);
        mat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.9);
        mat.emissiveColor = new BABYLON.Color3(0.05, 0.1, 0.2);
        mat.specularColor = new BABYLON.Color3(0.2, 0.2, 0.3);
        mesh.material = mat;
        mesh.receiveShadows = true;

        // Add physics collider (unified scene — PhysicsAggregate on the visual mesh)
        try {
          const { PhysicsAggregate } = await import('@babylonjs/core/Physics/v2/physicsAggregate');
          const { PhysicsShapeType } = await import('@babylonjs/core/Physics/v2/IPhysicsEnginePlugin');
          new PhysicsAggregate(mesh, PhysicsShapeType.BOX, { mass: 0, friction: 0.6 }, babylonScene);
        } catch { /* physics may not be ready */ }
      }
    }
  }

  // Build obstacles
  if (trackData.obstacles) {
    for (const obs of trackData.obstacles) {
      if (!BABYLON.MeshBuilder) continue;
      const mesh = BABYLON.MeshBuilder.CreateBox(`obs_${obs.type}`, { size: 1.5 }, babylonScene);
      mesh.position.set(obs.position.x, obs.position.y, obs.position.z);
      const mat = new BABYLON.StandardMaterial(`obsMat`, babylonScene);
      mat.diffuseColor = obs.type === 'boost_pad' ? new BABYLON.Color3(1, 1, 0) :
                         obs.type === 'banana' ? new BABYLON.Color3(1, 0.8, 0) :
                         new BABYLON.Color3(0.8, 0.2, 0.2);
      mesh.material = mat;
    }
  }

  console.log(`Custom track built: ${trackData.name} — ${trackData.segments?.length || 0} segments`);
}

// Start initialization
if (!useColyseusRealtime) {
  init();
}
