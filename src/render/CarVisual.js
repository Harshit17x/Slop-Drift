import * as THREE from 'three';
import { NitroJets } from './NitroJets.js';
import { Cockpit, cockpitEye } from './Cockpit.js';
import { createCarModel } from './ModelCar.js';
import { getCar } from '../vehicle/cars.js';
import { bodyPoseTarget, smoothBodyPose } from './bodyPose.js';
import { CarLights } from './CarLights.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * The visible car: the procedural model plus headlights, driven straight from a VehicleState.
 * The physics owns all motion (body roll and pitch are in the chassis quaternion, wheel travel in each
 * wheel's compression); on top of that the body shell leans a little further the same way (bodyPose.js)
 * so the suspension reads from the chase camera.
 */
export class CarVisual {
  /**
   * @param {object} options
   * @param {number} options.color
   * @param {{x:number,y:number,z:number}[]} options.wheelLayout  Vehicle.wheelLayout (rest wheel centres).
   * @param {string} [options.carId]  An id from src/vehicle/cars.js.
   */
  constructor({ color = 0xe9eef5, wheelLayout, carId = 'hatch' }) {
    this.model = createCarModel(carId, { color, wheelLayout });
    this.group = this.model;
    this.carId = this.model.carDef ? carId : 'hatch';

    if (this.carId === 'hatch') {
      this.nitroJets = new NitroJets();
      this.model.add(this.nitroJets);
      this.model.materials.push(this.nitroJets.material);
    }
    // Headlights (off / low / high), tail, brake, high-mounted stop and reversing lamps, fitted to the model.
    this.lights = new CarLights(this.model, this.carId);
    this.night = false;

    // The drift-car interior for the cockpit camera. Built once, shown only in that view, when the
    // exterior shell (which would otherwise fill the windscreen from inside) is hidden.
    // Model cars keep their real body in view from inside (its panels face away from the driver and are
    // not drawn, so the bonnet and mirrors show through the glass); the hatch gets a modelled bonnet.
    const style = getCar(this.carId).cockpit;
    const procedural = !this.model.carDef;
    this.cockpit = new Cockpit({ paint: procedural ? this.model.bodyMaterial : null, stripe: procedural ? this.model.stripeMaterial : null, style });
    this.model.chassis.add(this.cockpit);
    this.interior = false;
    const eye = cockpitEye(style);
    /** Driver's eye in car space, for the cockpit camera. */
    this.cockpitEye = { ...eye, y: eye.y + this.model.chassisOffsetY };

    this.neonWanted = true;
    this.neonLevel = 0.2;

    // Visible suspension: geometry for turning wheel compressions into body attitude.
    const layout = wheelLayout?.length === 4 ? wheelLayout : null;
    this.poseGeometry = {
      trackFront: layout ? Math.abs(layout[1].x - layout[0].x) : 1.6,
      trackRear: layout ? Math.abs(layout[3].x - layout[2].x) : 1.6,
      wheelbase: layout ? Math.abs(layout[2].z - layout[0].z) : 2.6,
    };
    this.bodyPose = { roll: 0, pitch: 0, squat: 0 };
    this.bodyPoseTarget = { roll: 0, pitch: 0, squat: 0 };
  }

  /** Switch between the exterior car and the interior seen from the driver's seat. */
  setInteriorView(on) {
    on = Boolean(on);
    if (on === this.interior) return;
    this.interior = on;
    this.cockpit.visible = on;
    for (const child of this.model.chassis.children) {
      if (child !== this.cockpit && child !== this.model.bodyMesh) child.visible = !on;
    }
    for (const pivot of this.model.wheelPivots.values()) pivot.visible = !on;
    this.model.applyUnderglow(); // the loop above would have shown the tubes even when switched off
  }

  setColor(color) {
    this.model.setColor(color);
  }

  setQuality(quality) {
    this.model.setQuality?.(quality);
  }

  /**
   * Apply the player's cosmetics.
   * @param {{paint?: {color:number, metalness?:number, roughness?:number}, rimColor?: number, number?: string, neon?: {color:(number|null), cycle?:boolean}}} look
   */
  setLook({ paint, rimColor, number, neon } = {}) {
    if (paint) this.model.setPaint(paint);
    if (rimColor !== undefined) this.model.setRimColor(rimColor);
    if (number) this.model.setNumber(number);
    if (neon !== undefined) this.model.setUnderglow(neon);
  }

  /**
   * Underglow brightness for the time of day (see neonLevel in config.js), and the driver's own
   * on/off switch (G). The colour comes from setLook.
   */
  setNeon({ level = this.neonLevel, on = this.neonWanted } = {}) {
    this.neonLevel = level;
    this.neonWanted = Boolean(on);
    this.model.setUnderglowLevel(this.neonWanted ? level : 0);
  }

  /** True when an underglow colour is equipped (whether or not it is switched on). */
  get hasNeon() {
    return Boolean(this.model.underglow.option);
  }

  /** true / false, or a mode: 0 off, 1 low beam, 2 high beam. */
  setHeadlights(on) {
    this.lights.setHeadlights(on === true ? 1 : on === false ? 0 : on);
  }

  /** The lamp switch: off, low, high, off. Returns the new mode. */
  cycleHeadlights() {
    return this.lights.cycle();
  }

  get headlightsOn() {
    return this.lights.mode > 0;
  }

  get headlightMode() {
    return this.lights.mode;
  }

  /** Tail lamps stay lit at night even with the headlights switched off. */
  setNight(night) {
    this.night = Boolean(night);
  }

  /**
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {number} [dt]  Frame time, for the interior animation.
   */
  sync(state, dt = 1 / 60) {
    this.model.position.copy(state.position);
    this.model.quaternion.copy(state.quaternion);
    this.model.setSteering(state.steerAngle);
    const reversing = state.gear === 'R';
    this.lights.update({ braking: state.brake > 0.05 && !reversing, reversing, night: this.night }, dt);
    for (let i = 0; i < 4; i += 1) {
      const wheel = state.wheels[i];
      this.model.setSuspension(WHEEL_KEYS[i], wheel.compression);
      this.model.setWheelSpin(WHEEL_KEYS[i], wheel.spinAngle);
      if (this.carId === 'hatch') this.model.setTyreSurface(WHEEL_KEYS[i], wheel, state.speed, dt);
    }
    // Extra body lean from the suspension; none from the driver's seat (the eye is fixed to the car).
    if (this.interior) this.bodyPoseTarget.roll = this.bodyPoseTarget.pitch = this.bodyPoseTarget.squat = 0;
    else bodyPoseTarget(state.wheels, this.poseGeometry, this.bodyPoseTarget);
    smoothBodyPose(this.bodyPose, this.bodyPoseTarget, dt);
    this.model.setBodyDynamics?.(this.bodyPose);
    this.nitroJets?.update(dt, state.boosting);
    if (this.interior) this.cockpit.update(state, dt);

    let grounded = 0;
    for (let i = 0; i < 4; i += 1) if (state.wheels[i].contact) grounded += 0.25;
    this.model.updateUnderglow(dt, grounded);
  }

  dispose() {
    this.lights.dispose();
    this.cockpit.dispose();
    this.model.parent?.remove(this.model);
    this.model.dispose();
  }
}
