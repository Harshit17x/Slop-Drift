import { CONFIG } from '../config.js';

export class Drivetrain {
  constructor() {
    this.gear = 1;
    this.automatic = true;
    this.rpm = CONFIG.drivetrain.idleRPM;
    this.shiftTimer = 0;
    this.lastShift = 0;
    this.throttleLoad = 0;
    this.reverse = false;
  }

  setAutomatic(value) {
    this.automatic = Boolean(value);
  }

  toggleAutomatic() {
    this.automatic = !this.automatic;
    return this.automatic;
  }

  shiftUp() {
    if (this.reverse) this.reverse = false;
    else if (this.gear < CONFIG.drivetrain.gearRatios.length) this.gear += 1;
    this.shiftTimer = CONFIG.drivetrain.shiftTime;
    this.lastShift = 1;
  }

  shiftDown() {
    if (this.gear > 1) this.gear -= 1;
    this.shiftTimer = CONFIG.drivetrain.shiftTime;
    this.lastShift = -1;
  }

  setReverse(value) {
    this.reverse = Boolean(value);
    if (this.reverse) this.gear = 1;
  }

  getRatio() {
    return this.reverse ? -CONFIG.drivetrain.reverseRatio : CONFIG.drivetrain.gearRatios[this.gear - 1];
  }

  torqueAt(rpm) {
    const normalized = Math.max(0, Math.min(1, rpm / CONFIG.drivetrain.redlineRPM));
    const peak = CONFIG.drivetrain.torquePeakRPM / CONFIG.drivetrain.redlineRPM;
    const rise = Math.min(1, normalized / Math.max(0.01, peak));
    const fall = Math.max(0.42, 1 - Math.max(0, normalized - peak) * 0.65);
    return CONFIG.drivetrain.maxTorqueNm * (0.48 + rise * 0.52) * fall;
  }

  update(dt, { speedMps = 0, throttle = 0, brake = 0, manualUp = false, manualDown = false, launch = false } = {}) {
    this.lastShift = 0;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const absSpeed = Math.abs(speedMps);
    const ratio = Math.abs(this.getRatio()) * CONFIG.drivetrain.finalDrive;
    const wheelRPM = absSpeed > 0.25 ? (absSpeed / (2 * Math.PI * CONFIG.car.wheelRadius)) * 60 : 0;
    const targetRPM = Math.max(CONFIG.drivetrain.idleRPM, wheelRPM * ratio);
    const throttleTarget = launch ? Math.max(throttle, 0.35) : throttle;
    this.rpm += (targetRPM + throttleTarget * 900 - this.rpm) * Math.min(1, dt * 9);
    if (this.shiftTimer > 0) this.rpm *= 0.86;

    if (manualUp) this.shiftUp();
    if (manualDown) this.shiftDown();
    if (this.automatic && !this.reverse && this.shiftTimer <= 0) {
      if (this.rpm > CONFIG.drivetrain.shiftUpRPM && this.gear < CONFIG.drivetrain.gearRatios.length) this.shiftUp();
      else if (this.rpm < CONFIG.drivetrain.shiftDownRPM && this.gear > 1 && absSpeed > 12) this.shiftDown();
    }
    this.rpm = Math.max(CONFIG.drivetrain.idleRPM, Math.min(CONFIG.drivetrain.redlineRPM + 500, this.rpm));
    this.throttleLoad += (throttle - this.throttleLoad) * Math.min(1, dt * 8);

    const torque = this.torqueAt(Math.min(this.rpm, CONFIG.drivetrain.redlineRPM));
    const limiter = this.rpm >= CONFIG.drivetrain.redlineRPM ? CONFIG.drivetrain.revLimiterCut : 1;
    const driveForce = torque * ratio * CONFIG.drivetrain.drivetrainEfficiency / Math.max(0.2, CONFIG.car.wheelRadius) * Math.max(0, throttleTarget) * limiter;
    const engineBrake = throttleTarget < 0.05 ? CONFIG.drivetrain.engineBraking * Math.min(1, absSpeed / 20) : 0;
    return {
      gear: this.reverse ? 'R' : this.gear,
      gearNumber: this.reverse ? -1 : this.gear,
      ratio: this.getRatio(),
      rpm: this.rpm,
      torque,
      driveForce,
      engineBrake,
      shifting: this.shiftTimer > 0,
      lastShift: this.lastShift,
    };
  }
}
