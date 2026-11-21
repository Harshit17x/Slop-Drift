import * as THREE from 'three';
import { ProceduralCar } from './ProceduralCar.js';
import { Cockpit } from './Cockpit.js';

const WHEEL_KEYS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

/**
 * The visible car: the procedural model plus headlights, driven straight from a VehicleState.
 * The physics owns all motion (body roll and pitch are in the chassis quaternion); this only mirrors it.
 */
export class CarVisual {
  /**
   * @param {object} options
   * @param {number} options.color
   * @param {{x:number,y:number,z:number}[]} options.wheelLayout  Vehicle.wheelLayout (rest wheel centres).
   */
  constructor({ color = 0xe9eef5, wheelLayout }) {
    const front = wheelLayout[0];
    const rear = wheelLayout[2];
    this.model = new ProceduralCar({
      color,
      wheelbase: Math.abs(front.z - rear.z),
      track: Math.abs(front.x) * 2,
      wheelCentreY: front.y,
    });
    this.group = this.model;

    this.headlights = [];
    for (const side of [-1, 1]) {
      const light = new THREE.SpotLight(0xfff1d6, 0, 90, THREE.MathUtils.degToRad(26), 0.55, 1.4);
      light.position.set(side * 0.6, 0.72, -2.05);
      light.target.position.set(side * 0.9, 0.1, -30);
      light.castShadow = false;
      this.model.add(light, light.target);
      this.headlights.push(light);
    }
    this.headlightsOn = false;

    // The drift-car interior for the cockpit camera. Built once, shown only in that view, when the
    // exterior shell (which would otherwise fill the windscreen from inside) is hidden.
    this.cockpit = new Cockpit({ paint: this.model.bodyMaterial, stripe: this.model.stripeMaterial });
    this.model.chassis.add(this.cockpit);
    this.interior = false;
  }

  /** Switch between the exterior car and the interior seen from the driver's seat. */
  setInteriorView(on) {
    on = Boolean(on);
    if (on === this.interior) return;
    this.interior = on;
    this.cockpit.visible = on;
    for (const child of this.model.chassis.children) {
      if (child !== this.cockpit) child.visible = !on;
    }
    for (const pivot of this.model.wheelPivots.values()) pivot.visible = !on;
  }

  setColor(color) {
    this.model.setColor(color);
  }

  /**
   * Apply the player's cosmetics.
   * @param {{paint?: {color:number, metalness?:number, roughness?:number}, rimColor?: number, number?: string}} look
   */
  setLook({ paint, rimColor, number } = {}) {
    if (paint) this.model.setPaint(paint);
    if (rimColor !== undefined) this.model.setRimColor(rimColor);
    if (number) this.model.setNumber(number);
  }

  setHeadlights(on) {
    this.headlightsOn = Boolean(on);
    for (const light of this.headlights) light.intensity = this.headlightsOn ? 260 : 0;
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
    this.model.setBraking(state.brake > 0.05 && !reversing);
    this.model.setReversing(reversing);
    for (let i = 0; i < 4; i += 1) {
      const wheel = state.wheels[i];
      this.model.setSuspension(WHEEL_KEYS[i], wheel.compression);
      this.model.setWheelSpin(WHEEL_KEYS[i], wheel.spinAngle);
    }
    if (this.interior) this.cockpit.update(state, dt);
  }

  dispose() {
    this.cockpit.dispose();
    this.model.parent?.remove(this.model);
    this.model.dispose();
  }
}
