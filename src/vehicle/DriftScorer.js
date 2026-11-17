// Drift detection and scoring. Reads the vehicle state; never feeds anything back into the physics.
// Ported from the scoring / combo logic of src/procedural/DriftModel.js (grip, torque and boost
// side effects removed).

import { SURFACE, SURFACE_PROPS } from '../config.js';
import { clamp, wrapAngle, DEG2RAD, RAD2DEG } from '../core/math.js';

const PHASE_IDLE = 0;
const PHASE_ENTRY = 1;
const PHASE_DRIFT = 2;
const PHASE_NAMES = ['idle', 'entry', 'drift'];

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export class DriftScorer {
  constructor(options = {}) {
    this.minSpeed = options.minSpeed ?? 11;
    this.sustainSpeed = options.sustainSpeed ?? this.minSpeed * 0.8;
    this.entryAngle = (options.entryAngleDeg ?? 12) * DEG2RAD;
    this.steerEntryAngle = (options.steerEntryAngleDeg ?? 20) * DEG2RAD;
    this.sustainAngle = this.entryAngle * 0.6;
    this.maxAngle = (options.maxAngleDeg ?? 72) * DEG2RAD;
    this.spinAngle = (options.spinAngleDeg ?? 88) * DEG2RAD;
    this.spinTime = options.spinTime ?? 0.3;
    this.idealAngle = (options.idealAngleDeg ?? 38) * DEG2RAD;
    this.angleWidth = (options.angleWidthDeg ?? 26) * DEG2RAD;
    this.confirmTime = options.confirmTime ?? 0.18;
    this.handbrakeConfirmTime = options.handbrakeConfirmTime ?? 0.07;
    this.graceTime = options.graceTime ?? 0.15;
    this.comboWindow = options.comboWindow ?? 1.6;
    this.maxMultiplier = options.maxMultiplier ?? 5;
    this.scoreScale = options.scoreScale ?? 16;
    this.refSpeed = options.refSpeed ?? 24;
    this.transitionBonus = options.transitionBonus ?? 150;
    this.angleSmoothing = options.angleSmoothing ?? 22;
    /** Impact speed (m/s) that counts as a crash and wipes the combo. */
    this.crashImpact = options.crashImpact ?? 6;
    this._snap = {
      phase: 'idle', active: false, direction: 0, angle: 0, angleDeg: 0, angleRate: 0, driftTime: 0,
      score: 0, bank: 0, lastDriftScore: 0, multiplier: 1, multiplierExact: 1,
      comboTimer: 0, comboWindow: this.comboWindow, quality: 0, event: null,
    };
    this.reset();
  }

  reset(options = {}) {
    this.phase = PHASE_IDLE;
    this.drifting = false;
    this.angle = 0;
    this.angleRate = 0;
    this.direction = 0;
    this.lastDirection = 0;
    this.score = 0;
    if (!options?.preserveBank) this.bank = 0;
    this.lastDriftScore = 0;
    this.multiplier = 1;
    this.comboTimer = 0;
    this.entryTimer = 0;
    this.graceTimer = 0;
    this.spinTimer = 0;
    this.driftTime = 0;
    this.lastQuality = 0;
    this.event = null;
    return this.snapshot();
  }

  /** Horizontal body slip angle from velocity and the chassis axes (+ = sliding to the right). */
  angleFromState(state) {
    const v = state.velocity;
    if (!v) return 0;
    const f = state.forward;
    const r = state.right;
    const fx = finite(f?.x, 0);
    const fz = finite(f?.z, -1);
    const rx = finite(r?.x, 1);
    const rz = finite(r?.z, 0);
    const fl = Math.hypot(fx, fz);
    const rl = Math.hypot(rx, rz);
    const vx = finite(v.x);
    const vz = finite(v.z);
    if (vx * vx + vz * vz < 1e-4 || fl < 1e-3 || rl < 1e-3) return 0;
    return Math.atan2((vx * rx + vz * rz) / rl, (vx * fx + vz * fz) / fl);
  }

  quality(absAngle) {
    const x = (absAngle - this.idealAngle) / this.angleWidth;
    return Math.exp(-x * x);
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
      this.event = 'wipeout';
    } else {
      const points = Math.round(this.score * (reason === 'slowed' ? 0.7 : 1));
      this.bank += points;
      this.lastDriftScore = points;
      this.multiplier = Math.min(this.maxMultiplier, this.multiplier + 0.5);
      this.comboTimer = this.comboWindow;
      this.lastDirection = this.direction;
      this.event = 'drift_end';
    }
    this.score = 0;
    this.driftTime = 0;
    this.graceTimer = 0;
    this.spinTimer = 0;
    this.entryTimer = 0;
    this.phase = PHASE_IDLE;
  }

  /**
   * @param {number} dt
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {import('../core/contracts.js').Controls} [controls]  Used for the steering-entry rule.
   */
  update(dt, state, controls = null) {
    state = state || {};
    const h = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    const velocity = state.velocity;
    const speed = velocity ? Math.hypot(finite(velocity.x), finite(velocity.z)) : 0;
    const raw = speed > 1.5 ? finite(this.angleFromState(state)) : 0;
    const prev = this.angle;
    const blend = h > 0 ? 1 - Math.exp(-this.angleSmoothing * h) : 1;
    this.angle = wrapAngle(prev + wrapAngle(raw - prev) * blend);
    this.angleRate = h > 0 ? wrapAngle(this.angle - prev) / h : 0;

    const angle = this.angle;
    const abs = Math.abs(angle);
    const handbrake = Boolean(state.handbrake ?? controls?.handbrake);
    const steerInput = Math.abs(finite(controls?.steer, finite(state.steerAngle) / (20 * DEG2RAD)));
    const props = SURFACE_PROPS[state.surface] || SURFACE_PROPS[SURFACE.ASPHALT];
    const friction = clamp(props.grip, 0.1, 1.2);
    const validSurface = !state.airborne && !state.upsideDown && state.surface !== SURFACE.WATER;
    const crashed = finite(state.impact) >= this.crashImpact;
    this.event = null;

    if (this.phase !== PHASE_DRIFT) {
      const candidate = validSurface && !crashed && speed >= this.minSpeed && abs <= this.maxAngle && (
        (handbrake && abs >= this.entryAngle)
        || (!handbrake && abs >= this.steerEntryAngle && speed >= this.minSpeed * 1.2 && steerInput >= 0.25)
      );
      if (candidate) {
        this.phase = PHASE_ENTRY;
        this.entryTimer += h;
        if (this.entryTimer >= (handbrake ? this.handbrakeConfirmTime : this.confirmTime)) this.beginDrift(angle);
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
          this.lastQuality = q;
          const inControl = abs <= this.maxAngle ? 1 : 0;
          const speedFactor = clamp(speed / this.refSpeed, 0, 2.2);
          const timeFactor = 1 + Math.min(this.driftTime, 6) * 0.12;
          const brakeFactor = handbrake ? 1.1 : 1;
          this.multiplier = Math.min(this.maxMultiplier, this.multiplier + h * 0.2);
          this.score += h * this.scoreScale * speedFactor * (0.3 + 0.7 * q) * timeFactor * this.multiplier * friction * brakeFactor * inControl;
        } else {
          this.graceTimer -= h;
          if (this.graceTimer <= 0) this.endDrift(speed < this.sustainSpeed ? 'slowed' : 'recovered');
        }
      }
    }

    this.drifting = this.phase === PHASE_DRIFT;
    if (this.drifting) {
      this.comboTimer = this.comboWindow;
    } else {
      this.comboTimer = Math.max(0, this.comboTimer - h);
      if (this.comboTimer <= 0) {
        this.multiplier = 1;
        this.lastDirection = 0;
      }
    }
    return this.snapshot();
  }

  /** Returns a reused object; copy fields you need to keep. */
  snapshot() {
    const s = this._snap;
    s.phase = PHASE_NAMES[this.phase];
    s.active = this.drifting;
    s.direction = this.direction;
    s.angle = this.angle;
    s.angleDeg = this.angle * RAD2DEG;
    s.angleRate = this.angleRate;
    s.driftTime = this.driftTime;
    s.score = Math.round(this.score);
    s.bank = this.bank;
    s.lastDriftScore = this.lastDriftScore;
    s.multiplier = Math.max(1, Math.floor(this.multiplier));
    s.multiplierExact = this.multiplier;
    s.comboTimer = this.comboTimer;
    s.comboWindow = this.comboWindow;
    s.quality = this.lastQuality;
    s.event = this.event;
    return s;
  }
}

export default DriftScorer;
