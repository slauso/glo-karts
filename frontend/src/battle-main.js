/*
 * TWISTED KART - BATTLE MODE
 * Main game loop for battle/combat mode
 * This is completely separate from race mode (main.js)
 */

import * as THREE from 'three';
import "./style.css";
import Ammo from './lib/ammo.js';
import { createVehicle, updateSteering, resetCarPosition, updateCarPosition } from './modules/car.js';
import { initPhysics, updatePhysics, FIXED_PHYSICS_STEP } from './modules/physics.js';
import { 
  initMultiplayer, 
  updateMarkers, 
  sendCarData,
  interpolateOpponents,
} from './modules/multiplayer.js';
import { loadArena } from './modules/battle/arena.js';
import { createHealthSystem } from './modules/battle/health.js';
import { initWeapons, attemptFire, getWeaponDef, hostBroadcastPickups } from './modules/battle/weapons.js';

console.log('🎮 BATTLE MODE LOADING...');

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
    isHost = gameConfig.players.some(player => player.id === myPlayerId && player.isHost);
    
    console.log('Battle config loaded:', gameConfig);
    console.log('Playing as host:', isHost);
    
    // Store player list
    allPlayers = gameConfig.players;
  }
} catch (e) {
  console.error('Error loading battle config:', e);
}

// Global variables
let camera, scene, renderer;
let physicsWorld, tmpTrans;
const clock = new THREE.Clock();

// Car components
let carBody;
let vehicle;
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

// Steering parameters
let currentSteeringAngle = 0;

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
  invulnerable: false
};

let healthSystem = null;
let arenaInfo = null; // populated after loadArena
let playerSpawnIndex = 0; // index into arena spawn points
let weaponsSystem = null; // weapons module interface

// Multiplayer variables
let multiplayerState;

// Initialize everything
async function init() {
  console.log('🏁 Initializing Battle Mode...');

  try {
    // Initialize Ammo.js first
    const ammo = await Ammo();
    window.Ammo = ammo;
    console.log('✅ Ammo.js loaded');

    // Initialize physics
    console.log('Initializing physics world...');
    const physicsState = initPhysics(ammo);
    physicsWorld = physicsState.physicsWorld;
    tmpTrans = physicsState.tmpTrans;
    console.log('✅ Physics initialized');

    // Create scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Sky blue
    scene.fog = new THREE.Fog(0x87ceeb, 0, 500);

    // Camera
    camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 10, 20);
    camera.lookAt(0, 0, 0);

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const appEl = document.getElementById('app');
    appEl.appendChild(renderer.domElement);
    // Ensure canvas can receive keyboard focus
    renderer.domElement.tabIndex = 1;
    renderer.domElement.addEventListener('click', () => renderer.domElement.focus());
    // Try to focus immediately once attached
    setTimeout(() => renderer.domElement.focus(), 0);

  // Dev: create connection status badge
  createConnectionStatusBadge();

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Create arena (modular)
    console.log('Creating arena...');
  // Support new lobby-driven arenaId field
  const arenaId = (gameConfig && (gameConfig.arenaId || gameConfig.battleArena)) ? (gameConfig.arenaId || gameConfig.battleArena) : 'box';
    arenaInfo = loadArena(window.Ammo, scene, physicsWorld, arenaId);
    window._battleArenaInfo = arenaInfo; // for debugging
    console.log('✅ Arena created', arenaInfo);

    // Determine spawn index based on player list ordering
    if (gameConfig && gameConfig.spawnMap && gameConfig.players) {
      // Use explicit spawnMap from lobby if present
      const myId = localStorage.getItem('myPlayerId');
      if (myId && typeof gameConfig.spawnMap[myId] === 'number') {
        playerSpawnIndex = gameConfig.spawnMap[myId] % arenaInfo.spawnPoints.length;
      } else {
        const idx = gameConfig.players.findIndex(p => p.id === myId);
        playerSpawnIndex = idx >= 0 ? idx % arenaInfo.spawnPoints.length : 0;
      }
    } else if (gameConfig && gameConfig.players) {
      const myId = localStorage.getItem('myPlayerId');
      const idx = gameConfig.players.findIndex(p => p.id === myId);
      playerSpawnIndex = idx >= 0 ? idx % arenaInfo.spawnPoints.length : 0;
    } else {
      playerSpawnIndex = 0;
    }

    // Create player car
    console.log('Creating player car...');
  await createPlayerCar();
  console.log('✅ Player car created');
  // Apply initial spawn transform after carBody exists
    // If host sent a spawn assignment earlier, use it
    if (typeof window.pendingSpawnIndex === 'number') {
      playerSpawnIndex = window.pendingSpawnIndex;
      delete window.pendingSpawnIndex;
    }
    applySpawnTransform();

    // Initialize health system
    healthSystem = createHealthSystem({
      ammo: window.Ammo,
      getCarBody: () => carBody,
      onRespawn: () => {
        // Re-apply spawn transform on respawn
        applySpawnTransform(true);
        // TODO: Add respawn FX (blink, sound)
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

    // Setup controls
    setupControls();

    // Initialize multiplayer if needed
    if (gameConfig && gameConfig.players.length > 1) {
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

    // Create vehicle immediately for physics; update visuals in callback when model loads
    const components = createVehicle(
      window.Ammo,
      scene,
      physicsWorld,
      [],
      (loaded) => {
        // Model and wheel meshes are now available
        carBody = loaded.carBody;
        vehicle = loaded.vehicle;
        wheelMeshes = loaded.wheelMeshes;
        carModel = loaded.carModel;
        currentSteeringAngle = loaded.currentSteeringAngle || 0;
        console.log('✅ Player car visuals loaded');
      }
    );

    // Set physics references immediately
    carBody = components.carBody;
    vehicle = components.vehicle;
    wheelMeshes = components.wheelMeshes;
    carModel = components.carModel; // will be null until model loads
    currentSteeringAngle = components.currentSteeringAngle || 0;

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
  if (fired) console.log('🔫 Fired weapon');
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Apply the arena spawn transform to the player's car
function applySpawnTransform(resetVelocity = false) {
  if (!window.Ammo || !carBody || !arenaInfo || !arenaInfo.spawnPoints || arenaInfo.spawnPoints.length === 0) return;
  const Ammo = window.Ammo;
  const spawn = arenaInfo.spawnPoints[playerSpawnIndex % arenaInfo.spawnPoints.length];

  // Optionally zero velocities
  if (resetVelocity) {
    const zero = new Ammo.btVector3(0,0,0);
    carBody.setLinearVelocity(zero);
    carBody.setAngularVelocity(zero);
    Ammo.destroy(zero);
  }

  const t = new Ammo.btTransform();
  t.setIdentity();
  t.setOrigin(new Ammo.btVector3(spawn.x, spawn.y, spawn.z));
  const q = new Ammo.btQuaternion(0, 0, 0, 1);
  t.setRotation(q);
  carBody.setWorldTransform(t);
  const ms = carBody.getMotionState && carBody.getMotionState();
  if (ms) ms.setWorldTransform(t);

  Ammo.destroy(t);
  Ammo.destroy(q);
}

// ----- Health & Respawn (incremental) -----
function applyDamage(amount) {
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
  const Ammo = window.Ammo;
  if (!Ammo || !carBody) return;

  const zero = new Ammo.btVector3(0,0,0);
  carBody.setLinearVelocity(zero);
  carBody.setAngularVelocity(zero);

  const t = new Ammo.btTransform();
  t.setIdentity();
  t.setOrigin(new Ammo.btVector3(0, 3, 0));
  const q = new Ammo.btQuaternion(0, 0, 0, 1);
  t.setRotation(q);
  carBody.setWorldTransform(t);
  const ms = carBody.getMotionState();
  if (ms) ms.setWorldTransform(t);

  battleState.health = battleState.maxHealth;
  battleState.invulnerable = true;
  setTimeout(() => { battleState.invulnerable = false; }, 2000);

  Ammo.destroy(zero);
  Ammo.destroy(t);
  Ammo.destroy(q);
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
  const interval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      updateCountdownOverlay(remaining);
    } else {
      clearInterval(interval);
      battleState.battleStarted = true;
      updateCountdownOverlay('GO!');
      setTimeout(removeCountdownOverlay, 600);
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
      applySpawnTransform(true);
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
    scoreValue.textContent = battleState.score;
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
}

function updateCamera() {
  // Prefer carModel (visual) for camera target; it reflects the final orientation used in rendering
  if (!carModel) return;

  // Get car world position and forward direction
  const carPos = carModel.position.clone();
  const carDir = new THREE.Vector3();
  carModel.getWorldDirection(carDir); // carDir points forward

  // Place camera behind and above the car
  const behindOffset = carDir.clone().multiplyScalar(-CAMERA_DISTANCE);
  const targetPos = carPos.clone()
    .add(behindOffset)
    .add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));

  // Smooth camera movement
  camera.position.lerp(targetPos, CAMERA_LERP);

  // Look slightly ahead of the car
  const lookAtPos = carPos.clone().add(carDir.clone().multiplyScalar(CAMERA_LOOK_AHEAD));
  camera.lookAt(lookAtPos);
}

// Main game loop
// Fixed timestep accumulator for stable physics
let accumulator = 0;

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.1);
  accumulator += deltaTime;

  if (physicsWorld && vehicle && carModel) {
    // Map battle state to physics "race" state expectations
    const physicsModeState = {
      raceStarted: !!battleState.battleStarted,
      raceFinished: !!battleState.battleFinished,
    };

    // Run physics at fixed intervals
    while (accumulator >= FIXED_PHYSICS_STEP) {
      const carState = {
        carBody,
        vehicle,
        carModel,
        wheelMeshes,
        keyState,
        currentSteeringAngle,
        updateSteering,
      };

      const physicsResult = updatePhysics(
        FIXED_PHYSICS_STEP,
        window.Ammo,
        { physicsWorld, tmpTrans },
        carState,
        [], // no debug objects in battle mode (for now)
        physicsModeState
      );

      // Update steering angle returned from physics
      if (physicsResult && typeof physicsResult.currentSteeringAngle === 'number') {
        currentSteeringAngle = physicsResult.currentSteeringAngle;
      }
      // Update speed for debug HUD
      if (physicsResult && typeof physicsResult.currentSpeed === 'number') {
        currentSpeedKPH = physicsResult.currentSpeed;
      }

      // Update car rendering from physics
      updateCarPosition(window.Ammo, vehicle, carModel, wheelMeshes);

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
  updateDebugHUD();
  // Update weapons (after core HUD so weapon changes appear next frame consistently)
  if (weaponsSystem && typeof weaponsSystem.update === 'function') {
    weaponsSystem.update(deltaTime, carModel, battleState);
  }
  // Floating damage numbers animation
  if (typeof updateDamageNumbers === 'function') {
    updateDamageNumbers(deltaTime);
  }

  // Render
  renderer.render(scene, camera);
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
const oppSpeedCache = new Map(); // id -> { pos: THREE.Vector3, t: number, speedMS: number }

function estimateOpponentSpeedMS(id, pos) {
  const now = performance.now();
  const prev = oppSpeedCache.get(id);
  if (prev) {
    const dt = Math.max(1, now - prev.t) / 1000; // seconds, avoid div-by-zero
    const dist = pos.distanceTo(prev.pos);
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
  const myForward = new THREE.Vector3();
  carModel.getWorldDirection(myForward);
  const mySpeedMS = (currentSpeedKPH || 0) / 3.6;

  const opponents = multiplayerState.opponentCars || {};

  const victimIds = [];
  let maxComputedDamage = 0;

  Object.entries(opponents).forEach(([playerId, opp]) => {
    if (!opp.model || !opp.model.visible) return;

    const oppPos = opp.model.position;
    const d = oppPos.distanceTo(myPos);
    if (d > COLLISION_DISTANCE) return; // not colliding/proximate

    // Per-opponent cooldown
    const lastT = lastCollisionById.get(playerId) || 0;
    if (Date.now() - lastT < COLLISION_COOLDOWN_MS) return;

    // Estimate opponent speed and direction
    const oppSpeedMS = estimateOpponentSpeedMS(playerId, oppPos);
    const oppForward = new THREE.Vector3();
    if (opp.model.getWorldDirection) {
      opp.model.getWorldDirection(oppForward);
    } else {
      // fallback from quaternion
      oppForward.set(0,0,1).applyQuaternion(opp.model.quaternion).normalize();
    }

    // Impact geometry: angles and closing component
    const dirToOpp = oppPos.clone().sub(myPos).normalize();
    const dirToMe = myPos.clone().sub(oppPos).normalize();
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
window.receiveWeaponGrant = function(weaponId) {
  const def = getWeaponDef(weaponId);
  if (def) {
    battleState.currentWeapon = def;
  }
};

// Car blink/emissive pulse on damage (local)
window.blinkCarOnDamage = function() {
  if (!carModel) return;
  carModel.traverse(node => {
    if (node.isMesh && node.material) {
      const mat = node.material;
      if ('emissive' in mat) {
        const original = mat.emissive.clone();
        const originalIntensity = mat.emissiveIntensity ?? 1.0;
        mat.emissive.setRGB(0.8, 0.0, 0.0);
        mat.emissiveIntensity = Math.max(originalIntensity, 1.5);
        setTimeout(() => {
          mat.emissive.copy(original);
          mat.emissiveIntensity = originalIntensity;
        }, 180);
      } else if ('color' in mat) {
        // Fallback: quick color tint
        const orig = mat.color.clone();
        mat.color.setRGB(1, 0.4, 0.4);
        setTimeout(() => mat.color.copy(orig), 120);
      }
    }
  });
};

// Floating damage numbers
const activeDamageTexts = [];

function worldToScreen(pos, cam, rend) {
  const width = rend.domElement.clientWidth;
  const height = rend.domElement.clientHeight;
  const projected = pos.clone().project(cam);
  const x = (projected.x * 0.5 + 0.5) * width;
  const y = (-projected.y * 0.5 + 0.5) * height;
  return { x, y, behind: projected.z > 1 };
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
  const pos = carModel.position.clone().add(new THREE.Vector3(0, 2.2, 0));
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
    const screen = worldToScreen(it.worldPos.clone().add(new THREE.Vector3(0, t * 0.8, 0)), camera, renderer);
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

init().catch(error => {
  console.error('Failed to initialize battle mode:', error);
  // Ensure loading screen is hidden
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
  }
  alert('Failed to load battle mode. Please try again.');
});
