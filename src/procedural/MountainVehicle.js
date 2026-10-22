import * as THREE from 'three';
import { Heightfield } from './Heightfield.js';
import { ProceduralCar } from './ProceduralCar.js';
import { DriftModel } from './DriftModel.js';
import { SurfaceClassifier } from './SurfaceClassifier.js';

const UP = new THREE.Vector3(0, 1, 0);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedNormal(value, fallback = UP) {
  const normal = value instanceof THREE.Vector3
    ? value.clone()
    : new THREE.Vector3(Number(value?.x) || 0, Number(value?.y) || 0, Number(value?.z) || 0);
  if (normal.lengthSq() < 0.0001 || !Number.isFinite(normal.lengthSq())) return fallback.clone();
  normal.normalize();
  if (normal.y < 0) normal.negate();
  return normal;
}

function makeOrientation(forward, up) {
  const projectedForward = forward.clone().sub(up.clone().multiplyScalar(forward.dot(up))).normalize();
  const safeForward = projectedForward.lengthSq() > 0.0001 ? projectedForward : new THREE.Vector3(0, 0, -1);
  const right = safeForward.clone().cross(up).normalize();
  const safeRight = right.lengthSq() > 0.0001 ? right : new THREE.Vector3(1, 0, 0);
  const safeUp = safeRight.clone().cross(safeForward).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(safeRight, safeUp, safeForward.clone().negate()));
}

function forwardFromYaw(yaw) {
  return new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
}

export class MountainVehicle {
  constructor(options = {}) {
    this.mountainWorld = options.world || options.mountainWorld || null;
    this.heightfield = options.heightfield || this.mountainWorld?.heightfield || new Heightfield({ seed: options.seed ?? 1337 });
    this.surfaceClassifier = options.surfaceClassifier || this.mountainWorld?.surfaceClassifier || new SurfaceClassifier({ heightfield: this.heightfield, road: this.mountainWorld?.road });
    this.fixedDt = options.fixedDt ?? 1 / 120;
    this.maxSubSteps = options.maxSubSteps ?? 12;
    this.mass = options.mass ?? 1120;
    this.gravity = options.gravity ?? 9.81;
    this.engineForce = options.engineForce ?? 7600;
    this.reverseForce = options.reverseForce ?? 3000;
    this.brakeForce = options.brakeForce ?? 11200;
    this.steeringMax = THREE.MathUtils.degToRad(options.steeringMaxDeg ?? 34);
    this.steeringResponse = options.steeringResponse ?? 7.5;
    this.steeringReturn = options.steeringReturn ?? 9;
    this.wheelbase = options.wheelbase ?? 2.55;
    this.trackWidth = options.trackWidth ?? 1.58;
    this.wheelRadius = options.wheelRadius ?? 0.34;
    this.wheelMountY = options.wheelMountY ?? 0.37;
    this.suspensionRest = options.suspensionRest ?? 0.32;
    this.suspensionTravel = options.suspensionTravel ?? 0.18;
    this.bodyRideHeight = options.bodyRideHeight ?? 0.03;
    this.suspensionStiffness = options.suspensionStiffness ?? 96;
    this.suspensionDamping = options.suspensionDamping ?? 22;
    this.lateralGrip = options.lateralGrip ?? 7.8;
    this.longitudinalGrip = options.longitudinalGrip ?? 0.45;
    this.airDrag = options.airDrag ?? 0.34;
    this.maxSpeed = options.maxSpeed ?? 58;
    this.maxYawRate = options.maxYawRate ?? 3.8;
    this.roadAssist = options.roadAssist ?? 1.6;
    this.roadHeadingGain = options.roadHeadingGain ?? 4.5;
    this.roadCenteringGain = options.roadCenteringGain ?? 3.2;
    this.cliffSlope = options.cliffSlope ?? Math.PI * 0.69;
    this.cliffDelay = options.cliffDelay ?? 0.9;
    this.fallDistance = options.fallDistance ?? 8;
    this.visual = options.visual || options.car || new ProceduralCar({ color: options.color ?? 0xd62828 });
    this.scene = options.scene || null;
    if (this.scene && this.visual.parent !== this.scene) this.scene.add(this.visual);
    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.yaw = 0;
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.surface = 'grass';
    this.surfaceSample = null;
    this.wheelContacts = [];
    this.accumulator = 0;
    this.fixedSteps = 0;
    this.cliffTimer = 0;
    this.respawnCount = 0;
    this.state = 'active';
    this.lastSafeTransform = null;
    this.groundNormal = UP.clone();
    this.checkpoint = 0;
    this.driftModel = options.driftModel || new DriftModel(options.drift || {});
    this.wheels = [
      { key: 'frontLeft', local: new THREE.Vector3(-this.trackWidth * 0.5, this.wheelMountY, -this.wheelbase * 0.5), steer: true, drive: false, compression: 0, spin: 0 },
      { key: 'frontRight', local: new THREE.Vector3(this.trackWidth * 0.5, this.wheelMountY, -this.wheelbase * 0.5), steer: true, drive: false, compression: 0, spin: 0 },
      { key: 'rearLeft', local: new THREE.Vector3(-this.trackWidth * 0.5, this.wheelMountY, this.wheelbase * 0.5), steer: false, drive: true, compression: 0, spin: 0 },
      { key: 'rearRight', local: new THREE.Vector3(this.trackWidth * 0.5, this.wheelMountY, this.wheelbase * 0.5), steer: false, drive: true, compression: 0, spin: 0 },
    ];
    const spawn = options.spawn || this.mountainWorld?.getSpawnTransform?.() || { position: new THREE.Vector3(0, 1, 0), rotation: new THREE.Quaternion() };
    this.respawn(spawn);
  }

  normalizeControls(controls = {}) {
    return {
      throttle: clamp(Number(controls.throttle ?? 0), 0, 1),
      brake: clamp(Number(controls.brake ?? 0), 0, 1),
      steer: clamp(Number(controls.steer ?? 0), -1, 1),
      handbrake: Boolean(controls.handbrake),
      driftAssist: clamp(Number(controls.driftAssist ?? 0.3), 0, 1),
    };
  }

  sampleSurface(x, z) {
    if (this.mountainWorld?.sampleSurface) return this.mountainWorld.sampleSurface(x, z);
    return this.surfaceClassifier.classify(x, z);
  }

  sampleWheels() {
    const contacts = this.wheels.map((wheel) => {
      const mount = wheel.local.clone().applyQuaternion(this.quaternion).add(this.position);
      const sample = this.sampleSurface(mount.x, mount.z);
      if (!sample || !Number.isFinite(sample.height)) {
        wheel.compression = 0;
        return { wheel, mount, sample: null, distance: Infinity, contact: false };
      }
      const normal = normalizedNormal(sample.normal, this.groundNormal);
      const surfacePoint = new THREE.Vector3(mount.x, sample.height, mount.z);
      const distance = mount.clone().sub(surfacePoint).dot(normal) - this.wheelRadius;
      const contact = !sample.cliff && sample.inside !== false && distance <= this.suspensionRest + this.suspensionTravel;
      const compression = contact ? clamp(this.suspensionRest - Math.max(0, distance), -this.suspensionTravel, this.suspensionRest) : 0;
      wheel.compression = compression;
      return { wheel, mount, sample, distance, contact };
    });
    this.wheelContacts = contacts;
    return contacts;
  }

  updateOrientation(terrainNormal = UP) {
    const forward = forwardFromYaw(this.yaw);
    this.quaternion.copy(makeOrientation(forward, normalizedNormal(terrainNormal, this.groundNormal)));
  }

  getRoadAssist(forward, input, speed) {
    const road = this.mountainWorld?.road;
    const nearest = road?.getNearestPoint?.(this.position.x, this.position.z);
    if (!nearest || !Number.isFinite(nearest.distance)) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    const roadWidth = Number(road.roadWidth) || 7.6;
    const shoulderWidth = Number(road.shoulderWidth) || 2.5;
    const recoveryLimit = roadWidth * 0.5 + shoulderWidth * 2.5;
    if (nearest.distance > recoveryLimit) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    const tangent = new THREE.Vector3(nearest.tangent.x, 0, nearest.tangent.z);
    const roadRight = new THREE.Vector3(nearest.right.x, 0, nearest.right.z);
    if (tangent.lengthSq() < 0.0001 || roadRight.lengthSq() < 0.0001) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    tangent.normalize();
    roadRight.normalize();
    const planarForward = new THREE.Vector3(forward.x, 0, forward.z).normalize();
    const headingError = Math.atan2(planarForward.x * tangent.z - planarForward.z * tangent.x, planarForward.dot(tangent));
    const assist = clamp(input.driftAssist * this.roadAssist * (this.handbrake ? 0.12 : 1), 0, 0.82);
    const speedFactor = clamp(speed / 14, 0, 1.25);
    const lateralLimit = Math.max(1, roadWidth * 0.5);
    const lateralError = clamp(nearest.signedDistance / lateralLimit, -2, 2);
    const steeringCorrection = clamp(headingError * this.roadHeadingGain - lateralError * 0.24, -1, 1);
    const steerBlend = Math.abs(input.steer) > 0.8 ? 0.35 : 1;
    const steer = clamp(input.steer + steeringCorrection * assist * steerBlend, -1, 1);
    const centerAcceleration = -clamp(nearest.signedDistance, -recoveryLimit, recoveryLimit) * this.roadCenteringGain * assist * clamp(speed / 10, 0, 1.25);
    const centerForce = roadRight.multiplyScalar(centerAcceleration * this.mass);
    const headingRate = clamp(headingError * this.roadHeadingGain * assist * speedFactor, -1.8, 1.8);
    return { steer, centerForce, headingRate };
  }

  step(realDt, controls = {}) {
    const dt = clamp(Number(realDt) || 0, 0, 0.25);
    const input = this.normalizeControls(controls);
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= this.fixedDt && steps < this.maxSubSteps) {
      this.stepFixed(this.fixedDt, input);
      this.accumulator -= this.fixedDt;
      steps += 1;
    }
    this.fixedSteps += steps;
    this.updateVisual(dt);
    return this.getSnapshot();
  }

  advance(realDt, controls = {}) {
    return this.step(realDt, controls);
  }

  stepFixed(dt, controls = {}) {
    if (this.state === 'respawning') {
      this.cliffTimer -= dt;
      if (this.cliffTimer <= 0) this.respawn();
      return this.getSnapshot();
    }
    const input = this.normalizeControls(controls);
    this.throttle = input.throttle;
    this.brake = input.brake;
    this.handbrake = input.handbrake;
    const centerSample = this.sampleSurface(this.position.x, this.position.z);
    this.updateOrientation(normalizedNormal(centerSample?.normal, this.groundNormal));
    const contacts = this.sampleWheels();
    const grounded = contacts.filter((contact) => contact.contact && contact.sample && !contact.sample.cliff && contact.sample.inside !== false);
    const averageHeight = grounded.length ? grounded.reduce((sum, contact) => sum + contact.sample.height, 0) / grounded.length : null;
    const averageNormal = grounded.length
      ? grounded.reduce((normal, contact) => normal.add(normalizedNormal(contact.sample.normal, this.groundNormal)), new THREE.Vector3()).normalize()
      : normalizedNormal(centerSample?.normal, this.groundNormal);
    this.surfaceSample = grounded[0]?.sample || centerSample || null;
    this.surface = this.surfaceSample?.surface || 'cliff';
    this.groundNormal.copy(normalizedNormal(averageNormal, this.groundNormal));
    this.updateOrientation(this.groundNormal);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const roadAssist = this.getRoadAssist(forward, input, Math.hypot(this.velocity.x, this.velocity.z));
    const longitudinal = this.velocity.dot(forward);
    const lateral = this.velocity.dot(right);
    const friction = clamp(this.surfaceSample?.friction ?? 0.35, 0.08, 1.2);
    const rollingResistance = this.surfaceSample?.rollingResistance ?? 0.12;
    const reversing = this.brake > this.throttle && longitudinal < 0.5;
    const driveForce = reversing ? -this.reverseForce * this.brake : this.engineForce * this.throttle;
    const brakeForce = !reversing && Math.abs(longitudinal) > 0.05 ? Math.sign(longitudinal) * this.brakeForce * this.brake : 0;
    const handbrakeForce = this.handbrake && Math.abs(longitudinal) > 0.05 ? Math.sign(longitudinal) * this.brakeForce * 0.18 : 0;
    const handbrakeGrip = this.handbrake ? 0.22 : 1;
    const lateralForce = -lateral * this.lateralGrip * friction * handbrakeGrip * this.mass;
    const dragForce = -longitudinal * Math.abs(longitudinal) * this.airDrag;
    const rollingForce = -longitudinal * rollingResistance * this.mass * this.gravity;
    const gravityForce = new THREE.Vector3(0, -this.gravity * this.mass, 0);
    const slopeGravity = grounded.length
      ? gravityForce.clone().sub(this.groundNormal.clone().multiplyScalar(gravityForce.dot(this.groundNormal)))
      : gravityForce;
    const force = forward.clone().multiplyScalar(driveForce - brakeForce - handbrakeForce + dragForce + rollingForce).add(right.clone().multiplyScalar(lateralForce)).add(slopeGravity).add(roadAssist.centerForce);
    const acceleration = force.multiplyScalar(1 / this.mass);
    this.velocity.addScaledVector(acceleration, dt);
    if (grounded.length && averageHeight !== null) {
      const targetHeight = averageHeight + this.bodyRideHeight;
      const heightError = targetHeight - this.position.y;
      const normalY = Math.max(0.25, this.groundNormal.y);
      const targetVerticalVelocity = clamp((-this.groundNormal.x * this.velocity.x - this.groundNormal.z * this.velocity.z) / normalY, -this.maxSpeed, this.maxSpeed);
      const relativeVerticalVelocity = this.velocity.y - targetVerticalVelocity;
      const suspensionAcceleration = clamp(
        heightError * this.suspensionStiffness - relativeVerticalVelocity * this.suspensionDamping,
        -this.gravity * 8,
        this.gravity * 8,
      );
      this.velocity.y += suspensionAcceleration * dt;
      const normalVelocity = this.velocity.dot(this.groundNormal);
      this.velocity.addScaledVector(this.groundNormal, -normalVelocity * clamp(dt * 18, 0, 1));
    } else {
      this.velocity.y += -this.gravity * dt;
    }
    const planarVelocity = new THREE.Vector3(this.velocity.x, 0, this.velocity.z);
    const planarSpeed = planarVelocity.length();
    if (planarSpeed > this.maxSpeed) {
      planarVelocity.multiplyScalar(this.maxSpeed / planarSpeed);
      this.velocity.x = planarVelocity.x;
      this.velocity.z = planarVelocity.z;
    }
    const steeringTarget = roadAssist.steer * this.steeringMax * (this.handbrake ? 0.72 : 1) * clamp(1 - Math.abs(longitudinal) / this.maxSpeed * 0.5, 0.24, 1);
    this.steering += (steeringTarget - this.steering) * Math.min(1, dt * this.steeringResponse);
    if (Math.abs(input.steer) < 0.02) this.steering *= Math.max(0, 1 - dt * this.steeringReturn);
    const yawTarget = Math.tan(this.steering) * longitudinal / Math.max(0.2, this.wheelbase);
    const handbrakeYaw = this.handbrake ? input.steer * 0.75 * clamp(planarSpeed / 10, 0, 1) : 0;
    const yawRate = clamp(yawTarget + handbrakeYaw + roadAssist.headingRate, -this.maxYawRate, this.maxYawRate);
    this.yaw += yawRate * dt;
    this.position.addScaledVector(this.velocity, dt);
    if (grounded.length && averageHeight !== null) {
      const postSample = this.sampleSurface(this.position.x, this.position.z);
      const postHeight = Number.isFinite(postSample?.height) ? postSample.height : averageHeight;
      const postError = postHeight + this.bodyRideHeight - this.position.y;
      this.position.y += clamp(postError, -0.3, 0.3) * Math.min(1, dt * 18);
    }
    this.updateOrientation(this.groundNormal);
    this.wheels.forEach((wheel) => {
      wheel.spin += longitudinal * dt / Math.max(0.05, this.wheelRadius);
    });
    const driftForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const driftRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const drift = this.driftModel.update(dt, {
      velocity: this.velocity,
      forward: driftForward,
      right: driftRight,
      handbrake: this.handbrake,
      surfaceFriction: friction,
      yawRate,
      assist: input.driftAssist,
    });
    if (drift.drifting && input.driftAssist > 0) {
      this.yaw += drift.stabilizerTorque * input.driftAssist * dt * 0.9;
      this.updateOrientation(this.groundNormal);
    }
    const postSurface = this.sampleSurface(this.position.x, this.position.z) || this.surfaceSample;
    if (postSurface && (!this.surfaceSample || postSurface.surface !== this.surfaceSample.surface)) {
      this.surfaceSample = postSurface;
      this.surface = postSurface.surface || this.surface;
    }
    const cliffHeight = Number.isFinite(postSurface?.height) ? postSurface.height : averageHeight;
    const cliff = !grounded.length || !postSurface || postSurface.inside === false || Boolean(postSurface.cliff) || (cliffHeight !== null && cliffHeight !== undefined && this.position.y < cliffHeight - this.fallDistance) || (postSurface?.slopeAngle ?? 0) > this.cliffSlope;
    if (cliff) this.cliffTimer += dt;
    else {
      this.cliffTimer = 0;
      if (grounded.length >= 2 && this.surface !== 'cliff') this.captureSafeTransform();
    }
    if (this.cliffTimer >= this.cliffDelay || this.position.y < this.heightfield.baseHeight - this.fallDistance * 3) this.beginRespawn();
    return { ...this.getSnapshot(), drift };
  }

  captureSafeTransform() {
    this.lastSafeTransform = { position: this.position.clone(), rotation: this.quaternion.clone(), checkpoint: this.checkpoint };
    return this.lastSafeTransform;
  }

  setCheckpoint(checkpoint) {
    if (typeof checkpoint === 'number') this.checkpoint = checkpoint;
    else if (checkpoint?.index !== undefined) {
      this.checkpoint = checkpoint.index;
      this.lastSafeTransform = { position: checkpoint.position.clone().addScaledVector(checkpoint.normal || UP, this.bodyRideHeight), rotation: checkpoint.rotation.clone(), checkpoint: checkpoint.index };
    }
    return this.checkpoint;
  }

  beginRespawn() {
    if (this.state === 'respawning') return;
    this.state = 'respawning';
    this.velocity.set(0, 0, 0);
    this.cliffTimer = 0.18;
  }

  respawn(transform = null) {
    const fallback = this.lastSafeTransform || this.mountainWorld?.getRespawnTransform?.(this.checkpoint) || this.mountainWorld?.getSpawnTransform?.() || { position: new THREE.Vector3(0, 1, 0), rotation: new THREE.Quaternion() };
    const target = transform || fallback;
    this.position.copy(target.position || new THREE.Vector3());
    this.quaternion.copy(target.rotation || target.quaternion || new THREE.Quaternion());
    if (this.quaternion.lengthSq() < 0.0001) this.quaternion.identity();
    else this.quaternion.normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    this.yaw = Math.atan2(forward.x, -forward.z);
    this.groundNormal.copy(normalizedNormal(new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion), UP));
    this.velocity.set(0, 0, 0);
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.cliffTimer = 0;
    this.state = 'active';
    this.respawnCount += 1;
    this.driftModel.reset();
    this.wheelContacts = [];
    const sample = this.sampleSurface(this.position.x, this.position.z);
    this.surfaceSample = sample || null;
    this.surface = sample?.surface || 'grass';
    this.captureSafeTransform();
    this.updateVisual(0.1);
    return this.getSnapshot();
  }

  updateVisual(dt = 0.016) {
    if (!this.visual) return;
    this.visual.position.copy(this.position);
    this.visual.quaternion.copy(this.quaternion);
    this.visual.setSteering?.(this.steering);
    const spinDelta = this.velocity.length() * dt / Math.max(0.05, this.wheelRadius);
    this.wheels.forEach((wheel) => {
      this.visual.setSuspension?.(wheel.key, wheel.compression);
      this.visual.setWheelSpin?.(wheel.key, wheel.spin + spinDelta * 0.001);
    });
  }

  getPose() {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    return {
      position: this.position.clone(),
      quaternion: this.quaternion.clone(),
      forward,
      right,
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion).normalize(),
      velocity: this.velocity.clone(),
      speedMps: this.velocity.length(),
      speedKmh: this.velocity.length() * 3.6,
      steering: this.steering,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.handbrake,
      surface: this.surface,
      surfaceSample: this.surfaceSample,
      drift: this.driftModel.snapshot(),
      cliffTimer: this.cliffTimer,
      state: this.state,
      respawnCount: this.respawnCount,
      checkpoint: this.checkpoint,
    };
  }

  getSnapshot() {
    return this.getPose();
  }

  dispose() {
    this.visual?.parent?.remove(this.visual);
    this.visual?.dispose?.();
  }
}
