const fs = require("fs");
const path = "C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js";
let content = fs.readFileSync(path, 'utf8');

const startIdx = content.indexOf('applyLocalPrediction(input) {');
const endIdx = content.indexOf('reconcile(state) {');

if (startIdx !== -1 && endIdx !== -1) {
    const replacement = `applyLocalPrediction(input) {
      if (!this.localMesh || !this.localKartAggregate || !this.started) return; 

      const body = this.localKartAggregate.body;
      const transform = this.localMesh;

      // Ensure stable physics updates
      let currentVel = body.getLinearVelocity();
      
      // Calculate local forward and right directions
      let forwardDir = transform.forward;
      let rightDir = Vector3.Cross(Vector3.Up(), forwardDir).normalize();
      
      // Project global velocity into local kart space
      let forwardSpeed = Vector3.Dot(currentVel, forwardDir);
      let lateralSpeed = Vector3.Dot(currentVel, rightDir);

      // --- 1. ARCADE STEERING (Angular Velocity avoids transform.rotate conflicts with Havok) ---
      let speedMagnitude = Math.abs(forwardSpeed);
      if (speedMagnitude > 0.5) {
          // Reverse steering if driving backwards for natural feel
          let reverseMultiplier = forwardSpeed > 0 ? 1 : -1;
          
          // Speed-sensitive steering (tighter turning at medium speeds vs high speeds)
          let turnSpeed = 3.5;
          if (speedMagnitude > 25) turnSpeed = 2.0;

          // Apple smooth torque directly to physics body rather than visual mesh
          body.setAngularVelocity(new Vector3(
              0, 
              (input.steer * turnSpeed * reverseMultiplier), 
              0
          ));
      } else {
          // Instantly kill angular spin when stopped to prevent floating rotation
          body.setAngularVelocity(new Vector3(0, 0, 0));
      }

      // --- 2. ARCADE THROTTLE (Smooth Forward Momentum) ---
      let targetForwardSpeed = forwardSpeed;
      if (input.throttle !== 0) {
          const maxSpeed = 45;
          const maxReverse = 20;
          
          if (input.throttle > 0) {
              // Accelerate: Exponential approach toward maxSpeed
              targetForwardSpeed = forwardSpeed + (maxSpeed - forwardSpeed) * 0.05;
          } else {
              // Reverse/Brake: Exponential approach toward maxReverse
              targetForwardSpeed = forwardSpeed - (forwardSpeed + maxReverse) * 0.05;
          }
      } else {
          // Natural coasting/friction
          targetForwardSpeed *= 0.95; 
      }

      // --- 3. ARCADE GRIP (Kill Lateral Sliding) ---
      // If brake is pressed, reduce grip to allow drifting. Otherwise, snap to track.
      let groundGrip = (input.brake > 0) ? 0.96 : 0.82; 
      lateralSpeed *= groundGrip;

      // --- 4. APPLY FORCES ---
      // Reconstruct the global velocity vector using the smoothed local components
      let forwardVector = forwardDir.scale(targetForwardSpeed);
      let lateralVector = rightDir.scale(lateralSpeed);
      let newVel = forwardVector.add(lateralVector);
      
      // Maintain Havok's vertical gravity calculations
      body.setLinearVelocity(new Vector3(newVel.x, currentVel.y, newVel.z));
      
      // Complete stop threshold to prevent microscopic creeping
      if (Math.abs(input.throttle) < 0.1 && Math.abs(targetForwardSpeed) < 0.5) {
         body.setLinearVelocity(new Vector3(0, currentVel.y, 0));
      }
    }

    `;

    content = content.substring(0, startIdx) + replacement + content.substring(endIdx);
    fs.writeFileSync(path, content, 'utf8');
    console.log("SUCCESSFULLY replaced applyLocalPrediction");
} else {
    console.log("FAILED to find bounds");
}
