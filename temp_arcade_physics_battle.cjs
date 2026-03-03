const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/battle-main.js";
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Update physics[\s\S]*?kartBody\.setLinearVelocity\(new ammo\.btVector3\(velocity\.x, velocity\.y, velocity\.z\)\);\n\s*\}/m;

const replacement = `// Update physics (Arcade Racing Logic)
        // Project velocity onto local forward/right axes
        const currentSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        
        let forwardX = Math.sin(carData.rotation);
        let forwardZ = Math.cos(carData.rotation);
        
        // Calculate the kart's right vector (90 degrees to forward)
        let rightX = forwardZ;
        let rightZ = -forwardX;

        // Find how much of the current velocity is moving forward vs sliding sideways
        let forwardVelMagnitude = (velocity.x * forwardX) + (velocity.z * forwardZ);
        let rightVelMagnitude = (velocity.x * rightX) + (velocity.z * rightZ);

        if (inputState.throttle !== 0) {
            const maxSpeed = 45;
            const throttlePower = Math.abs(inputState.throttle);
            
            // Arcade Acceleration (Exponential curve)
            if (inputState.throttle > 0) {
                 forwardVelMagnitude = forwardVelMagnitude + (maxSpeed - forwardVelMagnitude) * 0.05 * throttlePower;
            } else {
                 forwardVelMagnitude = forwardVelMagnitude - (forwardVelMagnitude + 20) * 0.05 * throttlePower;
            }
        } else {
             // Natural drag deceleration
             forwardVelMagnitude *= 0.95;
        }

        // ARCADE GRIP: Kill lateral sliding to simulate tires biting the road.
        // Decrease grip if brake is pressed to allow drifting.
        let gripAmount = inputState.brake > 0 ? 0.96 : 0.82;
        rightVelMagnitude *= gripAmount;

        // Reconstruct global velocity from the filtered local components
        velocity.x = (forwardX * forwardVelMagnitude) + (rightX * rightVelMagnitude);
        velocity.z = (forwardZ * forwardVelMagnitude) + (rightZ * rightVelMagnitude);

        // Apply updated velocity
        kartBody.setLinearVelocity(new ammo.btVector3(velocity.x, velocity.y, velocity.z));
        
        // Stop completely at zero inputs to prevent microscopic sliding
        if (Math.abs(inputState.throttle) < 0.1 && Math.abs(forwardVelMagnitude) < 0.5) {
            velocity.x = 0; velocity.z = 0;
            kartBody.setLinearVelocity(new ammo.btVector3(0, velocity.y, 0));
        }`;

content = content.replace(regex, replacement);
fs.writeFileSync(path, content, 'utf8');
console.log("Updated arcade physics in standalone battle mode");
