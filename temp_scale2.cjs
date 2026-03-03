const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/content-registry.js";
let content = fs.readFileSync(path, 'utf8');

// Revert everything back to 1
content = content.replace(/scale: 1\.8/g, "scale: 1");

// Explicitly target kart lines to make them 2.5 times bigger
content = content.replace(/kart\.glb', scale: 1/g, "kart.glb', scale: 2.2");
content = content.replace(/scale: 2\.4/g, "scale: 2.8");

fs.writeFileSync(path, content, 'utf8');
console.log("Correctly scaled ONLY karts in registry");
