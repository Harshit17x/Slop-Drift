// Visible suspension: the extra body roll, pitch and heave the car model shows on top of the physics.
//
// The physics chassis already rolls, dives and squats on its springs (that is in the chassis
// quaternion), and the wheels already move in their arches with each wheel's compression. A road
// car's 2-5 degrees reads clearly from the chase camera, a race car's half a degree barely does, so
// the body is turned a little further in the same direction as the springs: by `gain` times the
// attitude the wheel compressions imply. It is low-passed, so slow motion (cornering roll, brake dive,
// squat, landings) shows and kerb strikes (a wheel moving fast in its arch) are not echoed by the body.

export const BODY_POSE = Object.freeze({
  /** Extra attitude as a fraction of the suspension's own (0 = physics only). */
  gain: 0.5,
  /** Extra heave as a fraction of the mean wheel compression. */
  heaveGain: 0.35,
  maxRollDeg: 3.5,
  maxPitchDeg: 2.5,
  /** Metres. */
  maxHeave: 0.035,
  /** Low-pass rate (1/s): ~0.12 s time constant. */
  rate: 8,
});

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Target extra pose from the four wheel states (order FL, FR, RL, RR, as VehicleState.wheels).
 * Only wheels in contact count; an axle with a wheel in the air adds no roll, and a car in the air
 * gets none at all (its wheels just hang at full droop).
 * @param {{contact:boolean, compression:number}[]} wheels
 * @param {{trackFront:number, trackRear:number, wheelbase:number}} geometry
 * @param {{roll:number, pitch:number, squat:number}} out  roll/pitch in radians (ProceduralCar.setBodyDynamics
 *   convention: +roll lowers the left side, +pitch raises the nose), squat in metres (+ = up).
 */
export function bodyPoseTarget(wheels, geometry, out = { roll: 0, pitch: 0, squat: 0 }, tuning = BODY_POSE) {
  out.roll = 0;
  out.pitch = 0;
  out.squat = 0;
  if (!wheels || wheels.length < 4) return out;
  let roll = 0;
  let axles = 0;
  const tracks = [geometry.trackFront, geometry.trackRear];
  for (let axle = 0; axle < 2; axle++) {
    const l = wheels[axle * 2];
    const r = wheels[axle * 2 + 1];
    if (!l.contact || !r.contact || !(tracks[axle] > 0.1)) continue;
    roll += (l.compression - r.compression) / tracks[axle];
    axles++;
  }
  let front = 0;
  let nf = 0;
  let rear = 0;
  let nr = 0;
  for (let i = 0; i < 4; i++) {
    const w = wheels[i];
    if (!w.contact) continue;
    if (i < 2) { front += w.compression; nf++; } else { rear += w.compression; nr++; }
  }
  const n = nf + nr;
  if (axles > 0) out.roll = clamp(tuning.gain * roll / axles, -tuning.maxRollDeg * DEG, tuning.maxRollDeg * DEG);
  if (nf > 0 && nr > 0 && geometry.wheelbase > 0.5) {
    out.pitch = clamp(-tuning.gain * (front / nf - rear / nr) / geometry.wheelbase, -tuning.maxPitchDeg * DEG, tuning.maxPitchDeg * DEG);
  }
  if (n > 0) out.squat = clamp(-tuning.heaveGain * (front + rear) / n, -tuning.maxHeave, tuning.maxHeave);
  return out;
}

/** Step the smoothed pose `pose` toward `target` over dt seconds. */
export function smoothBodyPose(pose, target, dt, tuning = BODY_POSE) {
  const k = 1 - Math.exp(-tuning.rate * Math.max(0, Math.min(0.1, dt)));
  pose.roll += (target.roll - pose.roll) * k;
  pose.pitch += (target.pitch - pose.pitch) * k;
  pose.squat += (target.squat - pose.squat) * k;
  return pose;
}
