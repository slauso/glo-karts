const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/content-registry.js";
let content = fs.readFileSync(path, 'utf8');

// Change standard kart scaling from 1 to 1.8, and default from 1.33 to 2.4
content = content.replace(/scale: 1 \},/g, "scale: 1.8 },");
content = content.replace(/scale: 1\.33 \}/g, "scale: 2.4 }");
content = content.replace(/scale: 1,/g, "scale: 1.8,");

fs.writeFileSync(path, content, 'utf8');
console.log("Updated kart scaling in registry");
