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

function isRoadSurface(sample) {
  return Boolean(sample && (sample.surface === 'asphalt' || sample.surface === 'shoulder'));
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
    this.airDensity = options.airDensity ?? 1.225;
    this.frontalArea = options.frontalArea ?? 2.05;
    this.dragCoefficient = options.dragCoefficient ?? 0.44;
    this.downforceCoefficient = options.downforceCoefficient ?? 1.18;
    this.maxSpeed = options.maxSpeed ?? 58;
    this.maxYawRate = options.maxYawRate ?? 3.8;
    this.roadAssist = options.roadAssist ?? 1.6;
    this.roadHeadingGain = options.roadHeadingGain ?? 4.5;
    this.roadCenteringGain = options.roadCenteringGain ?? 3.2;
    this.roadSupportSlack = options.roadSupportSlack ?? 2.5;
    this.wheelContactSlack = 0;
    this.railClearance = options.railClearance ?? 0.18;
    this.railImpact = 0;
    this.cliffSlope = options.cliffSlope ?? Math.PI * 0.69;
    this.cliffDelay = options.cliffDelay ?? 0.9;
    this.fallDistance = options.fallDistance ?? 8;
    this.launchHoldDuration = options.launchHoldDuration ?? 3.5;
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
    this.launchHold = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.bodySquat = 0;
    this.prevLongitudinalSpeed = 0;
    this.isReversing = false;
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
      let sample = this.sampleSurface(mount.x, mount.z);
      if (!isRoadSurface(sample)) {
        const road = this.mountainWorld?.road;
        const roadSurface = road?.sampleSurface?.(mount.x, mount.z);
        if (roadSurface && roadSurface.inside !== false) sample = roadSurface;
        const nearest = road?.getNearestPoint?.(mount.x, mount.z);
        const limits = this.getRoadLimits(nearest);
        if (!isRoadSurface(sample) && nearest && nearest.distance <= limits.railLimit) {
          const normal = normalizedNormal(nearest.normal, this.groundNormal);
          const dx = mount.x - nearest.position.x;
          const dz = mount.z - nearest.position.z;
          const height = nearest.position.y - (normal.x * dx + normal.z * dz) / Math.max(0.2, normal.y);
          sample = {
            height,
            normal,
            surface: 'shoulder',
            friction: 0.72,
            rollingResistance: 0.038,
            inside: true,
            cliff: false,
          };
        }
      }
      if (!sample || !Number.isFinite(sample.height)) {
        wheel.compression = 0;
        return { wheel, mount, sample: null, distance: Infinity, contact: false };
      }
      const normal = normalizedNormal(sample.normal, this.groundNormal);
      const surfacePoint = new THREE.Vector3(mount.x, sample.height, mount.z);
      const distance = mount.clone().sub(surfacePoint).dot(normal) - this.wheelRadius;
      const contact = !sample.cliff && sample.inside !== false && distance <= this.suspensionRest + this.suspensionTravel + this.wheelContactSlack;
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

  getRoadLimits(nearest = null) {
    const road = this.mountainWorld?.road;
    const halfWidth = Math.max(0.5, Number(nearest?.roadWidth ?? road?.roadWidth ?? 7.6) * 0.5);
    const shoulderWidth = Math.max(0.5, Number(road?.shoulderWidth ?? 2.5));
    const railLimit = halfWidth + shoulderWidth * 0.8;
    return { halfWidth, shoulderWidth, railLimit, containmentLimit: Math.max(halfWidth + 0.35, railLimit - this.railClearance) };
  }

  containWithinRails() {
    const road = this.mountainWorld?.road;
    if (!road?.getNearestPoint) return false;
    const nearest = road.getNearestPoint(this.position.x, this.position.z);
    if (!nearest) return false;
    const limits = this.getRoadLimits(nearest);
    if (nearest.distance <= limits.railLimit) return false;
    const side = Math.sign(nearest.signedDistance) || 1;
    const roadRight = new THREE.Vector3(nearest.right.x, 0, nearest.right.z).normalize();
    const center = nearest.position.clone().addScaledVector(roadRight, side * limits.containmentLimit);
    this.position.x = center.x;
    this.position.z = center.z;
    const outwardSpeed = this.velocity.dot(roadRight) * side;
    if (outwardSpeed > 0) this.velocity.addScaledVector(roadRight, -side * outwardSpeed * 1.35);
    this.railImpact = 1;
    return true;
  }

  getRoadAssist(input, speed) {
    const road = this.mountainWorld?.road;
    const nearest = road?.getNearestPoint?.(this.position.x, this.position.z);
    if (!nearest || !Number.isFinite(nearest.distance)) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    const limits = this.getRoadLimits(nearest);
    const recoveryLimit = limits.railLimit;
    if (nearest.distance > recoveryLimit) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    const roadRight = new THREE.Vector3(nearest.right.x, 0, nearest.right.z);
    if (roadRight.lengthSq() < 0.0001) return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
    roadRight.normalize();
    const edgeStart = Math.max(0, limits.halfWidth - 0.35);
    const edgeFactor = clamp((nearest.distance - edgeStart) / Math.max(0.35, limits.shoulderWidth), 0, 1);
    const assist = clamp(input.driftAssist * this.roadAssist * edgeFactor * (this.handbrake ? 0.08 : 0.28), 0, 0.28);
    const steer = input.steer;
    const speedCentering = clamp(0.35 + speed / 10, 0.35, 1.25);
    const centerAcceleration = -clamp(nearest.signedDistance, -recoveryLimit, recoveryLimit) * this.roadCenteringGain * assist * speedCentering;
    const centerForce = roadRight.multiplyScalar(centerAcceleration * this.mass);
    return { steer, centerForce, headingRate: 0 };
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
    if (this.accumulator > this.fixedDt) {
      this.accumulator = 0;
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
    if (this.launchHold > 0) {
      if (input.throttle > 0.02 || input.brake > 0.02 || input.handbrake) this.launchHold = 0;
      else {
        this.launchHold = Math.max(0, this.launchHold - dt);
        this.velocity.set(0, 0, 0);
        this.railImpact = Math.max(0, this.railImpact - dt * 4);
        return this.getSnapshot();
      }
    }
    this.railImpact = Math.max(0, this.railImpact - dt * 4);
    const road = this.mountainWorld?.road;
    const roadNearest = road?.getNearestPoint?.(this.position.x, this.position.z);
    const roadLimits = this.getRoadLimits(roadNearest);
    const roadSurface = road?.sampleSurface?.(this.position.x, this.position.z);
    const roadSupportSample = roadNearest && roadNearest.distance <= roadLimits.railLimit && roadSurface ? roadSurface : null;
    const centerSample = this.sampleSurface(this.position.x, this.position.z);
    const centerOnRoad = isRoadSurface(centerSample);
    const roadSupported = centerOnRoad || Boolean(roadSupportSample);
    const preSupportSample = centerOnRoad ? centerSample : roadSupportSample || centerSample;
    this.wheelContactSlack = roadSupported ? this.roadSupportSlack : 0;
    const preNormal = this.groundNormal.clone().lerp(normalizedNormal(preSupportSample?.normal, this.groundNormal), clamp(dt * 10, 0, 1)).normalize();
    this.updateOrientation(preNormal);
    const contacts = this.sampleWheels();
    const grounded = contacts.filter((contact) => contact.contact && contact.sample && !contact.sample.cliff && contact.sample.inside !== false);
    const supportSample = roadSupported ? preSupportSample : grounded[0]?.sample || centerSample;
    const averageHeight = roadSupported ? supportSample.height : grounded.length ? grounded.reduce((sum, contact) => sum + contact.sample.height, 0) / grounded.length : null;
    const averageNormal = roadSupported
      ? normalizedNormal(supportSample.normal, this.groundNormal)
      : grounded.length
      ? grounded.reduce((normal, contact) => normal.add(normalizedNormal(contact.sample.normal, this.groundNormal)), new THREE.Vector3()).normalize()
      : normalizedNormal(centerSample?.normal, this.groundNormal);
    const supported = Boolean(grounded.length || roadSupported);
    this.surfaceSample = supportSample || null;
    this.surface = this.surfaceSample?.surface || 'cliff';
    this.groundNormal.lerp(normalizedNormal(averageNormal, this.groundNormal), clamp(dt * 14, 0, 1)).normalize();
    this.updateOrientation(this.groundNormal);
    if (roadSupported && supportSample && grounded.length === 0) {
      const supportHeightError = supportSample.height + this.bodyRideHeight - this.position.y;
      this.position.y += clamp(supportHeightError, -0.75, 0.75) * clamp(dt * 24, 0, 1);
      this.velocity.y += clamp(supportHeightError * 36 - this.velocity.y * 14, -32, 32) * dt;
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion).normalize();
    const roadAssist = this.getRoadAssist(input, Math.hypot(this.velocity.x, this.velocity.z));
    const longitudinal = this.velocity.dot(forward);
    const lateral = this.velocity.dot(right);
    const friction = clamp(this.surfaceSample?.friction ?? 0.35, 0.08, 1.2);
    const rollingResistance = this.surfaceSample?.rollingResistance ?? 0.12;
    const reversing = this.brake > this.throttle && longitudinal < 0.5;
    this.isReversing = reversing;
    const driveForce = reversing ? -this.reverseForce * this.brake : this.engineForce * this.throttle;
    const brakeForce = !reversing && Math.abs(longitudinal) > 0.05 ? Math.sign(longitudinal) * this.brakeForce * this.brake : 0;
    const handbrakeForce = this.handbrake && Math.abs(longitudinal) > 0.05 ? Math.sign(longitudinal) * this.brakeForce * 0.22 : 0;
    
    // Pacejka-inspired non-linear lateral tire slip curve
    const speedTotal = Math.hypot(longitudinal, lateral);
    const slipAngle = speedTotal > 0.8 ? Math.atan2(lateral, Math.max(0.6, Math.abs(longitudinal))) : 0;
    const absSlip = Math.abs(slipAngle);
    const gripPeakFactor = absSlip < 0.2 ? (absSlip / 0.2) * 1.15 : Math.max(0.65, 1.15 - (absSlip - 0.2) * 0.72);
    const handbrakeGrip = this.handbrake ? 0.32 : 1;
    const counterSteer = Math.sign(input.steer) === -Math.sign(lateral);
    const counterSteerBonus = counterSteer ? (1 + Math.abs(input.steer) * 0.28) : 1;
    const lateralForce = -Math.sign(lateral) * Math.min(Math.abs(lateral), 15) * this.lateralGrip * friction * handbrakeGrip * gripPeakFactor * counterSteerBonus * this.mass;

    // Weight transfer & body roll/pitch estimation
    const longAccel = dt > 0.0001 ? (longitudinal - this.prevLongitudinalSpeed) / dt : 0;
    this.prevLongitudinalSpeed = longitudinal;
    const targetPitch = clamp(longAccel * -0.0034, -0.075, 0.065);
    const targetRoll = clamp((lateral / Math.max(1, Math.abs(longitudinal) + 4)) * 0.14, -0.095, 0.095);
    this.bodyPitch = THREE.MathUtils.lerp(this.bodyPitch, targetPitch, clamp(dt * 10, 0, 1));
    this.bodyRoll = THREE.MathUtils.lerp(this.bodyRoll, targetRoll, clamp(dt * 12, 0, 1));

    const aeroSpeed = Math.hypot(longitudinal, lateral);
    const aeroDrag = 0.5 * this.airDensity * this.dragCoefficient * this.frontalArea * aeroSpeed * aeroSpeed;
    const dragForce = -Math.sign(longitudinal || 1) * aeroDrag;
    const rollingForce = -longitudinal * rollingResistance * this.mass * this.gravity;
    const downforce = supported ? 0.5 * this.airDensity * this.downforceCoefficient * this.frontalArea * aeroSpeed * aeroSpeed : 0;
    const normalLoad = Math.max(this.mass * this.gravity * Math.max(0.35, this.groundNormal.y) + downforce, this.mass * this.gravity * 0.35);
    const tireForceLimit = Math.max(250, friction * normalLoad);
    const limitedLateral = clamp(lateralForce, -tireForceLimit * 0.98, tireForceLimit * 0.98);
    const availableLongitudinal = Math.sqrt(Math.max(0, tireForceLimit * tireForceLimit - limitedLateral * limitedLateral));
    const requestedLongitudinal = driveForce - brakeForce - handbrakeForce + dragForce + rollingForce;
    const limitedLongitudinal = clamp(requestedLongitudinal, -availableLongitudinal, availableLongitudinal);
    const gravityForce = new THREE.Vector3(0, -this.gravity * this.mass, 0);
    const slopeGravity = supported
      ? gravityForce.clone().sub(this.groundNormal.clone().multiplyScalar(gravityForce.dot(this.groundNormal)))
      : gravityForce;
    const roadStability = roadSupported && !this.handbrake ? clamp(1.45 - speedTotal / 24, 0.3, 1.45) : 0;
    const stabilityForce = right.clone().multiplyScalar(-lateral * this.mass * roadStability);
    const force = forward.clone().multiplyScalar(limitedLongitudinal).add(right.clone().multiplyScalar(limitedLateral)).add(slopeGravity).add(roadAssist.centerForce).add(stabilityForce);
    const acceleration = force.multiplyScalar(1 / this.mass);
    this.velocity.addScaledVector(acceleration, dt);
    if (supported && averageHeight !== null) {
      const targetHeight = averageHeight + this.bodyRideHeight;
      const heightError = targetHeight - this.position.y;
      const normalY = Math.max(0.25, this.groundNormal.y);
      const targetVerticalVelocity = clamp((-this.groundNormal.x * this.velocity.x - this.groundNormal.z * this.velocity.z) / normalY, -8, 8);
      const relativeVerticalVelocity = this.velocity.y - targetVerticalVelocity;
      const suspensionAcceleration = clamp(
        heightError * this.suspensionStiffness - relativeVerticalVelocity * this.suspensionDamping,
        -this.gravity * 8,
        this.gravity * 8,
      );
      this.velocity.y += suspensionAcceleration * dt;
      const normalVelocity = this.velocity.dot(this.groundNormal);
      this.velocity.addScaledVector(this.groundNormal, -normalVelocity * clamp(dt * 18, 0, 1));
      this.velocity.y = clamp(this.velocity.y, -8, 8);
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
    const handbrakeYaw = this.handbrake ? input.steer * 0.55 * clamp(planarSpeed / 10, 0, 1) : 0;
    const yawRate = clamp(yawTarget + handbrakeYaw + roadAssist.headingRate, -this.maxYawRate, this.maxYawRate);
    this.yaw += yawRate * dt;
    this.position.addScaledVector(this.velocity, dt);
    this.containWithinRails();
    if (supported && averageHeight !== null) {
      const postSample = this.sampleSurface(this.position.x, this.position.z);
      const postNearest = road?.getNearestPoint?.(this.position.x, this.position.z);
      const postLimits = this.getRoadLimits(postNearest);
      const postRoadSurface = road?.sampleSurface?.(this.position.x, this.position.z);
      const postRoadHeight = postNearest && postNearest.distance <= postLimits.railLimit && postRoadSurface ? postRoadSurface.height : null;
      const postHeight = Number.isFinite(postRoadHeight) ? postRoadHeight : Number.isFinite(postSample?.height) ? postSample.height : averageHeight;
      const postError = postHeight + this.bodyRideHeight - this.position.y;
      const postCorrection = Math.min(1, dt * 32);
      this.position.y += clamp(postError, -0.9, 0.9) * postCorrection;
      if (postRoadHeight !== null) this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, clamp(this.velocity.y + postError * 16, -8, 8), postCorrection);
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
    const cliff = !supported || !postSurface || postSurface.inside === false || Boolean(postSurface.cliff) || (cliffHeight !== null && cliffHeight !== undefined && this.position.y < cliffHeight - this.fallDistance) || (postSurface?.slopeAngle ?? 0) > this.cliffSlope;
    if (cliff) this.cliffTimer += dt;
    else {
      this.cliffTimer = 0;
      if (grounded.length >= 2 && this.surface !== 'cliff' && !this.lastSafeTransform) this.captureSafeTransform();
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
    this.launchHold = this.launchHoldDuration;
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
    this.visual.setBodyDynamics?.({ roll: this.bodyRoll, pitch: this.bodyPitch, squat: this.bodySquat });
    this.visual.setBraking?.(this.brake > 0.08 && !this.isReversing);
    this.visual.setReversing?.(this.isReversing);
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
      railImpact: this.railImpact,
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
