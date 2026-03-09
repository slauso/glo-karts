import * as THREE from 'three';
import { createBlockFort } from './BlockFort.js';
import { Kart } from './Kart.js';
import { InputManager } from './Input.js';

async function init() {
    // 1. Initialize Three.js Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000022); // Dark blue for Block Fort

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    scene.add(dirLight);

    // 3. Create Map and get collidable meshes
    const collidableMeshes = createBlockFort(scene);
    
    const inputManager = new InputManager();
    
    // Read player color from lobby config
    let playerColor = 0xffaa00;
    try {
        const savedConfig = sessionStorage.getItem('gameConfig');
        if (savedConfig) {
            const gameConfig = JSON.parse(savedConfig);
            const myPlayerId = localStorage.getItem('myPlayerId');
            const myPlayer = gameConfig.players.find(p => p.id === myPlayerId);
            if (myPlayer && myPlayer.playerColor) {
                playerColor = parseInt(myPlayer.playerColor.replace('#', '0x'));
            }
        }
    } catch (e) {
        console.error('Error loading game config:', e);
    }

    // Spawn player at one of the forts based on their color or randomly
    const spawnPoints = [
        { x: -35, y: 31, z: -35 }, // Red
        { x: 35, y: 31, z: -35 },  // Blue
        { x: -35, y: 31, z: 35 },  // Yellow
        { x: 35, y: 31, z: 35 }    // Green
    ];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    // Create the custom kinematic kart
    const playerKart = new Kart(scene, spawn.x, spawn.y, spawn.z, playerColor);

    // Hide loading screen
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.display = 'none';
    }

    // 4. Game Loop
    const clock = new THREE.Clock();
    const FIXED_TIME_STEP = 1.0 / 60.0;
    let accumulator = 0.0;

    function animate() {
        requestAnimationFrame(animate);

        const dt = clock.getDelta();
        accumulator += dt;

        // Fixed Timestep Logic
        while (accumulator >= FIXED_TIME_STEP) {
            const input = inputManager.get();
            
            // Update custom physics
            playerKart.update(input, FIXED_TIME_STEP, collidableMeshes);
            
            accumulator -= FIXED_TIME_STEP;
        }

        // Camera Follow
        const kartPos = playerKart.mesh.position;
        
        // Calculate ideal camera position (behind and above the kart)
        const offset = new THREE.Vector3(0, 4, -8); // Closer and lower for MK64 feel
        
        // Apply the kart's Y-axis rotation to the offset
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), playerKart.rotation);
        offset.applyQuaternion(q);
        
        const idealPos = kartPos.clone().add(offset);
        
        // Smoothly interpolate camera position
        camera.position.lerp(idealPos, 0.2); // Faster camera snap
        
        // Look slightly ahead of the kart
        const lookAtPos = kartPos.clone().add(new THREE.Vector3(0, 1, 0));
        camera.lookAt(lookAtPos);

        renderer.render(scene, camera);
    }

    // Handle Resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

init().catch(console.error);
