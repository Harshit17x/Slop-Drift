import * as THREE from 'three';
import { CONFIG } from '../config.js';

const DEG = Math.PI / 180;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export class Tire {
  constructor(key, position, { drive = false, steer = false } = {}) {
    this.key = key;
    this.position = position.clone();
    this.drive = drive;
    this.steer = steer;
    this.radius = CONFIG.car.wheelRadius;
    this.compression = 0;
    this.normalLoad = CONFIG.car.mass * 9.81 / 4;
    this.slipAngle = 0;
    this.longSlip = 0;
    this.lateralForce = 0;
    this.longitudinalForce = 0;
    this.surface = 'asphalt';
    this.contact = null;
    this.spin = 0;
    this.steerAngle = 0;
  }

  surfaceMu(name = '') {
    const value = `${name} ${this.surface}`.toLowerCase();
    const key = Object.keys(CONFIG.tires.surfaceFriction).find((candidate) => value.includes(candidate));
    return CONFIG.tires.surfaceFriction[key || 'default'];
  }

  computeForces({
    contact,
    contactVelocity,
    forward,
    right,
    throttleForce = 0,
    brakeForce = 0,
    handbrake = false,
    frictionScale = 1,
  }) {
    this.contact = contact;
    this.surface = contact?.userData?.surface || contact?.userData?.material || 'asphalt';
    const velocity = contactVelocity.clone();
    const forwardSpeed = velocity.dot(forward);
    const lateralSpeed = velocity.dot(right);
    this.slipAngle = Math.atan2(lateralSpeed, Math.abs(forwardSpeed) + 0.75);
    const peak = CONFIG.tires.lateralPeakDeg * DEG;
    const angle = Math.abs(this.slipAngle);
    const normalized = angle / Math.max(peak, 0.001);
    const peakShape = normalized <= 1 ? Math.sin(normalized * Math.PI * 0.5) : Math.max(0.18, 1 - (normalized - 1) * 0.22);
    const grip = CONFIG.tires.baseMu * this.surfaceMu() * frictionScale * (handbrake && !this.steer ? CONFIG.tires.handbrakeGrip : 1);
    const load = Math.max(80, this.normalLoad);
    const desiredLateral = -Math.sign(lateralSpeed || this.slipAngle) * grip * load * peakShape * Math.min(1.4, CONFIG.tires.lateralStiffness * 0.14);
    const drive = this.drive ? throttleForce : 0;
    const braking = Math.sign(forwardSpeed || 1) * brakeForce;
    const desiredLongitudinal = drive - braking;
    const maxCombined = grip * load;
    const combined = Math.hypot(desiredLongitudinal, desiredLateral);
    const scale = combined > maxCombined ? maxCombined / combined : 1;
    this.longitudinalForce = desiredLongitudinal * scale;
    this.lateralForce = desiredLateral * scale;
    this.longSlip = clamp((drive - forwardSpeed * CONFIG.tires.longitudinalStiffness * 70) / Math.max(200, maxCombined), -2, 2);
    const force = forward.clone().multiplyScalar(this.longitudinalForce).add(right.clone().multiplyScalar(this.lateralForce));
    return { force, slip: Math.hypot(this.longSlip, this.slipAngle), forwardSpeed, lateralSpeed, grip, load };
  }
}
