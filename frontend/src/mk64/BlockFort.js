import * as THREE from 'three';

export function createBlockFort(scene) {
    const collidableMeshes = [];

    const textureLoader = new THREE.TextureLoader();
    
    // Load textures and set them to repeat
    const loadTex = (path, repeatX = 1, repeatY = 1) => {
        const tex = textureLoader.load(path);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        // Use NearestFilter for that crisp retro N64 look
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        return tex;
    };

    // We'll map the 5 textures we extracted. 
    // If the colors are mismatched, we can swap the tex1-tex4 assignments later.
    const texRed = loadTex('/textures/block_fort/tex_red.png', 4, 4);
    const texBlue = loadTex('/textures/block_fort/tex_blue.png', 4, 4);
    const texYellow = loadTex('/textures/block_fort/tex_yellow.png', 4, 4);
    const texGreen = loadTex('/textures/block_fort/tex_green.png', 4, 4);
    const texGround = loadTex('/textures/block_fort/tex_ground.png', 16, 16);

    const materials = {
        red: new THREE.MeshStandardMaterial({ color: 0xffffff, map: texRed, roughness: 0.8 }),
        blue: new THREE.MeshStandardMaterial({ color: 0xffffff, map: texBlue, roughness: 0.8 }),
        yellow: new THREE.MeshStandardMaterial({ color: 0xffffff, map: texYellow, roughness: 0.8 }),
        green: new THREE.MeshStandardMaterial({ color: 0xffffff, map: texGreen, roughness: 0.8 }),
        ground: new THREE.MeshStandardMaterial({ color: 0xffffff, map: texGround, roughness: 0.9 }),
        bridge: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }), // Keep bridge solid for now
        wall: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 })
    };

    // --- GRID SYSTEM ---
    // Based on exact MK64 proportions. 
    // 1 Unit (U) = 10 meters in our 3D world.
    const U = 10; 
    
    // The entire arena is roughly 17x17 U
    const arenaSize = 17 * U;
    
    // Heights
    const h1 = 1.5 * U; // Level 1 height
    const h2 = 3.0 * U; // Level 2 height

    // Ground Plane
    createBox(scene, collidableMeshes, 0, -1, 0, arenaSize, 2, arenaSize, materials.ground);

    // Outer Walls
    const wallHeight = 4 * U;
    const wallThickness = 2;
    createBox(scene, collidableMeshes, 0, wallHeight/2, -arenaSize/2, arenaSize, wallHeight, wallThickness, materials.wall); // North
    createBox(scene, collidableMeshes, 0, wallHeight/2, arenaSize/2, arenaSize, wallHeight, wallThickness, materials.wall);  // South
    createBox(scene, collidableMeshes, -arenaSize/2, wallHeight/2, 0, wallThickness, wallHeight, arenaSize, materials.wall); // West
    createBox(scene, collidableMeshes, arenaSize/2, wallHeight/2, 0, wallThickness, wallHeight, arenaSize, materials.wall);  // East

    // --- THE 4 FORTS ---
    // Each fort is a 4x4 U footprint.
    // The center cross is 3 U wide.
    // So the inner edge of a fort is 1.5 U from the center (0,0).
    // The center of a 4x4 fort is 2 U from its inner edge.
    // Therefore, the center of each fort is at 3.5 U from the origin.
    const offset = 3.5 * U;
    
    const forts = [
        { x: -offset, z: -offset, mat: materials.red,    name: 'Red (NW)' },
        { x: offset,  z: -offset, mat: materials.blue,   name: 'Blue (NE)' },
        { x: -offset, z: offset,  mat: materials.yellow, name: 'Yellow (SW)' },
        { x: offset,  z: offset,  mat: materials.green,  name: 'Green (SE)' }
    ];

    forts.forEach(f => {
        // Level 2 (The Top) - A solid 2x2 U block in the exact center of the fort
        createBox(scene, collidableMeshes, f.x, h2/2, f.z, 2*U, h2, 2*U, f.mat);
        
        // Level 1 (The Middle) - A 1 U wide ring surrounding the 2x2 block.
        // We build this out of 4 rectangular blocks to form the ring.
        // North edge of ring
        createBox(scene, collidableMeshes, f.x, h1/2, f.z - 1.5*U, 4*U, h1, 1*U, f.mat);
        // South edge of ring
        createBox(scene, collidableMeshes, f.x, h1/2, f.z + 1.5*U, 4*U, h1, 1*U, f.mat);
        // West edge of ring (between N and S)
        createBox(scene, collidableMeshes, f.x - 1.5*U, h1/2, f.z, 1*U, h1, 2*U, f.mat);
        // East edge of ring (between N and S)
        createBox(scene, collidableMeshes, f.x + 1.5*U, h1/2, f.z, 1*U, h1, 2*U, f.mat);

        // --- RAMPS ---
        // Ground to Level 1 Ramps (2 U wide, 2 U long)
        // Placed on the OUTER faces of the fort (facing the walls)
        const r1Dist = 2*U + 1*U; // Center of fort (0) + half fort (2U) + half ramp (1U) = 3U from fort center
        
        if (f.x < 0) { // West forts (Red, Yellow) have ramps on their West face
            createRamp(scene, collidableMeshes, f.x - r1Dist, h1/2, f.z, 2*U, h1, 2*U, true, false, f.mat);
        } else {       // East forts (Blue, Green) have ramps on their East face
            createRamp(scene, collidableMeshes, f.x + r1Dist, h1/2, f.z, 2*U, h1, 2*U, true, true, f.mat);
        }

        if (f.z < 0) { // North forts (Red, Blue) have ramps on their North face
            createRamp(scene, collidableMeshes, f.x, h1/2, f.z - r1Dist, 2*U, h1, 2*U, false, false, f.mat);
        } else {       // South forts (Yellow, Green) have ramps on their South face
            createRamp(scene, collidableMeshes, f.x, h1/2, f.z + r1Dist, 2*U, h1, 2*U, false, true, f.mat);
        }

        // Level 1 to Level 2 Ramps (1 U wide, 1 U long)
        // Placed on the INNER faces of the Level 1 ring, forming a pinwheel.
        const r2Dist = 1*U + 0.5*U; // Half of 2x2 center (1U) + half of ramp (0.5U) = 1.5U from fort center
        const r2Y = h1 + (h2 - h1)/2;
        
        // Pinwheel logic based on the map diagram:
        // Red (NW): Ramp on East face (South half), Ramp on South face (West half)
        if (f.name === 'Red (NW)') {
            createRamp(scene, collidableMeshes, f.x + r2Dist, r2Y, f.z + 0.5*U, 1*U, h2-h1, 1*U, true, true, f.mat); // East face
            createRamp(scene, collidableMeshes, f.x - 0.5*U, r2Y, f.z + r2Dist, 1*U, h2-h1, 1*U, false, true, f.mat); // South face
        }
        // Blue (NE): Ramp on West face (South half), Ramp on South face (East half)
        else if (f.name === 'Blue (NE)') {
            createRamp(scene, collidableMeshes, f.x - r2Dist, r2Y, f.z + 0.5*U, 1*U, h2-h1, 1*U, true, false, f.mat); // West face
            createRamp(scene, collidableMeshes, f.x + 0.5*U, r2Y, f.z + r2Dist, 1*U, h2-h1, 1*U, false, true, f.mat); // South face
        }
        // Yellow (SW): Ramp on East face (North half), Ramp on North face (West half)
        else if (f.name === 'Yellow (SW)') {
            createRamp(scene, collidableMeshes, f.x + r2Dist, r2Y, f.z - 0.5*U, 1*U, h2-h1, 1*U, true, true, f.mat); // East face
            createRamp(scene, collidableMeshes, f.x - 0.5*U, r2Y, f.z - r2Dist, 1*U, h2-h1, 1*U, false, false, f.mat); // North face
        }
        // Green (SE): Ramp on West face (North half), Ramp on North face (East half)
        else if (f.name === 'Green (SE)') {
            createRamp(scene, collidableMeshes, f.x - r2Dist, r2Y, f.z - 0.5*U, 1*U, h2-h1, 1*U, true, false, f.mat); // West face
            createRamp(scene, collidableMeshes, f.x + 0.5*U, r2Y, f.z - r2Dist, 1*U, h2-h1, 1*U, false, false, f.mat); // North face
        }
    });

    // --- BRIDGES ---
    const bridgeThickness = 0.2 * U;
    
    // Level 1 Bridges (3 U long, 1 U wide)
    // Spanning the 3 U gap between the inner edges of the Level 1 rings.
    const b1Length = 3 * U;
    const b1Y = h1 - bridgeThickness / 2;
    
    // North Bridge (Red to Blue)
    createBox(scene, collidableMeshes, 0, b1Y, -offset + 1.5*U, b1Length, bridgeThickness, 1*U, materials.bridge);
    // South Bridge (Yellow to Green)
    createBox(scene, collidableMeshes, 0, b1Y, offset - 1.5*U, b1Length, bridgeThickness, 1*U, materials.bridge);
    // West Bridge (Red to Yellow)
    createBox(scene, collidableMeshes, -offset + 1.5*U, b1Y, 0, 1*U, bridgeThickness, b1Length, materials.bridge);
    // East Bridge (Blue to Green)
    createBox(scene, collidableMeshes, offset - 1.5*U, b1Y, 0, 1*U, bridgeThickness, b1Length, materials.bridge);

    // Level 2 Bridges (5 U long, 1 U wide)
    // Spanning the 3 U gap PLUS the 1 U Level 1 rings on both sides (1 + 3 + 1 = 5 U)
    const b2Length = 5 * U;
    const b2Y = h2 - bridgeThickness / 2;
    
    // North Bridge (Red to Blue)
    createBox(scene, collidableMeshes, 0, b2Y, -offset - 0.5*U, b2Length, bridgeThickness, 1*U, materials.bridge);
    // South Bridge (Yellow to Green)
    createBox(scene, collidableMeshes, 0, b2Y, offset + 0.5*U, b2Length, bridgeThickness, 1*U, materials.bridge);
    // West Bridge (Red to Yellow)
    createBox(scene, collidableMeshes, -offset - 0.5*U, b2Y, 0, 1*U, bridgeThickness, b2Length, materials.bridge);
    // East Bridge (Blue to Green)
    createBox(scene, collidableMeshes, offset + 0.5*U, b2Y, 0, 1*U, bridgeThickness, b2Length, materials.bridge);

    return collidableMeshes;
}

function createBox(scene, collidableMeshes, x, y, z, w, h, d, material) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    collidableMeshes.push(mesh);
}

function createRamp(scene, collidableMeshes, x, y, z, w, h, l, isXAxis, isNegative, material) {
    const hyp = Math.sqrt(h*h + l*l);
    const angle = Math.atan2(h, l);
    
    const geo = new THREE.BoxGeometry(isXAxis ? hyp : w, 1, isXAxis ? w : hyp);
    const mesh = new THREE.Mesh(geo, material);
    
    mesh.position.set(x, y, z);
    
    if (isXAxis) {
        mesh.rotation.z = isNegative ? -angle : angle;
    } else {
        mesh.rotation.x = isNegative ? angle : -angle;
    }
    
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    collidableMeshes.push(mesh);
}
