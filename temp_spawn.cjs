const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js";
let content = fs.readFileSync(path, 'utf8');

const targetStr = `this.localMesh.position = new Vector3(0, 5, 0); // Drop safely on track`;
if (content.includes(targetStr)) {
    const replacement = `// Map defined spawn points or fallback
          let spawnMap = trackInfo.startPositions || [{x: 0, y: 1, z: 0}, {x: 5, y: 1, z: 5}, {x: -5, y: 1, z: 5}, {x: 5, y: 1, z: -5}, {x: -5, y: 1, z: -5}];
          let spawnPick = spawnMap[Math.floor(Math.random() * spawnMap.length)];
          this.localMesh.position = new Vector3(spawnPick.x, Number(spawnPick.y) + 1, spawnPick.z); // Drop safely on track`;
    content = content.replace(targetStr, replacement);
}

const targetStr2 = `this.localMesh.position = new Vector3(0, 5, 0);`;
// Second replacement in the catch block
content = content.replace(targetStr2, `this.localMesh.position = new Vector3((Math.random() * 10) - 5, 5, (Math.random() * 10) - 5);`);

// Enhance driving dynamics for Networked Meshes
const networkLerpRegex = /mesh\.position = Vector3\.Lerp\(mesh\.position, targetPos, 0\.3\);[\s\S]*?mesh\.rotationQuaternion = Quaternion\.Slerp\(mesh\.rotationQuaternion, targetRot, 0\.3\);/m;
const networkLerpReplacement = `// Use higher interpolation factor for smoother remote player movement to eliminate jitter
          mesh.position = Vector3.Lerp(mesh.position, targetPos, 0.45);
          if (mesh.rotationQuaternion) {
            mesh.rotationQuaternion = Quaternion.Slerp(mesh.rotationQuaternion, targetRot, 0.45);`;
content = content.replace(networkLerpRegex, networkLerpReplacement);

// We need to ensure we fix remote rendering to not have shadows disabled (already done previously)

fs.writeFileSync(path, content, 'utf8');
console.log("Updated spawn logic and driving dynamics");
