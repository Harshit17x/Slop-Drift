// Records a run as a GhostData at a fixed sample rate, independent of the frame rate.
//
//   const recorder = new GhostRecorder({ rate: 10 });
//   recorder.start('sprint', 'Harsh', 'ember');
//   every frame:      recorder.sample(runClock, vehicle.getState());
//   after a respawn:  recorder.markTeleport(runClock, vehicle.getState());
//   at the finish:    const ghost = recorder.finish(runClock, score);   // or recorder.discard()
//
// Sample i holds the pose at exactly t = i / rate. Frames rarely land on those instants, so each sample
// is interpolated between the two frames around it (lerp / slerp); a slow frame therefore never skips
// or duplicates a sample, and 30, 60 or 144 Hz frame steps give the same ghost.
import * as THREE from 'three';
import { GHOST_VERSION, STEER_SCALE, STEER_TELEPORT } from './ghostCodec.js';

const DEFAULT_MAX_SECONDS = 1800;

export class GhostRecorder {
  /**
   * @param {object} [options]
   * @param {number} [options.rate=10]          Samples per second.
   * @param {number} [options.maxSeconds=1800]  Recording stops (silently) after this long.
   */
  constructor({ rate = 10, maxSeconds = DEFAULT_MAX_SECONDS } = {}) {
    this.rate = Math.max(1, Math.min(120, Math.round(rate)));
    this.maxSamples = Math.max(2, Math.ceil(maxSeconds * this.rate) + 1);
    this.recording = false;
    this.capacity = 0;
    this.positions = new Float32Array(0);
    this.rotations = new Int16Array(0);
    this.steer = new Int8Array(0);
    this.count = 0;
    // The previous frame, kept to interpolate samples that fall between frames.
    this.prevTime = 0;
    this.prevPosition = new THREE.Vector3();
    this.prevQuaternion = new THREE.Quaternion();
    this.prevVelocity = new THREE.Vector3();
    this.prevSteer = 0;
    this.hasPrev = false;
    this.teleportPending = false;
    this.lastStored = new THREE.Quaternion();
    this._position = new THREE.Vector3();
    this._quaternion = new THREE.Quaternion();
  }

  get active() {
    return this.recording;
  }

  /**
   * Begin a new recording; any previous one is dropped.
   * @param {string} modeId  Track key of the run (src/meta/trackKey.js); stored as the ghost's modeId.
   */
  start(modeId, name = '', paint = '') {
    this.modeId = String(modeId ?? '');
    this.name = String(name ?? '');
    this.paint = String(paint ?? '');
    this.count = 0;
    this.hasPrev = false;
    this.teleportPending = false;
    this.recording = true;
    this.ensureCapacity(Math.min(this.maxSamples, this.rate * 240));
  }

  /**
   * Call every frame with the run clock (seconds since the start; negative times are ignored).
   * @param {number} time
   * @param {import('../core/contracts.js').VehicleState} state
   */
  sample(time, state) {
    if (!this.recording || !state || !(time >= 0) || !validState(state)) return;
    if (!this.hasPrev) {
      // Nothing before this frame: the first sample takes the first pose seen.
      this.setPrev(time, state);
      this.write(state.position, state.quaternion, state.steerAngle);
      return;
    }
    if (time < this.prevTime) return;
    this.fillUntil(time, state);
    this.setPrev(time, state);
  }

  /**
   * The car was just moved (respawn). Call after the vehicle has been teleported, with its new state:
   * samples before `time` hold the old pose, and the next sample snaps to the new one.
   */
  markTeleport(time, state) {
    if (!this.recording || !state || !validState(state)) return;
    if (this.hasPrev && time > this.prevTime) {
      // Samples due before the jump hold the last pre-teleport pose.
      while (this.count < this.maxSamples && this.count / this.rate <= time) {
        this.write(this.prevPosition, this.prevQuaternion, this.prevSteer);
      }
    }
    if (this.count > 0) this.teleportPending = true;
    this.setPrev(Math.max(0, time), state);
    if (this.count === 0) this.write(state.position, state.quaternion, state.steerAngle);
  }

  /**
   * Stop recording and return the ghost (null when fewer than two samples were recorded).
   * @param {number} time   Final run clock (also stored as the ghost's time).
   * @param {number} [score=0]
   * @returns {import('../core/contracts.js').GhostData|null}
   */
  finish(time, score = 0) {
    if (!this.recording) return null;
    this.recording = false;
    if (this.hasPrev && Number.isFinite(time)) {
      // The last sample usually falls a fraction of a sample before the finish: add one more at or after
      // it, extrapolated from the last frame at constant velocity, so the ghost reaches the line.
      const target = Math.min(time + 1 / this.rate - 1e-9, this.prevTime + 1);
      while (this.count < this.maxSamples && this.count / this.rate <= target) {
        const dt = this.count / this.rate - this.prevTime;
        this._position.copy(this.prevPosition).addScaledVector(this.prevVelocity, Math.max(0, dt));
        this.write(this._position, this.prevQuaternion, this.prevSteer);
      }
    }
    if (this.count < 2) return null;
    const count = this.count;
    return {
      version: GHOST_VERSION,
      modeId: this.modeId,
      name: this.name,
      time: Number.isFinite(time) ? time : (count - 1) / this.rate,
      score: Number.isFinite(score) ? score : 0,
      rate: this.rate,
      count,
      positions: this.positions.slice(0, count * 3),
      rotations: this.rotations.slice(0, count * 4),
      steer: this.steer.slice(0, count),
      paint: this.paint,
    };
  }

  /** Stop recording and throw the samples away. */
  discard() {
    this.recording = false;
    this.count = 0;
    this.hasPrev = false;
    this.teleportPending = false;
  }

  // ---------------------------------------------------------------- internals

  setPrev(time, state) {
    this.prevTime = time;
    this.prevPosition.copy(state.position);
    this.prevQuaternion.copy(state.quaternion);
    if (state.velocity) this.prevVelocity.copy(state.velocity);
    else this.prevVelocity.set(0, 0, 0);
    this.prevSteer = Number.isFinite(state.steerAngle) ? state.steerAngle : 0;
    this.hasPrev = true;
  }

  /** Write every sample due at or before `time`, interpolating between the previous frame and `state`. */
  fillUntil(time, state) {
    const span = time - this.prevTime;
    while (this.count < this.maxSamples && this.count / this.rate <= time) {
      const t = this.count / this.rate;
      const f = span > 1e-9 ? Math.min(1, Math.max(0, (t - this.prevTime) / span)) : 1;
      this._position.lerpVectors(this.prevPosition, state.position, f);
      this._quaternion.slerpQuaternions(this.prevQuaternion, state.quaternion, f);
      const steer = this.prevSteer + ((Number.isFinite(state.steerAngle) ? state.steerAngle : 0) - this.prevSteer) * f;
      this.write(this._position, this._quaternion, steer);
    }
  }

  write(position, quaternion, steerAngle) {
    if (this.count >= this.maxSamples) return;
    this.ensureCapacity(this.count + 1);
    const i = this.count;
    this.positions[i * 3] = position.x;
    this.positions[i * 3 + 1] = position.y;
    this.positions[i * 3 + 2] = position.z;
    // Keep consecutive quaternions in the same hemisphere: same rotation, smaller deltas to encode.
    let { x, y, z, w } = quaternion;
    const length = Math.hypot(x, y, z, w) || 1;
    let sign = 1 / length;
    if (i > 0 && x * this.lastStored.x + y * this.lastStored.y + z * this.lastStored.z + w * this.lastStored.w < 0) sign = -sign;
    x *= sign; y *= sign; z *= sign; w *= sign;
    this.lastStored.set(x, y, z, w);
    this.rotations[i * 4] = Math.round(x * 32767);
    this.rotations[i * 4 + 1] = Math.round(y * 32767);
    this.rotations[i * 4 + 2] = Math.round(z * 32767);
    this.rotations[i * 4 + 3] = Math.round(w * 32767);
    if (this.teleportPending) {
      this.steer[i] = STEER_TELEPORT;
      this.teleportPending = false;
    } else {
      this.steer[i] = Math.max(-127, Math.min(127, Math.round((steerAngle * 127) / STEER_SCALE) || 0));
    }
    this.count += 1;
  }

  ensureCapacity(n) {
    if (n <= this.capacity) return;
    const capacity = Math.min(this.maxSamples, Math.max(n, this.capacity * 2, 256));
    const positions = new Float32Array(capacity * 3);
    const rotations = new Int16Array(capacity * 4);
    const steer = new Int8Array(capacity);
    positions.set(this.positions.subarray(0, this.count * 3));
    rotations.set(this.rotations.subarray(0, this.count * 4));
    steer.set(this.steer.subarray(0, this.count));
    this.positions = positions;
    this.rotations = rotations;
    this.steer = steer;
    this.capacity = capacity;
  }
}

function validState(state) {
  const p = state.position;
  const q = state.quaternion;
  return p && q && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w);
}
