const fs = require('fs');

let code = fs.readFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', 'utf8');

const regexSendInput = /sendInput\(input\)\s*\{[\s\S]*?applyLocalPrediction\(input\)\s*\{/;

const replaceSendInput = `sendInput(input) {
    if (!this.room || !this.localMesh) return;

    const seq = ++this.inputSeq;
    const { position, rotationQuaternion } = this.localMesh;
    
    if (!rotationQuaternion) {
        this.localMesh.rotationQuaternion = new Quaternion();
    }

    const payload = {
      seq,
      throttle: Number(input.throttle || 0),
      steer: Number(input.steer || 0),
      brake: Number(input.brake || 0),
      fire: !!input.fire,
      x: position.x,
      y: position.y,
      z: position.z,
      rx: this.localMesh.rotationQuaternion.x,
      ry: this.localMesh.rotationQuaternion.y,
      rz: this.localMesh.rotationQuaternion.z,
      rw: this.localMesh.rotationQuaternion.w,
    };

    this.applyLocalPrediction(payload);
    this.pendingInputs.push(payload);
    this.room.send("input", payload);
  }

  applyLocalPrediction(input) {`;

code = code.replace(regexSendInput, replaceSendInput);


const regexApplyPrediction = /applyLocalPrediction\(input\)\s*\{[\s\S]*?reconcile\(state\)\s*\{/;

const replaceApplyPrediction = `applyLocalPrediction(input) {
    if (!this.localMesh || !this.localKartAggregate) return;

    const body = this.localKartAggregate.body;
    const transform = this.localMesh;
    const dt = 1 / 60;

    let currentVel = body.getLinearVelocity();
    let currentAngVel = body.getAngularVelocity();
    
    // Console-quality kart tuning
    const MAX_SPEED = 40;
    const ACCEL_FORCE = 35000;
    const TURN_SPEED = 2.8; 
    const DRIFT_GRIP = 0.5;

    let speed = Math.sqrt(currentVel.x**2 + currentVel.z**2);

    // 1. Steering (Physics Angular Velocity)
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

    // 2. Acceleration (Linear Impulse)
    const forwardDir = transform.forward.scale(-1).normalize();
    if (input.throttle !== 0) {
        if (speed < MAX_SPEED || (input.throttle < 0 && speed > 2)) {
             body.applyImpulse(forwardDir.scale(input.throttle * ACCEL_FORCE * dt), transform.getAbsolutePosition());
        }
    }

    // 3. Friction & Braking
    if (input.brake) {
        body.setLinearVelocity(new Vector3(currentVel.x * 0.90, currentVel.y, currentVel.z * 0.90));
    } else if (input.throttle === 0) {
        body.setLinearVelocity(new Vector3(currentVel.x * 0.98, currentVel.y, currentVel.z * 0.98));
    }

    // 4. Lateral grip (Anti-ice drifting)
    let rightDir = transform.right.normalize();
    let currentVel2 = body.getLinearVelocity();
    let latSpeed = Vector3.Dot(currentVel2, rightDir);
    
    let grip = input.brake ? (DRIFT_GRIP * 0.4) : DRIFT_GRIP;
    let correctiveLatVel = rightDir.scale(-latSpeed * grip);

    body.setLinearVelocity(new Vector3(
        currentVel2.x + correctiveLatVel.x,
        currentVel2.y,
        currentVel2.z + correctiveLatVel.z
    ));
  }

  reconcile(state) {`;

code = code.replace(regexApplyPrediction, replaceApplyPrediction);


const regexReconcile = /reconcile\(state\)\s*\{[\s\S]*?syncRemoteMeshes\(state\)\s*\{/;

const replaceReconcile = `reconcile(state) {
    if (!this.localMesh || !state?.players || !this.room) return;
    const self = state.players.get(this.room.sessionId);
    if (!self) return;

    // Pure Client-Authoritative Physics:
    // We DO NOT snap the local player to the server's echoed state.
    // Instead we just keep sending our physics state, and clear old pending inputs.
    // This prevents the visual and physical engine from rubber-banding locally.
    const ackSeq = self.lastProcessedInput || 0;
    this.pendingInputs = this.pendingInputs.filter((i) => i.seq > ackSeq);
  }

  syncRemoteMeshes(state) {`;

code = code.replace(regexReconcile, replaceReconcile);

fs.writeFileSync('C:/Users/laptop/twistedkart/frontend/src/modules/realtime/colyseus-babylon-client.js', code);
console.log("Replaced colyseus-babylon-client.js correctly.");