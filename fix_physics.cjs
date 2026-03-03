const fs = require('fs');
let p = 'C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js';
let c = fs.readFileSync(p, 'utf8');

// Replace the loop
let loopOld = `      const ackSeq = self.lastProcessedInput || 0;
      this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
      for (const pending of this.pendingInputs) {
        this.applyLocalPrediction(pending);
      }`;

let loopNew = `      const ackSeq = self.lastProcessedInput || 0;
      this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
      // Removed double-application of inputs because the server does not run physics
      // and we are fully client-authoritative on local movement.`;

c = c.replace(loopOld, loopNew);

// Also fix the throttle dynamics to use impulse instead of instantaneous setLinearVelocity
// That way it accelerates smoothly instead of jumping, and turning isn't constrained to an arc that feels disconnected from momentum
let applyOld = `      // Physics-based acceleration
      if (input.throttle !== 0) {
          const forwardSpeed = 30; // Max speed
          const force = transform.forward.scale(-input.throttle * forwardSpeed); // Babylon right-handling forward is -Z often, check STK models  
          let currentVel = body.getLinearVelocity();
          // Simple manual friction/acceleration override for now
          body.setLinearVelocity(new Vector3(force.x, currentVel.y, force.z));  
      } else {
          // Natural deceleration
          let currentVel = body.getLinearVelocity();
          body.setLinearVelocity(new Vector3(currentVel.x * 0.95, currentVel.y, currentVel.z * 0.95));
      }`;

let applyNew = `      // Physics-based acceleration via Impulses (STK Style)
      let currentVel = body.getLinearVelocity();
      let speed = Math.sqrt(currentVel.x*currentVel.x + currentVel.z*currentVel.z);
      
      if (input.throttle !== 0) {
          // Accelerate to max speed
          if (speed < 40) {
              const accel = 600 * dt; // Stronger impulse for kart feel
              const force = transform.forward.scale(-input.throttle * accel);
              body.applyImpulse(force, transform.getAbsolutePosition());
          }
      } else {
          // Natural drag deceleration
          body.setLinearVelocity(new Vector3(currentVel.x * 0.92, currentVel.y, currentVel.z * 0.92));
      }
      
      // Enforce max speed cap and stabilize
      if (speed > 45) {
         let scale = 45 / speed;
         body.setLinearVelocity(new Vector3(currentVel.x * scale, currentVel.y, currentVel.z * scale));
      }
      
      // Stop completely if slow to prevent sliding
      if (Math.abs(input.throttle) < 0.1 && speed < 0.5) {
         body.setLinearVelocity(new Vector3(0, currentVel.y, 0));
      }
      `;

if (c.includes(applyOld)) {
   c = c.replace(applyOld, applyNew);
   console.log("Improved Physics applied");
}

fs.writeFileSync(p, c);
console.log("Done");