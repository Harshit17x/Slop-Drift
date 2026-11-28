// Suspension and weight-transfer checks per selectable car: `node tests/vehicle-suspension.test.mjs`.
// Ride frequencies, damping, roll gradient, load transfer, tyre load sensitivity, pitch, kerbs and
// landings, and the visible body pose the car model adds on top (src/render/bodyPose.js).
import * as THREE from 'three';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { CARS } from '../src/vehicle/cars.js';
import { CONFIG } from '../src/config.js';
import { BODY_POSE, bodyPoseTarget, smoothBodyPose } from '../src/render/bodyPose.js';

const DT = CONFIG.physics.fixedDt;
const DEG = Math.PI / 180;
const G = 9.81;
let failures = 0;
let passes = 0;

function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

function fill(o, y) {
  o.y = y; o.nx = 0; o.ny = 1; o.nz = 0; o.surface = 0; o.grip = 1; o.rolling = 0.012; o.roughness = 0; o.roadId = 0;
  return o;
}
const flat = () => ({ waterLevel: -Infinity, sampleGround: (x, z, o) => fill(o, 0) });
/** 6 cm half-sine kerbs, 0.6 m long, every 12 m, under the left wheels only. */
const kerbs = () => ({
  waterLevel: -Infinity,
  sampleGround(x, z, o) {
    const p = ((-z % 12) + 12) % 12;
    return fill(o, x < 0 && p > 6 && p < 6.6 ? 0.06 * Math.sin(Math.PI * (p - 6) / 0.6) : 0);
  },
});
const ctl = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0, ...o });

function make(car, world, y = 0) {
  const v = new Vehicle({ world, assists: { handling: 'balanced' } });
  v.setTuning(car.tuning);
  v.setAssists({ driftAssist: true, abs: true, transmission: 'auto' });
  v.teleport({ position: { x: 0, y, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } });
  return v;
}
function run(v, seconds, fn) {
  let s = v.getState();
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const c = fn(i * DT, s);
    if (c === null) break;
    s = v.step(DT, c);
  }
  return s;
}
const rollOf = (s) => Math.asin(Math.max(-1, Math.min(1, s.right.y)));
const pitchOf = (s) => Math.asin(Math.max(-1, Math.min(1, s.forward.y)));

/** Pure-pursuit on a circle of `radius` centred at (radius, 0), holding `speed`. */
function circle(radius, speed) {
  return (t, s) => {
    const ang = Math.atan2(s.position.z, s.position.x - radius) + 12 / radius;
    const dx = radius + Math.cos(ang) * radius - s.position.x;
    const dz = Math.sin(ang) * radius - s.position.z;
    const alpha = Math.atan2(dx * s.right.x + dz * s.right.z, dx * s.forward.x + dz * s.forward.z);
    const delta = Math.atan((2 * 2.6 * Math.sin(alpha)) / Math.hypot(dx, dz));
    const lock = Math.max(6, 34 / (1 + Math.abs(s.forwardSpeed) / 18)) * DEG;
    const err = speed - s.speed;
    return ctl({ throttle: Math.max(0, Math.min(1, 0.25 + err * 0.5)), brake: err < -1 ? 0.2 : 0, steer: Math.max(-1, Math.min(1, delta / lock)) });
  };
}

// ------------------------------------------------------------------ per-car figures

/** Real-world bands by type (see the references in the suspension notes of cars.js). */
const BANDS = {
  gt: { ride: [2.5, 4.0], roll: [0.3, 0.8] }, // GT3 race car, little aero at these speeds
  hatch: { ride: [1.4, 2.2], roll: [1.2, 2.5] }, // gravel rally car
  tokyo: { ride: [1.6, 2.4], roll: [1.0, 2.2] }, // coilover rally-drift sedan
  thar: { ride: [1.1, 1.8], roll: [3.5, 6.5] }, // body-on-frame SUV
};

function measure(car) {
  const v = make(car, flat());
  const t = v.tuning;
  const s = t.suspension;
  const g = t.geometry;
  const front = (g.rearAxleZ - t.com.z) / v.wheelbase;
  const mF = (t.mass * front) / 2;
  const mR = (t.mass * (1 - front)) / 2;
  const hz = (k, m) => Math.sqrt(k / m) / (2 * Math.PI);
  const zeta = (c, k, m) => c / (2 * Math.sqrt(k * m));
  const out = {
    front,
    rideF: hz(s.springFront, mF), rideR: hz(s.springRear, mR),
    zeta: [zeta(s.bumpFront, s.springFront, mF), zeta(s.reboundFront, s.springFront, mF),
      zeta(s.bumpRear, s.springRear, mR), zeta(s.reboundRear, s.springRear, mR)],
  };

  // Steady state at ~0.6 g on a 50 m radius.
  const drive = circle(50, Math.sqrt(0.6 * G * 50));
  run(v, 14, drive);
  let roll = 0; let ay = 0; let n = 0; let dF = 0; let dR = 0; let muOuterLower = 0; let pose = 0; let poseSign = 0;
  const target = { roll: 0, pitch: 0, squat: 0 };
  run(v, 4, (time, st) => {
    roll += rollOf(st); ay += st.gLat; n++;
    const w = v.wheels;
    dF += Math.abs(w[0].tyreLoad - w[1].tyreLoad) / 2;
    dR += Math.abs(w[2].tyreLoad - w[3].tyreLoad) / 2;
    // Outer wheel of each axle (more tyre load) should have the lower friction coefficient.
    for (const [a, b] of [[0, 1], [2, 3]]) {
      const [outer, inner] = w[a].tyreLoad > w[b].tyreLoad ? [w[a], w[b]] : [w[b], w[a]];
      if (outer.mu < inner.mu) muOuterLower++;
    }
    bodyPoseTarget(st.wheels, {
      trackFront: Math.abs(v.wheelLayout[1].x - v.wheelLayout[0].x),
      trackRear: Math.abs(v.wheelLayout[3].x - v.wheelLayout[2].x),
      wheelbase: v.wheelbase,
    }, target);
    pose = Math.max(pose, Math.abs(target.roll));
    if (Math.sign(target.roll) === Math.sign(st.right.y)) poseSign++;
    return drive(time, st);
  });
  roll /= n; ay /= n;
  out.ay = Math.abs(ay);
  out.rollGrad = Math.abs(roll / DEG / ay);
  out.lltdF = dF / (dF + dR);
  const tF = 2 * (g.frontHalfTrack ?? g.halfTrack);
  const tR = 2 * g.halfTrack;
  out.lltRatio = ((dF / n) * tF + (dR / n) * tR) / (t.mass * out.ay * G * t.com.y);
  out.muOuterLower = muOuterLower / (2 * n);
  out.poseRoll = pose;
  out.poseSign = poseSign / n;

  // Brake dive from 25 m/s and squat pulling away.
  {
    const b = make(car, flat());
    run(b, 20, (time, st) => (st.speed < 25 ? ctl({ throttle: 1 }) : null));
    run(b, 1.5, () => ctl());
    let p = 0; let gl = 0; let k = 0;
    run(b, 1.2, (time, st) => { if (time > 0.5) { p += pitchOf(st); gl += st.gLong; k++; } return ctl({ brake: 1 }); });
    out.dive = p / k / DEG;
    out.diveGrad = Math.abs(out.dive / (gl / k));
    const a = make(car, flat());
    run(a, 1, () => ctl({ throttle: 0.3 }));
    p = 0; k = 0;
    run(a, 1, (time, st) => { if (time > 0.4) { p += pitchOf(st); k++; } return ctl({ throttle: 1 }); });
    out.squat = p / k / DEG;
  }
  // Kerbs at 20 m/s under the left wheels.
  {
    const kv = make(car, kerbs());
    const drive2 = (time, st) => ctl({ throttle: st.speed < 20 ? 0.8 : 0.2 });
    run(kv, 8, drive2);
    let wheels = 4; let up = 1; let heading = 0;
    run(kv, 4, (time, st) => { wheels = Math.min(wheels, st.wheelsOnGround); up = Math.min(up, st.up.y); heading = Math.max(heading, Math.abs(st.slipAngle)); return drive2(time, st); });
    out.kerbUp = up; out.kerbSlip = heading / DEG; out.kerbWheels = wheels;
  }
  // 1 m drop.
  {
    const world = { waterLevel: -Infinity, h: 1, sampleGround: (x, z, o) => fill(o, world.h) };
    const d = make(car, world, 1);
    world.h = 0;
    let touchdown = null; let settled = null; let minClear = Infinity;
    const P = new THREE.Vector3();
    run(d, 3, (time, st) => {
      if (touchdown === null && st.wheelsOnGround > 0) touchdown = time;
      for (const b of d.bodyPoints) minClear = Math.min(minClear, d._toWorld(b, P).y);
      if (touchdown !== null && settled === null && time > touchdown + 0.1 && Math.abs(st.velocity.y) < 0.02 && st.angularVelocity.length() < 0.03) settled = time - touchdown;
      return ctl();
    });
    out.landSettle = settled; out.minClear = minClear;
  }
  return out;
}

console.log('Suspension per car');
const m = {};
for (const car of CARS) {
  const r = measure(car);
  m[car.id] = r;
  const band = BANDS[car.id];
  console.log(`\n${car.id}: ride ${r.rideF.toFixed(2)}/${r.rideR.toFixed(2)} Hz, roll ${r.rollGrad.toFixed(2)} deg/g at ${r.ay.toFixed(2)} g, ` +
    `LLTD front ${(r.lltdF * 100).toFixed(0)} % (weight ${(r.front * 100).toFixed(0)} %), dive ${r.diveGrad.toFixed(2)} deg/g`);
  if (band) {
    check(`${car.id}: ride frequencies in the ${band.ride.join('-')} Hz band`, r.rideF >= band.ride[0] && r.rideF <= band.ride[1] && r.rideR >= band.ride[0] && r.rideR <= band.ride[1],
      `${r.rideF.toFixed(2)} / ${r.rideR.toFixed(2)} Hz`);
    check(`${car.id}: roll gradient in the ${band.roll.join('-')} deg/g band`, r.rollGrad >= band.roll[0] && r.rollGrad <= band.roll[1], `${r.rollGrad.toFixed(2)} deg/g`);
  }
  check(`${car.id}: low-speed damping 0.25-0.9 of critical, rebound firmer than bump`,
    r.zeta.every((z) => z >= 0.25 && z <= 0.9) && r.zeta[1] > r.zeta[0] && r.zeta[3] > r.zeta[2], r.zeta.map((z) => z.toFixed(2)).join('/'));
  check(`${car.id}: total lateral load transfer is the rigid-body m*ay*h/track`, r.lltRatio > 0.9 && r.lltRatio < 1.15, `${r.lltRatio.toFixed(3)}`);
  check(`${car.id}: loaded outer tyres have the lower friction coefficient`, r.muOuterLower > 0.95, `${(r.muOuterLower * 100).toFixed(0)} % of samples`);
  check(`${car.id}: dives nose-down braking, squats nose-up accelerating`, r.dive < -0.2 && r.squat > 0.1, `${r.dive.toFixed(2)} / ${r.squat.toFixed(2)} deg`);
  check(`${car.id}: visible lean follows the physics roll and stays bounded`,
    r.poseSign > 0.95 && r.poseRoll > 0 && r.poseRoll <= BODY_POSE.maxRollDeg * DEG + 1e-9, `${(r.poseRoll / DEG).toFixed(2)} deg extra`);
  check(`${car.id}: rides 6 cm kerbs at 72 km/h on its wheels and on line`, r.kerbUp > 0.99 && r.kerbSlip < 3 && r.kerbWheels >= 2,
    `min up.y ${r.kerbUp.toFixed(3)}, max slip ${r.kerbSlip.toFixed(2)} deg`);
  check(`${car.id}: 1 m drop settles within 1.2 s without the underbody grounding`, r.landSettle !== null && r.landSettle < 1.2 && r.minClear > -0.02,
    `${r.landSettle?.toFixed(2)} s, min underbody ${r.minClear.toFixed(3)} m`);
}

console.log('\nOrdering between cars');
check('roll gradient: GT3 < rally hatch / Tokyo sedan < 4x4', m.gt.rollGrad < m.hatch.rollGrad && m.gt.rollGrad < m.tokyo.rollGrad &&
  m.hatch.rollGrad < m.thar.rollGrad && m.tokyo.rollGrad < m.thar.rollGrad,
  `${m.gt.rollGrad.toFixed(2)} / ${m.hatch.rollGrad.toFixed(2)} / ${m.tokyo.rollGrad.toFixed(2)} / ${m.thar.rollGrad.toFixed(2)}`);
check('ride frequency: GT3 stiffest, 4x4 softest', ['hatch', 'tokyo', 'thar'].every((id) => m.gt.rideF > m[id].rideF) &&
  ['hatch', 'tokyo', 'gt'].every((id) => m.thar.rideF < m[id].rideF));
check('brake dive: GT3 least, 4x4 most', ['hatch', 'tokyo', 'thar'].every((id) => m.gt.diveGrad < m[id].diveGrad) &&
  ['hatch', 'tokyo', 'gt'].every((id) => m.thar.diveGrad > m[id].diveGrad));
check('4x4 carries more of its load transfer at the front than its weight (understeer for safety)', m.thar.lltdF > m.thar.front + 0.03,
  `${(m.thar.lltdF * 100).toFixed(0)} % vs ${(m.thar.front * 100).toFixed(0)} %`);
check('drift cars keep a near-neutral split (LLTD within 5 % of weight)', ['hatch', 'tokyo'].every((id) => Math.abs(m[id].lltdF - m[id].front) < 0.05));

console.log('\nVisible body pose');
{
  const geo = { trackFront: 1.6, trackRear: 1.6, wheelbase: 2.6 };
  const wheel = (contact, compression) => ({ contact, compression });
  const p = bodyPoseTarget([wheel(true, 0.05), wheel(true, -0.05), wheel(true, 0.04), wheel(true, -0.04)], geo);
  check('left wheels compressed: the left side goes down (+roll)', p.roll > 0 && Math.abs(p.pitch) < 1e-9);
  const d = bodyPoseTarget([wheel(true, 0.04), wheel(true, 0.04), wheel(true, -0.03), wheel(true, -0.03)], geo);
  check('fronts compressed: nose down (-pitch)', d.pitch < 0 && Math.abs(d.roll) < 1e-9);
  const h = bodyPoseTarget([wheel(true, 0.05), wheel(true, 0.05), wheel(true, 0.05), wheel(true, 0.05)], geo);
  check('all compressed: the body squats', h.squat < 0 && h.squat >= -BODY_POSE.maxHeave);
  const air = bodyPoseTarget([wheel(false, -0.12), wheel(false, -0.12), wheel(false, -0.12), wheel(false, -0.12)], geo);
  check('airborne: no extra pose', air.roll === 0 && air.pitch === 0 && air.squat === 0);
  const lifted = bodyPoseTarget([wheel(true, 0.1), wheel(false, -0.12), wheel(true, 0.02), wheel(true, 0.02)], geo);
  check('an axle with a wheel in the air adds no roll', Math.abs(lifted.roll) < 1e-9);
  const big = bodyPoseTarget([wheel(true, 1), wheel(true, -1), wheel(true, 1), wheel(true, -1)], geo);
  const big2 = bodyPoseTarget([wheel(true, 1), wheel(true, 1), wheel(true, -1), wheel(true, -1)], geo);
  check('extreme compressions stay within the pose limits', Math.abs(big.roll) <= BODY_POSE.maxRollDeg * DEG + 1e-12 &&
    Math.abs(big2.pitch) <= BODY_POSE.maxPitchDeg * DEG + 1e-12 && Math.abs(big2.squat) <= BODY_POSE.maxHeave + 1e-12);
  const garbage = bodyPoseTarget(null, geo);
  check('missing wheel data gives a neutral pose', garbage.roll === 0 && garbage.pitch === 0 && garbage.squat === 0);
  // Smoothing: converges toward the target without overshoot, bounded for any frame time.
  const pose = { roll: 0, pitch: 0, squat: 0 };
  let over = false;
  for (let i = 0; i < 120; i++) { smoothBodyPose(pose, p, i % 7 === 0 ? 0.25 : 1 / 60); if (pose.roll > p.roll + 1e-12) over = true; }
  check('smoothing settles on the target without overshoot', !over && Math.abs(pose.roll - p.roll) < 1e-4);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
