const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js";
let content = fs.readFileSync(path, 'utf8');

// Modify lighting and shadows
const regexLight = /const hemiLight = new HemisphericLight[\s\S]*?dirLight\.position = new Vector3\(20, 40, 20\);/m;

const replacementLight = `const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
      hemiLight.intensity = 0.85;
      hemiLight.groundColor = new BABYLON.Color3(0.2, 0.2, 0.2);
      hemiLight.specular = new BABYLON.Color3(0.1, 0.1, 0.1);

      const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), this.scene);
      dirLight.intensity = 1.6;
      dirLight.position = new Vector3(20, 40, 20);
      
      // Lightweight Shadows to anchor karts to track
      this.shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
      this.shadowGenerator.useBlurExponentialShadowMap = true;
      this.shadowGenerator.blurKernel = 32;
      this.shadowGenerator.setDarkness(0.3);`;

content = content.replace(regexLight, replacementLight);

// Add default rendering pipeline for MSAA and slight color correction
const regexEnv = /this\.scene\.createDefaultEnvironment\(\{[\s\S]*?\}\);/m;
const replacementEnv = `this.scene.createDefaultEnvironment({
        createSkybox: false,
        createGround: false,
        enableGroundShadow: true
      });

      // Essential Image Polish (No heavy effects, just MSAA and tonemapping)
      var defaultPipeline = new BABYLON.DefaultRenderingPipeline("default", true, this.scene, [this.camera]);
      defaultPipeline.samples = 4;
      defaultPipeline.imageProcessingEnabled = true;
      defaultPipeline.imageProcessing.contrast = 1.2;
      defaultPipeline.imageProcessing.exposure = 1.1;`;
content = content.replace(regexEnv, replacementEnv);

// Ensure meshes receive shadows
const regexImportTrack = /arenaResult\.meshes\.forEach\(mesh => \{/m;
const replacementImportTrack = `arenaResult.meshes.forEach(mesh => {
                 mesh.receiveShadows = true;`;
content = content.replace(regexImportTrack, replacementImportTrack);

const regexImportTrack2 = /trackResult\.meshes\.forEach\(mesh => \{/m;
const replacementImportTrack2 = `trackResult.meshes.forEach(mesh => {
                 mesh.receiveShadows = true;`;
content = content.replace(regexImportTrack2, replacementImportTrack2);

// Add karts to shadow caster
const regexLocalKart = /visualRoot\.position = new Vector3\(0, -0\.5, 0\); \/\/ floor offset/m;
const replacementLocalKart = `visualRoot.position = new Vector3(0, -0.5, 0); // floor offset
          if (this.shadowGenerator) {
              result.meshes.forEach(m => this.shadowGenerator.addShadowCaster(m, true));
          }`;
content = content.replace(regexLocalKart, replacementLocalKart);

const regexRemoteKart = /const realMesh = result\.meshes\[0\];/m;
const replacementRemoteKart = `const realMesh = result.meshes[0];
            if (this.shadowGenerator) {
                result.meshes.forEach(m => this.shadowGenerator.addShadowCaster(m, true));
            }`;
content = content.replace(regexRemoteKart, replacementRemoteKart);

// We need to ensure BABYLON is available since we used it. Let's add it to imports or use the imported classes.
// The file imports from "@babylonjs/core", so we've used BABYLON.Color3 which might be undefined. Let's fix that!
content = content.replace(/new BABYLON\.Color3/g, "new Color3");
content = content.replace(/new BABYLON\.ShadowGenerator/g, "new ShadowGenerator");
content = content.replace(/new BABYLON\.DefaultRenderingPipeline/g, "new DefaultRenderingPipeline");

// Add missing imports
const regexImports = /import \{\s*Engine,/m;
const replacementImports = `import {
  Engine,
  Color3,
  ShadowGenerator,
  DefaultRenderingPipeline,`;
content = content.replace(regexImports, replacementImports);

fs.writeFileSync(path, content, 'utf8');
console.log("Updated graphics in realtime scene");
