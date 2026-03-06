/*
 * GLO KARTS - BATTLE MODE
 * Main game loop for battle/combat mode
 * This is completely separate from race mode (main.js)
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import "@babylonjs/loaders/glTF";
import "./style.css";
import { initBabylonRenderer } from './modules/babylon-renderer.js';
import { createVehicle, resetCarPosition } from './modules/babylon-car.js';
import { initPhysics, updatePhysics, FIXED_PHYSICS_STEP } from './modules/physics.js';
import { resetKart } from './modules/havok-physics.js';
import { 
  initMultiplayer, 
  updateMarkers, 
  sendCarData,
  interpolateOpponents,
} from './modules/multiplayer.js';
import { loadArena } from './modules/battle/arena.js';
import { createHealthSystem } from './modules/battle/health.js';
import { initWeapons, attemptFire, getWeaponDef, hostBroadcastPickups } from './modules/battle/weapons.js';
import {
  playTrackMusic, playSFX, playWeaponFireSFX,
  startEngineSound, updateEnginePitch, stopEngineSound,
  playCountdownSequence, stopBGM, disposeAudio,
} from './modules/game-audio.js';
import { initParticles, updateParticles, emitHitBurst } from './modules/babylon-particles.js';
import { loadTrackData, getNavmesh } from './modules/track-data-loader.js';
import {
  createBattleBots, updateBattleBots, damageBattleBot,
  getBattleScoreboard, disposeBattleBots,
} from './modules/battle-bot-controller.js';

console.log('🎮 BATTLE MODE LOADING...');

function getCurrentPlayerId() {
  return sessionStorage.getItem('myPlayerId') || localStorage.getItem('myPlayerId');
}

/**
 * Blink the kart model to show invulnerability after a respawn.
 * Toggles mesh visibility 8 times over 1.6 seconds then restores fully visible.
 * @param {THREE.Object3D|null} model - the car root mesh (may be null if not yet loaded)
 */
function _doRespawnBlink(model) {
  if (!model) return;
  let count = 0;
  const BLINKS = 8;
  const INTERVAL_MS = 200;
  const id = setInterval(() => {
    model.traverse((child) => {
      if (child.isMesh) child.visible = count % 2 === 0;
    });
    count++;
    if (count > BLINKS * 2) {
      clearInterval(id);
      model.traverse((child) => { if (child.isMesh) child.visible = true; });
    }
  }, INTERVAL_MS);
}

// Check for game config from lobby
let gameConfig = null;
let isHost = false;
let allPlayers = [];

try {
  const savedConfig = sessionStorage.getItem('gameConfig');
  if (savedConfig) {
    gameConfig = JSON.parse(savedConfig);
    
    // Check if we're the host
    const myPlayerId = getCurrentPlayerId();
    isHost = gameConfig.players.some(player => player.id === myPlayerId && player.isHost);
    
    console.log('Battle config loaded:', gameConfig);
    console.log('Playing as host:', isHost);
    
    // Store player list
    allPlayers = gameConfig.players;
  }
} catch (e) {
  console.error('Error loading battle config:', e);
}

const useColyseusRealtime = Boolean(gameConfig?.multiplayer)
  && String(gameConfig?.multiplayerProvider || '').toLowerCase() === 'colyseus';

if (useColyseusRealtime) {
  window.location.replace('realtime.html');
}

// Global variables
let camera, scene, renderer;
let bRenderer = null;
let lastTime = performance.now();
const clock = { getDelta() { const now = performance.now(); const dt = (now - lastTime) / 1000; lastTime = now; return dt; } };

// Car components
let wheelMeshes = [];
let carModel;

// Control state
const keyState = {
  w: false, s: false, a: false, d: false, space: false
};

// Debug HUD state
let currentSpeedKPH = 0;

// Camera parameters
const CAMERA_DISTANCE = 12;  
const CAMERA_HEIGHT = 6;     
const CAMERA_LERP = 0.1;     
const CAMERA_LOOK_AHEAD = 2; 

// Battle state variables
let battleState = {
  isMultiplayer: false,
  allPlayersConnected: false,
  countdownStarted: false,
  battleStarted: false,
  battleFinished: false,
  countdownValue: 3,
  health: 100,
  maxHealth: 100,
  score: 0,
  currentWeapon: null,
  invulnerable: false,
  battleType: (gameConfig && gameConfig.battleType) ? gameConfig.battleType : 'deathmatch'
};

let healthSystem = null;
let arenaInfo = null; // populated after loadArena
let playerSpawnIndex = 0; // index into arena spawn points
let weaponsSystem = null; // weapons module interface
let battlePostProcessing = null; // bloom + SMAA pipeline
let ctfState = null;
let ctfSyncClock = 0;
let battleBots = []; // AI opponents for single-player battle
let battleNavmesh = null; // cached navmesh for bots

const CTF_CAPTURE_RADIUS = 4;
const CTF_FLAG_PICKUP_RADIUS = 3.4;

// Multiplayer variables
let multiplayerState;

// Initialize everything
async function init() {
  console.log('🏁 Initializing Battle Mode...');

  try {
    // Initialize Havok physics engine
    console.log('Initializing Havok physics...');
    await initPhysics();
    console.log('✅ Havok physics initialized');

    // Create Babylon.js renderer (scene + camera + lights + post-processing)
    bRenderer = await initBabylonRenderer('app');
    scene = bRenderer.scene;
    camera = bRenderer.camera;
    renderer = bRenderer.engine;
    initParticles(scene); // Initialize particle / VFX pools

    // Ensure canvas can receive keyboard focus
    bRenderer.canvas.tabIndex = 1;
    bRenderer.canvas.addEventListener('click', () => bRenderer.canvas.focus());
    setTimeout(() => bRenderer.canvas.focus(), 0);

  // Dev: create connection status badge
  createConnectionStatusBadge();

    // Lights handled by babylon-renderer.js

    // Create arena (modular)
    console.log('Creating arena...');
  // Support new lobby-driven arenaId field
  const arenaId = (gameConfig && (gameConfig.arenaId || gameConfig.battleArena)) ? (gameConfig.arenaId || gameConfig.battleArena) : 'test_box';
    arenaInfo = loadArena(scene, arenaId);
    window._battleArenaInfo = arenaInfo; // for debugging
    console.log('✅ Arena created', arenaInfo);

    // Determine spawn index based on player list ordering
    if (gameConfig && gameConfig.spawnMap && gameConfig.players) {
      // Use explicit spawnMap from lobby if present
      const myId = getCurrentPlayerId();
      if (myId && typeof gameConfig.spawnMap[myId] === 'number') {
        playerSpawnIndex = gameConfig.spawnMap[myId] % arenaInfo.spawnPoints.length;
      } else {
        const idx = gameConfig.players.findIndex(p => p.id === myId);
        playerSpawnIndex = idx >= 0 ? idx % arenaInfo.spawnPoints.length : 0;
      }
    } else if (gameConfig && gameConfig.players) {
      const myId = getCurrentPlayerId();
      const idx = gameConfig.players.findIndex(p => p.id === myId);
      playerSpawnIndex = idx >= 0 ? idx % arenaInfo.spawnPoints.length : 0;
    } else {
      playerSpawnIndex = 0;
    }

    // Create player car
    console.log('Creating player car...');
  await createPlayerCar();
  console.log('✅ Player car created');
  // Apply initial spawn transform after car is created
    // If host sent a spawn assignment earlier, use it
    if (typeof window.pendingSpawnIndex === 'number') {
      playerSpawnIndex = window.pendingSpawnIndex;
      delete window.pendingSpawnIndex;
    }
    applySpawnTransform();

    // Initialize health system
    healthSystem = createHealthSystem({
      onRespawn: () => {
        // Re-apply spawn transform on respawn
        applySpawnTransform();
        // Respawn FX: blink the car model + play respawn sound
        playSFX('respawn');
        _doRespawnBlink(carModel);
      },
      maxHealth: battleState.maxHealth,
      invulnMs: 2000,
    });

    // Initialize weapons system (after arena + car). Multiplayer reference may be null now and will be patched once multiplayer initializes.
    weaponsSystem = initWeapons({
      scene,
      isHost,
      multiplayerState, // will be replaced after initMultiplayer
      arenaInfo
    });

    if (battleState.battleType === 'ctf') {
      initCtfMode();
    }

    // Setup controls
    setupControls();

    // Create battle bots for single-player mode
    if (!gameConfig || !gameConfig.multiplayer || gameConfig.players.length <= 1) {
      const arenaId = (gameConfig && (gameConfig.arenaId || gameConfig.battleArena))
        ? (gameConfig.arenaId || gameConfig.battleArena) : 'test_box';
      const td = await loadTrackData(arenaId, 'arena');
      if (td) {
        battleNavmesh = getNavmesh(td);
        const spawnPos = td.spawnPositions || arenaInfo.spawnPoints.map(p => ({ position: [p.x, p.y, p.z], heading: 0 }));
        if (battleNavmesh) {
          battleBots = createBattleBots(scene, battleNavmesh, spawnPos, 4);
          console.log(`✅ Created ${battleBots.length} battle bots`);
        }
      }
    }

    // Initialize multiplayer if needed
    if (gameConfig && gameConfig.multiplayer && gameConfig.players.length > 1) {
      battleState.isMultiplayer = true;
      console.log('Initializing multiplayer...');
      multiplayerState = initMultiplayer({
        scene: scene,
        camera: camera,
        carModel: null
      });
      // Expose for debugging
      window.multiplayerState = multiplayerState;
      console.log('✅ Multiplayer initialized for battle mode');
      // Patch weapons system with multiplayer reference now that it's available
      if (weaponsSystem && weaponsSystem.getState) {
        weaponsSystem.getState().multiplayerState = multiplayerState;
        console.log('[Weapons] Multiplayer state attached post-init');
        // If we are host, broadcast current pickups (even if empty) so guests can clear stale copies
        if (isHost) {
          try { hostBroadcastPickups(); } catch(e){ console.warn('hostBroadcastPickups failed post attach', e); }
        }
      }
    }

    // Hide loading screen
    console.log('Hiding loading screen...');
    hideLoadingScreen();

    // Start game loop
    animate();

    console.log('✅ Battle Mode Ready!');
  } catch (error) {
    console.error('❌ Failed to initialize battle mode:', error);
    // Hide loading screen even on error
    hideLoadingScreen();
    // Show error message
    alert('Failed to load battle mode: ' + error.message);
  }
}

// Create player car (use callback pattern like race mode)
async function createPlayerCar() {
  console.log('Creating player car...');

  try {
    // Get player color from session storage or use default (used by car module)
    const playerColor = sessionStorage.getItem('carColor') || 'red';
    console.log('Player color:', playerColor);

    // Create vehicle; update visuals in callback when model loads
    const components = createVehicle(
      scene,
      (loaded) => {
        wheelMeshes = loaded.wheelMeshes;
        carModel = loaded.carModel;
        console.log('✅ Player car visuals loaded');
      },
      bRenderer.shadowGen
    );

    // Set references immediately
    wheelMeshes = components.wheelMeshes;
    carModel = components.carModel; // will be null until model loads

    console.log('✅ Player car physics created');
  } catch (error) {
    console.error('Error creating player car:', error);
    // Continue anyway - the arena will still load
  }
}

// Setup controls
function setupControls() {
  // Normalize a key into our keyState map (supports WASD and arrow keys)
  const normalizeKey = (e) => {
    const k = e.key?.toLowerCase?.() || '';
    const code = e.code || '';
    if (k === 'arrowup' || code === 'ArrowUp') return 'w';
    if (k === 'arrowdown' || code === 'ArrowDown') return 's';
    if (k === 'arrowleft' || code === 'ArrowLeft') return 'a';
    if (k === 'arrowright' || code === 'ArrowRight') return 'd';
    if (k === ' ') return 'space';
    return k;
  };

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    const key = normalizeKey(e);
    if (key in keyState) {
      keyState[key] = true;
      e.preventDefault();
    }
    // Dev: test damage key (H)
    if (e.key && e.key.toLowerCase() === 'h') {
      applyDamage(10);
    }
    // Update HUD immediately for responsiveness
    updateDebugHUD();
  });
  
  document.addEventListener('keyup', (e) => {
    const key = normalizeKey(e);
    if (key in keyState) {
      keyState[key] = false;
      e.preventDefault();
    }
    
    // Space for weapon fire
    if (key === 'space') {
      handleWeaponFire();
      e.preventDefault();
    }
    // Update HUD immediately for responsiveness
    updateDebugHUD();
  });
  
  // Window resize
  window.addEventListener('resize', onWindowResize);
}

function handleWeaponFire() {
  if (!battleState.battleStarted) return;
  if (!battleState.currentWeapon) return;
  if (!carModel) return;
  // In multiplayer guest role, request host to fire to avoid duplicate local projectiles
  if (battleState.isMultiplayer && multiplayerState && !multiplayerState.isHost) {
    if (weaponsSystem && typeof weaponsSystem.requestFire === 'function') {
      weaponsSystem.requestFire();
      // consume locally for UI
      battleState.currentWeapon = null;
      console.log('🔫 Requested host to fire weapon');
    }
    return;
  }
  // Host or singleplayer fires locally
  const fired = attemptFire(carModel, battleState);
  if (fired) {
    console.log('🔫 Fired weapon');
    playWeaponFireSFX(battleState.currentWeapon || 'missile');
  }
}

function onWindowResize() {
  if (bRenderer && bRenderer.engine) {
    bRenderer.engine.resize();
  }
}

// Apply the arena spawn transform to the player's car
function applySpawnTransform() {
  if (!arenaInfo || !arenaInfo.spawnPoints || arenaInfo.spawnPoints.length === 0) return;
  const spawn = arenaInfo.spawnPoints[playerSpawnIndex % arenaInfo.spawnPoints.length];
  resetKart({ x: spawn.x, y: spawn.y, z: spawn.z }, 0);
}

// ----- Health & Respawn (incremental) -----
function applyDamage(amount) {
  // Hit VFX & SFX on local player
  if (carModel) {
    emitHitBurst(carModel.position, 0xff2222, 15);
    playSFX('crash');
  }
  // Prefer modular health system if available
  if (healthSystem) {
    const st = healthSystem.damage(amount);
    battleState.health = st.health;
    battleState.invulnerable = !!st.invulnerable;
    return;
  }
  // Fallback simple logic
  if (battleState.invulnerable) return;
  battleState.health = Math.max(0, battleState.health - amount);
  if (battleState.health <= 0) {
    respawnPlayer();
  }
}

function respawnPlayer() {
  // Prefer modular health system if available
  if (healthSystem) {
    const st = healthSystem.respawn();
    battleState.health = st.health;
    battleState.invulnerable = !!st.invulnerable;
    return;
  }
  // Fallback simple respawn at arena center
  resetKart({ x: 0, y: 3, z: 0 }, 0);

  battleState.health = battleState.maxHealth;
  battleState.invulnerable = true;
  setTimeout(() => { battleState.invulnerable = false; }, 2000);
}

function hideLoadingScreen() {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.style.opacity = '0';
    setTimeout(() => {
      loadingScreen.style.display = 'none';
      
      // Start countdown
      startCountdown();
    }, 500);
  }
}

function startCountdown() {
  battleState.countdownStarted = true;
  createCountdownOverlay();
  let remaining = 3;
  updateCountdownOverlay(remaining);

  // Play countdown audio SFX (3-2-1-GO)
  playCountdownSequence();

  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      updateCountdownOverlay(remaining);
    } else {
      clearInterval(interval);
      battleState.battleStarted = true;
      updateCountdownOverlay('GO!');
      setTimeout(removeCountdownOverlay, 600);

      // Start engine sound & arena BGM
      startEngineSound();
      const arenaId = (gameConfig && (gameConfig.arenaId || gameConfig.battleArena))
        ? (gameConfig.arenaId || gameConfig.battleArena) : 'test_box';
      playTrackMusic(arenaId);
    }
  }, 1000);
}

// Expose for multiplayer countdown sync
window.startCountdown = startCountdown;
// Allow multiplayer to set spawn index when received from host
window.setBattleSpawnIndex = function(idx){
  if (typeof idx === 'number') {
    playerSpawnIndex = idx;
    // if not started yet, reposition immediately
    if (!battleState.battleStarted) {
      applySpawnTransform();
    }
  }
};

// Countdown overlay helpers
function createCountdownOverlay() {
  if (document.getElementById('countdown-overlay')) return;
  const el = document.createElement('div');
  el.id = 'countdown-overlay';
  el.style.position = 'fixed';
  el.style.top = '0';
  el.style.left = '0';
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontFamily = 'Poppins, sans-serif';
  el.style.fontSize = '8rem';
  el.style.fontWeight = '800';
  el.style.color = '#fff';
  el.style.textShadow = '0 0 20px rgba(0,0,0,0.6)';
  el.style.zIndex = '999';
  el.style.pointerEvents = 'none';
  el.style.background = 'rgba(0,0,0,0.25)';
  el.style.transition = 'opacity 0.4s ease';
  document.body.appendChild(el);
}

function updateCountdownOverlay(text) {
  const el = document.getElementById('countdown-overlay');
  if (!el) return;
  el.textContent = text;
  el.style.opacity = '1';
}

function removeCountdownOverlay() {
  const el = document.getElementById('countdown-overlay');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 400);
}

function updateBattleUI() {
  // Update health bar
  const healthBar = document.getElementById('health-bar');
  const healthValue = document.getElementById('health-value');
  if (healthBar && healthValue) {
    const healthPercent = (battleState.health / battleState.maxHealth) * 100;
    healthBar.style.width = healthPercent + '%';
    healthValue.textContent = Math.ceil(battleState.health);
    
    // Color coding
    if (healthPercent > 60) {
      healthBar.style.backgroundColor = '#4ade80'; // Green
    } else if (healthPercent > 30) {
      healthBar.style.backgroundColor = '#fbbf24'; // Yellow
    } else {
      healthBar.style.backgroundColor = '#ef4444'; // Red
    }
  }
  
  // Update score
  const scoreValue = document.getElementById('score-value');
  if (scoreValue) {
    if (battleState.battleType === 'ctf' && ctfState) {
      scoreValue.textContent = `R ${ctfState.scores.red} : ${ctfState.scores.blue} B`;
    } else {
      scoreValue.textContent = battleState.score;
    }
  }
  
  // Update weapon display
  const weaponDisplay = document.getElementById('weapon-display');
  if (weaponDisplay) {
    if (battleState.currentWeapon) {
      weaponDisplay.innerHTML = `
        <span class="weapon-icon">${battleState.currentWeapon.icon || '🎯'}</span>
        <span class="weapon-name">${battleState.currentWeapon.name || 'WEAPON'}</span>
      `;
    } else {
      weaponDisplay.innerHTML = `
        <span class="weapon-icon">🚫</span>
        <span class="weapon-name">NONE</span>
      `;
    }
  }

  // Update battle scoreboard when bots are present
  if (battleBots.length > 0) {
    let sb = document.getElementById('battle-scoreboard');
    if (!sb) {
      sb = document.createElement('div');
      sb.id = 'battle-scoreboard';
      sb.style.cssText = 'position:fixed;top:12px;right:12px;background:rgba(0,0,0,0.6);color:#fff;font-family:Poppins,sans-serif;font-size:13px;padding:8px 12px;border-radius:8px;z-index:100;min-width:140px;pointer-events:none;';
      document.body.appendChild(sb);
    }
    const board = getBattleScoreboard(battleBots, battleState.score);
    let html = '<div style="font-weight:700;margin-bottom:4px;font-size:14px">SCOREBOARD</div>';
    board.forEach((entry, i) => {
      const isPlayer = entry.id === 'player';
      const color = isPlayer ? '#4ade80' : '#ccc';
      html += `<div style="color:${color};${isPlayer ? 'font-weight:700' : ''}">${i + 1}. ${entry.name}: ${entry.score}</div>`;
    });
    sb.innerHTML = html;
  }
}

function getLocalPlayerId() {
  return localStorage.getItem('myPlayerId') || gameConfig?.players?.[0]?.id || 'solo-player';
}

function getTeamForPlayer(playerId) {
  if (!gameConfig?.players?.length) return 'red';
  const idx = gameConfig.players.findIndex(p => p.id === playerId);
  if (idx < 0) return 'red';
  return idx % 2 === 0 ? 'red' : 'blue';
}

function initCtfMode() {
  if (!scene || !arenaInfo) return;

  const width = arenaInfo?.bounds?.width || 100;
  const baseOffset = Math.max(16, Math.floor(width * 0.32));

  const redBase = new Vector3(-baseOffset, 0.4, 0);
  const blueBase = new Vector3(baseOffset, 0.4, 0);

  const makeBase = (pos, color) => {
    const mesh = MeshBuilder.CreateCylinder('ctfBase', { height: 0.35, diameter: 6.4, tessellation: 24 }, scene);
    const mat = new StandardMaterial('ctfBaseMat', scene);
    const c3 = Color3.FromHexString('#' + color.toString(16).padStart(6, '0'));
    mat.diffuseColor = c3;
    mat.emissiveColor = c3.scale(0.2);
    mesh.material = mat;
    mesh.position.copyFrom(pos);
    mesh.receiveShadows = true;
  };

  const makeFlag = (pos, color) => {
    const pole = MeshBuilder.CreateCylinder('ctfPole', { height: 2.2, diameter: 0.16, tessellation: 10 }, scene);
    const poleMat = new StandardMaterial('ctfPoleMat', scene);
    poleMat.diffuseColor = Color3.FromHexString('#d0d0d0');
    pole.material = poleMat;
    pole.position.copyFrom(pos).addInPlace(new Vector3(0, 1.1, 0));

    const cloth = MeshBuilder.CreateBox('ctfCloth', { width: 1.0, height: 0.55, depth: 0.05 }, scene);
    const clothMat = new StandardMaterial('ctfClothMat', scene);
    const c3 = Color3.FromHexString('#' + color.toString(16).padStart(6, '0'));
    clothMat.diffuseColor = c3;
    clothMat.emissiveColor = c3.scale(0.25);
    cloth.material = clothMat;
    cloth.position.copyFrom(pos).addInPlace(new Vector3(0.55, 1.75, 0));

    return { pole, cloth };
  };

  makeBase(redBase, 0xaa2a2a);
  makeBase(blueBase, 0x2a4aaa);
  const redFlagMesh = makeFlag(redBase, 0xff3b3b);
  const blueFlagMesh = makeFlag(blueBase, 0x3b7dff);

  const myId = getLocalPlayerId();
  const myTeam = getTeamForPlayer(myId);
  const scoreLimit = Number.isFinite(Number(gameConfig?.scoreLimit)) ? Number(gameConfig.scoreLimit) : 5;

  ctfState = {
    myId,
    myTeam,
    scoreLimit,
    scores: { red: 0, blue: 0 },
    red: {
      home: redBase.clone(),
      current: redBase.clone(),
      carrierId: null,
      mesh: redFlagMesh,
    },
    blue: {
      home: blueBase.clone(),
      current: blueBase.clone(),
      carrierId: null,
      mesh: blueFlagMesh,
    },
  };

  console.log(`[CTF] Initialized. Team=${myTeam} Limit=${scoreLimit}`);
}

function placeFlag(flagData) {
  if (!flagData?.mesh) return;
  flagData.mesh.pole.position.copyFrom(flagData.current).addInPlace(new Vector3(0, 1.1, 0));
  flagData.mesh.cloth.position.copyFrom(flagData.current).addInPlace(new Vector3(0.55, 1.75, 0));
}

function resetFlag(flagData) {
  flagData.carrierId = null;
  flagData.current.copyFrom(flagData.home);
}

function maybeBroadcastCtfState(deltaTime) {
  if (!battleState.isMultiplayer || !multiplayerState?.isHost || !ctfState) return;
  ctfSyncClock += deltaTime;
  if (ctfSyncClock < 0.2) return;
  ctfSyncClock = 0;

  const payload = {
    type: 'ctfStateUpdate',
    scores: ctfState.scores,
    red: { x: ctfState.red.current.x, y: ctfState.red.current.y, z: ctfState.red.current.z, carrierId: ctfState.red.carrierId },
    blue: { x: ctfState.blue.current.x, y: ctfState.blue.current.y, z: ctfState.blue.current.z, carrierId: ctfState.blue.carrierId },
  };
  (multiplayerState.playerConnections || []).forEach(conn => {
    try { if (conn?.open) conn.send(payload); } catch (e) { /* ignore */ }
  });
}

function checkCtfWin() {
  if (!ctfState) return;
  if (ctfState.scores.red >= ctfState.scoreLimit || ctfState.scores.blue >= ctfState.scoreLimit) {
    battleState.battleFinished = true;
    const winner = ctfState.scores.red > ctfState.scores.blue ? 'RED' : 'BLUE';
    setTimeout(() => alert(`CTF Match Over: ${winner} team wins!`), 50);
  }
}

function updateCtfMode(deltaTime) {
  if (!ctfState || !carModel || !battleState.battleStarted || battleState.battleFinished) return;

  const myPos = carModel.position;
  const myId = ctfState.myId;
  const myTeam = ctfState.myTeam;
  const ownFlag = myTeam === 'red' ? ctfState.red : ctfState.blue;
  const enemyFlag = myTeam === 'red' ? ctfState.blue : ctfState.red;
  const ownBase = ownFlag.home;

  if (!enemyFlag.carrierId && Vector3.Distance(myPos, enemyFlag.current) <= CTF_FLAG_PICKUP_RADIUS) {
    enemyFlag.carrierId = myId;
  }

  if (enemyFlag.carrierId === myId) {
    enemyFlag.current.copyFrom(myPos).addInPlace(new Vector3(0, 1.9, 0));
  }

  const ownFlagAtHome = Vector3.Distance(ownFlag.current, ownFlag.home) < 0.1 && !ownFlag.carrierId;
  const atOwnBase = Vector3.Distance(myPos, ownBase) <= CTF_CAPTURE_RADIUS;

  if (enemyFlag.carrierId === myId && ownFlagAtHome && atOwnBase) {
    ctfState.scores[myTeam] += 1;
    battleState.score = ctfState.scores[myTeam];
    resetFlag(enemyFlag);
    checkCtfWin();
  }

  placeFlag(ctfState.red);
  placeFlag(ctfState.blue);
  maybeBroadcastCtfState(deltaTime);
}

window.receiveCtfState = function(payload) {
  if (!ctfState || !payload) return;
  if (payload.scores) {
    ctfState.scores.red = Number(payload.scores.red || 0);
    ctfState.scores.blue = Number(payload.scores.blue || 0);
  }
  if (payload.red) {
    ctfState.red.current.set(Number(payload.red.x || 0), Number(payload.red.y || 0), Number(payload.red.z || 0));
    ctfState.red.carrierId = payload.red.carrierId || null;
  }
  if (payload.blue) {
    ctfState.blue.current.set(Number(payload.blue.x || 0), Number(payload.blue.y || 0), Number(payload.blue.z || 0));
    ctfState.blue.carrierId = payload.blue.carrierId || null;
  }
  placeFlag(ctfState.red);
  placeFlag(ctfState.blue);
};

function updateCamera() {
  if (!carModel) return;

  const carPos = carModel.position.clone();
  // Babylon.js forward is +Z in local space
  const fwd = new Vector3(0, 0, 1);
  const q = carModel.rotationQuaternion;
  if (q) {
    const ix = q.w * fwd.x + q.y * fwd.z - q.z * fwd.y;
    const iy = q.w * fwd.y + q.z * fwd.x - q.x * fwd.z;
    const iz = q.w * fwd.z + q.x * fwd.y - q.y * fwd.x;
    const iw = -q.x * fwd.x - q.y * fwd.y - q.z * fwd.z;
    fwd.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    fwd.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    fwd.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  }
  const carDir = fwd.normalize();

  const behindOffset = carDir.scale(-CAMERA_DISTANCE);
  const targetPos = carPos.add(behindOffset).add(new Vector3(0, CAMERA_HEIGHT, 0));

  camera.position = Vector3.Lerp(camera.position, targetPos, CAMERA_LERP);

  const lookAtPos = carModel.position.clone().add(carDir.scale(CAMERA_LOOK_AHEAD));
  camera.setTarget(lookAtPos);
}

// Main game loop
// Fixed timestep accumulator for stable physics
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;

  if (carModel) {
    // Map battle state to physics "race" state expectations
    const physicsModeState = {
      raceStarted: !!battleState.battleStarted,
      raceFinished: !!battleState.battleFinished,
    };

    // Run physics at fixed intervals
    while (accumulator >= FIXED_PHYSICS_STEP) {
      const carState = {
        carModel,
        wheelMeshes,
        keyState,
      };

      const physicsResult = updatePhysics(
        FIXED_PHYSICS_STEP,
        carState,
        physicsModeState
      );

      // Update speed for debug HUD
      if (physicsResult && typeof physicsResult.currentSpeed === 'number') {
        currentSpeedKPH = physicsResult.currentSpeed;
        updateEnginePitch(currentSpeedKPH);
      }

      accumulator -= FIXED_PHYSICS_STEP;
    }
  }

  // Update camera
  updateCamera();

  // Update multiplayer
  if (battleState.isMultiplayer && multiplayerState) {
    updateMarkers();
    if (battleState.battleStarted) {
      sendCarData({ carModel });
    }
    // Smooth remote opponent ghosts
    interpolateOpponents(deltaTime);
    // Host-only: check for PvP collision damage
    if (multiplayerState.isHost) {
      checkPvPCollisionsAndDamage();
    }
    // Ensure guests eventually see pickups if initial sync missed (simple periodic request)
    if (!multiplayerState.isHost && performance.now() % 5000 < 50) {
      try {
        const conn = multiplayerState.playerConnections && multiplayerState.playerConnections[0];
        if (conn && conn.open) conn.send({ type: 'pickupSyncRequest' });
      } catch(e){ /* ignore */ }
    }
  }

  // Update UI
  updateBattleUI();
  if (battleState.battleType === 'ctf') {
    updateCtfMode(deltaTime);
  }
  updateDebugHUD();
  // Update weapons (after core HUD so weapon changes appear next frame consistently)
  if (weaponsSystem && typeof weaponsSystem.update === 'function') {
    weaponsSystem.update(deltaTime, carModel, battleState);
  }

  // Update battle bots
  if (battleBots.length > 0 && battleNavmesh) {
    updateBattleBots(battleBots, deltaTime, carModel, battleState, battleNavmesh, (bot) => {
      // Bot fires at player — apply damage if not invulnerable
      if (carModel && !battleState.invulnerable) {
        const dist = Vector3.Distance(bot.position, carModel.position);
        if (dist < 20) {
          const damage = 10 + Math.floor(Math.random() * 15);
          applyDamage(damage);
          spawnDamageNumberAt(carModel.position.clone().addInPlace(new Vector3(0, 2, 0)), damage);
        }
      }
      // Bot gets a point for attacking
      bot.score++;
    });

    // Check player weapon hits on bots (proximity-based)
    if (weaponsSystem && typeof weaponsSystem.getProjectiles === 'function') {
      const projectiles = weaponsSystem.getProjectiles();
      for (let pi = projectiles.length - 1; pi >= 0; pi--) {
        const proj = projectiles[pi];
        if (proj.remote) continue;
        for (const bot of battleBots) {
          if (!bot.alive || bot.invulnTimer > 0) continue;
          const d = Vector3.Distance(proj.mesh.position, bot.position);
          if (d < 3.0) {
            const killed = damageBattleBot(bot, 25 + Math.floor(Math.random() * 15));
            if (killed) {
              battleState.score++;
              emitHitBurst(bot.position, 0xff4444, 20);
              playSFX('crash');
            }
            // Remove projectile
            proj.mesh.dispose();
            projectiles.splice(pi, 1);
            break;
          }
        }
      }
    }

    // Check player-bot collision damage (both sides)
    if (carModel && battleState.battleStarted) {
      const mySpeedMS = (currentSpeedKPH || 0) / 3.6;
      for (const bot of battleBots) {
        if (!bot.alive || bot.invulnTimer > 0) continue;
        const d = Vector3.Distance(bot.position, carModel.position);
        if (d < 3.0 && (mySpeedMS > 3 || bot.speed > 3)) {
          const impactDamage = Math.min(25, Math.max(5, Math.round((mySpeedMS + bot.speed) * 1.5)));
          const killed = damageBattleBot(bot, impactDamage);
          if (killed) {
            battleState.score++;
            emitHitBurst(bot.position, 0xff4444, 15);
          }
          if (!battleState.invulnerable) {
            applyDamage(Math.max(3, impactDamage * 0.5));
          }
        }
      }
    }
  }
  // Floating damage numbers animation
  if (typeof updateDamageNumbers === 'function') {
    updateDamageNumbers(deltaTime);
  }

  // Update particles (drift sparks, boost flames, hit effects)
  updateParticles(deltaTime, carModel, kartState);

  // Render (Babylon.js handles post-processing internally)
  scene.render();
}

// Debug HUD updater
function updateDebugHUD() {
  const hud = document.getElementById('debug-hud');
  if (!hud) return;
  // Speed is updated after physics step
  const speedEl = document.getElementById('debug-speed');
  const startedEl = document.getElementById('debug-started');
  const keysEl = document.getElementById('debug-keys');
  if (speedEl) speedEl.textContent = Math.round(currentSpeedKPH).toString();
  if (startedEl) startedEl.textContent = battleState.battleStarted ? 'yes' : 'no';
  if (keysEl) {
    keysEl.textContent = `W:${keyState.w?'1':'0'} A:${keyState.a?'1':'0'} S:${keyState.s?'1':'0'} D:${keyState.d?'1':'0'} SPACE:${keyState.space?'1':'0'}`;
  }
  updateConnectionStatusBadge();
}

// --- PvP Collision detection (host authoritative) ---
// Proximity-based collision with damage scaled by relative speed and angle.
const COLLISION_DISTANCE = 3.0; // meters
const COLLISION_COOLDOWN_MS = 900; // per-opponent cooldown
const MIN_IMPACT_SPEED_MS = 3.0; // ~11 km/h minimal threshold
const DAMAGE_SCALE = 3.0; // tuning multiplier for relative speed

// Track last impact time per opponent and rough opponent speed estimates
const lastCollisionById = new Map(); // id -> timestamp
const oppSpeedCache = new Map(); // id -> { pos: Vector3, t: number, speedMS: number }

function estimateOpponentSpeedMS(id, pos) {
  const now = performance.now();
  const prev = oppSpeedCache.get(id);
  if (prev) {
    const dt = Math.max(1, now - prev.t) / 1000; // seconds, avoid div-by-zero
    const dist = Vector3.Distance(pos, prev.pos);
    const speed = dist / dt; // m/s
    oppSpeedCache.set(id, { pos: pos.clone(), t: now, speedMS: speed });
    return speed;
  } else {
    oppSpeedCache.set(id, { pos: pos.clone(), t: now, speedMS: 0 });
    return 0;
  }
}

function checkPvPCollisionsAndDamage() {
  if (!carModel || !multiplayerState) return;

  // Precompute my kinematics
  const myPos = carModel.position;
  const myForward = new Vector3(0, 0, 1);
  if (carModel.rotationQuaternion) {
    const q = carModel.rotationQuaternion;
    const ix = q.w * 0 + q.y * 1 - q.z * 0;
    const iy = q.w * 0 + q.z * 0 - q.x * 1;
    const iz = q.w * 1 + q.x * 0 - q.y * 0;
    const iw = -q.z * 1;
    myForward.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
    myForward.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
    myForward.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
    myForward.normalize();
  }
  const mySpeedMS = (currentSpeedKPH || 0) / 3.6;

  const opponents = multiplayerState.opponentCars || {};

  const victimIds = [];
  let maxComputedDamage = 0;

  Object.entries(opponents).forEach(([playerId, opp]) => {
    if (!opp.model || !opp.model.visible) return;

    const oppPos = opp.model.position;
    const d = Vector3.Distance(oppPos, myPos);
    if (d > COLLISION_DISTANCE) return; // not colliding/proximate

    // Per-opponent cooldown
    const lastT = lastCollisionById.get(playerId) || 0;
    if (Date.now() - lastT < COLLISION_COOLDOWN_MS) return;

    // Estimate opponent speed and direction
    const oppSpeedMS = estimateOpponentSpeedMS(playerId, oppPos);
    const oppForward = new Vector3(0, 0, 1);
    if (opp.model.rotationQuaternion) {
      const oq = opp.model.rotationQuaternion;
      const oix = oq.w * 0 + oq.y * 1 - oq.z * 0;
      const oiy = oq.w * 0 + oq.z * 0 - oq.x * 1;
      const oiz = oq.w * 1 + oq.x * 0 - oq.y * 0;
      const oiw = -oq.z * 1;
      oppForward.x = oix * oq.w + oiw * -oq.x + oiy * -oq.z - oiz * -oq.y;
      oppForward.y = oiy * oq.w + oiw * -oq.y + oiz * -oq.x - oix * -oq.z;
      oppForward.z = oiz * oq.w + oiw * -oq.z + oix * -oq.y - oiy * -oq.x;
      oppForward.normalize();
    }

    // Impact geometry: angles and closing component
    const dirToOpp = oppPos.subtract(myPos).normalize();
    const dirToMe = myPos.subtract(oppPos).normalize();
    const closingFromMe = Math.max(0, myForward.dot(dirToOpp)); // 1 if I'm heading into opponent
    const closingFromOpp = Math.max(0, oppForward.dot(dirToMe)); // 1 if they're heading into me

    const relativeClosingSpeed = mySpeedMS * closingFromMe + oppSpeedMS * closingFromOpp;
    if (relativeClosingSpeed < MIN_IMPACT_SPEED_MS) return; // too light to cause damage

    // Damage scaled by speed and angle (head-on ~ highest)
    const headOnness = (closingFromMe + closingFromOpp) * 0.5; // 0..1
    const baseDamage = relativeClosingSpeed * DAMAGE_SCALE * (0.6 + 0.4 * headOnness);
    const amount = Math.max(5, Math.min(40, Math.round(baseDamage)));

    // Record victim; store greatest computed damage if multiple
    victimIds.push(playerId);
    if (amount > maxComputedDamage) maxComputedDamage = amount;
  });

  if (victimIds.length > 0) {
    const myId = multiplayerState.peer?.id;
    const uniqueVictims = Array.from(new Set([...victimIds, myId].filter(Boolean)));

    // Update cooldowns for each opponent we hit
    const now = Date.now();
    uniqueVictims.forEach(id => {
      if (id !== myId) lastCollisionById.set(id, now);
    });

    // Broadcast via multiplayer (symmetric damage for simplicity)
    const amount = maxComputedDamage || 10;
    if (typeof multiplayerState.broadcastDamageEvent === 'function') {
      multiplayerState.broadcastDamageEvent(uniqueVictims, amount, 'collision');
    }

    // Local floating number for feedback (host)
    spawnDamageNumberAt(myPos, amount);
  }
}

// Allow external damage application from multiplayer
window.applyExternalDamage = function(amount){
  applyDamage(amount);
};

// Simple visual damage feedback (screen flash)
let dmgFlashEl = null; let dmgFlashTimer = null;
function ensureDamageFlashEl() {
  if (dmgFlashEl) return dmgFlashEl;
  const el = document.createElement('div');
  el.id = 'damage-flash';
  el.style.position = 'fixed';
  el.style.top = '0'; el.style.left = '0';
  el.style.width = '100%'; el.style.height = '100%';
  el.style.background = 'rgba(255,0,0,0.25)';
  el.style.pointerEvents = 'none';
  el.style.opacity = '0';
  el.style.transition = 'opacity 150ms ease';
  el.style.zIndex = '997';
  document.body.appendChild(el);
  dmgFlashEl = el;
  return el;
}

window.flashDamageVisual = function() {
  const el = ensureDamageFlashEl();
  if (dmgFlashTimer) { clearTimeout(dmgFlashTimer); dmgFlashTimer = null; }
  el.style.opacity = '1';
  dmgFlashTimer = setTimeout(() => { el.style.opacity = '0'; }, 150);
};
// Blink car when local damage happens (hook into onDamageEvent by global exposure)
window.blinkCarOnDamage = window.blinkCarOnDamage || function(){};

// Host-only: spawn projectile for remote fire request
window.onWeaponFireRequestFrom = function(playerId) {
  if (!weaponsSystem || !multiplayerState || !multiplayerState.isHost) return;
  const opp = multiplayerState.opponentCars?.[playerId];
  if (!opp || !opp.model) return;
  if (typeof weaponsSystem.fireFromActor === 'function') {
    weaponsSystem.fireFromActor(opp.model, 'rocket');
  }
};

// Receive weapon grant (guest)
window.addEventListener('weaponEquipped', (e) => { window.receiveWeaponGrant(e.detail.weapon); });
  window.receiveWeaponGrant = function(weaponId) {
  const def = getWeaponDef(weaponId);
  if (def) {
    battleState.currentWeapon = def;
  }
};

// Car blink/emissive pulse on damage (local)
window.blinkCarOnDamage = function() {
  if (!carModel) return;
  const meshes = carModel.getChildMeshes ? carModel.getChildMeshes() : [];
  meshes.forEach(mesh => {
    const mat = mesh.material;
    if (!mat) return;
    if (mat.emissiveColor) {
      const original = mat.emissiveColor.clone();
      mat.emissiveColor = new Color3(0.8, 0.0, 0.0);
      setTimeout(() => { mat.emissiveColor = original; }, 180);
    } else if (mat.diffuseColor) {
      const orig = mat.diffuseColor.clone();
      mat.diffuseColor = new Color3(1, 0.4, 0.4);
      setTimeout(() => { mat.diffuseColor = orig; }, 120);
    }
  });
};

// Floating damage numbers
const activeDamageTexts = [];

function worldToScreen(pos, cam, rend) {
  if (!bRenderer) return { x: 0, y: 0, behind: true };
  const engine = bRenderer.engine;
  const width = engine.getRenderWidth();
  const height = engine.getRenderHeight();
  const projected = Vector3.Project(
    pos,
    bRenderer.scene.getTransformMatrix(),
    cam.getTransformationMatrix(),
    { x: 0, y: 0, width, height }
  );
  return { x: projected.x, y: projected.y, behind: projected.z > 1 };
}

function spawnDamageNumberAt(worldPos, amount, color = '#ff5555') {
  const el = document.createElement('div');
  el.textContent = `-${Math.round(amount)}`;
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.transform = 'translate(-50%, -50%)';
  el.style.color = color;
  el.style.fontFamily = 'Poppins, sans-serif';
  el.style.fontWeight = '800';
  el.style.fontSize = '20px';
  el.style.textShadow = '0 2px 6px rgba(0,0,0,0.5)';
  el.style.pointerEvents = 'none';
  el.style.opacity = '1';
  el.style.transition = 'opacity 200ms ease-out';
  el.style.zIndex = '999';
  document.body.appendChild(el);

  activeDamageTexts.push({
    el,
    worldPos: worldPos.clone(),
    start: performance.now(),
    duration: 700,
    yOffset: 0
  });
}

// Expose for multiplayer damage events
window.spawnLocalDamageNumber = function(amount) {
  if (!carModel) return;
  const pos = carModel.position.clone().addInPlace(new Vector3(0, 2.2, 0));
  spawnDamageNumberAt(pos, amount);
};

function updateDamageNumbers(delta) {
  const now = performance.now();
  for (let i = activeDamageTexts.length - 1; i >= 0; i--) {
    const it = activeDamageTexts[i];
    const age = now - it.start;
    const t = age / it.duration; // 0..1
    if (t >= 1) {
      if (it.el.parentNode) it.el.parentNode.removeChild(it.el);
      activeDamageTexts.splice(i, 1);
      continue;
    }
    // Move upward and fade out
    it.yOffset = 30 * t;
    const screen = worldToScreen(it.worldPos.clone().addInPlace(new Vector3(0, t * 0.8, 0)), camera, renderer);
    if (!screen.behind) {
      it.el.style.left = `${screen.x}px`;
      it.el.style.top = `${screen.y - it.yOffset}px`;
      it.el.style.opacity = `${1 - t}`;
    } else {
      it.el.style.opacity = '0';
    }
  }
}

// Dev connection status overlay
function createConnectionStatusBadge() {
  if (document.getElementById('conn-status')) return;
  const el = document.createElement('div');
  el.id = 'conn-status';
  el.style.position = 'fixed';
  el.style.bottom = '8px';
  el.style.right = '8px';
  el.style.background = 'rgba(0,0,0,0.55)';
  el.style.color = '#fff';
  el.style.fontFamily = 'Poppins, sans-serif';
  el.style.fontSize = '12px';
  el.style.padding = '6px 10px';
  el.style.borderRadius = '6px';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '998';
  el.style.lineHeight = '1.25';
  el.style.maxWidth = '220px';
  el.innerHTML = '<strong>Conn:</strong> ...';
  document.body.appendChild(el);
}

function updateConnectionStatusBadge() {
  const el = document.getElementById('conn-status');
  if (!el) return;
  const peer = window?.multiplayerState?.peer;
  let text = '<strong>Conn:</strong> offline';
  if (peer && peer.id) {
    const isHostText = multiplayerState?.isHost ? 'host' : 'guest';
    const conns = multiplayerState?.playerConnections?.length || 0;
    text = `<strong>${isHostText}</strong> id:${peer.id}<br/>links:${conns}`;
  }
  el.innerHTML = text;
}

// Start the game
// Safety timeout - force hide loading screen after 10 seconds
setTimeout(() => {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen && loadingScreen.style.display !== 'none') {
    console.warn('⚠️ Forcing loading screen to hide after timeout');
    loadingScreen.style.display = 'none';
  }
}, 10000);

if (!useColyseusRealtime) {
  init().catch(error => {
    console.error('Failed to initialize battle mode:', error);
    // Ensure loading screen is hidden
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.display = 'none';
    }
    alert('Failed to load battle mode. Please try again.');
  });
}
