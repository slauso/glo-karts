const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/battle-main.js";
let content = fs.readFileSync(path, 'utf8');

content = content.replace("if (key === 'a' || key === 'ArrowLeft') inputState.steer = isDown ? -1 : 0;", "if (key === 'a' || key === 'ArrowLeft') inputState.steer = isDown ? 1 : 0;");
content = content.replace("if (key === 'd' || key === 'ArrowRight') inputState.steer = isDown ? 1 : 0;", "if (key === 'd' || key === 'ArrowRight') inputState.steer = isDown ? -1 : 0;");

fs.writeFileSync(path, content, 'utf8');
console.log("Reversed steering input in battle mode");
