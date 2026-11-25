// Tests for src/game/RaceSession.js and a smoke test for src/audio/AudioEngine.js.
// Run: node tests/session.test.mjs   (exit code 1 on failure)

import { RaceSession } from '../src/game/RaceSession.js';
import { AudioEngine } from '../src/audio/AudioEngine.js';
import {
  SAMPLE_RMS, centroid, cycleHz, firingHz, harmonicShare, pulseSeries, resolveSynth, spoolTarget, synthWaves, unevenness,
  waveStats, whineHz,
} from '../src/audio/engineSynth.js';
import { CARS } from '../src/vehicle/cars.js';
import { MODES, loadRecords, saveRecords } from '../src/config.js';

let failures = 0;
let passes = 0;
const pending = [];
function test(name, fn) {
  pending.push([name, fn]);
}
function assert(cond, message) {
  if (!cond) throw new Error(message || 'assertion failed');
}
function near(a, b, eps, message) {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${message || 'not near'}: ${a} vs ${b} (eps ${eps})`);
}

// ------------------------------------------------------------------ fake world
// Road 0: circle of radius R centred at the origin, closed. s = angle * R, counter-clockwise in x/z.
// Road 1: straight open road along +x at z = Z1, s = x in [0, LEN1].
const R = 200;
const L0 = 2 * Math.PI * R;
const Z1 = 3000;
const LEN1 = 2000;
const HALF_WIDTH = 5;

function roadPoint(roadId, s, lateral, out) {
  if (roadId === 0) {
    const a = s / R;
    const r = R - lateral; // + lateral is to the right of +s travel, which is inward on this circle
    out.x = r * Math.cos(a);
    out.z = r * Math.sin(a);
    out.tx = -Math.sin(a);
    out.tz = Math.cos(a);
  } else {
    out.x = s;
    out.z = Z1 + lateral; // right of +x travel (forward -Z frame: right = (-tz, tx) = (0, 1))
    out.tx = 1;
    out.tz = 0;
  }
  return out;
}

function locateRoad(roadId, x, z, out) {
  out.roadId = roadId;
  out.y = 0;
  out.ty = 0;
  out.halfWidth = HALF_WIDTH;
  if (roadId === 0) {
    const a = Math.atan2(z, x);
    const s = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * R;
    out.s = s;
    out.progress = s / L0;
    out.lateral = R - Math.hypot(x, z);
    out.tx = -Math.sin(s / R);
    out.tz = Math.cos(s / R);
  } else {
    const s = Math.max(0, Math.min(LEN1, x));
    out.s = s;
    out.progress = s / LEN1;
    out.lateral = z - Z1;
    out.tx = 1;
    out.tz = 0;
  }
  out.distance = Math.abs(out.lateral);
  return out;
}

function makeWorld() {
  const tmp = { roadId: -1 };
  const world = {
    roads: [{ length: L0, closed: true }, { length: LEN1, closed: false }],
    routes: {
      // Start line at s = 1000, so the lap wraps through s = 0 and checkpoints straddle the seam.
      loop: { id: 'loop', roadId: 0, closed: true, direction: 1, startS: 1000, finishS: 1000, length: L0, checkpoints: [1200, 200, 600] },
      climb: { id: 'climb', roadId: 1, closed: false, direction: 1, startS: 100, finishS: 1900, length: 1800, checkpoints: [600.3, 1200.7] },
      descent: { id: 'descent', roadId: 1, closed: false, direction: -1, startS: 1900, finishS: 100, length: 1800, checkpoints: [1200.7, 600.3] },
    },
    locate(x, z, out, roadId) {
      if (roadId === 0 || roadId === 1) return locateRoad(roadId, x, z, out);
      locateRoad(0, x, z, out);
      const d0 = Math.abs(out.lateral);
      locateRoad(1, x, z, tmp);
      if (Math.abs(tmp.lateral) < d0) Object.assign(out, tmp);
      return out;
    },
    getSpawn(routeId, s, out) {
      const route = world.routes[routeId];
      const p = roadPoint(route.roadId, s, 0, {});
      out.position = out.position || {};
      out.position.x = p.x;
      out.position.y = 0;
      out.position.z = p.z;
      const fx = p.tx * route.direction;
      const fz = p.tz * route.direction;
      const yaw = Math.atan2(-fx, -fz); // rotation about +Y that maps -Z onto (fx, fz)
      out.quaternion = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
      return out;
    },
  };
  return world;
}

function mode(id) {
  return MODES.find((m) => m.id === id);
}

// ------------------------------------------------------------------ driver
class Driver {
  constructor(world, session, roadId) {
    this.world = world;
    this.session = session;
    this.roadId = roadId;
    this.state = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, upsideDown: false };
    this.drift = { active: false, angleDeg: 0, score: 0, bank: 0, multiplier: 1, comboTimer: 0, comboWindow: 2 };
    this.events = [];
    this.s = 0;
    this.lateral = 0;
    this.pt = {};
  }
  placeAtStart() {
    const pose = this.session.getStartPose({});
    this.s = this.world.locate(pose.position.x, pose.position.z, {}, this.roadId).s;
    this.lateral = 0;
    return pose;
  }
  placeAt(s, lateral = 0) {
    this.s = s;
    this.lateral = lateral;
  }
  setState(vs) {
    const p = roadPoint(this.roadId, this.s, this.lateral, this.pt);
    this.state.position.x = p.x;
    this.state.position.z = p.z;
    this.state.velocity.x = p.tx * vs;
    this.state.velocity.z = p.tz * vs;
    this.state.speed = Math.abs(vs);
  }
  /** Drive `distance` metres along +s (negative = along -s) at `speed` m/s with `hz` updates. */
  drive(distance, speed, hz, opts = {}) {
    const dt = 1 / hz;
    const step = speed * dt;
    const n = Math.ceil(Math.abs(distance) / step - 1e-9);
    const sign = Math.sign(distance);
    for (let i = 0; i < n; i += 1) {
      const ds = Math.min(step, Math.abs(distance) - i * step) * sign;
      this.s += ds;
      if (this.roadId === 0) this.s = ((this.s % L0) + L0) % L0;
      if (opts.lateral !== undefined) this.lateral = opts.lateral;
      this.setState(sign * speed);
      this.tick(Math.abs(ds) / speed); // a shortened last step takes proportionally less time
      if (this.session.finished && !opts.continueAfterFinish) break;
    }
  }
  /** Stand still / move without changing s, for `seconds`. */
  hold(seconds, hz, vs = 0) {
    const dt = 1 / hz;
    const n = Math.round(seconds * hz);
    for (let i = 0; i < n; i += 1) {
      this.setState(vs);
      this.tick(dt);
    }
  }
  tick(dt) {
    const out = this.session.update(dt, this.state, this.drift);
    for (const e of out) this.events.push({ ...e, at: this.session.elapsed });
  }
  count(type) {
    return this.events.filter((e) => e.type === type).length;
  }
  of(type) {
    return this.events.filter((e) => e.type === type);
  }
}

function newRun(id, records = {}, roadId) {
  const world = makeWorld();
  const m = mode(id);
  const session = new RaceSession({ world, mode: m, records });
  const driver = new Driver(world, session, roadId ?? world.routes[m.route].roadId);
  driver.placeAtStart();
  return { world, session, driver, records };
}

// d along the loop route from s (start at 1000).
const loopD = (s) => (((s - 1000) % L0) + L0) % L0;

// ------------------------------------------------------------------ RaceSession tests

test('clean lap completes with the right time', () => {
  const { session, driver } = newRun('sprint');
  driver.drive(L0 + 30, 50, 120);
  assert(driver.count('checkpoint') === 3, `checkpoints ${driver.count('checkpoint')}`);
  assert(driver.count('lap') === 1, 'one lap');
  assert(driver.count('finish') === 1, 'finished');
  assert(session.finished, 'session.finished');
  const expected = (L0 + 6) / 50; // start pose is 6 m behind the line
  near(session.result.time, expected, 1e-6, 'lap time');
  near(driver.of('lap')[0].time, expected, 1e-6, 'lap event time');
  assert(driver.of('lap')[0].isBest === true, 'first lap is best');
  assert(session.result.isRecord && session.result.bestTime === session.result.time, 'record');
  assert(session.result.laps.length === 1, 'laps array');
  near(session.result.topSpeedKmh, 180, 1e-9, 'top speed');
  assert(session.hud.progress === 1 && session.hud.lap === 1 && session.hud.laps === 1, 'hud final');
  const cps = driver.of('checkpoint');
  assert(cps.map((c) => c.index).join() === '0,1,2' && cps.every((c) => c.total === 3 && c.split === null), 'checkpoint events');
});

test('circuit needs two laps; HUD lap counter advances', () => {
  const { session, driver } = newRun('circuit');
  driver.drive(L0 + 30, 50, 60);
  assert(driver.count('lap') === 1 && !session.finished, 'one lap, not finished');
  assert(session.hud.lap === 2 && session.hud.lastLap !== null, 'hud on lap 2');
  near(session.hud.progress, (1 + 24 / L0) / 2, 1e-6, 'overall progress');
  driver.drive(L0, 50, 60);
  assert(driver.count('lap') === 2 && session.finished, 'finished after 2 laps');
  near(session.result.time, (2 * L0 + 6) / 50, 1e-6, 'total time');
  near(session.result.laps[1], L0 / 50, 1e-6, 'second lap time');
  assert(driver.of('checkpoint').map((c) => c.index).join() === '0,1,2,0,1,2', 'checkpoints per lap');
});

test('reversing across the line does not count', () => {
  const { session, driver } = newRun('sprint');
  driver.drive(20, 15, 60); // cross the line forward (start of the run)
  driver.drive(-30, 8, 60); // reverse back over it
  driver.drive(30, 15, 60); // and forward again
  driver.drive(-30, 8, 60);
  driver.drive(40, 15, 60);
  assert(driver.count('lap') === 0, 'no lap from rocking over the line');
  // Finish a real lap after one full lap of driving: exactly one lap counts.
  driver.drive(L0, 50, 60);
  assert(driver.count('lap') === 1 && session.finished, 'one real lap');
});

test('reversing over the line after a lap does not count another', () => {
  const { session, driver } = newRun('circuit');
  driver.drive(L0 + 20, 50, 60);
  assert(driver.count('lap') === 1, 'lap 1');
  driver.drive(-40, 8, 60);
  driver.drive(40, 20, 60);
  assert(driver.count('lap') === 1 && !session.finished, 'still one lap');
});

test('skipping checkpoints does not count; going back for them does', () => {
  const { session, driver } = newRun('sprint');
  // Drive to 20 m before checkpoint 1 (s = 200 -> d = 456.6), then teleport 100 m beyond it.
  const d1 = loopD(200);
  driver.drive(6 + d1 - 20, 40, 60);
  assert(driver.count('checkpoint') === 1, 'cp0 passed');
  driver.placeAt((driver.s + 120) % L0);
  driver.drive(L0 - d1 - 100, 40, 60); // carry on over cp2 and the line
  assert(driver.count('lap') === 0, 'no lap with a skipped checkpoint');
  assert(driver.count('checkpoint') === 1, 'cp2 does not count before cp1');
  assert(!session.finished, 'not finished');
  // Carry on round the loop: cp1 is crossed on the way, then cp2, then the line.
  driver.drive(L0, 40, 60);
  assert(driver.count('checkpoint') === 3, 'cp1 and cp2 picked up on the next pass');
  assert(driver.count('lap') === 1 && session.finished, 'lap counts after going back');
});

test('skipped checkpoint can be fixed by reversing to it', () => {
  const { session, driver } = newRun('climb');
  driver.drive(6 + 480, 40, 60); // d = 480, cp0 at d = 500.3
  driver.placeAt(driver.s + 60); // teleport over cp0
  driver.drive(30, 40, 60);
  assert(driver.count('checkpoint') === 0, 'teleport over cp0 not counted');
  driver.drive(-120, 10, 60); // reverse back behind it
  driver.drive(1800, 50, 60);
  assert(driver.count('checkpoint') === 2 && session.finished, 'counted after going back');
});

for (const hz of [120, 20]) {
  test(`full-speed gate pass detected at ${hz} Hz`, () => {
    const { session, driver } = newRun('climb', {}, 1);
    driver.drive(1830, 60, hz);
    assert(driver.count('checkpoint') === 2, `checkpoints at ${hz} Hz: ${driver.count('checkpoint')}`);
    assert(driver.count('finish') === 1, 'finish');
    near(session.result.time, (1800 + 6) / 60, 1e-6, 'interpolated finish time');
    assert(driver.count('wrongWay') === 0 && driver.count('offRoad') === 0, 'no warnings');
  });
}

test('high speed with a low frame rate on the loop', () => {
  const { session, driver } = newRun('sprint');
  driver.drive(L0 + 30, 70, 15);
  assert(driver.count('checkpoint') === 3 && session.finished, 'all gates at 15 Hz / 70 m/s');
});

test('teleport across a gate is not a crossing', () => {
  const { driver } = newRun('climb');
  driver.drive(6 + 490, 30, 60);
  driver.placeAt(driver.s + 25); // jump over cp0 (d 500.3) in one update
  driver.hold(0.1, 60);
  assert(driver.count('checkpoint') === 0, 'no checkpoint from teleport');
});

test('respawn: pose on the route, not ahead of progress, no crossing', () => {
  const { session, driver, world } = newRun('climb');
  driver.drive(6 + 540, 30, 60); // past cp0 (500.3) by ~40 m
  assert(driver.count('checkpoint') === 1, 'cp0');
  // Drift off the road for a while: respawn position must not follow.
  driver.drive(60, 30, 60, { lateral: 20 });
  const pose = session.getRespawnPose({});
  const loc = world.locate(pose.position.x, pose.position.z, {}, 1);
  near(loc.lateral, 0, 1e-6, 'on centreline');
  near(loc.s, 100 + 540, 1.5, 'last on-road position');
  // Facing the driving direction: rotate -Z by the quaternion.
  const q = pose.quaternion;
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  near(fx, 1, 1e-6, 'faces +x on the climb');
  near(fz, 0, 1e-6, 'faces +x on the climb (z)');
  // Respawn there.
  session.addRespawn();
  driver.placeAt(loc.s, 0);
  driver.hold(0.05, 60);
  assert(driver.count('checkpoint') === 1, 'respawn does not recount');
  assert(session.respawns === 1, 'respawn counted');

  // Cheat: teleport over cp1 and drive on. Respawn must stay behind cp1.
  driver.drive(600, 40, 60); // on to d ~1140, over cp1 at d 1100.7
  assert(driver.count('checkpoint') === 2, 'cp1 legit');
  const { session: s2, driver: d2, world: w2 } = newRun('climb');
  d2.drive(6 + 1050, 40, 60);
  d2.placeAt(d2.s + 200); // over cp1 at d 1100.7
  d2.drive(100, 40, 60);
  assert(d2.count('checkpoint') === 1, 'cp1 skipped');
  const p2 = s2.getRespawnPose({});
  const l2 = w2.locate(p2.position.x, p2.position.z, {}, 1);
  assert(l2.s <= 100 + 1100.7, `respawn ${l2.s} not ahead of the missed gate`);
  near(l2.s, 100 + 1050, 1.5, 'respawn at the last legitimate spot');
  // Respawn and drive on: cp1 counts now.
  s2.addRespawn();
  d2.placeAt(l2.s);
  d2.drive(900, 40, 60);
  assert(d2.count('checkpoint') === 2 && s2.finished, 'finishes after legit respawn');
  assert(s2.result.respawns === 1, 'result.respawns');
});

test('respawn pose before any driving is the start pose area', () => {
  const { session, world } = newRun('sprint');
  const p = session.getRespawnPose({});
  const loc = world.locate(p.position.x, p.position.z, {}, 0);
  near(loopD(loc.s), L0 - 6, 1e-6, 'behind start line');
});

test('descent drives the spur backwards', () => {
  const { session, driver, world } = newRun('descent');
  const start = world.locate(...[session.getStartPose({}).position].flatMap((p) => [p.x, p.z]), {}, 1);
  near(start.s, 1906, 1e-6, 'start pose 6 m behind (s larger)');
  driver.drive(-1830, 45, 60);
  assert(driver.count('checkpoint') === 2, 'checkpoints');
  assert(driver.of('checkpoint').map((c) => c.index).join() === '0,1', 'order');
  assert(session.finished, 'finished');
  near(session.result.time, 1806 / 45, 1e-6, 'time');
  assert(driver.count('wrongWay') === 0, 'not wrong way');
});

test('descent start at road end clamps, driving up the descent is wrong way', () => {
  const world = makeWorld();
  world.routes.descent.startS = 2000; // start at the very end of the road
  world.routes.descent.length = 1900;
  const session = new RaceSession({ world, mode: mode('descent'), records: {} });
  const pose = session.getStartPose({});
  near(world.locate(pose.position.x, pose.position.z, {}, 1).s, 2000, 1e-9, 'clamped to road end');
  const driver = new Driver(world, session, 1);
  driver.placeAt(1500);
  driver.drive(200, 20, 60); // +s is against the descent
  assert(driver.of('wrongWay').length === 1 && driver.of('wrongWay')[0].active, 'wrong way raised');
});

test('drift mode ends on time with bank + score', () => {
  const records = {};
  const { session, driver } = newRun('drift', records);
  driver.drift.bank = 1000;
  driver.drift.score = 250;
  driver.drive(10000, 30, 60);
  assert(session.finished, 'finished');
  assert(driver.count('lap') === 0 && driver.count('checkpoint') === 0, 'no laps or checkpoints');
  near(session.result.time, 120, 1e-9, 'time limit');
  near(driver.of('finish')[0].at, 120, 1e-9, 'elapsed clamped');
  assert(session.result.score === 1250, 'score');
  assert(session.result.isRecord && records.drift.score === 1250, 'drift record');
  assert(session.hud.timeLeft === 0, 'time left 0');
  // Updates after finishing are no-ops.
  assert(session.update(1 / 60, driver.state, driver.drift).length === 0, 'no events after finish');
  // Lower score does not replace the record.
  const r2 = newRun('drift', records);
  r2.driver.drift.bank = 900;
  r2.driver.drive(10000, 30, 60);
  assert(!r2.session.result.isRecord && records.drift.score === 1250 && r2.session.result.bestScore === 1250, 'record kept');
});

test('drift mode HUD counts down', () => {
  const { session, driver } = newRun('drift');
  driver.drive(300, 30, 60);
  near(session.hud.timeLeft, 110, 1e-6, 'time left');
  assert(session.hud.lap === 0 && session.hud.laps === 0, 'no laps');
});

test('roam never finishes but tracks progress', () => {
  const { session, driver } = newRun('roam');
  driver.drive(3 * L0, 60, 30);
  assert(!session.finished && driver.count('finish') === 0 && driver.count('lap') === 0, 'never finishes');
  assert(session.hud.progress > 0 && session.hud.progress < 1, 'progress');
  driver.drive(-100, 20, 30);
  assert(session.hud.wrongWay, 'wrong way tracked in roam');
});

test('wrong way debounces and clears immediately', () => {
  const { session, driver } = newRun('sprint');
  driver.drive(50, 20, 60);
  driver.hold(1, 60); // standing still never raises it
  driver.drive(-3 * 0.9, 3, 60); // slow reverse for 0.9 s: below 5 m/s
  driver.drive(-12, 4, 60); // 3 s at 4 m/s: still below the threshold
  assert(driver.count('wrongWay') === 0, 'slow reverse is fine');
  driver.drive(-18, 20, 60); // 0.9 s of wrong way
  assert(driver.count('wrongWay') === 0, 'not before 1 s');
  driver.drive(-6, 20, 60); // 0.3 s more
  assert(driver.count('wrongWay') === 1 && session.hud.wrongWay, 'raised after 1 s');
  const raisedAt = driver.of('wrongWay')[0].at;
  near(raisedAt, 2.5 + 1 + 0.9 + 3 + 0.9 + 0.1, 0.05, 'raised at the 1 s mark');
  driver.drive(1 / 3, 20, 60); // one frame driving the right way
  assert(driver.count('wrongWay') === 2 && !driver.of('wrongWay')[1].active && !session.hud.wrongWay, 'cleared immediately');
  // A brief wrong-way blip (0.5 s) never raises.
  driver.drive(-10, 20, 60);
  driver.drive(10, 20, 60);
  assert(driver.count('wrongWay') === 2, 'blip ignored');
});

test('off road debounces and clears immediately', () => {
  const { session, driver } = newRun('sprint');
  driver.drive(10, 20, 60);
  driver.drive(10, 20, 60, { lateral: 12 }); // 0.5 s at |lateral| 12 > 5 + 4
  driver.drive(10, 20, 60, { lateral: 0 });
  assert(driver.count('offRoad') === 0, 'short excursion ignored');
  driver.drive(10, 20, 60, { lateral: 8 }); // 8 < 9: on the verge, not off road
  driver.drive(30, 20, 60, { lateral: -8.5 });
  assert(driver.count('offRoad') === 0, 'shoulder is not off road');
  driver.drive(30, 20, 60, { lateral: -12 }); // 1.5 s
  assert(driver.count('offRoad') === 1 && session.hud.offRoad, 'raised');
  driver.drive(1 / 3, 20, 60, { lateral: 0 });
  assert(driver.count('offRoad') === 2 && !session.hud.offRoad, 'cleared');
});

test('records and splits update only on improvement', () => {
  const records = {};
  const r1 = newRun('sprint', records);
  r1.driver.drive(L0 + 30, 50, 60);
  const t1 = r1.session.result.time;
  assert(records.sprint && records.sprint.time === t1, 'first record');
  assert(Array.isArray(records.sprint.splits) && records.sprint.splits.length === 3, 'splits stored');
  near(records.sprint.splits[0], (6 + loopD(1200)) / 50, 1e-6, 'split 0 time');
  near(records.sprint.bestLap, t1, 1e-9, 'best lap');
  const splitsBefore = records.sprint.splits.slice();

  // Slower run: no record; splits reported as positive deltas.
  const r2 = newRun('sprint', records);
  r2.driver.drive(L0 + 30, 40, 60);
  const cps = r2.driver.of('checkpoint');
  assert(cps.every((c) => typeof c.split === 'number' && c.split > 0), 'positive splits');
  near(cps[0].split, (6 + loopD(1200)) / 40 - (6 + loopD(1200)) / 50, 1e-6, 'split delta');
  assert(!r2.session.result.isRecord, 'not a record');
  assert(r2.driver.of('lap')[0].isBest === false, 'lap not best');
  assert(records.sprint.time === t1 && records.sprint.splits.join() === splitsBefore.join(), 'record unchanged');
  assert(r2.session.result.bestTime === t1, 'bestTime is the standing record');

  // Faster run: record and splits replaced, negative deltas.
  const r3 = newRun('sprint', records);
  r3.driver.drive(L0 + 30, 60, 60);
  assert(r3.driver.of('checkpoint').every((c) => c.split < 0), 'negative splits');
  assert(r3.session.result.isRecord && records.sprint.time === r3.session.result.time, 'new record');
  assert(r3.driver.of('lap')[0].isBest, 'lap is best');
  near(records.sprint.splits[0], (6 + loopD(1200)) / 60, 1e-6, 'splits replaced');
  // Other modes untouched.
  assert(Object.keys(records).join() === 'sprint', 'only sprint written');
});

test('records are stored per map; Alpine keeps the pre-map save', () => {
  const memory = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: (k) => (memory.has(k) ? memory.get(k) : null), setItem: (k, v) => memory.set(k, String(v)) };
  try {
    // A save from before maps existed: bare mode ids.
    memory.set('slop-drift-records-v1', JSON.stringify({ sprint: { time: 170 }, drift: { score: 5000 } }));
    const alpine = loadRecords('alpine');
    assert(alpine.sprint.time === 170 && alpine.drift.score === 5000, 'legacy records are alpine');
    assert(Object.keys(loadRecords('mussoorie')).length === 0, 'mussoorie starts empty');

    // A Mussoorie run through RaceSession writes the per-map view, keyed by mode id.
    const hills = loadRecords('mussoorie');
    const run = newRun('sprint', hills);
    run.driver.drive(L0 + 30, 50, 60);
    assert(hills.sprint.time === run.session.result.time && run.session.result.isRecord, 'first mussoorie run is a record');
    saveRecords(hills, 'mussoorie');
    const stored = JSON.parse(memory.get('slop-drift-records-v1'));
    assert(stored.sprint.time === 170 && stored['mussoorie.sprint'].time === hills.sprint.time, `stored ${JSON.stringify(Object.keys(stored))}`);
    assert(loadRecords('alpine').sprint.time === 170 && loadRecords('mussoorie').sprint.time === hills.sprint.time, 'reload per map');
    assert(loadRecords().sprint.time === 170, 'default map is the legacy one');
    memory.set('slop-drift-records-v1', '[1,2]');
    assert(Object.keys(loadRecords('alpine')).length === 0, 'junk save loads empty');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test('constructor rejects unknown routes, HUD shape matches HudFrame.session', () => {
  let threw = false;
  try {
    new RaceSession({ world: makeWorld(), mode: { id: 'x', label: 'X', route: 'nope', laps: 1 }, records: {} });
  } catch {
    threw = true;
  }
  assert(threw, 'throws on unknown route');
  const { session } = newRun('climb');
  const keys = ['modeId', 'modeLabel', 'lap', 'laps', 'elapsed', 'lapTime', 'bestLap', 'lastLap', 'progress', 'timeLeft', 'wrongWay', 'offRoad'];
  assert(keys.every((k) => k in session.hud), 'hud keys');
  assert(session.hud.modeLabel === 'Summit Climb', 'label');
});

test('update reuses its events array and HUD object', () => {
  const { session, driver } = newRun('sprint');
  const hud = session.hud;
  driver.setState(10);
  const a = session.update(1 / 60, driver.state, driver.drift);
  const b = session.update(1 / 60, driver.state, driver.drift);
  assert(a === b && session.hud === hud, 'reused');
});

// ------------------------------------------------------------------ AudioEngine smoke tests

function audioState(overrides = {}) {
  const wheel = (slip, surface) => ({ contact: true, slip, surface, spinSpeed: 40, load: 3000 });
  return {
    speed: 30,
    speedKmh: 108,
    rpm: 7400,
    rpmMax: 7500,
    throttle: 1,
    brake: 0,
    gear: 3,
    shifted: true,
    boosting: true,
    impact: 8,
    landing: 5,
    airborne: false,
    surface: 0,
    wheels: [wheel(1.8, 0), wheel(0.5, 0), wheel(2.5, 1), wheel(1.2, 2)],
    ...overrides,
  };
}

async function exerciseAudio(audio) {
  await audio.unlock();
  await audio.unlock();
  audio.setVolume(0.5);
  audio.setVolume(NaN);
  audio.setVolume(2);
  audio.toggleMute();
  audio.toggleMute();
  void audio.muted;
  audio.update(1 / 60, audioState(), { drifting: true, boosting: true, paused: false });
  audio.update(1 / 60, audioState({ throttle: 0, shifted: false, impact: 0, landing: 0 }), { drifting: false, boosting: false, paused: false });
  audio.update(5, audioState({ rpm: 900, wheels: [] }), {});
  audio.update(1 / 60, audioState(), { paused: true });
  audio.update(1 / 60, null, null);
  audio.update(1 / 60, {}, undefined);
  audio.silence();
  for (const n of [3, 2, 1, 'GO']) audio.countdown(n);
  audio.ui();
  audio.shift();
  audio.checkpoint();
  audio.finish();
  audio.respawn();
  audio.impact(12);
  audio.impact(-1);
  audio.landing(6);
  audio.landing(undefined);
  audio.dispose();
  audio.dispose();
  // Calls after dispose are still no-ops.
  audio.update(1 / 60, audioState(), {});
  audio.ui();
}

function makeAudioStub() {
  const counts = { nodes: 0 };
  const param = (value = 0) => ({
    value,
    setValueAtTime(v) { this.value = v; return this; },
    setTargetAtTime(v) { this.value = v; return this; },
    linearRampToValueAtTime(v) { this.value = v; return this; },
    exponentialRampToValueAtTime(v) { this.value = v; return this; },
    cancelScheduledValues() { return this; },
  });
  const node = (extra = {}) => {
    counts.nodes += 1;
    return { connect(target) { return target; }, disconnect() {}, ...extra };
  };
  class StubContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.state = 'running';
      this.destination = node();
    }
    createGain() { return node({ gain: param(1) }); }
    createOscillator() { return node({ type: 'sine', frequency: param(440), detune: param(0), start() {}, stop() {} }); }
    createBiquadFilter() { return node({ type: 'lowpass', frequency: param(350), Q: param(1), gain: param(0) }); }
    createWaveShaper() { return node({ curve: null, oversample: 'none' }); }
    createDynamicsCompressor() { return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }); }
    createBuffer(channels, length) {
      const data = new Float32Array(length);
      return { length, getChannelData() { return data; } };
    }
    createBufferSource() { return node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {} }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  return { StubContext, counts };
}

test('AudioEngine: no AudioContext available, nothing throws', async () => {
  const saved = [globalThis.AudioContext, globalThis.webkitAudioContext];
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  try {
    const audio = new AudioEngine();
    const ok = await audio.unlock();
    assert(ok === false, 'unlock reports failure');
    await exerciseAudio(audio);
  } finally {
    if (saved[0]) globalThis.AudioContext = saved[0];
    if (saved[1]) globalThis.webkitAudioContext = saved[1];
  }
});

test('AudioEngine: minimal stub context, nothing throws, no nodes per frame for beds', async () => {
  const { StubContext, counts } = makeAudioStub();
  globalThis.AudioContext = StubContext;
  try {
    const audio = new AudioEngine();
    assert((await audio.unlock()) === true, 'unlocked');
    const built = counts.nodes;
    const calm = audioState({ shifted: false, impact: 0, landing: 0, boosting: false, rpm: 3000, throttle: 0.5 });
    for (let i = 0; i < 200; i += 1) audio.update(1 / 60, calm, { drifting: false, boosting: false, paused: false });
    assert(counts.nodes === built, `beds created ${counts.nodes - built} nodes per frame`);
    await exerciseAudio(new AudioEngine());
    audio.dispose();
    // Suspended context whose resume rejects.
    class Suspended extends StubContext {
      constructor() { super(); this.state = 'suspended'; }
      resume() { return Promise.reject(new Error('autoplay')); }
    }
    globalThis.AudioContext = Suspended;
    const s = new AudioEngine();
    await s.unlock();
    await exerciseAudio(s);
    // A context missing most factories must degrade to silence, not throw.
    globalThis.AudioContext = class { constructor() { this.state = 'running'; this.currentTime = 0; } };
    await exerciseAudio(new AudioEngine());
    // A constructor that throws.
    globalThis.AudioContext = class { constructor() { throw new Error('no audio'); } };
    await exerciseAudio(new AudioEngine());
  } finally {
    delete globalThis.AudioContext;
  }
});

// ------------------------------------------------------------------ per-car engine sound (engineSynth.js)

const carSound = (id) => CARS.find((c) => c.id === id).sound;

test('engineSynth: cycle and firing frequencies', () => {
  near(cycleHz(6000), 50, 1e-9, 'one 720 deg cycle every 2 revs');
  near(firingHz(6000, 4), 200, 1e-9, 'inline-four fires twice a rev');
  near(firingHz(9000, 6), 450, 1e-9, 'flat-six fires three times a rev');
  near(firingHz(4500, 4), 150, 1e-9, 'diesel four at redline');
  assert(cycleHz(-5) === 0 && cycleHz(NaN) === 0, 'garbage rpm is silent');
});

test('engineSynth: an even engine has only firing orders, staggered headers add half orders', () => {
  const even = pulseSeries({ firing: [0, 180, 360, 540] });
  assert(unevenness(even, 4) < 1e-6, `even four is pure 2nd order (${unevenness(even, 4)})`);
  const six = pulseSeries({ firing: [0, 120, 240, 360, 480, 600] });
  assert(unevenness(six, 6) < 1e-6, 'even six is pure 3rd order');
  const rumble = pulseSeries({ firing: [0, 180, 360, 540], stagger: [0, 34, -8, 26] });
  assert(unevenness(rumble, 4) > 0.1, 'unequal-length headers make a rumble');
  assert(unevenness(pulseSeries({ firing: [0, 180, 360, 540], stagger: [0, 34, -8, 26] }, { stagger: 0 }), 4) < 1e-6, 'stagger scale 0 is even');
  // Rounder pulses are darker.
  assert(centroid(pulseSeries({}, { pulse: 0.05 })) < centroid(pulseSeries({}, { pulse: 0.015 })), 'pulse width sets brightness');
  // Garbage specs fall back to defaults instead of throwing.
  const r = resolveSynth({ firing: [0, 240, 480], stagger: [1, 2], amps: 'x', pulse: [NaN, 1] });
  assert(r.firing.length === 3 && r.stagger.length === 3 && r.amps.length === 3 && r.pulse.length === 2, 'resolved lengths');
  assert(resolveSynth(null) === null && synthWaves(undefined) === null, 'no synth block -> no synth');
});

test('engineSynth: every car has its own engine character', () => {
  const ids = ['hatch', 'gt', 'thar', 'tokyo'];
  const w = {};
  for (const id of ids) {
    const sound = carSound(id);
    assert(sound && sound.synth, `${id} has a sound.synth block`);
    w[id] = synthWaves(sound.synth);
    assert(w[id] && w[id].spec.firing.length >= 4, `${id} synth resolves`);
    for (const key of ['low', 'high']) {
      const stats = waveStats(w[id][key]);
      const trim = w[id][`${key}Trim`];
      // Played back normalised to peak 1, then trimmed to the recorded loops' RMS: no clipping headroom issue.
      near(stats.normRms * trim, SAMPLE_RMS, 1e-6, `${id} ${key} trimmed to the loops' RMS`);
      assert(trim > 0 && trim < 0.5, `${id} ${key} trimmed peak stays well under full scale (${trim})`);
    }
  }
  // Cylinder counts: the GT is a six, the rest are fours.
  assert(w.gt.spec.firing.length === 6 && w.hatch.spec.firing.length === 4, 'cylinder counts');
  // Waves differ pairwise.
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = w[ids[i]].low;
      const b = w[ids[j]].low;
      let d = 0;
      for (let h = 1; h < a.real.length; h += 1) d += Math.abs(a.real[h] - b.real[h]) + Math.abs(a.imag[h] - b.imag[h]);
      assert(d > 0.05, `${ids[i]} and ${ids[j]} sound different (${d})`);
    }
  }
  // Boxer rumble: the Tokyo sedan's 1st order (cycle harmonic 2) is far stronger than the Rally Hatch's.
  assert(unevenness(w.tokyo.low, 4) > 4 * unevenness(w.hatch.low, 4), 'tokyo rumbles, hatch is even');
  assert(harmonicShare(w.tokyo.low, 2) > 10 * harmonicShare(w.hatch.low, 2), 'tokyo half-firing-rate burble');
  // Flat-six bank rasp: 1.5 order (cycle harmonic 3) on the GT.
  assert(harmonicShare(w.gt.low, 3) > 0.005, 'gt bank rasp');
  // Diesel is the darkest pulse train and filter; the GT the brightest.
  assert(centroid(w.thar.low) < centroid(w.hatch.low) && centroid(w.gt.high) > centroid(w.hatch.high), 'brightness order');
  assert(w.thar.spec.lowpass[1] < w.hatch.spec.lowpass[1] && w.gt.spec.lowpass[1] > w.tokyo.spec.lowpass[1], 'filter order');
  // Pulse frequency at redline per car.
  near(firingHz(9250, w.gt.spec.firing.length), 462.5, 1e-9, 'gt firing rate at redline');
  near(firingHz(4500, w.thar.spec.firing.length), 150, 1e-9, 'thar firing rate at redline');
});

test('cars: per-car extras match the hardware', () => {
  const hatch = carSound('hatch');
  const gt = carSound('gt');
  const thar = carSound('thar');
  const tokyo = carSound('tokyo');
  assert(thar.crackle === 0 && !thar.antiLag && thar.clatter > 0 && thar.bov === 'chuff', 'diesel: no pops, clatter, chuff');
  assert(!gt.turbo && !gt.bov && !gt.antiLag, 'gt is naturally aspirated');
  assert(hatch.antiLag > 0 && hatch.bov === 'flutter' && tokyo.bov === 'valve' && !tokyo.antiLag, 'turbo characters differ');
  assert(hatch.whine && gt.whine && tokyo.whine && !thar.whine, 'straight-cut whine only on the sequential boxes');
  assert(thar.clunk < 0.5, 'torque-converter auto has no dog clunk');
  for (const car of CARS) {
    if (car.nitro) assert(car.sound.n2o && car.sound.n2o.hiss > 0 && car.sound.n2o.roar > 1, `${car.id} has a nitrous kit sound`);
  }
  assert(tokyo.n2o.wet && !hatch.n2o.wet, 'wet vs dry kit');
});

test('engineSynth: turbo spool and gear whine', () => {
  assert(spoolTarget(1000, 1, [1300, 2700]) === 0, 'no boost below threshold');
  near(spoolTarget(2700, 1, [1300, 2700]), 1, 1e-9, 'full boost');
  near(spoolTarget(2000, 0.5, [1300, 2700]), 0.25, 1e-9, 'half load half flow');
  assert(spoolTarget(5000, 0, [2400, 4200]) === 0, 'lift: spool collapses');
  assert(spoolTarget(5000, 0, [2400, 4200], 1) >= 0.79, 'anti-lag keeps it lit');
  const [a, b] = whineHz(6000, 30, { teeth: 24, perMps: 21 });
  near(a, 2400, 1e-9, 'head-set mesh');
  near(b, 630, 1e-9, 'final-drive mesh');
});

test('AudioEngine: per-car profiles drive the synth layer without per-frame nodes', async () => {
  const { StubContext, counts } = makeAudioStub();
  class WaveContext extends StubContext {
    createPeriodicWave(real, imag) { return { real, imag }; }
    createOscillator() {
      const osc = super.createOscillator();
      osc.setPeriodicWave = (wave) => { osc.wave = wave; };
      return osc;
    }
  }
  globalThis.AudioContext = WaveContext;
  try {
    const audio = new AudioEngine();
    audio.setProfile(carSound('gt')); // before unlock: applied once the graph exists
    assert((await audio.unlock()) === true, 'unlocked');
    const g = audio._g;
    assert(audio._synthOn && g.oscLow.wave && g.oscHigh.wave, 'gt waves loaded on unlock');
    for (const id of ['hatch', 'gt', 'thar', 'tokyo']) {
      const sound = carSound(id);
      audio.setProfile(sound);
      assert(audio._synthOn, `${id} synth on`);
      const rpmMax = id === 'gt' ? 9250 : id === 'thar' ? 4500 : 7000;
      const calm = audioState({ shifted: false, impact: 0, landing: 0, boosting: false, rpm: rpmMax * 0.6, rpmMax, throttle: 0.5 });
      audio.update(1 / 60, calm, { boosting: false });
      const built = counts.nodes;
      for (let i = 0; i < 120; i += 1) audio.update(1 / 60, calm, { boosting: false });
      assert(counts.nodes === built, `${id}: ${counts.nodes - built} nodes per frame`);
      near(g.oscLow.frequency.value, cycleHz(rpmMax * 0.6), cycleHz(rpmMax * 0.6) * 0.02, `${id} pulse train at rpm / 120`);
      near(g.synthPeak.frequency.value, sound.synth.exhaust[0], 1e-9, `${id} pipe resonance`);
      assert(g.onBus.gain.value <= sound.synth.sample + 1e-9, `${id} recorded loops scaled to their share`);
      assert(g.synthLevel.gain.value > 0, `${id} synth audible`);
      // Lift at boost, anti-lag, shifts and nitro on / off: must not throw.
      audio.update(1 / 60, audioState({ rpmMax, rpm: rpmMax * 0.9, throttle: 1, shifted: true, gear: 4 }), { boosting: true });
      audio.update(1 / 60, audioState({ rpmMax, rpm: rpmMax * 0.85, throttle: 0, shifted: false }), { boosting: false });
      for (let i = 0; i < 30; i += 1) audio.update(1 / 30, audioState({ rpmMax, rpm: rpmMax * 0.7, throttle: 0, shifted: false, impact: 0, landing: 0 }), {});
    }
    // No profile: the recording alone, as before.
    audio.setProfile(null);
    assert(!audio._synthOn, 'default profile has no synth');
    audio.update(1 / 60, audioState({ shifted: false, throttle: 1, boosting: false }), { boosting: false });
    near(g.onBus.gain.value, 1, 1e-9, 'full recording without a synth');
    assert(g.synthLevel.gain.value === 0, 'synth muted');
    audio.dispose();
  } finally {
    delete globalThis.AudioContext;
  }
});

// ------------------------------------------------------------------ run
for (const [name, fn] of pending) {
  try {
    await fn();
    passes += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}\n     ${error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n     ') : error}`);
  }
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
