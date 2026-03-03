const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js";
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Setup PBR Environment lighting[\s\S]*?var defaultPipeline = new DefaultRenderingPipeline\("default", true, this\.scene, \[this\.camera\]\);/m;

const replacement = `// Setup FollowCamera
    this.camera = new FollowCamera("camera", new Vector3(0, 5, -15), this.scene);
    this.camera.radius = 8;
    this.camera.heightOffset = 3;
    this.camera.rotationOffset = 180;
    this.camera.cameraAcceleration = 0.1;
    this.camera.maxCameraSpeed = 50;

    // Setup PBR Environment lighting
    this.scene.createDefaultEnvironment({
        createSkybox: false,
        createGround: false,
        enableGroundShadow: true
      });

      // Essential Image Polish (No heavy effects, just MSAA and tonemapping)
      var defaultPipeline = new DefaultRenderingPipeline("default", true, this.scene, [this.camera]);`;

content = content.replace(regex, replacement);

// Remove the old setup camera section
const oldCamRegex = /\/\/ Setup FollowCamera\s*this\.camera = new FollowCamera\("camera", new Vector3\(0, 5, -15\), this\.scene\);\s*this\.camera\.radius = 8;\s*this\.camera\.heightOffset = 3;\s*this\.camera\.rotationOffset = 180;\s*this\.camera\.cameraAcceleration = 0\.1;\s*this\.camera\.maxCameraSpeed = 50;/;
const startIdx = content.indexOf('// Setup FollowCamera', content.indexOf(replacement) + replacement.length);
if(startIdx !== -1) {
  const endIdx = content.indexOf('// Enable camera mode switching logic', startIdx);
  if(endIdx !== -1) {
      content = content.substring(0, startIdx) + content.substring(endIdx);
  }
}

fs.writeFileSync(path, content, 'utf8');
console.log("Fixed camera initialization order");
