// Plays a GhostData back: pose at any run time, smoothly interpolated, allocation-free.
//
//   const player = new GhostPlayer(ghost);
//   const pose = player.poseAt(runClock, ghostPosition, ghostQuaternion);  // pose.steer, pose.finished
//
// Positions use cubic Hermite interpolation with finite-difference (Catmull-Rom) tangents, so the
// ghost's velocity is continuous across samples; rotations are slerped. A sample flagged as a
// teleport (respawn) starts a new segment: the ghost holds its last pose and then snaps, and tangents
// never reach across the jump. Times before the start or after the end clamp to the first / last pose.
import * as THREE from 'three';
import { STEER_SCALE, STEER_TELEPORT } from './ghostCodec.js';

export class GhostPlayer {
  /** @param {import('../core/contracts.js').GhostData} ghost */
  constructor(ghost) {
    const count = Math.max(0, Math.floor(ghost?.count || 0));
    this.ghost = ghost;
    this.count = count;
    this.rate = ghost?.rate > 0 ? ghost.rate : 10;
    this.modeId = ghost?.modeId ?? '';
    this.name = ghost?.name ?? '';
    this.paint = ghost?.paint ?? '';
    this.time = Number.isFinite(ghost?.time) ? ghost.time : 0;
    this.score = Number.isFinite(ghost?.score) ? ghost.score : 0;
    /** Seconds from the first to the last sample. */
    this.duration = count > 1 ? (count - 1) / this.rate : 0;

    this.positions = new Float64Array(count * 3);
    this.quaternions = new Float64Array(count * 4);
    this.steer = new Float32Array(count);
    /** 1 where a sample starts a new segment (the first sample, and every sample after a teleport). */
    this.segmentStart = new Uint8Array(count + 1);
    this.teleports = 0;

    for (let i = 0; i < count; i += 1) {
      for (let c = 0; c < 3; c += 1) {
        const v = ghost.positions[i * 3 + c];
        this.positions[i * 3 + c] = Number.isFinite(v) ? v : i > 0 ? this.positions[(i - 1) * 3 + c] : 0;
      }
      let x = ghost.rotations[i * 4] / 32767;
      let y = ghost.rotations[i * 4 + 1] / 32767;
      let z = ghost.rotations[i * 4 + 2] / 32767;
      let w = ghost.rotations[i * 4 + 3] / 32767;
      const length = Math.hypot(x, y, z, w);
      if (!(length > 1e-6)) {
        x = 0; y = 0; z = 0; w = 1;
      } else {
        x /= length; y /= length; z /= length; w /= length;
      }
      this.quaternions.set([x, y, z, w], i * 4);
      const raw = ghost.steer[i];
      const teleport = raw === STEER_TELEPORT;
      this.steer[i] = teleport ? 0 : (raw / 127) * STEER_SCALE;
      if (i === 0 || teleport) this.segmentStart[i] = 1;
      if (i > 0 && teleport) this.teleports += 1;
    }
    this.segmentStart[count] = 1; // sentinel: past the end is always a new segment.

    this.result = { steer: 0, finished: false };
    this._q = new Float64Array(4);
  }

  /**
   * Pose at run time `time` (seconds). Writes into the given objects and returns a shared result
   * object `{ steer, finished }` (radians; true once time has reached the end). Reuse it, do not keep it.
   * @param {number} time
   * @param {THREE.Vector3} outPosition
   * @param {THREE.Quaternion} outQuaternion
   */
  poseAt(time, outPosition, outQuaternion) {
    const result = this.result;
    const count = this.count;
    if (count === 0) {
      result.steer = 0;
      result.finished = true;
      return result;
    }
    const t = Number.isFinite(time) ? time : 0;
    result.finished = t >= this.duration;
    const u = Math.min(Math.max(t * this.rate, 0), count - 1);
    let i = Math.floor(u);
    let f = u - i;
    if (i >= count - 1) {
      i = count - 1;
      f = 0;
    }
    // Across a teleport, hold the pose before the jump until the jump's sample time.
    if (f > 0 && this.segmentStart[i + 1]) f = 0;

    const P = this.positions;
    const a = i * 3;
    if (f === 0) {
      outPosition.set(P[a], P[a + 1], P[a + 2]);
      outQuaternion.set(this.quaternions[i * 4], this.quaternions[i * 4 + 1], this.quaternions[i * 4 + 2], this.quaternions[i * 4 + 3]);
      result.steer = this.steer[i];
      return result;
    }

    // Cubic Hermite on [i, i+1] with tangents in units of "per sample".
    const j = i + 1;
    const b = j * 3;
    const hasBefore = !this.segmentStart[i];
    const hasAfter = j + 1 < count && !this.segmentStart[j + 1];
    const f2 = f * f;
    const f3 = f2 * f;
    const h00 = 2 * f3 - 3 * f2 + 1;
    const h10 = f3 - 2 * f2 + f;
    const h01 = -2 * f3 + 3 * f2;
    const h11 = f3 - f2;
    let x = 0;
    let y = 0;
    let z = 0;
    for (let c = 0; c < 3; c += 1) {
      const p0 = P[a + c];
      const p1 = P[b + c];
      const m0 = hasBefore ? (p1 - P[a - 3 + c]) * 0.5 : p1 - p0;
      const m1 = hasAfter ? (P[b + 3 + c] - p0) * 0.5 : p1 - p0;
      const v = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
      if (c === 0) x = v;
      else if (c === 1) y = v;
      else z = v;
    }
    outPosition.set(x, y, z);

    THREE.Quaternion.slerpFlat(this._q, 0, this.quaternions, i * 4, this.quaternions, j * 4, f);
    outQuaternion.set(this._q[0], this._q[1], this._q[2], this._q[3]);
    result.steer = this.steer[i] + (this.steer[j] - this.steer[i]) * f;
    return result;
  }
}
