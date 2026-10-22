import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Tire } from './Tire.js';
import { Drivetrain } from './Drivetrain.js';
import { DriftSystem } from './DriftSystem.js';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function toRapierVector(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function fromRapierVector(value) {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Vehicle {
  constructor({ physicsWorld, carAsset, scene, color = 0xd62828, isAI = false } = {}) {
    this.physicsWorld = physicsWorld;
    this.scene = scene;
    this.isAI = isAI;
    this.inspection = carAsset.inspection;
    this.carRoot = carAsset.root;
    this.carRoot.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.name?.toLowerCase().includes('carpaint') && color !== undefined) {
          material.color = new THREE.Color(color);
          material.metalness = Math.max(0.55, material.metalness ?? 0.55);
          material.roughness = Math.min(0.34, material.roughness ?? 0.34);
        }
      });
    });
    this.visual = new THREE.Group();
    this.visual.name = isAI ? 'AI_Vehicle' : 'Player_Vehicle';
    this.bodyVisual = new THREE.Group();
    this.visual.add(this.bodyVisual);
    this.bodyVisual.add(this.carRoot);
    scene?.add(this.visual);

    const spawn = { position: new THREE.Vector3(0, 3, 0), rotation: new THREE.Quaternion() };
    const created = physicsWorld.createVehicleBody(spawn);
    this.body = created.body;
    this.collider = created.collider;
    this.drivetrain = new Drivetrain();
    this.driftSystem = new DriftSystem();
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.nitro = CONFIG.nitro.capacity;
    this.headlights = false;
    this.wheelSpin = 0;
    this.lastVelocity = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.flipTimer = 0;
    this.stuckTimer = 0;
    this.impact = 0;
    this.suspensionBob = 0;
    this.surface = 'asphalt';
    this.wheels = this.buildWheels();
    this.setupLights();
    this.steeringVisual = this.inspection.steeringWheel || null;
    if (!this.steeringVisual) {
      this.steeringVisual = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.035, 8, 24),
        new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.55, roughness: 0.45 }),
      );
      this.steeringVisual.name = 'procedural_steering_wheel';
      this.steeringVisual.position.set(-0.36, 0.88, 0.2);
      this.steeringVisual.rotation.x = Math.PI / 2;
      this.carRoot.add(this.steeringVisual);
    }
    this.setColor(color);
  }

  setColor(color) {
    const value = new THREE.Color(color);
    this.carRoot.traverse((node) => {
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach((material) => {
        if (/carpaint/i.test(material.name || '')) material.color.copy(value);
      });
    });
  }

  buildWheels() {
    const wheelKeys = ['FL', 'FR', 'RL', 'RR'];
    const defaultPositions = {
      FL: new THREE.Vector3(-CONFIG.car.trackWidth / 2, CONFIG.car.wheelMountY, -CONFIG.car.wheelbase / 2),
      FR: new THREE.Vector3(CONFIG.car.trackWidth / 2, CONFIG.car.wheelMountY, -CONFIG.car.wheelbase / 2),
      RL: new THREE.Vector3(-CONFIG.car.trackWidth / 2, CONFIG.car.wheelMountY, CONFIG.car.wheelbase / 2),
      RR: new THREE.Vector3(CONFIG.car.trackWidth / 2, CONFIG.car.wheelMountY, CONFIG.car.wheelbase / 2),
    };
    const driven = CONFIG.car.drive === 'AWD' ? ['FL', 'FR', 'RL', 'RR'] : CONFIG.car.drive === 'FWD' ? ['FL', 'FR'] : ['RL', 'RR'];
    return wheelKeys.map((key) => {
      const pivot = this.inspection.wheelPivots?.[key] || null;
      // Use the normalized vehicle dimensions for runtime mounts. The imported
      // wheel pivots can contain authoring-space offsets after GLB recentering;
      // using them directly is what caused detached wheels in the preview.
      const localPosition = defaultPositions[key].clone();
      if (pivot) pivot.position.copy(localPosition);
      const node = this.inspection.wheels?.[key] || null;
      return {
        key,
        pivot,
        node,
        mountLocal: localPosition,
        baseVisualLocal: localPosition.clone(),
        tire: new Tire(key, localPosition, { drive: driven.includes(key), steer: key.startsWith('F') }),
        spin: 0,
        steeringAngle: 0,
      };
    });
  }

  setupLights() {
    this.headlightObjects = [];
    [-0.54, 0.54].forEach((x) => {
      const light = new THREE.SpotLight(0xd8e8ff, 0, 45, Math.PI / 8, 0.5, 1.4);
      light.position.set(x, 0.75, -2.05);
      light.target.position.set(x, 0.45, -12);
      this.carRoot.add(light, light.target);
      this.headlightObjects.push(light);
    });
    this.brakeLightObjects = [];
    this.carRoot.traverse((node) => {
      if (!node.isMesh || !/tail|brake/i.test(node.name || '')) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.emissive) this.brakeLightObjects.push(material);
      });
    });
  }

  getCockpitPosition() {
    const named = this.inspection.cockpitNode;
    if (named) return named.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.18, 0.25));
    const bounds = new THREE.Box3().setFromObject(this.carRoot);
    return new THREE.Vector3(bounds.min.x + 0.42, bounds.min.y + (bounds.max.y - bounds.min.y) * 0.7, bounds.min.z + (bounds.max.z - bounds.min.z) * 0.22);
  }

  setCockpitMode(active) {
    const fragments = CONFIG.assets.hideInCockpit.map((value) => String(value).toLowerCase());
    this.carRoot.traverse((node) => {
      if (!node.isMesh) return;
      const name = (node.name || '').toLowerCase();
      if (fragments.some((fragment) => name.includes(fragment))) node.visible = !active;
    });
  }

  getBodyPose() {
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const position = new THREE.Vector3(translation.x, translation.y, translation.z);
    const quaternion = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
    return { position, quaternion };
  }

  getPose() {
    const pose = this.getBodyPose();
    const velocity = fromRapierVector(this.body.linvel());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion).normalize();
    const up = WORLD_UP.clone().applyQuaternion(pose.quaternion).normalize();
    return {
      position: pose.position,
      quaternion: pose.quaternion,
      forward,
      up,
      velocity,
      speedMps: velocity.length(),
      speedKmh: velocity.length() * 3.6,
      steering: this.steering,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.handbrake,
      nitro: this.nitro,
      rpm: this.drivetrain.rpm,
      gear: this.drivetrain.reverse ? 'R' : this.drivetrain.gear,
      drift: this.driftSystem.snapshot(),
      surface: this.surface,
      suspensionBob: this.suspensionBob,
      wheels: this.wheels,
    };
  }

  steeringLimit(speedMps) {
    const t = clamp(Math.abs(speedMps) / 67, 0, 1);
    return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(CONFIG.car.steeringMaxDeg, CONFIG.car.steeringMinDeg, t));
  }

  applyForce(force, point) {
    if (typeof this.body.addForceAtPoint === 'function') this.body.addForceAtPoint(toRapierVector(force), toRapierVector(point), true);
    else if (typeof this.body.addForce === 'function') this.body.addForce(toRapierVector(force), true);
  }

  updateVisual(dt) {
    const pose = this.getBodyPose();
    this.visual.position.copy(pose.position);
    this.visual.quaternion.copy(pose.quaternion);
    const velocity = fromRapierVector(this.body.linvel());
    const lateral = velocity.dot(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion));
    const longitudinal = velocity.dot(new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion));
    const rollTarget = clamp(-lateral * 0.015 - this.steering * lateral * 0.045, -0.08, 0.08);
    const pitchTarget = clamp(-longitudinal * 0.006 + this.brake * 0.035 - this.throttle * 0.02, -0.05, 0.05);
    this.bodyVisual.rotation.z += (rollTarget - this.bodyVisual.rotation.z) * Math.min(1, dt * 7);
    this.bodyVisual.rotation.x += (pitchTarget - this.bodyVisual.rotation.x) * Math.min(1, dt * 7);
    this.suspensionBob = this.wheels.reduce((sum, wheel) => sum + wheel.tire.compression, 0) / this.wheels.length;

    this.wheels.forEach((wheel) => {
      wheel.spin += wheel.tire.contact ? wheel.tire.contact.toi * 0.0 : 0;
      if (!wheel.pivot) return;
      const compressionOffset = -wheel.tire.compression * 0.12;
      wheel.pivot.position.copy(wheel.baseVisualLocal);
      wheel.pivot.position.y += compressionOffset;
      wheel.pivot.rotation.y = wheel.steeringAngle;
      if (wheel.node) wheel.node.rotation.x = wheel.spin;
    });
    if (this.steeringVisual) this.steeringVisual.rotation.z = this.steering * (Math.PI * 2.5);

    const braking = this.brake > 0.08 || this.handbrake;
    this.brakeLightObjects.forEach((material) => {
      material.emissiveIntensity = braking ? 3.5 : 0.2;
      material.emissive?.set(braking ? 0xff1a12 : 0x220000);
    });
    this.headlightObjects.forEach((light) => { light.intensity = this.headlights ? 12 : 0; });
  }

  step(dt, controls = {}) {
    if (!this.body) return;
    const pose = this.getBodyPose();
    const velocity = fromRapierVector(this.body.linvel());
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.quaternion).normalize();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion).normalize();
    const speed = velocity.length();
    this.throttle = clamp(controls.throttle ?? 0, 0, 1);
    this.brake = clamp(controls.brake ?? 0, 0, 1);
    this.handbrake = Boolean(controls.handbrake);
    this.headlights = Boolean(controls.headlights ?? this.headlights);
    if (!this.isAI && speed < 1.2 && this.throttle < 0.02 && this.brake < 0.02 && !this.handbrake) {
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    const signedSpeed = velocity.dot(forward);
    if (this.brake > 0.1 && this.throttle < 0.05 && Math.abs(signedSpeed) < 1.5) this.drivetrain.setReverse(true);
    else if (this.throttle > 0.05) this.drivetrain.setReverse(false);
    const nitroActive = Boolean(controls.nitro) && this.nitro > 0 && this.throttle > 0.15;
    if (nitroActive) this.nitro = Math.max(0, this.nitro - CONFIG.nitro.drainPerSecond * dt);
    else this.nitro = Math.min(CONFIG.nitro.capacity, this.nitro + CONFIG.nitro.rechargePerSecond * dt);
    const transmission = this.drivetrain.update(dt, {
      speedMps: signedSpeed,
      throttle: this.throttle,
      brake: this.brake,
      manualUp: controls.manualUp,
      manualDown: controls.manualDown,
      launch: controls.launch,
    });

    const targetSteering = this.steeringLimit(speed) * (controls.steer ?? 0);
    this.steering += (targetSteering - this.steering) * Math.min(1, dt * CONFIG.car.steeringResponse);
    if (Math.abs(controls.steer ?? 0) < 0.02) this.steering *= Math.max(0, 1 - dt * CONFIG.car.steeringReturn);
    const driven = this.wheels.filter((wheel) => wheel.tire.drive);
    const drivenForce = transmission.driveForce * (nitroActive ? CONFIG.nitro.engineForceMultiplier : 1) / Math.max(1, driven.length);
    // Low-speed launch assist keeps the dynamic body from remaining motionless when
    // the first suspension frame has not yet built normal load.
    if (this.throttle > 0.05 && Math.abs(signedSpeed) < 2.5) {
      this.applyForce(forward.clone().multiplyScalar(Math.max(900, transmission.driveForce * 0.18)), pose.position);
    }
    let totalNormal = 0;
    let maxSlip = 0;
    this.wheels.forEach((wheel) => {
      const mountWorld = wheel.mountLocal.clone().applyQuaternion(pose.quaternion).add(pose.position);
      const hit = this.physicsWorld.raycast(mountWorld, { x: 0, y: -1, z: 0 }, CONFIG.car.suspensionRest + CONFIG.car.suspensionTravel + CONFIG.car.wheelRadius + 0.25, { excludeBody: this.body });
      const tire = wheel.tire;
      if (hit) {
        tire.contact = hit;
        const springLength = clamp(hit.toi - tire.radius, 0, CONFIG.car.suspensionRest + CONFIG.car.suspensionTravel);
        tire.compression = clamp(CONFIG.car.suspensionRest - springLength, -CONFIG.car.suspensionTravel, CONFIG.car.suspensionRest);
        const springForce = Math.max(0, CONFIG.car.springStiffness * tire.compression - CONFIG.car.damperStiffness * velocity.y);
        const point = hit.point;
        this.applyForce(new THREE.Vector3(0, springForce, 0), point);
        tire.normalLoad = Math.max(100, CONFIG.car.mass * 9.81 / 4 + springForce);
        totalNormal += tire.normalLoad;
        const wheelForward = forward.clone().applyAxisAngle(WORLD_UP, wheel.steer ? this.steering : 0).normalize();
        const wheelRight = new THREE.Vector3().crossVectors(wheelForward, WORLD_UP).normalize();
        const r = point.clone().sub(pose.position);
        const angular = fromRapierVector(this.body.angvel());
        const contactVelocity = velocity.clone().add(angular.cross(r));
        const brakeBias = wheel.key.startsWith('F') ? CONFIG.brakes.frontBias : 1 - CONFIG.brakes.frontBias;
        const brakeForce = this.brake * CONFIG.brakes.maxForce * brakeBias;
        const wheelDrive = wheel.tire.drive && !this.handbrake ? drivenForce : 0;
        const result = tire.computeForces({
          contact: hit,
          contactVelocity,
          forward: wheelForward,
          right: wheelRight,
          throttleForce: wheelDrive,
          brakeForce,
          handbrake: this.handbrake,
          frictionScale: this.physicsWorld.trackSurfaceMultiplier?.(hit.userData) || 1,
        });
        this.applyForce(result.force, point);
        maxSlip = Math.max(maxSlip, result.slip);
        this.surface = hit.userData?.surface || 'asphalt';
        wheel.steeringAngle = wheel.steer ? this.steering : 0;
        wheel.spin += result.forwardSpeed * dt / Math.max(0.1, tire.radius);
      } else {
        tire.contact = null;
        tire.compression = 0;
      }
    });
    if (totalNormal <= 0) totalNormal = CONFIG.car.mass * 9.81;

    const speedSq = velocity.lengthSq();
    const aero = velocity.clone().multiplyScalar(-0.5 * CONFIG.aero.dragCoefficient * CONFIG.aero.frontalArea * CONFIG.aero.airDensity * speedSq / Math.max(1, speed));
    this.applyForce(aero, pose.position);
    const rolling = velocity.clone().multiplyScalar(-CONFIG.tires.rollingResistance * CONFIG.car.mass * 9.81 / Math.max(1, speed));
    this.applyForce(rolling, pose.position);
    const downforce = CONFIG.aero.downforceCoefficient * CONFIG.aero.downforceArea * speedSq * 0.5 * CONFIG.aero.airDensity;
    this.applyForce(new THREE.Vector3(0, -downforce, 0), pose.position);
    if (Math.abs(signedSpeed) > 0.3 && transmission.engineBrake > 0) this.applyForce(forward.clone().multiplyScalar(-Math.sign(signedSpeed) * transmission.engineBrake * CONFIG.car.mass * 9.81 * 0.18), pose.position);

    const drift = this.driftSystem.update(dt, {
      speedMps: speed,
      velocity,
      forward,
      handbrake: this.handbrake,
      assist: controls.driftAssist ?? CONFIG.drift.assistStrength,
      yawRate: this.body.angvel().y,
    });
    if (drift.stabilizerTorque && typeof this.body.addTorque === 'function') this.body.addTorque({ x: 0, y: drift.stabilizerTorque * CONFIG.car.mass * 0.3, z: 0 }, true);
    if (drift.drifting) this.nitro = Math.min(CONFIG.nitro.capacity, this.nitro + CONFIG.nitro.driftRecharge * dt);

    const up = WORLD_UP.clone().applyQuaternion(pose.quaternion);
    if (up.dot(WORLD_UP) < 0.35) {
      this.flipTimer += dt;
      if (typeof this.body.addTorque === 'function') {
        const correction = new THREE.Vector3().crossVectors(up, WORLD_UP).multiplyScalar(CONFIG.car.mass * 1.8);
        this.body.addTorque(toRapierVector(correction), true);
      }
    } else this.flipTimer = 0;
    if (speed < 0.8) this.stuckTimer += dt;
    else this.stuckTimer = 0;
    this.impact = Math.max(0, this.impact - dt * 4);
    this.lastVelocity.copy(velocity);
    this.lastPosition.copy(pose.position);
    this.updateVisual(dt);
    return { transmission, drift, maxSlip, nitroActive, rpm: this.drivetrain.rpm, speedKmh: speed * 3.6 };
  }

  respawn(transform) {
    const position = transform.position || new THREE.Vector3();
    const rotation = transform.rotation || new THREE.Quaternion();
    this.physicsWorld.setBodyTransform(this.body, position, rotation);
    this.drivetrain.setReverse(false);
    this.steering = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = false;
    this.driftSystem.reset();
    this.nitro = CONFIG.nitro.capacity;
    this.flipTimer = 0;
    this.stuckTimer = 0;
    this.updateVisual(0.1);
  }

  dispose() {
    this.scene?.remove(this.visual);
    if (this.body && this.physicsWorld.world) this.physicsWorld.world.removeRigidBody(this.body);
  }
}
