/**
 * kart-fx-rig.js — Per-kart visual effects rig.
 *
 * Encapsulates the per-kart effects layer used by the multiplayer
 * client so each remote ghost (and the local kart) gets the same
 * visible behaviour as the SP playtest:
 *   • Skid-mark trail (ring-buffered BufferGeometry, one per kart)
 *   • Tyre-smoke / burnout puffs (THREE.Points pool, one per kart)
 *   • Drift sparks colour-coded by mini-turbo charge tier
 *   • Boost flame trail (GLO-tinted Points) for drift mini-turbo
 *     and burnout-release boost
 *
 * Inputs each frame come from the broadcast `KartState` schema so a
 * client can drive every remote kart's visuals without simulating
 * physics locally. The shapes mirror the SP `controlState` so SP
 * could later import this same rig (the SP play-main equivalent code
 * is the canonical reference; this rig is a visually-equivalent port
 * adapted for per-kart instancing — it is not a bit-exact copy of the
 * SP shader internals, only of the visible behaviour).
 *
 * Lifecycle:
 *   const rig = new KartFxRig({ scene, gloColor });
 *   rig.attachKartGroup(kartGroup);   // optional — used for puff anchor
 *   rig.update({                       // call from render loop
 *     position:   {x,y,z}
 *     quaternion: {x,y,z,w}
 *     velocity:   {x,y,z}
 *     driftActive, driftTier, driftDir,
 *     boostTimer, gloBurnoutT, chargingBurnout,
 *     wheelGrounded,           // uint8 bitmask, 4 bits
 *     throttleIn, brakeIn, steerIn,
 *     gloColor: THREE.Color,   // optional override per-frame
 *   }, dt);
 *   rig.dispose();                     // remove from scene + free GPU buffers
 */
import * as THREE from 'three';

const SCALE = 1000;
const M = (n) => n * SCALE;

// ── Skid mesh constants ──────────────────────────────────────
// 200 quads per wheel × 4 wheels = 800 quads ring buffer per kart.
// One emitted every SKID_MIN_STEP of contact-patch travel; oldest
// overwritten on wrap.
const SKID_QUADS_PER_WHEEL = 200;
const SKID_QUAD_COUNT = 4 * SKID_QUADS_PER_WHEEL;
const SKID_WIDTH = M(0.32);
const SKID_Y_OFFSET = M(0.10);
const SKID_MIN_STEP = M(0.12);
const SKID_LATERAL_THRESHOLD = M(1.8); // m/s of side-slip before marks
const SKID_BRAKE_SPEED_THRESHOLD = M(5);

// Wheel offsets in chassis-local space (matches createKartVehicle).
// Order: [rear-left, rear-right, front-left, front-right].
const CHASSIS_HX = M(0.6);
const CHASSIS_HY = M(0.3);
const CHASSIS_HZ = M(1.0);
const WHEEL_RADIUS = M(0.4);
const WX = CHASSIS_HX + M(0.05);
const WZ = CHASSIS_HZ * 0.75;
const WHEEL_LOCAL = [
  new THREE.Vector3(-WX, -CHASSIS_HY * 0.5 - WHEEL_RADIUS, -WZ),
  new THREE.Vector3( WX, -CHASSIS_HY * 0.5 - WHEEL_RADIUS, -WZ),
  new THREE.Vector3(-WX, -CHASSIS_HY * 0.5 - WHEEL_RADIUS,  WZ),
  new THREE.Vector3( WX, -CHASSIS_HY * 0.5 - WHEEL_RADIUS,  WZ),
];

// ── Skid material — shared across all rigs ────────────────────
// One ShaderMaterial drives every kart's skid mesh. Procedural,
// texture-free; ~25 ALU ops/fragment.
const SHARED_SKID_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  uniforms: { uOpacity: { value: 1.4 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec2 vWorld;
    void main() {
      vUv = uv;
      vWorld = position.xz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    varying vec2 vUv;
    varying vec2 vWorld;
    uniform float uOpacity;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p){
      vec2 i=floor(p), f=fract(p);
      vec2 u=f*f*f*(f*(f*6.0-15.0)+10.0);
      return mix(mix(h21(i),h21(i+vec2(1,0)),u.x),
                 mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x),u.y);
    }
    void main() {
      float vc = vUv.y - 0.5;
      float side = exp(-vc*vc*8.0);
      float ribA = exp(-pow((vUv.y-0.30)*4.5, 2.0));
      float ribB = exp(-pow((vUv.y-0.70)*4.5, 2.0));
      float rib  = clamp(0.55 + 0.55*(ribA+ribB), 0.0, 1.4);
      float coarse = vn(vWorld * 0.6);
      float fine   = vn(vWorld * 4.0);
      float lengthwise = 0.80 + 0.20 * vn(vec2(vWorld.x*2.5+vWorld.y*0.1, vUv.y*6.0));
      float density = rib * (0.70 + 0.30*coarse) * lengthwise;
      vec3 base = mix(vec3(0.02,0.02,0.02), vec3(0.10,0.09,0.08), fine);
      gl_FragColor = vec4(base, density * side * uOpacity);
    }
  `,
});

// ── Smoke / spark / flame material — shared additive Points ──
// One material per rig (tinted live with the rig's GLO colour). Round
// soft-disc procedural alpha — no texture upload.
function makePuffMaterial(initialColor) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(initialColor || 0xffffff) },
      uPxScale: { value: 220.0 },
    },
    vertexShader: /* glsl */`
      attribute float aSize;
      attribute float aLife;     // 0 = dead, 1 = freshly spawned
      attribute vec3  aTint;     // per-particle tint multiplier
      varying float vLife;
      varying vec3  vTint;
      uniform float uPxScale;
      void main() {
        vLife = aLife;
        vTint = aTint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPxScale / max(1.0, -mv.z);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vLife;
      varying vec3  vTint;
      uniform vec3  uColor;
      void main() {
        if (vLife <= 0.0) discard;
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d) * 4.0;
        if (r > 1.0) discard;
        float a = (1.0 - r) * vLife;
        vec3 col = uColor * vTint;
        gl_FragColor = vec4(col, a * 0.85);
      }
    `,
  });
}

const POOL_SIZE = 220;        // particles per rig

export class KartFxRig {
  constructor({ scene, gloColor = 0xff3aa1 } = {}) {
    this.scene = scene;
    this.gloColor = new THREE.Color(gloColor);
    this._buildSkidMesh();
    this._buildPuffPool();
    // Per-wheel last contact point (world space) for ribbon stitching.
    this._skidPrev = [null, null, null, null];
    this._skidWriteIdx = 0;
    this._skidFilled = 0;
    this._tmpQ = new THREE.Quaternion();
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    // Edge-detect drift tier so we can pulse a burst of sparks on tier-up.
    this._prevDriftTier = 0;
    this._prevBoostTimer = 0;
    this._prevGloBurnoutT = 0;
    // Edge-detect engine explosion (false→true) for the one-shot steam
    // burst and re-arm only after the engine recovers.
    this._prevEngineExploded = false;
    // Edge-detect throttle press (off→on) for the ignition pop puff.
    this._prevThrottle = 0;
    // Stationary-burnout overlay stamps live in the same particle pool
    // but use a dedicated cadence so they don't get throttled by the
    // moving-skid emitter.
    this._gloStampNextAt = [0, 0];
  }

  setGloColor(color) {
    if (!color) return;
    this.gloColor.set(color);
    this._puffMat.uniforms.uColor.value.copy(this.gloColor);
  }

  _buildSkidMesh() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(SKID_QUAD_COUNT * 4 * 3);
    const uvs = new Float32Array(SKID_QUAD_COUNT * 4 * 2);
    const indices = new (SKID_QUAD_COUNT * 4 > 65535 ? Uint32Array : Uint16Array)(SKID_QUAD_COUNT * 6);
    for (let q = 0; q < SKID_QUAD_COUNT; q++) {
      const v = q * 4;
      const i = q * 6;
      indices[i + 0] = v;     indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v;     indices[i + 4] = v + 2; indices[i + 5] = v + 3;
      const u = q * 8;
      uvs[u +  0] = 0; uvs[u +  1] = 0;
      uvs[u +  2] = 0; uvs[u +  3] = 1;
      uvs[u +  4] = 1; uvs[u +  5] = 1;
      uvs[u +  6] = 1; uvs[u +  7] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, SHARED_SKID_MAT);
    mesh.renderOrder = 1;
    mesh.frustumCulled = false; // ring buffer wraps the world
    this.scene.add(mesh);
    this._skidMesh = mesh;
    this._skidGeo = geo;
    this._skidPositions = positions;
  }

  _buildPuffPool() {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(POOL_SIZE * 3);
    const sizes = new Float32Array(POOL_SIZE);
    const lives = new Float32Array(POOL_SIZE);   // 0..1
    const tints = new Float32Array(POOL_SIZE * 3);
    const lifeMax = new Float32Array(POOL_SIZE);
    const vels = new Float32Array(POOL_SIZE * 3); // world-space drift velocity per particle
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
    const mat = makePuffMaterial(this.gloColor.getHex());
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    this.scene.add(points);
    this._puffMesh = points;
    this._puffGeo = geo;
    this._puffMat = mat;
    this._pPos = positions;
    this._pSize = sizes;
    this._pLife = lives;
    this._pTint = tints;
    this._pLifeMax = lifeMax;
    this._pVel = vels;
    this._pCursor = 0;
  }

  _spawnPuff(x, y, z, vx, vy, vz, life, size, tintR, tintG, tintB) {
    const i = this._pCursor;
    const i3 = i * 3;
    this._pPos[i3 + 0] = x;
    this._pPos[i3 + 1] = y;
    this._pPos[i3 + 2] = z;
    this._pVel[i3 + 0] = vx;
    this._pVel[i3 + 1] = vy;
    this._pVel[i3 + 2] = vz;
    this._pLife[i] = 1;
    this._pLifeMax[i] = life;
    this._pSize[i] = size;
    this._pTint[i3 + 0] = tintR;
    this._pTint[i3 + 1] = tintG;
    this._pTint[i3 + 2] = tintB;
    this._pCursor = (this._pCursor + 1) % POOL_SIZE;
    this._puffGeo.attributes.position.needsUpdate = true;
    this._puffGeo.attributes.aLife.needsUpdate = true;
    this._puffGeo.attributes.aSize.needsUpdate = true;
    this._puffGeo.attributes.aTint.needsUpdate = true;
  }

  _emitSkidQuad(wheelI, contactX, contactY, contactZ) {
    const prev = this._skidPrev[wheelI];
    if (!prev) {
      this._skidPrev[wheelI] = new THREE.Vector3(contactX, contactY, contactZ);
      return;
    }
    const dx = contactX - prev.x;
    const dz = contactZ - prev.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < SKID_MIN_STEP * SKID_MIN_STEP) return;
    const len = Math.sqrt(distSq);
    const px = (-dz / len) * SKID_WIDTH * 0.5;
    const pz = ( dx / len) * SKID_WIDTH * 0.5;
    const o = this._skidWriteIdx * 12;
    const P = this._skidPositions;
    P[o +  0] = prev.x + px; P[o +  1] = prev.y + SKID_Y_OFFSET; P[o +  2] = prev.z + pz;
    P[o +  3] = prev.x - px; P[o +  4] = prev.y + SKID_Y_OFFSET; P[o +  5] = prev.z - pz;
    P[o +  6] = contactX - px; P[o +  7] = contactY + SKID_Y_OFFSET; P[o +  8] = contactZ - pz;
    P[o +  9] = contactX + px; P[o + 10] = contactY + SKID_Y_OFFSET; P[o + 11] = contactZ + pz;
    prev.set(contactX, contactY, contactZ);
    this._skidWriteIdx = (this._skidWriteIdx + 1) % SKID_QUAD_COUNT;
    if (this._skidFilled < SKID_QUAD_COUNT) {
      this._skidFilled++;
      this._skidGeo.setDrawRange(0, this._skidFilled * 6);
    }
    this._skidGeo.attributes.position.needsUpdate = true;
  }

  /**
   * @param state {Object} broadcast snapshot fields:
   *   position {x,y,z}, quaternion {x,y,z,w}, velocity {x,y,z},
   *   driftActive, driftTier, driftDir, boostTimer, gloBurnoutT,
   *   chargingBurnout, wheelGrounded (bitmask), throttleIn, brakeIn,
   *   steerIn, gloColor (optional THREE.Color)
   */
  update(state, dt) {
    if (!state) return;
    if (state.gloColor) this.setGloColor(state.gloColor);

    const px = state.position?.x || 0;
    const py = state.position?.y || 0;
    const pz = state.position?.z || 0;

    // Yaw forward + right vectors (XZ plane only).
    const qx = state.quaternion?.x || 0;
    const qy = state.quaternion?.y || 0;
    const qz = state.quaternion?.z || 0;
    const qw = state.quaternion?.w || 1;
    const sinyCosp = 2 * (qw * qy + qx * qz);
    const cosyCosp = 1 - 2 * (qy * qy + qx * qx);
    const yaw = Math.atan2(sinyCosp, cosyCosp);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = fz, rz = -fx;

    const vx = state.velocity?.x || 0;
    const vz = state.velocity?.z || 0;
    const speed = Math.hypot(vx, vz);
    const fwdSpeed = vx * fx + vz * fz;
    const latSpeed = Math.abs(vx * fz - vz * fx);
    const wheelMask = state.wheelGrounded | 0;
    const anyGrounded = wheelMask !== 0;

    const drifting = !!state.driftActive;
    const driftTier = (state.driftTier | 0) || 0;
    const boostTimer = +state.boostTimer || 0;
    const gloBurnoutT = +state.gloBurnoutT || 0;
    const charging = !!state.chargingBurnout;
    const braking = (state.brakeIn || 0) > 0.5;

    // Quaternion for transforming wheel-local offsets.
    this._tmpQ.set(qx, qy, qz, qw);

    // Compute approximate wheel contact points: kart group origin +
    // quaternion-rotated WHEEL_LOCAL offsets. This is "approximate"
    // because we don't have suspension compression on the client; the
    // small Y error (~M(0.05) when compressed) is invisible on the
    // ground because SKID_Y_OFFSET = M(0.10) puts the ribbon above it.
    const wheelWorld = [];
    for (let i = 0; i < 4; i++) {
      this._tmpV.copy(WHEEL_LOCAL[i]).applyQuaternion(this._tmpQ);
      wheelWorld.push({
        x: px + this._tmpV.x,
        y: py + this._tmpV.y,
        z: pz + this._tmpV.z,
        grounded: !!(wheelMask & (1 << i)),
      });
    }

    // ── Skid emission triggers ─────────────────────────────────
    // Drift-active OR brake-drift (handbrake at speed turning) OR
    // big lateral slide. Mirror SP triggers; with these, marks appear
    // exactly when the kart is sliding in a way the player can feel.
    const brakeDrift = braking && fwdSpeed > SKID_BRAKE_SPEED_THRESHOLD
                       && Math.abs(state.steerIn || 0) > 0.25;
    const slide = latSpeed > SKID_LATERAL_THRESHOLD && speed > M(2);
    const skidNow = anyGrounded && (drifting || brakeDrift || slide || charging);
    if (skidNow) {
      for (let i = 0; i < 4; i++) {
        if (!wheelWorld[i].grounded) { this._skidPrev[i] = null; continue; }
        this._emitSkidQuad(i, wheelWorld[i].x, wheelWorld[i].y, wheelWorld[i].z);
      }
    } else {
      for (let i = 0; i < 4; i++) this._skidPrev[i] = null;
    }

    // ── Tyre / burnout smoke ───────────────────────────────────
    // Charge: thick smoke per rear wheel that ramps with stored charge.
    // Drift: lighter wisps from rear wheels.
    if (charging) {
      const burst = 4;
      for (let i = 0; i < 2; i++) {
        const w = wheelWorld[i];
        if (!w.grounded) continue;
        for (let p = 0; p < burst; p++) {
          this._spawnPuff(
            w.x + (Math.random() - 0.5) * M(0.20),
            w.y + WHEEL_RADIUS * 0.8 + Math.random() * M(0.10),
            w.z + (Math.random() - 0.5) * M(0.20),
            (Math.random() - 0.5) * M(0.4),
            M(0.6) + Math.random() * M(0.4),
            (Math.random() - 0.5) * M(0.4),
            0.55 + Math.random() * 0.25,
            M(0.45) + Math.random() * M(0.20),
            0.55, 0.55, 0.55, // grey body — soft additive will brighten
          );
        }
      }
    } else if (drifting) {
      // Wisps off rear wheels while drifting — colour-tinted by tier.
      const tierColor = driftTier >= 3 ? [0.30, 0.95, 1.0]
                       : driftTier >= 2 ? [1.0, 0.55, 0.10]
                       : driftTier >= 1 ? [1.0, 0.95, 0.30]
                       : [0.85, 0.85, 0.95];
      for (let i = 0; i < 2; i++) {
        const w = wheelWorld[i];
        if (!w.grounded) continue;
        // 1..3 wisps per rear wheel per frame.
        for (let p = 0; p < 2; p++) {
          this._spawnPuff(
            w.x + (Math.random() - 0.5) * M(0.15),
            w.y + WHEEL_RADIUS * 0.6,
            w.z + (Math.random() - 0.5) * M(0.15),
            -fx * M(0.5) + (Math.random() - 0.5) * M(0.3),
            M(0.4) + Math.random() * M(0.3),
            -fz * M(0.5) + (Math.random() - 0.5) * M(0.3),
            0.30 + Math.random() * 0.20,
            M(0.30) + Math.random() * M(0.15),
            tierColor[0], tierColor[1], tierColor[2],
          );
        }
      }
    }

    // ── Boost flame trail (drift mini-turbo OR burnout release) ──
    // Spawned at the rear of the chassis, GLO-tinted (uColor uniform
    // already set from rig.gloColor). Brighter when both boost types
    // are active simultaneously.
    if (boostTimer > 0 || gloBurnoutT > 0) {
      const intensity = Math.max(boostTimer / 1.6, gloBurnoutT / 2.2);
      const flames = 3 + Math.floor(intensity * 4);
      // Anchor behind the rear bumper.
      const ax = px - fx * (CHASSIS_HZ * 1.05);
      const ay = py + CHASSIS_HY * 0.2;
      const az = pz - fz * (CHASSIS_HZ * 1.05);
      for (let p = 0; p < flames; p++) {
        const sx = (Math.random() - 0.5) * M(0.35);
        this._spawnPuff(
          ax + rx * sx,
          ay + (Math.random() - 0.5) * M(0.10),
          az + rz * sx,
          -fx * (M(2.0) + Math.random() * M(2.5)),
          (Math.random() - 0.2) * M(0.5),
          -fz * (M(2.0) + Math.random() * M(2.5)),
          0.30 + Math.random() * 0.20,
          M(0.35) + Math.random() * M(0.20) + intensity * M(0.20),
          1.0, 1.0, 1.0, // flame uses pure GLO colour from uniform
        );
      }
    }

    // ── Drift-tier-up spark burst ──────────────────────────────
    // When tier increases, fire a short burst of bright sparks at the
    // rear so the player visually "confirms" charge progression.
    if (driftTier > this._prevDriftTier) {
      const tierColor = driftTier >= 3 ? [0.30, 0.95, 1.0]
                       : driftTier >= 2 ? [1.0, 0.55, 0.10]
                       : [1.0, 0.95, 0.30];
      for (let p = 0; p < 16; p++) {
        const ang = Math.random() * Math.PI * 2;
        const r   = M(0.3) + Math.random() * M(0.3);
        this._spawnPuff(
          px - fx * (CHASSIS_HZ * 0.9) + Math.cos(ang) * r,
          py + CHASSIS_HY * 0.6 + Math.random() * M(0.3),
          pz - fz * (CHASSIS_HZ * 0.9) + Math.sin(ang) * r,
          (Math.random() - 0.5) * M(2),
          M(0.6) + Math.random() * M(0.8),
          (Math.random() - 0.5) * M(2),
          0.45,
          M(0.30) + Math.random() * M(0.20),
          tierColor[0], tierColor[1], tierColor[2],
        );
      }
    }
    this._prevDriftTier = driftTier;

    // ── Engine-explosion one-shot ────────────────────────────────
    // When engineExploded transitions false→true, fire a chunky steam
    // / smoke burst at the rear of the chassis. SP playtest does the
    // same via triggerEngineExplosion(); this is the visual mirror.
    const exploded = !!state.engineExploded;
    if (exploded && !this._prevEngineExploded) {
      const ax = px - fx * (CHASSIS_HZ * 0.9);
      const ay = py + CHASSIS_HY * 0.8;
      const az = pz - fz * (CHASSIS_HZ * 0.9);
      for (let p = 0; p < 36; p++) {
        const ang = Math.random() * Math.PI * 2;
        const r = M(0.4) + Math.random() * M(0.6);
        this._spawnPuff(
          ax + Math.cos(ang) * r,
          ay + (Math.random() - 0.2) * M(0.4),
          az + Math.sin(ang) * r,
          Math.cos(ang) * (M(2) + Math.random() * M(3)),
          M(2) + Math.random() * M(3),
          Math.sin(ang) * (M(2) + Math.random() * M(3)),
          0.85 + Math.random() * 0.4,
          M(0.55) + Math.random() * M(0.35),
          0.85, 0.85, 0.90,
        );
      }
      // Brighter GLO core puffs interleaved.
      for (let p = 0; p < 24; p++) {
        const ang = Math.random() * Math.PI * 2;
        this._spawnPuff(
          ax + Math.cos(ang) * M(0.3),
          ay + Math.random() * M(0.5),
          az + Math.sin(ang) * M(0.3),
          Math.cos(ang) * M(2.5),
          M(1.5) + Math.random() * M(2),
          Math.sin(ang) * M(2.5),
          0.7 + Math.random() * 0.3,
          M(0.40) + Math.random() * M(0.25),
          1.0, 1.0, 1.0, // GLO-tinted via uColor
        );
      }
    }
    // While exploded, continue venting steam from the engine bay so the
    // lockout reads as "smoking wreck" rather than just dead controls.
    if (exploded) {
      const ax = px - fx * (CHASSIS_HZ * 0.7);
      const ay = py + CHASSIS_HY * 0.6;
      const az = pz - fz * (CHASSIS_HZ * 0.7);
      const puffs = 2;
      for (let p = 0; p < puffs; p++) {
        this._spawnPuff(
          ax + (Math.random() - 0.5) * M(0.4),
          ay + Math.random() * M(0.2),
          az + (Math.random() - 0.5) * M(0.4),
          (Math.random() - 0.5) * M(0.6),
          M(1.2) + Math.random() * M(0.6),
          (Math.random() - 0.5) * M(0.6),
          0.55 + Math.random() * 0.2,
          M(0.40) + Math.random() * M(0.15),
          0.78, 0.80, 0.85,
        );
      }
    }
    this._prevEngineExploded = exploded;

    // ── Exhaust emitter ────────────────────────────────────────
    // Per-frame puffs from a metre behind the chassis at half-height,
    // hue ramps grey→orange with throttle. Mirrors SP spawnExhaustPuff.
    const throttle = Math.max(0, +state.throttleIn || 0);
    const speedRatio = Math.min(1, speed / M(52));
    if (!exploded) {
      // Ignition pop on throttle press edge.
      if (throttle > 0.5 && this._prevThrottle <= 0.5) {
        const ax = px - fx * M(1.1);
        const ay = py + CHASSIS_HY * 0.5;
        const az = pz - fz * M(1.1);
        for (let b = 0; b < 8; b++) {
          this._spawnPuff(
            ax + (Math.random() - 0.5) * M(0.25),
            ay + (Math.random() - 0.5) * M(0.15),
            az + (Math.random() - 0.5) * M(0.25),
            -fx * (M(2) + Math.random() * M(2)) + (Math.random() - 0.5) * M(0.6),
            M(0.6) + Math.random() * M(0.5),
            -fz * (M(2) + Math.random() * M(2)) + (Math.random() - 0.5) * M(0.6),
            0.55 + Math.random() * 0.20,
            M(0.32) + Math.random() * M(0.18),
            // hot orange ignition
            0.95, 0.55 + Math.random() * 0.20, 0.20,
          );
        }
      }
      // Continuous baseline puff: 1–3 per frame depending on throttle.
      const baseline = Math.max(1, Math.floor(0.5 + throttle * 2.2));
      for (let p = 0; p < baseline; p++) {
        const ax = px - fx * M(1.1);
        const ay = py + CHASSIS_HY * 0.5;
        const az = pz - fz * M(1.1);
        const intensity = throttle * 0.85 + 0.1;
        const back = M(1.5) + speedRatio * M(2.0);
        // Hot puffs orange-tinted on hard throttle, cool grey at idle.
        const hot = intensity;
        this._spawnPuff(
          ax + (Math.random() - 0.5) * M(0.20),
          ay + (Math.random() - 0.5) * M(0.10),
          az + (Math.random() - 0.5) * M(0.20),
          -fx * back + (Math.random() - 0.5) * M(0.4),
          M(0.6) + Math.random() * M(0.4),
          -fz * back + (Math.random() - 0.5) * M(0.4),
          0.45 + Math.random() * 0.20,
          M(0.28) + Math.random() * M(0.14),
          0.50 + hot * 0.45,         // R warms with throttle
          0.50 + hot * 0.10,         // G mostly flat
          0.55 - hot * 0.30,         // B cools out with throttle
        );
      }
    }
    this._prevThrottle = throttle;

    // ── GLO stationary stamps during burnout charge ─────────────
    // SP emits an additive GLO-tinted footprint under each rear wheel
    // every ~80ms while charging so the ground reads as a growing pool
    // of heat. Implemented here as a strong, low-velocity GLO puff at
    // each rear contact patch on a fixed cadence.
    if (charging) {
      const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      for (let i = 0; i < 2; i++) {
        if (!wheelWorld[i].grounded) continue;
        if (nowMs < this._gloStampNextAt[i]) continue;
        this._gloStampNextAt[i] = nowMs + 80;
        const w = wheelWorld[i];
        // 3 stacked GLO puffs per stamp for density.
        for (let p = 0; p < 3; p++) {
          this._spawnPuff(
            w.x + (Math.random() - 0.5) * M(0.10),
            w.y + M(0.04) + Math.random() * M(0.04),
            w.z + (Math.random() - 0.5) * M(0.10),
            (Math.random() - 0.5) * M(0.15),
            (Math.random() - 0.3) * M(0.15),
            (Math.random() - 0.5) * M(0.15),
            0.55 + Math.random() * 0.20,
            M(0.40) + Math.random() * M(0.20),
            1.0, 1.0, 1.0, // GLO-tinted from uColor
          );
        }
      }
    }

    // ── Particle integration: advance lives & positions ──────
    const lifeAttr = this._puffGeo.attributes.aLife;
    const posAttr  = this._puffGeo.attributes.position;
    let lifeDirty = false, posDirty = false;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this._pLife[i] <= 0) continue;
      const lifeMax = this._pLifeMax[i] || 1;
      this._pLife[i] = Math.max(0, this._pLife[i] - dt / lifeMax);
      lifeDirty = true;
      const i3 = i * 3;
      this._pPos[i3 + 0] += this._pVel[i3 + 0] * dt;
      this._pPos[i3 + 1] += this._pVel[i3 + 1] * dt;
      this._pPos[i3 + 2] += this._pVel[i3 + 2] * dt;
      // Gentle gravity pulldown so flames/sparks arc instead of
      // floating forever (fits the speed range; SCALE is mm/s²).
      this._pVel[i3 + 1] -= M(2.0) * dt;
      // Air drag so puffs slow down quickly — reads as smoke settling.
      const drag = Math.exp(-1.4 * dt);
      this._pVel[i3 + 0] *= drag;
      this._pVel[i3 + 2] *= drag;
      posDirty = true;
    }
    if (lifeDirty) lifeAttr.needsUpdate = true;
    if (posDirty)  posAttr.needsUpdate = true;
  }

  dispose() {
    if (this._skidMesh) {
      this.scene.remove(this._skidMesh);
      this._skidGeo.dispose();
    }
    if (this._puffMesh) {
      this.scene.remove(this._puffMesh);
      this._puffGeo.dispose();
      this._puffMat.dispose();
    }
  }
}

// ── Standalone pickup-collect burst ─────────────────────────────────
// Used by the multiplayer client when a pickup transitions
// active→inactive (some kart grabbed it). Spawns a transient
// THREE.Points cloud at the pickup's location that auto-disposes after
// `lifeS` seconds. Lives outside of any KartFxRig so kart-removed-mid-
// burst doesn't take the burst with it.
const _PICKUP_BURST_PARTICLES = 32;
export function spawnPickupBurst({ scene, position, color = 0xffd166, lifeS = 0.6 }) {
  if (!scene || !position) return;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(_PICKUP_BURST_PARTICLES * 3);
  const sizes = new Float32Array(_PICKUP_BURST_PARTICLES);
  const lives = new Float32Array(_PICKUP_BURST_PARTICLES);
  const tints = new Float32Array(_PICKUP_BURST_PARTICLES * 3);
  const vels = new Float32Array(_PICKUP_BURST_PARTICLES * 3);
  for (let i = 0; i < _PICKUP_BURST_PARTICLES; i++) {
    const i3 = i * 3;
    positions[i3 + 0] = position.x;
    positions[i3 + 1] = position.y;
    positions[i3 + 2] = position.z;
    const ang = Math.random() * Math.PI * 2;
    const upBias = 0.4 + Math.random() * 0.6;
    const speed = M(3) + Math.random() * M(3);
    vels[i3 + 0] = Math.cos(ang) * speed;
    vels[i3 + 1] = upBias * speed;
    vels[i3 + 2] = Math.sin(ang) * speed;
    lives[i] = 1;
    sizes[i] = M(0.30) + Math.random() * M(0.15);
    tints[i3 + 0] = 1; tints[i3 + 1] = 1; tints[i3 + 2] = 1;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
  const mat = makePuffMaterial(color);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  let elapsed = 0;
  const pa = geo.attributes.position;
  const la = geo.attributes.aLife;
  // Hand back a per-frame update + auto-dispose closure so the caller
  // can drive lifecycle from its existing render loop.
  return function updatePickupBurst(dt) {
    elapsed += dt;
    for (let i = 0; i < _PICKUP_BURST_PARTICLES; i++) {
      const i3 = i * 3;
      lives[i] = Math.max(0, 1 - elapsed / lifeS);
      positions[i3 + 0] += vels[i3 + 0] * dt;
      positions[i3 + 1] += vels[i3 + 1] * dt;
      positions[i3 + 2] += vels[i3 + 2] * dt;
      vels[i3 + 1] -= M(2.0) * dt;
      const drag = Math.exp(-1.4 * dt);
      vels[i3 + 0] *= drag;
      vels[i3 + 2] *= drag;
    }
    pa.needsUpdate = true;
    la.needsUpdate = true;
    if (elapsed >= lifeS) {
      scene.remove(points);
      geo.dispose();
      mat.dispose();
      return true; // signal caller to stop calling
    }
    return false;
  };
}
