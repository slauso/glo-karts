import * as THREE from 'three';

export class Kart {
    constructor(scene, x, y, z, color = 0xffaa00) {
        // Visual Mesh
        this.mesh = new THREE.Group();
        
        // Chassis
        const chassisGeo = new THREE.BoxGeometry(2, 0.5, 3);
        const chassisMat = new THREE.MeshStandardMaterial({ color: color });
        const chassis = new THREE.Mesh(chassisGeo, chassisMat);
        chassis.position.y = 0.25;
        chassis.castShadow = true;
        this.mesh.add(chassis);

        // Driver
        const driverGeo = new THREE.BoxGeometry(1, 1, 1);
        const driverMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        const driver = new THREE.Mesh(driverGeo, driverMat);
        driver.position.set(0, 1, 0);
        driver.castShadow = true;
        this.mesh.add(driver);

        // Wheels
        const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.4, 16);
        wheelGeo.rotateZ(Math.PI / 2);
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
        
        const w1 = new THREE.Mesh(wheelGeo, wheelMat); w1.position.set(1.2, 0.4, 1);
        const w2 = new THREE.Mesh(wheelGeo, wheelMat); w2.position.set(-1.2, 0.4, 1);
        const w3 = new THREE.Mesh(wheelGeo, wheelMat); w3.position.set(1.2, 0.4, -1);
        const w4 = new THREE.Mesh(wheelGeo, wheelMat); w4.position.set(-1.2, 0.4, -1);
        
        this.mesh.add(w1, w2, w3, w4);
        
        this.mesh.position.set(x, y, z);
        scene.add(this.mesh);

        // --- KINEMATIC PHYSICS STATE ---
        this.position = new THREE.Vector3(x, y, z);
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.rotation = 0; // Yaw angle in radians
        
        // Kart Stats (Tuned for MK64 feel)
        this.maxSpeed = 60.0;
        this.acceleration = 40.0;
        this.braking = 60.0;
        this.friction = 20.0; // How fast you slow down when not pressing gas
        this.turnSpeed = 3.0; // Radians per second
        
        // Gravity & Jumping
        this.gravity = 120.0;
        this.verticalVelocity = 0;
        this.isGrounded = false;
        this.jumpForce = 35.0;
        
        // Raycaster for ground detection
        this.raycaster = new THREE.Raycaster();
        this.downVector = new THREE.Vector3(0, -1, 0);
    }

    update(input, dt, collidableMeshes) {
        // 1. Handle Steering (Only if moving)
        const speed = this.velocity.length();
        const isMoving = speed > 0.1;
        
        if (isMoving && this.isGrounded) {
            // Turn speed scales slightly with velocity so you don't spin in place
            const turnFactor = Math.min(speed / (this.maxSpeed * 0.5), 1.0);
            if (input.a) this.rotation += this.turnSpeed * turnFactor * dt;
            if (input.d) this.rotation -= this.turnSpeed * turnFactor * dt;
        }

        // Calculate forward direction vector based on current rotation
        const forward = new THREE.Vector3(Math.sin(this.rotation), 0, Math.cos(this.rotation));

        // 2. Handle Acceleration & Braking
        if (this.isGrounded) {
            if (input.w) {
                // Accelerate forward
                this.velocity.add(forward.clone().multiplyScalar(this.acceleration * dt));
            } else if (input.s) {
                // Brake / Reverse
                this.velocity.sub(forward.clone().multiplyScalar(this.braking * dt));
            } else {
                // Apply friction to slow down
                if (speed > 0) {
                    const frictionDrop = this.friction * dt;
                    const newSpeed = Math.max(0, speed - frictionDrop);
                    if (newSpeed === 0) {
                        this.velocity.set(0, 0, 0);
                    } else {
                        this.velocity.normalize().multiplyScalar(newSpeed);
                    }
                }
            }

            // Cap speed
            if (this.velocity.length() > this.maxSpeed) {
                this.velocity.normalize().multiplyScalar(this.maxSpeed);
            }
            
            // Jump (Hop)
            if (input.space) {
                this.verticalVelocity = this.jumpForce;
                this.isGrounded = false;
                // Prevent holding space to fly
                input.space = false; 
            }
        }

        // 3. Apply Gravity
        if (!this.isGrounded) {
            this.verticalVelocity -= this.gravity * dt;
        }

        // 4. Calculate New Position
        const nextPosition = this.position.clone();
        nextPosition.add(this.velocity.clone().multiplyScalar(dt));
        nextPosition.y += this.verticalVelocity * dt;

        // 4.5 Horizontal Collision Detection (Wall sliding)
        // Cast rays in 8 directions to prevent clipping through walls
        const directions = [
            new THREE.Vector3(1, 0, 0),
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, -1),
            new THREE.Vector3(1, 0, 1).normalize(),
            new THREE.Vector3(-1, 0, 1).normalize(),
            new THREE.Vector3(1, 0, -1).normalize(),
            new THREE.Vector3(-1, 0, -1).normalize()
        ];
        
        const kartRadius = 1.5; // Approximate radius of the kart
        
        for (const dir of directions) {
            const horizRaycaster = new THREE.Raycaster(nextPosition.clone().add(new THREE.Vector3(0, 1, 0)), dir, 0, kartRadius);
            const horizIntersects = horizRaycaster.intersectObjects(collidableMeshes);
            
            if (horizIntersects.length > 0) {
                const hit = horizIntersects[0];
                const normal = hit.face.normal.clone();
                
                // Only push back if it's a vertical wall (normal.y is close to 0)
                if (Math.abs(normal.y) < 0.5) {
                    // Push the kart away from the wall
                    const pushDist = kartRadius - hit.distance;
                    nextPosition.add(normal.multiplyScalar(pushDist));
                    
                    // Also kill velocity into the wall
                    const dot = this.velocity.dot(normal);
                    if (dot < 0) {
                        this.velocity.sub(normal.multiplyScalar(dot));
                    }
                }
            }
        }

        // 5. Ground Collision Detection (Raycasting)
        // Cast a ray straight down from slightly above the kart's center
        const rayOrigin = nextPosition.clone();
        rayOrigin.y += 2.0; // Start ray higher up to catch ramps we are driving into
        this.raycaster.set(rayOrigin, this.downVector);
        
        const intersects = this.raycaster.intersectObjects(collidableMeshes);
        
        this.isGrounded = false;
        if (intersects.length > 0) {
            const hit = intersects[0];
            // If the ground is within 2.5 units of our ray origin, we are grounded
            // This allows us to smoothly drive up ramps
            if (hit.distance <= 2.5 && this.verticalVelocity <= 0) {
                this.isGrounded = true;
                this.verticalVelocity = 0;
                // Snap to ground (offset by 0.5 so the chassis sits on top of the ground)
                nextPosition.y = hit.point.y + 0.5;
            }
        } else if (nextPosition.y < -10) {
            // Fall off map reset
            nextPosition.set(0, 30, 0);
            this.velocity.set(0, 0, 0);
            this.verticalVelocity = 0;
        }

        // Wall Collision (Simple bounding box check against map bounds for now)
        // In a full implementation, we would cast rays forward/left/right to slide along walls
        if (nextPosition.x > 85) nextPosition.x = 85;
        if (nextPosition.x < -85) nextPosition.x = -85;
        if (nextPosition.z > 85) nextPosition.z = 85;
        if (nextPosition.z < -85) nextPosition.z = -85;

        // 6. Update State & Visuals
        this.position.copy(nextPosition);
        
        this.mesh.position.copy(this.position);

        // Optional: Tilt the kart based on the ground normal
        if (this.isGrounded && intersects.length > 0) {
            const normal = intersects[0].face.normal;
            
            // Create a quaternion that aligns the UP vector with the ground normal
            const targetQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
            
            // Apply the yaw rotation on top of the tilt
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation);
            targetQuat.multiply(yawQuat);
            
            // Smoothly interpolate the rotation so it doesn't snap instantly
            this.mesh.quaternion.slerp(targetQuat, 0.2);
        } else {
            // If in the air, just use yaw
            const yawQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rotation);
            this.mesh.quaternion.slerp(yawQuat, 0.1);
        }
    }
}
