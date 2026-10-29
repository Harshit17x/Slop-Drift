import * as THREE from 'three';

const PHASE_IDLE = 0;
const PHASE_ENTRY = 1;
const PHASE_DRIFT = 2;
const PHASE_NAMES = ['idle', 'entry', 'drift'];

const _vel = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function wrapAngle(value) {
  const twoPi = Math.PI * 2;
  return ((((value + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function damp(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

export class DriftModel {
  constructor(options = {}) {
    const deg = THREE.MathUtils.degToRad;
    this.minSpeed = options.minSpeed ?? 11;
    this.sustainSpeed = options.sustainSpeed ?? this.minSpeed * 0.8;
    this.entryAngle = options.entryAngle ?? deg(options.entryAngleDeg ?? 12);
    this.steerEntryAngle = deg(options.steerEntryAngleDeg ?? 24);
    this.sustainAngle = options.sustainAngle ?? this.entryAngle * 0.6;
    this.maxAngle = options.maxAngle ?? deg(options.maxAngleDeg ?? 72);
    this.spinAngle = deg(options.spinAngleDeg ?? 88);
    this.spinTime = options.spinTime ?? 0.3;
    this.idealAngle = deg(options.idealAngleDeg ?? 38);
    this.angleWidth = deg(options.angleWidthDeg ?? 26);
    this.holdAngle = deg(options.holdAngleDeg ?? 35);
    this.confirmTime = options.confirmTime ?? 0.18;
    this.handbrakeConfirmTime = options.handbrakeConfirmTime ?? 0.07;
    this.graceTime = options.graceTime ?? 0.15;
    this.comboWindow = options.comboWindow ?? 1.6;
    this.maxMultiplier = options.maxMultiplier ?? 5;
    this.scoreScale = options.scoreScale ?? 16;
    this.refSpeed = options.refSpeed ?? 24;
    this.transitionBonus = options.transitionBonus ?? 150;
    this.angleSmoothing = options.angleSmoothing ?? 22;
    this.driftGrip = options.driftGrip ?? 0.6;
    this.gripRate = options.gripRate ?? 6;
    this.dragScale = options.dragScale ?? 0.25;
    this.assistGain = options.assistGain ?? 3;
    this.assistDamping = options.assistDamping ?? 2.2;
    this.maxTorque = options.maxTorque ?? 1;
    this.yawSign = options.yawSign ?? 1;
    this.boostThresholds = options.boostThresholds ?? [30, 65, 100];
    this.boostPower = options.boostPower ?? [0.35, 0.65, 1];
    this.boostDurations = options.boostDurations ?? [0.6, 1.0, 1.5];
    this.reset();
  }

  reset(options = {}) {
    const preserveBank = Boolean(options?.preserveBank);
    this.phase = PHASE_IDLE;
    this.drifting = false;
    this.angle = 0;
    this.angleRate = 0;
    this.direction = 0;
    this.lastDirection = 0;
    this.score = 0;
    if (!preserveBank) this.bank = 0;
    this.lastDriftScore = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.entryTimer = 0;
    this.graceTimer = 0;
    this.spinTimer = 0;
    this.driftTime = 0;
    this.boostCharge = 0;
    this.boostTimer = 0;
    this.boostLength = 0;
    this.boostStrength = 0;
    this.releaseBoost = 0;
    this.grip = 1;
    this.speedDrag = 0;
    this.stabilizerTorque = 0;
    this.event = null;
    return this.snapshot();
  }

  angleFromState(state = {}) {
    const velocity = state.velocity;
    if (!velocity) return 0;
    _vel.set(finite(velocity.x), 0, finite(velocity.z));
    if (_vel.lengthSq() < 0.0001) return 0;
    const forward = state.forward;
    const right = state.right;
    if (forward) _fwd.set(finite(forward.x), 0, finite(forward.z));
    else _fwd.set(0, 0, -1);
    if (right) _right.set(finite(right.x), 0, finite(right.z));
    else _right.set(1, 0, 0);
    if (_fwd.lengthSq() < 0.0001 || _right.lengthSq() < 0.0001) return 0;
    const longitudinal = _vel.dot(_fwd.normalize());
    const lateral = _vel.dot(_right.normalize());
    return Math.atan2(lateral, longitudinal);
  }

  quality(absAngle) {
    const x = (absAngle - this.idealAngle) / this.angleWidth;
    return Math.exp(-x * x);
  }

  tier() {
    let t = 0;
    for (let i = 0; i < this.boostThresholds.length; i++) {
      if (this.boostCharge >= this.boostThresholds[i]) t = i + 1;
    }
    return t;
  }

  beginDrift(angle) {
    const dir = Math.sign(angle) || 1;
    if (this.comboTimer > 0 && this.lastDirection !== 0 && dir !== this.lastDirection) {
      this.bank += Math.round(this.transitionBonus * this.multiplier);
      this.multiplier = Math.min(this.maxMultiplier, this.multiplier + 0.5);
      this.event = 'transition';
    } else {
      this.event = 'drift_start';
    }
    this.phase = PHASE_DRIFT;
    this.direction = dir;
    this.driftTime = 0;
    this.score = 0;
    this.boostCharge = 0;
    this.graceTimer = this.graceTime;
    this.spinTimer = 0;
    this.entryTimer = 0;
  }

  endDrift(reason) {
    if (reason === 'wipeout') {
      this.lastDriftScore = 0;
      this.multiplier = 1;
      this.comboTimer = 0;
      this.lastDirection = 0;
      this.boostTimer = 0;
      this.boostLength = 0;
      this.boostStrength = 0;
      this.event = 'wipeout';
    } else {
      const slowed = reason === 'slowed';
      const points = Math.round(this.score * (slowed ? 0.7 : 1));
      this.bank += points;
      this.lastDriftScore = points;
      const tier = this.tier();
      if (tier > 0) {
        this.boostStrength = this.boostPower[tier - 1] * (slowed ? 0.5 : 1);
        this.boostLength = this.boostDurations[tier - 1];
        this.boostTimer = this.boostLength;
      }
      this.multiplier = Math.min(this.maxMultiplier, this.multiplier + 0.5);
      this.comboTimer = this.comboWindow;
      this.lastDirection = this.direction;
      this.event = 'drift_end';
    }
    this.score = 0;
    this.boostCharge = 0;
    this.driftTime = 0;
    this.graceTimer = 0;
    this.spinTimer = 0;
    this.entryTimer = 0;
    this.phase = PHASE_IDLE;
  }

  update(dt, state) {
    state = state || {};
    const h = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const velocity = state.velocity;
    const speed = velocity ? Math.hypot(finite(velocity.x), finite(velocity.z)) : 0;
    const raw = finite(state.angle ?? this.angleFromState(state));
    const prev = this.angle;
    const blend = h > 0 ? damp(this.angleSmoothing, h) : 1;
    this.angle = wrapAngle(prev + wrapAngle(raw - prev) * blend);
    this.angleRate = h > 0 ? wrapAngle(this.angle - prev) / h : 0;

    const angle = this.angle;
    const abs = Math.abs(angle);
    const handbrake = Boolean(state.handbrake);
    const steerInput = Math.abs(finite(state.steerInput));
    const friction = clamp(finite(state.surfaceFriction, 1), 0.1, 1.2);
    const validSurface = state.surface !== 'cliff' && state.supported !== false;
    const crashed = Boolean(state.crashed);
    this.event = null;

    if (this.phase !== PHASE_DRIFT) {
      const candidate = validSurface && !crashed && speed >= this.minSpeed && abs <= this.maxAngle && (
        (handbrake && abs >= this.entryAngle) ||
        (!handbrake && abs >= this.steerEntryAngle && speed >= this.minSpeed * 1.2 && steerInput >= 0.25)
      );
      if (candidate) {
        this.phase = PHASE_ENTRY;
        this.entryTimer += h;
        const needed = handbrake ? this.handbrakeConfirmTime : this.confirmTime;
        if (this.entryTimer >= needed) this.beginDrift(angle);
      } else {
        this.entryTimer = Math.max(0, this.entryTimer - h * 3);
        if (this.entryTimer === 0) this.phase = PHASE_IDLE;
      }
    }

    if (this.phase === PHASE_DRIFT) {
      if (crashed || !validSurface) {
        this.endDrift('wipeout');
      } else {
        this.driftTime += h;
        if (abs > this.spinAngle) this.spinTimer += h;
        else this.spinTimer = Math.max(0, this.spinTimer - h * 2);

        const flipped = abs >= this.entryAngle && Math.sign(angle) !== this.direction && this.driftTime > 0.3;
        const sustain = speed >= this.sustainSpeed && abs >= this.sustainAngle;

        if (this.spinTimer >= this.spinTime) {
          this.endDrift('wipeout');
        } else if (flipped) {
          this.endDrift('recovered');
          this.beginDrift(angle);
        } else if (sustain) {
          this.graceTimer = this.graceTime;
          const q = this.quality(abs);
          const inControl = abs <= this.maxAngle ? 1 : 0;
          const speedFactor = clamp(speed / this.refSpeed, 0, 2.2);
          const timeFactor = 1 + Math.min(this.driftTime, 6) * 0.12;
          const brakeFactor = handbrake ? 1.1 : 1;
          this.multiplier = Math.min(this.maxMultiplier, this.multiplier + h * 0.2);
          this.score += h * this.scoreScale * speedFactor * (0.3 + 0.7 * q) * timeFactor * this.multiplier * friction * brakeFactor * inControl;
          this.boostCharge = Math.min(100, this.boostCharge + h * (6 + 14 * q * Math.min(speedFactor, 1.5)) * friction * inControl);
        } else {
          this.graceTimer -= h;
          if (this.graceTimer <= 0) this.endDrift(speed < this.sustainSpeed ? 'slowed' : 'recovered');
        }
      }
    }

    const drifting = this.phase === PHASE_DRIFT;
    this.drifting = drifting;

    if (drifting) {
      this.comboTimer = this.comboWindow;
    } else {
      this.comboTimer = Math.max(0, this.comboTimer - h);
      if (this.comboTimer <= 0) {
        this.multiplier = 1;
        this.lastDirection = 0;
      }
    }

    const gripTarget = drifting ? 1 - (1 - this.driftGrip) * clamp(abs / this.idealAngle, 0, 1) : 1;
    this.grip += (gripTarget - this.grip) * damp(this.gripRate, h);
    const sinA = Math.sin(Math.min(abs, Math.PI / 2));
    this.speedDrag = drifting ? this.dragScale * speed * sinA * sinA : 0;

    if (drifting) {
      const assist = clamp(finite(state.assist, 0.35), 0, 1) * (1 - 0.6 * clamp(steerInput, 0, 1));
      const s = this.yawSign;
      const yawRateN = finite(state.yawRate) * s;
      const err = wrapAngle(angle - this.direction * this.holdAngle);
      const desired = -err * this.assistGain;
      const torqueN = clamp((desired - yawRateN) * this.assistDamping, -this.maxTorque, this.maxTorque);
      this.stabilizerTorque = torqueN * s * assist;
    } else {
      this.stabilizerTorque = 0;
    }

    this.boostTimer = Math.max(0, this.boostTimer - h);
    this.releaseBoost = this.boostLength > 0 ? this.boostStrength * clamp(this.boostTimer / this.boostLength, 0, 1) : 0;

    return this.snapshot();
  }

  snapshot() {
    return {
      phase: PHASE_NAMES[this.phase],
      drifting: this.drifting,
      direction: this.direction,
      angle: this.angle,
      angleDeg: THREE.MathUtils.radToDeg(this.angle),
      angleRate: this.angleRate,
      driftTime: this.driftTime,
      score: this.score,
      bank: this.bank,
      lastDriftScore: this.lastDriftScore,
      multiplier: Math.max(1, Math.floor(this.multiplier)),
      multiplierExact: this.multiplier,
      comboTimer: this.comboTimer,
      boostCharge: this.boostCharge,
      boostTier: this.tier(),
      releaseBoost: this.releaseBoost,
      grip: this.grip,
      speedDrag: this.speedDrag,
      stabilizerTorque: this.stabilizerTorque,
      event: this.event,
    };
  }
}