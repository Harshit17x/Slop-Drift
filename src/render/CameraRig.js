import * as THREE from 'three';
import { COCKPIT_EYE } from './Cockpit.js';
import { CONFIG } from '../config.js';
import { clamp, damp, dampFactor, smoothstep, wrapAngle } from '../core/math.js';

export const CAMERA_MODES = Object.freeze(['chase', 'far', 'hood', 'cockpit']);

const MODE_LABELS = Object.freeze({ chase: 'CHASE', far: 'FAR', hood: 'HOOD', cockpit: 'COCKPIT' });
const UP = new THREE.Vector3(0, 1, 0);
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Chase-camera tuning. Kept together so the whole feel reads as one unit:
 * `yaw*` controls how quickly the camera swings behind a slide, `*Rate` values are
 * exponential approach rates (1/s) and are frame-rate independent.
 */
const TUNING = Object.freeze({
  yawRateLow: 7.2,
  yawRateHigh: 5.2,
  yawMaxRateLow: 7.0,
  yawMaxRateHigh: 4.6,
  slopeRate: 3.8,
  distanceRate: 3.0,
  heightRate: 3.2,
  lateralRate: 4.6,
  rollRate: 5.2,
  driftAttack: 7.5,
  driftRelease: 2.4,
  boostAttack: 16,
  boostRelease: 3.4,
  gRate: 6.5,
  fovAttack: 6.2,
  fovRelease: 2.7,
  // How much of the slide the camera keeps in frame: 0 = pure travel direction,
  // 1 = pure nose. A lower hold shows the car's angle without losing the nose.
  noseHold: 0.34,
  noseHoldDrift: 0.14,
  yawLook: 0.04,
  yawLookMax: 0.12,
  lateralG: 0.22,
  lateralSlip: 0.018,
  lateralMax: 0.55,
  rollG: 0.03,
  rollYaw: 0.012,
  rollMax: 0.06,
  anchorYRate: 16,
  speedFovStart: 6,
  speedFovEnd: 58,
  driftFov: 3.2,
  boostFov: 5.5,
  chaseDistance: 6.0,
  chaseDistanceGain: 2.8,
  chaseHeight: 2.12,
  chaseHeightGain: -0.2,
  farDistance: 11.4,
  farDistanceGain: 1.8,
  farHeight: 4.55,
  farHeightGain: 0.4,
  driftPull: 0.55,
  driftLift: 0.1,
  boostPull: 0.35,
});

const position = new THREE.Vector3();
const target = new THREE.Vector3();
const offset = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const desiredQuaternion = new THREE.Quaternion();
const lookQuaternion = new THREE.Quaternion();
const euler = new THREE.Euler();

/**
 * Follows the car. Exterior views trail the direction of travel rather than the nose, so in a
 * drift you see the car rotate inside the frame while the camera keeps looking where it is
 * actually going. Lateral acceleration shifts and banks the camera, and speed pulls it back
 * and opens the field of view. Interior views are bolted to the chassis with a little
 * smoothing. The same rig orbits a point for the menu and the finish screen.
 */
export class CameraRig {
  constructor({ world }) {
    this.world = world;
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fovBase, 1, 0.12, 9000);
    this.mode = 'chase';
    this.yaw = 0; // smoothed heading the exterior camera sits behind
    this.slope = 0; // smoothed road pitch
    this.anchorY = 0; // suspension-smoothed car height
    this.distance = TUNING.chaseDistance;
    this.height = TUNING.chaseHeight;
    this.lateral = 0; // smoothed sideways offset through a corner
    this.roll = 0; // smoothed camera bank
    this.drift = 0; // smoothed 0..1 slide strength
    this.boost = 0; // smoothed 0..1 nitro
    this.gLat = 0; // smoothed lateral acceleration (g)
    this.latSpeed = 0; // smoothed sideways velocity (m/s)
    this.yawRate = 0; // smoothed chassis yaw rate (rad/s)
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
    const planarSpeed = Math.hypot(state.velocity.x, state.velocity.z);
    const forward = state.forward;
    const lookBack = Boolean(input?.lookBack);
    const freeLook = input?.freeLook?.active ? input.freeLook : null;
    const snap = this.needsSnap;
    const speedT = smoothstep(TUNING.speedFovStart, TUNING.speedFovEnd, planarSpeed);

    // ---- slide detection: the angle between where the nose points and where the car is going
    const noseYaw = Math.atan2(forward.x, -forward.z);
    let wantedYaw = noseYaw;
    let travelYaw = noseYaw;
    let slipYaw = 0;
    let driftTarget = 0;
    const sliding = planarSpeed > 1.8 && state.forwardSpeed > 0.4;
    if (sliding) {
      travelYaw = Math.atan2(state.velocity.x, -state.velocity.z);
      slipYaw = wrapAngle(noseYaw - travelYaw);
      driftTarget = smoothstep(0.1, 0.6, Math.abs(slipYaw)) * smoothstep(4, 16, planarSpeed);
    }
    this.drift = snap
      ? driftTarget
      : damp(this.drift, driftTarget, driftTarget > this.drift ? TUNING.driftAttack : TUNING.driftRelease, dt);
    if (sliding) {
      // Keep a slice of the nose so the front wheels stay in shot at big angles.
      const noseHold = TUNING.noseHold - TUNING.noseHoldDrift * this.drift;
      const travelWeight = smoothstep(2, 9, planarSpeed);
      wantedYaw = noseYaw + wrapAngle(travelYaw + slipYaw * noseHold - noseYaw) * travelWeight;
    }

    // Smooth the forces that move the camera so a single bump or curb cannot kick it.
    const boostTarget = state.boosting && state.wheelsOnGround > 0 ? 1 : 0;
    this.boost = snap
      ? boostTarget
      : damp(this.boost, boostTarget, boostTarget > this.boost ? TUNING.boostAttack : TUNING.boostRelease, dt);
    this.gLat = snap ? clamp(state.gLat, -2.2, 2.2) : damp(this.gLat, clamp(state.gLat, -2.2, 2.2), TUNING.gRate, dt);
    this.latSpeed = snap
      ? clamp(state.lateralSpeed, -18, 18)
      : damp(this.latSpeed, clamp(state.lateralSpeed, -18, 18), TUNING.gRate, dt);
    this.yawRate = snap
      ? clamp(state.yawRate, -3.5, 3.5)
      : damp(this.yawRate, clamp(state.yawRate, -3.5, 3.5), TUNING.gRate, dt);

    // Look a little into the corner; lateral acceleration points at the corner's centre,
    // so this is what makes a turn-in feel deliberate without guessing from yaw rate.
    const look = clamp(this.gLat * TUNING.yawLook, -TUNING.yawLookMax, TUNING.yawLookMax)
      * smoothstep(2, 10, planarSpeed);
    wantedYaw = wrapAngle(wantedYaw + look);

    const wantedSlope = clamp(forward.y, -0.45, 0.45);
    if (snap) {
      this.yaw = wantedYaw;
      this.slope = wantedSlope;
      this.anchorY = state.position.y;
      this.blendTime = 1;
      this.interiorQuaternion.copy(state.quaternion);
    } else {
      // Faster at low speed so parking and hairpins stay connected, calmer at top speed.
      const yawRate = TUNING.yawRateHigh + (TUNING.yawRateLow - TUNING.yawRateHigh) * (1 - speedT);
      const maxYaw = TUNING.yawMaxRateHigh + (TUNING.yawMaxRateLow - TUNING.yawMaxRateHigh) * (1 - speedT);
      const step = clamp(wrapAngle(wantedYaw - this.yaw) * dampFactor(yawRate, dt), -maxYaw * dt, maxYaw * dt);
      this.yaw = wrapAngle(this.yaw + step);
      this.slope = damp(this.slope, wantedSlope, TUNING.slopeRate, dt);
      // A fast spring on height soaks up suspension chatter and crests without letting the car
      // leave the frame; the small velocity term keeps big jumps from lagging behind.
      this.anchorY = damp(this.anchorY, state.position.y + state.velocity.y * 0.03, TUNING.anchorYRate, dt);
    }

    // ---- framing
    const far = this.mode === 'far';
    const distanceTarget = (far ? TUNING.farDistance : TUNING.chaseDistance)
      + (far ? TUNING.farDistanceGain : TUNING.chaseDistanceGain) * speedT
      + TUNING.driftPull * this.drift + TUNING.boostPull * this.boost;
    const heightTarget = (far ? TUNING.farHeight : TUNING.chaseHeight)
      + (far ? TUNING.farHeightGain : TUNING.chaseHeightGain) * speedT
      + TUNING.driftLift * this.drift;
    const lateralTarget = lookBack ? 0 : clamp(
      -this.gLat * TUNING.lateralG - this.latSpeed * TUNING.lateralSlip,
      -TUNING.lateralMax,
      TUNING.lateralMax,
    ) * smoothstep(5, 22, planarSpeed);
    // The physics yaw rate is positive for a left turn, so negate it to bank with gLat.
    const rollTarget = lookBack ? 0 : clamp(
      this.gLat * TUNING.rollG - this.yawRate * TUNING.rollYaw,
      -TUNING.rollMax,
      TUNING.rollMax,
    ) * smoothstep(4, 18, planarSpeed);

    if (snap) {
      this.distance = distanceTarget;
      this.height = heightTarget;
      this.lateral = lateralTarget;
      this.roll = 0;
      this.shake = 0;
    } else {
      this.distance = damp(this.distance, distanceTarget, TUNING.distanceRate, dt);
      this.height = damp(this.height, heightTarget, TUNING.heightRate, dt);
      this.lateral = damp(this.lateral, lateralTarget, TUNING.lateralRate, dt);
      this.roll = damp(this.roll, rollTarget, TUNING.rollRate, dt);
    }

    const speedFov = CONFIG.camera.fovSpeedGain * smoothstep(TUNING.speedFovStart, TUNING.speedFovEnd, planarSpeed);
    let fovTarget;
    if (this.mode === 'hood' || this.mode === 'cockpit') {
      const cockpit = this.mode === 'cockpit';
      const interiorSpeedFov = speedFov * (cockpit ? 0.55 : 0.8);
      this.interiorQuaternion.slerp(state.quaternion, 1 - Math.exp(-22 * dt));
      if (this.mode === 'hood') offset.set(0, 1.3, -0.6);
      // Driver's eye in the seat (chassis space plus the chassis' 0.13 m ride height).
      else offset.set(COCKPIT_EYE.x, COCKPIT_EYE.y + 0.13, COCKPIT_EYE.z);
      position.copy(offset).applyQuaternion(state.quaternion).add(state.position);
      // In the seat the head tips a little down, so the dash, the wheel and the hands sit in view.
      const headTilt = cockpit && !lookBack ? -0.1 : 0;
      euler.set((freeLook ? freeLook.y : 0) + headTilt, (freeLook ? freeLook.x : 0) + (lookBack ? Math.PI : 0), 0, 'YXZ');
      desiredQuaternion.copy(this.interiorQuaternion).multiply(lookQuaternion.setFromEuler(euler));
      fovTarget = CONFIG.camera.fovBase + interiorSpeedFov + (cockpit ? 7 : 3) + 4.5 * this.boost;
    } else {
      let yaw = this.yaw + (lookBack ? Math.PI : 0);
      let pitchLift = 0;
      if (freeLook) {
        yaw -= freeLook.x;
        pitchLift = -freeLook.y * this.distance;
      }
      const dirX = Math.sin(yaw);
      const dirZ = -Math.cos(yaw);
      const rightX = Math.cos(yaw);
      const rightZ = Math.sin(yaw);
      const lateral = this.lateral * (lookBack ? 0.35 : 1);
      // Behind a climbing car the road is lower, so the camera drops with the slope to keep the
      // horizon in view. Nitro and slides pull it back a touch for a wider, faster frame.
      position.set(
        state.position.x - dirX * this.distance + rightX * lateral,
        this.anchorY + this.height - this.slope * this.distance * (lookBack ? -0.7 : 0.7) + pitchLift,
        state.position.z - dirZ * this.distance + rightZ * lateral,
      );
      const floor = this.world.heightAt(position.x, position.z) + 0.85;
      if (position.y < floor) position.y = floor;

      const lead = 4.2 + Math.min(8, planarSpeed * 0.12) + this.drift * 1.2;
      target.set(
        state.position.x + dirX * lead,
        this.anchorY + 1.02 + this.slope * lead * (lookBack ? -1 : 1) + this.drift * 0.12,
        state.position.z + dirZ * lead,
      );
      lookMatrix.lookAt(position, target, UP);
      desiredQuaternion.setFromRotationMatrix(lookMatrix);
      if (this.roll !== 0) {
        desiredQuaternion.multiply(lookQuaternion.setFromAxisAngle(ROLL_AXIS, this.roll));
      }
      fovTarget = CONFIG.camera.fovBase + speedFov
        + TUNING.driftFov * this.drift + TUNING.boostFov * this.boost;
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
    // Squaring the trauma makes big hits dramatic and small scrapes almost imperceptible.
    const trauma = this.shake * this.shake * 0.09;
    const rough = state.wheelsOnGround > 0 && state.surface !== 0 ? 0.03 : 0.005;
    const amount = trauma + rough * smoothstep(8, 55, state.speed);
    if (amount > 0) {
      const t = this.clock;
      position.x += (Math.sin(t * 61.3) + Math.sin(t * 97.1 + 1.3)) * 0.5 * amount;
      position.y += (Math.sin(t * 71.9 + 0.7) + Math.sin(t * 113.3)) * 0.5 * amount;
    }
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  finish(dt, fovTarget) {
    const camera = this.camera;
    // The steering wheel and hands are a few tens of centimetres from the eye.
    const near = this.mode === 'cockpit' ? 0.06 : 0.12;
    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    if (this.blendTime < 1) {
      this.blendTime = Math.min(1, this.blendTime + dt / CONFIG.camera.blendSeconds);
      const t = this.blendTime * this.blendTime * (3 - 2 * this.blendTime);
      camera.position.lerpVectors(this.blendFromPosition, position, t);
      camera.quaternion.slerpQuaternions(this.blendFromQuaternion, desiredQuaternion, t);
    } else {
      camera.position.copy(position);
      camera.quaternion.copy(desiredQuaternion);
    }
    this.fov = this.needsSnap
      ? fovTarget
      : damp(this.fov, fovTarget, fovTarget > this.fov ? TUNING.fovAttack : TUNING.fovRelease, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    this.needsSnap = false;
  }
}
