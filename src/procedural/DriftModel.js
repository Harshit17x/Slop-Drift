import * as THREE from 'three';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

export class DriftModel {
  constructor(options = {}) {
    this.minSpeed = options.minSpeed ?? 11;
    this.entryAngle = options.entryAngle ?? THREE.MathUtils.degToRad(options.entryAngleDeg ?? 12);
    this.confirmTime = options.confirmTime ?? 0.2;
    this.comboWindow = options.comboWindow ?? 1.35;
    this.maxMultiplier = options.maxMultiplier ?? 5;
    this.maxAngle = options.maxAngle ?? THREE.MathUtils.degToRad(options.maxAngleDeg ?? 72);
    this.scoreScale = options.scoreScale ?? 16;
    this.reset();
  }

  reset() {
    this.drifting = false;
    this.wasDrifting = false;
    this.angle = 0;
    this.score = 0;
    this.bank = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.entryTimer = 0;
    this.releaseBoost = 0;
    this.boostCharge = 0;
    this.stabilizerTorque = 0;
    return this.snapshot();
  }

  angleFromState({ velocity = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, -1), right = new THREE.Vector3(1, 0, 0) } = {}) {
    const planar = new THREE.Vector3(velocity.x, 0, velocity.z);
    if (planar.lengthSq() < 0.0001) return 0;
    const planarForward = new THREE.Vector3(forward.x, 0, forward.z);
    const planarRight = new THREE.Vector3(right.x, 0, right.z);
    if (planarForward.lengthSq() < 0.0001 || planarRight.lengthSq() < 0.0001) return 0;
    const longitudinal = planar.dot(planarForward.normalize());
    const lateral = planar.dot(planarRight.normalize());
    return Math.atan2(lateral, Math.max(0.1, Math.abs(longitudinal)));
  }

  update(dt, state = {}) {
    const deltaTime = Math.max(0, Math.min(0.1, dt));
    const velocity = state.velocity || new THREE.Vector3();
    const forward = state.forward || new THREE.Vector3(0, 0, -1);
    const right = state.right || new THREE.Vector3(1, 0, 0);
    const speed = Math.hypot(velocity.x, velocity.z);
    const angle = state.angle ?? this.angleFromState({ velocity, forward, right });
    const handbrake = Boolean(state.handbrake);
    const surfaceFriction = clamp(state.surfaceFriction ?? 1, 0.1, 1.2);
    const eligible = speed >= this.minSpeed && Math.abs(angle) >= this.entryAngle && Math.abs(angle) <= this.maxAngle && (handbrake || Math.abs(velocity.x) + Math.abs(velocity.z) > this.minSpeed * 0.45);
    this.wasDrifting = this.drifting;
    if (eligible) this.entryTimer += deltaTime;
    else this.entryTimer = Math.max(0, this.entryTimer - deltaTime * 2.5);
    this.drifting = eligible && this.entryTimer >= this.confirmTime;
    this.angle = wrapAngle(angle);
    if (this.drifting) {
      this.comboTimer = this.comboWindow;
      this.multiplier = Math.min(this.maxMultiplier, this.multiplier + deltaTime * 0.38);
      const angleFactor = clamp(Math.abs(this.angle) / THREE.MathUtils.degToRad(42), 0, 1.7);
      const speedFactor = clamp(speed / 24, 0, 2.6);
      const handbrakeFactor = handbrake ? 1.16 : 1;
      this.score += deltaTime * this.scoreScale * speedFactor * (1 + angleFactor * 1.9) * this.multiplier * handbrakeFactor * surfaceFriction;
      this.boostCharge = Math.min(100, this.boostCharge + deltaTime * (2.2 + angleFactor * 3.4) * handbrakeFactor);
      const yawRate = state.yawRate ?? 0;
      const assist = clamp(state.assist ?? 0.35, 0, 1);
      this.stabilizerTorque = (this.angle * (1 - assist * 0.2) - yawRate * 0.12) * assist;
    } else {
      this.comboTimer = Math.max(0, this.comboTimer - deltaTime);
      if (this.comboTimer <= 0) this.multiplier = 1;
      this.stabilizerTorque = 0;
    }
    if (this.wasDrifting && !this.drifting) {
      this.bank += Math.round(this.score);
      this.releaseBoost = clamp(this.boostCharge / 100, 0, 1);
      this.score = 0;
      this.boostCharge *= 0.52;
    }
    this.releaseBoost = Math.max(0, this.releaseBoost - deltaTime * 0.8);
    return this.snapshot();
  }

  snapshot() {
    return {
      drifting: this.drifting,
      angle: this.angle,
      angleDeg: THREE.MathUtils.radToDeg(this.angle),
      score: this.score,
      bank: this.bank,
      multiplier: Math.max(1, Math.floor(this.multiplier)),
      comboTimer: this.comboTimer,
      boostCharge: this.boostCharge,
      releaseBoost: this.releaseBoost,
      stabilizerTorque: this.stabilizerTorque,
    };
  }
}
