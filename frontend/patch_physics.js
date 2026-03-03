const fs = require('fs');
let p = fs.readFileSync('c:/Users/laptop/GLOKarts/frontend/src/modules/realtime/colyseus-babylon-client.js', 'utf8');
let start = p.indexOf('applyLocalPrediction(input) {');
let end = p.indexOf('  reconcile(state) {');
let orig = p.substring(start, end);
let repl = \pplyLocalPrediction(input) {
    if (!this.localMesh || !this.localKartAggregate) return;

    const body = this.localKartAggregate.body;
    const transform = this.localMesh;
    const dt = 1 / 60;
    
    // Ensure body remains active
    body.disablePreStep = false;

    let currentVel = body.getLinearVelocity();
    let currentAngVel = body.getAngularVelocity();
    
    if (
      !Number.isFinite(currentVel.x) ||
      !Number.isFinite(currentVel.y) ||
      !Number.isFinite(currentVel.z) ||
      !Number.isFinite(currentAngVel.x) ||
      !Number.isFinite(currentAngVel.y) ||
      !Number.isFinite(currentAngVel.z)
    ) {
      body.setLinearVelocity(new Vector3(0, 0, 0));
      body.setAngularVelocity(new Vector3(0, 0, 0));
      return;
    }
    
    const MAX_SPEED = 40;
    const TURN_SPEED = 2.8; 
    const DRIFT_GRIP = 0.5;

    let speed = Math.sqrt(currentVel.x**2 + currentVel.z**2);

    // 1. Steering (Angular)
    if (input.steer !== 0 && speed > 1.0) {
        const forwardDir = transform.forward.scale(-1);
        const isReversing = Vector3.Dot(currentVel, forwardDir) < -1;
        const dir = isReversing ? -1 : 1;
        const steerMult = input.brake ? 1.4 : 1.0; 
        
        let targetTurn = input.steer * TURN_SPEED * dir * steerMult;
        body.setAngularVelocity(new Vector3(currentAngVel.x, targetTurn, currentAngVel.z));
    } else {
        body.setAngularVelocity(new Vector3(currentAngVel.x, currentAngVel.y * 0.8, currentAngVel.z));
    }

    let nextVel = new Vector3(currentVel.x, currentVel.y, currentVel.z);

    // 2. Acceleration
    const forwardDir = transform.forward.scale(-1);
    if (forwardDir.lengthSquared() > 0.00001) {
      forwardDir.normalize();
    } else {
      forwardDir.copyFromFloats(0, 0, 1);
    }
    
    const accelAmount = 30; // modified direct delta velocity per step
    
    if (input.throttle !== 0) {
        if (speed < MAX_SPEED || (input.throttle < 0 && speed > 2)) {
            nextVel.x += forwardDir.x * input.throttle * accelAmount * dt;
            nextVel.z += forwardDir.z * input.throttle * accelAmount * dt;
        }
    }

    // 3. Friction & Braking
    if (input.brake) {
        nextVel.x *= 0.90;
        nextVel.z *= 0.90;
    } else if (input.throttle === 0) {
        nextVel.x *= 0.98;
        nextVel.z *= 0.98;
    }

    // 4. Lateral grip (Anti-ice drifting)
    let rightDir = transform.right;
    if (rightDir.lengthSquared() > 0.00001) {
      rightDir.normalize();
    } else {
      rightDir = new Vector3(1, 0, 0);
    }
    
    let latSpeed = Vector3.Dot(nextVel, rightDir);
    let grip = input.brake ? (DRIFT_GRIP * 0.4) : DRIFT_GRIP;
    
    nextVel.x -= rightDir.x * latSpeed * grip;
    nextVel.z -= rightDir.z * latSpeed * grip;

    // Finally apply result exactly once
    body.setLinearVelocity(nextVel);
  }

\;
p = p.replace(orig, repl);
fs.writeFileSync('c:/Users/laptop/GLOKarts/frontend/src/modules/realtime/colyseus-babylon-client.js', p);
console.log('Patched');

