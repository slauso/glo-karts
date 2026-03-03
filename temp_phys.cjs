const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js";
let content = fs.readFileSync(path, 'utf8');

const regex = /\/\/ Physics-based steering([\s\S]*?\} else \{[\s\S]*?body\.setLinearVelocity\(new Vector3\(currentVel\.x \* 0\.92, currentVel\.y, currentVel\.z \* 0\.92\)\);\n\s*\})/m;

const replacement = `// Smoother Physics-based steering
      if (input.steer !== 0) {
          // Add some lerp-like smoothing to steering based on current speed
          let turnSpeed = (speed > 5) ? 2.5 : (speed / 2); 
          transform.rotate(Vector3.Up(), input.steer * turnSpeed * dt);
          
          // Slight damping on angular velocity to reduce jitter
          let angVel = body.getAngularVelocity();
          body.setAngularVelocity(new Vector3(angVel.x * 0.9, angVel.y * 0.8, angVel.z * 0.9));
      }

      // Physics-based acceleration via exact velocities
      let currentVel = body.getLinearVelocity();
      let speed = Math.sqrt(currentVel.x*currentVel.x + currentVel.z*currentVel.z);

      if (input.throttle !== 0) {
          // Compute desired forward direction
          let forwardDir = transform.forward;
          let targetSpeed = 45; // Max speed
          
          // Provide organic acceleration curve (exponential approach instead of instant rigid lock)
          let accelRate = speed < 15 ? 0.05 : 0.02; // Faster start, slower drift to max
          let targetVel = forwardDir.scale(-input.throttle * targetSpeed);

          // Smoothly interpolate current horizontal velocity towards target velocity
          let newVx = currentVel.x * (1 - accelRate) + targetVel.x * accelRate;
          let newVz = currentVel.z * (1 - accelRate) + targetVel.z * accelRate;

          body.setLinearVelocity(new Vector3(newVx, currentVel.y, newVz));
      } else {
          // Natural drag deceleration
          body.setLinearVelocity(new Vector3(currentVel.x * 0.95, currentVel.y, currentVel.z * 0.95));
      }`;

content = content.replace(regex, replacement);

fs.writeFileSync(path, content, 'utf8');
console.log("Updated physics string");
