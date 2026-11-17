import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp, smoothstep, wrapAngle } from '../core/math.js';

export const CAMERA_MODES = Object.freeze(['chase', 'far', 'hood', 'cockpit']);

const MODE_LABELS = Object.freeze({ chase: 'CHASE', far: 'FAR', hood: 'HOOD', cockpit: 'COCKPIT' });
const UP = new THREE.Vector3(0, 1, 0);

const position = new THREE.Vector3();
const target = new THREE.Vector3();
const offset = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const desiredQuaternion = new THREE.Quaternion();
const lookQuaternion = new THREE.Quaternion();
const euler = new THREE.Euler();

/**
 * Follows the car. Exterior views trail the direction of travel rather than the nose, so in a
 * drift you look where the car is going; interior views are bolted to the chassis with a little
 * smoothing. The same rig orbits a point for the menu and the finish screen.
 */
export class CameraRig {
  constructor({ world }) {
    this.world = world;
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fovBase, 1, 0.12, 9000);
    this.mode = 'chase';
    this.yaw = 0; // smoothed heading the exterior camera sits behind
    this.slope = 0; // smoothed road pitch
    this.fov = CONFIG.camera.fovBase;
    this.shake = 0;
    this.shakeEnabled = true;
    this.orbitAngle = 0;
    this.blendTime = 1;
    this.blendFromPosition = new THREE.Vector3();
    this.blendFromQuaternion = new THREE.Quaternion();
    this.interiorQuaternion = new THREE.Quaternion();
    this.needsSnap = true;
    this.clock = 0;
  }

  get label() {
    return MODE_LABELS[this.mode];
  }

  setMode(mode) {
    if (!CAMERA_MODES.includes(mode) || mode === this.mode) return;
    this.mode = mode;
    this.startBlend();
  }

  cycle() {
    this.setMode(CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length]);
  }

  /** Ease from wherever the camera is now into whatever it is asked to show next. */
  startBlend() {
    this.blendFromPosition.copy(this.camera.position);
    this.blendFromQuaternion.copy(this.camera.quaternion);
    this.blendTime = 0;
  }

  /** Drop all smoothing on the next update (after a teleport or respawn). */
  snap() {
    this.needsSnap = true;
  }

  addShake(amount) {
    this.shake = Math.min(1.2, this.shake + amount);
  }

  resize(width, height) {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} dt
   * @param {import('../core/contracts.js').VehicleState} state
   * @param {{freeLook?: {x:number,y:number,active:boolean}, lookBack?: boolean}} input
   */
  follow(dt, state, input = null) {
    this.clock += dt;
    const speed = state.speed;
    const forward = state.forward;
    const lookBack = Boolean(input?.lookBack);
    const freeLook = input?.freeLook?.active ? input.freeLook : null;

    // Heading to sit behind: the nose at low speed, blending toward the travel direction as speed builds.
    let headingX = forward.x;
    let headingZ = forward.z;
    if (speed > 4 && state.forwardSpeed > -1) {
      const travel = 0.6 * smoothstep(4, 16, speed);
      const planarSpeed = Math.hypot(state.velocity.x, state.velocity.z) || 1;
      headingX += (state.velocity.x / planarSpeed - headingX) * travel;
      headingZ += (state.velocity.z / planarSpeed - headingZ) * travel;
    }
    const wantedYaw = Math.atan2(headingX, -headingZ);
    const wantedSlope = clamp(forward.y, -0.35, 0.35);
    if (this.needsSnap) {
      this.yaw = wantedYaw;
      this.slope = wantedSlope;
      this.interiorQuaternion.copy(state.quaternion);
      this.blendTime = 1;
    } else {
      this.yaw += wrapAngle(wantedYaw - this.yaw) * (1 - Math.exp(-5.2 * dt));
      this.slope = damp(this.slope, wantedSlope, 3.5, dt);
    }

    let fovTarget = CONFIG.camera.fovBase + CONFIG.camera.fovSpeedGain * smoothstep(8, 62, speed) + (state.boosting ? 5 : 0);

    if (this.mode === 'hood' || this.mode === 'cockpit') {
      // Bolted to the chassis; a fast slerp takes the harshness out of bumps without feeling detached.
      this.interiorQuaternion.slerp(state.quaternion, 1 - Math.exp(-22 * dt));
      if (this.mode === 'hood') offset.set(0, 1.3, -0.6);
      else offset.set(-0.37, 1.2, 0.12);
      position.copy(offset).applyQuaternion(state.quaternion).add(state.position);
      euler.set(freeLook ? freeLook.y : 0, (freeLook ? freeLook.x : 0) + (lookBack ? Math.PI : 0), 0, 'YXZ');
      desiredQuaternion.copy(this.interiorQuaternion).multiply(lookQuaternion.setFromEuler(euler));
      fovTarget += this.mode === 'cockpit' ? 8 : 4;
    } else {
      const far = this.mode === 'far';
      const distance = (far ? 11.5 : 6.3) + Math.min(2.4, speed * 0.036);
      const height = (far ? 4.6 : 2.15) + Math.min(0.7, speed * 0.01);
      let yaw = this.yaw + (lookBack ? Math.PI : 0);
      let pitchLift = 0;
      if (freeLook) {
        yaw -= freeLook.x;
        pitchLift = -freeLook.y * distance;
      }
      const dirX = Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      // Behind a climbing car the road is lower, so the camera drops with the slope to keep the horizon in view.
      position.set(
        state.position.x - dirX * distance,
        state.position.y + height - this.slope * distance * (lookBack ? -0.7 : 0.7) + pitchLift,
        state.position.z - dirZ * distance,
      );
      const floor = this.world.heightAt(position.x, position.z) + 0.9;
      if (position.y < floor) position.y = floor;
      const lead = 4 + Math.min(7, speed * 0.12);
      target.set(
        state.position.x + dirX * lead,
        state.position.y + 1.05 + this.slope * lead * (lookBack ? -1 : 1),
        state.position.z + dirZ * lead,
      );
      lookMatrix.lookAt(position, target, UP);
      desiredQuaternion.setFromRotationMatrix(lookMatrix);
    }

    this.applyShake(dt, state);
    this.finish(dt, fovTarget);
  }

  /** Slow orbit around a point (menu backdrop, finish screen). */
  orbit(dt, focus, { radius = 9, height = 3.2, speed = 0.12 } = {}) {
    this.clock += dt;
    this.orbitAngle += speed * dt;
    position.set(focus.x + Math.cos(this.orbitAngle) * radius, focus.y + height, focus.z + Math.sin(this.orbitAngle) * radius);
    const floor = this.world.heightAt(position.x, position.z) + 1.2;
    if (position.y < floor) position.y = floor;
    target.set(focus.x, focus.y + 0.9, focus.z);
    lookMatrix.lookAt(position, target, UP);
    desiredQuaternion.setFromRotationMatrix(lookMatrix);
    this.shake = 0;
    this.finish(dt, CONFIG.camera.fovBase - 8);
  }

  applyShake(dt, state) {
    if (!this.shakeEnabled) {
      this.shake = 0;
      return;
    }
    if (state.impact > 1.5) this.addShake(Math.min(0.9, state.impact * 0.07));
    if (state.landing > 2) this.addShake(Math.min(0.6, state.landing * 0.06));
    // Constant low rumble from speed, stronger on loose ground.
    const rough = state.wheelsOnGround > 0 && state.surface !== 0 ? 0.035 : 0.006;
    const rumble = rough * smoothstep(6, 55, state.speed);
    const amount = this.shake * 0.11 + rumble;
    if (amount > 0) {
      const t = this.clock;
      position.x += (Math.sin(t * 61.3) + Math.sin(t * 97.1 + 1.3)) * 0.5 * amount;
      position.y += (Math.sin(t * 71.9 + 0.7) + Math.sin(t * 113.3)) * 0.5 * amount;
    }
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  finish(dt, fovTarget) {
    const camera = this.camera;
    if (this.blendTime < 1) {
      this.blendTime = Math.min(1, this.blendTime + dt / CONFIG.camera.blendSeconds);
      const t = this.blendTime * this.blendTime * (3 - 2 * this.blendTime);
      camera.position.lerpVectors(this.blendFromPosition, position, t);
      camera.quaternion.slerpQuaternions(this.blendFromQuaternion, desiredQuaternion, t);
    } else {
      camera.position.copy(position);
      camera.quaternion.copy(desiredQuaternion);
    }
    this.fov = this.needsSnap ? fovTarget : damp(this.fov, fovTarget, 3, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    this.needsSnap = false;
  }
}
