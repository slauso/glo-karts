const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/realtime-main.js";
let content = fs.readFileSync(path, 'utf8');

content = content.replace("if (key === 'a' || key === 'arrowleft') input.steer = isDown ? -1 : 0;", "if (key === 'a' || key === 'arrowleft') input.steer = isDown ? 1 : 0;");
content = content.replace("if (key === 'd' || key === 'arrowright') input.steer = isDown ? 1 : 0;", "if (key === 'd' || key === 'arrowright') input.steer = isDown ? -1 : 0;");

fs.writeFileSync(path, content, 'utf8');
console.log("Reversed steering input");
