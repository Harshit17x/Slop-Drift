// Headless vehicle physics tests: `node tests/vehicle.test.mjs` (exit code 1 on failure).
import * as THREE from 'three';
import { Vehicle } from '../src/vehicle/Vehicle.js';
import { DriftScorer } from '../src/vehicle/DriftScorer.js';
import { CONFIG, SURFACE } from '../src/config.js';
import { World } from '../src/world/World.js';
import { CARS } from '../src/vehicle/cars.js';

const DT = CONFIG.physics.fixedDt;
const DEG = Math.PI / 180;
const figures = [];
let failures = 0;
let passes = 0;

function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

function figure(name, value, unit, target) {
  figures.push({ name, value, unit, target });
}

// ------------------------------------------------------------------ mock worlds

function fillGround(o, y, nx, ny, nz, surface = 0, grip = 1, rolling = 0.012) {
  const len = Math.hypot(nx, ny, nz);
  o.y = y; o.nx = nx / len; o.ny = ny / len; o.nz = nz / len;
  o.surface = surface; o.grip = grip; o.rolling = rolling; o.roughness = 0.02; o.roadId = 0;
  return o;
}

const flatWorld = () => ({ waterLevel: -Infinity, sampleGround: (x, z, o) => fillGround(o, 0, 0, 1, 0) });

/** Uphill toward -Z with the given grade (rise / run). */
const gradeWorld = (grade) => ({
  waterLevel: -Infinity,
  sampleGround: (x, z, o) => fillGround(o, -grade * z, 0, 1, grade),
});

/** Banked about the Z axis: ground rises toward +X. */
const bankWorld = (deg) => {
  const k = Math.tan(deg * DEG);
  return { waterLevel: -Infinity, sampleGround: (x, z, o) => fillGround(o, k * x, -k, 1, 0) };
};

const dropWorld = (h) => {
  const w = { waterLevel: -Infinity, height: h, sampleGround: (x, z, o) => fillGround(o, w.height, 0, 1, 0) };
  return w;
};

/** Flat plane with a straight wall along x = wallX; the road is on the -X side. */
const barrierWorld = (wallX) => ({
  waterLevel: -Infinity,
  sampleGround: (x, z, o) => fillGround(o, 0, 0, 1, 0),
  collideBarrier(x, y, z, r, out) {
    const pen = x + r - wallX;
    out.hit = pen > 0;
    out.nx = -1; out.nz = 0; out.depth = Math.max(0, pen);
    return out;
  },
});

/** Rolling hills, walls at |x| = 60, a few tree trunks: for the fuzz run. */
const hillyWorld = () => ({
  waterLevel: -3,
  sampleGround(x, z, o) {
    // Smooth hills plus 0.6 m terrace steps off the road (discontinuities stress the contacts).
    const terrace = Math.abs(x) > 12 ? Math.floor(z / 40) * 0.6 : 0;
    const y = 2.2 * Math.sin(x / 17) * Math.cos(z / 23) + 1.2 * Math.sin((x + z) / 9) + terrace;
    const dydx = (2.2 / 17) * Math.cos(x / 17) * Math.cos(z / 23) + (1.2 / 9) * Math.cos((x + z) / 9);
    const dydz = (-2.2 / 23) * Math.sin(x / 17) * Math.sin(z / 23) + (1.2 / 9) * Math.cos((x + z) / 9);
    const surface = Math.abs(x) < 8 ? 0 : 2;
    return fillGround(o, y, -dydx, 1, -dydz, surface, surface === 0 ? 1 : 0.56, surface === 0 ? 0.012 : 0.06);
  },
  collideBarrier(x, y, z, r, out) {
    const pen = Math.abs(x) + r - 60;
    out.hit = pen > 0; out.nx = -Math.sign(x) || -1; out.nz = 0; out.depth = Math.max(0, pen);
    return out;
  },
  collideObstacle(x, y, z, r, out) {
    // Trunks on a 30 m grid, radius 0.4.
    const cx = Math.round(x / 30) * 30 + 15;
    const cz = Math.round(z / 30) * 30;
    const dx = x - cx;
    const dz = z - cz;
    const d = Math.hypot(dx, dz);
    const pen = r + 0.4 - d;
    out.hit = pen > 0 && d > 1e-6;
    out.nx = out.hit ? dx / d : 0; out.nz = out.hit ? dz / d : 0; out.depth = Math.max(0, pen);
    return out;
  },
});

// ------------------------------------------------------------------ helpers

const yawQuat = (deg) => ({ x: 0, y: Math.sin((deg * DEG) / 2), z: 0, w: Math.cos((deg * DEG) / 2) });
const spawn = (x = 0, y = 0, z = 0, yawDeg = 0) => ({ position: { x, y, z }, quaternion: yawQuat(yawDeg) });

function controls(o = {}) {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0, ...o };
}

function makeVehicle(world, handling = 'Balanced', assists = {}) {
  const v = new Vehicle({ world, handling });
  v.setAssists({ driftAssist: 0.6, abs: true, transmission: 'auto', ...assists });
  return v;
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Run `seconds` of fixed steps; fn(t, state) returns controls (or null to stop early). */
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

function horizDist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const _tmp = new THREE.Vector3();
function lowestBodyClearance(v, world) {
  const o = {};
  let min = Infinity;
  for (const p of v.bodyPoints) {
    if (p.y > 0.6) continue;
    v._toWorld(p, _tmp);
    world.sampleGround(_tmp.x, _tmp.z, o);
    min = Math.min(min, _tmp.y - o.y);
  }
  return min;
}

/** Throttle controller holding a target forward speed. */
function cruise(s, target, gain = 0.6) {
  return Math.max(0, Math.min(1, (target - s.forwardSpeed) * gain + 0.25));
}

// ------------------------------------------------------------------ tests

function testPedalAndWheelResponse() {
  for (const direction of [-1, 1]) {
    const turning = makeVehicle(flatWorld());
    const state = run(turning, 0.5, () => controls({ steer: direction }));
    const inner = state.wheels[direction > 0 ? 1 : 0].steerAngle * direction;
    const outer = state.wheels[direction > 0 ? 0 : 1].steerAngle * direction;
    check('inside front wheel turns tighter in a ' + (direction > 0 ? 'right' : 'left') + ' hairpin',
      inner > state.steerAngle * direction && state.steerAngle * direction > outer && outer > 0);
  }
  const car = makeVehicle(flatWorld());
  const input = controls({ throttle: 1, steer: 0.3 });
  const first = car.step(DT, input).throttle;
  for (let i = 0; i < 120; i++) car.step(DT, input);
  check('full pedal takes up torque progressively', first > 0 && first < 0.3 && car.getState().throttle > 0.99);
  const wheel = car.getState().wheels[0];
  const start = wheel.spinAngle;
  car.step(DT / 2, input);
  const middle = wheel.spinAngle;
  car.step(DT / 2, input);
  check('wheel spin interpolates between physics ticks', Math.abs(middle - start) > 0.001 &&
    Math.abs((start + wheel.spinAngle) * 0.5 - middle) < 1e-7);
  check('braking cuts residual drive torque on the next tick', car.step(DT, controls({ brake: 1 })).throttle === 0);
  car.teleport();
  check('respawn clears the previous wheel pose', car.getState().wheels.every(w => Math.abs(w.spinAngle) < 0.001));
}

function testSettle() {
  console.log('\nSettling at rest');
  for (const name of ['Arcade', 'Balanced', 'Sim']) {
    const v = makeVehicle(flatWorld(), name);
    let s = v.getState();
    const p0 = s.position.clone();
    let maxSpeed = 0;
    s = run(v, 5, (t, st) => { maxSpeed = Math.max(maxSpeed, st.speed); return controls(); });
    const drift = s.position.distanceTo(p0);
    check(`${name}: settles with no jitter`, maxSpeed < 0.01 && drift < 0.01, `max speed ${maxSpeed.toExponential(2)} m/s, drift ${(drift * 1000).toFixed(2)} mm`);
    if (name === 'Balanced') {
      check('origin sits on the ground at rest', Math.abs(s.position.y) < 0.01, `y = ${s.position.y.toFixed(4)}`);
      check('all four wheels loaded', s.wheels.every((w) => w.contact && w.load > 2500), s.wheels.map((w) => w.load.toFixed(0)).join('/'));
    }
  }
}

function testGradeHold() {
  console.log('\nHolding on a 12% grade');
  const world = gradeWorld(0.12);

  // Brake: drive up, brake to a stop, keep the pedal down.
  {
    const v = makeVehicle(world);
    v.teleport(spawn(0, 0, 0, 0));
    let phase = 0;
    let s = run(v, 3, (t, st) => {
      if (t < 1.5) return controls({ throttle: 0.6 });
      phase = 1;
      return controls({ brake: 1 });
    });
    const p0 = s.position.clone();
    s = run(v, 5, () => controls({ brake: 1 }));
    const d = s.position.distanceTo(p0);
    check('brake holds on 12% (uphill, pedal held through the stop)', d < 0.01 && s.gear !== 'R' && phase === 1, `creep ${(d * 1000).toFixed(2)} mm, gear ${s.gear}`);
  }
  for (const yaw of [0, 180]) {
    const dir = yaw === 0 ? 'facing uphill' : 'facing downhill';
    {
      const v = makeVehicle(world);
      v.teleport(spawn(0, 0, 0, yaw));
      const p0 = v.getState().position.clone();
      const s = run(v, 5, () => controls({ handbrake: true }));
      const d = s.position.distanceTo(p0);
      check(`handbrake holds on 12% (${dir})`, d < 0.01, `creep ${(d * 1000).toFixed(2)} mm`);
    }
    {
      const v = makeVehicle(world);
      v.teleport(spawn(0, 0, 0, yaw));
      const p0 = v.getState().position.clone();
      const s = run(v, 5, () => controls());
      const d = s.position.distanceTo(p0);
      check(`hill-hold with no input on 12% (${dir})`, d < 0.01, `creep ${(d * 1000).toFixed(2)} mm`);
    }
  }
  // Coasting: nudge downhill above the hold threshold, then release.
  {
    const v = makeVehicle(world);
    v.teleport(spawn(0, 0, 0, 180));
    let s = run(v, 3, (t, st) => (st.speed < 1.2 ? controls({ throttle: 0.3 }) : null));
    const v0 = s.speed;
    s = run(v, 4, () => controls());
    check('coasts down the grade once rolling', s.speed > v0 + 2, `${v0.toFixed(2)} -> ${s.speed.toFixed(2)} m/s after 4 s`);
  }
  // Coasting on flat: gentle engine braking, not an instant stop.
  {
    const v = makeVehicle(flatWorld());
    let s = run(v, 20, (t, st) => (st.speed < 20 ? controls({ throttle: 1 }) : null));
    const v0 = s.speed;
    s = run(v, 3, () => controls());
    const decel = (v0 - s.speed) / 3;
    figure('Coast decel from 72 km/h', decel / 9.81, 'g', '0.03-0.15');
    check('coasting on flat decelerates gently', decel > 0.3 && decel < 1.5, `${decel.toFixed(2)} m/s^2`);
  }
}

function testBank() {
  console.log('\n6 degree bank');
  const world = bankWorld(6);
  const v = makeVehicle(world);
  v.teleport(spawn(0, 0, 0, 0));
  const p0 = v.getState().position.clone();
  let s = run(v, 5, () => controls());
  check('holds still on a 6 degree bank', s.position.distanceTo(p0) < 0.01, `creep ${(s.position.distanceTo(p0) * 1000).toFixed(2)} mm`);
  // Drive along the bank: the car should run true with small corrections and stay upright.
  let minUp = 1;
  s = run(v, 6, (t, st) => {
    minUp = Math.min(minUp, st.up.y);
    return controls({ throttle: cruise(st, 18), steer: Math.max(-1, Math.min(1, -st.position.x * 0.15 - st.lateralSpeed * 0.3)) });
  });
  check('drives along the bank upright', minUp > 0.95 && Math.abs(s.position.x) < 2, `min up.y ${minUp.toFixed(3)}, x ${s.position.x.toFixed(2)}`);
}

function testPerformance() {
  console.log('\nStraight-line performance');
  const v = makeVehicle(flatWorld());
  let t100 = null;
  let s = run(v, 20, (t, st) => {
    if (st.speedKmh >= 100 && t100 === null) { t100 = t; return null; }
    return controls({ throttle: 1 });
  });
  figure('0-100 km/h', t100, 's', '~5.5');
  check('0-100 km/h about 5.5 s', t100 !== null && t100 > 5.0 && t100 < 6.0, `${t100?.toFixed(2)} s`);

  let top = 0;
  s = run(v, 110, (t, st) => { top = Math.max(top, st.speedKmh); return controls({ throttle: 1 }); });
  figure('Top speed', top, 'km/h', '210-225');
  check('top speed 210-225 km/h from drag', top >= 210 && top <= 225, `${top.toFixed(1)} km/h in gear ${s.gear}`);

  // 100-0 with ABS.
  for (const absOn of [true, false]) {
    const b = makeVehicle(flatWorld(), 'Balanced', { abs: absOn });
    s = run(b, 20, (t, st) => (st.speedKmh < 101 ? controls({ throttle: 1 }) : null));
    let start = null;
    let dist = null;
    let maxYaw = 0;
    s = run(b, 10, (t, st) => {
      if (start === null && st.speedKmh <= 100) start = st.position.clone();
      if (start && st.speed < 0.05) { dist = horizDist(st.position, start); return null; }
      maxYaw = Math.max(maxYaw, Math.abs(st.yawRate));
      return controls({ brake: 1 });
    });
    if (absOn) {
      figure('100-0 km/h (ABS)', dist, 'm', '36-42');
      check('100-0 km/h in 36-42 m with ABS', dist !== null && dist >= 36 && dist <= 42, `${dist?.toFixed(1)} m`);
      check('straight-line braking stays straight', maxYaw < 0.05, `max yaw rate ${maxYaw.toFixed(3)}`);
    } else {
      figure('100-0 km/h (no ABS)', dist, 'm', 'longer');
      check('locked-wheel stop is longer than ABS', dist !== null && dist > 40, `${dist?.toFixed(1)} m`);
    }
  }
  // ABS keeps the fronts rolling so the car still turns under full braking; locked fronts plough.
  {
    const turn = (absOn) => {
      const b = makeVehicle(flatWorld(), 'Balanced', { abs: absOn, driftAssist: 0 });
      run(b, 20, (t, st) => (st.speed < 25 ? controls({ throttle: 1 }) : null));
      const h0 = Math.atan2(b.forward.x, -b.forward.z);
      run(b, 1.2, () => controls({ brake: 1, steer: 1 }));
      return Math.abs(Math.atan2(b.forward.x, -b.forward.z) - h0) / DEG;
    };
    const withAbs = turn(true);
    const without = turn(false);
    check('ABS: steering works under full braking', withAbs > 2 * without && withAbs > 8, `heading change ${withAbs.toFixed(1)} deg vs ${without.toFixed(1)} deg locked`);
  }
  // Nitro adds force.
  {
    const b = makeVehicle(flatWorld());
    let tb = null;
    run(b, 20, (t, st) => { if (st.speedKmh >= 100 && tb === null) { tb = t; return null; } return controls({ throttle: 1, boost: true }); });
    figure('0-100 km/h with nitro', tb, 's', '< 0-100');
    check('nitro shortens 0-100', tb !== null && tb < t100, `${tb?.toFixed(2)} s`);
  }
}

function circleDriver(cx, cz, radius, speed, dirSign) {
  // Pure pursuit on a circle (dirSign +1: clockwise seen from above = right turn when heading -Z at x=0, cx>0).
  return (t, s) => {
    const px = s.position.x - cx;
    const pz = s.position.z - cz;
    const ang = Math.atan2(pz, px);
    const look = 12 / radius;
    const ta = ang - dirSign * look;
    const tx = cx + Math.cos(ta) * radius;
    const tz = cz + Math.sin(ta) * radius;
    const dx = tx - s.position.x;
    const dz = tz - s.position.z;
    const lx = dx * s.right.x + dz * s.right.z;
    const lf = dx * s.forward.x + dz * s.forward.z;
    const alpha = Math.atan2(lx, lf);
    const ld = Math.hypot(dx, dz);
    const delta = Math.atan((2 * 2.55 * Math.sin(alpha)) / ld);
    const lock = Math.max(6, 34 / (1 + Math.abs(s.forwardSpeed) / 18)) * DEG;
    return controls({ throttle: cruise(s, speed, 0.8), steer: Math.max(-1, Math.min(1, delta / lock)) });
  };
}

function testCornering() {
  console.log('\nSteady cornering, 20 m/s on a 60 m radius');
  for (const name of ['Arcade', 'Balanced', 'Sim']) {
    const v = makeVehicle(flatWorld(), name);
    // Bring it up to speed on the circle.
    const driver = circleDriver(60, 0, 60, 20, -1);
    let s = run(v, 12, driver);
    let maxSlip = 0;
    let maxErr = 0;
    let minSpeed = Infinity;
    let sumG = 0;
    let n = 0;
    s = run(v, 10, (t, st) => {
      maxSlip = Math.max(maxSlip, Math.abs(st.slipAngle));
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(st.position.x - 60, st.position.z) - 60));
      minSpeed = Math.min(minSpeed, st.speed);
      sumG += Math.abs(st.gLat); n++;
      return driver(t, st);
    });
    if (name === 'Balanced') {
      figure('Steady 20 m/s / R60 body slip', maxSlip / DEG, 'deg', '< 6');
      figure('Steady 20 m/s / R60 lateral g', sumG / n, 'g', '~0.68');
    }
    check(`${name}: holds the circle without spinning`, maxSlip < 6 * DEG && maxErr < 2 && minSpeed > 17, `max slip ${(maxSlip / DEG).toFixed(2)} deg, radius err ${maxErr.toFixed(2)} m, min speed ${minSpeed.toFixed(1)}`);
  }
}

function testNoFlip() {
  console.log('\nFull throttle + full lock from rest');
  for (const name of ['Arcade', 'Balanced', 'Sim']) {
    for (const steer of [1, -1]) {
      const v = makeVehicle(flatWorld(), name, { driftAssist: 0 });
      let minUp = 1;
      let maxRoll = 0;
      run(v, 10, (t, st) => {
        minUp = Math.min(minUp, st.up.y);
        maxRoll = Math.max(maxRoll, Math.abs(Math.asin(Math.max(-1, Math.min(1, st.right.y)))));
        return controls({ throttle: 1, steer });
      });
      check(`${name} steer ${steer > 0 ? 'right' : 'left'}: stays on its wheels`, minUp > 0.85, `min up.y ${minUp.toFixed(3)}, max roll ${(maxRoll / DEG).toFixed(1)} deg`);
    }
  }
}

function testDrift() {
  console.log('\nHandbrake drift at 22 m/s and recovery');
  for (const name of ['Arcade', 'Balanced', 'Sim']) {
    const v = makeVehicle(flatWorld(), name, { driftAssist: 0.6 });
    let s = run(v, 20, (t, st) => (st.speed < 22 ? controls({ throttle: 1 }) : null));
    let maxSlip = 0;
    let tEntry = 0;
    s = run(v, 2.5, (t, st) => {
      maxSlip = Math.max(maxSlip, Math.abs(st.slipAngle));
      tEntry = t;
      if (Math.abs(st.slipAngle) > 28 * DEG) return null;
      return controls({ handbrake: true, steer: 1, throttle: 0.2 });
    });
    const entrySpeed = s.speed;
    let recovered = null;
    let worst = maxSlip;
    s = run(v, 5, (t, st) => {
      const slip = st.slipAngle;
      worst = Math.max(worst, Math.abs(slip));
      if (recovered === null && Math.abs(slip) < 5 * DEG && t > 0.1) recovered = t;
      if (recovered !== null && t > recovered + 0.5) return null;
      return controls({ steer: Math.max(-1, Math.min(1, slip * 3)), throttle: 0.25 });
    });
    if (name === 'Balanced') {
      figure('Handbrake entry: peak body slip', maxSlip / DEG, 'deg', '> 20');
      figure('Drift recovery time (assist 0.6)', recovered, 's', '< 3');
      figure('Drift worst slip', worst / DEG, 'deg', '< 100');
    }
    check(`${name}: handbrake + steer at 22 m/s exceeds 20 deg slip`, maxSlip > 20 * DEG, `peak ${(maxSlip / DEG).toFixed(1)} deg after ${tEntry.toFixed(2)} s, ${entrySpeed.toFixed(1)} m/s`);
    check(`${name}: countersteer recovers under 5 deg without spinning`, recovered !== null && recovered < 3 && worst < 100 * DEG && s.up.y > 0.9,
      `recovered in ${recovered?.toFixed(2)} s, worst ${(worst / DEG).toFixed(1)} deg`);
  }
  // Raw car (assist 0): the handbrake still swings the tail; the assist is not what makes it drift.
  {
    const v = makeVehicle(flatWorld(), 'Balanced', { driftAssist: 0 });
    run(v, 20, (t, st) => (st.speed < 22 ? controls({ throttle: 1 }) : null));
    let maxSlip = 0;
    run(v, 1.5, (t, st) => { maxSlip = Math.max(maxSlip, Math.abs(st.slipAngle)); return controls({ handbrake: true, steer: 1 }); });
    check('assist 0: handbrake still rotates the car', maxSlip > 20 * DEG, `peak ${(maxSlip / DEG).toFixed(1)} deg`);
  }
  // Power oversteer: full throttle in 2nd while turning rotates the RWD car more than a light throttle.
  {
    const slipFor = (throttle) => {
      const v = makeVehicle(flatWorld(), 'Balanced', { driftAssist: 0 });
      run(v, 20, (t, st) => (st.speed < 14 ? controls({ throttle: 1 }) : null));
      let m = 0;
      run(v, 1.2, (t, st) => { m = Math.max(m, Math.abs(st.slipAngle)); return controls({ throttle, steer: 1 }); });
      return m;
    };
    const light = slipFor(0.2);
    const full = slipFor(1);
    check('throttle steals rear grip (power oversteer)', full > light + 2 * DEG, `slip ${(light / DEG).toFixed(1)} vs ${(full / DEG).toFixed(1)} deg`);
  }
}

function testDrop() {
  console.log('\n1.5 m drop');
  const world = dropWorld(1.5);
  const v = makeVehicle(world);
  v.teleport(spawn(0, 1.5, 0, 0));
  world.height = 0;
  let touchdown = null;
  let minClear = Infinity;
  let minWheel = Infinity;
  let settled = null;
  let landing = 0;
  run(v, 4, (t, st) => {
    if (touchdown === null && st.wheelsOnGround > 0) touchdown = t;
    landing = Math.max(landing, st.landing);
    minClear = Math.min(minClear, lowestBodyClearance(v, world));
    for (const w of v.wheels) if (w.contact) minWheel = Math.min(minWheel, w.rawLength + v.tuning.geometry.wheelRadius);
    if (touchdown !== null && settled === null && t > touchdown + 0.1) {
      const calm = st.speed < 0.05 && st.angularVelocity.length() < 0.05 && Math.abs(st.position.y) < 0.01;
      if (calm) settled = t - touchdown;
    }
    if (settled !== null && t - touchdown > settled + 0.05) {
      const calm = st.speed < 0.05 && st.angularVelocity.length() < 0.05 && Math.abs(st.position.y) < 0.01;
      if (!calm) settled = null;
    }
    return controls();
  });
  figure('1.5 m drop: settle time after touchdown', settled, 's', '< 1.5');
  figure('1.5 m drop: min underbody clearance', minClear, 'm', '> 0');
  check('lands and settles within 1.5 s', settled !== null && settled < 1.5, `settled ${settled?.toFixed(2)} s after touchdown, landing ${landing.toFixed(2)} m/s`);
  check('no bottom-through on landing', minClear > -0.02 && minWheel > 0.05, `min underbody ${minClear.toFixed(3)} m, min hub height ${minWheel.toFixed(3)} m`);
}

function testBarrier() {
  console.log('\nBarrier hit at 25 m/s, 30 degrees');
  const world = barrierWorld(4);
  const v = makeVehicle(world);
  v.teleport(spawn(0, 0, 0, -30));
  v.velocity.copy(v.forward).multiplyScalar(25);
  let impact = 0;
  let maxX = -Infinity;
  let minUp = 1;
  const s = run(v, 3, (t, st) => {
    impact = Math.max(impact, st.impact);
    maxX = Math.max(maxX, st.position.x);
    minUp = Math.min(minUp, st.up.y);
    return controls({ throttle: 0.3 });
  });
  const heading = Math.atan2(s.forward.x, -s.forward.z) / DEG;
  figure('Barrier hit: reported impact', impact, 'm/s', '~12.5');
  check('stays on the road side of the wall', maxX < 4 - 0.6, `max origin x ${maxX.toFixed(2)}`);
  check('deflected along the wall', s.velocity.z < -12 && s.velocity.x < 1.5 && Math.abs(heading) < 25 && minUp > 0.8,
    `v = (${s.velocity.x.toFixed(1)}, ${s.velocity.z.toFixed(1)}), heading ${heading.toFixed(1)} deg`);
  check('impact strength reported', impact > 8 && impact < 20, `${impact.toFixed(2)} m/s`);
}

function fuzzRun(seed, seconds = 60) {
  const world = hillyWorld();
  const v = makeVehicle(world);
  v.teleport(spawn(0, world.sampleGround(0, 0, {}).y, 0, 0));
  const r = rng(seed);
  let c = controls();
  let finite = true;
  let maxSpeed = 0;
  const s = run(v, seconds, (t, st) => {
    if (Math.floor(t / 0.4) !== Math.floor((t - DT) / 0.4)) {
      const fast = r() < 0.75;
      c = controls({ throttle: fast ? 0.6 + 0.4 * r() : r() * 0.5, brake: !fast && r() < 0.4 ? r() : 0, steer: r() < 0.5 ? (r() * 2 - 1) * 0.3 : r() * 2 - 1, handbrake: r() < 0.12, boost: r() < 0.15 });
      if (r() < 0.02) v.setHandling(['Arcade', 'Balanced', 'Sim'][Math.floor(r() * 3)]);
    }
    const ok = [st.position.x, st.position.y, st.position.z, st.quaternion.x, st.quaternion.w, st.speed, st.rpm, st.yawRate].every(Number.isFinite);
    if (!ok) finite = false;
    maxSpeed = Math.max(maxSpeed, st.speed);
    return c;
  });
  return { v, s, finite, maxSpeed };
}

function testFuzzAndDeterminism() {
  console.log('\nFuzz, determinism, frame-time independence');
  const a = fuzzRun(1234);
  check('60 s random-input fuzz stays finite', a.finite && a.maxSpeed < 90, `max speed ${a.maxSpeed.toFixed(1)} m/s, end (${a.s.position.x.toFixed(1)}, ${a.s.position.y.toFixed(1)}, ${a.s.position.z.toFixed(1)})`);
  const b = fuzzRun(1234);
  const same = a.s.position.equals(b.s.position) && a.s.quaternion.equals(b.s.quaternion) && a.s.velocity.equals(b.s.velocity);
  check('identical inputs give identical results', same);
  for (const seed of [99, 2024, 31337]) {
    const c = fuzzRun(seed);
    check(`fuzz seed ${seed} stays finite`, c.finite && c.maxSpeed < 90, `max speed ${c.maxSpeed.toFixed(1)} m/s`);
  }

  // Irregular frame times vs regular 60 Hz.
  const ctl = controls({ throttle: 0.7, steer: 0.35 });
  const total = 6;
  const reg = makeVehicle(flatWorld());
  for (let i = 0; i < total * 60; i++) reg.step(1 / 60, ctl);
  const irr = makeVehicle(flatWorld());
  const r = rng(7);
  let tAcc = 0;
  while (tAcc < total - 1e-9) {
    let d = 0.004 + r() * 0.045;
    if (tAcc + d > total) d = total - tAcc;
    irr.step(d, ctl);
    tAcc += d;
  }
  const dp = reg.getState().position.distanceTo(irr.getState().position);
  const dq = 1 - Math.abs(reg.getState().quaternion.dot(irr.getState().quaternion));
  check('irregular frame times match a regular run', dp < 0.05 && dq < 1e-4, `position diff ${(dp * 100).toFixed(2)} cm`);

  // A huge frame is capped at maxSubSteps and the remainder dropped.
  const big = makeVehicle(flatWorld());
  const before = big.steps;
  big.step(0.25, controls());
  check('frame cap: one long frame runs at most maxSubSteps steps', big.steps - before === CONFIG.physics.maxSubSteps && big.accumulator < DT);
}

function testNaNRecovery() {
  console.log('\nRobustness');
  const v = makeVehicle(flatWorld());
  run(v, 1, () => controls({ throttle: 1 }));
  v.velocity.set(NaN, 0, 0);
  const s = run(v, 0.5, () => controls());
  check('non-finite state restores the last good pose', [s.position.x, s.position.y, s.position.z, s.speed].every(Number.isFinite));
  const w = makeVehicle({ sampleGround: (x, z, o) => fillGround(o, NaN, 0, 0, 0) });
  const s2 = run(w, 1, () => controls({ throttle: 1 }));
  check('garbage ground samples do not produce NaN', [s2.position.x, s2.position.y, s2.position.z].every(Number.isFinite));
}

function testReverse() {
  console.log('\nReverse');
  const v = makeVehicle(flatWorld());
  let s = run(v, 3, () => controls({ brake: 1 }));
  check('brake from rest engages reverse and backs up', s.gear === 'R' && s.forwardSpeed < -2, `gear ${s.gear}, v ${s.forwardSpeed.toFixed(2)}`);
  s = run(v, 3, () => controls({ throttle: 1 }));
  check('throttle brakes the reverse and returns to 1st', s.gear !== 'R' && s.forwardSpeed > 1, `gear ${s.gear}, v ${s.forwardSpeed.toFixed(2)}`);
  // Manual box.
  const m = makeVehicle(flatWorld(), 'Balanced', { transmission: 'manual' });
  m.step(DT, controls({ throttle: 1, shift: 1 }));
  run(m, 0.5, () => controls({ throttle: 1 }));
  check('manual shift request changes gear', m.getState().gear === 2, `gear ${m.getState().gear}`);
}

function testDriftScorer() {
  console.log('\nDrift scorer');
  const v = makeVehicle(flatWorld(), 'Balanced', { driftAssist: 0.6 });
  const scorer = new DriftScorer();
  run(v, 20, (t, st) => (st.speed < 22 ? controls({ throttle: 1 }) : null));
  let started = false;
  run(v, 4, (t, st) => {
    const c = t < 0.6 ? controls({ handbrake: true, steer: 1, throttle: 0.3 }) : controls({ steer: Math.max(-1, Math.min(1, st.slipAngle * 2.5)), throttle: 0.6 });
    const snap = scorer.update(DT, st, c);
    if (snap.active) started = true;
    return c;
  });
  for (let i = 0; i < 240; i++) scorer.update(DT, v.getState(), controls());
  const snap = scorer.snapshot();
  check('drift is detected and banked', started && snap.bank > 0, `bank ${snap.bank}`);
}


async function testRealWorld() {
  console.log('\nReal World integration');
  const world = await new World().build();
  for (const routeId of ['loop', 'climb']) {
    const route = world.routes[routeId];
    const roadId = route.roadId;
    const road = world.roads[roadId];
    const loc = {};
    const frame = {};
    const pose = world.getSpawn(routeId, route.startS);
    const v = makeVehicle(world);
    let s = v.teleport(pose);
    world.locate(s.position.x, s.position.z, loc, roadId);
    const grade = loc.roadId >= 0 ? Math.abs(loc.ty) / Math.hypot(loc.tx, loc.tz) * 100 : NaN;

    // Settles and holds with no input, then with the handbrake.
    const p0 = s.position.clone();
    let maxSpeed = 0;
    s = run(v, 4, (t, st) => { maxSpeed = Math.max(maxSpeed, st.speed); return controls(); });
    const creep = s.position.distanceTo(p0);
    check(`${routeId}: settles at rest at the start (grade ${grade.toFixed(1)}%)`, maxSpeed < 0.02 && creep < 0.01 && s.wheelsOnGround === 4,
      `max speed ${maxSpeed.toExponential(2)}, creep ${(creep * 1000).toFixed(2)} mm`);
    const p1 = s.position.clone();
    s = run(v, 4, () => controls({ handbrake: true }));
    check(`${routeId}: holds on the grade with the handbrake`, s.position.distanceTo(p1) < 0.01, `creep ${(s.position.distanceTo(p1) * 1000).toFixed(2)} mm`);

    // Drive 300 m with pure pursuit on the centreline and a curvature-limited speed.
    world.locate(s.position.x, s.position.z, loc, roadId);
    const sStart = loc.s;
    let travelled = 0;
    let maxLat = -Infinity;
    let offAsphalt = 0;
    let finite = true;
    let lastS = sStart;
    s = run(v, 90, (t, st) => {
      world.locate(st.position.x, st.position.z, loc, roadId);
      if (loc.roadId < 0) { finite = false; return null; }
      let ds = (loc.s - lastS) * route.direction;
      if (route.closed && Math.abs(ds) > road.length / 2) ds -= Math.sign(ds) * road.length;
      travelled += ds;
      lastS = loc.s;
      if (travelled >= 300) return null;
      if (![st.position.x, st.position.y, st.position.z, st.speed].every(Number.isFinite)) { finite = false; return null; }
      maxLat = Math.max(maxLat, Math.abs(loc.lateral) - loc.halfWidth);
      for (const w of st.wheels) if (w.contact && w.surface !== SURFACE.ASPHALT) offAsphalt++;
      // Speed from the heading change over the next 25 m.
      road.frameAt(loc.s + route.direction * 5, frame);
      const h1 = Math.atan2(frame.tx, frame.tz);
      road.frameAt(loc.s + route.direction * 30, frame);
      const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(frame.tx, frame.tz) - h1), Math.cos(Math.atan2(frame.tx, frame.tz) - h1)));
      const radius = 25 / Math.max(turn, 1e-3);
      const vTarget = Math.min(16, Math.sqrt(0.55 * 9.81 * radius));
      // Pure pursuit to a point 9 m ahead on the centreline.
      road.frameAt(loc.s + route.direction * 9, frame);
      const dx = frame.x - st.position.x;
      const dz = frame.z - st.position.z;
      const lx = dx * st.right.x + dz * st.right.z;
      const lf = dx * st.forward.x + dz * st.forward.z;
      const alpha = Math.atan2(lx, lf);
      const delta = Math.atan((2 * 2.55 * Math.sin(alpha)) / Math.max(4, Math.hypot(dx, dz)));
      const lock = Math.max(6, 34 / (1 + Math.abs(st.forwardSpeed) / 18)) * DEG;
      const err = vTarget - st.forwardSpeed;
      return controls({
        throttle: err > 0 ? Math.min(1, err * 0.5 + 0.2) : 0,
        brake: err < -1.5 ? Math.min(1, -err * 0.3) : 0,
        steer: Math.max(-1, Math.min(1, delta / lock)),
      });
    });
    check(`${routeId}: drives 300 m along the road on asphalt`, finite && travelled >= 300 && maxLat < -0.3 && offAsphalt === 0,
      `travelled ${travelled.toFixed(0)} m, closest edge ${(-maxLat).toFixed(2)} m inside, off-asphalt wheel samples ${offAsphalt}, end speed ${s.speed.toFixed(1)} m/s`);
  }
}

// ------------------------------------------------------------------ run

function testRallyGravel() {
  const world = { waterLevel: -Infinity, sampleGround: (x, z, out) => fillGround(out, 0, 0, 1, 0, 1, 0.74, 0.029) };
  const car = makeVehicle(world);
  car.setHandling('Balanced', CARS.find(entry => entry.id === 'hatch').tuning);
  car.teleport(spawn());
  run(car, 12, (_, state) => state.speed < 20 ? controls({ throttle: 1 }) : null);
  const entry = run(car, 2, (_, state) => Math.abs(state.slipAngle) < 26 * DEG
    ? controls({ steer: 1, handbrake: true, throttle: 0.15 }) : null);
  const angle = Math.abs(entry.slipAngle) / DEG;
  const locks = car.wheels.map(wheel => wheel.locked);
  check('gravel hatch rotates on the hydraulic rear brake at speed',
    angle >= 25 && !locks[0] && !locks[1] && locks[2] && locks[3], angle.toFixed(1) + ' degrees');
  const exit = run(car, 4, (_, state) => controls({ throttle: 0.44,
    steer: Math.max(-1, Math.min(1, state.slipAngle * 3)) }));
  check('gravel hatch pulls straight under power after countersteer',
    Math.abs(exit.slipAngle) < 5 * DEG && exit.speed > 15 && exit.up.y > 0.95,
    (Math.abs(exit.slipAngle) / DEG).toFixed(1) + ' degrees, ' + (exit.speed * 3.6).toFixed(0) + ' km/h');
}

const t0 = Date.now();
testPedalAndWheelResponse();
testRallyGravel();
testSettle();
testGradeHold();
testBank();
testPerformance();
testCornering();
testNoFlip();
testDrift();
testDrop();

// Every selectable car rests on its springs at its own ride height and pulls away (the Hill 4x4 on all four wheels).
function testCars() {
  console.log('\nSelectable cars');
  for (const car of CARS) {
    const v = new Vehicle({ world: flatWorld(), handling: 'Balanced' });
    v.setHandling('Balanced', car.tuning);
    v.setAssists({ driftAssist: 0.6, abs: true, transmission: 'auto' });
    v.teleport(spawn());
    let s = run(v, 2, () => controls());
    const contacts = s.wheels.filter((w) => w.contact).length;
    check(`${car.id} settles on four wheels`, contacts === 4 && Math.abs(s.position.y) < 0.05 && s.speed < 0.2, `y ${s.position.y.toFixed(3)}`);
    // Standing starts on flat dry asphalt, with the same assists for all selectable cars.
    const target = { hatch: [100, 4, 9], gt: [100, 2.6, 4.2], thar: [60, 3.8, 6.5], tokyo: [100, 2.8, 5.4], raijin: [100, 2.6, 3.6] }[car.id];
    let reached = null;
    s = run(v, 12, (time, st) => {
      if (reached === null && st.speed * 3.6 >= target[0]) reached = time;
      return reached === null ? controls({ throttle: 1 }) : null;
    });
    check(`${car.id} 0-${target[0]} km/h in a realistic time`, reached !== null && reached >= target[1] && reached <= target[2], `${reached?.toFixed(2)} s`);
    check(`${car.id} drives the right wheels`, v.wheels.filter((w) => w.driven).length === (car.tuning?.drivetrain?.awd ? 4 : 2));
    if (car.id === 'tokyo') {
      check('Tokyo Sedan wheelbase, 6-speed gearbox, nitro and twin exhaust tips',
        Math.abs(v.wheelbase - 2.70) < 1e-6 && v.drivetrain.gearCount === 6 && car.nitro === true && car.exhaustTips?.length === 2);
    }
    if (car.id === 'raijin') {
      // R35-class benchmarks: 2.78 m wheelbase, six-speed dual-clutch, quad exhausts, 565-600 PS.
      let peakKW = 0;
      for (let rpm = 1500; rpm <= 7300; rpm += 10) peakKW = Math.max(peakKW, v.drivetrain.torqueAt(rpm) * rpm * Math.PI / 30000);
      check('Raijin GT wheelbase, 6-speed DCT, quad exhausts and 557-605 PS peak', Math.abs(v.wheelbase - 2.78) < 1e-6
        && v.drivetrain.gearCount === 6 && car.exhaustTips?.length === 4 && peakKW > 410 && peakKW < 445, `${peakKW.toFixed(0)} kW`);
      check('Raijin GT staggered 20 in tyres on all-wheel drive', v.wheels.every((w) => Math.abs(w.radius - 0.355) < 1e-6 && w.driven));
    }
    if (car.id === 'gt') {
      check('GT3 R wheelbase and staggered slick radii', Math.abs(v.wheelbase - 2.507) < 1e-6 &&
        v.wheels.every(w => Math.abs(w.radius - (w.front ? .340 : .355)) < 1e-6 && w.driven === !w.front));
      let peakKW = 0;
      for (let rpm = 1500; rpm <= 9250; rpm += 10) {
        peakKW = Math.max(peakKW, v.drivetrain.torqueAt(rpm) * rpm * Math.PI / 30000);
      }
      check('GT3 R six-speed box and nominal peak engine power', v.drivetrain.gearCount === 6 &&
        peakKW > 414 && peakKW <= 416, peakKW.toFixed(1) + ' kW');
      const from = s.position.clone();
      s = run(v, 8, (time, st) => st.speed > .05 ? controls({ brake: 1 }) : null);
      const metres = horizDist(s.position, from);
      check('GT3 R dry ABS stop from 100 km/h', s.speed <= .05 && metres > 20 && metres < 37,
        metres.toFixed(1) + ' m');
    }
  }
}

testBarrier();
testReverse();
testNaNRecovery();
testFuzzAndDeterminism();
testDriftScorer();
testCars();
await testRealWorld();

console.log('\nMeasured figures (Balanced)');
console.log('  ' + 'figure'.padEnd(42) + 'value'.padStart(10) + '  unit'.padEnd(8) + '  target');
for (const f of figures) {
  const value = f.value === null || f.value === undefined ? 'n/a' : f.value.toFixed(2);
  console.log('  ' + f.name.padEnd(42) + value.padStart(10) + `  ${f.unit}`.padEnd(8) + `  ${f.target}`);
}
console.log(`\n${passes} passed, ${failures} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures > 0 ? 1 : 0);
