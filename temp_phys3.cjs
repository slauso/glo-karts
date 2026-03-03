const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/main.js";
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Update physics[\s\S]*?kartBody\.setLinearVelocity\(new ammo\.btVector3\(velocity\.x, velocity\.y, velocity\.z\)\);\n\s*\}/m;

const replacement = `// Update physics
        let speed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        if (inputState.throttle !== 0) {
            const targetSpeed = 45; // Max speed matching realtime
            const throttlePower = Math.abs(inputState.throttle);
            const accelRate = speed < 15 ? 0.05 : 0.02; // Smoother natural acceleration 
            
            // Map 2D rotation to a unit forward vector
            const forwardX = Math.sin(carData.rotation);
            const forwardZ = Math.cos(carData.rotation);
            
            const targetVx = forwardX * inputState.throttle * targetSpeed * throttlePower;
            const targetVz = forwardZ * inputState.throttle * targetSpeed * throttlePower;
            
            velocity.x = velocity.x * (1 - accelRate) + targetVx * accelRate;
            velocity.z = velocity.z * (1 - accelRate) + targetVz * accelRate;
            kartBody.setLinearVelocity(new ammo.btVector3(velocity.x, velocity.y, velocity.z));
        } else {
             // Let Havok/Ammo apply natural drag deceleration
             velocity.x *= 0.95;
             velocity.z *= 0.95;
             kartBody.setLinearVelocity(new ammo.btVector3(velocity.x * 0.95, velocity.y, velocity.z * 0.95));
        }`;

content = content.replace(regex, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log("Updated main mode physics string");
