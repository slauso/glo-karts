import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import '@babylonjs/loaders/glTF';
import { hasGates, getTrackScale } from './track-data.js';
import { resetKart } from './havok-physics.js';

// Gate-related constants and variables
const GATE_FADE_DURATION = 1.0;
let _tempVector1 = new Vector3();

// Function to load gates model
export function loadGates(mapId, scene, loadingManager, onGatesLoaded) {
  // Initialize arrays and counters
  const gates = [];
  const fadingGates = {};
  let currentGateIndex = 0;
  const totalGates = 8;
  const currentGatePosition = new Vector3(0, 2, 0);
  const currentGateQuaternion = new Quaternion();

  // STK tracks have no gates — return empty data immediately
  if (!hasGates(mapId)) {
    console.log(`Skipping gates for ${mapId} (no gates.glb available)`);
    const emptyData = {
      gates,
      fadingGates,
      currentGateIndex,
      totalGates: 0,
      currentGatePosition,
      currentGateQuaternion
    };
    if (onGatesLoaded) onGatesLoaded(emptyData);
    return emptyData;
  }
  
  const scale = getTrackScale(mapId);
  const modelPath = `/models/maps/${mapId}/gates.glb`;
  const lastSlash = modelPath.lastIndexOf('/');
  const dir = modelPath.substring(0, lastSlash + 1);
  const file = modelPath.substring(lastSlash + 1);

  SceneLoader.ImportMeshAsync("", dir, file, scene).then((result) => {
    const gatesModel = result.meshes[0];
    gatesModel.scaling.setAll(scale);

    const findNode = (name) => scene.getMeshByName(name) || scene.getTransformNodeByName(name);

    for (let i = 0; i < 7; i++) {
      const gate = findNode(`gate-${i}`);
      if (gate) {
        gate.metadata = gate.metadata || {};
        gate.metadata.index = i;
        gate.metadata.passed = false;

        gate.setEnabled(i === 0);

        const meshes = gate.getChildMeshes ? gate.getChildMeshes() : [];
        if (gate.visibility !== undefined) meshes.unshift(gate);
        meshes.forEach(m => { m.visibility = (i === 0) ? 0 : 1; });

        gates.push(gate);
        console.log(`Loaded gate-${i}, enabled: ${gate.isEnabled()}`);
      } else {
        console.warn(`Could not find gate-${i}`);
      }
    }

    const finishGate = findNode('gate-finish');
    if (finishGate) {
      finishGate.metadata = finishGate.metadata || {};
      finishGate.metadata.index = 7;
      finishGate.metadata.passed = false;
      finishGate.metadata.isFinish = true;
      finishGate.setEnabled(false);

      const meshes = finishGate.getChildMeshes ? finishGate.getChildMeshes() : [];
      if (finishGate.visibility !== undefined) meshes.unshift(finishGate);
      meshes.forEach(m => { m.visibility = 0; });

      gates.push(finishGate);
      console.log('Loaded gate-finish (initially hidden)');
    } else {
      console.warn('Could not find gate-finish');
    }

    console.log(`Loaded ${gates.length} gates successfully`);

    startGateFadeIn(0, gates, fadingGates);

    if (onGatesLoaded) {
      onGatesLoaded({
        gates,
        fadingGates,
        currentGateIndex,
        totalGates,
        currentGatePosition,
        currentGateQuaternion
      });
    }
  }).catch((error) => {
    console.error(`Error loading gates for ${mapId}:`, error);
  });
  
  // Return initial objects
  return {
    gates,
    fadingGates,
    currentGateIndex,
    totalGates,
    currentGatePosition,
    currentGateQuaternion
  };
}

// Function to initiate gate fade-in
export function startGateFadeIn(gateIndex, gates, fadingGates) {
  if (gateIndex >= gates.length) return;
  
  const gate = gates[gateIndex];
  if (!gate) return;
  
  gate.setEnabled(true);

  const meshes = gate.getChildMeshes ? gate.getChildMeshes() : [];
  if (gate.visibility !== undefined) meshes.unshift(gate);
  meshes.forEach(m => { m.visibility = 0; });
  
  // Add to fading gates
  fadingGates[gateIndex] = {
    gate: gate,
    startTime: Date.now(),
    duration: GATE_FADE_DURATION * 1000
  };
}

// Function to update gate fading
export function updateGateFading(fadingGates) {
  const currentTime = Date.now();
  
  Object.entries(fadingGates).forEach(([index, fadeData]) => {
    const { gate, startTime, duration } = fadeData;
    const elapsed = currentTime - startTime;
    
    const meshes = gate.getChildMeshes ? gate.getChildMeshes() : [];
    if (gate.visibility !== undefined) meshes.unshift(gate);

    if (elapsed >= duration) {
      meshes.forEach(m => { m.visibility = 1.0; });
      delete fadingGates[index];
    } else {
      const opacity = elapsed / duration;
      meshes.forEach(m => { m.visibility = opacity; });
    }
  });
}

// Optimized function to check if player is near gates
export function checkGateProximity(carModel, gateData) {
  const { gates, currentGateIndex, currentGatePosition, currentGateQuaternion } = gateData;
  
  if (!carModel || gates.length === 0 || currentGateIndex >= gates.length) return false;
  
  const gate = gates[currentGateIndex];
  if (!gate || (gate.metadata && gate.metadata.passed)) return false;
  
  gate.computeWorldMatrix(true);
  const gatePos = gate.getAbsolutePosition();
  
  const dx = carModel.position.x - gatePos.x;
  const dy = carModel.position.y - gatePos.y;
  const dz = carModel.position.z - gatePos.z;
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  
  // Compare with threshold squared (2 units * 8 scale factor)^2 = 256
  if (distanceSquared < 256) {
    console.log(`Passed through gate-${currentGateIndex === 7 ? 'finish' : currentGateIndex}`);
    currentGatePosition.copyFrom(gatePos);
    if (gate.rotationQuaternion) {
      currentGateQuaternion.copyFrom(gate.rotationQuaternion);
    }
    
    gate.metadata.passed = true;
    
    if (gate.metadata.isFinish) {
      gateData.currentGateIndex++;
      return true; // Signal race is finished
    } else {
      // Move to next gate
      gateData.currentGateIndex++;
      
      // Make next gate visible and start fade-in
      if (gateData.currentGateIndex < gates.length) {
        startGateFadeIn(gateData.currentGateIndex, gates, gateData.fadingGates);
      }
    }
  }
  
  return false; // Race not finished
}

// Function to show finish message
export function showFinishMessage(totalGates, resetCallback) {
  // Set the raceFinished state to true
  window.raceState.raceFinished = true;
  
  // Hide speedometer
  const speedometer = document.getElementById('speedometer');
  if (speedometer) {
    speedometer.style.opacity = '0';
    speedometer.style.transition = 'opacity 0.5s ease';
  }
  
  // Get race completion time
  const raceTimer = document.querySelector('div[style*="position: absolute"][style*="top: 20px"][style*="left: 50%"]');
  const finalTime = raceTimer ? raceTimer.innerText : "00:00";
  
  // Store the finish time in player positions for leaderboard
  if (window.playerPositions) {
    const myPlayerId = localStorage.getItem('myPlayerId');
    const myPlayerIndex = window.playerPositions.findIndex(p => p.id === myPlayerId);
    
    if (myPlayerIndex !== -1) {
      window.playerPositions[myPlayerIndex].finishTime = finalTime;
    }
    console.log("Finish time stored in player positions:", window.playerPositions);
  } else {
    window.playerFinishTimes[localStorage.getItem('myPlayerId')] = finalTime;
  }
  
  // Create the FINISH text container
  const finishUI = document.createElement('div');
  finishUI.id = 'finish-ui';
  finishUI.style.position = 'absolute';
  finishUI.style.top = '50%';
  finishUI.style.left = '0';
  finishUI.style.right = '0';
  finishUI.style.transform = 'translateY(-50%)';
  finishUI.style.textAlign = 'center';
  finishUI.style.zIndex = '1000';
  
  // Create the animated FINISH text
  const finishText = document.createElement('div');
  finishText.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  finishText.style.boxShadow = '0 0 20px hsla(0, 0.00%, 0.00%, 0.50)';
  finishText.style.borderRadius = '10px';
  finishText.textContent = 'FINISH';
  finishText.style.fontFamily = "'Poppins', sans-serif";
  finishText.style.fontWeight = '900';
  finishText.style.fontSize = '120px';
  finishText.style.color = '#ff0080';
  finishText.style.textShadow = '0 0 20px rgba(255, 0, 128, 0.7)';
  finishText.style.letterSpacing = '10px';
  finishText.style.transform = 'translateX(-100%)';
  finishText.style.display = 'inline-block';
  finishText.style.opacity = '0';
  finishText.style.transition = 'transform 1s cubic-bezier(0.12, 0.93, 0.27, 0.98), opacity 1s ease';
  finishText.style.padding = '5px 20px';
  finishText.style.userSelect = 'none';
  
  // Create time display
  const timeContainer = document.createElement('div');
  timeContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
  timeContainer.style.borderRadius = '10px';
  timeContainer.style.padding = '5px 20px';
  timeContainer.style.width = 'fit-content';
  timeContainer.style.margin = '0 auto';
  timeContainer.style.marginTop = '30px';
  timeContainer.style.fontSize = '36px';
  timeContainer.style.fontWeight = 'bold';
  timeContainer.style.color = '#ffffff';
  timeContainer.style.textShadow = '0 0 10px rgba(255, 255, 255, 0.5)';
  timeContainer.style.boxShadow = '0 0 20px rgba(0, 0, 0, 0.5)';
  timeContainer.style.opacity = '0';
  timeContainer.style.transition = 'opacity 1s ease';
  timeContainer.style.transitionDelay = '1s';
  timeContainer.textContent = `TIME: ${finalTime}`;
  
  finishUI.appendChild(finishText);
  finishUI.appendChild(timeContainer);
  document.body.appendChild(finishUI);
  
  // Trigger the animation
  setTimeout(() => {
    finishText.style.transform = 'translateX(0)';
    finishText.style.opacity = '1';
    timeContainer.style.opacity = '1';
  }, 100);
  
  // Enter spectator mode in multiplayer after showing finish message
  if (window.raceState.isMultiplayer && window.enterSpectatorMode) {
    setTimeout(() => {
      window.enterSpectatorMode();
    }, 4000);
  }
  
  // Keep the finish message visible longer
  setTimeout(() => {
    // Animate out
    timeContainer.style.transitionDelay = '0s';
    finishText.style.transform = 'translateX(100%)';
    finishText.style.opacity = '0';
    timeContainer.style.opacity = '0';
    
    // Remove after animation completes
    setTimeout(() => {
      document.body.removeChild(finishUI);
      
      // For multiplayer, we'll let the main animation loop handle it when all players finish
      if (!window.raceState.isMultiplayer && window.showFinalLeaderboard) {
        window.showFinalLeaderboard();
      }
    }, 1000);
  }, 4000);
  
  return finishUI;
}

// Function to reset race gates
export function resetRace(gateData) {
  const { gates, fadingGates } = gateData;
  
  gates.forEach((gate, index) => {
    if (gate.metadata) gate.metadata.passed = false;
    gate.setEnabled(index === 0);
  });
  
  // Reset counters
  gateData.currentGateIndex = 0;
  
  // Start fade-in for first gate
  startGateFadeIn(0, gates, fadingGates);
  
  // Reset car position via havok-physics
  const pos = gateData.currentGatePosition;
  if (pos) {
    resetKart({ x: pos.x, y: pos.y, z: pos.z }, 0);
  }
}