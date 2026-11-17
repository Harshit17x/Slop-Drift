// Ghost recording, encoding and playback tests: `node tests/ghost.test.mjs` (exit code 1 on failure).
// GhostCar (src/render/GhostCar.js) needs a DOM canvas for its name tag and is checked in the browser
// instead: tests/view-ghost.html.
import * as THREE from 'three';
import { encodeGhost, decodeGhost, STEER_TELEPORT } from '../src/ghost/ghostCodec.js';
import { GhostRecorder } from '../src/ghost/GhostRecorder.js';
import { GhostPlayer } from '../src/ghost/GhostPlayer.js';
import { saveLocalGhost, loadLocalGhost, clearLocalGhost, GHOST_KEY_PREFIX } from '../src/ghost/ghostStore.js';
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/vehicle/Vehicle.js';

const DEG = Math.PI / 180;
let failures = 0;
let passes = 0;

function check(name, ok, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  (${detail})` : ''}`);
}

// ------------------------------------------------------------------ synthetic driving

/**
 * A fake VehicleState on a smooth, curving path: a figure of varying-radius arcs with speed changes,
 * body roll and pitch, a little suspension bob. Position, quaternion, velocity, steer at time t.
 */
function makePath({ radius = 60, speed = 25 } = {}) {
  const state = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    steerAngle: 0,
  };
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const at = (t) => {
    // Heading turns at a rate that varies smoothly (left and right), speed oscillates.
    const v = speed * (1 + 0.25 * Math.sin(t * 0.21));
    const heading = (speed / radius) * (t * 0.8 + 4 * Math.sin(t * 0.13) + 1.5 * Math.sin(t * 0.37));
    return { v, heading };
  };
  // Integrate position numerically with a fine step so it is consistent with heading.
  const H = 1 / 1000;
  let tCur = 0;
  const p = new THREE.Vector3(120, 300, -40);
  const cache = [];
  function sample(t) {
    while (tCur < t - 1e-12) {
      const step = Math.min(H, t - tCur);
      const { v, heading } = at(tCur + step / 2);
      p.x += Math.sin(heading) * v * step;
      p.z += -Math.cos(heading) * v * step;
      tCur += step;
    }
    const { v, heading } = at(t);
    const yawRate = (at(t + 1e-4).heading - at(t - 1e-4).heading) / 2e-4;
    state.position.set(p.x, 300 + 8 * Math.sin(t * 0.05) + 0.03 * Math.sin(t * 9), p.z);
    euler.set(0.02 * Math.sin(t * 0.7), -heading, -0.05 * yawRate);
    state.quaternion.setFromEuler(euler);
    state.velocity.set(Math.sin(heading) * v, 0, -Math.cos(heading) * v);
    state.steerAngle = Math.max(-0.55, Math.min(0.55, yawRate * 2.6 / Math.max(5, v)));
    return state;
  }
  sample.reset = () => {
    tCur = 0;
    p.set(120, 300, -40);
    cache.length = 0;
  };
  return sample;
}

/** Record `seconds` of the path with the given frame step; optional teleport at `teleportAt`. */
function recordPath(path, seconds, dt, { teleportAt = null, teleportBy = null, rate = 10 } = {}) {
  path.reset();
  const recorder = new GhostRecorder({ rate });
  recorder.start('sprint', 'Tester', 'ember');
  const offset = new THREE.Vector3();
  let teleported = false;
  const frames = Math.round(seconds / dt);
  for (let k = 0; k <= frames; k += 1) {
    const t = k * dt;
    const state = path(t);
    if (teleportAt !== null && !teleported && t >= teleportAt) {
      teleported = true;
      offset.copy(teleportBy);
      state.position.add(offset);
      recorder.markTeleport(t, state);
    } else if (teleported) {
      state.position.add(offset);
    }
    recorder.sample(t, state);
  }
  return recorder.finish(seconds, 1234);
}

function quatAngle(a, b) {
  const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w));
  return 2 * Math.acos(dot);
}

// ------------------------------------------------------------------ tests

function testRoundTrip() {
  console.log('\nCodec');
  const path = makePath();
  const ghost = recordPath(path, 60, 1 / 60);
  const text = encodeGhost(ghost);
  const back = decodeGhost(text);
  check('encode returns a base64 string', typeof text === 'string' && /^[A-Za-z0-9+/]+=*$/.test(text));
  check('decode restores the header', back && back.modeId === 'sprint' && back.name === 'Tester' && back.paint === 'ember'
    && back.time === 60 && back.score === 1234 && back.rate === 10 && back.count === ghost.count && back.version === 1);
  let maxPos = 0;
  let maxTruth = 0;
  let maxAngle = 0;
  const q = new THREE.Quaternion();
  for (let i = 0; i < ghost.count; i += 1) {
    for (let c = 0; c < 3; c += 1) maxPos = Math.max(maxPos, Math.abs(back.positions[i * 3 + c] - ghost.positions[i * 3 + c]));
  }
  path.reset();
  for (let i = 0; i < back.count - 1; i += 1) {
    const truth = path(i / 10);
    const dx = back.positions[i * 3] - truth.position.x;
    const dy = back.positions[i * 3 + 1] - truth.position.y;
    const dz = back.positions[i * 3 + 2] - truth.position.z;
    maxTruth = Math.max(maxTruth, Math.hypot(dx, dy, dz));
    q.set(back.rotations[i * 4], back.rotations[i * 4 + 1], back.rotations[i * 4 + 2], back.rotations[i * 4 + 3]).normalize();
    maxAngle = Math.max(maxAngle, quatAngle(q, truth.quaternion));
  }
  check('positions survive within 1 cm', maxPos < 0.01 && maxTruth < 0.01, `codec ${(maxPos * 1000).toFixed(2)} mm, vs true path ${(maxTruth * 1000).toFixed(2)} mm`);
  check('rotations survive within 0.1 deg', maxAngle < 0.1 * DEG, `${(maxAngle / DEG).toFixed(4)} deg`);
  let steerSame = true;
  for (let i = 0; i < ghost.count; i += 1) if (back.steer[i] !== ghost.steer[i]) steerSame = false;
  check('steer bytes survive exactly', steerSame);

  // Three minutes of fast, noisy synthetic driving (worst case for the delta coder).
  const fast = makePath({ radius: 45, speed: 34 });
  const long = recordPath(fast, 180, 1 / 60);
  const longText = encodeGhost(long);
  check('3-minute synthetic run encodes under 30 KB', longText.length < 30000, `${long.count} samples, ${(longText.length / 1024).toFixed(1)} KB base64`);
  check('3-minute run decodes', decodeGhost(longText)?.count === long.count);

  // Garbage.
  const garbage = [
    undefined, null, 42, {}, '', 'hello world', 'AAAA', '!!!!@@@@####', '{"positions":[1,2,3]}',
    text.slice(0, text.length - 12), text.slice(0, 40), text + 'AAAA', `x${text}`,
    btoa(String.fromCharCode(...Array.from({ length: 400 }, (_, i) => (i * 97 + 13) & 255))),
  ];
  // A single flipped bit in the middle.
  const bytes = Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));
  bytes[Math.floor(bytes.length / 2)] ^= 4;
  garbage.push(btoa(String.fromCharCode(...bytes.subarray(0, 60000))) + (bytes.length > 60000 ? '' : ''));
  let threw = false;
  let allNull = true;
  for (const input of garbage) {
    try {
      if (decodeGhost(input) !== null) allNull = false;
    } catch {
      threw = true;
    }
  }
  check('garbage decodes to null without throwing', allNull && !threw, `${garbage.length} inputs`);
  check('encode rejects malformed ghosts with null', encodeGhost(null) === null && encodeGhost({ count: 5 }) === null);
  // URL-safe and unpadded variants of a valid string still decode.
  const urlSafe = text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  check('URL-safe base64 decodes', decodeGhost(urlSafe)?.count === ghost.count);
}

function testRecorderRate() {
  console.log('\nRecorder');
  const path = makePath();
  const results = [30, 60, 144].map((hz) => recordPath(path, 20, 1 / hz));
  const counts = results.map((g) => g.count);
  check('sample count independent of frame rate (30/60/144 Hz)', counts.every((c) => c === counts[0]) && counts[0] === 201,
    `counts ${counts.join('/')}`);
  let maxDiff = 0;
  for (let i = 0; i < counts[0] * 3; i += 1) {
    maxDiff = Math.max(maxDiff, Math.abs(results[0].positions[i] - results[2].positions[i]));
  }
  check('samples agree across frame rates', maxDiff < 0.005, `max ${(maxDiff * 1000).toFixed(2)} mm (30 vs 144 Hz)`);

  // Irregular frames (hitches up to 0.2 s) still give one sample per 0.1 s.
  path.reset();
  const recorder = new GhostRecorder({ rate: 10 });
  recorder.start('sprint', 'x', 'pearl');
  let t = 0;
  let k = 0;
  while (t < 20) {
    recorder.sample(t, path(t));
    k += 1;
    t += k % 37 === 0 ? 0.2 : 1 / 60 + 0.004 * Math.sin(k);
  }
  recorder.sample(20, path(20));
  const ghost = recorder.finish(20, 0);
  check('irregular frame steps give the same count', ghost.count === 201, `count ${ghost.count}`);
  check('negative (countdown) times are ignored', (() => {
    const r = new GhostRecorder();
    r.start('sprint', 'x', 'pearl');
    path.reset();
    for (let i = -180; i <= 60; i += 1) r.sample(i / 60, path(Math.max(0, i / 60)));
    return r.finish(1, 0).count === 11;
  })());
  const d = new GhostRecorder();
  d.start('sprint', 'x', 'pearl');
  d.sample(0, path(0));
  d.discard();
  check('discard drops the run', d.finish(1, 0) === null);
}

function testPlayback() {
  console.log('\nPlayback');
  // Constant-speed circle: the true acceleration is v^2/R toward the centre, constant in magnitude.
  const R = 40;
  const v = 25;
  const recorder = new GhostRecorder({ rate: 10 });
  recorder.start('sprint', 'x', 'pearl');
  const state = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), steerAngle: 0.1 };
  const circle = (t, out) => out.set(R * Math.cos((v / R) * t), 0, R * Math.sin((v / R) * t));
  for (let k = 0; k <= 20 * 60; k += 1) {
    const t = k / 60;
    circle(t, state.position);
    state.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -(v / R) * t);
    recorder.sample(t, state);
  }
  const ghost = decodeGhost(encodeGhost(recorder.finish(20, 0)));
  const player = new GhostPlayer(ghost);
  check('duration matches the run', Math.abs(player.duration - 20) < 1e-9, `${player.duration.toFixed(3)} s`);

  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const prev = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const prevVel = new THREE.Vector3();
  const truth = new THREE.Vector3();
  const dt = 1 / 240;
  let maxErr = 0;
  let maxJump = 0;
  let maxSpeedErr = 0;
  let maxLinearJump = 0;
  for (let k = 0; k <= 18 * 240; k += 1) {
    const t = 1 + k * dt;
    player.poseAt(t, p, q);
    maxErr = Math.max(maxErr, p.distanceTo(circle(t, truth)));
    if (k > 0) {
      vel.subVectors(p, prev).divideScalar(dt);
      maxSpeedErr = Math.max(maxSpeedErr, Math.abs(vel.length() - v));
      if (k > 1) maxJump = Math.max(maxJump, vel.distanceTo(prevVel));
      prevVel.copy(vel);
    }
    prev.copy(p);
  }
  // Linear interpolation for comparison: velocity jumps at each sample by ~v * (v/R) / rate.
  maxLinearJump = (v * v) / R / 10;
  const smoothBound = ((v * v) / R) * dt * 3; // three times the true per-frame velocity change
  check('interpolated path stays on the circle', maxErr < 0.03, `max ${(maxErr * 1000).toFixed(1)} mm off`);
  check('no velocity spikes between samples', maxJump < smoothBound,
    `max dv per frame ${maxJump.toFixed(3)} m/s, bound ${smoothBound.toFixed(3)}, linear interp would jump ${maxLinearJump.toFixed(2)}`);
  check('speed is steady through samples', maxSpeedErr < 0.3, `max speed error ${maxSpeedErr.toFixed(3)} m/s`);

  // Clamping.
  const first = new THREE.Vector3(ghost.positions[0], ghost.positions[1], ghost.positions[2]);
  const n = ghost.count - 1;
  const last = new THREE.Vector3(ghost.positions[n * 3], ghost.positions[n * 3 + 1], ghost.positions[n * 3 + 2]);
  let r = player.poseAt(-5, p, q);
  const beforeOk = p.distanceTo(first) < 1e-6 && r.finished === false;
  r = player.poseAt(Number.NaN, p, q);
  const nanOk = p.distanceTo(first) < 1e-6;
  r = player.poseAt(player.duration + 10, p, q);
  const afterOk = p.distanceTo(last) < 1e-6 && r.finished === true;
  const exactEnd = player.poseAt(player.duration, p, q).finished && p.distanceTo(last) < 1e-6;
  check('poseAt clamps before the start and after the end', beforeOk && afterOk && nanOk && exactEnd);
  check('poseAt returns a reused result object', player.poseAt(3, p, q) === player.poseAt(4, p, q));
  check('steer decodes to radians', Math.abs(player.poseAt(5, p, q).steer - 0.1) < 0.006);
}

function testTeleport() {
  console.log('\nTeleport');
  const path = makePath();
  const jump = new THREE.Vector3(400, -60, 250);
  const ghost = decodeGhost(encodeGhost(recordPath(path, 12, 1 / 60, { teleportAt: 5.03, teleportBy: jump })));
  let flags = 0;
  for (let i = 0; i < ghost.count; i += 1) if (ghost.steer[i] === STEER_TELEPORT) flags += 1;
  check('one teleport sample is stored and survives encoding', flags === 1);
  const player = new GhostPlayer(ghost);
  // Every played position lies on the original path or on the shifted one: none in between.
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const truth = new THREE.Vector3();
  let worst = 0;
  let snapTime = null;
  let prevSide = 0;
  path.reset();
  for (let k = 0; k <= 12 * 240; k += 1) {
    const t = k / 240;
    player.poseAt(t, p, q);
    truth.copy(path(t).position);
    const dPre = p.distanceTo(truth);
    const dPost = p.distanceTo(truth.add(jump));
    const side = dPre < dPost ? 0 : 1;
    // Allowed lag: holding the pre-jump pose for up to one sample (2.5 m at 25 m/s).
    worst = Math.max(worst, Math.min(dPre, dPost));
    if (side !== prevSide && snapTime === null) snapTime = t;
    prevSide = side;
  }
  check('playback snaps across the teleport instead of interpolating', worst < 4,
    `worst distance from either path ${worst.toFixed(2)} m, snap at ${snapTime?.toFixed(3)} s`);
  check('snap happens within one sample of the respawn', snapTime !== null && snapTime >= 5.03 && snapTime <= 5.03 + 0.1 + 1e-9);
  // Away from the jump the curve is still smooth (tangents do not reach across it).
  path.reset();
  let maxErrAfter = 0;
  for (let t = 5.2; t < 11.8; t += 1 / 60) {
    player.poseAt(t, p, q);
    maxErrAfter = Math.max(maxErrAfter, p.distanceTo(truth.copy(path(t).position).add(jump)));
  }
  check('path after the teleport is accurate', maxErrAfter < 0.05, `max ${(maxErrAfter * 1000).toFixed(1)} mm`);
}

function testStore() {
  console.log('\nStore');
  const memory = new Map();
  let full = false;
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => {
      if (full) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      memory.set(key, String(value));
    },
    removeItem: (key) => memory.delete(key),
  };
  const ghost = recordPath(makePath(), 10, 1 / 60);
  check('saveLocalGhost stores under the v1 prefix', saveLocalGhost('sprint', ghost) && memory.has(`${GHOST_KEY_PREFIX}sprint`));
  const loaded = loadLocalGhost('sprint');
  check('loadLocalGhost returns the ghost', loaded?.count === ghost.count && loaded.name === 'Tester');
  check('missing mode loads null', loadLocalGhost('climb') === null);
  memory.set(`${GHOST_KEY_PREFIX}descent`, 'garbage!!');
  check('corrupt entry loads null', loadLocalGhost('descent') === null);
  full = true;
  check('quota error returns false', saveLocalGhost('circuit', ghost) === false);
  full = false;
  check('clearLocalGhost removes it', clearLocalGhost('sprint') && loadLocalGhost('sprint') === null);
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  let threw = false;
  try {
    saveLocalGhost('sprint', ghost);
    loadLocalGhost('sprint');
    clearLocalGhost('sprint');
  } catch {
    threw = true;
  }
  check('blocked storage never throws', !threw);
  delete globalThis.localStorage;
  check('no storage at all returns false/null', saveLocalGhost('sprint', ghost) === false && loadLocalGhost('sprint') === null);
}

async function testRealWorld() {
  console.log('\nReal vehicle on the real world');
  const world = await new World().build();
  const route = world.routes.loop;
  const roadId = route.roadId;
  const road = world.roads[roadId];
  const vehicle = new Vehicle({ world });
  vehicle.setAssists({ driftAssist: 0.6, abs: true, transmission: 'auto' });
  let state = vehicle.teleport(world.getSpawn('loop', route.startS));
  const loc = {};
  const frame = {};
  const controls = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false, shift: 0 };
  const steerTo = (st) => {
    world.locate(st.position.x, st.position.z, loc, roadId);
    road.frameAt(loc.s + route.direction * 5, frame);
    const h1 = Math.atan2(frame.tx, frame.tz);
    road.frameAt(loc.s + route.direction * 30, frame);
    const h2 = Math.atan2(frame.tx, frame.tz);
    const turn = Math.abs(Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)));
    const vTarget = Math.min(24, Math.sqrt(0.55 * 9.81 * (25 / Math.max(turn, 1e-3))));
    road.frameAt(loc.s + route.direction * (9 + st.speed * 0.2), frame);
    const dx = frame.x - st.position.x;
    const dz = frame.z - st.position.z;
    const lx = dx * st.right.x + dz * st.right.z;
    const lf = dx * st.forward.x + dz * st.forward.z;
    const delta = Math.atan((2 * 2.55 * Math.sin(Math.atan2(lx, lf))) / Math.max(4, Math.hypot(dx, dz)));
    const lock = Math.max(6, 34 / (1 + Math.abs(st.forwardSpeed) / 18)) * DEG;
    const err = vTarget - st.forwardSpeed;
    controls.throttle = err > 0 ? Math.min(1, err * 0.5 + 0.2) : 0;
    controls.brake = err < -1.5 ? Math.min(1, -err * 0.3) : 0;
    controls.steer = Math.max(-1, Math.min(1, delta / lock));
    return controls;
  };

  const recorder = new GhostRecorder({ rate: 10 });
  recorder.start('sprint', 'Autopilot', 'glacier');
  const frames = [];
  const DT = 1 / 60;
  const seconds = 180;
  const t0 = Date.now();
  let spinForward = true;
  for (let k = 0; k <= seconds * 60; k += 1) {
    const t = k * DT;
    recorder.sample(t, state);
    if (k % 7 === 0) frames.push({ t, x: state.position.x, y: state.position.y, z: state.position.z });
    state = vehicle.step(DT, steerTo(state));
    if (k === 600 && !(state.wheels[2].spinAngle > 0)) spinForward = false;
  }
  const ghost = recorder.finish(seconds, 0);
  const text = encodeGhost(ghost);
  const back = decodeGhost(text);
  world.locate(state.position.x, state.position.z, loc, roadId);
  check(`3-minute real drive encodes under 30 KB`, text.length < 30000,
    `${ghost.count} samples, ${(text.length / 1024).toFixed(1)} KB base64 (${text.length} chars), ${(Date.now() - t0) / 1000} s to simulate`);
  check('vehicle wheel spin is positive driving forward (GhostCar uses the same sign)', spinForward);

  const player = new GhostPlayer(back);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const at = {};
  let offRoad = 0;
  let worstMargin = Infinity;
  let maxErr = 0;
  let travelled = 0;
  let last = null;
  for (const f of frames) {
    player.poseAt(f.t, p, q);
    world.locate(p.x, p.z, at, 0);
    if (!(at.roadId >= 0 && at.distance <= at.halfWidth)) offRoad += 1;
    worstMargin = Math.min(worstMargin, at.halfWidth - at.distance);
    maxErr = Math.max(maxErr, Math.hypot(p.x - f.x, p.y - f.y, p.z - f.z));
    if (last) travelled += Math.hypot(p.x - last.x, p.z - last.z);
    last = p.clone();
  }
  check('replayed run stays on the road the whole way', offRoad === 0 && travelled > 1000,
    `${frames.length} poses, ${travelled.toFixed(0)} m, closest ${worstMargin.toFixed(2)} m inside the edge`);
  check('replay matches the live car between samples', maxErr < 0.1, `max ${(maxErr * 100).toFixed(1)} cm`);
}

// ------------------------------------------------------------------ run

testRoundTrip();
testRecorderRate();
testPlayback();
testTeleport();
testStore();
await testRealWorld();

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
