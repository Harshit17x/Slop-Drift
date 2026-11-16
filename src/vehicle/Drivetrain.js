// Engine + gearbox for a rear-wheel-drive car. Pure numbers, no allocation.
// Gear index: -1 reverse, 0 neutral, 1..N forward.

const RPM_PER_RADS = 60 / (Math.PI * 2);

export class Drivetrain {
  constructor(tuning) {
    this.configure(tuning);
    this.reset();
  }

  configure(tuning) {
    this.t = tuning.drivetrain;
    this.wheelRadius = tuning.geometry.wheelRadius;
    this.gearCount = this.t.gearRatios.length;
  }

  reset() {
    this.gear = 1;
    this.rpm = this.t.idleRpm;
    this.engineRpm = this.t.idleRpm;
    this.shiftTimer = 0;
    this.shifted = false;
    this.limiter = false;
    this.clutchEngaged = false;
    this.driveForce = 0;
  }

  ratio(gear) {
    if (gear === -1) return this.t.reverseRatio;
    if (gear <= 0) return 0;
    return this.t.gearRatios[Math.min(gear, this.gearCount) - 1];
  }

  setGear(gear) {
    const g = Math.max(-1, Math.min(this.gearCount, gear | 0));
    if (g === this.gear) return;
    this.gear = g;
    this.shiftTimer = this.t.shiftTime;
    this.shifted = true;
  }

  torqueAt(rpm) {
    const curve = this.t.torqueCurve;
    if (rpm <= curve[0][0]) return curve[0][1] * this.t.peakTorque;
    for (let i = 1; i < curve.length; i++) {
      if (rpm <= curve[i][0]) {
        const a = curve[i - 1];
        const b = curve[i];
        const f = (rpm - a[0]) / (b[0] - a[0] || 1);
        return (a[1] + (b[1] - a[1]) * f) * this.t.peakTorque;
      }
    }
    return curve[curve.length - 1][1] * this.t.peakTorque;
  }

  wheelRpm(wheelOmega, gear) {
    return Math.abs(wheelOmega) * this.ratio(gear) * this.t.finalDrive * RPM_PER_RADS;
  }

  /**
   * @param {number} dt
   * @param {number} wheelOmega  Driven-wheel rolling speed, rad/s, + forward.
   * @param {number} throttle    0..1 drive demand (already mapped for reverse).
   * @param {boolean} auto
   * @param {number} shiftRequest -1, 0, +1 (manual only)
   * @param {number} boostMultiplier
   * @returns {number} Total longitudinal force at the driven contact patches, N (+ forward).
   */
  update(dt, wheelOmega, throttle, auto, shiftRequest, boostMultiplier) {
    const t = this.t;
    this.shifted = false;
    if (this.shiftTimer > 0) this.shiftTimer = Math.max(0, this.shiftTimer - dt);

    if (auto) {
      if (this.gear >= 1 && this.shiftTimer <= 0) {
        const rpm = this.wheelRpm(wheelOmega, this.gear);
        const movingForward = wheelOmega > 0;
        if (movingForward && rpm > t.upshiftRpm && this.gear < this.gearCount) {
          this.setGear(this.gear + 1);
        } else if (this.gear > 1) {
          const down = t.downshiftRpmCoast + (t.downshiftRpmPower - t.downshiftRpmCoast) * throttle;
          const lower = this.wheelRpm(wheelOmega, this.gear - 1);
          if (rpm < down && lower < t.upshiftRpm - 500) this.setGear(this.gear - 1);
        }
      }
    } else if (shiftRequest !== 0 && this.shiftTimer <= 0) {
      if (shiftRequest > 0) this.setGear(this.gear < 1 ? 1 : this.gear + 1);
      else if (this.gear > 1) this.setGear(this.gear - 1);
    }

    const gear = this.gear;
    const ratio = this.ratio(gear);
    let force = 0;
    if (gear === 0) {
      this.clutchEngaged = false;
      this.engineRpm = t.idleRpm + throttle * (t.redlineRpm - t.idleRpm) * 0.8;
    } else {
      const wheelRpm = this.wheelRpm(wheelOmega, gear);
      const launch = t.idleRpm + throttle * (t.launchRpm - t.idleRpm);
      this.clutchEngaged = wheelRpm >= t.idleRpm * 1.05;
      this.engineRpm = Math.max(wheelRpm, this.clutchEngaged ? t.idleRpm : launch);
      if (this.engineRpm > t.limiterRpm) this.limiter = true;
      else if (this.engineRpm < t.limiterRpm - 250) this.limiter = false;

      const k = ratio * t.finalDrive / this.wheelRadius;
      const shifting = this.shiftTimer > 0;
      const direction = gear === -1 ? -1 : 1;
      if (!shifting && throttle > 0 && !this.limiter) {
        force += this.torqueAt(this.engineRpm) * throttle * k * t.efficiency * direction * boostMultiplier;
      }
      if (!shifting && this.clutchEngaged) {
        const brakeTorque = (t.engineBrakeBase + t.engineBrakePerRpm * this.engineRpm) * (1 - throttle);
        force -= Math.sign(wheelOmega) * brakeTorque * k;
      }
    }
    const blend = 1 - Math.exp(-t.rpmSmoothing * dt);
    this.rpm += (this.engineRpm - this.rpm) * blend;
    this.driveForce = force;
    return force;
  }
}
