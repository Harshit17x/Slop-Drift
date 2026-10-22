import * as THREE from 'three';
import { CONFIG } from '../config.js';

const DEG = Math.PI / 180;

export class DriftSystem {
  constructor() {
    this.isDrifting = false;
    this.angle = 0;
    this.score = 0;
    this.bank = Number(localStorage.getItem('drift-bank') || 0);
    this.multiplier = 1;
    this.comboTimer = 0;
    this.entryTimer = 0;
    this.releaseBoost = 0;
    this.boostCharge = 0;
    this.lastAngle = 0;
    this.wasDrifting = false;
  }

  reset() {
    this.isDrifting = false;
    this.angle = 0;
    this.score = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.entryTimer = 0;
    this.releaseBoost = 0;
    this.boostCharge = 0;
  }

  update(dt, { speedMps = 0, velocity, forward, handbrake = false, assist = CONFIG.drift.assistStrength, yawRate = 0 } = {}) {
    const speed = Math.abs(speedMps);
    const horizontalVelocity = new THREE.Vector3(velocity.x, 0, velocity.z);
    const planarSpeed = horizontalVelocity.length();
    const heading = Math.atan2(forward.x, -forward.z);
    const velocityHeading = planarSpeed > 0.5 ? Math.atan2(horizontalVelocity.x, -horizontalVelocity.z) : heading;
    let delta = velocityHeading - heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.angle = delta;
    const eligible = speed * 3.6 > CONFIG.drift.minSpeedKmh && Math.abs(delta) > CONFIG.drift.entryAngleDeg * DEG;
    if (eligible) this.entryTimer += dt;
    else this.entryTimer = Math.max(0, this.entryTimer - dt * 2.5);
    const active = eligible && this.entryTimer >= CONFIG.drift.confirmTime;
    this.wasDrifting = this.isDrifting;
    this.isDrifting = active;

    if (this.isDrifting) {
      this.comboTimer = CONFIG.drift.comboResetTime;
      this.multiplier = Math.min(CONFIG.drift.maxMultiplier, this.multiplier + dt * 0.42);
      const angleScore = Math.min(1.7, Math.abs(delta) / (45 * DEG));
      const speedScore = Math.min(2.4, speed / 25);
      this.score += dt * (100 + angleScore * 420) * speedScore * this.multiplier;
      this.boostCharge = Math.min(100, this.boostCharge + dt * CONFIG.drift.boostPerSecond * (0.8 + angleScore));
      if (assist > 0 && Math.abs(delta) < CONFIG.drift.maxCatchAngleDeg * DEG) {
        const targetYaw = delta * (1 - assist * 0.15);
        const stabilizer = (targetYaw - delta) * assist * 3.2 - yawRate * assist * 0.16;
        this.stabilizerTorque = stabilizer;
      } else this.stabilizerTorque = 0;
    } else {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer <= 0) this.multiplier = 1;
      this.stabilizerTorque = 0;
    }

    if (this.wasDrifting && !this.isDrifting && this.boostCharge > 8) {
      this.releaseBoost = Math.min(1, CONFIG.drift.boostBurst * (this.boostCharge / 100));
      this.bank += Math.round(this.score);
      localStorage.setItem('drift-bank', String(Math.round(this.bank)));
      this.score = 0;
      this.boostCharge *= 0.55;
    }
    this.releaseBoost = Math.max(0, this.releaseBoost - dt);
    this.lastAngle = delta;
    return this.snapshot();
  }

  snapshot() {
    return {
      drifting: this.isDrifting,
      angleDeg: this.angle / DEG,
      score: this.score,
      multiplier: Math.max(1, Math.floor(this.multiplier)),
      comboTimer: this.comboTimer,
      boostCharge: this.boostCharge,
      releaseBoost: this.releaseBoost,
      stabilizerTorque: this.stabilizerTorque || 0,
    };
  }
}
