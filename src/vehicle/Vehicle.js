// 6-DOF rigid-body raycast vehicle. No physics engine.
//
// Per fixed step (1/120 s):
//   1. Ray-cast each wheel along chassis-down against the analytic height field, spring + damper +
//      bump stop + anti-roll bar -> load, applied along the ground normal at the contact point.
//   2. Force-level tyre forces: drive / engine braking / rolling resistance and, above walking pace,
//      a peaked slip-angle curve; combined through a friction ellipse.
//   3. Aero, gravity, chassis-ground penalty contacts, assist yaw damping. Integrate velocities.
//   4. Velocity-level friction constraints (sequential impulses): brakes, hill hold, locked wheels
//      and low-speed lateral grip, each bounded by what is left of mu*N.
//   5. Integrate the pose, resolve barrier / obstacle contacts, guard against NaN.

import * as THREE from 'three';
import { CONFIG, SURFACE, SURFACE_PROPS } from '../config.js';
import { clamp, saturate, smoothstep, lerp, DEG2RAD } from '../core/math.js';
import { resolveTuning } from './tuning.js';
import { Drivetrain } from './Drivetrain.js';
import { lateralCurve } from './Tire.js';

const GRAVITY = 9.81;
const FIXED_DT = CONFIG.physics.fixedDt;
const MAX_SUB_STEPS = CONFIG.physics.maxSubSteps;
const SOLVER_ITERATIONS = 10;

// Scratch objects (module scope: the step never allocates).
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _rxa = new THREE.Vector3();
const _iw = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _sample = { y: 0, nx: 0, ny: 1, nz: 0, surface: 0, grip: 1, rolling: 0.012, roughness: 0, roadId: -1 };
const _hit = { hit: false, nx: 0, nz: 0, depth: 0 };

function makeSample() {
  return { y: 0, nx: 0, ny: 1, nz: 0, surface: SURFACE.ASPHALT, grip: 1, rolling: 0.012, roughness: 0, roadId: -1 };
}

function finiteVec(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export class Vehicle {
  constructor(options = {}) {
    this.world = options.world || null;
    this.assists = { driftAssist: 0.6, abs: true, transmission: 'auto' };

    // Rigid body (position is the centre of mass).
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.angularVelocity = new THREE.Vector3();
    this.force = new THREE.Vector3();
    this.torque = new THREE.Vector3();
    this.invInertia = new THREE.Matrix3();
    this.invInertiaLocal = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
    this.up = new THREE.Vector3(0, 1, 0);
    this.forward = new THREE.Vector3(0, 0, -1);
    this.comLocal = new THREE.Vector3();

    // Render interpolation and recovery.
    this.prevOrigin = new THREE.Vector3();
    this.currOrigin = new THREE.Vector3();
    this.prevQuat = new THREE.Quaternion();
    this.goodPosition = new THREE.Vector3();
    this.goodQuaternion = new THREE.Quaternion();
    this.prevVelocity = new THREE.Vector3();
    this.accumulator = 0;

    // Driver-facing dynamic state.
    this.steerInput = 0;
    this.steerAngle = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.boosting = false;
    this.reverseTimer = 0;
    this.brakeLatch = false;
    this.airTime = 0;
    this.wasAirborne = false;
    this.gLong = 0;
    this.gLat = 0;
    this.frameImpact = 0;
    this.frameLanding = 0;
    this.frameScrape = 0;
    this.frameContact = { x: 0, y: 0, z: 0, nx: 0, nz: 0, strength: -1 };
    this.frameShifted = false;
    this.pendingShift = 0;
    this.hillHold = false;
    this.steps = 0;

    this.wheels = [];
    this.wheelLayout = [];
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      const left = i % 2 === 0;
      this.wheels.push({
        index: i, front, left, driven: !front,
        mount: new THREE.Vector3(),
        k: 0, bump: 0, rebound: 0, freeLength: 0,
        sample: makeSample(),
        contact: false, length: 0, rawLength: 0, compression: 0, travel: 0,
        point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0),
        r: new THREE.Vector3(), rLat: new THREE.Vector3(),
        fwd: new THREE.Vector3(), axle: new THREE.Vector3(),
        load: 0, mu: 1, muN: 0, vLong: 0, vLat: 0, blend: 0,
        fx: 0, fy: 0, locked: false,
        boundX: 0, boundY: 0, bound: 0, meffX: 0, meffY: 0, accX: 0, accY: 0,
        steer: 0, spinAngle: 0, spinSpeed: 0, slip: 0,
        state: {
          contact: false, compression: 0, steerAngle: 0, spinAngle: 0, spinSpeed: 0, slip: 0, load: 0,
          surface: SURFACE.ASPHALT, contactPoint: { x: 0, y: 0, z: 0 }, contactNormal: { x: 0, y: 1, z: 0 },
        },
      });
      this.wheelLayout.push({ x: 0, y: 0, z: 0 });
    }
    this.bodyPoints = [];

    this.state = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, -1),
      right: new THREE.Vector3(1, 0, 0),
      up: new THREE.Vector3(0, 1, 0),
      speed: 0, speedKmh: 0, forwardSpeed: 0, lateralSpeed: 0, slipAngle: 0, yawRate: 0,
      steerAngle: 0, throttle: 0, brake: 0, handbrake: false, boosting: false,
      rpm: 0, rpmMax: 7200, gear: 1, shifted: false,
      wheelsOnGround: 0, airborne: false, surface: SURFACE.ASPHALT,
      gLong: 0, gLat: 0, impact: 0, landing: 0, scrape: 0, upsideDown: false,
      impactPoint: { x: 0, y: 0, z: 0 }, impactNormal: { x: 0, z: 0 },
      wheels: this.wheels.map((w) => w.state),
    };

    this.drivetrain = null;
    this.setHandling(options.handling || 'Balanced');
    if (options.assists) this.setAssists(options.assists);
    this.teleport(options.spawn || { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  }

  // ---------------------------------------------------------------- configuration

  setHandling(name, overrides = null) {
    const t = resolveTuning(name, overrides);
    this.handlingName = name;
    this.tuning = t;
    const g = t.geometry;
    const s = t.suspension;
    this.mass = t.mass;
    this.invMass = 1 / t.mass;
    this.comLocal.set(t.com.x, t.com.y, t.com.z);

    const box = t.inertiaBox;
    const m = t.mass;
    const ix = (m / 12) * (box.height * box.height + box.length * box.length) * t.inertiaScale.x;
    const iy = (m / 12) * (box.width * box.width + box.length * box.length) * t.inertiaScale.y;
    const iz = (m / 12) * (box.width * box.width + box.height * box.height) * t.inertiaScale.z;
    this.inertiaY = iy;
    this.invInertiaLocal.set(1 / ix, 1 / iy, 1 / iz);

    const wheelbase = g.rearAxleZ - g.frontAxleZ;
    const frontFraction = (g.rearAxleZ - t.com.z) / wheelbase;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const x = w.left ? -g.halfTrack : g.halfTrack;
      const z = w.front ? g.frontAxleZ : g.rearAxleZ;
      w.mount.set(x, g.wheelCenterY + s.staticLength, z);
      w.k = w.front ? s.springFront : s.springRear;
      w.bump = w.front ? s.bumpFront : s.bumpRear;
      w.rebound = w.front ? s.reboundFront : s.reboundRear;
      const staticLoad = (m * GRAVITY * (w.front ? frontFraction : 1 - frontFraction)) / 2;
      w.freeLength = s.staticLength + staticLoad / w.k;
      const layout = this.wheelLayout[w.index];
      layout.x = x;
      layout.y = g.wheelCenterY;
      layout.z = z;
    }
    this.bodyPoints = t.body.contactPoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
    this.collisionSpheres = t.body.collisionSpheres.map((p) => ({ local: new THREE.Vector3(p[0], p[1], p[2]), radius: p[3] }));
    if (this.drivetrain) this.drivetrain.configure(t);
    else this.drivetrain = new Drivetrain(t);
    this.state.rpmMax = t.drivetrain.redlineRpm;
  }

  setAssists(assists = {}) {
    if (assists.driftAssist !== undefined) this.assists.driftAssist = saturate(num(assists.driftAssist, 0.6));
    if (assists.abs !== undefined) this.assists.abs = Boolean(assists.abs);
    if (assists.transmission !== undefined) this.assists.transmission = assists.transmission === 'manual' ? 'manual' : 'auto';
  }

  // ---------------------------------------------------------------- pose helpers

  _updateFrame() {
    const q = this.quaternion;
    this.right.set(1, 0, 0).applyQuaternion(q);
    this.up.set(0, 1, 0).applyQuaternion(q);
    this.forward.set(0, 0, -1).applyQuaternion(q);
    // I_world^-1 = R diag(1/I) R^T, columns of R are right, up, back(-forward).
    const r = this.right;
    const u = this.up;
    const bx = -this.forward.x;
    const by = -this.forward.y;
    const bz = -this.forward.z;
    const ix = this.invInertiaLocal.x;
    const iy = this.invInertiaLocal.y;
    const iz = this.invInertiaLocal.z;
    this.invInertia.set(
      ix * r.x * r.x + iy * u.x * u.x + iz * bx * bx,
      ix * r.x * r.y + iy * u.x * u.y + iz * bx * by,
      ix * r.x * r.z + iy * u.x * u.z + iz * bx * bz,
      ix * r.y * r.x + iy * u.y * u.x + iz * by * bx,
      ix * r.y * r.y + iy * u.y * u.y + iz * by * by,
      ix * r.y * r.z + iy * u.y * u.z + iz * by * bz,
      ix * r.z * r.x + iy * u.z * u.x + iz * bz * bx,
      ix * r.z * r.y + iy * u.z * u.y + iz * bz * by,
      ix * r.z * r.z + iy * u.z * u.z + iz * bz * bz,
    );
  }

  /** World position of a chassis-space point (relative to the chassis origin). */
  _toWorld(local, out) {
    return out.copy(local).sub(this.comLocal).applyQuaternion(this.quaternion).add(this.position);
  }

  _originOf(position, quaternion, out) {
    return out.copy(this.comLocal).applyQuaternion(quaternion).negate().add(position);
  }

  _pointVelocity(r, out) {
    return out.crossVectors(this.angularVelocity, r).add(this.velocity);
  }

  _addForceAt(fx, fy, fz, r) {
    this.force.x += fx;
    this.force.y += fy;
    this.force.z += fz;
    this.torque.x += r.y * fz - r.z * fy;
    this.torque.y += r.z * fx - r.x * fz;
    this.torque.z += r.x * fy - r.y * fx;
  }

  _applyImpulse(jx, jy, jz, r) {
    this.velocity.x += jx * this.invMass;
    this.velocity.y += jy * this.invMass;
    this.velocity.z += jz * this.invMass;
    _iw.set(r.y * jz - r.z * jy, r.z * jx - r.x * jz, r.x * jy - r.y * jx).applyMatrix3(this.invInertia);
    this.angularVelocity.add(_iw);
  }

  _effectiveMass(r, axis) {
    _rxa.crossVectors(r, axis);
    _iw.copy(_rxa).applyMatrix3(this.invInertia);
    const k = this.invMass + _rxa.dot(_iw);
    return k > 1e-9 ? 1 / k : 0;
  }

  _sampleGround(x, z, out) {
    const w = this.world;
    if (w && typeof w.sampleGround === 'function') {
      w.sampleGround(x, z, out);
      if (!Number.isFinite(out.y)) out.y = -1e9;
      const len = Math.hypot(out.nx, out.ny, out.nz);
      if (!(len > 1e-6) || !Number.isFinite(len)) {
        out.nx = 0; out.ny = 1; out.nz = 0;
      } else {
        out.nx /= len; out.ny /= len; out.nz /= len;
      }
      if (!Number.isFinite(out.grip)) out.grip = 1;
      if (!Number.isFinite(out.rolling)) out.rolling = 0.012;
      return out;
    }
    out.y = 0; out.nx = 0; out.ny = 1; out.nz = 0;
    out.surface = SURFACE.ASPHALT; out.grip = 1; out.rolling = 0.012; out.roughness = 0; out.roadId = -1;
    return out;
  }

  // ---------------------------------------------------------------- public API

  teleport(spawn) {
    const p = spawn?.position || { x: 0, y: 0, z: 0 };
    const q = spawn?.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    this.quaternion.set(num(q.x), num(q.y), num(q.z), num(q.w, 1));
    if (this.quaternion.lengthSq() < 1e-8) this.quaternion.set(0, 0, 0, 1);
    this.quaternion.normalize();
    // Tilt (keeping heading) so chassis-up matches the ground normal under the car.
    const px = num(p.x);
    const pz = num(p.z);
    if (this.world && typeof this.world.sampleGround === 'function') {
      this._sampleGround(px, pz, _sample);
      _b.set(0, 1, 0).applyQuaternion(this.quaternion);
      _c.set(_sample.nx, _sample.ny, _sample.nz);
      if (_c.y > 0.3 && _b.y > 0.3) {
        _q.setFromUnitVectors(_b, _c);
        this.quaternion.premultiply(_q).normalize();
      }
    }
    // Chassis origin on the spawn point, centre of mass above it.
    this.position.copy(this.comLocal).applyQuaternion(this.quaternion).add(_a.set(px, num(p.y), pz));
    this._resetMotion();
    this.drivetrain.reset();
    this.steerInput = 0;
    this.steerAngle = 0;
    this.reverseTimer = 0;
    this.brakeLatch = false;
    this.airTime = 0;
    this.wasAirborne = false;
    this.accumulator = 0;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      w.accX = 0; w.accY = 0; w.spinAngle = 0; w.spinSpeed = 0; w.slip = 0;
    }
    // Settle on the springs (hill hold keeps it in place), then drop all motion again.
    const neutral = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 };
    for (let i = 0; i < 360; i++) {
      this._fixedStep(FIXED_DT, neutral);
      if (i > 30 && this.velocity.lengthSq() < 1e-8 && this.angularVelocity.lengthSq() < 1e-8) break;
    }
    this._resetMotion();
    this.accumulator = 0;
    this._writeState(0);
    return this.state;
  }

  _resetMotion() {
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.prevVelocity.set(0, 0, 0);
    this.gLong = 0;
    this.gLat = 0;
    this._updateFrame();
    this._originOf(this.position, this.quaternion, this.currOrigin);
    this.prevOrigin.copy(this.currOrigin);
    this.prevQuat.copy(this.quaternion);
    this.goodPosition.copy(this.position);
    this.goodQuaternion.copy(this.quaternion);
  }

  step(frameDt, controls = {}) {
    const dt = clamp(num(frameDt), 0, 0.25);
    this.accumulator += dt;
    this.frameImpact = 0;
    this.frameLanding = 0;
    this.frameScrape = 0;
    this.frameContact.strength = -1;
    this.frameShifted = false;
    this.pendingShift = Math.sign(num(controls?.shift));
    let n = 0;
    while (this.accumulator >= FIXED_DT && n < MAX_SUB_STEPS) {
      this.prevOrigin.copy(this.currOrigin);
      this.prevQuat.copy(this.quaternion);
      this._fixedStep(FIXED_DT, controls || {});
      this._originOf(this.position, this.quaternion, this.currOrigin);
      this.accumulator -= FIXED_DT;
      n++;
    }
    if (this.accumulator >= FIXED_DT) this.accumulator -= Math.floor(this.accumulator / FIXED_DT) * FIXED_DT;
    this._writeState(this.accumulator / FIXED_DT);
    return this.state;
  }

  getState() {
    return this.state;
  }

  // ---------------------------------------------------------------- the fixed step

  _fixedStep(dt, controls) {
    const t = this.tuning;
    this.steps++;
    this._updateFrame();

    const throttleIn = saturate(num(controls.throttle));
    const brakeIn = saturate(num(controls.brake));
    const steerIn = clamp(num(controls.steer), -1, 1);
    const handbrake = Boolean(controls.handbrake);
    const boost = Boolean(controls.boost);
    const shiftReq = this.pendingShift;
    this.pendingShift = 0;

    const vel = this.velocity;
    const fwdSpeed = vel.dot(this.forward);
    const latSpeed = vel.dot(this.right);
    const speed = vel.length();

    // ---- gear selection / pedals
    const dtr = this.drivetrain;
    const b = t.brakes;
    if (brakeIn > 0.1 && fwdSpeed > 1.0) this.brakeLatch = true;
    if (brakeIn < 0.05) this.brakeLatch = false;
    if (dtr.gear >= 0) {
      if (brakeIn > 0.1 && throttleIn < 0.1 && fwdSpeed < b.reverseSpeed && !this.brakeLatch) {
        this.reverseTimer += dt;
        if (this.reverseTimer >= b.reverseDelay) { dtr.setGear(-1); this.reverseTimer = 0; }
      } else this.reverseTimer = 0;
    } else {
      if (throttleIn > 0.1 && brakeIn < 0.1 && fwdSpeed > -b.reverseSpeed) {
        this.reverseTimer += dt;
        if (this.reverseTimer >= b.reverseDelay * 0.5) { dtr.setGear(1); this.reverseTimer = 0; }
      } else this.reverseTimer = 0;
    }
    const reverse = dtr.gear === -1;
    const drive = reverse ? brakeIn : throttleIn;
    const brakePedal = reverse ? throttleIn : brakeIn;
    this.throttle = drive;
    this.brake = brakePedal;
    this.handbrake = handbrake;
    this.hillHold = speed < b.hillHoldSpeed && drive < 0.02 && brakePedal < 0.02 && !handbrake;

    // ---- steering
    const st = t.steering;
    const target = steerIn;
    const growing = Math.abs(target) > Math.abs(this.steerInput) && Math.sign(target) === Math.sign(this.steerInput || target);
    const rate = (growing ? st.rate : st.returnRate) * dt;
    this.steerInput += clamp(target - this.steerInput, -rate, rate);
    const absFwd = Math.abs(fwdSpeed);
    const mech = st.mechanicalLockDeg * DEG2RAD;
    let lock = Math.max(st.minLockDeg, st.maxLockDeg / (1 + absFwd / st.lockSpeedRef)) * DEG2RAD;
    // Direction of travel of the front axle, relative to the chassis (+ = to the right).
    let frontTravel = 0;
    if (fwdSpeed > 2) {
      _a.copy(this.forward).multiplyScalar(-t.geometry.frontAxleZ + t.com.z); // front axle offset from CoM
      _b.crossVectors(this.angularVelocity, _a).add(vel);
      frontTravel = Math.atan2(_b.dot(this.right), Math.max(0.5, _b.dot(this.forward)));
    }
    // The speed-sensitive lock is measured from the direction of travel when steering into a slide,
    // so a full countersteer can always point the wheels past the travel direction (as a real rack can).
    if (this.steerInput * frontTravel > 0) lock = Math.min(mech, lock + Math.abs(frontTravel) * st.countersteerRange);
    let steer = this.steerInput * lock;

    // Drift assist: blend the front wheels toward the front axle's direction of travel.
    const as = t.assist;
    const assist = Math.max(this.assists.driftAssist, as.assistFloor);
    const bodySlip = speed > 1.5 ? Math.atan2(latSpeed, Math.abs(fwdSpeed)) : 0;
    const slipFactor = smoothstep(as.slipStartDeg * DEG2RAD, as.slipFullDeg * DEG2RAD, Math.abs(bodySlip)) * smoothstep(as.minSpeed * 0.6, as.minSpeed, speed);
    const assistAmount = assist * slipFactor;
    if (assistAmount > 0 && fwdSpeed > 2) {
      const assisted = frontTravel + this.steerInput * Math.min(lock, st.maxLockDeg * DEG2RAD) * as.driverAuthority;
      steer = lerp(steer, assisted, assistAmount * as.steerBlend);
    }
    this.steerAngle = clamp(steer, -mech, mech);

    // ---- forces
    this.force.set(0, -this.mass * GRAVITY, 0);
    this.torque.set(0, 0, 0);

    const s = t.suspension;
    const radius = t.geometry.wheelRadius;
    const minLen = s.staticLength - s.travel;
    const maxLen = s.staticLength + s.travel;
    let contacts = 0;
    const dx = -this.up.x;
    const dy = -this.up.y;
    const dz = -this.up.z;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const M = this._toWorld(w.mount, _a);
      w.contact = false;
      w.load = 0;
      if (dy < -0.25) {
        let tRay = 0;
        const sample = w.sample;
        for (let it = 0; it < 4; it++) {
          this._sampleGround(M.x + tRay * dx, M.z + tRay * dz, sample);
          tRay = (M.y - sample.y) / -dy;
        }
        const rawLength = tRay - radius;
        if (rawLength <= maxLen && rawLength > -2) {
          w.contact = true;
          w.rawLength = rawLength;
          w.length = clamp(rawLength, minLen, maxLen);
          w.point.set(M.x + tRay * dx, M.y + tRay * dy, M.z + tRay * dz);
          w.normal.set(sample.nx, sample.ny, sample.nz);
          w.r.subVectors(w.point, this.position);
          contacts++;
        }
      }
      if (!w.contact) {
        w.length = maxLen;
        w.rawLength = maxLen;
      }
      w.compression = s.staticLength - w.length;
      w.travel = maxLen - w.length;
    }

    // Spring, damper, bump stop.
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (!w.contact) continue;
      const n = w.normal;
      const cosA = -(n.x * dx + n.y * dy + n.z * dz);
      const invCos = cosA > 1 / s.maxInvCos ? 1 / cosA : s.maxInvCos;
      const spring = w.k * (w.freeLength - w.length) * invCos;
      const vn = this._pointVelocity(w.r, _b).dot(n);
      const damper = -vn * (vn < 0 ? w.bump : w.rebound);
      let bumpStop = 0;
      const bumpStart = minLen + s.bumpStopLength;
      if (w.rawLength < bumpStart) {
        const pen = bumpStart - w.rawLength;
        bumpStop = s.bumpStopStiffness * pen * (1 + pen / s.bumpStopLength) - vn * s.bumpStopDamping * Math.min(1, pen / s.bumpStopLength);
      }
      w.load = spring + damper + Math.max(0, bumpStop);
    }
    // Anti-roll bars.
    for (let axle = 0; axle < 2; axle++) {
      const l = this.wheels[axle * 2];
      const r = this.wheels[axle * 2 + 1];
      const k = axle === 0 ? s.antiRollFront : s.antiRollRear;
      const diff = (l.contact ? l.compression : -s.travel) - (r.contact ? r.compression : -s.travel);
      const f = k * diff;
      if (l.contact) l.load += f;
      if (r.contact) r.load -= f;
    }
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (!w.contact) continue;
      w.load = clamp(w.load, 0, s.maxForce);
      const n = w.normal;
      this._addForceAt(n.x * w.load, n.y * w.load, n.z * w.load, w.r);
    }

    // ---- drivetrain
    let wheelOmega = 0;
    {
      const rl = this.wheels[2];
      const rr = this.wheels[3];
      let sum = 0;
      let cnt = 0;
      if (rl.contact) { sum += this._pointVelocity(rl.r, _b).dot(this.forward); cnt++; }
      if (rr.contact) { sum += this._pointVelocity(rr.r, _b).dot(this.forward); cnt++; }
      wheelOmega = (cnt > 0 ? sum / cnt : fwdSpeed) / radius;
    }
    const boostMult = boost && drive > 0 ? CONFIG.nitro.forceMultiplier : 1;
    this.boosting = boost && drive > 0 && dtr.gear !== 0;
    const auto = this.assists.transmission !== 'manual';
    const driveForce = dtr.update(dt, wheelOmega, drive, auto, auto ? 0 : shiftReq, boostMult);
    if (dtr.shifted) this.frameShifted = true;
    const drivenInContact = (this.wheels[2].contact ? 1 : 0) + (this.wheels[3].contact ? 1 : 0);

    // ---- tyres, force level
    const tire = t.tire;
    const peakSlip = tire.peakSlipDeg * DEG2RAD;
    const roll = tire.rollInfluence;
    const abs = this.assists.abs;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      w.fx = 0; w.fy = 0; w.boundX = 0; w.boundY = 0; w.bound = 0;
      w.locked = false;
      w.steer = w.front ? this.steerAngle : 0;
      if (!w.contact) { w.accX = 0; w.accY = 0; w.slip = 0; continue; }
      const n = w.normal;
      // Rolling axis: steered wheel-right projected on the ground plane; forward = n x axle.
      const cs = Math.cos(w.steer);
      const sn = Math.sin(w.steer);
      w.axle.copy(this.right).multiplyScalar(cs).addScaledVector(this.forward, -sn);
      w.axle.addScaledVector(n, -w.axle.dot(n));
      if (w.axle.lengthSq() < 1e-6) w.axle.copy(this.right);
      w.axle.normalize();
      w.fwd.crossVectors(n, w.axle).normalize();
      // Lateral force acts between contact height and CoM height.
      const h = w.r.dot(this.up);
      w.rLat.copy(w.r).addScaledVector(this.up, -h * (1 - roll));

      const vc = this._pointVelocity(w.r, _b);
      w.vLong = vc.dot(w.fwd);
      w.vLat = this._pointVelocity(w.rLat, _c).dot(w.axle);
      w.mu = tire.mu * (w.front ? tire.frontGrip : tire.rearGrip) * clamp(w.sample.grip, 0, 2);
      w.muN = w.mu * w.load;
      w.meffX = this._effectiveMass(w.r, w.fwd);
      w.meffY = this._effectiveMass(w.rLat, w.axle);
      const contactSpeed = Math.hypot(w.vLong, w.vLat);
      w.blend = smoothstep(tire.lowSpeedBlend[0], tire.lowSpeedBlend[1], contactSpeed);

      let brakeForce = 0;
      if (brakePedal > 0) brakeForce = brakePedal * b.maxForce * (w.front ? b.frontBias : 1 - b.frontBias) * 0.5;
      w.locked = (!w.front && handbrake) || (!abs && brakeForce > w.muN * b.lockThreshold && Math.abs(w.vLong) > 1.5);

      if (w.locked) {
        w.bound = tire.lockedFriction * w.muN;
        w.boundX = Infinity;
        w.boundY = Infinity;
        w.slip = contactSpeed > 0.5 ? 1.5 : 0;
        continue;
      }

      // Longitudinal: drive / engine braking (driven wheels) + rolling resistance.
      let fx = 0;
      if (w.driven && drivenInContact > 0) fx += driveForce / drivenInContact;
      const rollingRes = w.sample.rolling * w.load;
      fx -= rollingRes * clamp(w.vLong / 0.3, -1, 1);

      // Lateral: peaked slip-angle curve above walking pace, capped by the slip-cancelling force.
      let fy = 0;
      if (w.blend > 0) {
        const alpha = Math.atan2(Math.abs(w.vLat), Math.max(Math.abs(w.vLong), 0.5));
        let mag = w.muN * lateralCurve(alpha / peakSlip, tire.slideRatio, tire.falloff);
        const cap = (w.meffY * Math.abs(w.vLat) / dt) * tire.cancelCap;
        if (mag > cap) mag = cap;
        fy = -Math.sign(w.vLat) * mag * w.blend;
      }
      // Traction control: let drive use only what lateral demand leaves (blended by the setting).
      if (tire.tractionControl > 0 && w.driven && fx > 0) {
        const room = Math.sqrt(Math.max(0, w.muN * w.muN - fy * fy));
        if (fx > room) fx = lerp(fx, room, tire.tractionControl);
      }
      // Friction ellipse.
      const demand = Math.hypot(fx, fy);
      w.slip = w.muN > 1 ? demand / w.muN : 0;
      if (demand > w.muN && demand > 1e-6) {
        const k = w.muN / demand;
        fx *= k;
        fy *= k;
      }
      w.fx = fx;
      w.fy = fy;
      this._addForceAt(w.fwd.x * fx, w.fwd.y * fx, w.fwd.z * fx, w.r);
      this._addForceAt(w.axle.x * fy, w.axle.y * fy, w.axle.z * fy, w.rLat);

      // Constraint budgets (used by the velocity solver after integration).
      const room = Math.sqrt(Math.max(0, w.muN * w.muN - fx * fx - fy * fy));
      w.bound = room;
      w.boundY = (1 - w.blend) * room;
      if (brakeForce > 0) w.boundX = abs ? Math.min(brakeForce, room * b.absRatio) : brakeForce;
      if (this.hillHold) w.boundX = Math.max(w.boundX, b.hillHoldForce);
      if (w.slip < 1 && brakeForce > 0) w.slip = Math.max(w.slip, Math.min(brakeForce, w.muN) / Math.max(1, w.muN));
    }

    // ---- aero
    const a = t.aero;
    const q = 0.5 * a.airDensity;
    if (speed > 0.01) {
      const drag = q * a.dragArea * speed;
      this.force.addScaledVector(vel, -drag);
    }
    if (contacts > 0) {
      const down = q * a.liftArea * fwdSpeed * fwdSpeed;
      const g = t.geometry;
      _a.copy(this.forward).multiplyScalar(-g.frontAxleZ + t.com.z);
      this._addForceAt(-this.up.x * down * a.downforceFront, -this.up.y * down * a.downforceFront, -this.up.z * down * a.downforceFront, _a);
      _a.copy(this.forward).multiplyScalar(-g.rearAxleZ + t.com.z);
      const dr = down * (1 - a.downforceFront);
      this._addForceAt(-this.up.x * dr, -this.up.y * dr, -this.up.z * dr, _a);
    }

    // ---- chassis-ground contact (penalty)
    const bd = t.body;
    for (let pi = 0; pi < this.bodyPoints.length; pi++) {
      const p = this.bodyPoints[pi];
      const P = this._toWorld(p, _a);
      this._sampleGround(P.x, P.z, _sample);
      const depth = (_sample.y - P.y) * _sample.ny;
      if (depth <= 0) continue;
      _d.set(_sample.nx, _sample.ny, _sample.nz);
      _e.subVectors(P, this.position);
      const vc = this._pointVelocity(_e, _b);
      const vn = vc.dot(_d);
      let fn = bd.contactStiffness * depth - bd.contactDamping * vn;
      fn = clamp(fn, 0, bd.contactMaxForce);
      if (fn <= 0) continue;
      this._addForceAt(_d.x * fn, _d.y * fn, _d.z * fn, _e);
      _c.copy(vc).addScaledVector(_d, -vn);
      const vt = _c.length();
      if (vt > 1e-4) {
        const ff = Math.min(bd.contactFriction * fn, (this.mass * 0.25 * vt) / dt * 0.5) / vt;
        this._addForceAt(-_c.x * ff, -_c.y * ff, -_c.z * ff, _e);
      }
    }

    // ---- water
    const waterLevel = this.world?.waterLevel;
    if (Number.isFinite(waterLevel) && this.position.y < waterLevel + 0.3) {
      const sub = saturate((waterLevel + 0.3 - this.position.y) / 1.0);
      this.force.addScaledVector(vel, -t.water.drag * this.mass * sub);
      this.force.y += this.mass * GRAVITY * t.water.buoyancy * sub;
      this.torque.addScaledVector(this.angularVelocity, -this.inertiaY * 2 * sub);
    }

    // ---- assist yaw damping (only while sliding)
    if (assistAmount > 0 && contacts > 0) {
      const yawRate = this.angularVelocity.dot(this.up);
      this.torque.addScaledVector(this.up, -as.yawDamping * assistAmount * this.inertiaY * yawRate);
    }

    // ---- integrate velocities (semi-implicit Euler)
    vel.addScaledVector(this.force, this.invMass * dt);
    _iw.copy(this.torque).applyMatrix3(this.invInertia);
    this.angularVelocity.addScaledVector(_iw, dt);

    // ---- friction constraints: brakes, hold, locked wheels, low-speed lateral grip
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (!w.contact || (w.boundX <= 0 && w.boundY <= 0)) { w.accX = 0; w.accY = 0; continue; }
      w.accX = 0;
      w.accY = 0;
    }
    for (let it = 0; it < SOLVER_ITERATIONS; it++) {
      for (let wi = 0; wi < 4; wi++) {
        const w = this.wheels[wi];
        if (!w.contact) continue;
        const bx = w.boundX * dt;
        const by = w.boundY * dt;
        if (bx <= 0 && by <= 0) continue;
        let nx = w.accX;
        let ny = w.accY;
        if (bx > 0) nx -= this._pointVelocity(w.r, _b).dot(w.fwd) * w.meffX;
        if (by > 0) ny -= this._pointVelocity(w.rLat, _b).dot(w.axle) * w.meffY;
        if (nx > bx) nx = bx; else if (nx < -bx) nx = -bx;
        if (ny > by) ny = by; else if (ny < -by) ny = -by;
        const total = Math.hypot(nx, ny);
        const bound = w.bound * dt;
        if (total > bound) {
          const k = total > 1e-12 ? bound / total : 0;
          nx *= k;
          ny *= k;
        }
        const jx = nx - w.accX;
        const jy = ny - w.accY;
        w.accX = nx;
        w.accY = ny;
        if (jx !== 0) this._applyImpulse(w.fwd.x * jx, w.fwd.y * jx, w.fwd.z * jx, w.r);
        if (jy !== 0) this._applyImpulse(w.axle.x * jy, w.axle.y * jy, w.axle.z * jy, w.rLat);
      }
    }

    // ---- clamp spin, integrate pose
    const maxW = t.limits.maxAngularSpeed;
    const wl = this.angularVelocity.length();
    if (wl > maxW) this.angularVelocity.multiplyScalar(maxW / wl);
    this.position.addScaledVector(vel, dt);
    {
      const qq = this.quaternion;
      const wv = this.angularVelocity;
      const h = 0.5 * dt;
      const qx = qq.x; const qy = qq.y; const qz = qq.z; const qw = qq.w;
      qq.set(
        qx + h * (wv.x * qw + wv.y * qz - wv.z * qy),
        qy + h * (wv.y * qw + wv.z * qx - wv.x * qz),
        qz + h * (wv.z * qw + wv.x * qy - wv.y * qx),
        qw + h * (-wv.x * qx - wv.y * qy - wv.z * qz),
      ).normalize();
    }
    this._updateFrame();

    // ---- barriers and obstacles
    this._collide(dt);

    // ---- wheel bookkeeping
    let onGround = 0;
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      if (w.contact) onGround++;
      if (w.locked) w.spinSpeed = 0;
      else if (w.contact) {
        let spin = w.vLong / radius;
        if (w.driven && w.slip > 1 && driveForce !== 0) spin += Math.sign(driveForce) * Math.min(60, (w.slip - 1) * 40);
        w.spinSpeed = spin;
      } else {
        w.spinSpeed *= 0.995;
      }
      w.spinAngle += w.spinSpeed * dt;
      if (w.spinAngle > 1e4 || w.spinAngle < -1e4) w.spinAngle %= Math.PI * 2;
    }
    if (onGround === 0) this.airTime += dt;
    else {
      if (this.wasAirborne) {
        let vn = 0;
        for (let wi = 0; wi < 4; wi++) { const w = this.wheels[wi]; if (w.contact) vn = Math.max(vn, -this._pointVelocity(w.r, _b).dot(w.normal)); }
        this.frameLanding = Math.max(this.frameLanding, vn, this.landingSpeed || 0);
      }
      this.airTime = 0;
    }
    this.landingSpeed = onGround === 0 ? Math.max(0, -vel.y) : 0;
    this.wasAirborne = this.airTime > 0.15;
    this.onGround = onGround;

    // ---- g-forces
    _a.subVectors(vel, this.prevVelocity).divideScalar(dt);
    const blend = 1 - Math.exp(-12 * dt);
    this.gLong += (_a.dot(this.forward) / GRAVITY - this.gLong) * blend;
    this.gLat += (_a.dot(this.right) / GRAVITY - this.gLat) * blend;
    this.prevVelocity.copy(vel);

    // ---- robustness
    if (!finiteVec(this.position) || !finiteVec(vel) || !finiteVec(this.angularVelocity)
      || !Number.isFinite(this.quaternion.x + this.quaternion.y + this.quaternion.z + this.quaternion.w)) {
      this.position.copy(this.goodPosition);
      this.quaternion.copy(this.goodQuaternion);
      vel.set(0, 0, 0);
      this.angularVelocity.set(0, 0, 0);
      this.prevVelocity.set(0, 0, 0);
      this.gLong = 0;
      this.gLat = 0;
      for (let wi = 0; wi < 4; wi++) {
        const w = this.wheels[wi]; w.accX = 0; w.accY = 0; }
      this._updateFrame();
    } else {
      this.goodPosition.copy(this.position);
      this.goodQuaternion.copy(this.quaternion);
    }
  }

  _collide() {
    const world = this.world;
    const barrier = typeof world?.collideBarrier === 'function';
    const obstacle = typeof world?.collideObstacle === 'function';
    if (!barrier && !obstacle) return;
    for (let pass = 0; pass < 2; pass++) {
      const useBarrier = pass === 0;
      if (useBarrier ? !barrier : !obstacle) continue;
      const count = this.collisionSpheres.length + (useBarrier ? 0 : 1);
      for (let i = 0; i < count; i++) {
        let radius;
        if (i < this.collisionSpheres.length) {
          const sph = this.collisionSpheres[i];
          this._toWorld(sph.local, _a);
          radius = sph.radius;
        } else {
          _a.copy(this.position);
          radius = this.tuning.body.obstacleCentreRadius;
        }
        _hit.hit = false; _hit.depth = 0; _hit.nx = 0; _hit.nz = 0;
        if (useBarrier) world.collideBarrier(_a.x, _a.y, _a.z, radius, _hit);
        else world.collideObstacle(_a.x, _a.y, _a.z, radius, _hit);
        if (!_hit.hit || !(_hit.depth > 0)) continue;
        this._resolveWallHit(_a, radius, _hit);
      }
    }
  }

  _resolveWallHit(centre, radius, hit) {
    const nl = Math.hypot(hit.nx, hit.nz);
    if (!(nl > 1e-6)) return;
    const nx = hit.nx / nl;
    const nz = hit.nz / nl;
    const depth = Math.min(hit.depth, 1.0);
    // Positional push-out.
    this.position.x += nx * depth;
    this.position.z += nz * depth;
    // Contact point at the sphere surface, relative to the CoM (after push-out).
    _e.set(centre.x + nx * depth - nx * radius, centre.y, centre.z + nz * depth - nz * radius).sub(this.position);
    _d.set(nx, 0, nz);
    const vc = this._pointVelocity(_e, _b);
    const vn = vc.dot(_d);
    if (vn >= 0) return;
    const bd = this.tuning.body;
    const mn = this._effectiveMass(_e, _d);
    const jn = -(1 + bd.restitution) * vn * mn;
    this._applyImpulse(_d.x * jn, 0, _d.z * jn, _e);
    this.frameImpact = Math.max(this.frameImpact, -vn);
    // Friction along the wall (horizontal tangent and vertical).
    const vc2 = this._pointVelocity(_e, _b);
    _c.copy(vc2).addScaledVector(_d, -vc2.dot(_d));
    const vt = _c.length();
    // Remember where the body touched (world space) for sparks, and how fast it slides along the wall for scrape audio.
    // Scrape speed: how fast the car's body travels along the wall (horizontal), steadier than the
    // contact-point velocity, which spikes with the spin an impact imparts.
    const vel = this.velocity;
    const along = Math.hypot(vel.x - nx * (vel.x * nx + vel.z * nz), vel.z - nz * (vel.x * nx + vel.z * nz));
    this.frameScrape = Math.max(this.frameScrape, along);
    const contactStrength = -vn + vt * 0.25;
    if (contactStrength > this.frameContact.strength) {
      const fc = this.frameContact;
      fc.x = this.position.x + _e.x; fc.y = this.position.y + _e.y; fc.z = this.position.z + _e.z;
      fc.nx = nx; fc.nz = nz; fc.strength = contactStrength;
    }
    if (vt > 1e-5) {
      _c.multiplyScalar(1 / vt);
      const mt = this._effectiveMass(_e, _c);
      const jt = Math.min(vt * mt, bd.wallFriction * jn);
      this._applyImpulse(-_c.x * jt, -_c.y * jt, -_c.z * jt, _e);
    }
  }

  // ---------------------------------------------------------------- output

  _writeState(alpha) {
    const s = this.state;
    s.position.lerpVectors(this.prevOrigin, this.currOrigin, alpha);
    s.quaternion.slerpQuaternions(this.prevQuat, this.quaternion, alpha);
    s.velocity.copy(this.velocity);
    s.angularVelocity.copy(this.angularVelocity);
    s.forward.copy(this.forward);
    s.right.copy(this.right);
    s.up.copy(this.up);
    const speed = this.velocity.length();
    s.speed = speed;
    s.speedKmh = speed * 3.6;
    s.forwardSpeed = this.velocity.dot(this.forward);
    s.lateralSpeed = this.velocity.dot(this.right);
    s.slipAngle = speed > 1.5 ? Math.atan2(s.lateralSpeed, Math.abs(s.forwardSpeed)) : 0;
    s.yawRate = this.angularVelocity.dot(this.up);
    s.steerAngle = this.steerAngle;
    s.throttle = this.throttle;
    s.brake = this.brake;
    s.handbrake = this.handbrake;
    s.boosting = this.boosting;
    const dtr = this.drivetrain;
    s.rpm = dtr.rpm;
    s.rpmMax = this.tuning.drivetrain.redlineRpm;
    s.gear = dtr.gear === -1 ? 'R' : dtr.gear === 0 ? 'N' : dtr.gear;
    s.shifted = this.frameShifted;
    let onGround = 0;
    const counts = this._surfaceCounts || (this._surfaceCounts = new Array(SURFACE_PROPS.length).fill(0));
    counts.fill(0);
    for (let wi = 0; wi < 4; wi++) {
      const w = this.wheels[wi];
      const ws = w.state;
      ws.contact = w.contact;
      ws.compression = w.contact ? w.compression : -this.tuning.suspension.travel;
      ws.steerAngle = w.steer;
      ws.spinAngle = w.spinAngle;
      ws.spinSpeed = w.spinSpeed;
      ws.slip = w.slip;
      ws.load = w.load;
      ws.surface = w.sample.surface;
      ws.contactPoint.x = w.point.x; ws.contactPoint.y = w.point.y; ws.contactPoint.z = w.point.z;
      ws.contactNormal.x = w.normal.x; ws.contactNormal.y = w.normal.y; ws.contactNormal.z = w.normal.z;
      if (w.contact) {
        onGround++;
        if (w.sample.surface >= 0 && w.sample.surface < counts.length) counts[w.sample.surface]++;
      }
    }
    s.wheelsOnGround = onGround;
    s.airborne = this.airTime > 0.15;
    if (onGround > 0) {
      let best = 0;
      for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;
      s.surface = best;
    }
    s.gLong = this.gLong;
    s.gLat = this.gLat;
    s.impact = this.frameImpact;
    s.landing = this.frameLanding;
    s.scrape = this.frameContact.strength >= 0 ? this.frameScrape : 0;
    if (this.frameContact.strength >= 0) {
      const fc = this.frameContact;
      s.impactPoint.x = fc.x; s.impactPoint.y = fc.y; s.impactPoint.z = fc.z;
      s.impactNormal.x = fc.nx; s.impactNormal.z = fc.nz;
    }
    s.upsideDown = this.up.y < 0;
    return s;
  }
}

export default Vehicle;
