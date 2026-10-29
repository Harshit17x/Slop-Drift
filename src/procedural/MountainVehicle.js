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
    this.engineForce = options.engineForce ?? 9200;
    this.reverseForce = options.reverseForce ?? 3600;
    this.brakeForce = options.brakeForce ?? 12000;
    this.steeringMax = THREE.MathUtils.degToRad(options.steeringMaxDeg ?? 35);
    this.steeringResponse = options.steeringResponse ?? 8.5;
    this.steeringReturn = options.steeringReturn ?? 12;
    this.wheelbase = options.wheelbase ?? 2.55;
    this.trackWidth = options.trackWidth ?? 1.58;
    this.wheelRadius = options.wheelRadius ?? 0.34;
    this.wheelMountY = options.wheelMountY ?? 0.37;
    this.suspensionRest = options.suspensionRest ?? 0.32;
    this.suspensionTravel = options.suspensionTravel ?? 0.18;
    this.bodyRideHeight = options.bodyRideHeight ?? 0.03;
    this.suspensionStiffness = options.suspensionStiffness ?? 96;
    this.suspensionDamping = options.suspensionDamping ?? 22;
    this.lateralGrip = options.lateralGrip ?? 8.5;
    this.longitudinalGrip = options.longitudinalGrip ?? 0.55;
    this.airDrag = options.airDrag ?? 0.34;
    this.airDensity = options.airDensity ?? 1.225;
    this.frontalArea = options.frontalArea ?? 2.05;
    this.dragCoefficient = options.dragCoefficient ?? 0.44;
    this.downforceCoefficient = options.downforceCoefficient ?? 1.18;
    this.maxSpeed = options.maxSpeed ?? 58;
    this.driveLayout = ['fwd', 'rwd', 'awd'].includes(options.driveLayout) ? options.driveLayout : 'rwd';
    this.cgHeight = options.cgHeight ?? 0.42;
    this.yawInertia = options.yawInertia ?? this.mass * (this.wheelbase * this.wheelbase + this.trackWidth * this.trackWidth) / 12;
    this.frontCornerStiffness = options.frontCornerStiffness ?? 5.6;
    this.rearCornerStiffness = options.rearCornerStiffness ?? 8.4;
    this.frontGripBias = options.frontGripBias ?? 1.02;
    this.rearGripBias = options.rearGripBias ?? 1.25;
    this.tractionControl = options.tractionControl ?? 0.85;
    this.maxYawRate = options.maxYawRate ?? 3.2;
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
    this.parked = true;
    this.coastLock = true;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.bodySquat = 0;
    this.prevLongitudinalSpeed = 0;
    this.yawRate = 0;
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
        const nearest = road?.getNearestPoint?.(mount.x, mount.z, this.position.y);
        const limits = this.getRoadLimits(nearest);
        if (!isRoadSurface(sample) && nearest && nearest.distance <= limits.railLimit + 0.6) {
          const normal = normalizedNormal(nearest.normal, this.groundNormal);
          const dx = mount.x - nearest.position.x;
          const dz = mount.z - nearest.position.z;
          const height = nearest.position.y - (normal.x * dx + normal.z * dz) / Math.max(0.2, normal.y);
          sample = {
            height,
            normal,
            surface: 'shoulder',
            friction: 0.75,
            rollingResistance: 0.035,
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
    const halfWidth = nearest?.halfWidth ?? Math.max(0.5, Number(nearest?.roadWidth ?? road?.roadWidth ?? 7.6) * 0.5);
    const shoulderWidth = nearest?.shoulderWidth ?? Math.max(0.5, Number(road?.shoulderWidth ?? 2.5));
    const railLimit = nearest?.railDistance ?? (halfWidth + shoulderWidth * 0.82);
    return { halfWidth, shoulderWidth, railLimit };
  }

  containWithinRails() {
    const road = this.mountainWorld?.road;
    if (!road?.getNearestPoint) return false;
    const nearest = road.getNearestPoint(this.position.x, this.position.z, this.position.y);
    if (!nearest || !Number.isFinite(nearest.distance)) return false;
    const limits = this.getRoadLimits(nearest);

    const roadRight = new THREE.Vector3(nearest.right.x, 0, nearest.right.z).normalize();
    const roadTangent = new THREE.Vector3(nearest.tangent.x, 0, nearest.tangent.z).normalize();
    const carForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const carRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);

    // Car bounding dimensions: half-width ~0.95m, half-length ~2.15m
    const carHalfWidth = 0.95;
    const carHalfLength = 2.15;
    // Projected lateral extent along road normal based on current vehicle orientation
    const carLateralRadius = Math.abs(carRight.dot(roadRight)) * carHalfWidth + Math.abs(carForward.dot(roadRight)) * carHalfLength;

    const side = Math.sign(nearest.signedDistance) || 1;
    const centerDist = Math.abs(nearest.signedDistance);
    const outerDist = centerDist + carLateralRadius;

    // Check if outer edge penetrates or touches guardrail
    if (outerDist <= limits.railLimit) return false;

    // Constrain center position so outer boundary strictly remains inside guardrail
    const allowedCenterDist = Math.max(0.4, limits.railLimit - carLateralRadius - 0.03);
    const center = nearest.position.clone().addScaledVector(roadRight, side * allowedCenterDist);
    this.position.x = center.x;
    this.position.z = center.z;

    // Keep vehicle vertically supported on the road plane at the boundary
    const roadNormal = normalizedNormal(nearest.normal, this.groundNormal);
    const normalY = Math.max(0.2, roadNormal.y);
    const planeY = nearest.position.y - (roadNormal.x * (this.position.x - nearest.position.x) + roadNormal.z * (this.position.z - nearest.position.z)) / normalY;
    const targetY = planeY + this.bodyRideHeight;
    if (this.position.y < targetY) {
      this.position.y = targetY;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // Gentle bounce restitution and friction against guardrail
    const outwardSpeed = this.velocity.dot(roadRight) * side;
    if (outwardSpeed > 0) {
      const restitution = 0.22;
      this.velocity.addScaledVector(roadRight, -side * outwardSpeed * (1 + restitution));

      // Sliding friction along guardrail beam
      const tangentSpeed = this.velocity.dot(roadTangent);
      this.velocity.sub(roadTangent.clone().multiplyScalar(tangentSpeed * 0.08));
    }

    // Rotational deflection: turns the nose parallel to guardrail so car glances off smoothly
    const carForwardPlanar = new THREE.Vector3(carForward.x, 0, carForward.z).normalize();
    const headingError = -Math.atan2(
      roadTangent.x * carForwardPlanar.z - roadTangent.z * carForwardPlanar.x,
      roadTangent.x * carForwardPlanar.x + roadTangent.z * carForwardPlanar.z
    );
    const alignTorque = -headingError * 1.8;
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, alignTorque, 0.35);

    this.railImpact = 1;
    return true;
  }

  getRoadAssist(input, speed) {
    // Road assist should never steer on its own when player is not actively steering!
    return { steer: input.steer, centerForce: new THREE.Vector3(), headingRate: 0 };
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

    const wantsForward = input.throttle > 0.05 && !input.handbrake;
    const wantsReverse = input.brake > 0.05 && !input.handbrake;
    const activeDriveIntent = wantsForward || wantsReverse;
    const driverActive = activeDriveIntent || input.handbrake || Math.abs(input.steer) > 0.05;

    if (activeDriveIntent) {
      this.parked = false;
      this.coastLock = false;
      this.launchHold = 0;
    }

    if (this.parked || this.coastLock) {
      this.velocity.set(0, 0, 0);
      this.yawRate = 0;
      this.steering = 0;
      this.isReversing = false;
      this.railImpact = 0;
      this.cliffTimer = 0;
      return this.getSnapshot();
    }
    if (this.launchHold > 0) {
      if (activeDriveIntent) this.launchHold = 0;
      else {
        this.launchHold = Math.max(0, this.launchHold - dt);
        this.velocity.set(0, 0, 0);
        this.railImpact = Math.max(0, this.railImpact - dt * 4);
        return this.getSnapshot();
      }
    }
    this.railImpact = Math.max(0, this.railImpact - dt * 4);
    const road = this.mountainWorld?.road;
    const roadNearest = road?.getNearestPoint?.(this.position.x, this.position.z, this.position.y);
    const roadLimits = this.getRoadLimits(roadNearest);
    let roadSurface = road?.sampleSurface?.(this.position.x, this.position.z, this.position.y);
    if (!roadSurface && roadNearest && roadNearest.distance <= roadLimits.railLimit + 0.6) {
      const norm = normalizedNormal(roadNearest.normal, this.groundNormal);
      const dx = this.position.x - roadNearest.position.x;
      const dz = this.position.z - roadNearest.position.z;
      const planeH = roadNearest.position.y - (norm.x * dx + norm.z * dz) / Math.max(0.2, norm.y);
      roadSurface = {
        height: planeH,
        normal: norm,
        surface: 'shoulder',
        friction: 0.75,
        rollingResistance: 0.035,
        inside: true,
        cliff: false,
      };
    }
    const roadSupportSample = roadNearest && roadNearest.distance <= roadLimits.railLimit + 0.6 && roadSurface ? roadSurface : null;
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
    const speedTotal = Math.hypot(longitudinal, lateral);
    const steeringTarget = roadAssist.steer * this.steeringMax * clamp(1 - Math.abs(longitudinal) / this.maxSpeed * 0.35, 0.3, 1);
    this.steering += (steeringTarget - this.steering) * Math.min(1, dt * this.steeringResponse);
    if (Math.abs(input.steer) < 0.02) this.steering *= Math.max(0, 1 - dt * this.steeringReturn);

    const frontAxle = this.wheelbase * 0.5;
    const rearAxle = this.wheelbase * 0.5;
    const longDirection = longitudinal >= 0 ? 1 : -1;
    const frontLongitudinal = Math.max(0.6, Math.abs(longitudinal));
    const frontLateral = lateral + this.yawRate * frontAxle;
    const rearLateral = lateral - this.yawRate * rearAxle;
    const frontSlipAngle = Math.atan2(frontLateral * longDirection, frontLongitudinal) - this.steering;
    const rearSlipAngle = Math.atan2(rearLateral * longDirection, frontLongitudinal);

    const aeroSpeed = Math.hypot(longitudinal, lateral);
    const aeroDrag = 0.5 * this.airDensity * this.dragCoefficient * this.frontalArea * aeroSpeed * aeroSpeed;
    const dragForce = -Math.sign(longitudinal || 1) * aeroDrag;
    const rollingForce = -longitudinal * rollingResistance * this.mass * this.gravity;
    const downforce = supported ? 0.5 * this.airDensity * this.downforceCoefficient * this.frontalArea * aeroSpeed * aeroSpeed : 0;
    const normalLoad = Math.max(this.mass * this.gravity * Math.max(0.35, this.groundNormal.y) + downforce, this.mass * this.gravity * 0.35);
    const longAcceleration = dt > 0.0001 ? clamp((longitudinal - this.prevLongitudinalSpeed) / dt, -18, 18) : 0;
    const staticFrontLoad = normalLoad * rearAxle / this.wheelbase;
    const staticRearLoad = normalLoad * frontAxle / this.wheelbase;
    const weightTransfer = clamp(this.mass * longAcceleration * this.cgHeight / this.wheelbase, -normalLoad * 0.32, normalLoad * 0.32);
    const frontLoad = Math.max(normalLoad * 0.18, staticFrontLoad - weightTransfer);
    const rearLoad = Math.max(normalLoad * 0.18, staticRearLoad + weightTransfer);
    const frontGrip = friction * this.frontGripBias;
    const handbrakeDriftIntent = this.handbrake && speedTotal > 6 && Math.abs(input.steer) > 0.25;
    const rearGrip = friction * this.rearGripBias * (handbrakeDriftIntent ? 0.55 : 1.0);
    const lateralTireForce = (slipAngle, load, grip, stiffness) => -load * grip * Math.tanh(stiffness * slipAngle);
    const lowSpeedTireFactor = clamp(speedTotal / 6, 0, 1);
    const frontLateralForce = lateralTireForce(frontSlipAngle, frontLoad, frontGrip, this.frontCornerStiffness) * lowSpeedTireFactor;
    const rearLateralForce = lateralTireForce(rearSlipAngle, rearLoad, rearGrip, this.rearCornerStiffness) * lowSpeedTireFactor;
    const frontCapacity = Math.sqrt(Math.max(0, (frontLoad * frontGrip) ** 2 - frontLateralForce ** 2));
    const rearCapacity = Math.sqrt(Math.max(0, (rearLoad * rearGrip) ** 2 - rearLateralForce ** 2));

    let driveForce = 0;
    let brakeForce = 0;

    if (this.handbrake) {
      // Emergency / Handbrake (Space): cut engine, massive stopping force
      driveForce = 0;
      brakeForce = this.brakeForce * 1.5;
      this.isReversing = false;
    } else if (input.throttle > 0.02) {
      // Throttle (W):
      if (longitudinal < -0.3) {
        // Moving backward: W acts as brake against backward movement
        driveForce = this.brakeForce * 1.2 * input.throttle;
        brakeForce = 0;
        this.isReversing = false;
      } else {
        // Forward drive
        driveForce = this.engineForce * input.throttle;
        brakeForce = 0;
        this.isReversing = false;
      }
    } else if (input.brake > 0.02) {
      // Brake (S):
      if (longitudinal > 0.3) {
        // Moving forward: S acts as service brake
        driveForce = 0;
        brakeForce = this.brakeForce * 1.25 * input.brake;
        this.isReversing = false;
      } else {
        // Stopped or moving backward: S acts as reverse gear
        const maxReverseSpeed = 8.5; // ~30 km/h reverse limit
        driveForce = longitudinal > -maxReverseSpeed ? -this.reverseForce * input.brake : 0;
        brakeForce = 0;
        this.isReversing = true;
      }
    } else {
      // Neutral coasting
      driveForce = 0;
      brakeForce = 0;
      this.isReversing = false;
    }

    const brakeSign = Math.abs(longitudinal) > 0.05 ? -Math.sign(longitudinal) : 0;
    const frontBrakeForce = brakeSign * brakeForce * 0.60;
    const rearBrakeForce = brakeSign * brakeForce * 0.40;
    const frontDriveForce = this.driveLayout === 'fwd' ? driveForce : this.driveLayout === 'awd' ? driveForce * 0.5 : 0;
    const rearDriveForce = this.driveLayout === 'rwd' ? driveForce : this.driveLayout === 'awd' ? driveForce * 0.5 : 0;
    const frontLongitudinalForce = clamp(frontDriveForce + frontBrakeForce, -frontCapacity, frontCapacity);
    const rearLongitudinalForce = clamp(rearDriveForce + rearBrakeForce, -rearCapacity, rearCapacity);
    const totalLongitudinalForce = frontLongitudinalForce + rearLongitudinalForce + dragForce + rollingForce;
    const totalLateralForce = frontLateralForce + rearLateralForce;

    const gravityForce = new THREE.Vector3(0, -this.gravity * this.mass, 0);
    let slopeGravity = new THREE.Vector3();
    if (supported && !this.parked && !this.coastLock) {
      const rawSlope = gravityForce.clone().sub(this.groundNormal.clone().multiplyScalar(gravityForce.dot(this.groundNormal)));
      if (activeDriveIntent) {
        slopeGravity = rawSlope;
      } else {
        // While coasting to a stop, scale down slope gravity pull at low speeds so coast brake can bring vehicle to a complete rest
        const slopeScale = clamp((speedTotal - 0.5) / 2.0, 0, 1);
        slopeGravity = rawSlope.multiplyScalar(slopeScale);
      }
    } else if (!supported) {
      slopeGravity = gravityForce;
    }

    const coastBrake = (!activeDriveIntent && supported)
      ? clamp(-longitudinal * this.mass * 3.0, -this.brakeForce * 0.8, this.brakeForce * 0.8)
      : 0;
    const force = forward.clone().multiplyScalar(totalLongitudinalForce + coastBrake).add(right.clone().multiplyScalar(totalLateralForce)).add(slopeGravity);
    const acceleration = force.multiplyScalar(1 / this.mass);
    this.velocity.addScaledVector(acceleration, dt);
    const yawTorque = frontLateralForce * frontAxle - rearLateralForce * rearAxle;
    // High-speed heading stabilization: naturally centers steering along travel direction
    const slipAngle = Math.atan2(lateral, Math.max(1.5, Math.abs(longitudinal)));
    const casterTorque = (Math.abs(input.steer) < 0.15 && Math.abs(longitudinal) > 2)
      ? -slipAngle * this.mass * 0.8
      : 0;
    const yawDamping = this.yawRate * (4.2 + speedTotal * 0.05);
    this.yawRate = clamp(this.yawRate + ((yawTorque + casterTorque) / Math.max(1, this.yawInertia) - yawDamping) * dt, -this.maxYawRate, this.maxYawRate);
    this.yaw += this.yawRate * dt;
    this.prevLongitudinalSpeed = longitudinal;
    const targetPitch = clamp(longAcceleration * 0.0034, -0.075, 0.065);
    const targetRoll = clamp((totalLateralForce / this.mass) * 0.007, -0.095, 0.095);
    this.bodyPitch = THREE.MathUtils.lerp(this.bodyPitch, targetPitch, clamp(dt * 10, 0, 1));
    this.bodyRoll = THREE.MathUtils.lerp(this.bodyRoll, targetRoll, clamp(dt * 12, 0, 1));
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
    this.position.addScaledVector(this.velocity, dt);
    const postSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (!activeDriveIntent && postSpeed < 0.6) {
      this.velocity.set(0, 0, 0);
      this.yawRate = 0;
      this.parked = true;
      this.coastLock = true;
    }
    if (this.handbrake && postSpeed < 1.2) {
      this.velocity.set(0, 0, 0);
      this.yawRate = 0;
      this.parked = true;
      this.coastLock = true;
    }
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
      if (this.position.y < postHeight + this.bodyRideHeight) {
        this.position.y = postHeight + this.bodyRideHeight;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
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
      yawRate: this.yawRate,
      assist: input.driftAssist,
      steerInput: input.steer,
      surface: this.surface,
      supported,
    });
    if (drift.drifting && input.driftAssist > 0) {
      // Counter-steer assist during drift to help hold slides without spinning out
      const counterTorque = -drift.angle * input.driftAssist * 0.12;
      this.yawRate += counterTorque * dt * 10;
      this.yawRate *= 1 - clamp(input.driftAssist * dt * 0.6, 0, 0.1);
    }
    const postSurface = this.sampleSurface(this.position.x, this.position.z) || this.surfaceSample;
    if (postSurface && (!this.surfaceSample || postSurface.surface !== this.surfaceSample.surface)) {
      this.surfaceSample = postSurface;
      this.surface = postSurface.surface || this.surface;
    }
    const cliffHeight = Number.isFinite(postSurface?.height) ? postSurface.height : averageHeight;
    const isAtGuardrail = Boolean(roadNearest && roadNearest.distance <= roadLimits.railLimit + 0.6);
    const cliff = !supported || !postSurface || postSurface.inside === false || (Boolean(postSurface.cliff) && !isAtGuardrail) || (cliffHeight !== null && cliffHeight !== undefined && this.position.y < cliffHeight - this.fallDistance && !isAtGuardrail) || ((postSurface?.slopeAngle ?? 0) > this.cliffSlope && !isAtGuardrail);
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
      const position = checkpoint.position.clone();
      position.y += this.bodyRideHeight;
      this.lastSafeTransform = { position, rotation: checkpoint.rotation.clone(), checkpoint: checkpoint.index };
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
    const support = this.mountainWorld?.road?.sampleSurface?.(this.position.x, this.position.z) || this.sampleSurface(this.position.x, this.position.z);
    if (support && Number.isFinite(support.height)) this.position.y = support.height + this.bodyRideHeight;
    this.groundNormal.copy(normalizedNormal(support?.normal || new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion), UP));
    this.updateOrientation(this.groundNormal);
    this.velocity.set(0, 0, 0);
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.cliffTimer = 0;
    this.launchHold = 0;
    this.parked = true;
    this.coastLock = true;
    this.yawRate = 0;
    this.state = 'active';
    this.respawnCount += 1;
    this.driftModel.reset({ preserveBank: true });
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
      yawRate: this.yawRate,
      driveLayout: this.driveLayout,
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
