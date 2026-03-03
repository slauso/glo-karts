const fs = require("fs");
const files = [
    "C:/Users/laptop/twistedkart/frontend/src/main.js",
    "C:/Users/laptop/twistedkart/frontend/src/battle-main.js"
];

for (const path of files) {
    let content = fs.readFileSync(path, 'utf8');

    const regex = /const directionalLight = new THREE\.DirectionalLight\(0xffffff, 3\.5\);\s*directionalLight\.position\.set\(40, 250, 30\);\s*scene\.add\(directionalLight\);/m;
    
    const replacement = `const directionalLight = new THREE.DirectionalLight(0xffffff, 3.5);
    directionalLight.position.set(40, 250, 30);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 1500;
    directionalLight.shadow.camera.left = -300;
    directionalLight.shadow.camera.right = 300;
    directionalLight.shadow.camera.top = 300;
    directionalLight.shadow.camera.bottom = -300;
    directionalLight.shadow.bias = -0.001; // Reduce shadow acne
    scene.add(directionalLight);
    
    // Also include a hemisphere light for better ambient color blending
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.5);
    scene.add(hemiLight);`;

    content = content.replace(regex, replacement);
    
    // For shadows to render properly, the render must enable soft shadows
    content = content.replace(/renderer\.shadowMap\.type = THREE\.PCFSoftShadowMap;/g, "renderer.shadowMap.type = THREE.PCFSoftShadowMap;\n  renderer.toneMapping = THREE.ACESFilmicToneMapping;\n  renderer.toneMappingExposure = 1.0;");
    
    fs.writeFileSync(path, content, 'utf8');
}
console.log("Updated directional light shadows in three.js files");
